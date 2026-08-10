/**
 * Evidence that the work is going somewhere.
 *
 * Every number here is derived from what was actually logged. Nothing is
 * estimated, smoothed or rounded up to look better: a progress screen that
 * flatters you is worse than no progress screen, because after three weeks you
 * stop believing any of it — and then you stop believing the parts that matter,
 * like the ankle telling you to hold.
 *
 * When there is not enough logged to say something true, the answer is an empty
 * list rather than an encouraging guess.
 */

import { setsFor } from "./history";
import { phaseForDate, weeksUntilCheckpoint } from "./phases";
import { startOfWeek } from "./schedule";
import type { Program, SessionRecord, SetRecord } from "./schema";

export type LoadGain = {
	exerciseId: string;
	from: number;
	to: number;
	unit: "kg" | "seconds" | "reps";
	perSide: boolean;
};

export type Progress = {
	/** 1-based, counting from the program's start date. */
	week: number;
	totalWeeks: number;
	weeksToCheckpoint: number;
	phaseId: 1 | 2 | 3 | 4;
	phaseName: string;
	sessionsThisWeek: number;
	sessionsTarget: number;
	totalSessions: number;
	/** Exercises whose working load is higher now than the first time logged. */
	gains: LoadGain[];
};

const WEEKLY_STRENGTH_TARGET = 3;

export function summarise(
	program: Program,
	sessions: readonly SessionRecord[],
	sets: readonly SetRecord[],
	today: string,
): Progress {
	const phase = phaseForDate(program, today);
	const weekStart = startOfWeek(today);

	const completed = sessions.filter((session) =>
		sets.some((set) => set.sessionId === session.id),
	);

	return {
		week: weekNumber(program.meta.startDate, today),
		totalWeeks: totalWeeks(program.meta.startDate, program.meta.checkpointDate),
		weeksToCheckpoint: weeksUntilCheckpoint(program, today),
		phaseId: phase.id,
		phaseName: phase.name,
		sessionsThisWeek: completed.filter((session) => session.date >= weekStart)
			.length,
		sessionsTarget: WEEKLY_STRENGTH_TARGET,
		totalSessions: completed.length,
		gains: loadGains(sessions, sets),
	};
}

