/**
 * The daily reminder.
 *
 * Vercel's scheduler calls this once a day. On the Hobby plan that is the most
 * it can be called, and the firing time drifts by up to an hour — so this is a
 * morning "hoy toca Full Body A", which survives drift, rather than a 19:00
 * alarm, which would not. An alarm for a precise minute belongs to the phone's
 * own clock app, and saying so is more useful than building something that is
 * late a third of the time.
 *
 * A subscription that the push service rejects as gone is deleted: a reinstalled
 * app issues a new one, and keeping the dead row would mean retrying it forever.
 */

import webpush from "web-push";
import { connect, env, json } from "./_db.ts";
import { ensurePushSchema } from "./push.ts";

type Row = {
	endpoint: string;
	p256dh: string;
	auth: string;
	schedule: Record<string, string | null>;
	start_date: string;
	time_zone: string;
};

const WEEKDAYS = [
	"sunday",
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
] as const;

export async function GET(request: Request): Promise<Response> {
	// Vercel sends this header on scheduled invocations when CRON_SECRET is set.
	// Without the variable there is nothing to check, and Deployment Protection
	// is still in front of everything.
	const secret = env("CRON_SECRET");
	if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
		return json({ error: "No autorizado." }, 401);
	}

	const publicKey = env("VAPID_PUBLIC_KEY");
	const privateKey = env("VAPID_PRIVATE_KEY");
	if (!publicKey || !privateKey) {
		return json({ error: "Faltan las claves VAPID." }, 500);
	}
	webpush.setVapidDetails(
		`mailto:${env("VAPID_CONTACT") ?? "tracker@operacion-tesis.app"}`,
		publicKey,
		privateKey,
	);

	try {
		const db = connect();
		await ensurePushSchema(db);
		const rows = await db<Row[]>`
			select endpoint, p256dh, auth, schedule, start_date, time_zone
			from push_subscriptions
		`;

		let sent = 0;
		let skipped = 0;
		let removed = 0;

		for (const row of rows) {
			const message = composeReminder(row);
			if (!message) {
				skipped++;
				continue;
			}

			try {
				await webpush.sendNotification(
					{
						endpoint: row.endpoint,
						keys: { p256dh: row.p256dh, auth: row.auth },
					},
					JSON.stringify(message),
				);
				sent++;
			} catch (error) {
				const status = (error as { statusCode?: number }).statusCode;
				// 404/410: the push service says this subscription no longer exists.
				if (status === 404 || status === 410) {
					await db`delete from push_subscriptions where endpoint = ${row.endpoint}`;
					removed++;
				}
			}
		}

		return json({ sent, skipped, removed, total: rows.length });
	} catch (error) {
		const detail = error instanceof Error ? error.message : "Error desconocido";
		return json({ error: detail }, 500);
	}
}

export type Reminder = { title: string; body: string; tag: string; url: string };

/**
 * What today's notification says, or null on a day with nothing programmed.
 *
 * The weekday is read in the device's own time zone. Asking UTC what day it is
 * would put every evening in the Americas on tomorrow's session.
 */
export function composeReminder(
	row: Pick<Row, "schedule" | "start_date" | "time_zone">,
	now: Date = new Date(),
): Reminder | null {
	const today = localDate(now, row.time_zone);
	const weekday = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()];
	const block = row.schedule?.[weekday] ?? null;
	if (!block) return null;

	const week = weekNumber(row.start_date, today);
	return {
		title: `Hoy toca ${block}`,
		body: week ? `Semana ${week} de Operación Tesis.` : "Operación Tesis.",
		tag: "reminder",
		url: "/",
	};
}

/**
 * The calendar date it is right now in a given time zone, as `YYYY-MM-DD`.
 *
 * Read through `Intl` rather than by shifting a Date, because that shift only
 * lands if the runtime's own zone happens to be UTC — true on Vercel today, and
 * a silent day-off-by-one the day it is not.
 */
function localDate(date: Date, timeZone: string): string {
	try {
		return new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).format(date);
	} catch {
		return date.toISOString().slice(0, 10);
	}
}

function weekNumber(startDate: string, today: string): number | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
	const start = Date.parse(`${startDate}T00:00:00Z`);
	const now = Date.parse(`${today}T00:00:00Z`);
	if (Number.isNaN(start) || Number.isNaN(now)) return null;
	const days = Math.floor((now - start) / 86_400_000);
	return days < 0 ? null : Math.floor(days / 7) + 1;
}
