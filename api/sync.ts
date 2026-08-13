/**
 * The sync endpoint.
 *
 * One table, one exchange: the client sends what changed since its last sync and
 * gets back what changed on the server since then. Last write wins per record,
 * decided in SQL so two devices posting at once cannot interleave into a
 * half-applied state.
 *
 * Access control is Vercel's Deployment Protection, which covers functions on
 * the deployment as well as the app. There is deliberately no shared secret in
 * the client: anything the browser holds is readable by anyone who opens the
 * bundle, so it would be decoration rather than a control.
 */

import { SYNCED_COLLECTIONS } from "../src/domain/collection-policy";
import { checkSchemaVersion, clientVersionOf } from "../src/domain/sync";
import { connect, type Db, json } from "./_db";

type Change = {
	collection: string;
	id: string;
	updatedAt: number;
	deletedAt: number | null;
	data: Record<string, unknown>;
};

type SyncRequest = {
	since?: number;
	changes?: Change[];
	/** Absent means a client from before versions existed. */
	schemaVersion?: number;
};

/**
 * From the same declaration the client pushes from. Kept as a list here and a
 * list there is what let the endpoint accept four collections nobody was
 * sending, for three stages, without anything failing.
 */
const COLLECTIONS = new Set<string>(SYNCED_COLLECTIONS);

let ready: Promise<void> | null = null;

/** Created on first use so there is no separate migration step to forget. */
function ensureSchema(db: Db) {
	ready ??= (async () => {
		await db`
			create table if not exists records (
				collection text not null,
				id text not null,
				updated_at bigint not null,
				deleted_at bigint,
				data jsonb not null,
				primary key (collection, id)
			)
		`;
		await db`create index if not exists records_updated_at_idx on records (updated_at)`;
		// One row, holding the shape of the data this server is carrying.
		await db`create table if not exists sync_meta (
			id int primary key default 1,
			schema_version int not null
		)`;
		await db`insert into sync_meta (id, schema_version) values (1, 1)
			on conflict (id) do nothing`;
	})();
	return ready;
}

export async function POST(request: Request): Promise<Response> {
	try {
		const db = connect();
		await ensureSchema(db);

		const body = (await request.json()) as SyncRequest;

		const since = Number.isFinite(body.since) ? Number(body.since) : 0;
		const changes = (body.changes ?? []).filter(
			(change) =>
				COLLECTIONS.has(change.collection) &&
				typeof change.id === "string" &&
				Number.isFinite(change.updatedAt),
		);
		const clientVersion = clientVersionOf(body);

		/*
		 * The gate and the write are one transaction, and the version row is taken
		 * `for update`. Not belt and braces: read the version, decide, then write in
		 * three separate statements and an old client that checked while the server
		 * was still on the old shape can land its write *after* a newer client has
		 * upgraded it. Check-then-act, with the upgrade sitting in the gap.
		 *
		 * The row lock serialises the two requests. Whoever holds it decides and
		 * writes before the other reads, so the second one sees the version the first
		 * one left behind — and if that is a version it cannot read, it is turned away
		 * before writing anything.
		 */
		const result = await db.begin(async (tx) => {
			const [meta] = await tx`
				select schema_version from sync_meta where id = 1 for update
			`;
			const serverVersion = Number(meta?.schema_version ?? 1);
			const verdict = checkSchemaVersion(clientVersion, serverVersion);

			if (!verdict.ok && verdict.reason === "client-outdated") {
				// Nothing has been written, and the transaction commits having only read.
				return { rejected: verdict.required } as const;
			}

			if (!verdict.ok && verdict.reason === "server-outdated") {
				// The client carries the newer shape; the server moves up to meet it.
				await tx`
					update sync_meta set schema_version = ${verdict.clientVersion} where id = 1
				`;
			}

			// Push. The guard in the WHERE clause is what makes this last-write-wins:
			// an older copy arriving late leaves the newer row alone.
			if (changes.length > 0) {
				await tx`
					insert into records ${tx(
						changes.map((change) => ({
							collection: change.collection,
							id: change.id,
							updated_at: change.updatedAt,
							deleted_at: change.deletedAt,
							// Wrapped so the driver sends it as jsonb rather than trying to
							// map each key onto a column.
							data: tx.json(change.data as Parameters<typeof tx.json>[0]),
						})),
						"collection",
						"id",
						"updated_at",
						"deleted_at",
						"data",
					)}
					on conflict (collection, id) do update set
						updated_at = excluded.updated_at,
						deleted_at = excluded.deleted_at,
						data = excluded.data
					where records.updated_at < excluded.updated_at
				`;
			}

			// Pull. Includes what was just pushed, which is what lets a second device
			// converge in a single round trip.
			const rows = await tx<
				Array<{
					collection: string;
					id: string;
					updated_at: string;
					deleted_at: string | null;
					data: Record<string, unknown>;
				}>
			>`
				select collection, id, updated_at, deleted_at, data
				from records
				where updated_at > ${since}
				order by updated_at asc
				limit 5000
			`;

			return { rows } as const;
		});

		if ("rejected" in result) {
			return json({ error: "client-outdated", required: result.rejected }, 409);
		}
		const rows = result.rows;
		return json({
			// bigint arrives as a string from Postgres; the client compares numbers.
			changes: rows.map((row) => ({
				collection: row.collection,
				id: row.id,
				updatedAt: Number(row.updated_at),
				deletedAt: row.deleted_at === null ? null : Number(row.deleted_at),
				data: row.data,
			})),
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "Error desconocido";
		return json({ error: message }, 500);
	}
}
