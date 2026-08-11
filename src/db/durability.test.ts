/**
 * T-001 · the write that is never waited for.
 *
 * `collection.insert()` does not write to disk. It returns a `Transaction` whose
 * `isPersisted.promise` settles when the flush actually lands, and the app
 * discards it — every call site fires and forgets. So a set exists in memory, the
 * screen updates, the rest timer starts, and whether it ever reaches OPFS depends
 * on whether the page survives long enough.
 *
 * It usually does. But "guardar la última serie y salir" is a real gesture at the
 * end of a session, and the harness in `harness/` puts numbers on it: with a
 * reload one tick after the write, 6 of 25 sets vanish; with two writes in the
 * same tick, 25 of 25 lose at least one; with a burst of ten, all of them.
 *
 * The two tests below are marked `it.fails`: they assert the contract the app
 * *should* meet and are expected to fail today. When the fix lands they will
 * start passing, which makes `it.fails` itself fail — and that is the signal to
 * turn them into ordinary assertions. A red test that keeps the suite green.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");

function sources(dir: string): Array<[string, string]> {
	return readdirSync(join(SRC, dir))
		.filter((name) => /\.tsx?$/.test(name) && !name.includes(".test."))
		.map((name) => [name, readFileSync(join(SRC, dir, name), "utf8")]);
}

describe("T-001 · durabilidad de una serie registrada", () => {
	/**
	 * The direct statement of the bug. Every write goes out unobserved.
	 */
	it.fails("algún sitio espera a que la escritura llegue al disco", () => {
		const awaited = [
			...sources("routes"),
			...sources("components"),
			...sources("db"),
		]
			.filter(([, source]) => source.includes("isPersisted"))
			.map(([name]) => name);

		expect(
			awaited.length,
			"ningún sitio espera isPersisted.promise",
		).toBeGreaterThan(0);
	});

	/**
	 * And the part that turns a race into a certainty: the database is closed on
	 * `pagehide`, which is exactly when pending flushes are still pending. The
	 * harness scenario that fires `pagehide` by hand loses the write 25 times out
	 * of 25.
	 */
	it.fails("al descargar la página no se cierra la base con escrituras pendientes", () => {
		const source = readFileSync(join(SRC, "db", "collections.ts"), "utf8");
		const handler = source.slice(source.indexOf("pagehide"));

		// Either it waits for pending writes, or it does not close at all.
		const waits = /await|isPersisted|flush|pending/.test(handler.slice(0, 400));
		expect(waits, "pagehide cierra la base sin esperar a nada").toBe(true);
	});

	/** What is not in doubt, so the diagnosis does not drift. */
	it("insert() devuelve una transacción, no una promesa de disco", () => {
		const contract = readFileSync(
			join(
				SRC,
				"..",
				"node_modules",
				"@tanstack",
				"db",
				"dist",
				"esm",
				"transactions.d.ts",
			),
			"utf8",
		);
		expect(contract).toMatch(/isPersisted: Deferred<Transaction<T>>/);
		expect(contract).toMatch(/Await `isPersisted\.promise`/);
	});
});
