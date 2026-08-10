/**
 * The sound the rest timer makes when it runs out.
 *
 * The timer shipped vibrating, which iOS does not implement — so on the one
 * device this app is actually used on, rest ended in silence. Sound is the
 * channel that is left.
 *
 * Web Audio has one rule that shapes everything here: on Safari a context is
 * created suspended and may only be resumed inside a user gesture. The gesture
 * that starts a rest is the tap that saved the set, so the context is unlocked
 * there and reused for every timer after it — there is no second chance to ask.
 *
 * Two honest limits, neither of which code can lift: the phone's silent switch
 * mutes this, and iOS suspends timers once the screen locks, so a countdown that
 * expires with the phone in a pocket has nothing running to make a noise. Real
 * background delivery needs push, which needs a server.
 */

const PREFERENCE_KEY = "rest-alert";

/** Beyond this, the rest is over by so much that a beep is noise, not news. */
const STALE_MS = 30_000;

type WindowWithWebkitAudio = Window & {
	webkitAudioContext?: typeof AudioContext;
};

let context: AudioContext | null = null;

/**
 * Prepare the audio context. Must be called from inside a user gesture — every
 * later sound rides on the permission this one grants.
 */
export function unlockAlert(): void {
	if (typeof window === "undefined") return;
	const Ctor =
		window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
	if (!Ctor) return;

	context ??= new Ctor();
	if (context.state === "suspended") void context.resume();
}

export function alertEnabled(): boolean {
	if (typeof localStorage === "undefined") return true;
	// On by default: a timer you cannot hear is the bug this exists to fix.
	return localStorage.getItem(PREFERENCE_KEY) !== "off";
}

export function setAlertEnabled(enabled: boolean): void {
	localStorage.setItem(PREFERENCE_KEY, enabled ? "on" : "off");
	// Turning it on is a tap, which is the moment the context can be unlocked.
	if (enabled) unlockAlert();
}

/**
 * Sound the end of a rest that ended at `endsAt`.
 *
 * Returning from another app replays the transition to zero, so a rest that
 * expired while the screen was off would beep on the way back in. Late enough
 * and that is just a phone making a noise at nothing.
 */
export function alertRestOver(endsAt: number): void {
	if (!alertEnabled() || Date.now() - endsAt > STALE_MS) return;

	playTone();
	// Free on Android and desktop Chrome; a no-op on iOS, which is why the tone
	// exists at all.
	navigator.vibrate?.([200, 100, 200]);

	// If she stepped into another app, a notification is the only thing she will
	// see. Never requested unprompted — this fires only if she already said yes.
	if (document.hidden) void showRestNotification();
}

function playTone(): void {
	if (!context || context.state !== "running") return;
	const at = context.currentTime;
	beep(context, at, 880);
	// A fourth up rather than the same note twice: it reads as finished instead
	// of as an error.
	beep(context, at + 0.18, 1174.66);
}

function beep(ctx: AudioContext, at: number, hz: number): void {
	const oscillator = ctx.createOscillator();
	const gain = ctx.createGain();

	oscillator.type = "sine";
	oscillator.frequency.value = hz;

	// Ramped, not gated: a square edge on the envelope clicks audibly.
	gain.gain.setValueAtTime(0.0001, at);
	gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
	gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);

	oscillator.connect(gain).connect(ctx.destination);
	oscillator.start(at);
	oscillator.stop(at + 0.18);
}

async function showRestNotification(): Promise<void> {
	if (!("Notification" in window) || Notification.permission !== "granted") {
		return;
	}
	// iOS only delivers notifications raised from a service worker registration;
	// `new Notification()` is not implemented there.
	const registration = await navigator.serviceWorker?.getRegistration();
	await registration?.showNotification("Descanso terminado", {
		body: "Siguiente serie.",
		// One rest notification at a time — later ones replace, never stack.
		tag: "rest",
		icon: "/icon-192.png",
	});
}

/** True once she has granted notifications, or after she does. */
export async function requestNotifications(): Promise<boolean> {
	if (!("Notification" in window)) return false;
	if (Notification.permission === "granted") return true;
	// A denied permission cannot be re-asked from the page; only from settings.
	if (Notification.permission === "denied") return false;
	return (await Notification.requestPermission()) === "granted";
}
