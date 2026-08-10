/**
 * Asking the browser to keep the database.
 *
 * Storage is "best effort" by default: a browser short on space may evict the
 * whole origin, and Safari clears data for a site untouched for seven days. With
 * everything living in one place — one phone, one browser profile — that is the
 * single realistic way this log disappears.
 *
 * `persist()` needs no prompt for an app installed to the home screen; the
 * browser grants it on the engagement signal it already has. Called on every
 * start because a grant can be revoked, and asking again costs one promise.
 */

export type StorageState = "persisted" | "best-effort" | "unknown";

export async function requestPersistence(): Promise<StorageState> {
	if (typeof navigator === "undefined" || !navigator.storage?.persist) {
		return "unknown";
	}
	try {
		if (await navigator.storage.persisted()) return "persisted";
		return (await navigator.storage.persist()) ? "persisted" : "best-effort";
	} catch {
		return "unknown";
	}
}

export async function storageState(): Promise<StorageState> {
	if (typeof navigator === "undefined" || !navigator.storage?.persisted) {
		return "unknown";
	}
	try {
		return (await navigator.storage.persisted()) ? "persisted" : "best-effort";
	} catch {
		return "unknown";
	}
}
