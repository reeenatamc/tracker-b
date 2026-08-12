/**
 * A phase that inherits, and the property that choice buys.
 *
 * The alternative — walking `inheritsFrom` inside the resolver — passes the first
 * test here and fails the second, which is the one that matters: with dynamic
 * inheritance, editing B months later moves C with no event anywhere saying C
 * changed. So the second test is really the specification, and the rest of the
 * file is about not copying things that were never about C.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASELINE } from "./__fixtures__/plan";
import { PROGRAM } from "./__fixtures__/program";
import {
	inheritedAdjustmentId,
	materialiseInheritance,
	reconcileInheritance,
} from "./inherit-phase";
import { resolvePrescription } from "./prescription";
import type { Phase, PlanAdjustment, Program } from "./schema";

const CREATED_ON = "2026-12-01";
const CREATED_AT = Date.parse("2026-12-01T10:00:00Z");

/** B is the fourth phase of the fixture; C is new and inherits from it. */
const B = "definicion_tesis";
const C = "fase_viaje";

function phase(overrides: Partial<Phase>): Phase {
	return { ...PROGRAM.phases[3], ...overrides };
}

const WITH_C: Program = {
	...PROGRAM,
	phases: [
		...PROGRAM.phases,
		phase({
			id: C,
			name: "Viaje",
			legacyId: null,
			order: 5,
			inheritsFrom: B,
			plannedStart: "2027-01-05",
			plannedEnd: null,
		}),
	],
};

const WITHOUT_INHERITANCE: Program = {
	...PROGRAM,
	phases: [
		...PROGRAM.phases,
		phase({
			id: "fase_suelta",
			name: "Suelta",
			legacyId: null,
			order: 5,
			inheritsFrom: null,
			plannedStart: "2027-01-05",
			plannedEnd: null,
		}),
	],
};

function adjustment(overrides: Partial<PlanAdjustment> = {}): PlanAdjustment {
	return {
		kind: "set_field",
		id: "adj_b_sets",
		entryId: "slot_a_01",
		change: { field: "sets", value: 4 },
		effectiveOn: "2026-08-08",
		onlyInPhase: B,
		origin: "program",
		reason: "Lo que el programa traía escrito para esta fase.",
		evidenceIds: [],
		provenance: {
			kind: "migrated",
			from: "setsByPhase",
			assumedEffectiveOn: false,
		},
		createdAt: 0,
		...overrides,
	} as PlanAdjustment;
}

const run = (program: Program, adjustments: PlanAdjustment[]) =>
	reconcileInheritance({
		program,
		adjustments,
		effectiveOn: CREATED_ON,
		createdAt: CREATED_AT,
		phaseAt: () => B,
	});

const setsIn = (
	phaseId: string,
	adjustments: PlanAdjustment[],
	date = "2027-02-01",
) =>
	resolvePrescription(
		BASELINE,
		adjustments,
		"template_a",
		{ effectiveOn: date, knows: null },
		() => phaseId,
	).find((entry) => entry.id === "slot_a_01")?.sets;

// -------------------------------------------------------------- materialising

describe("crear C heredando de B", () => {
	const fromB = [adjustment()];
	const created = run(WITH_C, fromB);

	it("C empieza con la prescripción programática de B", () => {
		const all = [...fromB, ...created];
		expect(setsIn(C, all)).toBe(4);
		expect(setsIn(C, all)).toBe(setsIn(B, all));
	});

	it("y sin materializar no la tendría: saldría de la base", () => {
		expect(setsIn(C, fromB)).toBe(2);
	});

	it("las copias quedan atadas a C, no a B", () => {
		expect(created).toHaveLength(1);
		expect(created[0].onlyInPhase).toBe(C);
	});

	it("con la procedencia que dice de dónde vino y de qué es copia", () => {
		expect(created[0].provenance).toEqual({
			kind: "inherited",
			inheritedFromPhaseId: B,
			sourceAdjustmentId: "adj_b_sets",
		});
	});

	it("y con un id derivado de las dos cosas", () => {
		expect(created[0].id).toBe(inheritedAdjustmentId(C, "adj_b_sets"));
	});

	it("fechadas el día en que se crea la fase, no el de B", () => {
		expect(created[0].effectiveOn).toBe(CREATED_ON);
		expect(created[0].effectiveOn).not.toBe("2026-08-08");
	});

	it("el motivo dice que es heredado y de dónde", () => {
		expect(created[0].reason).toContain("Heredado de");
		expect(created[0].reason).toContain(B);
	});
});

// ------------------------------------------------------------- independence

