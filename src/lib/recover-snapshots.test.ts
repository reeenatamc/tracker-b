/**
 * The startup sweep.
 *
 * What this file is really testing is a refusal: three different kinds of broken
 * session look the same from the outside, and the sweep must not paper over any
 * of them with a plausible reconstruction. So most of the assertions are about
 * what does *not* end up in `reconstruct`.
 *
 * The other half is the orphan rule, which errs the slow way on purpose — a
 * snapshot with no session may just mean the session is still on the phone.
 */

import { describe, expect, it } from "vitest";
import { BASELINE, makeAdjustment } from "@/domain/__fixtures__/plan";
import type { SessionPlanSnapshot, SessionRecord } from "@/domain/schema";
import { freeze, ORPHAN_GRACE_MS } from "@/domain/snapshot";
import {
	datable,
	planRecovery,
	type RecoveryInput,
} from "@/lib/recover-snapshots";

const PHASE = () => "progresion";
const DAY = ORPHAN_GRACE_MS;

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
	return {
		id: "s1",
		date: "2026-11-01",
		templateId: "template_a",
		phase: "progresion",
		completed: true,
		notes: null,
		startedAt: null,
		endedAt: null,
		skippedExerciseIds: [],
		extraExerciseIds: [],
		prescriptionContract: "snapshot_v1",
		snapshotId: null,
		...overrides,
	};
}

function snapshotFor(
	sessionId: string,
	overrides: Partial<SessionPlanSnapshot> = {},
): SessionPlanSnapshot {
	return {
		...freeze({
			id: `snap_${sessionId}`,
			sessionId,
			takenAt: DAY,
			phaseId: "progresion",
			templateId: "template_a",
			baseline: BASELINE,
			adjustments: [],
			asOf: { effectiveOn: "2026-11-01", knows: null },
			phaseAt: PHASE,
		}),
		...overrides,
	};
}

function run(overrides: Partial<RecoveryInput> = {}) {
	return planRecovery({
		sessions: [],
		snapshots: [],
		baseline: BASELINE,
		adjustments: [],
		phaseAt: PHASE,
		schemaOf: () => 3,
		hasSets: () => true,
		now: DAY * 10,
		lastSyncedAt: DAY * 9,
		idFor: (sessionId) => `rec_${sessionId}`,
		...overrides,
	});
}

// -------------------------------------------------------------------- healthy

describe("una base sana no propone nada", () => {
	it("sesión con instantánea, y la instantánea referenciada", () => {
		const plan = run({
			sessions: [session({ snapshotId: "snap_s1" })],
			snapshots: [snapshotFor("s1")],
		});

		expect(plan).toEqual({ reconstruct: [], collect: [], violations: [] });
	});

	it("y una base vacía tampoco", () => {
		expect(run()).toEqual({ reconstruct: [], collect: [], violations: [] });
	});
});

// ------------------------------------------------------------- reconstruction

describe("una sesión anterior a E3 se reconstruye", () => {
	const legacy = session({
		id: "old",
		date: "2026-09-01",
		prescriptionContract: "legacy",
	});

	it("con todo fechable, completa", () => {
		const plan = run({
			sessions: [legacy],
			adjustments: [makeAdjustment({ effectiveOn: "2026-08-01" })],
			schemaOf: () => 2,
		});

		expect(plan.violations).toEqual([]);
		expect(plan.reconstruct).toHaveLength(1);
		expect(plan.reconstruct[0]).toMatchObject({
			id: "rec_old",
			sessionId: "old",
			status: "reconstructed",
			reconstructionConfidence: "complete",
			takenAt: 0,
		});
	});

	/** Un override sin fecha se queda fuera y se nombra: nunca se incorpora. */
	it("con un ajuste de fecha supuesta, parcial y nombrando el hueco", () => {
		const assumed = makeAdjustment({
			id: "adj_supuesto",
			provenance: {
				kind: "migrated",
				from: "exerciseOverride",
				assumedEffectiveOn: true,
			},
		});
		const plan = run({ sessions: [legacy], adjustments: [assumed] });

		expect(plan.reconstruct[0].reconstructionConfidence).toBe("partial");
		expect(plan.reconstruct[0].reconstructionGaps).toEqual(["adj_supuesto"]);
		// Y no se coló: el hueco conserva su valor de base.
		expect(plan.reconstruct[0].entries[0].sets).toBe(2);
	});

	it("sin sello de esquema también es anterior a E3", () => {
		const plan = run({
			sessions: [session({ id: "old", prescriptionContract: null })],
			schemaOf: () => null,
		});
		expect(plan.reconstruct).toHaveLength(1);
		expect(plan.violations).toEqual([]);
	});
});

// ----------------------------------------------------------------- violations

