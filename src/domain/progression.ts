/**
 * Double progression, exactly as the spreadsheet states it:
 *
 *   "Mantén el peso hasta completar el tope de reps en TODAS las series con
 *    técnica limpia y ~RIR 2; luego sube el incremento mínimo."
 *
 *   "20 kg: 12/10 → mantener. 12/12 con RIR≈2 → probar siguiente incremento.
 *    25 kg: 8 reps muy exigentes → todavía no es peso de trabajo."
 *
 * This is the column the spreadsheet made you fill in by hand. Everything here
 * is a pure function of the last session's working sets, so it is fully tested
 * rather than trusted.
 */

import {
	evaluateSafety,
	type SafetyInput,
	type SafetySignal,
	worstPain,
} from "./safety";
import type { Exercise, Range, SetRecord } from "./schema";

/**
 * Fallback jump when the exercise does not state one. The spreadsheet's "Carga
 * inicial" column holds starting loads, never increments, so nothing in the
 * source data implies a machine's real step. 2.5 kg is the smallest plate on
 * most stacks; override per exercise in `content/program.yaml`.
 */
export const DEFAULT_INCREMENT_KG = 2.5;

export type HoldReason =
	/** At least one working set fell short of the top of the rep range. */
	| "repsBelowTop"
	/** Reps were there, but too close to failure to add load. */
	| "rirTooLow"
	/** No RIR recorded, so the rule cannot be evaluated. */
	| "rirUnknown"
	/** Fewer working sets logged than the phase programs. */
	| "setsIncomplete";

export type ProgressionDecision =
	/** An ankle warning sign outranks progression. */
	| { kind: "blocked"; signals: SafetySignal[] }
	/** Working load still has to be found in the gym. */
	| { kind: "calibrate" }
	/** No history yet — begin at the programmed starting load. */
	| { kind: "start"; loadKg: number | null; perSide: boolean }
	/** Stay at this load until the whole rep range is owned. */
	| {
			kind: "hold";
			loadKg: number | null;
			perSide: boolean;
			reason: HoldReason;
	  }
	/** Rep range owned at the target RIR: add the smallest jump. */
	| {
			kind: "increase";
			fromKg: number;
			toKg: number;
			incrementKg: number;
			perSide: boolean;
	  }
	/** Bodyweight work: the rep range is owned, so make the movement harder. */
	| { kind: "advanceDifficulty" }
	/** Timed holds and cardio: progressed by the written rule, not by load. */
	| { kind: "qualitative" };

export type ProgressionInput = {
	exercise: Exercise;
	/** Working sets from the most recent session containing this exercise. */
	lastSets: readonly SetRecord[];
	/** Reps in reserve the current phase asks for. */
	targetRir: Range;
	/** Working sets the current phase programs, if any. */
	targetSets: Range | null;
	/** Weekly ankle check, so swelling and instability count even when pain was 0. */
	safety?: SafetyInput;
};

/**
 * Whether "how close to failure was that?" is a question this exercise asks.
 *
 * The rehab protocol prescribes no RIR — ankle work is deliberately not taken
 * near failure — so asking for it would clutter the logger and, worse, stall
 * progression forever waiting on a number nobody is ever going to record.
 */
export function judgesRir(exercise: Exercise): boolean {
	return !(exercise.isAnkle && exercise.rir === null);
}

export function decideProgression(
	input: ProgressionInput,
): ProgressionDecision {
	const { exercise, targetRir, targetSets } = input;
	const working = input.lastSets.filter((set) => !set.isWarmup);

	// Warning signs come first: nothing below may raise load past them.
	const safety = evaluateSafety({
		...input.safety,
		pain: input.safety?.pain ?? worstPain(working.map((set) => set.anklePain)),
	});
	if (exercise.isAnkle && safety.blocked) {
		return { kind: "blocked", signals: safety.signals };
	}

	// Timed holds, cardio and freeform drills progress by their written rule
	// ("menos oscilación", "subir 5 min según tolerancia"), not by arithmetic.
	const repRange = repRangeOf(exercise);
	if (repRange === null) return { kind: "qualitative" };

	if (working.length === 0) {
		if (exercise.load.needsCalibration) return { kind: "calibrate" };
		return {
			kind: "start",
			loadKg: exercise.load.startKg,
			perSide: exercise.load.perSide,
		};
	}

	const perSide = exercise.load.perSide;
	const workingLoad = workingLoadOf(working, repRange);

	if (targetSets !== null && working.length < targetSets.min) {
		return {
			kind: "hold",
			loadKg: workingLoad,
			perSide,
			reason: "setsIncomplete",
		};
	}

	// Every working set must reach the top of the range — "12/10 → mantener".
	const allSetsAtTop = working.every((set) => (set.reps ?? 0) >= repRange.max);
	if (!allSetsAtTop) {
		return {
			kind: "hold",
			loadKg: workingLoad,
			perSide,
			reason: "repsBelowTop",
		};
	}

	// …and with reps still in reserve — "25 kg: 8 reps muy exigentes → todavía no".
	const judged = working.filter((set) => set.rir !== null);
	if (judged.length === 0 && judgesRir(exercise)) {
		return { kind: "hold", loadKg: workingLoad, perSide, reason: "rirUnknown" };
	}
	const allRirOk = judged.every((set) => (set.rir ?? 0) >= targetRir.min);
	if (!allRirOk) {
		return { kind: "hold", loadKg: workingLoad, perSide, reason: "rirTooLow" };
	}

	// Bodyweight movements have no load to add: make them harder instead.
	if (exercise.load.bodyweight || workingLoad === null) {
		return { kind: "advanceDifficulty" };
	}

	const incrementKg = exercise.load.incrementKg ?? DEFAULT_INCREMENT_KG;
	return {
		kind: "increase",
		fromKg: workingLoad,
		toKg: round(workingLoad + incrementKg),
		incrementKg,
		perSide,
	};
}

/** Rep range of a target, or null when the exercise is not measured in reps. */
export function repRangeOf(exercise: Exercise): Range | null {
	const { target } = exercise;
	if (target.kind === "reps" || target.kind === "repsPerSide") {
		return { min: target.min, max: target.max };
	}
	return null;
}

/**
 * The load you are actually working at — the heaviest one where you still made
 * the bottom of the rep range.
 *
 * Not simply the heaviest load touched. From the spreadsheet: 20 kg × 12 then
 * 25 kg × 8 is a session whose working weight is 20, and its own note says so —
 * "25 kg: 8 reps muy exigentes → todavía no es peso de trabajo". Taking the max
 * would tell you to keep training at a weight you could not complete.
 *
 * When no set reached the range, nothing qualified as working weight, so it
 * falls back to the lightest load tried rather than endorsing the heaviest.
 */
function workingLoadOf(
	sets: readonly SetRecord[],
	repRange: Range,
): number | null {
	const loaded = sets
		.filter((set) => set.unit === "kg" && typeof set.load === "number")
		.map((set) => ({ load: set.load as number, reps: set.reps }));
	if (loaded.length === 0) return null;

	const completed = loaded.filter((set) => (set.reps ?? 0) >= repRange.min);
	const candidates = completed.length > 0 ? completed : loaded;

	return completed.length > 0
		? Math.max(...candidates.map((set) => set.load))
		: Math.min(...candidates.map((set) => set.load));
}

/** Loads land on half-kilos; floating point should not leak into the UI. */
function round(value: number): number {
	return Math.round(value * 100) / 100;
}
