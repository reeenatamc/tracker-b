/**
 * Which phase of the program a given day falls in, and what that phase asks for.
 *
 * Dates are compared as `YYYY-MM-DD` strings. That ordering is lexicographic and
 * therefore chronological, which sidesteps every timezone bug a Date object
 * would introduce for what is really just a calendar day.
 */

import type { Phase, Program, Range, SetCount } from "./schema";

/**
 * The phase in force on a date now comes from the event log, not from a range of
 * dates written in the plan — see `phase-events.ts`. What is left here is
 * everything that reads *from* a phase once you know which one you are in.
 *
 * `phaseForDate` is re-exported so the many call sites do not all have to learn a
 * new import path for what is, to them, the same question as before.
 */
export { phaseByIdOrNull, phaseForDate } from "./phase-events";

/**
 * The phase a session belongs to is the one stamped on it. Never derived.
 *
 * This is the whole of G1 in one function. A session is a thing that happened, and
 * correcting the log later is allowed to change what the log says about that date
 * — but not what that session was. Re-stamping is a separate, explicit decision.
 *
 * Returns null rather than throwing when the stored id no longer resolves: a
 * renamed phase should not make the history unopenable.
 */
export function phaseOfSession(
	program: Program,
	session: { phase: string },
): Phase | null {
	return program.phases.find((phase) => phase.id === session.phase) ?? null;
}

/*
 * A bridge used to live here that let a phase index a column of the imported
 * prescription, so E2 could move phases without touching what they prescribed.
 * E3 replaced that column with a baseline plus an adjustment log, and the bridge
 * went with it: a phase now gates adjustments and indexes nothing. The last
 * reader of the old column is the migration, and only the migration — see
 * `lib/migrate-prescription.ts` and `adjustments.ts`.
 */

export function phaseById(program: Program, id: string): Phase {
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

/** Reps in reserve to leave on working sets, per the phase. */
export function targetRir(phase: Phase): Range {
	return phase.targetRir;
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
