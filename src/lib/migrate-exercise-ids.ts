/**
 * Re-points stored records onto canonical exercise ids.
 *
 * Ids used to be slugs of the display name. Every set you logged before this
 * carries one, and the v3 program uses canonical ids — so without this, Monday's
 * prensa and the program's `leg_press` are two different exercises and "la vez
 * pasada hiciste…" goes blank.
 *
 * This rewrites the identifier and nothing else. Loads, reps, RIR, pain and
 * notes are untouched: the workout stays exactly as it was performed, it just
 * stops being filed under a name.
 *
 * Idempotent — a record already carrying a canonical id is skipped, so this can
 * run on every launch without doing anything after the first.
 */

import type { Collections } from "@/db/collections";
import { migrateLegacyId } from "@/domain/exercise-ids";

export type MigrationReport = {
	setsMigrated: number;
	customExercisesMigrated: number;
	overridesMigrated: number;
	/** Stored ids no canonical id claims. Reported, never guessed at. */
	unmapped: string[];
};

export function migrateExerciseIds(collections: Collections): MigrationReport {
	const report: MigrationReport = {
		setsMigrated: 0,
		customExercisesMigrated: 0,
		overridesMigrated: 0,
		unmapped: [],
	};
	const unmapped = new Set<string>();

	for (const set of collections.raw.sets.toArray) {
		const canonical = migrateLegacyId(set.exerciseId);
		if (canonical) {
			// Written through `raw` so the change is a correction, not an edit —
			// re-stamping would make every migrated set look freshly modified and
			// push it to the other device as if you had just changed it.
			collections.raw.sets.update(set.id, (draft) => {
				draft.exerciseId = canonical;
			});
			report.setsMigrated++;
		} else if (!isKnown(set.exerciseId)) {
			unmapped.add(set.exerciseId);
		}
	}

	for (const override of collections.raw.overrides.toArray) {
		const canonical = migrateLegacyId(override.exerciseId);
		if (!canonical) continue;
		collections.raw.overrides.update(override.id, (draft) => {
			draft.exerciseId = canonical;
		});
		report.overridesMigrated++;
	}

	report.unmapped = [...unmapped];
	return report;
}

/** Canonical ids and the ones you made yourself both count as already fine. */
function isKnown(id: string): boolean {
	return (
		id.startsWith("custom-") ||
		id.startsWith("finisher-") ||
		/^[a-z][a-z0-9_]*$/.test(id)
	);
}
