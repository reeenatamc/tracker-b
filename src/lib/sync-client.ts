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

import { applyRemote } from "@/db/synced";
import type { Collections } from "@/db/collections";
import { highWaterMark } from "@/domain/sync";

const ENDPOINT = "/api/sync";
const MARK_KEY = "operacion-tesis:sync-mark";
const DEBOUNCE_MS = 4000;

const COLLECTION_KEYS = [
	"sessions",
	"sets",
	"ankleChecks",
	"overrides",
	"customExercises",
	"progressChecks",
	"inspo",
] as const;

type CollectionKey = (typeof COLLECTION_KEYS)[number];

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
 * Rows written before sync existed have no timestamp. Treating them as
 * epoch-zero means they are pushed once and then never fight anything: any real
 * edit on either device is newer and wins.
 */
function stampOf(row: Row): { updatedAt: number; deletedAt: number | null } {
	return { updatedAt: row.updatedAt ?? 0, deletedAt: row.deletedAt ?? null };
}

export function createSyncClient(
	collections: Collections,
	onState: (state: SyncState) => void,
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
			for (const key of COLLECTION_KEYS) {
				for (const row of collections.raw[key].toArray as unknown as Row[]) {
					const { updatedAt, deletedAt } = stampOf(row);
					if (updatedAt > mark) {
						changes.push({
							collection: key,
							id: row.id,
							updatedAt,
							deletedAt,
							data: row,
						});
					}
				}
			}

			const response = await fetch(ENDPOINT, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ since: mark, changes }),
			});

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
				if (!COLLECTION_KEYS.includes(change.collection)) continue;
				// Written through `raw` so the stamping proxy does not touch it: a
				// re-stamped pull would look like a local edit and bounce back.
				applyRemote(collections.raw[change.collection], change.id, {
					...change.data,
					updatedAt: change.updatedAt,
					deletedAt: change.deletedAt,
				});
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
			onState({ status: "idle", lastSyncedAt });
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "No se pudo sincronizar.";
			if (message.includes("DATABASE_URL")) {
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
