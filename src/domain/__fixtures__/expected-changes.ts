/**
 * The exact set of visible changes the library extraction is allowed to make.
 *
 * Collapsing three inline copies of a movement into one definition necessarily
 * changes what some sessions display: a general technique cue written once now
 * shows everywhere, and the names settle on the canonical spelling. Those were
 * reviewed and approved one by one. What must not happen is a fifteenth change
 * appearing later because somebody edited the anatomy table or reclassified a
 * cue and nobody noticed.
 *
 * So the approved set is written down here and the extractor refuses to run if
 * what it computes does not match. An extra change aborts; a missing one warns,
 * because content legitimately shrinks when an exercise leaves the program.
 *
 * Only coordinates are stored — which session, which movement, which field.
 * The text itself is training content and lives in `content/`, which is
 * gitignored for exactly that reason.
 */

export type ExpectedChange = {
	session: string;
	exercise: string;
	field: "technique" | "name" | "muscle";
};

/**
 * Nine general cues appearing where the spreadsheet had left the column blank.
 *
 * Note what is *absent*: both `leg_press` cues and the `chest_press` one are
 * classified as prescription, so they stay on their own template and no session
 * gains them. That absence is the whole point of splitting cues in two, which is
 * why it is worth stating out loud.
 */
const CUE_CHANGES: ExpectedChange[] = [
	{ session: "full_body_b", exercise: "bike_warmup", field: "technique" },
	{ session: "full_body_c", exercise: "bike_warmup", field: "technique" },
	{ session: "full_body_c", exercise: "leg_curl", field: "technique" },
	{ session: "full_body_c", exercise: "seated_row", field: "technique" },
	{ session: "full_body_c", exercise: "lat_pulldown", field: "technique" },
	{ session: "full_body_c", exercise: "lateral_raise", field: "technique" },
	{ session: "full_body_c", exercise: "biceps_curl", field: "technique" },
	{ session: "full_body_c", exercise: "triceps_extension", field: "technique" },
	{ session: "full_body_c", exercise: "cable_crunch", field: "technique" },
];

/** Four names settling on the canonical spelling. The old ones survive as aliases. */
const NAME_CHANGES: ExpectedChange[] = [
	{ session: "full_body_a", exercise: "leg_curl", field: "name" },
	{ session: "full_body_a", exercise: "lateral_raise", field: "name" },
	{ session: "full_body_a", exercise: "biceps_curl", field: "name" },
	{ session: "full_body_b", exercise: "triceps_extension", field: "name" },
];

/** One muscle line keeping the fuller of the two wordings the sheet used. */
const MUSCLE_CHANGES: ExpectedChange[] = [
	{ session: "full_body_c", exercise: "lat_pulldown", field: "muscle" },
];

export const EXPECTED_CHANGES: readonly ExpectedChange[] = [
	...CUE_CHANGES,
	...NAME_CHANGES,
	...MUSCLE_CHANGES,
];

/** What was approved, by kind. Pinned so the totals cannot drift unnoticed. */
export const EXPECTED_COUNTS = {
	technique: CUE_CHANGES.length,
	name: NAME_CHANGES.length,
	muscle: MUSCLE_CHANGES.length,
	total: EXPECTED_CHANGES.length,
} as const;

/** Stable key for set comparison. */
export function changeKey(change: ExpectedChange): string {
	return `${change.session}/${change.exercise}/${change.field}`;
}
