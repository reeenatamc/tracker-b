/**
 * The three writes that hang off a session, out of the component.
 *
 * They lived inline in `routes/index.tsx` and all three were broken the same
 * way: `ensureSession()` returns `{ id, persisted }`, and they passed the whole
 * object where the row key goes. The compiler did not catch it because the key
 * parameter of `update` is permissive, so at runtime the lookup matched nothing
 * and the write silently did not happen — starting a session left `startedAt`
 * null, skipping an exercise did not stick, and an exercise you added was never
 * attached to the session.
 *
 * Moving them here is the actual fix. Each takes `sessionId: string`, so passing
 * the wrapper is a type error rather than a shrug, and each is callable from a
 * test without a browser. Every one returns its transaction, because T-001 says
 * a write is not saved until the caller has waited for the disk.
 */

import type { Collections } from "@/db/collections";

type Transaction = ReturnType<Collections["sessions"]["update"]>;

/** Stamps the start, once. A session already under way keeps its own time. */
export function startSession(
	collections: Collections,
	sessionId: string,
	now: number,
): Transaction {
	return collections.sessions.update(sessionId, (draft) => {
		draft.startedAt ??= now;
	});
}

/** Not doing it today. A deviation on the session; the plan is untouched. */
export function skipExercise(
	collections: Collections,
	sessionId: string,
	exerciseId: string,
): Transaction {
	return collections.sessions.update(sessionId, (draft) => {
		draft.skippedExerciseIds = [
			...new Set([...draft.skippedExerciseIds, exerciseId]),
		];
	});
}

/** Putting back one you skipped. */
export function restoreExercise(
	collections: Collections,
	sessionId: string,
	exerciseId: string,
): Transaction {
	return collections.sessions.update(sessionId, (draft) => {
		draft.skippedExerciseIds = draft.skippedExerciseIds.filter(
			(id) => id !== exerciseId,
		);
	});
}

/** An exercise pulled into today's session. Also a deviation, not a plan change. */
export function addToSession(
	collections: Collections,
	sessionId: string,
	exerciseId: string,
): Transaction {
	return collections.sessions.update(sessionId, (draft) => {
		draft.extraExerciseIds = [
			...new Set([...draft.extraExerciseIds, exerciseId]),
		];
	});
}
