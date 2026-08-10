/**
 * Reading the log: what you did today, and what you did last time.
 *
 * "Last time" is the whole point of the set logger, so it is defined precisely:
 * the most recent *other* session that actually contains this exercise. It skips
 * sessions where the exercise was programmed but never logged, and it follows
 * the canonical exercise id, so Monday's "Elevación de talón" finds Wednesday's
 * "Calf raise".
 */

import type { SessionRecord, SetRecord } from "./schema";

export type PreviousPerformance = {
	date: string;
	sessionId: string;
	sets: SetRecord[];
};

/** Sets logged for one exercise within one session, in order. */
export function setsFor(
	sets: readonly SetRecord[],
	sessionId: string,
	exerciseId: string,
): SetRecord[] {
	return sets
		.filter(
			(set) => set.sessionId === sessionId && set.exerciseId === exerciseId,
		)
		.sort((a, b) => a.setNumber - b.setNumber);
}

/** The most recent earlier session that logged this exercise, if any. */
export function previousPerformance(
	sets: readonly SetRecord[],
	sessions: readonly SessionRecord[],
	exerciseId: string,
	currentSessionId: string | null,
): PreviousPerformance | null {
	const byDateDesc = [...sessions]
		.filter((session) => session.id !== currentSessionId)
		.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

	for (const session of byDateDesc) {
		const logged = setsFor(sets, session.id, exerciseId);
		if (logged.length > 0) {
			return { date: session.date, sessionId: session.id, sets: logged };
		}
	}
	return null;
}

/** Sessions on a given calendar day. */
export function sessionsOn(
	sessions: readonly SessionRecord[],
	date: string,
): SessionRecord[] {
	return sessions.filter((session) => session.date === date);
}

/** How many of a session's exercises have at least one logged set. */
export function completedExerciseIds(
	sets: readonly SetRecord[],
	sessionId: string,
): ReadonlySet<string> {
	const ids = new Set<string>();
	for (const set of sets) {
		if (set.sessionId === sessionId && !set.isWarmup) ids.add(set.exerciseId);
	}
	return ids;
}