describe("después de materializarse, C es independiente", () => {
	/** La prueba que decide entre las dos semánticas. */
	it("modificar B después no cambia C", () => {
		const fromB = [adjustment()];
		const created = run(WITH_C, fromB);

		// Meses más tarde: B pasa a 5 series.
		const bChanges = adjustment({
			id: "adj_b_mas",
			change: { field: "sets", value: 5 },
			effectiveOn: "2027-01-15",
			origin: "manual",
			provenance: { kind: "authored" },
		});
		const all = [...fromB, ...created, bChanges];

		expect(setsIn(B, all, "2027-02-01")).toBe(5);
		expect(setsIn(C, all, "2027-02-01")).toBe(4);
	});

	it("y revocar el ajuste de B tampoco", () => {
		const fromB = [adjustment()];
		const created = run(WITH_C, fromB);
		const revocation: PlanAdjustment = {
			kind: "revoke",
			id: "rev_b",
			revokesId: "adj_b_sets",
			effectiveOn: "2027-01-15",
			onlyInPhase: null,
			origin: "manual",
			reason: "ya no",
			evidenceIds: [],
			provenance: { kind: "authored" },
			createdAt: 1,
		};
		const all = [...fromB, ...created, revocation];

		expect(setsIn(B, all, "2027-02-01")).toBe(2);
		expect(setsIn(C, all, "2027-02-01")).toBe(4);
	});
});

// ------------------------------------------------------------- what is copied

describe("qué no se copia", () => {
	it("un ajuste de seguridad de B no pasa a C", () => {
		const safety = adjustment({
			id: "adj_b_safety",
			origin: "safety",
			change: { field: "sets", value: 1 },
			reason: "el tobillo se fue",
			provenance: { kind: "authored" },
		});
		expect(run(WITH_C, [adjustment(), safety])).toHaveLength(1);
		expect(
			run(WITH_C, [adjustment(), safety]).map((a) => a.provenance),
		).not.toContainEqual(
			expect.objectContaining({ sourceAdjustmentId: "adj_b_safety" }),
		);
	});

	it("ni uno manual, ni de revisión, ni del coach", () => {
		const others = (["manual", "review", "coach"] as const).map((origin) =>
			adjustment({
				id: `adj_b_${origin}`,
				origin,
				provenance: { kind: "authored" },
			}),
		);
		expect(run(WITH_C, others)).toEqual([]);
	});

	it("ni uno que ya se aplicaba en todas las fases", () => {
		const global = adjustment({ id: "adj_global", onlyInPhase: null });
		expect(run(WITH_C, [global])).toEqual([]);
	});

	it("ni uno de otra fase que no es B", () => {
		const elsewhere = adjustment({
			id: "adj_otra",
			onlyInPhase: "progresion",
		});
		expect(run(WITH_C, [elsewhere])).toEqual([]);
	});

	it("ni uno de B que ya estaba revocado al crear C", () => {
		const revocation: PlanAdjustment = {
			kind: "revoke",
			id: "rev_previa",
			revokesId: "adj_b_sets",
			effectiveOn: "2026-10-01",
			onlyInPhase: null,
			origin: "manual",
			reason: "ya no aplica",
			evidenceIds: [],
			provenance: { kind: "authored" },
			createdAt: 1,
		};
		expect(run(WITH_C, [adjustment(), revocation])).toEqual([]);
	});
});

describe("materialiseInheritance, una fase suelta", () => {
	const input = {
		program: WITH_C,
		adjustments: [adjustment()],
		effectiveOn: CREATED_ON,
		createdAt: CREATED_AT,
		phaseAt: () => B,
	};

	it("hace lo mismo que la reconciliación completa para esa fase", () => {
		expect(materialiseInheritance(C, input)).toEqual(
			run(WITH_C, [adjustment()]),
		);
	});

	it("y no devuelve nada para una fase que no existe", () => {
		expect(materialiseInheritance("no_existe", input)).toEqual([]);
	});

	it("ni para una que no hereda", () => {
		expect(materialiseInheritance(B, input)).toEqual([]);
	});
});

describe("una fase que no declara inheritsFrom", () => {
	it("empieza desde la base y no recibe nada", () => {
		const created = run(WITHOUT_INHERITANCE, [adjustment()]);
		expect(created).toEqual([]);
		expect(setsIn("fase_suelta", [adjustment()])).toBe(2);
	});
});

// ---------------------------------------------------------------- idempotence

