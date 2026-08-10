/**
 * Turning on the daily reminder.
 *
 * Push is the only way a phone hears from this app while it is closed. On iOS it
 * works exclusively for a web app installed to the home screen, so this reports
 * "unsupported" rather than failing at the moment of asking — a permission
 * prompt that cannot lead anywhere is worse than an honest sentence.
 *
 * What gets registered is the schedule, not the program: the weekday-to-block
 * map is computed here and stored with the subscription, so the server can write
 * "hoy toca Full Body A" without the plan ever leaving her database.
 */

import type { Program } from "@/domain/schema";

const ENDPOINT = "/api/push";

export type PushState =
	/** No push service at all, or iOS Safari outside an installed app. */
	| { status: "unsupported" }
	/** Blocked at the browser level; only settings can undo it. */
	| { status: "denied" }
	| { status: "off" }
	| { status: "on" }
	/** The server has no VAPID keys or no database yet. */
	| { status: "unconfigured" };

function supported(): boolean {
	return (
		typeof window !== "undefined" &&
		"serviceWorker" in navigator &&
		"PushManager" in window &&
		"Notification" in window
	);
}

export async function pushState(): Promise<PushState> {
	if (!supported()) return { status: "unsupported" };
	if (Notification.permission === "denied") return { status: "denied" };

	const registration = await navigator.serviceWorker.getRegistration();
	const subscription = await registration?.pushManager.getSubscription();
	return subscription ? { status: "on" } : { status: "off" };
}

/**
 * The weekday map the reminder is written from.
 *
 * Cardio days are not in `sessions` — they are the rest of the week — so they
 * are named from the plan's own day list, which is where "Cardio + tobillo"
 * comes from in the first place.
 */
export function scheduleOf(program: Program): Record<string, string | null> {
	const schedule: Record<string, string | null> = {};

	for (const day of program.weekStructure) {
		const session = program.sessions.find(
			(template) => template.weekday === day.weekday,
		);
		schedule[day.weekday] = session?.name ?? day.block ?? null;
	}

	return schedule;
}

export async function enablePush(program: Program): Promise<PushState> {
	if (!supported()) return { status: "unsupported" };

	const granted =
		Notification.permission === "granted" ||
		(await Notification.requestPermission()) === "granted";
	if (!granted) {
		return { status: Notification.permission === "denied" ? "denied" : "off" };
	}

	const key = await fetch(ENDPOINT)
		.then((response) => (response.ok ? response.json() : null))
		.then((body: { publicKey?: string | null } | null) => body?.publicKey)
		.catch(() => null);
	if (!key) return { status: "unconfigured" };

	const registration = await navigator.serviceWorker.ready;
	const subscription =
		(await registration.pushManager.getSubscription()) ??
		(await registration.pushManager.subscribe({
			// Required by every browser: a push may never be silent.
			userVisibleOnly: true,
			applicationServerKey: decodeKey(key),
		}));

	const response = await fetch(ENDPOINT, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			subscription: subscription.toJSON(),
			schedule: scheduleOf(program),
			startDate: program.meta.startDate,
			timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
		}),
	});

	if (!response.ok) {
		// Leaving a subscription the server does not know about would look enabled
		// and never deliver anything.
		await subscription.unsubscribe();
		return { status: "unconfigured" };
	}

	return { status: "on" };
}

export async function disablePush(): Promise<PushState> {
	if (!supported()) return { status: "unsupported" };

	const registration = await navigator.serviceWorker.getRegistration();
	const subscription = await registration?.pushManager.getSubscription();
	if (!subscription) return { status: "off" };

	await fetch(ENDPOINT, {
		method: "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ endpoint: subscription.endpoint }),
	}).catch(() => undefined);

	await subscription.unsubscribe();
	return { status: "off" };
}

/** VAPID keys travel as base64url; `subscribe` wants the raw bytes. */
function decodeKey(base64Url: string): ArrayBuffer {
	const padded = base64Url
		.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), "=")
		.replace(/-/g, "+")
		.replace(/_/g, "/");
	const binary = atob(padded);
	// Allocated over its own ArrayBuffer rather than via `Uint8Array.from`, whose
	// buffer is typed as possibly shared and so is not a BufferSource.
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes.buffer;
}
