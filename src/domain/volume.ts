/**
 * How much work two versions plan, side by side.
 *
 * Deliberately small, and the smallness is the design. Planned working sets per
 * template and in total — nothing per muscle.
 *
 * A per-muscle breakdown would depend on `groupOf()` and on the library's
 * classification, and that classification is **correctable**. Relabel an
 * exercise six months from now because it was tagged wrong, and the diff between
 * two versions of October would change — although neither version changed and
 * although the October plan was exactly what it was. That is the same family of
 * failure this whole stage exists to prevent, coming in through a third door,
 * and it cannot be fixed inside E4: bounding the library would need a fourth set
 * of ids in the cut, and the library is not an append-only log.
 *
 * Sets and slots have no such problem. They are in the resolved prescription and
 * already bounded by the cut.
 *
 * The muscular audit is E5, where the underlying question — what it means to
 * bound a classification that gets corrected — can actually be answered.
 */

import type { PrescriptionEntry, SetCount } from "./schema";
import type { VersionPlan } from "./versions";

export type VolumeDiff = {
	byTemplate: Array<{
		templateId: string;
		from: number;
		to: number;
		delta: number;
	}>;
	total: { from: number; to: number; delta: number };
};

/**
 * Working sets a slot plans.
 *
 * A range counts as its **top**: counting the bottom would hide an increase, and
 * the screen says which end it is using so the number is never mistaken for a
 * promise. `null` — not programmed in this phase — counts zero.
 */
export function plannedSets(sets: SetCount): number {
	if (sets === null) return 0;
	if (typeof sets === "number") return sets;
	return sets[1];
}

function totalOf(entries: readonly PrescriptionEntry[]): number {
	return entries.reduce((sum, entry) => sum + plannedSets(entry.sets), 0);
}

/** Planned volume, one version against the other. */
export function diffVolume(from: VersionPlan, to: VersionPlan): VolumeDiff {
	const templates = [...new Set([...from.keys(), ...to.keys()])].sort();

	const byTemplate = templates.map((templateId) => {
		const before = totalOf(from.get(templateId) ?? []);
		const after = totalOf(to.get(templateId) ?? []);
		return { templateId, from: before, to: after, delta: after - before };
	});

	const before = byTemplate.reduce((sum, row) => sum + row.from, 0);
	const after = byTemplate.reduce((sum, row) => sum + row.to, 0);

	return {
		byTemplate,
		total: { from: before, to: after, delta: after - before },
	};
}
