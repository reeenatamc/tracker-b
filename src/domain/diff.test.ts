/**
 * The four shapes of change, and the sentence behind each one.
 *
 * The categories are mechanical. The attribution is not, and the tests that
 * matter here are the two where the obvious implementation gives the wrong
 * answer: an adjustment that disappeared because you revoked it must be reported
 * as *the revocation and its reason*, and a phase that moved must say whether an
 * event moved it or whether the two `cutAt` simply fall on different sides of one
 * nobody touched.
 */

import { describe, expect, it } from "vitest";
import { BASELINE } from "./__fixtures__/plan";
import { PROGRAM } from "./__fixtures__/program";
import { type DiffInput, diffVersions } from "./diff";
import type {
	PhaseEvent,
	PlanAdjustment,
	PrescriptionEntry,
	ProgramVersion,
} from "./schema";
import type { VersionPlan } from "./versions";

const entry = (
	id: string,
	overrides: Partial<PrescriptionEntry> = {},
): PrescriptionEntry => ({
	id,
	templateId: "template_a",
	exerciseId: "lat_pulldown",
	order: 1,
	sets: 2,
	target: { kind: "reps", min: 10, max: 12 },
	load: BASELINE[0].load,
	rir: { min: 2, max: 2 },
	restSeconds: { min: 90, max: 90 },
	trainingRole: "strength",
	goal: "",
	progression: "",
	cues: [],
	allowedSubstitutions: [],
	...overrides,
});

const plan = (...entries: PrescriptionEntry[]): VersionPlan =>
	new Map([["template_a", entries]]);

const version = (
	id: string,
	overrides: Partial<ProgramVersion> = {},
): ProgramVersion => ({
	id,
	name: id,
	cutAt: "2026-12-01",
	knows: { adjustmentIds: [], phaseEventIds: [] },
	createdAt: 0,
	reason: "prueba",
	baselineFingerprint: "f",
	baselineSize: BASELINE.length,
	...overrides,
});

const sube = (
	id: string,
	value: number,
	effectiveOn = "2026-10-01",
	reason = "subo una serie",
): PlanAdjustment => ({
	kind: "set_field",
	id,
	entryId: "slot_a_01",
	change: { field: "sets", value },
	effectiveOn,
	onlyInPhase: null,
	origin: "manual",
	reason,
	evidenceIds: [],
	provenance: { kind: "authored" },
	createdAt: 0,
});

const revoca = (
	id: string,
	revokesId: string,
	reason = "ya no me hace falta",
): PlanAdjustment => ({
	kind: "revoke",
	id,
	revokesId,
	effectiveOn: "2026-11-01",
	onlyInPhase: null,
	origin: "manual",
	reason,
	evidenceIds: [],
	provenance: { kind: "authored" },
	createdAt: 1,
});

function run(overrides: Partial<DiffInput>): ReturnType<typeof diffVersions> {
	return diffVersions({
		from: { version: version("a"), plan: plan(entry("slot_a_01")) },
		to: { version: version("b"), plan: plan(entry("slot_a_01")) },
		adjustments: [],
		phaseEvents: [],
		baseline: BASELINE,
		program: PROGRAM,
		...overrides,
	});
}

// ---------------------------------------------------------- las categorías

describe("las cuatro formas de cambiar", () => {
	it("added: el hueco está en B y no en A", () => {
		const diff = run({
			to: {
				version: version("b"),
				plan: plan(entry("slot_a_01"), entry("slot_a_02")),
			},
		});
		expect(diff.changes.map((c) => [c.kind, c.entryId])).toEqual([
			["added", "slot_a_02"],
		]);
	});

	it("removed: el hueco está en A y no en B", () => {
		const diff = run({
			from: {
				version: version("a"),
				plan: plan(entry("slot_a_01"), entry("slot_a_02")),
			},
		});
		expect(diff.changes.map((c) => [c.kind, c.entryId])).toEqual([
			["removed", "slot_a_02"],
		]);
	});

	it("replaced: mismo hueco, otro ejercicio", () => {
		const diff = run({
			to: {
				version: version("b"),
				plan: plan(entry("slot_a_01", { exerciseId: "chest_press" })),
			},
		});
		expect(diff.changes[0]).toMatchObject({
			kind: "replaced",
			entryId: "slot_a_01",
		});
	});

	it("changed: mismo ejercicio, algún campo distinto", () => {
		const diff = run({
			to: {
				version: version("b"),
				plan: plan(entry("slot_a_01", { sets: 3 })),
			},
		});
		expect(diff.changes[0]).toMatchObject({ kind: "changed" });
		if (diff.changes[0].kind !== "changed") return;
		expect(diff.changes[0].fields).toEqual([{ field: "sets", from: 2, to: 3 }]);
	});

	/** Avanzar de fase no es rediseñar el plan. */
	it("de null a 2 es changed, no added", () => {
		const diff = run({
			from: {
				version: version("a"),
				plan: plan(entry("slot_a_01", { sets: null })),
			},
			to: {
				version: version("b"),
				plan: plan(entry("slot_a_01", { sets: 2 })),
			},
		});
		expect(diff.changes[0].kind).toBe("changed");
	});

	it("replaced conserva el id del hueco", () => {
		const diff = run({
			to: {
				version: version("b"),
				plan: plan(entry("slot_a_01", { exerciseId: "chest_press" })),
			},
		});
		if (diff.changes[0].kind !== "replaced") return;
		expect(diff.changes[0].from.id).toBe(diff.changes[0].to.id);
	});

	it("una versión contra sí misma no cambia nada", () => {
		const same = { version: version("a"), plan: plan(entry("slot_a_01")) };
		expect(run({ from: same, to: same }).changes).toEqual([]);
	});
});

