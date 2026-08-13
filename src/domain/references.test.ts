/**
 * One declaration of who points at whom.
 *
 * The closure check and the guard below read the same table on purpose. A
 * hand-kept list fails the day someone adds a fourth kind of reference and
 * updates only one of the two places — and then the cut validates against a rule
 * that stopped describing the data, which is worse than not validating at all.
 *
 * So the last test here reads `schema.ts` and fails if any variant of either log
 * carries an id-shaped field that nobody declared.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	adjustmentReferences,
	allReferences,
	danglingReferences,
	phaseEventReferences,
	SEMANTIC_REFERENCES,
} from "./references";
import type { PhaseEvent, PlanAdjustment } from "./schema";

const setSets = (id: string): PlanAdjustment => ({
	kind: "set_field",
	id,
	entryId: "slot_a_01",
	change: { field: "sets", value: 3 },
	effectiveOn: "2026-10-01",
	onlyInPhase: null,
	origin: "manual",
	reason: "prueba",
	evidenceIds: [],
	provenance: { kind: "authored" },
	createdAt: 0,
});

const revoke = (id: string, revokesId: string): PlanAdjustment => ({
	kind: "revoke",
	id,
	revokesId,
	effectiveOn: "2026-11-01",
	onlyInPhase: null,
	origin: "manual",
	reason: "prueba",
	evidenceIds: [],
	provenance: { kind: "authored" },
	createdAt: 0,
});

const transition = (id: string): PhaseEvent => ({
	kind: "transition",
	id,
	fromPhaseId: null,
	toPhaseId: "adaptacion",
	occurredOn: "2026-08-10",
	plannedFor: "2026-08-10",
	trigger: "planned",
	reason: "",
	reviewId: null,
	createdAt: 0,
});

const correction = (id: string, supersedesId: string): PhaseEvent => ({
	kind: "correction",
	id,
	supersedesId,
	fromPhaseId: null,
	toPhaseId: "adaptacion",
	occurredOn: "2026-08-12",
	plannedFor: "2026-08-10",
	trigger: "planned",
	reason: "",
	reviewId: null,
	createdAt: 1,
});

const phaseRevocation = (id: string, revokesId: string): PhaseEvent => ({
	kind: "revocation",
	id,
	revokesId,
	reason: "no ocurrió",
	createdAt: 2,
});

// -------------------------------------------------------------- extraction

describe("qué referencias lleva cada fila", () => {
	it("un ajuste normal no apunta a nada", () => {
		expect(adjustmentReferences(setSets("A1"))).toEqual([]);
	});

	it("una revocación de ajuste apunta a su objetivo", () => {
		expect(adjustmentReferences(revoke("R1", "A1"))).toEqual([
			{ fromId: "R1", toId: "A1", log: "adjustments", via: "revoke.revokesId" },
		]);
	});

	it("una transición de fase no apunta a nada", () => {
		expect(phaseEventReferences(transition("E1"))).toEqual([]);
	});

	it("una corrección de fase apunta a lo que sustituye", () => {
		expect(phaseEventReferences(correction("E2", "E1"))).toEqual([
			{
				fromId: "E2",
				toId: "E1",
				log: "phaseEvents",
				via: "correction.supersedesId",
			},
		]);
	});

	/** La que faltaba, y la que motivó este módulo. */
	it("una revocación de fase también", () => {
		expect(phaseEventReferences(phaseRevocation("E3", "E1"))).toEqual([
			{
				fromId: "E3",
				toId: "E1",
				log: "phaseEvents",
				via: "revocation.revokesId",
			},
		]);
	});

	it("las junta todas", () => {
		expect(
			allReferences({
				adjustments: [setSets("A1"), revoke("R1", "A1")],
				phaseEvents: [transition("E1"), correction("E2", "E1")],
			}),
		).toHaveLength(2);
	});
});

// ----------------------------------------------------------------- closure

