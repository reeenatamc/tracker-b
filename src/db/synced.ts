/**
 * Makes a collection syncable without changing a single call site.
 *
 * Every write needs a timestamp, and every delete needs to leave something
 * behind — a row that vanishes locally has no way to tell the other device it
 * ever existed, so it would simply reappear on the next sync. Rather than
 * rewriting every `insert`/`update`/`delete` across the app and hoping none is
 * missed later, the collection itself is wrapped: writes are stamped and deletes
 * become tombstones, wherever they are called from.
 *
 * Reads still return tombstones — sync needs them — so screens read through
 * `useRecords`, which filters them out.
 */

import { SYNC_SCHEMA_VERSION, type SyncRecord } from "@/domain/sync";

type WritableCollection = {
	insert(value: Record<string, unknown>): unknown;
	update(id: string, mutate: (draft: Record<string, unknown>) => void): unknown;
	delete(id: string): unknown;
};

/**
 * Fields sync adds to every record. Absent on rows written before sync existed.
 *
 * `schemaVersion` is what lets a reader tell "written before this field existed"
 * from "written after it existed and lost it". A row with no stamp predates
 * stamping, which predates E3 by construction; one stamped at 3 or above that is
 * missing its prescription contract is not historical, it is broken — and saying
 * so beats guessing.
 */
export function stamp(): Pick<SyncRecord, "updatedAt" | "deletedAt"> & {
	schemaVersion: number;
} {
	return {
		updatedAt: Date.now(),
		deletedAt: null,
		schemaVersion: SYNC_SCHEMA_VERSION,
	};
}

export function syncable<C extends object>(collection: C): C {
	const target = collection as C & WritableCollection;

	return new Proxy(target, {
		get(_, property, receiver) {
			if (property === "insert") {
				return (value: Record<string, unknown>) =>
					target.insert({ ...stamp(), ...value, updatedAt: Date.now() });
			}

			if (property === "update") {
				return (id: string, mutate: (draft: Record<string, unknown>) => void) =>
					target.update(id, (draft) => {
						mutate(draft);
						draft.updatedAt = Date.now();
					});
			}

			// A tombstone, not a removal: the other device has to learn about this.
			if (property === "delete") {
				return (id: string) =>
					target.update(id, (draft) => {
						const now = Date.now();
						draft.deletedAt = now;
						draft.updatedAt = now;
					});
			}

			const value = Reflect.get(target, property, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	}) as C;
}

/**
 * Applies a record that arrived from another device, exactly as sent. This is
 * the one write that must NOT be re-stamped — restamping would make every pull
 * look like a fresh local edit and the two devices would push each other's data
 * back and forth forever.
 */
export function applyRemote(
	collection: object,
	id: string,
	value: Record<string, unknown>,
): void {
	const target = collection as WritableCollection & {
		has(id: string): boolean;
	};
	if (target.has(id)) {
		target.update(id, (draft) => Object.assign(draft, value));
	} else {
		target.insert(value);
	}
}

/**
 * A collection that only ever grows.
 *
 * `syncable` gives every collection `updatedAt` and `deletedAt`, and that is
 * enough machinery to quietly edit or tombstone a row that was supposed to be a
 * record of something that happened. For the phase log that would defeat the
 * point: an event says a thing occurred, and the only honest way to change its
 * effect is to add another event saying otherwise.
 *
 * So this refuses writes rather than trusting everyone to remember. Sync still
 * writes through `raw`, which does not pass through here — records arriving from
 * the other device were already appended there.
 */
export function appendOnly<C extends object>(collection: C): C {
	return new Proxy(collection, {
		get(target, property, receiver) {
			if (property === "update") {
				return () => {
					throw new Error(
						"Los eventos de fase no se editan: añade una corrección que sustituya al anterior.",
					);
				};
			}
			if (property === "delete") {
				return () => {
					throw new Error(
						"Los eventos de fase no se borran: añade una revocación que lo anule.",
					);
				};
			}
			return Reflect.get(target, property, receiver);
		},
	}) as C;
}

/**
 * A collection whose rows are never edited, but may be collected.
 *
 * Snapshots need exactly this and `appendOnly` would be wrong for them: a
 * committed one that a session points at is a fact and must never change, while a
 * reconstructed one is a derivative that regenerates and an unreferenced one may
 * be rubbish from an interrupted session start.
 *
 * Editing is what would corrupt history, so editing is what is refused. Deciding
 * *when* a delete is legitimate is a domain question, and it lives in
 * `domain/snapshot.ts` rather than being smuggled into a proxy.
 */
export function noUpdate<C extends object>(collection: C): C {
	return new Proxy(collection, {
		get(target, property, receiver) {
			if (property === "update") {
				return () => {
					throw new Error(
						"Una instantánea no se edita: congela otra y deja la anterior donde está.",
					);
				};
			}
			return Reflect.get(target, property, receiver);
		},
	}) as C;
}