// ------------------------------------------------------------- la simetría

describe("invertir los argumentos invierte el diff", () => {
	const a = { version: version("a"), plan: plan(entry("slot_a_01")) };
	const b = {
		version: version("b"),
		plan: plan(entry("slot_a_01", { sets: 3 }), entry("slot_a_02")),
	};

	it("added ↔ removed", () => {
		const ida = run({ from: a, to: b });
		const vuelta = run({ from: b, to: a });
		expect(ida.changes.find((c) => c.entryId === "slot_a_02")?.kind).toBe(
			"added",
		);
		expect(vuelta.changes.find((c) => c.entryId === "slot_a_02")?.kind).toBe(
			"removed",
		);
	});

	it("y changed intercambia from/to", () => {
		const ida = run({ from: a, to: b }).changes.find(
			(c) => c.entryId === "slot_a_01",
		);
		const vuelta = run({ from: b, to: a }).changes.find(
			(c) => c.entryId === "slot_a_01",
		);
		if (ida?.kind !== "changed" || vuelta?.kind !== "changed") return;
		expect(ida.fields[0]).toMatchObject({ from: 2, to: 3 });
		expect(vuelta.fields[0]).toMatchObject({ from: 3, to: 2 });
	});
});

// ----------------------------------------------------------- la atribución

describe("por qué cambió", () => {
	it("un ajuste que aplica en B y no en A se nombra, con su motivo", () => {
		const A1 = sube("A1", 3, "2026-10-01", "el tobillo aguanta bien");
		const diff = run({
			to: {
				version: version("b", {
					knows: { adjustmentIds: ["A1"], phaseEventIds: [] },
				}),
				plan: plan(entry("slot_a_01", { sets: 3 })),
			},
			adjustments: [A1],
		});

		expect(diff.changes[0].causes).toEqual([
			{
				kind: "adjustment",
				adjustmentId: "A1",
				reason: "el tobillo aguanta bien",
				origin: "manual",
				effectiveOn: "2026-10-01",
			},
		]);
	});

	/**
	 * La que la diferencia simétrica sola contesta mal: no es «A1 desapareció»,
	 * es «lo deshiciste, y esto escribiste al deshacerlo».
	 */
	it("uno que dejó de aplicar se atribuye al revoke, con el motivo del revoke", () => {
		const A1 = sube("A1", 3, "2026-10-01", "subo una serie");
		const R1 = revoca("R1", "A1", "ya no me hace falta");

		const diff = run({
			from: {
				version: version("a", {
					cutAt: "2026-10-15",
					knows: { adjustmentIds: ["A1"], phaseEventIds: [] },
				}),
				plan: plan(entry("slot_a_01", { sets: 3 })),
			},
			to: {
				version: version("b", {
					cutAt: "2026-12-01",
					knows: { adjustmentIds: ["A1", "R1"], phaseEventIds: [] },
				}),
				plan: plan(entry("slot_a_01", { sets: 2 })),
			},
			adjustments: [A1, R1],
		});

		expect(diff.changes[0].causes).toEqual([
			{
				kind: "revocation",
				revokeId: "R1",
				revokesId: "A1",
				reason: "ya no me hace falta",
				effectiveOn: "2026-11-01",
			},
		]);
	});

	it("y no se reporta como una simple ausencia", () => {
		const A1 = sube("A1", 3);
		const R1 = revoca("R1", "A1");
		const diff = run({
			from: {
				version: version("a", {
					cutAt: "2026-10-15",
					knows: { adjustmentIds: ["A1"], phaseEventIds: [] },
				}),
				plan: plan(entry("slot_a_01", { sets: 3 })),
			},
			to: {
				version: version("b", {
					knows: { adjustmentIds: ["A1", "R1"], phaseEventIds: [] },
				}),
				plan: plan(entry("slot_a_01", { sets: 2 })),
			},
			adjustments: [A1, R1],
		});
		expect(diff.changes[0].causes.map((c) => c.kind)).not.toContain(
			"unexplained",
		);
	});

	it("lo que no se puede atribuir sale unexplained y se reporta", () => {
		const diff = run({
			to: {
				version: version("b"),
				plan: plan(entry("slot_a_01", { sets: 3 })),
			},
		});
		expect(diff.changes[0].causes).toEqual([{ kind: "unexplained" }]);
		expect(diff.unexplained).toEqual(["slot_a_01"]);
	});

	it("un diff sano no deja nada sin explicar", () => {
		const A1 = sube("A1", 3);
		const diff = run({
			to: {
				version: version("b", {
					knows: { adjustmentIds: ["A1"], phaseEventIds: [] },
				}),
				plan: plan(entry("slot_a_01", { sets: 3 })),
			},
			adjustments: [A1],
		});
		expect(diff.unexplained).toEqual([]);
	});

	it("nada se persiste: recalcular da lo mismo", () => {
		const A1 = sube("A1", 3);
		const args = {
			to: {
				version: version("b", {
					knows: { adjustmentIds: ["A1"], phaseEventIds: [] },
				}),
				plan: plan(entry("slot_a_01", { sets: 3 })),
			},
			adjustments: [A1],
		};
		expect(run(args)).toEqual(run(args));
	});
});

