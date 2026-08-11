/**
 * Telling you the phase log is damaged — which is deliberately not the same job as
 * resolving it.
 *
 * `phaseForDate` never throws, because it is called from the screen you are
 * holding between sets and a corrupt log is not a reason to lose the app. The cost
 * of that is that it stays quiet about damage. So the complaining lives here, runs
 * in tests and can be surfaced on a screen, and never blocks logging.
 *
 * A broken chain is the kind of damage nobody notices for months and then finds by
 * staring at a graph that looks slightly wrong. Cheaper to check.
 */

import { liveEvents, moves, phaseByIdOrNull } from "./phase-events";
import type { PhaseEvent, Program } from "./schema";

export type PhaseLogProblem =
	| { code: "multiple-initial"; eventIds: string[] }
	| { code: "no-initial" }
	| {
			code: "broken-chain";
			eventId: string;
			expected: string | null;
			found: string | null;
	  }
	| { code: "unknown-phase"; eventId: string; phaseId: string }
	| { code: "self-transition"; eventId: string; phaseId: string }
	| { code: "duplicate-order"; order: number; phaseIds: string[] }
	| { code: "unknown-inherits"; phaseId: string; inheritsFrom: string }
	| { code: "inherits-cycle"; phaseIds: string[] }
	| { code: "anchored-without-date"; phaseId: string }
	| { code: "annulment-cycle"; eventIds: string[] }
	| { code: "double-annulment"; targetId: string; eventIds: string[] }
	| { code: "duplicate-legacy-id"; legacyId: number; phaseIds: string[] };

export function validateEvents(
	program: Program,
	events: readonly PhaseEvent[],
): PhaseLogProblem[] {
	return [...validatePhases(program), ...validateLog(program, events)];
}

// ---------------------------------------------------------------- the phases

function validatePhases(program: Program): PhaseLogProblem[] {
	const problems: PhaseLogProblem[] = [];
	const byId = new Map(program.phases.map((phase) => [phase.id, phase]));

	const byOrder = new Map<number, string[]>();
	const byLegacy = new Map<number, string[]>();

	for (const phase of program.phases) {
		byOrder.set(phase.order, [...(byOrder.get(phase.order) ?? []), phase.id]);
		if (phase.legacyId !== null) {
			byLegacy.set(phase.legacyId, [
				...(byLegacy.get(phase.legacyId) ?? []),
				phase.id,
			]);
		}

		if (phase.schedulePolicy === "anchored" && phase.plannedStart === null) {
			problems.push({ code: "anchored-without-date", phaseId: phase.id });
		}

		if (phase.inheritsFrom !== null && !byId.has(phase.inheritsFrom)) {
			problems.push({
				code: "unknown-inherits",
				phaseId: phase.id,
				inheritsFrom: phase.inheritsFrom,
			});
		}
	}

	for (const [order, phaseIds] of byOrder) {
		if (phaseIds.length > 1) {
			problems.push({ code: "duplicate-order", order, phaseIds });
		}
	}
	for (const [legacyId, phaseIds] of byLegacy) {
		if (phaseIds.length > 1) {
			problems.push({ code: "duplicate-legacy-id", legacyId, phaseIds });
		}
	}

	problems.push(...inheritanceCycles(program));
	return problems;
}

/**
 * The migration walks `inheritsFrom` recursively, so a cycle there is not a cosmetic
 * problem: unchecked it shows up as a stack overflow the moment the app opens.
 */
function inheritanceCycles(program: Program): PhaseLogProblem[] {
	const byId = new Map(program.phases.map((phase) => [phase.id, phase]));
	const problems: PhaseLogProblem[] = [];
	const settled = new Set<string>();

	for (const phase of program.phases) {
		if (settled.has(phase.id)) continue;

		const path: string[] = [];
		const seen = new Set<string>();
		let cursor: string | null = phase.id;

		while (cursor !== null && !settled.has(cursor)) {
			if (seen.has(cursor)) {
				problems.push({
					code: "inherits-cycle",
					phaseIds: path.slice(path.indexOf(cursor)),
				});
				break;
			}
			seen.add(cursor);
			path.push(cursor);
			cursor = byId.get(cursor)?.inheritsFrom ?? null;
		}

		for (const id of path) settled.add(id);
	}

	return problems;
}

// -------------------------------------------------------------------- the log

function validateLog(
	program: Program,
	events: readonly PhaseEvent[],
): PhaseLogProblem[] {
	const problems: PhaseLogProblem[] = [];
	const live = liveEvents(events);
	const liveIds = new Set(live.map((event) => event.id));

	// Annulment cycles: liveEvents already treats them as dead, but silently.
	const inCycle = events
		.filter((event) => !liveIds.has(event.id))
		.filter((event) => isInAnnulmentCycle(events, event.id));
	if (inCycle.length > 0) {
		problems.push({
			code: "annulment-cycle",
			eventIds: inCycle.map((event) => event.id),
		});
	}

	// Two live events annulling the same target: the resolution keeps the newest,
	// but somebody should know it happened.
	const byTarget = new Map<string, string[]>();
	for (const event of live) {
		const target =
			event.kind === "correction"
				? event.supersedesId
				: event.kind === "revocation"
					? event.revokesId
					: null;
		if (target === null) continue;
		byTarget.set(target, [...(byTarget.get(target) ?? []), event.id]);
	}
	for (const [targetId, eventIds] of byTarget) {
		if (eventIds.length > 1) {
			problems.push({ code: "double-annulment", targetId, eventIds });
		}
	}

	const chain = moves(events);

	for (const move of chain) {
		if (!phaseByIdOrNull(program, move.toPhaseId)) {
			problems.push({
				code: "unknown-phase",
				eventId: move.id,
				phaseId: move.toPhaseId,
			});
		}
		if (
			move.fromPhaseId !== null &&
			!phaseByIdOrNull(program, move.fromPhaseId)
		) {
			problems.push({
				code: "unknown-phase",
				eventId: move.id,
				phaseId: move.fromPhaseId,
			});
		}
		if (move.fromPhaseId === move.toPhaseId) {
			problems.push({
				code: "self-transition",
				eventId: move.id,
				phaseId: move.toPhaseId,
			});
		}
	}

	// Continuity: each event must depart from where the previous one arrived.
	const initial = chain.filter((move) => move.fromPhaseId === null);
	if (chain.length > 0 && initial.length === 0) {
		problems.push({ code: "no-initial" });
	}
	if (initial.length > 1) {
		problems.push({
			code: "multiple-initial",
			eventIds: initial.map((move) => move.id),
		});
	}

	let previous: string | null = null;
	chain.forEach((move, index) => {
		const expected = index === 0 ? null : previous;
		if (move.fromPhaseId !== expected) {
			problems.push({
				code: "broken-chain",
				eventId: move.id,
				expected,
				found: move.fromPhaseId,
			});
		}
		previous = move.toPhaseId;
	});

	return problems;
}

/** Whether following this event's annulment edge leads back to itself. */
function isInAnnulmentCycle(
	events: readonly PhaseEvent[],
	start: string,
): boolean {
	const edge = new Map<string, string>();
	for (const event of events) {
		if (event.kind === "correction") edge.set(event.id, event.supersedesId);
		if (event.kind === "revocation") edge.set(event.id, event.revokesId);
	}

	const seen = new Set<string>();
	let cursor: string | undefined = start;

	while (cursor !== undefined) {
		if (seen.has(cursor)) return cursor === start || seen.has(start);
		seen.add(cursor);
		cursor = edge.get(cursor);
	}

	return false;
}
