/**
 * Re-points stored sessions onto named phases, and seeds the log with the
 * transitions the plan implies.
 *
 * Every session ever logged carries the phase it was in, stamped when it was
 * created. Those stamps are numbers; phases are now named. This rewrites the
 * label and nothing else — the session stays exactly the session it was, it just
 * stops being filed under a digit.
 *
 * Seeding matters as much as the rename. Without it the log would be empty and
 * every date would fall back to the first phase; with it, the phase derived for
 * any past date is the one the old date-range code returned. That equivalence is
 * checked day by day in the tests, not assumed here.
 *
 * The rules are the ones `migrate-exercise-ids.ts` established, because they
 * worked:
 *
 *   - data-driven, never a hand-written table of slugs;
 *   - idempotent, so it can run on every launch;
 *   - written through `raw`, so a correction does not look like a fresh edit and
 *     get pushed to the other device as one;
 *   - anything unmappable is reported and left alone. Guessing would move a
 *     session into a phase it was never in, in silence, which is the one outcome
 *     worth more than the inconvenience of a manual fix.
 */

import type { Collections } from "@/db/collections";
import { stamp } from "@/db/synced";
import type { PhaseEvent, Program } from "@/domain/schema";

export type PhaseMigrationReport = {
	sessionsMigrated: number;
	eventsSeeded: number;
	/** Stored phase values no phase claims. Reported, never guessed at. */
	unmapped: string[];
};

const SEED_PREFIX = "seed-phase-";

/** A stored phase that is still a number is one this migration has not reached. */
function isLegacyPhase(value: unknown): value is number {
	return typeof value === "number";
}

export function migratePhaseIds(
	collections: Collections,
	program: Program,
): PhaseMigrationReport {
	const report: PhaseMigrationReport = {
		sessionsMigrated: 0,
		eventsSeeded: 0,
		unmapped: [],
	};

	const byLegacy = new Map(
		program.phases
			.filter((phase) => phase.legacyId !== null)
			.map((phase) => [phase.legacyId as number, phase.id]),
	);
	const unmapped = new Set<string>();

	for (const session of collections.raw.sessions.toArray) {
		const stored = (session as { phase: unknown }).phase;
		if (!isLegacyPhase(stored)) continue;

		const named = byLegacy.get(stored);
		if (named === undefined) {
			unmapped.add(String(stored));
			continue;
		}

		collections.raw.sessions.update(session.id, (draft) => {
			(draft as { phase: unknown }).phase = named;
		});
		report.sessionsMigrated++;
	}

	report.unmapped = [...unmapped];
	report.eventsSeeded = seedTransitions(collections, program);
	return report;
}

/**
 * One transition per phase, from the plan's own dates.
 *
 * Ids are deterministic so re-seeding reconciles instead of duplicating, and the
 * trigger says `planned` because that is honestly where they came from: nobody
 * recorded these at the time, they are the plan restated as events so that
 * everything before today resolves the way it always did.
 */
function seedTransitions(collections: Collections, program: Program): number {
	const ordered = [...program.phases].sort((a, b) => a.order - b.order);
	let seeded = 0;

	ordered.forEach((phase, index) => {
		if (phase.plannedStart === null) return;

		const id = `${SEED_PREFIX}${phase.id}`;
		if (collections.raw.phaseEvents.has(id)) return;

		const event: PhaseEvent = {
			kind: "transition",
			id,
			fromPhaseId: index === 0 ? null : ordered[index - 1].id,
			toPhaseId: phase.id,
			occurredOn: phase.plannedStart,
			plannedFor: phase.plannedStart,
			trigger: "planned",
			reason: "Sembrada desde el plan original en la migración a E2.",
			reviewId: null,
			createdAt: Date.parse(`${phase.plannedStart}T12:00:00Z`),
		};

		// Through `raw` and stamped by hand: seeding is reconstruction, not an edit
		// you made, and both devices reconstruct the same rows independently.
		collections.raw.phaseEvents.insert({ ...stamp(), ...event });
		seeded++;
	});

	return seeded;
}

/**
 * Records arriving from another device, normalised before they are written.
 *
 * This is the defence that keeps a database from ending up half named and half
 * numbered: a device that has migrated can still be sent an old session by one
 * that has not, and translating on the way in means the mixed state never exists
 * rather than being cleaned up afterwards.
 */
export function normalizeIncoming(
	program: Program,
	collection: string,
	rows: readonly Record<string, unknown>[],
): { rows: Record<string, unknown>[]; normalized: number; unmapped: string[] } {
	if (collection !== "sessions") {
		return { rows: [...rows], normalized: 0, unmapped: [] };
	}

	const byLegacy = new Map(
		program.phases
			.filter((phase) => phase.legacyId !== null)
			.map((phase) => [phase.legacyId as number, phase.id]),
	);
	const unmapped = new Set<string>();
	let normalized = 0;

	const mapped = rows.map((row) => {
		if (!isLegacyPhase(row.phase)) return row;

		const named = byLegacy.get(row.phase);
		if (named === undefined) {
			unmapped.add(String(row.phase));
			return row;
		}

		normalized++;
		return { ...row, phase: named };
	});

	return { rows: mapped, normalized, unmapped: [...unmapped] };
}

/** Stored sessions still carrying a number. Should always be empty after a sync. */
export function sessionsWithLegacyPhase(
	collections: Collections,
): SessionLike[] {
	return collections.raw.sessions.toArray.filter((session) =>
		isLegacyPhase((session as { phase: unknown }).phase),
	) as SessionLike[];
}

type SessionLike = { id: string; phase: unknown };
