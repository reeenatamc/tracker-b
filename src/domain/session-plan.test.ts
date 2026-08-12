/**
 * One resolution, two callers.
 *
 * The defect this file exists for was not a wrong number: it was a confident
 * silence. An ankle session from before E3 reconstructed to zero entries and
 * reported `complete` — "everything that was prescribed that day is in here" —
 * about a day whose prescription nobody had gone to look for. The executor knew
 * where an ankle day's plan comes from; recovery did not, and handed it the
 * strength baseline.
 *
 * So the tests worth having are the ones that pin the two paths together and the
 * one that makes `complete` impossible to say about nothing.
 *
 * Read from `content/` when it is there and the public example otherwise, so on
 * this machine this runs against the real protocol.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { BASELINE } from "./__fixtures__/plan";
import { PROGRAM } from "./__fixtures__/program";
import { rehabStageFor } from "./cardio-day";
import {
	AnkleProtocol,
	type PlanAdjustment,
	type SessionRecord,
} from "./schema";
import { ANKLE_TEMPLATE, sessionBaseline } from "./session-plan";
import { reconstruct } from "./snapshot";

const ROOT = join(import.meta.dirname, "..", "..");
const DIR = existsSync(join(ROOT, "content", "ankle-protocol.yaml"))
	? join(ROOT, "content")
	: join(ROOT, "content.example");

const protocol = AnkleProtocol.parse(
	parse(readFileSync(join(DIR, "ankle-protocol.yaml"), "utf8")),
);

/** The fixture programme has no rehab; give it the real protocol to reason about. */
const WITH_REHAB = { ...PROGRAM, ankleRehab: protocol.protocol };
const START = WITH_REHAB.meta.startDate;

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
	return {
		id: "tobillo",
		date: "2026-08-11",
		templateId: ANKLE_TEMPLATE,
		phase: "adaptacion",
		completed: true,
		notes: null,
		startedAt: null,
		endedAt: null,
		skippedExerciseIds: [],
		extraExerciseIds: [],
		prescriptionContract: "legacy",
		snapshotId: null,
		...overrides,
	};
}

const build = (date: string, templateId = ANKLE_TEMPLATE) =>
	sessionBaseline({
		templateId,
		date,
		program: WITH_REHAB,
		seeded: BASELINE,
	});

const rebuild = (
	date: string,
	adjustments: PlanAdjustment[] = [],
	templateId = ANKLE_TEMPLATE,
) => {
	const from = build(date, templateId);
	return reconstruct({
		id: "rec",
		session: session({ date, templateId }),
		phaseId: "adaptacion",
		templateId,
		baseline: from.rows,
		source: {
			datable: adjustments,
			undatable: from.gap ? [from.gap] : [],
		},
		phaseAt: () => "adaptacion",
	});
};

// ------------------------------------------------------------- the ankle day

describe("una sesión de tobillo se reconstruye con su prescripción", () => {
	const snapshot = rebuild(START);

	it("tiene entradas, no cero", () => {
		expect(snapshot.entries.length).toBeGreaterThan(0);
	});

	it("y por eso puede decir complete", () => {
		expect(snapshot.reconstructionConfidence).toBe("complete");
		expect(snapshot.reconstructionGaps).toEqual([]);
		expect(snapshot.status).toBe("reconstructed");
	});

	it("con los ids estables del protocolo", () => {
		for (const entry of snapshot.entries) {
			expect(entry.id).toMatch(/^rehab_/);
		}
		const esperados = rehabStageFor(WITH_REHAB, START)?.exercises.map(
			(e) => `rehab_${e.id}`,
		);
		expect(snapshot.entries.map((e) => e.id).sort()).toEqual(esperados?.sort());
	});

	it("en orden, y sin huecos en la numeración", () => {
		const orders = snapshot.entries.map((e) => e.order);
		expect(orders).toEqual([...orders].sort((a, b) => a - b));
		expect(orders).toEqual(orders.map((_, i) => i + 1));
	});

	/** La semana decide qué etapa tocaba: reconstruir agosto no es reconstruir hoy. */
	it("los ejercicios son los de esa fecha, no los de otra semana", () => {
		const etapas = [...new Set(protocol.protocol.map((entry) => entry.stage))];
		if (etapas.length < 2) return;

		const primera = rebuild(START);
		const tarde = rebuild("2027-06-01");
		expect(primera.entries.map((e) => e.id)).not.toEqual(
			tarde.entries.map((e) => e.id),
		);
	});
});

// ------------------------------------------------------------- with adjustments

