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
 * way an older client cannot read — E2 turned `SessionRecord.phase` from a number
 * into a string, so it went from 1 to 2.
 */
export const SYNC_SCHEMA_VERSION = 2;

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

/**
 * A client that sends no version at all is a client from before versions existed.
 */
export function clientVersionOf(body: { schemaVersion?: unknown }): number {
	return typeof body.schemaVersion === "number" ? body.schemaVersion : 1;
}
