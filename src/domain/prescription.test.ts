/**
 * Folding the plan.
 *
 * The four structural changes get most of the attention, because the previous
 * model could only touch fields of things that already existed — and a diff that
 * promises "added" and "removed" needs a model that can express them.
 *
 * The one that matters most is `replace_exercise` inheriting nothing: twenty kilos
 * on one machine are not twenty on another, and a cue written for the movement
 * that left is a wrong instruction that looks deliberate.
 */

import { describe, expect, it } from "vitest";
import { BASELINE, makeAdjustment, REPLACEMENT } from "./__fixtures__/plan";
import { resolvePrescription, resolveWholePlan } from "./prescription";
import type { PlanAdjustment, PrescriptionEntry } from "./schema";

const PHASE = () => "progresion";
const live = (effectiveOn: string) => ({ effectiveOn, knows: null });

const resolve = (adjustments: PlanAdjustment[], date = "2026-11-01") =>
	resolvePrescription(BASELINE, adjustments, "template_a", live(date), PHASE);

const byId = (entries: PrescriptionEntry[], id: string) =>
	entries.find((entry) => entry.id === id);

describe("sin ajustes es la base", () => {
	it("devuelve los huecos en orden", () => {
		expect(resolve([]).map((entry) => entry.id)).toEqual([
			"slot_a_01",
			"slot_a_02",
		]);
	});

	it("con sus valores de partida", () => {
		expect(byId(resolve([]), "slot_a_01")?.sets).toBe(2);
		expect(byId(resolve([]), "slot_a_02")?.sets).toBe(3);
	});

	it("no mezcla plantillas", () => {
		const other = resolvePrescription(
			BASELINE,
			[],
			"template_b",
			live("2026-11-01"),
			PHASE,
		);
		expect(other).toEqual([]);
	});
});

describe("set_field", () => {
	it("escribe su campo y deja el resto", () => {
		const entry = byId(resolve([makeAdjustment()]), "slot_a_01");
		expect(entry?.sets).toBe(3);
		expect(entry?.exerciseId).toBe("lat_pulldown");
		expect(entry?.rir).toEqual({ min: 2, max: 2 });
	});

	it("los tres campos que se añadieron en la última revisión", () => {
		const entries = resolve([
			makeAdjustment({ id: "g", change: { field: "goal", value: "otro" } }),
			makeAdjustment({
				id: "p",
				change: { field: "progression", value: "por reps" },
			}),
			makeAdjustment({ id: "o", change: { field: "order", value: 9 } }),
		]);
		const entry = byId(entries, "slot_a_01");

		expect(entry?.goal).toBe("otro");
		expect(entry?.progression).toBe("por reps");
		expect(entry?.order).toBe(9);
		// Reordenar de verdad reordena.
		expect(entries.map((e) => e.id)).toEqual(["slot_a_02", "slot_a_01"]);
	});

	it("el último por precedencia gana", () => {
		const entries = resolve([
			makeAdjustment({ id: "a", change: { field: "sets", value: 3 } }),
			makeAdjustment({
				id: "b",
				change: { field: "sets", value: 5 },
				effectiveOn: "2026-10-20",
			}),
		]);
		expect(byId(entries, "slot_a_01")?.sets).toBe(5);
	});
});

