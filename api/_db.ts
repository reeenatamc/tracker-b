/**
 * The one database connection, shared by every function.
 *
 * Serverless spins up many instances and each holds its own pool, so a pool of
 * one per warm instance is what keeps a burst of cold starts from exhausting
 * Postgres's connection limit.
 *
 * Files under `api/` that start with an underscore are not deployed as
 * endpoints, which is what makes this a module rather than a route.
 */

import postgres from "postgres";

/*
 * Vercel typechecks functions with its own tsc, which does not see this repo's
 * @types/node, so the global would otherwise fail the build with "cannot find
 * name 'process'". Declaring exactly what is read here is narrower than pulling
 * the whole Node namespace in for two variables.
 */
declare const process: { env: Record<string, string | undefined> };

export type Db = ReturnType<typeof postgres>;

let sql: Db | null = null;

export function connect(): Db {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error("DATABASE_URL no está configurada.");
	sql ??= postgres(url, { max: 1, idle_timeout: 20, prepare: false });
	return sql;
}

export function env(name: string): string | undefined {
	return process.env[name];
}

export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}
