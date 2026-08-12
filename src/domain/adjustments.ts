/**
 * Which adjustments are in force, and which of two wins.
 *
 * The mistake this module exists to avoid: reusing the phase log's annulment
 * rule. A phase event is a *point* — you changed that day or you did not — so
 * annulling it can be total. An adjustment is a *state that lasts*, and revoking
 * one today cannot erase it from October, when it genuinely held.
 *
 * So there are two axes and every question cites both:
 *
 *   effectiveOn   what was prescribed on day X
 *   knowledge     what we knew when we asked
 *
 * The second is a set of ids, not a timestamp. Two devices logging without a
 * network have clocks that disagree; an adjustment written on the phone on
 * Tuesday can carry a later `createdAt` than one written on the laptop on
 * Wednesday, and a temporal frontier would include or exclude the wrong one.
 * `createdAt` survives for ordering on screen and for audit — never for deciding.
 */

import type {
	PhaseId,
	PlanAdjustment,
	PrescriptionKnowledgeCut,
} from "./schema";

/** A calendar day, `YYYY-MM-DD`. Compared as text, which sorts chronologically. */
type IsoDate = string;

export type AsOf = {
	/** The date whose prescription is being asked about. */
	effectiveOn: IsoDate;
	/** Which adjustments were known. `null` is the live query: all of them. */
	knows: PrescriptionKnowledgeCut | null;
};

// ------------------------------------------------------------------ knowledge

/** Whether an adjustment is inside the knowledge boundary of a query. */
function known(
	adjustment: PlanAdjustment,
	knows: PrescriptionKnowledgeCut | null,
): boolean {
	return knows === null || knows.adjustmentIds.includes(adjustment.id);
}

// -------------------------------------------------------------------- in force

/**
 * The adjustments that hold at a point in both axes.
 *
 * Condition 4 is the one that fixes the original error: a revocation carries its
 * own effective date, so it lifts the adjustment *from there onwards* and leaves
 * it untouched before.
 */
export function inForce(
	adjustments: readonly PlanAdjustment[],
	asOf: AsOf,
	phaseAt: (date: IsoDate) => PhaseId,
): PlanAdjustment[] {
	const visible = adjustments.filter((entry) => known(entry, asOf.knows));

	// Revocations that have taken effect by this date, by the id they lift.
	const lifted = new Set(
		visible
			.filter(
				(entry) =>
					entry.kind === "revoke" && entry.effectiveOn <= asOf.effectiveOn,
			)
			.map(
				(entry) =>
					(entry as Extract<PlanAdjustment, { kind: "revoke" }>).revokesId,
			),
	);

	const phase = phaseAt(asOf.effectiveOn);

	return visible.filter((entry) => {
		if (entry.kind === "revoke") return false;
		if (entry.effectiveOn > asOf.effectiveOn) return false;
		// Absent means "every phase", exactly as null does. Comparing strictly
		// would make a gate nobody set exclude every phase instead of none.
		const gate = entry.onlyInPhase ?? null;
		if (gate !== null && gate !== phase) return false;
		return !lifted.has(entry.id);
	});
}

// ------------------------------------------------------------------ precedence

const ORIGIN_RANK: Record<PlanAdjustment["origin"], number> = {
	program: 0,
	review: 1,
	coach: 1,
	manual: 1,
	safety: 2,
};

/**
 * Later wins. `id` is the final tiebreak, and deliberately not `createdAt`:
 * clocks disagree between devices, and if the last word belonged to a clock the
 * same database could prescribe differently on the phone and on the laptop. The
 * id is arbitrary but identical on both, which is the only property that matters.
 */
export function byPrecedence(a: PlanAdjustment, b: PlanAdjustment): number {
	return (
		ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin] ||
		a.effectiveOn.localeCompare(b.effectiveOn) ||
		a.id.localeCompare(b.id)
	);
}

export function ordered(
	adjustments: readonly PlanAdjustment[],
): PlanAdjustment[] {
	return [...adjustments].sort(byPrecedence);
}

// ------------------------------------------------------------------- conflicts

export type AdjustmentProblem =
	/**
	 * Two live adjustments touching the same field of the same slot, at the same
	 * origin priority and the same effective date. Resolution picks one by id so
	 * the app keeps answering — but they are two incompatible decisions, and
	 * saying so is not the same as resolving them.
	 */
	| {
			code: "ambiguous-adjustment-conflict";
			entryId: string;
			field: string;
			adjustmentIds: string[];
	  }
	/** A revocation pointing at another revocation. Forbidden — see §2.4. */
	| { code: "revoke-of-revoke"; adjustmentId: string; revokesId: string }
	/** A revocation pointing at nothing. */
	| { code: "revokes-unknown"; adjustmentId: string; revokesId: string }
	/** Replacing an exercise while a safety alarm is live, without resolving it. */
	| {
			code: "unresolved-safety-on-replace";
			adjustmentId: string;
			entryId: string;
			safetyAdjustmentIds: string[];
	  }
	/** A safety resolution referring to adjustments that do not exist. */
	| {
			code: "safety-resolution-dangling";
			adjustmentId: string;
			missingIds: string[];
	  };

