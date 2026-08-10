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

export function cardioFor(program: Program, date: string): CardioDay | null {
	const weekday = weekdayOf(date);
	if (!CARDIO_WEEKDAYS.has(weekday)) return null;

	const phase = phaseForDate(program, date);
	const prescription =
		program.cardio.find((entry) => entry.phase === phase.id) ?? null;

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
