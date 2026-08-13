/**
 * Keeping two devices in step.
 *
 * Local first, always: every write lands in SQLite and the screen updates before
 * the network is consulted. Sync is something that happens afterwards, and its
 * failure is never something you feel mid-set — the gym has bad wifi and the app
 * has to behave as if there is none.
 *
 * It runs when the app opens, when it comes back to the foreground, when the
 * connection returns, and on a debounce after you write something. That covers
 * the real pattern: log on the phone, close it, open the laptop on Saturday.
 *
 * Photos are not synced. They are files, sometimes hundreds of megabytes of
 * them, and shipping them through a JSON endpoint would be the wrong mechanism;
 * they stay on the device that took them and travel in the backup file instead.
 */

import type { Collections } from "@/db/collections";
import { applyRemote, stampTransport } from "@/db/synced";
import {
	SYNCED_COLLECTIONS,
	type SyncedCollection,
} from "@/domain/collection-policy";
import { highWaterMark, SYNC_SCHEMA_VERSION } from "@/domain/sync";
import { program } from "@/lib/content";
import { normalizeIncoming } from "@/lib/migrate-phase-ids";

const ENDPOINT = "/api/sync";
const MARK_KEY = "operacion-tesis:sync-mark";
const DEBOUNCE_MS = 4000;

type CollectionKey = SyncedCollection;

type Change = {
	collection: CollectionKey;
	id: string;
	updatedAt: number;
	deletedAt: number | null;
	data: Record<string, unknown>;
};

export type SyncState =
	| { status: "idle"; lastSyncedAt: number | null }
	| { status: "syncing" }
	| { status: "offline"; lastSyncedAt: number | null }
	| { status: "error"; message: string; lastSyncedAt: number | null }
	/** No database connected yet — everything still works, just locally. */
	| { status: "unconfigured" };

type Row = Record<string, unknown> & {
	id: string;
	updatedAt?: number;
	deletedAt?: number | null;
};

/**
 * The stamp a row written before sync existed travels under.
 *
 * It has to be greater than zero. The cursor on both sides is "strictly newer
 * than what I have", and a device that has never synced asks for everything
 * newer than 0 — so a row sent as 0 is stored as 0 and then never comes back out
 * for anybody. That is the bug this constant exists to close: the old code read
 * an absent timestamp as 0 and pushed on `updatedAt > mark`, which for a fresh
 * device is `0 > 0`, so those rows were not pushed once, as the comment claimed.
 * They were never pushed at all.
 *
 * One millisecond after the epoch is the smallest value that travels, and it
 * loses every comparison against a real edit — which is the property the old
 * comment wanted: these rows carry no opinion, they just have to arrive.
 */
export const LEGACY_STAMP = 1;

/** A row is owed its first push while it carries no timestamp of its own. */
function awaitingFirstPush(row: Row): boolean {
	return row.updatedAt === undefined || row.updatedAt === null;
}

function stampOf(row: Row): { updatedAt: number; deletedAt: number | null } {
	return {
		updatedAt: awaitingFirstPush(row)
			? LEGACY_STAMP
			: (row.updatedAt as number),
		deletedAt: row.deletedAt ?? null,
	};
}

