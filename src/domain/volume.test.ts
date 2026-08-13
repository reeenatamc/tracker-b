/**
 * Planned volume, and the line it must not cross.
 *
 * The last describe is the one with teeth. Everything else here is arithmetic;
 * that one is a structural guard that fails the day someone imports the muscle
 * classification into this file — which would be an easy, reasonable-looking
 * change that quietly makes a historical diff depend on metadata that gets
 * corrected.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASELINE } from "./__fixtures__/plan";
import type { PrescriptionEntry, SetCount } from "./schema";
import type { VersionPlan } from "./versions";
import { diffVolume, plannedSets } from "./volume";

const entry = (id: string, sets: SetCount): PrescriptionEntry => ({
	id,
	templateId: "template_a",
	exerciseId: "lat_pulldown",
	order: 1,
	sets,
	target: { kind: "reps", min: 10, max: 12 },
	load: BASELINE[0].load,
	rir: null,
	restSeconds: null,
	trainingRole: "strength",
	goal: "",
	progression: "",
	cues: [],
	allowedSubstitutions: [],
});

const plan = (entries: Record<string, PrescriptionEntry[]>): VersionPlan =>
	new Map(Object.entries(entries));

// ------------------------------------------------------------------ counting

describe("cuántas series planifica un hueco", () => {
	it("un número es él mismo", () => {
		expect(plannedSets(3)).toBe(3);
	});

	/** Por el tope: contar por el mínimo escondería un aumento. */
	it("un rango cuenta por su tope", () => {
		expect(plannedSets([2, 3])).toBe(3);
	});

	it("sin programar cuenta cero", () => {
		expect(plannedSets(null)).toBe(0);
	});
});

// ---------------------------------------------------------------------- diff

describe("el diff de volumen", () => {
	it("por plantilla, con su delta", () => {
		const diff = diffVolume(
			plan({ template_a: [entry("s1", 2), entry("s2", 2)] }),
			plan({ template_a: [entry("s1", 3), entry("s2", 2)] }),
		);
		expect(diff.byTemplate).toEqual([
			{ templateId: "template_a", from: 4, to: 5, delta: 1 },
		]);
	});

	it("el total es la suma de las plantillas", () => {
		const diff = diffVolume(
			plan({ a: [entry("s1", 2)], b: [entry("s2", 3)] }),
			plan({ a: [entry("s1", 4)], b: [entry("s2", 3)] }),
		);
		expect(diff.total).toEqual({ from: 5, to: 7, delta: 2 });
		expect(diff.byTemplate.reduce((n, row) => n + row.from, 0)).toBe(
			diff.total.from,
		);
	});

	it("una plantilla que sólo está en una de las dos cuenta cero en la otra", () => {
		const diff = diffVolume(
			plan({ a: [entry("s1", 2)] }),
			plan({ b: [entry("s2", 3)] }),
		);
		expect(diff.byTemplate).toEqual([
			{ templateId: "a", from: 2, to: 0, delta: -2 },
			{ templateId: "b", from: 0, to: 3, delta: 3 },
		]);
	});

	it("un hueco sin programar no suma", () => {
		const diff = diffVolume(
			plan({ a: [entry("s1", 2), entry("s2", null)] }),
			plan({ a: [entry("s1", 2), entry("s2", 2)] }),
		);
		expect(diff.total).toEqual({ from: 2, to: 4, delta: 2 });
	});

	it("contra sí misma da cero", () => {
		const uno = plan({ a: [entry("s1", 2)] });
		expect(diffVolume(uno, uno).total.delta).toBe(0);
	});

	it("invertir los argumentos invierte el signo", () => {
		const a = plan({ t: [entry("s1", 2)] });
		const b = plan({ t: [entry("s1", 5)] });
		expect(diffVolume(a, b).total.delta).toBe(3);
		expect(diffVolume(b, a).total.delta).toBe(-3);
	});
});

// ------------------------------------------------------------------- la línea

describe("el volumen no depende de la biblioteca", () => {
	const source = readFileSync(join(import.meta.dirname, "volume.ts"), "utf8");
	/**
	 * Sin comentarios: la regla es «no lo usa», no «no lo menciona». El módulo
	 * explica en prosa por qué no hay desglose por músculo, y esa explicación es
	 * justo lo que hay que conservar.
	 */
	const code = source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/[^\n]*/g, "");

	/**
	 * La guarda que importa. Un desglose por músculo dependería de una
	 * clasificación corregible, y corregirla movería un diff histórico aunque
	 * ninguna de las dos versiones hubiera cambiado. Eso es E5.
	 */
	it("no importa la clasificación muscular", () => {
		for (const forbidden of [
			"groupOf",
			"muscles",
			"MuscleGroup",
			"countsAsMuscularVolume",
			"library",
		]) {
			expect(code, forbidden).not.toContain(forbidden);
		}
	});

	it("y el tipo no expone desglose por músculo", () => {
		expect(code).not.toContain("byMuscle");
	});

	it("sólo cuenta lo que está en la prescripción resuelta", () => {
		// `sets` y nada más: ni carga, ni reps, ni nada realizado.
		expect(code).not.toContain("SetRecord");
		expect(code).toContain("plannedSets");
	});
});
