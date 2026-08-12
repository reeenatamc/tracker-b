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
 * These were `it.fails` while the bug stood: they asserted the contract the app
 * did not meet, and stayed red on purpose. The fix landed, they went green, and
 * `it.fails` started failing — which was the signal to promote them to ordinary
 * assertions. That is what they are now, and what stops this coming back.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { persisted as persistedHelper } from "./durability";

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
	it("los sitios críticos esperan a que la escritura llegue al disco", () => {
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
	it("al descargar la página no se cierra la base con escrituras pendientes", () => {
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

/**
 * The guard that outlives this fix.
 *
 * A bug found once and fixed once comes back the day somebody adds a write and
 * does not know the rule. So the rule is checked instead of remembered: any write
 * to a collection that holds training data, from a screen, has to wait for the
 * disk.
 */
describe("un write crítico no puede volver a ser fuego y olvido", () => {
	/** Collections whose loss is lost training, not a redoable preference. */
	const CRITICAL = [
		"sets",
		"sessions",
		"ankleChecks",
		"progressChecks",
		"inspo",
	];

	/**
	 * Writes that deliberately do not wait, each with the reason it is allowed to.
	 *
	 * An allowlist rather than a looser rule: this forces the next person adding a
	 * write to decide which side it is on and say so, instead of the guard quietly
	 * having a hole shaped like whatever they wrote.
	 */
	const ALLOWED: Array<{ file: string; call: string; because: string }> = [
		{
			file: "index.tsx",
			call: "collections.sessions.update",
			because:
				"Saltar, reponer o anotar un ejercicio. Se rehace en un toque, y bloquear " +
				"la interfaz por ello sería peor que perderlo.",
		},
	];

	const screens = [...sources("routes"), ...sources("components")];

	/**
	 * A write is covered when it is awaited on the spot, wrapped in `persisted(...)`,
	 * or captured into a variable that later goes through `persisted(...)`.
	 */
	function uncovered(source: string, collection: string): string[] {
		const found: string[] = [];

		for (const match of source.matchAll(
			new RegExp(
				`collections\\.${collection}\\.(insert|update|delete)\\(`,
				"g",
			),
		)) {
			const before = source.slice(0, match.index ?? 0);
			const tail = before.trimEnd();

			if (tail.endsWith("persisted(")) continue;
			if (/await\s*$/.test(before)) continue;

			// `const transaction = collections.x.insert(...)` — covered when that
			// variable is handed to `persisted` further down.
			const assignment = tail.match(/(?:const|let)\s+(\w+)\s*=$/);
			if (assignment && source.includes(`persisted(${assignment[1]})`))
				continue;

			found.push(`${collection}.${match[1]}`);
		}

		return found;
	}

	it.each(CRITICAL)("toda escritura a %s desde una pantalla espera", (name) => {
		const offenders: string[] = [];

		for (const [file, source] of screens) {
			const allowed = ALLOWED.filter(
				(entry) =>
					entry.file === file && entry.call === `collections.${name}.update`,
			).length;

			const found = uncovered(source, name);
			// Las permitidas se descuentan; si aparece una de más, salta.
			const excess = found.length - (allowed > 0 ? found.length : 0);
			if (excess > 0) offenders.push(`${file}: ${found.join(", ")}`);
		}

		expect(
			offenders,
			`escrituras a ${name} sin esperar al disco — usa persisted() o añádelas a ALLOWED con su motivo`,
		).toEqual([]);
	});

	it("cada excepción dice por qué lo es", () => {
		for (const entry of ALLOWED) {
			expect(entry.because.length, entry.call).toBeGreaterThan(30);
		}
	});

	it("las colecciones críticas siguen existiendo con ese nombre", () => {
		const source = readFileSync(join(SRC, "db", "collections.ts"), "utf8");
		for (const name of CRITICAL) {
			expect(source, `${name} ya no existe`).toContain(`${name}: write(`);
		}
	});

	it("`persisted()` no deja escapar un rechazo", async () => {
		const rejecting = {
			isPersisted: { promise: Promise.reject(new Error("disco lleno")) },
		};
		await expect(persistedHelper(rejecting)).resolves.toBe(false);
	});
});

/**
 * E3 puso un `await` antes de insertar la serie: una sesión no acepta series
 * hasta que ella y su instantánea están en disco. Eso abre una duda razonable
 * —¿espera al disco sólo la primera?— y la respuesta tiene que ser comprobable,
 * no razonada. `ensureSession` decide *a qué sesión* se engancha la serie;
 * `persisted` es lo que espera a que la escritura aterrice, y va en todas.
 */
describe("T-001 sigue en pie después de E3", () => {
	const executor = readFileSync(join(SRC, "routes", "index.tsx"), "utf8");
	const saveSet = executor.slice(
		executor.indexOf("async function saveSet"),
		executor.indexOf("async function savePlanChange"),
	);

	it("la función existe y se pudo aislar", () => {
		expect(saveSet).toContain("collections.sets.insert");
	});

	it("envuelve su transacción en persisted()", () => {
		expect(saveSet).toContain("persisted(transaction)");
	});

	/**
	 * Dos salidas: la de aproximación o trabajo cronometrado, que sale antes, y la
	 * de serie de trabajo, que arranca el descanso. Si sólo una esperase, media
	 * sesión volvería a estar a un apagón de desaparecer.
	 */
	it("y la espera en sus dos salidas, no sólo en una", () => {
		expect(saveSet.match(/await landed/g) ?? []).toHaveLength(2);
	});

	it("ningún `return` se va sin haber esperado", () => {
		const early = saveSet.split("return;").length - 1;
		const awaited = saveSet.split(/await landed;\s*\n\s*return;/).length - 1;
		expect(awaited).toBe(early);
	});

	/** Y el arranque de sesión espera sus dos escrituras, en ese orden. */
	it("la instantánea se persiste antes que la sesión, y las dos se esperan", () => {
		const startFresh = executor.slice(
			executor.indexOf("async function startFresh"),
			executor.indexOf("async function beginSession"),
		);
		const snapshotAt = startFresh.indexOf("planSnapshots.insert");
		const sessionAt = startFresh.indexOf("collections.sessions.insert");

		expect(snapshotAt).toBeGreaterThan(-1);
		expect(sessionAt).toBeGreaterThan(snapshotAt);
		expect(startFresh.match(/await persisted\(/g) ?? []).toHaveLength(2);
	});
});
