/**
 * That there is one declaration, and that everyone reads it.
 *
 * The bug this guards against never looked like a bug. `phaseEvents` was added
 * to the endpoint in E2 and to the backup, and not to the client's push list;
 * E3 did the same with three more. Nothing threw, no test failed, and the data
 * simply stayed on one device — which is the worst shape a defect can take,
 * because the only symptom is a second device quietly holding a different plan.
 *
 * So these tests are not about the values. They are about there being nowhere
 * else for a value to live: a hand-written array in the client or the endpoint
 * is the defect, whatever it happens to contain on the day it is written.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	BACKED_UP_COLLECTIONS,
	COLLECTION_POLICY,
	type CollectionName,
	SYNCED_COLLECTIONS,
} from "./collection-policy";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (...path: string[]) => readFileSync(join(ROOT, ...path), "utf8");

const collections = read("src", "db", "collections.ts");
const client = read("src", "lib", "sync-client.ts");
const endpoint = read("api", "sync.ts");
const backup = read("src", "lib", "backup.ts");

/** The `raw` literal in `db/collections.ts` — the database as it really is. */
function collectionsInDatabase(): string[] {
	const start = collections.indexOf("const raw = {");
	const end = collections.indexOf("} satisfies", start);
	expect(start, "no encuentro el literal `raw`").toBeGreaterThan(-1);
	expect(end, "`raw` ya no lleva `satisfies`").toBeGreaterThan(start);
	return collections
		.slice(start, end)
		.split("\n")
		.map((line) => line.trim().replace(/,$/, ""))
		.filter((line) => /^[a-zA-Z]+$/.test(line));
}

// ------------------------------------------------------------------ cobertura

describe("toda colección de la base declara su política", () => {
	it("las mismas, ni una más ni una menos", () => {
		expect(collectionsInDatabase().sort()).toEqual(
			Object.keys(COLLECTION_POLICY).sort(),
		);
	});

	/**
	 * El typecheck ya lo impide —`raw` lleva `satisfies Record<CollectionName,
	 * object>`—, y esta prueba dice por qué está ahí, que es lo que se pierde
	 * cuando alguien lo quita por parecer decorativo.
	 */
	it("y `raw` conserva el `satisfies` que lo hace fallar", () => {
		expect(collections).toContain("} satisfies Record<CollectionName, object>");
	});

	it("ninguna política se queda sin decidir", () => {
		for (const [name, policy] of Object.entries(COLLECTION_POLICY)) {
			expect(["synced", "backup-only", "local-only"], name).toContain(policy);
		}
	});
});

// -------------------------------------------------------------- E4: las doce

describe("en E4 sincronizan doce colecciones", () => {
	it("las siete originales, las cuatro de E2 y E3, y la de E4", () => {
		expect(SYNCED_COLLECTIONS).toEqual([
			"sessions",
			"sets",
			"ankleChecks",
			"overrides",
			"customExercises",
			"progressChecks",
			"inspo",
			"phaseEvents",
			"prescriptionBaseline",
			"planAdjustments",
			"planSnapshots",
			"planVersions",
		]);
	});

	/**
	 * Las cuatro que llevaban desde E2 y E3 sin viajar, y la que E4 añade
	 * ampliando la misma declaración en vez de abrir otra lista.
	 */
	it("las cinco que no estaban en la lista original están dentro", () => {
		for (const name of [
			"phaseEvents",
			"prescriptionBaseline",
			"planAdjustments",
			"planSnapshots",
			"planVersions",
		] as CollectionName[]) {
			expect(SYNCED_COLLECTIONS, name).toContain(name);
		}
	});

	it("y el respaldo lleva al menos lo que sincroniza", () => {
		for (const name of SYNCED_COLLECTIONS) {
			expect(BACKED_UP_COLLECTIONS, name).toContain(name);
		}
	});
});

// ------------------------------------------------- nadie mantiene otra lista

describe("cliente, servidor y respaldo leen la misma declaración", () => {
	it("el cliente no declara la suya", () => {
		expect(client).toContain('from "@/domain/collection-policy"');
		expect(client).not.toContain("const COLLECTION_KEYS = [");
	});

	it("el endpoint tampoco", () => {
		expect(endpoint).toContain('from "../src/domain/collection-policy"');
		expect(endpoint).toContain("new Set<string>(SYNCED_COLLECTIONS)");
		expect(endpoint).not.toContain("const COLLECTIONS = new Set([");
	});

	it("el respaldo tampoco", () => {
		expect(backup).toContain("const COLLECTION_KEYS = BACKED_UP_COLLECTIONS");
	});

	/**
	 * La prueba con más futuro de las tres: prohíbe el patrón, no el contenido.
	 * Una lista literal de nombres de colección en cualquiera de los tres es
	 * exactamente cómo volvería a pasar.
	 */
	it("ninguno vuelve a escribir una lista literal de colecciones", () => {
		for (const [nombre, fuente] of [
			["cliente", client],
			["endpoint", endpoint],
			["respaldo", backup],
		] as const) {
			const literales = [
				...fuente.matchAll(/\[\s*\n(\s*"[a-zA-Z]+",\s*\n){5,}/g),
			];
			expect(
				literales.map((m) => m[0]),
				nombre,
			).toEqual([]);
		}
	});
});

// --------------------------------------------------------- el endpoint acepta

describe("el servidor acepta exactamente lo que el cliente envía", () => {
	it("una colección que el cliente no conoce no tiene por qué estar", () => {
		// Ambos derivan de la misma constante, así que la igualdad es estructural
		// y no una coincidencia que haya que revisar a mano cada etapa.
		expect(endpoint).not.toMatch(/COLLECTIONS = new Set\(\[/);
	});
});