describe("y los ajustes de un hueco rehab entran igual", () => {
	const primero = rehabStageFor(WITH_REHAB, START)?.exercises[0];
	const entryId = `rehab_${primero?.id}`;

	const subir = (effectiveOn: string): PlanAdjustment => ({
		kind: "set_field",
		id: `adj_${effectiveOn}`,
		entryId,
		change: { field: "sets", value: 7 },
		effectiveOn,
		onlyInPhase: null,
		origin: "manual",
		reason: "prueba",
		evidenceIds: [],
		provenance: { kind: "authored" },
		createdAt: 0,
	});

	it("uno vigente aquel día se incorpora", () => {
		const snapshot = rebuild(START, [subir("2026-01-01")]);
		expect(snapshot.entries.find((e) => e.id === entryId)?.sets).toBe(7);
		expect(snapshot.reconstructionConfidence).toBe("complete");
	});

	it("y uno posterior a la sesión no", () => {
		const snapshot = rebuild(START, [subir("2027-01-01")]);
		expect(snapshot.entries.find((e) => e.id === entryId)?.sets).toBe(
			primero?.sets,
		);
	});
});

// ------------------------------------------------- one function, both callers

describe("congelar y reconstruir leen del mismo sitio", () => {
	/**
	 * Lo que impide que vuelvan a divergir. Si el ejecutor construyera sus filas
	 * de tobillo por su cuenta, la sesión de hoy y la misma sesión reconstruida
	 * mañana dirían cosas distintas sobre el mismo día.
	 */
	it("el ejecutor pide la base a `sessionBaseline`", () => {
		const source = readFileSync(
			join(import.meta.dirname, "..", "routes", "index.tsx"),
			"utf8",
		);
		expect(source).toContain("sessionBaseline({");
		// Y ya no las construye a mano.
		expect(source).not.toContain("rehabAsEntry(");
	});

	it("y la recuperación también, por sesión", () => {
		const source = readFileSync(
			join(import.meta.dirname, "..", "lib", "recover-snapshots.ts"),
			"utf8",
		);
		expect(source).toContain("input.baselineFor(session)");
	});

	it("las dos producen los mismos huecos para el mismo día", () => {
		const paraCongelar = build(START).rows.map((r) => `${r.id}|${r.order}`);
		const paraReconstruir = rebuild(START).entries.map(
			(e) => `${e.id}|${e.order}`,
		);
		expect(paraReconstruir).toEqual(paraCongelar);
	});
});

// ------------------------------------------------- when it genuinely cannot

describe("cuando de verdad no se puede reconstruir", () => {
	it("una plantilla que no está en el programa se nombra", () => {
		const from = build(START, "plantilla_fantasma");
		expect(from.rows).toEqual([]);
		expect(from.gap).toContain("plantilla_fantasma");
	});

	it("y la reconstrucción sale partial, con el motivo", () => {
		const snapshot = rebuild(START, [], "plantilla_fantasma");
		expect(snapshot.reconstructionConfidence).toBe("partial");
		expect(snapshot.reconstructionGaps).toHaveLength(1);
		expect(snapshot.reconstructionGaps[0]).toContain("plantilla_fantasma");
	});

	it("un día de tobillo sin protocolo también", () => {
		const from = sessionBaseline({
			templateId: ANKLE_TEMPLATE,
			date: START,
			program: { ...PROGRAM, ankleRehab: [] },
			seeded: BASELINE,
		});
		expect(from.gap).toContain("protocolo de tobillo");
	});

	it("y una plantilla de fuerza sin sembrar", () => {
		const from = sessionBaseline({
			templateId: PROGRAM.sessions[0].id,
			date: START,
			program: WITH_REHAB,
			seeded: [],
		});
		expect(from.gap).toContain("base sembrada");
	});
});

// ------------------------------------------------------------- the invariant

describe("complete nunca describe una prescripción vacía", () => {
	/**
	 * La red de seguridad: aunque nadie nombre el hueco, una reconstrucción sin
	 * entradas no puede declararse completa. Decir «lo tengo todo» sobre nada es
	 * peor que admitir que no se sabe.
	 */
	it("sin entradas y sin motivo, se inventa el motivo antes que decir complete", () => {
		const snapshot = reconstruct({
			id: "rec",
			session: session(),
			phaseId: "adaptacion",
			templateId: "vacia",
			baseline: [],
			source: { datable: [], undatable: [] },
			phaseAt: () => "adaptacion",
		});

		expect(snapshot.entries).toEqual([]);
		expect(snapshot.reconstructionConfidence).toBe("partial");
		expect(snapshot.reconstructionGaps).toHaveLength(1);
		expect(snapshot.reconstructionGaps[0]).toContain("vacia");
	});

	it("y con entradas sí puede", () => {
		const snapshot = rebuild(START);
		expect(snapshot.entries.length).toBeGreaterThan(0);
		expect(snapshot.reconstructionConfidence).toBe("complete");
	});
});
