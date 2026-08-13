/**
 * Merging two devices' copies of the log.
 *
 * Last write wins, per record, by `updatedAt`. That is the right rule here and
 * not a shortcut: there is one person, and two devices are never editing the
 * same set at the same moment. What actually happens is that the phone logs at
 * the gym while the laptop is asleep, and the laptop reviews on Saturday while
 * the phone is in a pocket. Nothing to reconcile — just whichever copy is newer.
 *
 * Deletes are records too. A row that only existed on the phone and was deleted
 * there has to carry that deletion across, so deleting stamps `deletedAt` rather
 * than removing the row; the UI filters them out and sync ships them like any
 * other change.
 *
 * Ties go to the incoming record. A tie means both sides stamped the same
 * millisecond, which in practice means they are the same write echoed back.
 */

export type SyncRecord = {
	id: string;
	updatedAt: number;
	deletedAt: number | null;
};

export type MergeResult<T> = {
	/** The merged set, ready to write locally. */
	merged: T[];
	/** Incoming records that won and must be applied. */
	toApply: T[];
	/** Local records the other side has not seen, or has an older copy of. */
	toPush: T[];
};

export function mergeRecords<T extends SyncRecord>(
	local: readonly T[],
	incoming: readonly T[],
): MergeResult<T> {
	const byId = new Map<string, T>();
	for (const record of local) byId.set(record.id, record);

	const toApply: T[] = [];
	const seen = new Set<string>();

	for (const record of incoming) {
		seen.add(record.id);
		const mine = byId.get(record.id);
		if (!mine || record.updatedAt >= mine.updatedAt) {
			byId.set(record.id, record);
			// Applying an identical copy is wasted work, not a correctness problem.
			if (!mine || record.updatedAt > mine.updatedAt) toApply.push(record);
		}
	}

	const toPush = local.filter((record) => {
		const theirs = incoming.find((candidate) => candidate.id === record.id);
		return !theirs || record.updatedAt > theirs.updatedAt;
	});

	return { merged: [...byId.values()], toApply, toPush };
}

/** Records the other side has not seen since `since`. */
export function changedSince<T extends SyncRecord>(
	records: readonly T[],
	since: number,
): T[] {
	return records.filter((record) => record.updatedAt > since);
}

/** Live records — what the app shows. Deleted rows stay for sync but not for you. */
export function visible<T extends SyncRecord>(records: readonly T[]): T[] {
	return records.filter((record) => record.deletedAt === null);
}

/**
 * The high-water mark to send next time. Taken from the records themselves
 * rather than the local clock: two devices' clocks disagree, and asking "what
 * is newer than the newest thing I have" is true regardless of whose clock it is.
 */
export function highWaterMark(
	records: readonly SyncRecord[],
	previous = 0,
): number {
	return records.reduce(
		(max, record) => Math.max(max, record.updatedAt),
		previous,
	);
}

// ------------------------------------------------------- schema compatibility

/**
 * The shape of the data being exchanged. Bumped when a stored record changes in a
 * way an older client cannot read. E2 turned `SessionRecord.phase` from a number
 * into a string (1 → 2); E3 added the prescription contract every session needs
 * (2 → 3).
 *
 * It is stamped on every row as well as sent with the exchange, because a reader
 * needs to know what a *record* was written under, not just what the peer is
 * running now.
 */
export const SYNC_SCHEMA_VERSION = 4;

export type VersionVerdict =
	| { ok: true }
	/** The server holds data newer than this client knows how to read. */
	| { ok: false; reason: "client-outdated"; required: number }
	/** This client brings newer data; the server moves up to meet it. */
	| { ok: false; reason: "server-outdated"; clientVersion: number };

