/**
 * Your edits, merged over the imported program.
 *
 * The YAML in `content/` is the baseline and stays untouched, so re-running the
 * spreadsheet import never wipes what you changed here. Overrides state only the
 * fields you actually edited; everything else falls through to the program.
 */

import { slotOf } from "./phases";
import type {
	CustomExercise,
	Exercise,
	ExerciseOverride,
	Phase,
	Program,
	Range,
	SessionRecord,
	SessionTemplate,
} from "./schema";

/** Applies your overrides to one exercise. */
export function applyOverride(
	exercise: Exercise,
	override: ExerciseOverride | undefined,
): Exercise {
	if (!override) return exercise;

	const target =
		(exercise.target.kind === "reps" ||
			exercise.target.kind === "repsPerSide") &&
		(override.repMin != null || override.repMax != null)
			? {
					...exercise.target,
					min: override.repMin ?? exercise.target.min,
					max: override.repMax ?? exercise.target.max,
				}
			: exercise.target;

	return {
		...exercise,
		target,
		load: {
			...exercise.load,
			startKg:
				override.startKg !== undefined
					? override.startKg
					: exercise.load.startKg,
			incrementKg:
				override.incrementKg !== undefined
					? override.incrementKg
					: exercise.load.incrementKg,
			// An explicit starting load means it no longer needs finding.
			needsCalibration:
				override.startKg != null ? false : exercise.load.needsCalibration,
		},
	};
}

/** A custom exercise, shaped like a programmed one so the UI treats them alike. */
export function customToExercise(
	custom: CustomExercise,
	order: number,
): Exercise {
	return {
		id: custom.id,
		name: custom.name,
		order,
		setsByPhase: {
			1: custom.sets,
			2: custom.sets,
			3: custom.sets,
			4: custom.sets,
		},
		target: custom.target,
		load: custom.load,
		progression: custom.progression,
		goal: custom.goal,
		muscle: "",
		rir: null,
		// Your own exercises have no prescribed rest, so the timer falls back to
		// its default rather than inventing one.
		restSeconds: null,
		substitution: "",
		technique: "",
		isAnkle: custom.isAnkle,
	};
}

export type ResolveInput = {
	program: Program;
	template: SessionTemplate;
	phase: Phase;
	overrides: readonly ExerciseOverride[];
	customExercises: readonly CustomExercise[];
	session: SessionRecord | null;
};

/**
 * The exercise list actually shown for a session: programmed for this phase,
 * minus what you skipped, plus what you added, with your overrides applied.
 */
export function resolveSessionExercises({
	program,
	template,
	phase,
	overrides,
	customExercises,
	session,
}: ResolveInput): Exercise[] {
	const byExerciseId = new Map(overrides.map((o) => [o.exerciseId, o]));
	const skipped = new Set(session?.skippedExerciseIds ?? []);
	const extras = new Set(session?.extraExerciseIds ?? []);

	const programmed = template.exercises
		.filter((exercise) => setsFor(program, exercise, phase) !== null)
		.filter((exercise) => !skipped.has(exercise.id))
		.map((exercise) => applyOverride(exercise, byExerciseId.get(exercise.id)));

	const added = customExercises
		.filter((custom) => extras.has(custom.id))
		.map((custom, index) => customToExercise(custom, 100 + index))
		.map((exercise) => applyOverride(exercise, byExerciseId.get(exercise.id)));

	return [...programmed, ...added].sort((a, b) => a.order - b.order);
}

/**
 * Working sets for a phase, honouring a manual override. Returned as a range so
 * a "2–3" prescription keeps both ends.
 */
export function resolveSets(
	program: Program,
	exercise: Exercise,
	phase: Phase,
	override: ExerciseOverride | undefined,
): Range | null {
	if (override?.setsOverride != null) {
		return { min: override.setsOverride, max: override.setsOverride };
	}
	const count = setsFor(program, exercise, phase);
	if (count === null) return null;
	if (typeof count === "number") return { min: count, max: count };
	return { min: count[0], max: count[1] };
}

/**
 * The prescription is still indexed by the numeric phase id, so the slot is
 * resolved from the phase's own data rather than rekeying the content. Bridge
 * until E3 — see `slotOf`.
 */
function setsFor(program: Program, exercise: Exercise, phase: Phase) {
	return exercise.setsByPhase[slotOf(program, phase)];
}

/** Exercises programmed for the phase that you skipped — offered to put back. */
export function skippedExercises(
	program: Program,
	template: SessionTemplate,
	phase: Phase,
	session: SessionRecord | null,
): Exercise[] {
	const skipped = new Set(session?.skippedExerciseIds ?? []);
	return template.exercises.filter(
		(exercise) =>
			skipped.has(exercise.id) && setsFor(program, exercise, phase) !== null,
	);
}

/**
 * Finds an exercise anywhere it might be defined — the program's sessions, or
 * the ones you added yourself — with your overrides applied.
 *
 * History needs this: a set logged three weeks ago still has to be editable, and
 * the editor needs the exercise's rep range and increment to do anything useful.
 */
export function findExercise(
	sessions: readonly SessionTemplate[],
	customExercises: readonly CustomExercise[],
	overrides: readonly ExerciseOverride[],
	exerciseId: string,
): Exercise | null {
	const override = overrides.find((o) => o.exerciseId === exerciseId);

	for (const session of sessions) {
		const match = session.exercises.find(
			(exercise) => exercise.id === exerciseId,
		);
		if (match) return applyOverride(match, override);
	}

	const custom = customExercises.find((exercise) => exercise.id === exerciseId);
	return custom ? applyOverride(customToExercise(custom, 0), override) : null;
}
