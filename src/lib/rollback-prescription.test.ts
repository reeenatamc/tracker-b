/**
 * Criterion 11: a rollback keeps the real snapshots.
 *
 * The whole file is one argument. "Undo the migration" is normally read as
 * "delete what the migration wrote", and the migration wrote into the collection
 * that also holds the only surviving record of what real sessions had in front of
 * them. So the tests are mostly about what survives.
 */

import { describe, expect, it } from "vitest";
import { BASELINE, makeAdjustment } from "@/domain/__fixtures__/plan";
import type { SessionPlanSnapshot, SessionRecord } from "@/domain/schema";
import { freeze } from "@/domain/snapshot";
import { applyRollback, planRollback } from "@/lib/rollback-prescription";

const PHASE = () => "progresion";

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
		snapshotId: "snap_real",
		...overrides,
	};
}

const committed: SessionPlanSnapshot = freeze({
	id: "snap_real",
	sessionId: "s1",
	takenAt: 1000,
	phaseId: "progresion",
	templateId: "template_a",
	baseline: BASELINE,
	adjustments: [],
	asOf: { effectiveOn: "2026-11-01", knows: null },
	phaseAt: PHASE,
});

const reconstructed: SessionPlanSnapshot = {
	...committed,
	id: "snap_deducida",
	sessionId: "old",
	status: "reconstructed",
	takenAt: 0,
};

const authored = makeAdjustment({ id: "adj_mio" });
const migrated = makeAdjustment({
	id: "adj_migrado",
	origin: "program",
	provenance: {
		kind: "migrated",
		from: "setsByPhase",
		assumedEffectiveOn: false,
	},
});

const input = {
	baseline: BASELINE,
	adjustments: [authored, migrated],
	snapshots: [committed, reconstructed],
	sessions: [
		session(),
		session({
			id: "old",
			prescriptionContract: "legacy",
			snapshotId: "snap_deducida",
		}),
	],
};

// --------------------------------------------------------------------- plan

describe("qué se deshace", () => {
	const plan = planRollback(input);

	it("la base sembrada, que se regenera migrando otra vez", () => {
		expect(plan.removeBaselineIds).toEqual(["slot_a_01", "slot_a_02"]);
	});

	it("los ajustes que puso la migración", () => {
		expect(plan.removeAdjustmentIds).toEqual(["adj_migrado"]);
	});

	it("las instantáneas deducidas, que son derivadas", () => {
		expect(plan.removeSnapshotIds).toEqual(["snap_deducida"]);
	});

	it("y el contrato que la migración escribió", () => {
		expect(plan.clearContractSessionIds).toEqual(["old"]);
	});
});

describe("qué no se deshace", () => {
	const plan = planRollback(input);

	/** El criterio 11, dicho directamente. */
	it("una instantánea real nunca se borra", () => {
		expect(plan.removeSnapshotIds).not.toContain("snap_real");
		expect(plan.kept.committedSnapshotIds).toEqual(["snap_real"]);
	});

	it("ni un ajuste que escribiste tú", () => {
		expect(plan.removeAdjustmentIds).not.toContain("adj_mio");
		expect(plan.kept.authoredAdjustmentIds).toEqual(["adj_mio"]);
	});

	/**
	 * Y el contrato de una sesión nacida bajo E3 se queda. Borrarlo la haría pasar
	 * por anterior a E3, y la recuperación reconstruiría encima de una instantánea
	 * que nunca se perdió.
	 */
	it("ni el contrato de una sesión nacida bajo E3", () => {
		expect(plan.clearContractSessionIds).not.toContain("s1");
		expect(plan.kept.snapshotContractSessionIds).toEqual(["s1"]);
	});
});

// -------------------------------------------------------------------- apply

describe("aplicarlo", () => {
	const result = applyRollback(input, planRollback(input));

	it("deja la base vacía y la instantánea real en su sitio", () => {
		expect(result.baseline).toEqual([]);
		expect(result.snapshots.map((s) => s.id)).toEqual(["snap_real"]);
	});

	it("la sesión de E3 sigue apuntando a la suya", () => {
		const kept = result.sessions.find((s) => s.id === "s1");
		expect(kept?.snapshotId).toBe("snap_real");
		expect(kept?.prescriptionContract).toBe("snapshot_v1");
	});

	it("la anterior a E3 vuelve a no declarar contrato ni instantánea", () => {
		const old = result.sessions.find((s) => s.id === "old");
		expect(old?.prescriptionContract).toBeNull();
		expect(old?.snapshotId).toBeNull();
	});

	it("aplicarlo dos veces no cambia nada más", () => {
		const twice = applyRollback(result, planRollback(result));
		expect(twice).toEqual(result);
	});
});
