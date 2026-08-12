/**
 * The sweep that runs at startup: every session accounted for, nothing invented.
 *
 * G3 says no session may exist without a snapshot. There is no transaction across
 * collections, so what actually holds it up is the order in §7.1 plus this — the
 * pass that finds the sessions the order failed to protect and *says so* instead
 * of deducing a plausible plan for them.
 *
 * The one rule underneath: a pre-E3 session and a broken one look identical from
 * the outside, so nothing here guesses which is which. The contract on the row
 * decides, and where the contract is absent, `dispositionOfSession` decides
 * whether the row is old enough to have lost it honestly.
 */

import type {
	PhaseId,
	PlanAdjustment,
	PrescriptionBaseline,
	SessionPlanSnapshot,
	SessionRecord,
} from "@/domain/schema";
import {
	activeSnapshot,
	disposition,
	dispositionOfSession,
	type ReconstructionSource,
	reconstruct,
	type SessionDisposition,
} from "@/domain/snapshot";

/** The schema version at which the prescription contract became mandatory. */
export const CONTRACT_SINCE = 3;

/** A session that has to be shown, because something went wrong for it. */
export type SnapshotViolation = {
	sessionId: string;
	date: string;
	code: "snapshot-missing" | "contract-missing" | "snapshot-unresolvable";
};

export type RecoveryPlan = {
	/** Snapshots to write for pre-E3 sessions. Deduced, and marked as deduced. */
	reconstruct: SessionPlanSnapshot[];
	/** Orphans past grace and past a sync. Everything else is kept. */
	collect: string[];
	/** Never repaired by guessing. Surfaced. */
	violations: SnapshotViolation[];
};

export type RecoveryInput = {
	sessions: readonly SessionRecord[];
	snapshots: readonly SessionPlanSnapshot[];
	/**
	 * What this session's plan is built from. A function, not a list, because a
	 * strength day and an ankle day do not read the same place — and the executor
	 * answers that question with `sessionBaseline`, so this one must too. Handing
	 * every session the strength baseline is what made an ankle day reconstruct to
	 * nothing and then call it `complete`.
	 */
	baselineFor: (session: SessionRecord) => {
		rows: readonly PrescriptionBaseline[];
		gap: string | null;
	};
	adjustments: readonly PlanAdjustment[];
	phaseAt: (date: string) => PhaseId;
	/** The schema each session row was written under, stamped by `syncable`. */
	schemaOf: (sessionId: string) => number | null;
	/** Handed over and never consulted. See `dispositionOfSession`. */
	hasSets: (sessionId: string) => boolean;
	now: number;
	lastSyncedAt: number | null;
	/** Ids for the reconstructed snapshots. Passed in: this module has no clock. */
	idFor: (sessionId: string) => string;
	graceMs?: number;
};

/**
 * What the app should do about the snapshots it has, without doing any of it.
 *
 * Pure on purpose. Deciding to delete a session's plan is exactly the sort of
 * thing that should be inspectable in a test before it is inspectable in OPFS.
 */
export function planRecovery(input: RecoveryInput): RecoveryPlan {
	const plan: RecoveryPlan = { reconstruct: [], collect: [], violations: [] };
	const byId = new Set(input.snapshots.map((snapshot) => snapshot.id));

	for (const session of input.sessions) {
		// A session naming a snapshot that is not there is not the same as one naming
		// none: the reference is a claim that something existed, so its absence is a
		// loss and never a reason to deduce a plan.
		//
		// `?? null` matters more here than anywhere. A restored pre-E3 row has no
		// `snapshotId` key, and `undefined !== null` is true — which turned "never
		// had one" into "pointed at one and it is gone", the loudest verdict the
		// module can produce, for the most ordinary row there is.
		const names = session.snapshotId ?? null;
		if (names !== null && !byId.has(names)) {
			plan.violations.push({
				sessionId: session.id,
				date: session.date,
				code: "snapshot-unresolvable",
			});
			continue;
		}

		const verdict: SessionDisposition = dispositionOfSession({
			session,
			hasSnapshot: activeSnapshot(input.snapshots, session.id) !== null,
			hasSets: input.hasSets(session.id),
			writtenUnderSchema: input.schemaOf(session.id),
			contractSince: CONTRACT_SINCE,
		});

		if (verdict.kind === "ok") continue;

		if (verdict.kind === "violation") {
			plan.violations.push({
				sessionId: session.id,
				date: session.date,
				code: verdict.code,
			});
			continue;
		}

		const from = input.baselineFor(session);
		const source = datable(input.adjustments);

		plan.reconstruct.push(
			reconstruct({
				id: input.idFor(session.id),
				session,
				phaseId: session.phase,
				templateId: session.templateId,
				baseline: from.rows,
				// A plan that could not be built is named, never passed over in
				// silence: that is what turns it into `partial` with a reason.
				source: from.gap
					? { ...source, undatable: [...source.undatable, from.gap] }
					: source,
				phaseAt: input.phaseAt,
			}),
		);
	}

	const referenced = new Set(
		input.snapshots
			.filter((snapshot) =>
				input.sessions.some((session) => session.id === snapshot.sessionId),
			)
			.map((snapshot) => snapshot.id),
	);

	for (const snapshot of input.snapshots) {
		const verdict = disposition({
			snapshot,
			referenced: referenced.has(snapshot.id),
			now: input.now,
			lastSyncedAt: input.lastSyncedAt,
			graceMs: input.graceMs,
		});
		if (verdict.kind === "collect") plan.collect.push(snapshot.id);
	}

	return plan;
}

/**
 * Splitting the log into what can be placed in time and what cannot.
 *
 * An adjustment whose effective date the migration assumed is not evidence about
 * any day: it says "from the migration onwards" because nobody knows when it
 * started. So it stays out of every reconstruction and gets named, which is what
 * turns one `partial` rather than quietly wrong.
 *
 * Whether it lands before or after the session is not consulted, because that
 * comparison would be against a date nobody knows.
 */
export function datable(
	adjustments: readonly PlanAdjustment[],
): ReconstructionSource {
	const placed: PlanAdjustment[] = [];
	const unplaced: string[] = [];

	for (const adjustment of adjustments) {
		const assumed =
			adjustment.provenance.kind === "migrated" &&
			adjustment.provenance.assumedEffectiveOn;
		if (assumed) unplaced.push(adjustment.id);
		else placed.push(adjustment);
	}

	return { datable: placed, undatable: unplaced };
}
