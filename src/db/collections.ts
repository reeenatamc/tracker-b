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
import type {
	AnkleCheck,
	CustomExercise,
	ExerciseOverride,
	InspoItem,
	PhaseEvent,
	ProgressCheck,
	SessionRecord,
	SetRecord,
} from "@/domain/schema";
import {
	createDurabilityTracker,
	type DurabilityTracker,
	durable,
} from "./durability";
import { appendOnly, syncable } from "./synced";

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

	const persistence = createBrowserWASQLitePersistence({ database });

	/*
	 * Counts writes that have updated memory but may not have reached disk. It is
	 * separate from `syncable` on purpose: "has the other device seen this" and
	 * "is this on disk" are different questions, and a single number could not
	 * honestly answer both.
	 */
	const tracker = createDurabilityTracker();

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

	// Your edits to the program. Kept separate from the imported content so
	// re-importing the spreadsheet never overwrites them.
	const overrides = createCollection(
		persistedCollectionOptions<ExerciseOverride, string>({
			id: "exercise_overrides",
			getKey: (override) => override.id,
			persistence,
			schemaVersion: SCHEMA_VERSION,
		}),
	);

	const customExercises = createCollection(
		persistedCollectionOptions<CustomExercise, string>({
			id: "custom_exercises",
			getKey: (exercise) => exercise.id,
			persistence,
			schemaVersion: SCHEMA_VERSION,
		}),
	);

	const progressChecks = createCollection(
		persistedCollectionOptions<ProgressCheck, string>({
			id: "progress_checks",
			getKey: (check) => check.id,
			persistence,
			schemaVersion: SCHEMA_VERSION,
		}),
	);

	// Only metadata lives here; the images themselves are files in OPFS, so a
	// live query never drags megabytes of photo into memory.
	const inspo = createCollection(
		persistedCollectionOptions<InspoItem, string>({
			id: "inspo",
			getKey: (item) => item.id,
			persistence,
			schemaVersion: SCHEMA_VERSION,
		}),
	);

	// The phase log. Append-only, and enforced rather than trusted: `appendOnly`
	// below refuses update and delete, so the only way to change an event's effect
	// is another event.
	const phaseEvents = createCollection(
		persistedCollectionOptions<PhaseEvent, string>({
			id: "phase_events",
			getKey: (event) => event.id,
			persistence,
			schemaVersion: SCHEMA_VERSION,
		}),
	);

	const raw = {
		sessions,
		sets,
		ankleChecks,
		overrides,
		customExercises,
		progressChecks,
		inspo,
		phaseEvents,
	};

	/**
	 * What the app writes through: every write is stamped and every delete
	 * becomes a tombstone, so nothing has to remember to do it by hand.
	 *
	 * `raw` is the same collections unwrapped, and exists for exactly one caller:
	 * the sync client, which must write incoming records verbatim. Stamping them
	 * would make every pull look like a fresh local edit and the two devices
	 * would push each other's data back and forth without ever settling.
	 */
	/*
	 * Nothing is closed while writes are in flight. `database.close()` on
	 * `pagehide` used to abort pending flushes outright — the harness scenario that
	 * fires `pagehide` by hand lost the write twenty-five times out of twenty-five.
	 */
	releaseOnUnload(database, tracker);

	// `durable` outside `syncable`: the stamp goes on first, then the write is
	// counted, so what the tracker waits for is the same object that gets written.
	const write = <C extends object>(collection: C) =>
		durable(syncable(collection), tracker);

	return {
		tracker,
		sessions: write(sessions),
		sets: write(sets),
		ankleChecks: write(ankleChecks),
		overrides: write(overrides),
		customExercises: write(customExercises),
		progressChecks: write(progressChecks),
		inspo: write(inspo),
		phaseEvents: appendOnly(write(phaseEvents)),
		raw,
	};
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
 * Lets go of the OPFS handles when the page does — but never on top of a write.
 *
 * The handles are exclusive, and a page that vanishes without releasing them used
 * to leave the next one unable to open the database. Hence closing on `pagehide`,
 * and hence `openDatabaseWithRetry` to paper over the times it did not help.
 *
 * The cost turned out to be worse than the problem: closing while flushes are in
 * flight aborts them, and that is data. So the close is now conditional on there
 * being nothing pending — and there is deliberately no `await` here, because
 * `pagehide` does not wait for promises and pretending otherwise would be a
 * guarantee in name only. The real guarantee is upstream: the write sites that
 * hold training data await persistence before they call it saved.
 *
 * When something is still pending the handles are simply left to the browser,
 * which releases them when the page is destroyed. That is what the retry loop was
 * always the safety net for.
 */
function releaseOnUnload(
	database: BrowserDatabase,
	tracker: DurabilityTracker,
): void {
	window.addEventListener(
		"pagehide",
		() => {
			if (tracker.pendingCount > 0) return;
			void database.close?.();
		},
		{ once: true },
	);
}
