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
import {
	classifyFailure,
	highWaterMark,
	SYNC_SCHEMA_VERSION,
} from "@/domain/sync";
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
	/**
	 * This device is behind the server's schema, so the gate turned it away.
	 *
	 * Its own state and not an error: nothing is broken and retrying will not
	 * help. What helps is updating this device, and saying so is more useful than
	 * a red line that reads like the network failed.
	 */
	| { status: "outdated"; required: number; lastSyncedAt: number | null }
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

/**
 * A failed exchange that still knows what the server answered.
 *
 * The status has to survive all the way to whoever classifies the failure.
 * Turning the response into a plain `Error(text)` here — which is what used to
 * happen — throws away the one fact that decides the meaning, and leaves the
 * classifier reading the message for a number that `fetch` already knew. See
 * T-006 in `docs/issues.md`.
 */
export class SyncHttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
		/** From the body, and only ever read after the status said 409. */
		readonly required?: number,
	) {
		super(message);
		this.name = "SyncHttpError";
	}
}

/**
 * The message is for the person reading it; it never decides anything.
 *
 * A body may be JSON with an `error`, plain text, empty, or the HTML of a login
 * page — all four are the same status, and the status is what gets classified.
 */
async function httpFailure(response: Response): Promise<SyncHttpError> {
	const body = await response
		.clone()
		.json()
		.then((parsed: { error?: string; required?: number }) => parsed)
		.catch(() => ({}) as { error?: string; required?: number });
	const reason = body.error;

	// Behind Deployment Protection an expired session answers with the login page
	// instead of JSON; saying so beats "unexpected token <".
	const detail =
		response.status === 401 || response.status === 403
			? "Tu sesión de Vercel caducó. Abre la app de nuevo para reconectar."
			: (reason ?? `El servidor respondió ${response.status}.`);

	return new SyncHttpError(response.status, detail, body.required);
}

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
			/** What this device owes the server, given a cursor. */
			function collect(from: number) {
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
						if (!owed && updatedAt <= from) continue;

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

				return { changes, firstPush };
			}

			async function exchange(from: number, changes: Change[]) {
				return fetch(ENDPOINT, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						since: from,
						changes,
						schemaVersion: SYNC_SCHEMA_VERSION,
					}),
				});
			}

			let from = mark;
			let collected = collect(from);
			let changes = collected.changes;
			let firstPush = collected.firstPush;
			let response = await exchange(from, changes);

			// An outdated client is turned away rather than allowed to write records
			// this version cannot read. Losing sync for a day is an inconvenience;
			// a log full of values a version does not understand is damage.
			if (response.status === 409) {
				// Clonada: si el cuerpo no es el esperado, la respuesta sigue entera
				// para que `httpFailure` conserve el status. Consumirla aquí dejaba
				// caer la clasificación al camino de «no contestó nadie».
				const body = (await response
					.clone()
					.json()
					.catch(() => ({}))) as {
					error?: string;
					required?: number;
				};
				if (body.error === "client-outdated") {
					// Not thrown as an error: the catch below would file it next to
					// "no pudo conectar", and those are two different situations with
					// two different things to do about them.
					onState({
						status: "outdated",
						required: Number(body.required ?? 0),
						lastSyncedAt,
					});
					return;
				}
			}

			if (!response.ok) throw await httpFailure(response);

			let body = (await response.json()) as {
				changes?: Change[];
				highWaterMark?: number;
			};

			/*
			 * A cursor is only good while the server can account for the history it
			 * points into.
			 *
			 * The cursor is a maximum over `updatedAt`, and the server answers "newer
			 * than this" out of the same values — so if it holds nothing that new,
			 * this device is asking about a history that server no longer has. That
			 * happens when the database is restored from an older backup: every
			 * client keeps asking from where it got to, the server has nothing past
			 * it, and everyone converges on "nothing changed" forever. An empty
			 * `changes` looks exactly the same in both cases, which is why the
			 * server states its own end of history rather than leaving it to be
			 * inferred from an absence.
			 *
			 * The answer is to stop trusting the cursor, not to stop trusting the
			 * data: the exchange is repeated as a first sync — everything offered,
			 * everything read, reconciled by id — and the merge rule does not change.
			 * Per record the newer `updatedAt` still wins. A server that forgot does
			 * not thereby get to decide. See §Recuperación in `docs/issues.md`.
			 *
			 * A server too old to state a watermark leaves this undecidable, and
			 * undecidable is left alone rather than guessed at.
			 */
			const regressed =
				from > 0 &&
				typeof body.highWaterMark === "number" &&
				body.highWaterMark < from;

			if (regressed) {
				from = 0;
				collected = collect(from);
				changes = collected.changes;
				firstPush = collected.firstPush;
				response = await exchange(from, changes);
				// El cursor viejo sigue guardado: se reintenta entero, no a medias.
				if (!response.ok) throw await httpFailure(response);
				body = (await response.json()) as {
					changes?: Change[];
					highWaterMark?: number;
				};
			}

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
			//
			// The floor is the old cursor, except after a regression: there the whole
			// point is that it may go backwards, and flooring it would put it right
			// back past the end of the server's history.
			mark = highWaterMark(
				[...incoming, ...changes].map((change) => ({
					id: change.id,
					updatedAt: change.updatedAt,
					deletedAt: change.deletedAt,
				})),
				regressed ? 0 : mark,
			);
			// Written only here: a cursor is stored after the exchange it describes
			// has been applied, never before it.
			localStorage.setItem(MARK_KEY, String(mark));

			lastSyncedAt = Date.now();
			// Before the state goes idle: a screen that re-renders on "idle" should
			// already be looking at a reconciled plan, not at one mid-repair.
			onPulled(incoming.length);
			onState({ status: "idle", lastSyncedAt });
		} catch (error) {
			/*
			 * Del servidor cuando hubo servidor; una frase nuestra cuando no. Un
			 * «Failed to fetch» en la barra es el navegador hablándole a quien lo
			 * programó, no a quien está en el gimnasio.
			 */
			const message =
				error instanceof SyncHttpError
					? error.message
					: "No se pudo conectar. Lo tuyo se guarda aquí y se sincroniza luego.";
			/*
			 * Classified by what the server answered, never by what the message
			 * says. A 404 is "there is no endpoint here" whatever its body; a 500
			 * is a broken server even if its body mentions 404; and a rejected
			 * fetch answered nothing at all, which is not a 404 either.
			 */
			const failure = classifyFailure({
				status: error instanceof SyncHttpError ? error.status : null,
				online: navigator.onLine,
			});

			if (failure.kind === "unconfigured") onState({ status: "unconfigured" });
			else if (failure.kind === "offline")
				onState({ status: "offline", lastSyncedAt });
			else if (failure.kind === "outdated")
				onState({
					status: "outdated",
					required: error instanceof SyncHttpError ? (error.required ?? 0) : 0,
					lastSyncedAt,
				});
			else onState({ status: "error", message, lastSyncedAt });
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
