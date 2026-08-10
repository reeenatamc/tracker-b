/**
 * Local database.
 *
 * Everything you log lives in SQLite inside the browser (wa-sqlite over OPFS),
 * which is what makes the gym work: writes land locally and instantly, with no
 * network in the path. Phase 2 swaps `persistedCollectionOptions` for
 * `electricCollectionOptions` to add sync — the components above never change.
 *
 * OPFS only exists in the browser, so collections are built lazily and awaited
 * through `CollectionsProvider` rather than at module scope.
 */

import {
	createBrowserWASQLitePersistence,
	openBrowserWASQLiteOPFSDatabase,
	persistedCollectionOptions,
} from "@tanstack/browser-db-sqlite-persistence";
import { createCollection } from "@tanstack/react-db";
import type { AnkleCheck, SessionRecord, SetRecord } from "@/domain/schema";

const DATABASE_NAME = "operacion-tesis";

/**
 * Bump only alongside a migration. For these local-only collections a changed
 * version throws rather than silently dropping the log — losing training
 * history to an automatic reset would be worse than a loud failure.
 */
const SCHEMA_VERSION = 1;

export type Collections = Awaited<ReturnType<typeof createCollections>>;

let pending: Promise<Collections> | null = null;

/** Opens the database once and reuses it for the life of the tab. */
export function getCollections(): Promise<Collections> {
	pending ??= createCollections();
	return pending;
}

async function createCollections() {
	if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
		throw new Error(
			"Este navegador no soporta OPFS, que es donde se guardan tus registros. " +
				"Prueba con Chrome, Edge o Safari actualizado.",
		);
	}

	const database = await openDatabaseWithRetry();
	releaseOnUnload(database);
	const persistence = createBrowserWASQLitePersistence({ database });

	// Row types are stated as type parameters rather than passed as a runtime
	// schema: that is how persisted collections are meant to be declared, and the
	// options object carries `utils`, which the schema overloads reject.
	//
	// Nothing untyped reaches these collections — every write goes through the
	// typed helpers in this app, and the imported seed is validated against Zod in
	// `lib/seed.ts` before insertion.
	const sessions = createCollection(
		persistedCollectionOptions<SessionRecord, string>({
			id: "sessions",
			getKey: (session) => session.id,
			persistence,
			schemaVersion: SCHEMA_VERSION,
		}),
	);

	const sets = createCollection(
		persistedCollectionOptions<SetRecord, string>({
			id: "sets",
			getKey: (set) => set.id,
			persistence,
			schemaVersion: SCHEMA_VERSION,
		}),
	);

	const ankleChecks = createCollection(
		persistedCollectionOptions<AnkleCheck, string>({
			id: "ankle_checks",
			getKey: (check) => check.id,
			persistence,
			schemaVersion: SCHEMA_VERSION,
		}),
	);

	return { sessions, sets, ankleChecks };
}

type BrowserDatabase = Awaited<
	ReturnType<typeof openBrowserWASQLiteOPFSDatabase>
>;

/**
 * OPFS grants exclusive access handles per file. A page that goes away without
 * releasing them leaves the next page unable to open the database — it surfaces
 * as `removeEntry ... modifications are not allowed` on the very next reload.
 *
 * The handles are freed shortly after the old page is torn down, so a few
 * spaced retries turn a hard failure into an imperceptible delay.
 */
async function openDatabaseWithRetry(
	attempts = 6,
	delayMs = 200,
): Promise<BrowserDatabase> {
	let lastError: unknown;

	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			return await openBrowserWASQLiteOPFSDatabase({
				databaseName: DATABASE_NAME,
			});
		} catch (error) {
			lastError = error;
			await new Promise((resolve) =>
				setTimeout(resolve, delayMs * (attempt + 1)),
			);
		}
	}

	throw new Error(
		"Tu registro está abierto en otra pestaña. Ciérrala y vuelve a intentar. " +
			`(${lastError instanceof Error ? lastError.message : String(lastError)})`,
	);
}

/**
 * Hands the OPFS locks back before the page goes away. `pagehide` is the only
 * event that fires reliably on mobile Safari, where `beforeunload` does not.
 */
function releaseOnUnload(database: BrowserDatabase): void {
	window.addEventListener(
		"pagehide",
		() => {
			void database.close?.();
		},
		{ once: true },
	);
}
