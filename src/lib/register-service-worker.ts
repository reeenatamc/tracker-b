/**
 * Registers the service worker, and makes sure a new version actually reaches
 * the screen.
 *
 * Installing an update is not enough. The worker activates and claims the page,
 * but the page keeps running the code it already loaded — so the app sits on the
 * old version indefinitely. On an iOS home-screen app that is permanent: opening
 * it restores the previous state rather than navigating, so the update check may
 * never even run.
 *
 * Three things fix it: check for an update whenever the app comes to the
 * foreground, and reload once when a new worker takes control.
 *
 * Production only. A worker in development is how you end up debugging a page
 * that was cached three edits ago.
 */

export function registerServiceWorker(): void {
	if (import.meta.env.DEV) return;
	if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
		return;

	navigator.serviceWorker
		// `updateViaCache: none` keeps the HTTP cache from serving a stale worker.
		.register("/sw.js", { updateViaCache: "none" })
		.then((registration) => {
			// Foregrounding the app is the moment to look for a new version — on iOS
			// it is often the only navigation-like event that happens all day.
			const checkForUpdate = () => {
				if (document.visibilityState === "visible") void registration.update();
			};
			document.addEventListener("visibilitychange", checkForUpdate);
			checkForUpdate();
		})
		.catch((error: unknown) => {
			// Not fatal: the app still works, it just will not open offline.
			console.warn("Service worker no registrado:", error);
		});

	// A new worker has taken over, so the assets this page is running are stale.
	// Guarded, because a reload loop would be worse than a stale page.
	let reloading = false;
	navigator.serviceWorker.addEventListener("controllerchange", () => {
		if (reloading) return;
		reloading = true;
		window.location.reload();
	});
}