export function createSyncClient(
	collections: Collections,
	onState: (state: SyncState) => void,
	/**
	 * Runs after a pull that landed, with how many rows arrived.
	 *
	 * A pull can bring in a phase this device has never seen, and a phase that
	 * declares `inheritsFrom` has to have that inheritance written down before
	 * anything reads its prescription. Startup is one door into that
	 * reconciliation; this is the other, and it is idempotent so both lead to the
	 * same place.
	 */
	onPulled: (received: number) => void = () => {},
) {
	let mark = Number(localStorage.getItem(MARK_KEY) ?? 0);
	let lastSyncedAt: number | null = null;
	let running = false;
	let queued = false;
	let timer: ReturnType<typeof setTimeout> | null = null;

	async function syncOnce(): Promise<void> {
		if (running) {
			// Collapse concurrent triggers into one follow-up run.
			queued = true;
			return;
		}
		if (!navigator.onLine) {
			onState({ status: "offline", lastSyncedAt });
			return;
		}

		running = true;
		onState({ status: "syncing" });

		try {
			const changes: Change[] = [];
			/*
			 * Which rows were sent only because they had never been stamped. They
			 * are marked as accepted after the exchange lands, and not before: a
			 * push that fails has to leave them owed.
			 */
			const firstPush: Array<{ key: CollectionKey; id: string }> = [];

			for (const key of SYNCED_COLLECTIONS) {
				for (const row of collections.raw[key].toArray as unknown as Row[]) {
					const { updatedAt, deletedAt } = stampOf(row);
					const owed = awaitingFirstPush(row);

					// An unstamped row is owed its first push whatever the mark says.
					// Comparing it against the cursor is what used to lose it: the row
					// is not "older than the last sync", it has never been in one.
					if (!owed && updatedAt <= mark) continue;

					changes.push({
						collection: key,
						id: row.id,
						updatedAt,
						deletedAt,
						data: row,
					});
					if (owed) firstPush.push({ key, id: row.id });
				}
			}

			const response = await fetch(ENDPOINT, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					since: mark,
					changes,
					schemaVersion: SYNC_SCHEMA_VERSION,
				}),
			});

			// An outdated client is turned away rather than allowed to write records
			// this version cannot read. Losing sync for a day is an inconvenience;
			// a log full of values a version does not understand is damage.
			if (response.status === 409) {
				const body = (await response.json().catch(() => ({}))) as {
					error?: string;
				};
				if (body.error === "client-outdated") {
					throw new Error(
						"Actualiza este dispositivo para sincronizar: los datos del servidor son más nuevos.",
					);
				}
			}

			if (!response.ok) {
				const reason = await response
					.clone()
					.json()
					.then((body: { error?: string }) => body.error)
					.catch(() => undefined);
				if (reason) throw new Error(reason);
				// Behind Deployment Protection an expired session answers with the
				// login page instead of JSON; saying so beats "unexpected token <".
				const detail =
					response.status === 401 || response.status === 403
						? "Tu sesión de Vercel caducó. Abre la app de nuevo para reconectar."
						: `El servidor respondió ${response.status}.`;
				throw new Error(detail);
			}

			const body = (await response.json()) as { changes?: Change[] };
			const incoming = body.changes ?? [];

			for (const change of incoming) {
				if (!SYNCED_COLLECTIONS.includes(change.collection)) continue;

				// Normalised on the way in. A device that has migrated can still be
				// sent an old session by one that has not, and translating here means
				// the half-named half-numbered state never exists rather than being
				// cleaned up after the fact.
				const [data] = normalizeIncoming(program, change.collection, [
					change.data,
				]).rows;

				// Written through `raw` so the stamping proxy does not touch it: a
				// re-stamped pull would look like a local edit and bounce back.
				applyRemote(collections.raw[change.collection], change.id, {
					...data,
					updatedAt: change.updatedAt,
					deletedAt: change.deletedAt,
				});
			}

			/*
			 * The server took them, so they are no longer owed a first push.
			 *
			 * Recorded on the row rather than in a list beside it, because the row
			 * is what a restore brings back: a device that imports an old backup
			 * next year gets rows that are once again unstamped, and they should be
			 * owed a push again — which is exactly what happens.
			 *
			 * `updatedAt` is transport, not a fact about training, and this writes
			 * only that. Through `raw`, the same door incoming records come in by,
			 * so an append-only collection is not asked to permit an edit it is
			 * right to refuse.
			 */
			for (const { key, id } of firstPush) {
				stampTransport(collections.raw[key], id, LEGACY_STAMP);
			}

			// The mark comes from the records themselves, never the local clock —
			// two devices' clocks disagree, and "newer than the newest I hold" is
			// true whichever clock stamped it.
			mark = highWaterMark(
				[...incoming, ...changes].map((change) => ({
					id: change.id,
					updatedAt: change.updatedAt,
					deletedAt: change.deletedAt,
				})),
				mark,
			);
			localStorage.setItem(MARK_KEY, String(mark));

			lastSyncedAt = Date.now();
			// Before the state goes idle: a screen that re-renders on "idle" should
			// already be looking at a reconciled plan, not at one mid-repair.
			onPulled(incoming.length);
			onState({ status: "idle", lastSyncedAt });
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "No se pudo sincronizar.";
			// A 404 means there is no endpoint here at all — the dev server, or a
			// build deployed before sync existed. Neither is a failure to report.
			if (message.includes("DATABASE_URL") || message.includes("404")) {
				onState({ status: "unconfigured" });
			} else {
				onState(
					navigator.onLine
						? { status: "error", message, lastSyncedAt }
						: { status: "offline", lastSyncedAt },
				);
			}
		} finally {
			running = false;
			if (queued) {
				queued = false;
				void syncOnce();
			}
		}
	}

	/** Waits for the writing to stop, so a whole session is one round trip. */
	function schedule(): void {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => void syncOnce(), DEBOUNCE_MS);
	}

	const onOnline = () => void syncOnce();
	const onVisible = () => {
		if (document.visibilityState === "visible") void syncOnce();
	};

	window.addEventListener("online", onOnline);
	window.addEventListener("offline", () =>
		onState({ status: "offline", lastSyncedAt }),
	);
	document.addEventListener("visibilitychange", onVisible);

	void syncOnce();

	return {
		syncNow: syncOnce,
		schedule,
		stop() {
			if (timer) clearTimeout(timer);
			window.removeEventListener("online", onOnline);
			document.removeEventListener("visibilitychange", onVisible);
		},
	};
}
