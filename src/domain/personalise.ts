/**
 * The session as it is actually going to be performed.
 *
 * Since E3 the prescription does not come from the content any more. It comes
 * from a resolved `PrescriptionEntry` per slot — the baseline with the adjustment
 * log folded over it, or, once a session has started, the snapshot that froze
 * that fold. What is left here is joining that to who the exercise *is*: name,
 * muscle, whether it is ankle work, which still come from the library.
 *
 * What is gone: the phase indexing a column of the spreadsheet. A phase gates
 * adjustments now, and nothing else. That was the whole point of E3, and the
 * bridge that faked it through E2 went with it.
 */

import type {
	CustomExercise,
	Exercise,
	PrescriptionEntry,
	Range,
	SessionRecord,
	SessionTemplate,
} from "./schema";

/**
 * Who the exercise is, prescribing what the plan currently says.
 *
 * Everything the plan can decide comes from the entry; everything about the
 * movement itself stays as the library composed it. `setsByPhase` is left as
 * content wrote it and is never read — see the structural test.
 */
export function withPrescription(
	exercise: Exercise,
	entry: PrescriptionEntry,
): Exercise {
	return {
		...exercise,
		order: entry.order,
		target: entry.target,
		load: entry.load,
		rir: entry.rir,
		restSeconds: entry.restSeconds,
		goal: entry.goal || exercise.goal,
		progression: entry.progression || exercise.progression,
		// The prescription's own cue wins over the library's general one: it was
		// written for this exposure.
		technique: entry.cues[0] ?? exercise.technique,
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
	template: SessionTemplate;
	/** The prescription in force, already resolved. One per slot. */
	entries: readonly PrescriptionEntry[];
	customExercises: readonly CustomExercise[];
	session: SessionRecord | null;
};

/**
 * The exercise list actually shown for a session: what the plan prescribes today,
 * minus what you skipped, plus what you added.
 *
 * Skipping and adding are **deviations**, recorded on the session — they are what
 * happened, not a change of plan. Nothing here writes an adjustment.
 */
export function resolveSessionExercises({
	template,
	entries,
	customExercises,
	session,
}: ResolveInput): Exercise[] {
	const skipped = new Set(session?.skippedExerciseIds ?? []);
	const extras = new Set(session?.extraExerciseIds ?? []);
	const byExerciseId = new Map(template.exercises.map((e) => [e.id, e]));

	const programmed = entries
		// A slot with no sets is not programmed yet — step-downs before the phase
		// that introduces them.
		.filter((entry) => entry.sets !== null)
		.filter((entry) => !skipped.has(entry.exerciseId))
		.flatMap((entry) => {
			const exercise = byExerciseId.get(entry.exerciseId);
			return exercise ? [withPrescription(exercise, entry)] : [];
		});

	const added = customExercises
		.filter((custom) => extras.has(custom.id))
		.map((custom, index) => customToExercise(custom, 100 + index));

	return [...programmed, ...added].sort((a, b) => a.order - b.order);
}

/** Working sets, as a range so a "2–3" prescription keeps both ends. */
export function setsOf(entry: PrescriptionEntry | undefined): Range | null {
	if (!entry || entry.sets === null) return null;
	if (typeof entry.sets === "number") {
		return { min: entry.sets, max: entry.sets };
	}
	return { min: entry.sets[0], max: entry.sets[1] };
}

/** Prescribed today but skipped — offered to put back. */
export function skippedExercises({
	template,
	entries,
	session,
}: Omit<ResolveInput, "customExercises">): Exercise[] {
	const skipped = new Set(session?.skippedExerciseIds ?? []);
	const byExerciseId = new Map(template.exercises.map((e) => [e.id, e]));

	return entries
		.filter((entry) => entry.sets !== null && skipped.has(entry.exerciseId))
		.flatMap((entry) => {
			const exercise = byExerciseId.get(entry.exerciseId);
			return exercise ? [withPrescription(exercise, entry)] : [];
		});
}

/**
 * Finds an exercise anywhere it might be defined — the program's sessions, or the
 * ones you added yourself.
 *
 * History needs this: a set logged three weeks ago still has to be editable, and
 * the editor needs the exercise's rep range and increment to do anything useful.
 * The prescription it had that day comes from that session's snapshot, not from
 * here, so this deliberately applies nothing on top.
 */
export function findExercise(
	sessions: readonly SessionTemplate[],
	customExercises: readonly CustomExercise[],
	exerciseId: string,
): Exercise | null {
	for (const session of sessions) {
		const match = session.exercises.find(
			(exercise) => exercise.id === exerciseId,
		);
		if (match) return match;
	}

	const custom = customExercises.find((exercise) => exercise.id === exerciseId);
	return custom ? customToExercise(custom, 0) : null;
}
