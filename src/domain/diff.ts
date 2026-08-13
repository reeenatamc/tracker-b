/**
 * What changed between two versions, and which decision changed it.
 *
 * The four categories are the easy half. The hard half is the *why*, and the
 * reason it is hard is that the obvious answer is wrong: the symmetric
 * difference of the adjustments in force tells you what stopped applying, not
 * who decided it. An adjustment that vanished because you revoked it should be
 * reported as *the revocation, with its reason* — the sentence you wrote when
 * you changed your mind — and not as an absence.
 *
 * Same for the phases. Two versions can resolve in different phases because an
 * event says so, or simply because their `cutAt` fall on different sides of a
 * transition nobody touched. Those are different explanations and only one of
 * them is a decision.
 *
 * Nothing here is persisted. The attribution is recomputed from the two cuts
 * every time, because storing it would freeze it against a log that keeps
 * growing — the exact failure this stage exists to prevent, one floor down.
 */

import { inForce } from "./adjustments";
import { phaseForDate } from "./phase-events";
import type {
	PhaseEvent,
	PhaseId,
	PlanAdjustment,
	PrescriptionBaseline,
	PrescriptionEntry,
	Program,
	ProgramVersion,
} from "./schema";
import type { VersionPlan } from "./versions";

/** The prescription fields a diff compares. The ten E3 already treats as plan. */
export const COMPARED = [
	"exerciseId",
	"order",
	"sets",
	"target",
	"load",
	"rir",
	"restSeconds",
	"trainingRole",
	"cues",
	"allowedSubstitutions",
] as const;

export type FieldDiff = {
	field: (typeof COMPARED)[number];
	from: unknown;
	to: unknown;
};

export type PhaseCause =
	/** The `cutAt` differ and that date falls in another phase. The log is the same. */
	| { kind: "date"; from: PhaseId; to: PhaseId }
	/** A transition B knows and A does not. */
	| { kind: "transition"; eventId: string; occurredOn: string }
	/** A correction B knows and A does not. */
	| {
			kind: "correction";
			eventId: string;
			correctsId: string;
			occurredOn: string;
	  };

export type ChangeCause =
	| {
			kind: "adjustment";
			adjustmentId: string;
			reason: string;
			origin: PlanAdjustment["origin"];
			effectiveOn: string;
	  }
	/** It stopped applying because something revoked it. The revoke is the decision. */
	| {
			kind: "revocation";
			revokeId: string;
			revokesId: string;
			reason: string;
			effectiveOn: string;
	  }
	| { kind: "phase"; from: PhaseId; to: PhaseId; via: PhaseCause }
	/** Could not be attributed. A failure to report, never a normal row. */
	| { kind: "unexplained" };

export type EntryChange =
	| {
			kind: "added";
			entryId: string;
			entry: PrescriptionEntry;
			causes: ChangeCause[];
	  }
	| {
			kind: "removed";
			entryId: string;
			entry: PrescriptionEntry;
			causes: ChangeCause[];
	  }
	| {
			kind: "replaced";
			entryId: string;
			from: PrescriptionEntry;
			to: PrescriptionEntry;
			causes: ChangeCause[];
	  }
	| {
			kind: "changed";
			entryId: string;
			fields: FieldDiff[];
			causes: ChangeCause[];
	  };

export type VersionDiff = {
	from: ProgramVersion;
	to: ProgramVersion;
	changes: EntryChange[];
	/** Entries whose difference nobody could explain. Always empty in a healthy diff. */
	unexplained: string[];
};

export type DiffInput = {
	from: { version: ProgramVersion; plan: VersionPlan };
	to: { version: ProgramVersion; plan: VersionPlan };
	adjustments: readonly PlanAdjustment[];
	phaseEvents: readonly PhaseEvent[];
	baseline: readonly PrescriptionBaseline[];
	program: Program;
};

/**
 * The differences between two already-resolved versions.
 *
 * Takes plans rather than resolving them, so that a version that cannot be
 * resolved never reaches here: comparing against a half-synced version would
 * produce differences that are gaps dressed as decisions.
 */
export function diffVersions(input: DiffInput): VersionDiff {
	const before = byId(input.from.plan);
	const after = byId(input.to.plan);
	const changes: EntryChange[] = [];

	const phase = phaseShift(input);

	for (const [entryId, entry] of after) {
		const old = before.get(entryId);

		if (!old) {
			changes.push({
				kind: "added",
				entryId,
				entry,
				causes: attribute(input, entryId, phase),
			});
			continue;
		}

		if (old.exerciseId !== entry.exerciseId) {
			changes.push({
				kind: "replaced",
				entryId,
				from: old,
				to: entry,
				causes: attribute(input, entryId, phase),
			});
			continue;
		}

		const fields = COMPARED.flatMap((field): FieldDiff[] =>
			same(old[field], entry[field])
				? []
				: [{ field, from: old[field], to: entry[field] }],
		);
		if (fields.length > 0) {
			changes.push({
				kind: "changed",
				entryId,
				fields,
				causes: attribute(input, entryId, phase),
			});
		}
	}

	for (const [entryId, entry] of before) {
		if (after.has(entryId)) continue;
		changes.push({
			kind: "removed",
			entryId,
			entry,
			causes: attribute(input, entryId, phase),
		});
	}

	changes.sort((a, b) => a.entryId.localeCompare(b.entryId));

	return {
		from: input.from.version,
		to: input.to.version,
		changes,
		unexplained: changes
			.filter((change) => change.causes.some((c) => c.kind === "unexplained"))
			.map((change) => change.entryId),
	};
}