/**
 * Whether a client may sync, in either direction.
 *
 * The tempting alternative was to assume an older client would cope with an
 * unfamiliar value — that stored records happen not to be validated on the way in
 * is true today, but it is an implementation detail rather than a promise, and
 * leaning on it means writing data into a database that that version cannot read.
 *
 * A device that cannot sync for a few days is an inconvenience. A log full of
 * records a version does not understand is damage. So an outdated client is turned
 * away, in both directions, and told to update — and it keeps logging locally in
 * the meantime, which this app has never needed the network for.
 */
export function checkSchemaVersion(
	clientVersion: number,
	serverVersion: number,
): VersionVerdict {
	if (clientVersion < serverVersion) {
		return { ok: false, reason: "client-outdated", required: serverVersion };
	}
	if (clientVersion > serverVersion) {
		return { ok: false, reason: "server-outdated", clientVersion };
	}
	return { ok: true };
}

// ------------------------------------------------------- classifying a failure

/**
 * What went wrong with an exchange, decided by the HTTP status alone.
 *
 * `unconfigured` and `error` are opposite advice — one says everything is fine
 * and works locally, the other says something is broken and worth retrying — so
 * telling them apart correctly is the whole point of this function.
 */
export type SyncFailure =
	/** No endpoint here at all. The app works; there is just nowhere to sync to. */
	| { kind: "unconfigured" }
	/** The server holds data this client cannot read. */
	| { kind: "outdated" }
	/** Reached the server and it said no, or said something unexpected. */
	| { kind: "error" }
	/** Never reached anything, and the device knows it is not connected. */
	| { kind: "offline" };

/**
 * The status decides; the body only ever explains.
 *
 * This used to be the other way round: the response was turned into an
 * `Error(string)` at the point of failure and classified later by looking for
 * `"404"` **inside the message**. Which meant a 500 whose body happened to
 * mention 404 read as "there is no sync here", and a real 404 whose body was
 * JSON read as a sync failure — because the JSON branch replaced the message
 * with the body's `error` field, and that text has no status in it. It worked in
 * practice only because the dev server answered 404 with HTML.
 *
 * `status: null` means `fetch` rejected without ever producing a response: DNS,
 * connection refused, a server that is not running. That is not a 404 — nothing
 * answered at all — and calling it one would tell someone their app has no sync
 * because their wifi dropped.
 */
export function classifyFailure(input: {
	/** The HTTP status, or null when there was no response at all. */
	status: number | null;
	online: boolean;
}): SyncFailure {
	if (input.status === null) {
		return input.online ? { kind: "error" } : { kind: "offline" };
	}
	if (input.status === 404) return { kind: "unconfigured" };
	if (input.status === 409) return { kind: "outdated" };
	return { kind: "error" };
}

/**
 * A client that sends no version at all is a client from before versions existed.
 */
export function clientVersionOf(body: { schemaVersion?: unknown }): number {
	return typeof body.schemaVersion === "number" ? body.schemaVersion : 1;
}

/**
 * One request's turn at the version row, as the endpoint takes it.
 *
 * The endpoint runs the read, the decision and the write inside one transaction
 * holding `sync_meta` `for update`, so concurrent requests take their turns in
 * some order rather than interleaving. This is that turn, as a function — which
 * makes the ordering property testable without a live database: whatever order
 * the lock happens to grant, applying these in sequence must never let an
 * outdated client write after an upgrade.
 */
export type SyncTurn =
	| { admitted: true; serverVersion: number }
	| { admitted: false; required: number; serverVersion: number };

export function takeTurn(
	clientVersion: number,
	serverVersion: number,
): SyncTurn {
	const verdict = checkSchemaVersion(clientVersion, serverVersion);

	if (!verdict.ok && verdict.reason === "client-outdated") {
		// Turned away before writing anything, and the version is left alone.
		return { admitted: false, required: verdict.required, serverVersion };
	}

	// A client ahead of the server raises it; one in step leaves it as it is.
	const next = !verdict.ok ? verdict.clientVersion : serverVersion;
	return { admitted: true, serverVersion: next };
}
