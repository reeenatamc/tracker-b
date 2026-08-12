/**
 * Everything that has to happen before a screen may read the log, in order.
 *
 * This exists because of a defect that hid for three stages: `getCollections()`
 * resolves as soon as the collections are *constructed*, and the rows arrive
 * from OPFS afterwards. Every reconciliation ran in that gap, saw an empty
 * database, and did nothing — measured on a real restore, `sessions.toArray`
 * was 0 while the file on disk held three sessions and forty-three sets.
 *
 * The consequence was invisible on a database that never needed reconciling and
 * plain on one that did: a restored backup kept its numeric phases and its
 * pre-E1 exercise ids for ever, because the two migrations written to fix
 * exactly that never saw a single row.
 *
 * So the barrier lives here, once, and not in each migrator. A migrator that has
 * to remember to wait is a migrator that will forget — and the failure is silent,
 * which is the worst kind. Nothing below `hydrate` can observe a half-loaded
 * database, because nothing below it runs until `hydrate` has resolved.
 */

import type { Program } from "@/domain/schema";
import { todayIso } from "@/lib/format";
import { migrateExerciseIds } from "@/lib/migrate-exercise-ids";
import { migratePhaseIds } from "@/lib/migrate-phase-ids";
import { reconcilePhaseInheritance } from "@/lib/reconcile-phases";
import { syncSeed } from "@/lib/seed";
import type { Collections } from "./collections";

/** Anything that can tell us when it has finished loading. */
type Hydratable = { preload: () => Promise<unknown> };

function isHydratable(value: unknown): value is Hydratable {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { preload?: unknown }).preload === "function"
	);
}

/**
 * The barrier: resolves when every collection has finished loading from OPFS.
 *
 * `preload()` is idempotent — the promise is memoised — so the wrapped and
 * unwrapped views of the same collection both being reached costs nothing.
 * Returns the names it waited for, because "which ones did you actually wait
 * for" is the question you want answered when this goes wrong at four in the
 * morning.
 *
 * What it promises is that loading *finished*, not that it succeeded: the
 * persistence layer marks a collection ready even when its hydration threw. A
 * collection that failed to load therefore arrives here empty and looking
 * settled, and the reconciliations below will treat it as an empty database.
 * That is a worse failure than the one this fixes and it needs its own answer;
 * it is out of scope here and written down so it is not rediscovered.
 */
export async function hydrate(collections: object): Promise<string[]> {
	const waited: Array<[string, Promise<unknown>]> = [];

	for (const [name, value] of Object.entries(collections)) {
		if (isHydratable(value)) waited.push([name, value.preload()]);
	}

	await Promise.all(waited.map(([, promise]) => promise));
	return waited.map(([name]) => name);
}

export type BootstrapReport = {
	/** Collections waited for, and how many rows each held once loaded. */
	hydrated: Record<string, number>;
	exercises: ReturnType<typeof migrateExerciseIds>;
	phases: ReturnType<typeof migratePhaseIds>;
	seed: ReturnType<typeof syncSeed>;
	inheritance: ReturnType<typeof reconcilePhaseInheritance>;
};

/** Passed in so a test can pin the day without pinning the whole clock. */
export type BootstrapClock = { today?: string; now?: number };

/**
 * Local startup, start to finish. Resolves only when the database is fit to read.
 *
 * The order is deliberate and is the second half of the fix:
 *
 *   1. hydrate                    — nothing below may see a partial database
 *   2. migrateExerciseIds         — legacy ids become current ids
 *   3. migratePhaseIds            — numeric phases become named ones
 *   4. syncSeed                   — compares rows the two steps above have fixed
 *   5. reconcilePhaseInheritance  — writes down what a new phase inherited
 *
 * Step 5 is also reachable on its own, because a phase can arrive by sync rather
 * than by being created here — see `reconcilePhaseInheritance`, which is
 * idempotent precisely so both doors lead to the same place.
 *
 * The seed goes *after* the migrations on purpose. It compares stored rows
 * against the spreadsheet's, and comparing against un-migrated ones makes every
 * row look changed — which is precisely what drove the old code into deleting
 * and re-creating them.
 *
 * Anything thrown here propagates. The caller turns it into a visible error;
 * what it must never become is a rejection nobody handles, because that leaves
 * the app on its loading screen with no way out.
 */
export async function bootstrap(
	collections: Collections,
	program: Program,
	clock: BootstrapClock = {},
): Promise<BootstrapReport> {
	const waited = await hydrate(collections);

	const hydrated: Record<string, number> = {};
	for (const name of waited) {
		const value = (collections as unknown as Record<string, unknown>)[name];
		if (value && typeof value === "object" && "toArray" in value) {
			hydrated[name] = (value as { toArray: unknown[] }).toArray.length;
		}
	}

	const exercises = migrateExerciseIds(collections);
	const phases = migratePhaseIds(collections, program);
	const seed = syncSeed(collections);
	const inheritance = reconcilePhaseInheritance(
		collections,
		program,
		clock.today ?? todayIso(),
		clock.now ?? Date.now(),
	);

	return { hydrated, exercises, phases, seed, inheritance };
}