// ------------------------------------------------------------- las fases

describe("cuando lo que cambió fue la fase", () => {
	const E1: PhaseEvent = {
		kind: "transition",
		id: "E1",
		fromPhaseId: null,
		toPhaseId: "adaptacion",
		occurredOn: "2026-08-10",
		plannedFor: "2026-08-10",
		trigger: "planned",
		reason: "",
		reviewId: null,
		createdAt: 0,
	};
	const E2: PhaseEvent = {
		...E1,
		id: "E2",
		toPhaseId: "progresion",
		occurredOn: "2026-09-15",
	};
	const E3: PhaseEvent = {
		kind: "correction",
		id: "E3",
		supersedesId: "E2",
		fromPhaseId: null,
		toPhaseId: "recomposicion",
		occurredOn: "2026-09-22",
		plannedFor: "2026-09-15",
		trigger: "planned",
		reason: "",
		reviewId: null,
		createdAt: 1,
	};

	const cambiado = plan(entry("slot_a_01", { sets: 3 }));

	it("una transición que B conoce y A no se nombra", () => {
		const diff = run({
			from: {
				version: version("a", {
					knows: { adjustmentIds: [], phaseEventIds: ["E1"] },
				}),
				plan: plan(entry("slot_a_01")),
			},
			to: {
				version: version("b", {
					knows: { adjustmentIds: [], phaseEventIds: ["E1", "E2"] },
				}),
				plan: cambiado,
			},
			phaseEvents: [E1, E2],
		});

		expect(diff.changes[0].causes).toContainEqual({
			kind: "phase",
			from: "adaptacion",
			to: "progresion",
			via: { kind: "transition", eventId: "E2", occurredOn: "2026-09-15" },
		});
	});

	it("una corrección se nombra, y a quién corrige", () => {
		const diff = run({
			from: {
				version: version("a", {
					knows: { adjustmentIds: [], phaseEventIds: ["E1", "E2"] },
				}),
				plan: plan(entry("slot_a_01")),
			},
			to: {
				version: version("b", {
					knows: { adjustmentIds: [], phaseEventIds: ["E1", "E2", "E3"] },
				}),
				plan: cambiado,
			},
			phaseEvents: [E1, E2, E3],
		});

		expect(diff.changes[0].causes).toContainEqual({
			kind: "phase",
			from: "progresion",
			to: "recomposicion",
			via: {
				kind: "correction",
				eventId: "E3",
				correctsId: "E2",
				occurredOn: "2026-09-22",
			},
		});
	});

	/** Sin evento nuevo, lo que se movió fue la fecha. No se inventa un evento. */
	it("mismo log y distinto cutAt se atribuye a la fecha", () => {
		const knows = { adjustmentIds: [], phaseEventIds: ["E1", "E2"] };
		const diff = run({
			from: {
				version: version("a", { cutAt: "2026-09-01", knows }),
				plan: plan(entry("slot_a_01")),
			},
			to: {
				version: version("b", { cutAt: "2026-10-01", knows }),
				plan: cambiado,
			},
			phaseEvents: [E1, E2],
		});

		expect(diff.changes[0].causes).toContainEqual({
			kind: "phase",
			from: "adaptacion",
			to: "progresion",
			via: { kind: "date", from: "adaptacion", to: "progresion" },
		});
	});

	it("y si la fase no se movió, no se menciona", () => {
		const knows = { adjustmentIds: [], phaseEventIds: ["E1"] };
		const diff = run({
			from: {
				version: version("a", { knows }),
				plan: plan(entry("slot_a_01")),
			},
			to: { version: version("b", { knows }), plan: cambiado },
			phaseEvents: [E1],
		});
		expect(diff.changes[0].causes.map((c) => c.kind)).not.toContain("phase");
	});
});
