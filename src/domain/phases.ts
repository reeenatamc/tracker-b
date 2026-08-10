/**
 * Which phase of the program a given day falls in, and what that phase asks for.
 *
 * Dates are compared as `YYYY-MM-DD` strings. That ordering is lexicographic and
 * therefore chronological, which sidesteps every timezone bug a Date object
 * would introduce for what is really just a calendar day.
 */

import type {
	Exercise,
	Phase,
	PhaseId,
	Program,
	Range,
	SetCount,
} from "./schema";

/**
 * The phase covering `date`, clamped at both ends: days before the program
 * starts read as phase 1, days past the last phase read as the last phase.
 * Clamping matters because the baseline session predates phase 1 by two days.
 */
export function phaseForDate(program: Program, date: string): Phase {
	const phases = [...program.phases].sort((a, b) =>
		a.startDate.localeCompare(b.startDate),
	);
	const first = phases[0];
	const last = phases[phases.length - 1];

	if (date < first.startDate) return first;

	for (const phase of phases) {
		const startsBy = phase.startDate <= date;
		const endsAfter = phase.endDate === null || date <= phase.endDate;
		if (startsBy && endsAfter) return phase;
	}

	return last;
}

export function phaseById(program: Program, id: PhaseId): Phase {
	const phase = program.phases.find((candidate) => candidate.id === id);
	if (!phase) throw new Error(`Unknown phase: ${id}`);
	return phase;
}

/** Normalises "2", "2–3" and "not programmed" into one comparable shape. */
export function resolveSetCount(count: SetCount): Range | null {
	if (count === null) return null;
	if (typeof count === "number") return { min: count, max: count };
	return { min: count[0], max: count[1] };
}

/** How many working sets this exercise gets in this phase. */
export function targetSets(exercise: Exercise, phase: PhaseId): Range | null {
	return resolveSetCount(exercise.setsByPhase[phase]);
}

/** Reps in reserve to leave on working sets, per the phase. */
export function targetRir(program: Program, phase: PhaseId): Range {
	return phaseById(program, phase).targetRir;
}

/** Exercises programmed for this phase, in order. Skips those not yet introduced. */
export function exercisesForPhase(
	exercises: readonly Exercise[],
	phase: PhaseId,
): Exercise[] {
	return exercises
		.filter((exercise) => targetSets(exercise, phase) !== null)
		.sort((a, b) => a.order - b.order);
}

/** Whole weeks left until the checkpoint, floored at zero. */
export function weeksUntilCheckpoint(program: Program, today: string): number {
	const days = daysBetween(today, program.meta.checkpointDate);
	return Math.max(0, Math.floor(days / 7));
}

export function daysBetween(from: string, to: string): number {
	return Math.round(
		(Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
			86_400_000,
	);
}
