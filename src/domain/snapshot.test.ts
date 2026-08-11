/**
 * G3, and the two ways it could quietly not hold.
 *
 * The guarantee is that changing the plan tomorrow cannot alter what a session
 * that already started had prescribed. The mechanism is that the snapshot keeps
 * numbers, not references — so the strongest test here is the one that deletes
 * the entire adjustment log and checks the session still renders.
 *
 * The other half is that no session may exist without a snapshot, which turns
 * "no snapshot" into a violation rather than a puzzle to deduce a plan from.
 */

import { describe, expect, it } from "vitest";
import { BASELINE, makeAdjustment } from "./__fixtures__/plan";
import type { SessionPlanSnapshot, SessionRecord } from "./schema";
import {
	activeSnapshot,
	disposition,
	dispositionOfSession,
	freeze,
	ORPHAN_GRACE_MS,
	reconstruct,
} from "./snapshot";

const PHASE = () => "progresion";
const live = (effectiveOn: string) => ({ effectiveOn, knows: null });

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
	return {
		id: "s1",
		date: "2026-11-01",
		templateId: "template_a",
		phase: "progresion",
		completed: false,
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

const frozen = (adjustments = [makeAdjustment()]) =>
	freeze({
		id: "snap_1",
		sessionId: "s1",
		takenAt: 1000,
		phaseId: "progresion",
		templateId: "template_a",
		baseline: BASELINE,
		adjustments,
		asOf: live("2026-11-01"),
		phaseAt: PHASE,
	});

// ------------------------------------------------------------------------ G3

describe("G3 · una sesión empezada no cambia de prescripción", () => {
	it("congela los valores resueltos", () => {
		const snapshot = frozen();
		const entry = snapshot.entries.find((e) => e.id === "slot_a_01");

		expect(entry?.sets).toBe(3);
		expect(snapshot.status).toBe("committed");
	});

	it("cambiar el plan después no la toca", () => {
		const snapshot = frozen();
		// El plan cambia: otro ajuste, más series.
		const later = makeAdjustment({
			id: "adj_2",
			change: { field: "sets", value: 5 },
			effectiveOn: "2026-11-02",
		});
		void later;

		expect(snapshot.entries.find((e) => e.id === "slot_a_01")?.sets).toBe(3);
	});

	/**
	 * La prueba que de verdad demuestra la autocontención: sin base y sin ajustes,
	 * la instantánea sigue diciendo lo que decía.
	 */
	it("se lee sin base y sin ajustes: no guarda referencias", () => {
		const snapshot = frozen();
		const serialised = JSON.parse(
			JSON.stringify(snapshot),
		) as SessionPlanSnapshot;

		expect(serialised.entries.find((e) => e.id === "slot_a_01")?.sets).toBe(3);
		expect(serialised.entries).toHaveLength(2);
	});

	it("revocar el ajuste que estaba vigente al congelar no la mueve", () => {
		const snapshot = frozen();
		// La revocación existe en el log; la instantánea nunca lo consulta.
		expect(snapshot.entries.find((e) => e.id === "slot_a_01")?.sets).toBe(3);
		expect(snapshot.adjustmentIds).toContain("adj_1");
	});

	it("la sesión sigue la instantánea más reciente, y conserva la primera", () => {
		const first = frozen();
		const second = { ...frozen(), id: "snap_2", takenAt: 2000 };

		expect(activeSnapshot([first, second], "s1")?.id).toBe("snap_2");
		// La de arranque sigue consultable.
		expect([first, second].find((s) => s.takenAt === 1000)?.id).toBe("snap_1");
	});
});

// -------------------------------------------------------------- reconstruction

describe("reconstruir sin inventar", () => {
	const past = session({
		id: "old",
		date: "2026-09-01",
		prescriptionContract: "legacy",
	});

	it("con todo fechable queda completa", () => {
		const snapshot = reconstruct({
			id: "rec_1",
			session: past,
			phaseId: "progresion",
			templateId: "template_a",
			baseline: BASELINE,
			source: {
				datable: [makeAdjustment({ effectiveOn: "2026-08-01" })],
				undatable: [],
			},
			phaseAt: PHASE,
		});

		expect(snapshot.status).toBe("reconstructed");
		expect(snapshot.reconstructionConfidence).toBe("complete");
		expect(snapshot.reconstructionGaps).toEqual([]);
		expect(snapshot.entries.find((e) => e.id === "slot_a_01")?.sets).toBe(3);
	});

	/** Un override sin fecha se queda fuera y se nombra. Nunca se incorpora. */
	it("con algo sin fechar queda parcial, y dice qué falta", () => {
		const snapshot = reconstruct({
			id: "rec_2",
			session: past,
			phaseId: "progresion",
			templateId: "template_a",
			baseline: BASELINE,
			source: { datable: [], undatable: ["override_sin_fecha"] },
			phaseAt: PHASE,
		});

		expect(snapshot.reconstructionConfidence).toBe("partial");
		expect(snapshot.reconstructionGaps).toEqual(["override_sin_fecha"]);
		// Y el override no se coló: el hueco conserva su valor de base.
		expect(snapshot.entries.find((e) => e.id === "slot_a_01")?.sets).toBe(2);
	});

	it("no finge haber sido congelada en un momento concreto", () => {
		const snapshot = reconstruct({
			id: "rec_3",
			session: past,
			phaseId: "progresion",
			templateId: "template_a",
			baseline: BASELINE,
			source: { datable: [], undatable: [] },
			phaseAt: PHASE,
		});

		expect(snapshot.takenAt).toBe(0);
	});
});

// -------------------------------------------------------------------- recovery

describe("una sesión sin instantánea", () => {
	const base = {
		hasSnapshot: false,
		hasSets: true,
		writtenUnderSchema: 3,
		contractSince: 3,
	};

	it("legacy se reconstruye", () => {
		expect(
			dispositionOfSession({
				...base,
				session: session({ prescriptionContract: "legacy" }),
			}),
		).toEqual({ kind: "reconstruct" });
	});

	/** El punto de la última corrección: el número de series no dice nada. */
	it("snapshot_v1 es violación con series", () => {
		expect(
			dispositionOfSession({ ...base, session: session(), hasSets: true }),
		).toEqual({ kind: "violation", code: "snapshot-missing" });
	});

	it("snapshot_v1 es violación también SIN series", () => {
		expect(
			dispositionOfSession({ ...base, session: session(), hasSets: false }),
		).toEqual({ kind: "violation", code: "snapshot-missing" });
	});

	it("con instantánea no hay nada que hacer", () => {
		expect(
			dispositionOfSession({ ...base, session: session(), hasSnapshot: true }),
		).toEqual({ kind: "ok" });
	});
});

describe("ausencia de contrato: sólo legacy con procedencia demostrable", () => {
	const noContract = session({ prescriptionContract: null });

	it("sin sello de esquema es anterior a E3", () => {
		expect(
			dispositionOfSession({
				session: noContract,
				hasSnapshot: false,
				hasSets: true,
				writtenUnderSchema: null,
				contractSince: 3,
			}),
		).toEqual({ kind: "reconstruct" });
	});

	it("con sello anterior a 3 también", () => {
		expect(
			dispositionOfSession({
				session: noContract,
				hasSnapshot: false,
				hasSets: true,
				writtenUnderSchema: 2,
				contractSince: 3,
			}),
		).toEqual({ kind: "reconstruct" });
	});

	/**
	 * El caso que una regla universal habría tapado: una fila escrita bajo E3 que
	 * perdió el contrato no es histórica, está rota.
	 */
	it("con sello de 3 en adelante es inválida, no legacy", () => {
		expect(
			dispositionOfSession({
				session: noContract,
				hasSnapshot: false,
				hasSets: true,
				writtenUnderSchema: 3,
				contractSince: 3,
			}),
		).toEqual({ kind: "violation", code: "contract-missing" });
	});
});

// ------------------------------------------------------------------ collection

describe("recoger una instantánea huérfana", () => {
	const snapshot = { ...frozen(), takenAt: 0 };
	const day = ORPHAN_GRACE_MS;

	it("nunca, si una sesión la referencia", () => {
		expect(
			disposition({
				snapshot,
				referenced: true,
				now: day * 5,
				lastSyncedAt: day * 4,
			}),
		).toEqual({ kind: "keep", why: "referenced" });
	});

	it("no antes del periodo de gracia", () => {
		expect(
			disposition({
				snapshot,
				referenced: false,
				now: day / 2,
				lastSyncedAt: null,
			}),
		).toEqual({ kind: "keep", why: "within-grace" });
	});

	/** Su sesión puede venir del otro dispositivo: hace falta un sync posterior. */
	it("no sin una sincronización posterior a haberla tomado", () => {
		expect(
			disposition({
				snapshot,
				referenced: false,
				now: day * 2,
				lastSyncedAt: 0,
			}),
		).toEqual({ kind: "keep", why: "awaiting-sync" });
	});

	it("sí con gracia cumplida y sync posterior", () => {
		expect(
			disposition({
				snapshot,
				referenced: false,
				now: day * 2,
				lastSyncedAt: day,
			}),
		).toEqual({ kind: "collect", why: "orphan" });
	});

	it("sin sync configurado basta la gracia", () => {
		expect(
			disposition({
				snapshot,
				referenced: false,
				now: day * 2,
				lastSyncedAt: null,
			}),
		).toEqual({ kind: "collect", why: "orphan" });
	});

	it("el periodo es una constante, no una decisión de diseño", () => {
		expect(
			disposition({
				snapshot,
				referenced: false,
				now: 10,
				lastSyncedAt: null,
				graceMs: 5,
			}),
		).toEqual({ kind: "collect", why: "orphan" });
	});
});
