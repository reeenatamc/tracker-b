/**
 * Freezing what a session had prescribed, and reading it back.
 *
 * G3 lives here: once a session starts, its prescription is a stored fact and
 * never a calculation again. Change the plan tomorrow and Tuesday's session still
 * says what it said, because it kept the numbers rather than a way of finding
 * them.
 */

import { type AsOf, resolvePrescription } from "./prescription";
import type {
	PhaseId,
	PlanAdjustment,
	PrescriptionBaseline,
	SessionPlanSnapshot,
	SessionRecord,
} from "./schema";

type IsoDate = string;

/** How long an unreferenced snapshot waits before it can be collected. */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * The snapshot a session about to start should carry.
 *
 * Self-contained by construction: resolved values, no references. Revoking the
 * adjustment that made it three sets does not reach in here, because this never
 * knew about the adjustment — only the three.
 */
export function freeze(input: {
	id: string;
	sessionId: string;
	takenAt: number;
	phaseId: PhaseId;
	templateId: string;
	baseline: readonly PrescriptionBaseline[];
	adjustments: readonly PlanAdjustment[];
	asOf: AsOf;
	phaseAt: (date: IsoDate) => PhaseId;
}): SessionPlanSnapshot {
	const entries = resolvePrescription(
		input.baseline,
		input.adjustments,
		input.templateId,
		input.asOf,
		input.phaseAt,
	);

	return {
		id: input.id,
		sessionId: input.sessionId,
		takenAt: input.takenAt,
		phaseId: input.phaseId,
		entries,
		status: "committed",
		reconstructionConfidence: null,
		reconstructionGaps: [],
		adjustmentIds: input.adjustments.map((adjustment) => adjustment.id),
	};
}

/** The snapshot a session is following: the most recent one taken for it. */
export function activeSnapshot(
	snapshots: readonly SessionPlanSnapshot[],
	sessionId: string,
): SessionPlanSnapshot | null {
	return (
		snapshots
			.filter((snapshot) => snapshot.sessionId === sessionId)
			.sort((a, b) => b.takenAt - a.takenAt || b.id.localeCompare(a.id))[0] ??
		null
	);
}

// ------------------------------------------------------------- reconstruction

export type ReconstructionSource = {
	/** Adjustments whose effective date is known to be real, not assumed. */
	datable: readonly PlanAdjustment[];
	/** Adjustments that could not be placed in time. Named, never guessed at. */
	undatable: readonly string[];
};

/**
 * The snapshot a pre-E3 session would have had — deduced, and marked as such.
 *
 * Only what can be shown to have existed then goes in. An `ExerciseOverride` with
 * no timestamp is left out and named in the gaps, because including it "because it
 * probably was already there" would fabricate a historical prescription that looks
 * exactly like a real one. A `partial` snapshot says what it knows and admits what
 * it could not place; one that invents the override is worse than none.
 */
export function reconstruct(input: {
	id: string;
	session: SessionRecord;
	phaseId: PhaseId;
	templateId: string;
	baseline: readonly PrescriptionBaseline[];
	source: ReconstructionSource;
	phaseAt: (date: IsoDate) => PhaseId;
}): SessionPlanSnapshot {
	const entries = resolvePrescription(
		input.baseline,
		input.source.datable,
		input.templateId,
		{ effectiveOn: input.session.date, knows: null },
		input.phaseAt,
	);

	return {
		id: input.id,
		sessionId: input.session.id,
		// Zero, not "now": this is not a moment anything was frozen at, and giving
		// it a plausible timestamp would make a deduction look like an observation.
		takenAt: 0,
		phaseId: input.phaseId,
		entries,
		status: "reconstructed",
		reconstructionConfidence:
			input.source.undatable.length === 0 ? "complete" : "partial",
		reconstructionGaps: [...input.source.undatable],
		adjustmentIds: input.source.datable.map((adjustment) => adjustment.id),
	};
}

// ----------------------------------------------------------------- collection

export type SnapshotDisposition =
	| { kind: "keep"; why: "referenced" | "within-grace" | "awaiting-sync" }
	| { kind: "collect"; why: "orphan" };

/**
 * Whether an unreferenced snapshot may be collected.
 *
 * Slow on purpose. A snapshot with no session may not be rubbish: the session may
 * exist on the other device and not have arrived. Keeping one extra for a day
 * costs nothing; deleting one too few costs a session's plan.
 */
export function disposition(input: {
	snapshot: SessionPlanSnapshot;
	referenced: boolean;
	now: number;
	/** When the last successful sync happened, or null when sync is not set up. */
	lastSyncedAt: number | null;
	graceMs?: number;
}): SnapshotDisposition {
	if (input.referenced) return { kind: "keep", why: "referenced" };

	const grace = input.graceMs ?? ORPHAN_GRACE_MS;
	if (input.now - input.snapshot.takenAt < grace) {
		return { kind: "keep", why: "within-grace" };
	}

	// With sync configured, one has to have happened after the snapshot was taken
	// — otherwise the session it belongs to may still be sitting on the other side.
	if (
		input.lastSyncedAt !== null &&
		input.lastSyncedAt <= input.snapshot.takenAt
	) {
		return { kind: "keep", why: "awaiting-sync" };
	}

	return { kind: "collect", why: "orphan" };
}

// -------------------------------------------------------------------- recovery

export type SessionDisposition =
	| { kind: "ok" }
	/** Pre-E3. Deduced, and marked as deduced. */
	| { kind: "reconstruct" }
	/**
	 * A session created under E3 with no snapshot. The approved order persists the
	 * snapshot *before* the session, so the session existing proves the first step
	 * finished — if the snapshot is gone, something destroyed it. True with twenty
	 * sets and with zero.
	 */
	| { kind: "violation"; code: "snapshot-missing" }
	/** The contract is absent on a row too new to have lost it honestly. */
	| { kind: "violation"; code: "contract-missing" };

/**
 * What to do with a session that has no snapshot.
 *
 * "No snapshot and some sets ⇒ historical" is an inference that does not hold: it
 * is also what a post-E3 session that lost its snapshot looks like. So the
 * contract travels on the row, and absence only reads as `legacy` when the row is
 * demonstrably older than schema 3.
 */
export function dispositionOfSession(input: {
	session: SessionRecord;
	hasSnapshot: boolean;
	/**
	 * Taken, and deliberately never read. It is here so the decision is visible at
	 * the call site: "no snapshot and some sets ⇒ historical" is the inference this
	 * function exists to refuse, and a parameter that is present and ignored says
	 * that louder than one that was never offered.
	 */
	hasSets: boolean;
	/** The schema the row was written under, stamped by `syncable`. */
	writtenUnderSchema: number | null;
	/** The schema at which the prescription contract became mandatory. */
	contractSince: number;
}): SessionDisposition {
	if (input.hasSnapshot) return { kind: "ok" };

	const contract =
		input.session.prescriptionContract ??
		// No stamp at all means the row predates stamping, which predates E3.
		(input.writtenUnderSchema === null ||
		input.writtenUnderSchema < input.contractSince
			? "legacy"
			: null);

	if (contract === null) return { kind: "violation", code: "contract-missing" };
	if (contract === "legacy") return { kind: "reconstruct" };

	// snapshot_v1 without a snapshot. Never reconstructed, never auto-deleted: the
	// snapshot may exist on the other device and arrive by sync. The number of sets
	// is deliberately not consulted — §7.1 persists the snapshot *before* the
	// session, so an empty session proves just as much as a full one.
	return { kind: "violation", code: "snapshot-missing" };
}