describe("lo que no se arregla adivinando", () => {
	it("snapshot_v1 sin instantánea se reporta, no se reconstruye", () => {
		const plan = run({ sessions: [session()] });

		expect(plan.reconstruct).toEqual([]);
		expect(plan.violations).toEqual([
			{ sessionId: "s1", date: "2026-11-01", code: "snapshot-missing" },
		]);
	});

	/** El punto: el número de series no distingue histórica de rota. */
	it("y también sin series", () => {
		const plan = run({ sessions: [session()], hasSets: () => false });
		expect(plan.violations[0].code).toBe("snapshot-missing");
		expect(plan.reconstruct).toEqual([]);
	});

	it("una fila escrita bajo E3 sin contrato está rota, no es histórica", () => {
		const plan = run({
			sessions: [session({ prescriptionContract: null })],
			schemaOf: () => 3,
		});

		expect(plan.violations).toEqual([
			{ sessionId: "s1", date: "2026-11-01", code: "contract-missing" },
		]);
		expect(plan.reconstruct).toEqual([]);
	});

	it("un snapshotId que no resuelve se reporta", () => {
		const plan = run({
			sessions: [session({ snapshotId: "snap_que_no_esta" })],
			snapshots: [],
		});

		expect(plan.violations).toEqual([
			{ sessionId: "s1", date: "2026-11-01", code: "snapshot-unresolvable" },
		]);
	});

	/**
	 * Aunque quede otra instantánea de la misma sesión. La referencia es una
	 * afirmación sobre una en concreto, y perderla es una pérdida.
	 */
	it("aunque exista otra instantánea de esa sesión", () => {
		const plan = run({
			sessions: [session({ snapshotId: "snap_borrada" })],
			snapshots: [snapshotFor("s1")],
		});

		expect(plan.violations[0].code).toBe("snapshot-unresolvable");
		expect(plan.reconstruct).toEqual([]);
	});

	it("nunca borra la sesión rota: la instantánea puede llegar por sync", () => {
		const plan = run({ sessions: [session()] });
		expect(plan.collect).toEqual([]);
	});
});

// -------------------------------------------------------------------- orphans

describe("recoger huérfanas", () => {
	const orphan = snapshotFor("no_existe", { id: "snap_huerfana", takenAt: 0 });

	it("con gracia cumplida y sync posterior", () => {
		const plan = run({ snapshots: [orphan], now: DAY * 2, lastSyncedAt: DAY });
		expect(plan.collect).toEqual(["snap_huerfana"]);
	});

	it("no dentro del periodo de gracia", () => {
		const plan = run({
			snapshots: [orphan],
			now: DAY / 2,
			lastSyncedAt: null,
		});
		expect(plan.collect).toEqual([]);
	});

	it("no sin una sincronización posterior a haberla tomado", () => {
		const plan = run({ snapshots: [orphan], now: DAY * 2, lastSyncedAt: 0 });
		expect(plan.collect).toEqual([]);
	});

	it("nunca una que una sesión referencia", () => {
		const plan = run({
			sessions: [session({ snapshotId: "snap_s1" })],
			snapshots: [snapshotFor("s1", { takenAt: 0 })],
			now: DAY * 5,
			lastSyncedAt: DAY * 4,
		});
		expect(plan.collect).toEqual([]);
	});

	/** Y no se recoge la que acaba de proponerse reconstruir. */
	it("una reconstrucción propuesta no entra en la recogida", () => {
		const plan = run({
			sessions: [session({ id: "old", prescriptionContract: "legacy" })],
			schemaOf: () => 2,
			now: DAY * 10,
			lastSyncedAt: DAY * 9,
		});

		expect(plan.reconstruct).toHaveLength(1);
		expect(plan.collect).toEqual([]);
	});
});

// ------------------------------------------------------------------- datable

describe("qué se puede situar en el tiempo", () => {
	it("lo escrito a mano se sitúa", () => {
		expect(datable([makeAdjustment()])).toEqual({
			datable: [makeAdjustment()],
			undatable: [],
		});
	});

	it("lo migrado con fecha real también", () => {
		const migrated = makeAdjustment({
			provenance: {
				kind: "migrated",
				from: "setsByPhase",
				assumedEffectiveOn: false,
			},
		});
		expect(datable([migrated]).undatable).toEqual([]);
	});

	it("lo migrado con fecha supuesta no, pase lo que pase con la fecha", () => {
		const assumed = (id: string, effectiveOn: string) =>
			makeAdjustment({
				id,
				effectiveOn,
				provenance: {
					kind: "migrated",
					from: "exerciseOverride",
					assumedEffectiveOn: true,
				},
			});

		const split = datable([
			assumed("antes", "2020-01-01"),
			assumed("después", "2030-01-01"),
		]);
		expect(split.datable).toEqual([]);
		expect(split.undatable).toEqual(["antes", "después"]);
	});
});
