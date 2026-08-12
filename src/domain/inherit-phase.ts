/**
 * A new phase that says it inherits from another one.
 *
 * Two ways to honour that, and only one of them is honest.
 *
 * The resolver could walk `inheritsFrom` on every read. Then C would always
 * agree with B — including three months later, when you change B for reasons
 * that have nothing to do with C, and C moves with no event anywhere saying so.
 * "Why does C prescribe four sets?" would have no answer but "because B does,
 * today", which is the black box this whole stage exists to avoid.
 *
 * So inheritance happens **once**, when the phase appears: the programmatic
 * layer of B is copied into adjustments of its own, dated, each carrying which
 * phase it came from and which adjustment it is a copy of. After that C is
 * independent. Changing B later changes B.
 *
 * Only `origin: "program"` is copied. A safety adjustment on B is an alarm
 * somebody raised about a stretch of training; asserting it holds for a phase
 * nobody has trained yet would be inventing a clinical judgement. Manual, review
 * and coach adjustments are decisions about B, and stay about B.
 */

import { inForce } from "./adjustments";
import type { PhaseId, PlanAdjustment, Program } from "./schema";

type IsoDate = string;

/** Deterministic, so reconciling twice reconciles the same rows. */
export function inheritedAdjustmentId(
	phaseId: PhaseId,
	sourceAdjustmentId: string,
): string {
	return `adj_inherit_${phaseId}_${sourceAdjustmentId}`;
}

export type InheritanceInput = {
	program: Program;
	adjustments: readonly PlanAdjustment[];
	/** The date the copies take effect from. Normally the day C was created. */
	effectiveOn: IsoDate;
	createdAt: number;
	/**
	 * How the phase gate is answered while deciding what B currently prescribes.
	 * Passed in rather than assumed: this module does not get to decide what phase
	 * anything is in.
	 */
	phaseAt: (date: IsoDate) => PhaseId;
};

/**
 * The adjustments a phase is missing to stand on its own.
 *
 * Pure, and returns only what does not exist yet — so running it again after a
 * sync, or after a second phase appears, adds nothing. A phase with no
 * `inheritsFrom` gets nothing: it starts from the baseline, which is a real
 * answer and not an omission.
 */
export function materialiseInheritance(
	phaseId: PhaseId,
	input: InheritanceInput,
): PlanAdjustment[] {
	const phase = input.program.phases.find((entry) => entry.id === phaseId);
	if (!phase?.inheritsFrom) return [];

	const source = phase.inheritsFrom;
	const existing = new Set(input.adjustments.map((entry) => entry.id));

	/*
	 * What B prescribes *now*, not everything ever written about it: an adjustment
	 * that was already revoked, or that never came into force, is not part of what
	 * is being inherited. `inForce` answers that with the phase gate pinned to B.
	 */
	const live = inForce(
		input.adjustments,
		{ effectiveOn: input.effectiveOn, knows: null },
		() => source,
	);

	return (
		live
			.filter((adjustment) => adjustment.origin === "program")
			// Only what is scoped *to B*. An adjustment with no phase gate already
			// applies everywhere, C included, so copying it would double it.
			.filter((adjustment) => adjustment.onlyInPhase === source)
			// A row B itself inherited is part of B's programmatic layer, so a chain
			// B → C → D carries through. `sourceAdjustmentId` then points at C's copy
			// rather than B's original, which is what actually happened.
			.map((adjustment) => copyInto(phaseId, source, adjustment, input))
			.filter((adjustment) => !existing.has(adjustment.id))
	);
}

function copyInto(
	phaseId: PhaseId,
	source: PhaseId,
	adjustment: PlanAdjustment,
	input: InheritanceInput,
): PlanAdjustment {
	return {
		...adjustment,
		id: inheritedAdjustmentId(phaseId, adjustment.id),
		onlyInPhase: phaseId,
		effectiveOn: input.effectiveOn,
		createdAt: input.createdAt,
		reason: `Heredado de ${source} al crear ${phaseId}. ${adjustment.reason}`,
		provenance: {
			kind: "inherited",
			inheritedFromPhaseId: source,
			sourceAdjustmentId: adjustment.id,
		},
	} as PlanAdjustment;
}

/**
 * The same, for every phase in the program at once.
 *
 * This is what runs after a phase is created and after a sync brings one in from
 * the other device — both are "a phase appeared", and neither should need to know
 * whether the other already handled it.
 */
export function reconcileInheritance(
	input: InheritanceInput,
): PlanAdjustment[] {
	const created: PlanAdjustment[] = [];

	// In `order`, so a chain B → C → D materialises in one pass: by the time D is
	// reached, C's own rows are in `known` and are what D copies.
	const byOrder = [...input.program.phases].sort((a, b) => a.order - b.order);
	let known = [...input.adjustments];

	for (const phase of byOrder) {
		const fresh = materialiseInheritance(phase.id, {
			...input,
			adjustments: known,
		});
		created.push(...fresh);
		known = [...known, ...fresh];
	}

	return created;
}