describe("cambios estructurales", () => {
	it("add_entry añade un hueco", () => {
		const added: PlanAdjustment = {
			kind: "add_entry",
			id: "adj_add",
			entry: {
				id: "slot_runtime_xyz",
				templateId: "template_a",
				exerciseId: "biceps_curl",
				order: 3,
				sets: 2,
				target: { kind: "reps", min: 10, max: 12 },
				load: BASELINE[0].load,
				rir: null,
				restSeconds: null,
				trainingRole: "strength",
				goal: "",
				progression: "",
				cues: [],
				allowedSubstitutions: [],
			},
			effectiveOn: "2026-10-01",
			onlyInPhase: null,
			origin: "manual",
			reason: "prueba",
			evidenceIds: [],
			provenance: { kind: "authored" },
			createdAt: 0,
		};

		expect(resolve([added]).map((entry) => entry.id)).toEqual([
			"slot_a_01",
			"slot_a_02",
			"slot_runtime_xyz",
		]);
	});

	it("remove_entry retira un hueco sin borrarlo del historial", () => {
		const removed: PlanAdjustment = {
			kind: "remove_entry",
			id: "adj_rm",
			entryId: "slot_a_02",
			effectiveOn: "2026-10-01",
			onlyInPhase: null,
			origin: "manual",
			reason: "prueba",
			evidenceIds: [],
			provenance: { kind: "authored" },
			createdAt: 0,
		};

		expect(resolve([removed]).map((entry) => entry.id)).toEqual(["slot_a_01"]);
		// Antes de su fecha de efecto sigue estando.
		expect(resolve([removed], "2026-09-01").map((e) => e.id)).toHaveLength(2);
	});

	describe("replace_exercise", () => {
		const replace: PlanAdjustment = {
			kind: "replace_exercise",
			id: "adj_swap",
			entryId: "slot_a_01",
			entry: REPLACEMENT,
			safetyResolution: null,
			effectiveOn: "2026-10-01",
			onlyInPhase: null,
			origin: "manual",
			reason: "la máquina se rompió",
			evidenceIds: [],
			provenance: { kind: "authored" },
			createdAt: 0,
		};

		it("conserva el id del hueco", () => {
			const entry = byId(resolve([replace]), "slot_a_01");
			expect(entry?.id).toBe("slot_a_01");
			expect(entry?.exerciseId).toBe("chest_press");
		});

		/** Lo que no puede pasar: heredar el estado del ocupante anterior. */
		it("no hereda carga, señales ni objetivo del anterior", () => {
			const entry = byId(resolve([replace]), "slot_a_01");

			expect(entry?.load.startKg).toBe(30);
			expect(entry?.cues).toEqual(["no llegar al fallo"]);
			expect(entry?.cues).not.toContain("agarre cómodo");
			expect(entry?.goal).toBe("empuje horizontal");
			expect(entry?.rir).toEqual({ min: 1, max: 2 });
			expect(entry?.restSeconds).toEqual({ min: 120, max: 120 });
		});

		it("y antes de su fecha el hueco sigue con el ocupante viejo", () => {
			expect(
				byId(resolve([replace], "2026-09-01"), "slot_a_01")?.exerciseId,
			).toBe("lat_pulldown");
		});
	});
});

describe("resolveWholePlan", () => {
	it("devuelve una entrada por plantilla", () => {
		const whole = resolveWholePlan(BASELINE, [], live("2026-11-01"), PHASE);
		expect([...whole.keys()]).toEqual(["template_a"]);
		expect(whole.get("template_a")).toHaveLength(2);
	});
});

describe("el corte de conocimiento", () => {
	const adjustment = makeAdjustment();

	it("en vivo usa todo lo presente", () => {
		expect(byId(resolve([adjustment]), "slot_a_01")?.sets).toBe(3);
	});

	it("un corte que lo excluye devuelve la base", () => {
		const entries = resolvePrescription(
			BASELINE,
			[adjustment],
			"template_a",
			{ effectiveOn: "2026-11-01", knows: { adjustmentIds: [] } },
			PHASE,
		);
		expect(byId(entries, "slot_a_01")?.sets).toBe(2);
	});

	/**
	 * El tipo del corte sólo acota ajustes. Se prueba para que no aparente lo que
	 * no hace: acotar fases es E4.
	 */
	it("no alcanza a la fase", () => {
		const inPhase = makeAdjustment({
			id: "adj_phase",
			onlyInPhase: "recomposicion",
		});
		const asOf = {
			effectiveOn: "2026-11-01",
			knows: { adjustmentIds: ["adj_phase"] },
		};

		// La fase la sigue decidiendo `phaseAt`, que no recibe el corte.
		const inside = resolvePrescription(
			BASELINE,
			[inPhase],
			"template_a",
			asOf,
			() => "recomposicion",
		);
		const outside = resolvePrescription(
			BASELINE,
			[inPhase],
			"template_a",
			asOf,
			() => "progresion",
		);

		expect(byId(inside, "slot_a_01")?.sets).toBe(3);
		expect(byId(outside, "slot_a_01")?.sets).toBe(2);
	});
});