describe("reconciliar dos veces", () => {
	const fromB = [adjustment()];

	it("no duplica", () => {
		const first = run(WITH_C, fromB);
		const second = run(WITH_C, [...fromB, ...first]);
		expect(second).toEqual([]);
	});

	it("ni tres veces, ni tras una sincronización que ya las trajo", () => {
		const first = run(WITH_C, fromB);
		let all = [...fromB, ...first];
		for (let round = 0; round < 3; round++) {
			const fresh = run(WITH_C, all);
			expect(fresh).toEqual([]);
			all = [...all, ...fresh];
		}
		expect(all).toHaveLength(2);
	});

	it("pero sí materializa una fase nueva que aparezca después", () => {
		const first = run(WITH_C, fromB);
		const withD: Program = {
			...WITH_C,
			phases: [
				...WITH_C.phases,
				phase({
					id: "fase_d",
					name: "D",
					legacyId: null,
					order: 6,
					inheritsFrom: C,
					plannedStart: "2027-03-01",
					plannedEnd: null,
				}),
			],
		};

		const second = reconcileInheritance({
			program: withD,
			adjustments: [...fromB, ...first],
			effectiveOn: CREATED_ON,
			createdAt: CREATED_AT,
			phaseAt: () => C,
		});

		expect(second).toHaveLength(1);
		expect(second[0].onlyInPhase).toBe("fase_d");
	});
});

describe("una cadena B → C → D en una sola pasada", () => {
	it("D acaba con la misma prescripción, y el rastro encadenado", () => {
		const withD: Program = {
			...WITH_C,
			phases: [
				...WITH_C.phases,
				phase({
					id: "fase_d",
					name: "D",
					legacyId: null,
					order: 6,
					inheritsFrom: C,
					plannedStart: "2027-03-01",
					plannedEnd: null,
				}),
			],
		};
		const fromB = [adjustment()];
		const created = reconcileInheritance({
			program: withD,
			adjustments: fromB,
			effectiveOn: CREATED_ON,
			createdAt: CREATED_AT,
			phaseAt: () => B,
		});
		const all = [...fromB, ...created];

		expect(created).toHaveLength(2);
		expect(setsIn("fase_d", all)).toBe(4);

		const d = created.find((a) => a.onlyInPhase === "fase_d");
		expect(d?.provenance).toEqual({
			kind: "inherited",
			inheritedFromPhaseId: C,
			sourceAdjustmentId: inheritedAdjustmentId(C, "adj_b_sets"),
		});
	});
});

// -------------------------------------------------------------- no dynamism

describe("el resolver no sabe nada de inheritsFrom", () => {
	/**
	 * Lo que impide que la semántica vuelva a la otra por la puerta de atrás: si
	 * `resolvePrescription` mirase la herencia, esta prueba dejaría de tener
	 * sentido y C cambiaría cada vez que cambia B.
	 */
	it("sin materializar, C no sabe nada de B", () => {
		expect(setsIn(C, [adjustment()])).toBe(2);
	});

	it("y `prescription.ts` no menciona la herencia", () => {
		const source = readFileSync(
			join(import.meta.dirname, "prescription.ts"),
			"utf8",
		);
		expect(source).not.toContain("inheritsFrom");
	});
});

// ------------------------------------------------------------ the other door

describe("una fase puede llegar por sincronización, no sólo creándola", () => {
	const SRC = join(import.meta.dirname, "..");

	/**
	 * El arranque es una puerta; el pull es la otra. La reconciliación es
	 * idempotente justo para que las dos lleven al mismo sitio, y para que ninguna
	 * tenga que saber si la otra llegó antes.
	 */
	it("el arranque la reconcilia", () => {
		const bootstrap = readFileSync(join(SRC, "db", "bootstrap.ts"), "utf8");
		expect(bootstrap).toContain("reconcilePhaseInheritance(");
	});

	it("y un pull con filas también", () => {
		const provider = readFileSync(join(SRC, "db", "sync-provider.tsx"), "utf8");
		expect(provider).toContain("reconcilePhaseInheritance(");
		// Sólo cuando ha llegado algo: un pull vacío no cambia el plan.
		expect(provider).toContain("if (received === 0) return;");
	});

	it("el cliente de sync avisa después de aplicar lo recibido", () => {
		const client = readFileSync(join(SRC, "lib", "sync-client.ts"), "utf8");
		const applied = client.indexOf("applyRemote(");
		const notified = client.indexOf("onPulled(incoming.length)");
		expect(applied).toBeGreaterThan(-1);
		expect(notified).toBeGreaterThan(applied);
		// Y antes de que el estado pase a idle.
		expect(notified).toBeLessThan(
			client.indexOf('onState({ status: "idle", lastSyncedAt })'),
		);
	});
});
