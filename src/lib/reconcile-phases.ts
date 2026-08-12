/**
 * Writing down what a phase inherited, once.
 *
 * The decision this exists to hold is in `domain/inherit-phase.ts`: inheritance
 * is materialised when a phase appears, not walked on every read. This is the
 * part that touches the database, kept apart from the part that decides.
 *
 * It runs at startup, next to the other reconciliations, because "a phase
 * appeared" happens two ways — you added one, or sync brought one in from the
 * other device — and neither should have to know whether the other got there
 * first. Idempotent by construction: every row it writes has a deterministic id
 * built from the phase and the adjustment it copies.
 *
 * Before the E3 migration has run there are no `program` adjustments to inherit,
 * so on an unmigrated database this does nothing at all.
 */

import type { Collections } from "@/db/collections";
import { reconcileInheritance } from "@/domain/inherit-phase";
import { phaseForDate } from "@/domain/phase-events";
import type { PhaseEvent, PlanAdjustment, Program } from "@/domain/schema";

export type InheritanceReport = {
	created: number;
	/** Which phase got what, so the console line is worth reading. */
	byPhase: Record<string, number>;
};

export function reconcilePhaseInheritance(
	collections: Collections,
	program: Program,
	today: string,
	now: number,
): InheritanceReport {
	const adjustments = alive(
		collections.raw.planAdjustments.toArray as unknown as PlanAdjustment[],
	);
	const events = alive(
		collections.raw.phaseEvents.toArray as unknown as PhaseEvent[],
	);

	const created = reconcileInheritance({
		program,
		adjustments,
		effectiveOn: today,
		createdAt: now,
		phaseAt: (date) => phaseForDate(program, events, date).id,
	});

	const byPhase: Record<string, number> = {};
	for (const adjustment of created) {
		// Written through the normal collection: this is a decision taken now, on
		// this device, and it should travel like one.
		collections.planAdjustments.insert(adjustment);
		const phase = adjustment.onlyInPhase ?? "—";
		byPhase[phase] = (byPhase[phase] ?? 0) + 1;
	}

	return { created: created.length, byPhase };
}

/** Tombstoned rows are not part of the plan and must not be inherited. */
function alive<T>(rows: readonly T[]): T[] {
	return rows.filter(
		(row) => (row as { deletedAt?: number | null }).deletedAt == null,
	);
}
