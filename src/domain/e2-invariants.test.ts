/**
 * The E2 promises that a unit test on a function cannot keep.
 *
 * Three of these are about *who calls what* rather than what a function returns —
 * the same shape of invariant as the one that already forces every screen to read
 * the log through `useRecords`. A wrapper that stops being applied, a display that
 * starts showing an id, a seed that quietly fails to parse: none of them break a
 * function, and all of them break the app.
 *
 * The last two are here because the smoke test found them and nothing else would
 * have. Remembering them is not a plan.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROGRAM } from "./__fixtures__/program";
import { firstPhase } from "./phase-events";
import { Program } from "./schema";

const SRC = join(import.meta.dirname, "..");

const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), "utf8");

function sourcesIn(...dir: string[]): Array<[name: string, source: string]> {
	return readdirSync(join(SRC, ...dir))
		.filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
		.filter((name) => !name.endsWith(".test.ts"))
		.map((name) => [name, read(...dir, name)]);
}

// ------------------------------------------------------------- append-only

describe("phaseEvents sólo crece", () => {
	/**
	 * `db/synced.test.ts` proves the wrapper refuses writes. This proves the
	 * wrapper is actually on the collection — remove it and every unit test still
	 * passes while the log becomes editable.
	 */
	it("la colección está envuelta en appendOnly", () => {
		const source = read("db", "collections.ts");
		expect(source).toMatch(/phaseEvents:\s*appendOnly\(/);
	});

	it("appendOnly va por fuera de syncable, para interceptar antes de estampar", () => {
		const source = read("db", "collections.ts");
		expect(source).toMatch(/appendOnly\(syncable\(phaseEvents\)\)/);
	});

	it("ninguna pantalla llama a update o delete sobre phaseEvents", () => {
		for (const [name, source] of [
			...sourcesIn("routes"),
			...sourcesIn("components"),
		]) {
			expect(source, `${name} edita el log de fases`).not.toMatch(
				/phaseEvents\.(update|delete)\(/,
			);
		}
	});
});

// -------------------------------------------------------------- total function

describe("phaseForDate es total porque siempre hay una fase", () => {
	/**
	 * The floor `phaseForDate` falls back to is the first phase. If a program with
	 * no phases could load, that floor would be `undefined` and the promise that
	 * it never throws would be a sentence rather than a fact.
	 */
	it("un programa sin fases se rechaza al validar", () => {
		const empty = { ...PROGRAM, phases: [] };
		const result = Program.safeParse(empty);

		expect(result.success).toBe(false);
		expect(JSON.stringify(result.error?.issues)).toMatch(/phases/);
	});

	it("con al menos una fase, el suelo existe siempre", () => {
		expect(firstPhase(PROGRAM)).toBeDefined();
		expect(firstPhase({ ...PROGRAM, phases: [PROGRAM.phases[2]] }).id).toBe(
			PROGRAM.phases[2].id,
		);
	});
});

// ------------------------------------------------------- smoke-test regressions

describe("regresiones encontradas en el smoke test", () => {
	/**
	 * The header read "Fase adaptacion Adaptación" for one build: the id was being
	 * printed next to the name. The id is a key, not a label — it is never for
	 * reading, and it stopped being a number precisely so nobody would try.
	 */
	it("ninguna pantalla imprime el id de fase junto al nombre", () => {
		const offenders: string[] = [];

		for (const [name, source] of [
			...sourcesIn("routes"),
			...sourcesIn("components"),
		]) {
			// `{phase.id}`, `{progress.phaseId}` and friends, rendered as text.
			if (/\{\s*[\w.]*phase(Id)?\.id\s*\}/i.test(source)) offenders.push(name);
			if (/Fase \{\s*[\w.]*phaseId\s*\}/i.test(source)) offenders.push(name);
		}

		expect(offenders, "el id de fase no se enseña: usa el nombre").toEqual([]);
	});

	/**
	 * The seed stopped loading when `PhaseId` opened up: the file is written by the
	 * importer, which still counts phases the way the spreadsheet does, so a schema
	 * demanding a string made `safeParse` fail — silently, because the seed's own
	 * design is to do nothing rather than throw. The first session lost its history
	 * and nothing said why.
	 */
	it("el seed acepta la fase numérica que escribe el importador", () => {
		const source = read("lib", "seed.ts");
		expect(source).toMatch(
			/phase:\s*z\.union\(\[z\.number\(\), z\.string\(\)\]\)/,
		);
		expect(source).toMatch(/function phaseIdOf/);
	});

	it("y la traduce al id de la fase que reclama ese número", async () => {
		// The translation itself, exercised through the same mapping the seed uses.
		const byLegacy = new Map(
			PROGRAM.phases
				.filter((phase) => phase.legacyId !== null)
				.map((phase) => [phase.legacyId, phase.id]),
		);

		expect(byLegacy.get(1)).toBe("adaptacion");
		expect(byLegacy.get(4)).toBe("definicion_tesis");
	});
});

// ----------------------------------------------------------------- atomicity

describe("la compuerta de versión y la escritura son atómicas", () => {
	const handler = readFileSync(join(SRC, "..", "api", "sync.ts"), "utf8");

	/**
	 * Read the version, decide, then write in three separate statements and an old
	 * client that checked while the server was still on the old shape can land its
	 * write after a newer client upgraded it. The lock is what closes that gap;
	 * `domain/sync.test.ts` checks the rule, this checks the mechanism is there.
	 */
	it("la fila de versión se toma con for update", () => {
		expect(handler).toMatch(
			/select schema_version from sync_meta[\s\S]*for update/,
		);
	});

	it("la decisión y la escritura ocurren dentro de la misma transacción", () => {
		expect(handler).toMatch(/db\.begin\(/);

		const transaction = handler.slice(
			handler.indexOf("db.begin("),
			handler.lastIndexOf("});"),
		);
		expect(transaction).toMatch(/for update/);
		expect(transaction).toMatch(/insert into records/);
		expect(transaction).toMatch(/update sync_meta set schema_version/);
	});

	it("fuera de la transacción no queda ninguna escritura", () => {
		const outside = handler
			.split("db.begin(")[0]
			.concat(handler.slice(handler.lastIndexOf("});")));

		expect(outside).not.toMatch(/insert into records/);
		expect(outside).not.toMatch(/update sync_meta/);
	});
});