/** Week 1 is the week the program started, not the first full calendar week. */
export function weekNumber(startDate: string, today: string): number {
	const days = Math.floor(
		(Date.parse(`${today}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) /
			86_400_000,
	);
	return Math.max(1, Math.floor(days / 7) + 1);
}

function totalWeeks(startDate: string, checkpointDate: string): number {
	const days = Math.round(
		(Date.parse(`${checkpointDate}T12:00:00Z`) -
			Date.parse(`${startDate}T12:00:00Z`)) /
			86_400_000,
	);
	return Math.max(1, Math.round(days / 7));
}

/**
 * Per exercise: the first working load ever logged against the most recent one.
 *
 * Only counts an exercise logged on at least two different days — a single
 * session's warm-up ramp would otherwise read as progress, when it is just
 * finding the weight.
 */
export function loadGains(
	sessions: readonly SessionRecord[],
	sets: readonly SetRecord[],
): LoadGain[] {
	const dateOf = new Map(sessions.map((session) => [session.id, session.date]));
	const byExercise = new Map<
		string,
		Array<{ date: string; value: number; unit: LoadGain["unit"] }>
	>();

	for (const set of sets) {
		if (set.isWarmup) continue;
		const date = dateOf.get(set.sessionId);
		if (!date) continue;

		const measure = measureOf(set);
		if (measure === null) continue;

		const list = byExercise.get(set.exerciseId) ?? [];
		list.push({ date, ...measure });
		byExercise.set(set.exerciseId, list);
	}

	const gains: LoadGain[] = [];

	for (const [exerciseId, entries] of byExercise) {
		const days = new Set(entries.map((entry) => entry.date));
		if (days.size < 2) continue;

		const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
		const firstDay = sorted[0].date;
		const lastDay = sorted[sorted.length - 1].date;

		// Best of the first day against best of the latest, so one bad set in an
		// otherwise good session cannot read as a regression.
		const from = Math.max(
			...sorted.filter((e) => e.date === firstDay).map((e) => e.value),
		);
		const to = Math.max(
			...sorted.filter((e) => e.date === lastDay).map((e) => e.value),
		);

		if (to > from) {
			gains.push({
				exerciseId,
				from,
				to,
				unit: sorted[0].unit,
				perSide: false,
			});
		}
	}

	return gains.sort((a, b) => b.to / b.from - a.to / a.from);
}

/**
 * What "more" means for this set. Loaded work compares kilos; bodyweight and
 * timed work compare the reps or seconds held, which is the only thing that can
 * go up when there is no weight to add.
 */
function measureOf(
	set: SetRecord,
): { value: number; unit: LoadGain["unit"] } | null {
	if (set.unit === "kg" && typeof set.load === "number" && set.load > 0) {
		return { value: set.load, unit: "kg" };
	}
	if (set.unit === "seconds" && typeof set.reps === "number") {
		return { value: set.reps, unit: "seconds" };
	}
	if (set.unit === "bodyweight" && typeof set.reps === "number") {
		return { value: set.reps, unit: "reps" };
	}
	return null;
}

/** Working sets logged for a session, for the completion summary. */
export function sessionVolume(
	sets: readonly SetRecord[],
	sessionId: string,
): number {
	return sets
		.filter(
			(set) =>
				set.sessionId === sessionId && !set.isWarmup && set.unit === "kg",
		)
		.reduce((total, set) => total + (set.load ?? 0) * (set.reps ?? 0), 0);
}

export { setsFor };

export type PersonalRecord = {
	exerciseId: string;
	value: number;
	previous: number;
	unit: LoadGain["unit"];
};

/**
 * What this session beat.
 *
 * The single most motivating thing a lifting app shows, and the reason Hevy and
 * Strong both put it front and centre: a stat tells you what happened, a record
 * tells you it has never happened before.
 *
 * Strictly greater than every earlier session, so matching a previous best is
 * not a record — that would make "record" mean "showed up", and the word would
 * stop meaning anything by week three.
 */
export function personalRecords(
	sessions: readonly SessionRecord[],
	sets: readonly SetRecord[],
	sessionId: string,
): PersonalRecord[] {
	const dateOf = new Map(sessions.map((session) => [session.id, session.date]));
	const today = dateOf.get(sessionId);
	if (!today) return [];

	const records: PersonalRecord[] = [];
	const todaysExercises = new Set(
		sets
			.filter((set) => set.sessionId === sessionId && !set.isWarmup)
			.map((s) => s.exerciseId),
	);

	for (const exerciseId of todaysExercises) {
		const best = (predicate: (set: SetRecord) => boolean) =>
			sets
				.filter(
					(set) =>
						set.exerciseId === exerciseId && !set.isWarmup && predicate(set),
				)
				.map(measureOf)
				.filter(
					(m): m is { value: number; unit: LoadGain["unit"] } => m !== null,
				);

		const todayBest = best((set) => set.sessionId === sessionId);
		// Earlier sessions only — a set from later today is not "previous".
		const earlierBest = best((set) => {
			const date = dateOf.get(set.sessionId);
			return set.sessionId !== sessionId && date !== undefined && date < today;
		});

		if (todayBest.length === 0 || earlierBest.length === 0) continue;

		const value = Math.max(...todayBest.map((m) => m.value));
		const previous = Math.max(...earlierBest.map((m) => m.value));
		if (value > previous) {
			records.push({ exerciseId, value, previous, unit: todayBest[0].unit });
		}
	}

	return records.sort((a, b) => b.value / b.previous - a.value / a.previous);
}

/**
 * How long the session took, in minutes, from the first set logged to the last.
 *
 * Null for sessions logged before writes were timestamped, and for a session
 * with a single set — one moment is not a duration.
 */
export function sessionMinutes(
	sets: readonly SetRecord[],
	sessionId: string,
): number | null {
	const stamps = sets
		.filter((set) => set.sessionId === sessionId)
		.map((set) => (set as { updatedAt?: number }).updatedAt)
		.filter((stamp): stamp is number => typeof stamp === "number" && stamp > 0);

	if (stamps.length < 2) return null;
	const minutes = Math.round(
		(Math.max(...stamps) - Math.min(...stamps)) / 60_000,
	);
	return minutes > 0 ? minutes : null;
}

/**
 * Volume against the last time this same session was done, as a percentage.
 * Null when there is nothing to compare against.
 */
export function volumeChange(
	sessions: readonly SessionRecord[],
	sets: readonly SetRecord[],
	sessionId: string,
): number | null {
	const current = sessions.find((session) => session.id === sessionId);
	if (!current) return null;

	const previous = sessions
		.filter(
			(session) =>
				session.templateId === current.templateId &&
				session.date < current.date &&
				sessionVolume(sets, session.id) > 0,
		)
		.sort((a, b) => b.date.localeCompare(a.date))[0];

	if (!previous) return null;

	const before = sessionVolume(sets, previous.id);
	const now = sessionVolume(sets, sessionId);
	if (before === 0 || now === 0) return null;

	return Math.round(((now - before) / before) * 100);
}

/**
 * Consecutive weeks, ending with this one, that met the strength target.
 *
 * Counted backwards from the current week and stopping at the first miss, which
 * is what makes a streak worth protecting. The current week counts as soon as it
 * hits the target — it is not held back for being unfinished.
 */
export function weekStreak(
	sessions: readonly SessionRecord[],
	sets: readonly SetRecord[],
	today: string,
): number {
	const logged = sessions.filter((session) =>
		sets.some((set) => set.sessionId === session.id && !set.isWarmup),
	);

	let streak = 0;
	for (let back = 0; back < 60; back++) {
		const weekStart = shiftWeeks(startOfWeek(today), -back);
		const weekEnd = shiftWeeks(weekStart, 1);
		const count = logged.filter(
			(session) => session.date >= weekStart && session.date < weekEnd,
		).length;

		if (count >= WEEKLY_STRENGTH_TARGET) streak++;
		else break;
	}
	return streak;
}

function shiftWeeks(date: string, weeks: number): string {
	const shifted = new Date(`${date}T12:00:00Z`);
	shifted.setUTCDate(shifted.getUTCDate() + weeks * 7);
	return shifted.toISOString().slice(0, 10);
}