describe("el cierre referencial", () => {
	const closed = {
		adjustments: [setSets("A1"), revoke("R1", "A1")],
		phaseEvents: [transition("E1"), correction("E2", "E1")],
		knownAdjustmentIds: new Set(["A1", "R1"]),
		knownPhaseEventIds: new Set(["E1", "E2"]),
	};

	it("un conjunto cerrado no reporta nada", () => {
		expect(danglingReferences(closed)).toEqual([]);
	});

	it("una revocación de ajuste hacia fuera se reporta", () => {
		expect(
			danglingReferences({
				...closed,
				knownAdjustmentIds: new Set(["R1"]),
			}),
		).toEqual([
			{ fromId: "R1", toId: "A1", log: "adjustments", via: "revoke.revokesId" },
		]);
	});

	it("una corrección de fase hacia fuera se reporta", () => {
		expect(
			danglingReferences({ ...closed, knownPhaseEventIds: new Set(["E2"]) }),
		).toEqual([
			{
				fromId: "E2",
				toId: "E1",
				log: "phaseEvents",
				via: "correction.supersedesId",
			},
		]);
	});

	it("una revocación de fase hacia fuera se reporta", () => {
		expect(
			danglingReferences({
				adjustments: [],
				phaseEvents: [phaseRevocation("E3", "E1")],
				knownAdjustmentIds: new Set(),
				knownPhaseEventIds: new Set(["E3"]),
			}),
		).toEqual([
			{
				fromId: "E3",
				toId: "E1",
				log: "phaseEvents",
				via: "revocation.revokesId",
			},
		]);
	});

	it("reporta todas a la vez, no la primera", () => {
		expect(
			danglingReferences({
				adjustments: [revoke("R1", "A1")],
				phaseEvents: [correction("E2", "E1"), phaseRevocation("E3", "E9")],
				knownAdjustmentIds: new Set(["R1"]),
				knownPhaseEventIds: new Set(["E2", "E3"]),
			}),
		).toHaveLength(3);
	});

	it("no confunde los dos logs: un id de fase no cierra un ajuste", () => {
		expect(
			danglingReferences({
				adjustments: [revoke("R1", "E1")],
				phaseEvents: [transition("E1")],
				knownAdjustmentIds: new Set(["R1"]),
				knownPhaseEventIds: new Set(["E1"]),
			}),
		).toHaveLength(1);
	});
});

// -------------------------------------------------------------- the guard

describe("la tabla no puede quedarse corta", () => {
	const schema = readFileSync(join(import.meta.dirname, "schema.ts"), "utf8");

	/** El bloque de una unión discriminada, para mirar sólo dentro. */
	function unionBody(name: string): string {
		const start = schema.indexOf(
			`export const ${name} = z.discriminatedUnion(`,
		);
		expect(start, name).toBeGreaterThan(-1);
		const end = schema.indexOf("\n]);", start);
		return schema.slice(start, end);
	}

	/**
	 * Lo que impide que una cuarta referencia se añada sin cubrirse: cualquier
	 * campo `…Id` dentro de una variante, que no sea el `id` propio ni una lista,
	 * tiene que estar declarado en `SEMANTIC_REFERENCES`.
	 */
	const declared = new Set(SEMANTIC_REFERENCES.map((r) => r.field));

	it("cubre todo campo que nombra a otra fila del log de ajustes", () => {
		const campos = [...unionBody("PlanAdjustment").matchAll(/\n\t+(\w+Id):/g)]
			.map((match) => match[1])
			.filter((field) => field !== "entryId");

		const sinCubrir = [...new Set(campos)].filter((f) => !declared.has(f));
		expect(
			sinCubrir,
			"añádelos a SEMANTIC_REFERENCES en references.ts",
		).toEqual([]);
	});

	it("y del log de fases", () => {
		const campos = [...unionBody("PhaseEvent").matchAll(/\n\t+(\w+Id):/g)].map(
			(match) => match[1],
		);
		// `toPhaseId`, `fromPhaseId` y `reviewId` no nombran otra fila de este log.
		const externos = new Set(["toPhaseId", "fromPhaseId", "reviewId"]);
		const sinCubrir = [...new Set(campos)].filter(
			(f) => !declared.has(f) && !externos.has(f),
		);
		expect(
			sinCubrir,
			"añádelos a SEMANTIC_REFERENCES en references.ts",
		).toEqual([]);
	});

	it("y no declara referencias que no existan", () => {
		for (const reference of SEMANTIC_REFERENCES) {
			const body = unionBody(
				reference.log === "adjustments" ? "PlanAdjustment" : "PhaseEvent",
			);
			expect(body, `${reference.kind}.${reference.field}`).toContain(
				`${reference.field}:`,
			);
		}
	});
});
