/**
 * Which collections travel between devices, and which end up in a backup.
 *
 * This file exists because the same mistake happened three times. E2 added
 * `phaseEvents`, E3 added `prescriptionBaseline`, `planAdjustments` and
 * `planSnapshots`; each was added to the endpoint's allow-list and to the backup
 * and — every time — not to the client's push list, which had been frozen at the
 * original seven since sync was written. The endpoint accepted collections the
 * client never sent. Nothing failed: the data simply stayed on one device, and a
 * second device silently held a different plan.
 *
 * Two hand-kept lists that must agree are not a contract; they are a promise
 * someone has to keep every time. So there is one declaration, and the client,
 * the endpoint and the backup all read it.
 *
 * The policy is stated per collection rather than inferred, because "does this
 * sync" is a decision and not a property anyone should have to deduce from a
 * type. A collection that genuinely should not travel says so out loud, and the
 * reason it does not travel is written next to it.
 *
 * Deliberately dependency-free: the endpoint is typechecked by Vercel's own tsc,
 * which does not resolve this repo's path aliases, so this module is imported
 * there by relative path and must not reach for anything else.
 */

export type CollectionPolicy =
	/** Travels between devices and is included in a backup. */
	| "synced"
	/** In a backup, never over the wire. */
	| "backup-only"
	/** Neither. Rebuilt from something else, or meaningless elsewhere. */
	| "local-only";

/**
 * Every collection in the database, with what happens to it.
 *
 * Adding a collection to `db/collections.ts` without adding it here is a
 * typecheck error, not a silent omission — that is the whole point of the file.
 * The order is the order a backup writes them in.
 */
export const COLLECTION_POLICY = {
	sessions: "synced",
	sets: "synced",
	ankleChecks: "synced",
	overrides: "synced",
	customExercises: "synced",
	progressChecks: "synced",
	inspo: "synced",
	phaseEvents: "synced",
	prescriptionBaseline: "synced",
	planAdjustments: "synced",
	planSnapshots: "synced",
} as const satisfies Record<string, CollectionPolicy>;

export type CollectionName = keyof typeof COLLECTION_POLICY;

/** The names, narrowed by policy, so a wrong `Change.collection` is a type error. */
type WithPolicy<P extends CollectionPolicy> = {
	[K in CollectionName]: (typeof COLLECTION_POLICY)[K] extends P ? K : never;
}[CollectionName];

export type SyncedCollection = WithPolicy<"synced">;
export type BackedUpCollection = WithPolicy<"synced" | "backup-only">;

const NAMES = Object.keys(COLLECTION_POLICY) as CollectionName[];

/*
 * Read as the wide type on purpose. Today every collection happens to be
 * `synced`, so a narrowed lookup would make `!== "local-only"` a comparison
 * TypeScript calls impossible — and the day someone adds a local-only
 * collection is exactly the day these filters have to already be right.
 */
const policyOf = (name: CollectionName): CollectionPolicy =>
	COLLECTION_POLICY[name];

/** What the client pushes and pulls, and what the endpoint accepts. */
export const SYNCED_COLLECTIONS = NAMES.filter(
	(name): name is SyncedCollection => policyOf(name) === "synced",
);

/** What a backup carries: everything except what is purely local. */
export const BACKED_UP_COLLECTIONS = NAMES.filter(
	(name): name is BackedUpCollection => policyOf(name) !== "local-only",
);
