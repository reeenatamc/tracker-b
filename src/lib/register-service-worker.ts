/**
 * Registers the service worker that makes the app open with no network.
 *
 * Production only. A worker in development is how you end up debugging a page
 * that was cached three edits ago.
 */

export function registerServiceWorker(): void {
	if (import.meta.env.DEV) return;
	if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
		return;

	navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
		// Not fatal: the app still works, it just will not open offline.
		console.warn("Service worker no registrado:", error);
	});
}