function byId(plan: VersionPlan): Map<string, PrescriptionEntry> {
	return new Map(
		[...plan.values()].flat().map((entry) => [entry.id, entry] as const),
	);
}

/** Deep enough for the ten compared fields, and no deeper. */
function same(a: unknown, b: unknown): boolean {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// ------------------------------------------------------------- attribution

/** The phase each version resolves in, and why they differ if they do. */
function phaseShift(input: DiffInput): ChangeCause | null {
	const at = (version: ProgramVersion) =>
		phaseForDate(input.program, input.phaseEvents, version.cutAt, {
			phaseEventIds: version.knows.phaseEventIds,
		}).id;

	const from = at(input.from.version);
	const to = at(input.to.version);
	if (from === to) return null;

	// An event the newer version knows and the older one does not is the decision
	// that moved it. Only if there is none is the date the explanation.
	const older = new Set(input.from.version.knows.phaseEventIds);
	const nuevo = input.phaseEvents.filter(
		(event) =>
			input.to.version.knows.phaseEventIds.includes(event.id) &&
			!older.has(event.id),
	);

	const correction = nuevo.find((event) => event.kind === "correction");
	if (correction && correction.kind === "correction") {
		return {
			kind: "phase",
			from,
			to,
			via: {
				kind: "correction",
				eventId: correction.id,
				correctsId: correction.supersedesId,
				occurredOn: correction.occurredOn,
			},
		};
	}

	const transition = nuevo.find((event) => event.kind === "transition");
	if (transition && transition.kind === "transition") {
		return {
			kind: "phase",
			from,
			to,
			via: {
				kind: "transition",
				eventId: transition.id,
				occurredOn: transition.occurredOn,
			},
		};
	}

	return { kind: "phase", from, to, via: { kind: "date", from, to } };
}

/**
 * Why this slot differs.
 *
 * Adjustments that apply in the newer version and not the older one are the
 * decisions that made it so. Ones that went the other way are *not* reported as
 * "gone": the revocation that killed them is looked up in the newer cut and
 * reported instead, with its own reason — because that sentence is the decision
 * and the absence is only its consequence.
 */
function attribute(
	input: DiffInput,
	entryId: string,
	phase: ChangeCause | null,
): ChangeCause[] {
	const live = (version: ProgramVersion) =>
		inForce(
			input.adjustments,
			{ effectiveOn: version.cutAt, knows: version.knows },
			(date) =>
				phaseForDate(input.program, input.phaseEvents, date, {
					phaseEventIds: version.knows.phaseEventIds,
				}).id,
		).filter((adjustment) => touches(adjustment, entryId));

	const before = live(input.from.version);
	const after = live(input.to.version);
	const beforeIds = new Set(before.map((a) => a.id));
	const afterIds = new Set(after.map((a) => a.id));

	const causes: ChangeCause[] = [];

	for (const adjustment of after) {
		if (beforeIds.has(adjustment.id)) continue;
		causes.push({
			kind: "adjustment",
			adjustmentId: adjustment.id,
			reason: adjustment.reason,
			origin: adjustment.origin,
			effectiveOn: adjustment.effectiveOn,
		});
	}

	for (const adjustment of before) {
		if (afterIds.has(adjustment.id)) continue;
		const revoke = input.adjustments.find(
			(candidate) =>
				candidate.kind === "revoke" &&
				candidate.revokesId === adjustment.id &&
				input.to.version.knows.adjustmentIds.includes(candidate.id),
		);
		if (revoke && revoke.kind === "revoke") {
			causes.push({
				kind: "revocation",
				revokeId: revoke.id,
				revokesId: revoke.revokesId,
				reason: revoke.reason,
				effectiveOn: revoke.effectiveOn,
			});
		}
	}

	if (phase) causes.push(phase);
	if (causes.length === 0) causes.push({ kind: "unexplained" });
	return causes;
}

/** Whether an adjustment says anything about this slot. */
function touches(adjustment: PlanAdjustment, entryId: string): boolean {
	if (adjustment.kind === "add_entry") return adjustment.entry.id === entryId;
	if (adjustment.kind === "revoke") return false;
	return adjustment.entryId === entryId;
}
