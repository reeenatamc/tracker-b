/**
 * Registering a device for reminders.
 *
 * A push subscription is issued by the browser's own push service and names one
 * installation of the app. It carries no identity of its own, so the row keeps
 * everything the reminder will need to write a sentence: which block falls on
 * which weekday, when the program started, and the time zone the weekday should
 * be read in — a reminder computed in UTC is a day early half the evening.
 *
 * The schedule is stored rather than read from the program because the program
 * is private and does not ship to the server. This way the plan stays in her
 * database, where the rest of her log already is.
 */

import { connect, type Db, env, json } from "./_db.ts";

type Subscription = {
	endpoint: string;
	keys: { p256dh: string; auth: string };
};

type Registration = {
	subscription: Subscription;
	/** Weekday name → what that day's block is called, or null for a rest day. */
	schedule: Record<string, string | null>;
	startDate: string;
	timeZone: string;
};

let ready: Promise<void> | null = null;

/** Created on first use so there is no separate migration step to forget. */
export function ensurePushSchema(db: Db): Promise<void> {
	ready ??= (async () => {
		await db`
			create table if not exists push_subscriptions (
				endpoint text primary key,
				p256dh text not null,
				auth text not null,
				schedule jsonb not null,
				start_date text not null,
				time_zone text not null,
				created_at bigint not null,
				failures int not null default 0
			)
		`;
	})();
	return ready;
}

export async function GET(): Promise<Response> {
	// The public half of the keypair is meant to be public — the client needs it
	// to subscribe, and serving it beats baking it into the bundle at build time,
	// where a missing variable turns into a silently broken feature.
	const publicKey = env("VAPID_PUBLIC_KEY");
	return json({ publicKey: publicKey ?? null });
}

export async function POST(request: Request): Promise<Response> {
	try {
		const db = connect();
		await ensurePushSchema(db);

		const body = (await request.json()) as Registration;
		const subscription = body.subscription;
		if (!subscription?.endpoint || !subscription.keys?.p256dh) {
			return json({ error: "Suscripción incompleta." }, 400);
		}

		await db`
			insert into push_subscriptions (
				endpoint, p256dh, auth, schedule, start_date, time_zone, created_at
			) values (
				${subscription.endpoint},
				${subscription.keys.p256dh},
				${subscription.keys.auth},
				${db.json(body.schedule ?? {})},
				${body.startDate ?? ""},
				${body.timeZone ?? "UTC"},
				${Date.now()}
			)
			on conflict (endpoint) do update set
				p256dh = excluded.p256dh,
				auth = excluded.auth,
				schedule = excluded.schedule,
				start_date = excluded.start_date,
				time_zone = excluded.time_zone,
				failures = 0
		`;

		return json({ ok: true });
	} catch (error) {
		return json({ error: message(error) }, 500);
	}
}

export async function DELETE(request: Request): Promise<Response> {
	try {
		const db = connect();
		await ensurePushSchema(db);
		const { endpoint } = (await request.json()) as { endpoint?: string };
		if (endpoint) {
			await db`delete from push_subscriptions where endpoint = ${endpoint}`;
		}
		return json({ ok: true });
	} catch (error) {
		return json({ error: message(error) }, 500);
	}
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : "Error desconocido";
}