/** What a `set_field` targets, for conflict detection. */
function fieldKeyOf(adjustment: PlanAdjustment): string | null {
	return adjustment.kind === "set_field"
		? `${adjustment.entryId}::${adjustment.change.field}`
		: null;
}

/**
 * Reports, never throws. Resolution has to keep answering while you are standing
 * between sets; complaining is this function's job, exactly as `validateEvents`
 * does for the phase log.
 */
export function validateAdjustments(
	adjustments: readonly PlanAdjustment[],
	asOf: AsOf,
	phaseAt: (date: IsoDate) => PhaseId,
): AdjustmentProblem[] {
	const problems: AdjustmentProblem[] = [];
	const byId = new Map(adjustments.map((entry) => [entry.id, entry]));

	for (const entry of adjustments) {
		if (entry.kind === "revoke") {
			const target = byId.get(entry.revokesId);
			if (!target) {
				problems.push({
					code: "revokes-unknown",
					adjustmentId: entry.id,
					revokesId: entry.revokesId,
				});
			} else if (target.kind === "revoke") {
				problems.push({
					code: "revoke-of-revoke",
					adjustmentId: entry.id,
					revokesId: entry.revokesId,
				});
			}
		}

		if (entry.kind === "replace_exercise" && entry.safetyResolution) {
			const missing = [
				...entry.safetyResolution.safetyAdjustmentIds,
				...referencedByDecision(entry.safetyResolution),
			].filter((id) => !byId.has(id));
			if (missing.length > 0) {
				problems.push({
					code: "safety-resolution-dangling",
					adjustmentId: entry.id,
					missingIds: missing,
				});
			}
		}
	}

	const live = inForce(adjustments, asOf, phaseAt);

	// Replacing a slot's exercise while an alarm is live on it must be resolved.
	const liveSafetyByEntry = new Map<string, string[]>();
	for (const entry of live) {
		if (entry.origin !== "safety") continue;
		const target = entryIdOf(entry);
		if (!target) continue;
		liveSafetyByEntry.set(target, [
			...(liveSafetyByEntry.get(target) ?? []),
			entry.id,
		]);
	}
	for (const entry of live) {
		if (entry.kind !== "replace_exercise") continue;
		const alarms = liveSafetyByEntry.get(entry.entryId) ?? [];
		if (alarms.length > 0 && (entry.safetyResolution ?? null) === null) {
			problems.push({
				code: "unresolved-safety-on-replace",
				adjustmentId: entry.id,
				entryId: entry.entryId,
				safetyAdjustmentIds: alarms,
			});
		}
	}

	// Ties: same slot, same field, same priority, same effective date.
	const buckets = new Map<string, PlanAdjustment[]>();
	for (const entry of live) {
		const key = fieldKeyOf(entry);
		if (key === null) continue;
		const bucket = `${key}::${ORIGIN_RANK[entry.origin]}::${entry.effectiveOn}`;
		buckets.set(bucket, [...(buckets.get(bucket) ?? []), entry]);
	}
	for (const bucket of buckets.values()) {
		if (bucket.length < 2) continue;
		const [first] = bucket;
		problems.push({
			code: "ambiguous-adjustment-conflict",
			entryId: (first as Extract<PlanAdjustment, { kind: "set_field" }>)
				.entryId,
			field: (first as Extract<PlanAdjustment, { kind: "set_field" }>).change
				.field,
			adjustmentIds: ordered(bucket).map((entry) => entry.id),
		});
	}

	return problems;
}

function referencedByDecision(
	resolution: NonNullable<
		Extract<PlanAdjustment, { kind: "replace_exercise" }>["safetyResolution"]
	>,
): string[] {
	if (resolution.decision.kind === "reformulate") {
		return [resolution.decision.replacementAdjustmentId];
	}
	if (resolution.decision.kind === "revoke") {
		return [resolution.decision.revocationAdjustmentId];
	}
	return [];
}

/** The slot an adjustment acts on, when it acts on one. */
export function entryIdOf(adjustment: PlanAdjustment): string | null {
	switch (adjustment.kind) {
		case "set_field":
		case "replace_exercise":
		case "remove_entry":
			return adjustment.entryId;
		case "add_entry":
			return adjustment.entry.id;
		default:
			return null;
	}
}
