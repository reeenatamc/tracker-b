/**
 * What the plan prescribes for a date.
 *
 * Baseline plus adjustments, folded in precedence order. The baseline is what the
 * program said on day one and is never rewritten; everything after it is an
 * adjustment that says who decided it and from when.
 *
 * That is what makes the app unable to *believe* that a phase is N sets. It knows
 * the starting plan said so, and it knows since when — which is a sentence you
 * can argue with, revert, and audit.
 */

import { type AsOf, inForce, ordered } from "./adjustments";
import type {
	PhaseId,
	PlanAdjustment,
	PrescriptionBaseline,
	PrescriptionEntry,
} from "./schema";

type IsoDate = string;

/** The baseline stripped of its seeding metadata: the starting state of a slot. */
function asEntry(baseline: PrescriptionBaseline): PrescriptionEntry {
	const { seededFrom, seededAt, ...entry } = baseline;
	void seededFrom;
	void seededAt;
	return entry;
}

/**
 * The slots a template prescribes on a date, in order.
 *
 * `phaseAt` arrives as a function and takes no knowledge cut: bounding the phase
 * is half of reproducibility, and half a guarantee written into a signature reads
 * like a whole one. E4 widens it. E3 does not touch E2's code.
 */
export function resolvePrescription(
	baseline: readonly PrescriptionBaseline[],
	adjustments: readonly PlanAdjustment[],
	templateId: string,
	asOf: AsOf,
	phaseAt: (date: IsoDate) => PhaseId,
): PrescriptionEntry[] {
	const entries = new Map<string, PrescriptionEntry>(
		baseline
			.filter((row) => row.templateId === templateId)
			.map((row) => [row.id, asEntry(row)]),
	);
	const removed = new Set<string>();

	for (const adjustment of ordered(inForce(adjustments, asOf, phaseAt))) {
		switch (adjustment.kind) {
			case "add_entry": {
				if (adjustment.entry.templateId !== templateId) break;
				entries.set(adjustment.entry.id, adjustment.entry);
				removed.delete(adjustment.entry.id);
				break;
			}

			case "remove_entry": {
				if (!entries.has(adjustment.entryId)) break;
				removed.add(adjustment.entryId);
				break;
			}

			case "replace_exercise": {
				const current = entries.get(adjustment.entryId);
				if (!current) break;
				/*
				 * Nothing is inherited but the id. Keeping the previous occupant's load
				 * or cues would be worse than a visible error: twenty kilos on one
				 * machine are not twenty on another, and a cue for the old movement is
				 * a wrong instruction that looks deliberate.
				 */
				entries.set(adjustment.entryId, {
					...adjustment.entry,
					id: adjustment.entryId,
					templateId,
				});
				break;
			}

			case "set_field": {
				const current = entries.get(adjustment.entryId);
				if (!current) break;
				entries.set(adjustment.entryId, {
					...current,
					[adjustment.change.field]: adjustment.change.value,
				} as PrescriptionEntry);
				break;
			}
		}
	}

	return [...entries.values()]
		.filter((entry) => !removed.has(entry.id))
		.sort((a, b) => a.order - b.order);
}

/** Every template's prescription on a date. What a version would name, in E4. */
export function resolveWholePlan(
	baseline: readonly PrescriptionBaseline[],
	adjustments: readonly PlanAdjustment[],
	asOf: AsOf,
	phaseAt: (date: IsoDate) => PhaseId,
): Map<string, PrescriptionEntry[]> {
	const templates = [...new Set(baseline.map((row) => row.templateId))];
	return new Map(
		templates.map((templateId) => [
			templateId,
			resolvePrescription(baseline, adjustments, templateId, asOf, phaseAt),
		]),
	);
}

export type { AsOf };
