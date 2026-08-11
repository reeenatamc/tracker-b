/**
 * Tuesday, Thursday and Saturday.
 *
 * v3 pulled ankle rehabilitation out of the strength sessions and gave it its
 * own week-staged programme, which is the right call — folded into Full Body it
 * disappeared every time a session was rearranged, and it is the one part of
 * this plan with a clinical reason to happen on schedule.
 *
 * So these days are two things stacked: a cardio prescription that varies by
 * phase and by which day it is, and the rehab stage the calendar has reached.
 */

import { weekNumber } from "./achievements";
import { phaseForDate } from "./phases";
import { weekdayOf } from "./schedule";
import type {
	AnkleExercise,
	CardioPrescription,
	Exercise,
	Phase,
	PhaseEvent,
	PrescriptionBaseline,
	Program,
	Range,
} from "./schema";

export type CardioDay = {
	/** Minutes prescribed for this weekday at the current phase. */
	minutes: Range | null;
	prescription: CardioPrescription | null;
	/** True on Saturday, where cardio is offered rather than programmed. */
	optional: boolean;
};

const CARDIO_WEEKDAYS = new Set(["tuesday", "thursday", "saturday"]);

export function isCardioDay(date: string): boolean {
	return CARDIO_WEEKDAYS.has(weekdayOf(date));
}

export function cardioFor(
	program: Program,
	events: readonly PhaseEvent[],
	date: string,
): CardioDay | null {
	const weekday = weekdayOf(date);
	if (!CARDIO_WEEKDAYS.has(weekday)) return null;

	const phase = phaseForDate(program, events, date);
	const prescription = cardioForPhase(program, phase);

	const minutes =
		weekday === "tuesday"
			? (prescription?.tuesday ?? null)
			: weekday === "thursday"
				? (prescription?.thursday ?? null)
				: (prescription?.saturday ?? null);

	return { minutes, prescription, optional: weekday === "saturday" };
}

/**
 * Cardio as an exercise, so a logged block can be corrected in the same editor
 * as any other set. Its target is filled in from the phase when it is shown.
 */
export const CARDIO_EXERCISE: Exercise = {
	id: "cardio_machine",
	name: "Cardio",
	order: 0,
	setsByPhase: { 1: 1, 2: 1, 3: 1, 4: 1 },
	target: { kind: "minutes", min: 0, max: 180 },
	load: {
		startKg: null,
		perSide: false,
		relativeToBase: false,
		bodyweight: true,
		needsCalibration: false,
		incrementKg: null,
		raw: "",
	},
	progression: "",
	goal: "",
	muscle: "",
	rir: null,
	restSeconds: null,
	substitution: "",
	technique: "",
	isAnkle: false,
};

export type RehabStage = {
	/** The label the spreadsheet uses, e.g. "Sem 3–4". */
	stage: string;
	exercises: AnkleExercise[];
};

/**
 * The cardio prescription for a phase, following `inheritsFrom` when the phase
 * does not state one of its own. Cardio is still written per phase in the
 * content, so this walk stays: E3 moved strength prescription out, not this.
 */
function cardioForPhase(
	program: Program,
	phase: Phase,
): CardioPrescription | null {
	const seen = new Set<string>();
	let cursor: Phase | null = phase;

	while (cursor) {
		const found = program.cardio.find((entry) => entry.phase === cursor?.id);
		if (found) return found;
		if (seen.has(cursor.id)) break;
		seen.add(cursor.id);
		cursor = cursor.inheritsFrom
			? (program.phases.find((entry) => entry.id === cursor?.inheritsFrom) ??
				null)
			: null;
	}

	return null;
}

/**
 * The rehab block the calendar has reached.
 *
 * Past the last stage it holds there rather than running out: the protocol ends
 * at six weeks but the ankle does not, and dropping to nothing would quietly
 * stop the one thing with a clinical reason to continue.
 */
export function rehabStageFor(
	program: Program,
	date: string,
): RehabStage | null {
	if (program.ankleRehab.length === 0) return null;

	const week = weekNumber(program.meta.startDate, date);
	const stages = groupByStage(program.ankleRehab);

	const current =
		stages.find(({ exercises }) => {
			const weeks = exercises[0]?.weeks;
			return (
				weeks !== null &&
				weeks !== undefined &&
				week >= weeks.min &&
				week <= weeks.max
			);
		}) ?? stages[stages.length - 1];

	return current ?? null;
}

function groupByStage(exercises: readonly AnkleExercise[]): RehabStage[] {
	const byStage = new Map<string, AnkleExercise[]>();
	for (const exercise of exercises) {
		const list = byStage.get(exercise.stage) ?? [];
		list.push(exercise);
		byStage.set(exercise.stage, list);
	}
	return [...byStage].map(([stage, list]) => ({ stage, exercises: list }));
}

/**
 * A rehab entry in the shape the set logger understands, so ankle work is logged
 * exactly like everything else — same history, same records, same progression.
 */
export function rehabAsExercise(entry: AnkleExercise, order: number): Exercise {
	return {
		id: entry.id,
		name: entry.name,
		order,
		setsByPhase: { 1: entry.sets, 2: entry.sets, 3: entry.sets, 4: entry.sets },
		target: entry.target,
		load: {
			startKg: null,
			perSide: false,
			relativeToBase: false,
			bodyweight: true,
			needsCalibration: false,
			incrementKg: null,
			raw: "",
		},
		progression: entry.progression,
		goal: entry.goal,
		muscle: "",
		// Rehab is not taken near failure, so RIR is not the axis here.
		rir: null,
		// The sheet states rest for strength work only; rehab sets are short.
		restSeconds: null,
		substitution: entry.substitution,
		technique: entry.technique,
		isAnkle: true,
	};
}

/**
 * And its prescription, in the shape the executor reads since E3.
 *
 * Rehab is not in the migrated baseline: it is a clinical protocol indexed by
 * week, not a slot anybody adjusts. So its rows are built on the spot — but built
 * as *baseline* rows, so a rehab day freezes its snapshot through exactly the
 * same path as a strength day rather than round a side door. Marked `rehab_` so
 * nothing mistakes one for a seeded slot.
 */
export function rehabAsEntry(
	entry: AnkleExercise,
	templateId: string,
	order: number,
): PrescriptionBaseline {
	const exercise = rehabAsExercise(entry, order);
	return {
		id: `rehab_${entry.id}`,
		templateId,
		exerciseId: entry.id,
		order,
		sets: entry.sets,
		target: exercise.target,
		load: exercise.load,
		rir: null,
		restSeconds: null,
		trainingRole: "rehab",
		goal: entry.goal,
		progression: entry.progression,
		cues: entry.technique ? [entry.technique] : [],
		allowedSubstitutions: entry.substitution
			? [{ kind: "note", text: entry.substitution }]
			: [],
		seededFrom: "ankleRehab",
		// Not seeded at a moment: derived from the protocol every time it is read.
		seededAt: 0,
	};
}
