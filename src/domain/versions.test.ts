/**
 * Capturing a version, and refusing to.
 *
 * Two halves. The fingerprint has to be a function of the baseline and of
 * nothing else — no clock, no database, no insertion order — because it is the
 * only thing standing between two devices with different baselines and two
 * confident, contradictory answers to the same question.
 *
 * The other half is the refusals. They look pedantic until you remember a
 * version is immutable: one born wrong is wrong for ever, and pressing the
 * button again in two seconds is not.
 */

import { describe, expect, it } from "vitest";
import { BASELINE, makeBaseline } from "./__fixtures__/plan";
import type { PhaseEvent, PlanAdjustment, ProgramVersion } from "./schema";
import {
	baselineFingerprint,
	type CaptureInput,
	canonicalBaseline,
	captureProgramKnowledgeCut,
	checkBaseline,
	checkVersion,
} from "./versions";

const A1: PlanAdjustment = {
	kind: "set_field",
	id: "A1",
	entryId: "slot_a_01",
	change: { field: "sets", value: 3 },
	effectiveOn: "2026-10-01",
	onlyInPhase: null,
	origin: "manual",
	reason: "prueba",
	evidenceIds: [],
	provenance: { kind: "authored" },
	createdAt: 0,
};

const R1: PlanAdjustment = {
	kind: "revoke",
	id: "R1",
	revokesId: "A1",
	effectiveOn: "2026-11-01",
	onlyInPhase: null,
	origin: "manual",
	reason: "ya no",
	evidenceIds: [],
	provenance: { kind: "authored" },
	createdAt: 1,
};

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
	kind: "correction",
	id: "E2",
	supersedesId: "E1",
	fromPhaseId: null,
	toPhaseId: "adaptacion",
	occurredOn: "2026-08-12",
	plannedFor: "2026-08-10",
	trigger: "planned",
	reason: "",
	reviewId: null,
	createdAt: 1,
};

const ok = (overrides: Partial<CaptureInput> = {}): CaptureInput => ({
	read: () => ({
		adjustments: [A1, R1],
		phaseEvents: [E1, E2],
		baseline: BASELINE,
	}),
	cutAt: "2026-12-01",
	today: "2026-12-01",
	bootstrapReady: true,
	syncIdle: true,
	pendingWrites: 0,
	...overrides,
});

// -------------------------------------------------------------- fingerprint

describe("la huella de la base", () => {
	it("no depende del orden de las filas", async () => {
		const alReves = [...BASELINE].reverse();
		expect(canonicalBaseline(alReves)).toBe(canonicalBaseline(BASELINE));
		expect(await baselineFingerprint(alReves)).toBe(
			await baselineFingerprint(BASELINE),
		);
	});

	/** Dos dispositivos que migraron en días distintos tienen la misma base. */
	it("ignora seededFrom y seededAt", async () => {
		const otroDia = BASELINE.map((row) => ({
			...row,
			seededFrom: "otro-contenido",
			seededAt: 999_999,
		}));
		expect(await baselineFingerprint(otroDia)).toBe(
			await baselineFingerprint(BASELINE),
		);
	});

	it("cambia si cambia la prescripción de una fila", async () => {
		const distinta = [makeBaseline({ sets: 9 }), BASELINE[1]];
		expect(await baselineFingerprint(distinta)).not.toBe(
			await baselineFingerprint(BASELINE),
		);
	});

	it("cambia si falta una fila", async () => {
		expect(await baselineFingerprint([BASELINE[0]])).not.toBe(
			await baselineFingerprint(BASELINE),
		);
	});

	it("una base vacía tiene huella, y es estable", async () => {
		expect(await baselineFingerprint([])).toBe(await baselineFingerprint([]));
	});

	it("es determinista: mismo input, misma salida", async () => {
		const uno = await baselineFingerprint(BASELINE);
		const dos = await baselineFingerprint(BASELINE);
		expect(uno).toBe(dos);
		expect(uno).toMatch(/^[0-9a-f]{64}$/);
	});
});

// ------------------------------------------------------------------ capture

describe("capturar el corte", () => {
	it("devuelve los dos conjuntos, la huella y el tamaño", async () => {
		const result = await captureProgramKnowledgeCut(ok());
		expect(result).toMatchObject({
			knows: { adjustmentIds: ["A1", "R1"], phaseEventIds: ["E1", "E2"] },
			baselineSize: BASELINE.length,
		});
	});

	it("los ids salen deduplicados y en orden canónico", async () => {
		const result = await captureProgramKnowledgeCut(
			ok({
				read: () => ({
					adjustments: [R1, A1, A1],
					phaseEvents: [E2, E1],
					baseline: BASELINE,
				}),
			}),
		);
		expect(result).toMatchObject({
			knows: { adjustmentIds: ["A1", "R1"], phaseEventIds: ["E1", "E2"] },
		});
	});

	it("dos capturas del mismo estado dan lo mismo", async () => {
		const uno = await captureProgramKnowledgeCut(ok());
		const dos = await captureProgramKnowledgeCut(ok());
		expect(uno).toEqual(dos);
	});

	it("lee una sola vez", async () => {
		let veces = 0;
		await captureProgramKnowledgeCut(
			ok({
				read: () => {
					veces++;
					return {
						adjustments: [A1, R1],
						phaseEvents: [E1, E2],
						baseline: BASELINE,
					};
				},
			}),
		);
		expect(veces).toBe(1);
	});
});

// -------------------------------------------------------------- refusals

describe("cuándo se niega a capturar", () => {
	it("el arranque no ha terminado", async () => {
		expect(
			await captureProgramKnowledgeCut(ok({ bootstrapReady: false })),
		).toEqual({ kind: "not-ready" });
	});

	it("hay un sync en vuelo", async () => {
		expect(await captureProgramKnowledgeCut(ok({ syncIdle: false }))).toEqual({
			kind: "sync-in-flight",
		});
	});

	it("quedan escrituras sin llegar al disco, y dice cuántas", async () => {
		expect(await captureProgramKnowledgeCut(ok({ pendingWrites: 3 }))).toEqual({
			kind: "writes-pending",
			count: 3,
		});
	});

	it("cutAt es mañana", async () => {
		expect(
			await captureProgramKnowledgeCut(
				ok({ cutAt: "2026-12-02", today: "2026-12-01" }),
			),
		).toEqual({ kind: "future-cut", cutAt: "2026-12-02", today: "2026-12-01" });
	});

	it("cutAt hoy y cutAt ayer se aceptan", async () => {
		for (const cutAt of ["2026-12-01", "2026-11-30"]) {
			expect(await captureProgramKnowledgeCut(ok({ cutAt }))).toHaveProperty(
				"knows",
			);
		}
	});

	it("una revocación cuyo objetivo no está en el conjunto", async () => {
		const result = await captureProgramKnowledgeCut(
			ok({
				read: () => ({
					adjustments: [R1],
					phaseEvents: [E1],
					baseline: BASELINE,
				}),
			}),
		);
		expect(result).toMatchObject({ kind: "dangling" });
	});

	it("una revocación de fase cuyo objetivo no está tampoco", async () => {
		const suelta: PhaseEvent = {
			kind: "revocation",
			id: "E9",
			revokesId: "no_existe",
			reason: "",
			createdAt: 3,
		};
		const result = await captureProgramKnowledgeCut(
			ok({
				read: () => ({
					adjustments: [],
					phaseEvents: [E1, suelta],
					baseline: BASELINE,
				}),
			}),
		);
		expect(result).toMatchObject({ kind: "dangling" });
	});

	/** El orden de las comprobaciones: lo barato y lo seguro primero. */
	it("no llega a leer si una precondición falla", async () => {
		let leyo = false;
		await captureProgramKnowledgeCut(
			ok({
				bootstrapReady: false,
				read: () => {
					leyo = true;
					return { adjustments: [], phaseEvents: [], baseline: [] };
				},
			}),
		);
		expect(leyo).toBe(false);
	});
});

// ------------------------------------------------------------- resolution

describe("comprobar una versión antes de resolverla", () => {
	const version = async (
		overrides: Partial<ProgramVersion> = {},
	): Promise<ProgramVersion> => ({
		id: "v3",
		name: "v3",
		cutAt: "2026-12-01",
		knows: { adjustmentIds: ["A1", "R1"], phaseEventIds: ["E1", "E2"] },
		createdAt: 0,
		reason: "prueba",
		baselineFingerprint: await baselineFingerprint(BASELINE),
		baselineSize: BASELINE.length,
		...overrides,
	});

	const todo = {
		adjustments: [A1, R1],
		phaseEvents: [E1, E2],
		baseline: BASELINE,
	};

	it("con todo presente, sigue adelante", async () => {
		const result = checkVersion({ version: await version(), ...todo });
		expect(result.kind).toBe("ok");
	});

	it("acota el universo a lo que la versión conocía", async () => {
		const extra: PlanAdjustment = { ...A1, id: "A9" };
		const result = checkVersion({
			version: await version(),
			...todo,
			adjustments: [A1, R1, extra],
		});
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.universe.adjustments.map((a) => a.id)).toEqual(["A1", "R1"]);
	});

	it("faltando un ajuste → incomplete, y dice cuál", async () => {
		const result = checkVersion({
			version: await version(),
			...todo,
			adjustments: [A1],
		});
		expect(result).toMatchObject({
			kind: "incomplete",
			missingAdjustmentIds: ["R1"],
		});
	});

	it("faltando un evento de fase → incomplete", async () => {
		const result = checkVersion({
			version: await version(),
			...todo,
			phaseEvents: [E1],
		});
		expect(result).toMatchObject({
			kind: "incomplete",
			missingPhaseEventIds: ["E2"],
		});
	});

	/** Con los datos presentes y el corte contradictorio: no es «me falta». */
	it("un corte con una referencia colgando → invalid, no incomplete", async () => {
		const roto = await version({
			knows: { adjustmentIds: ["R1"], phaseEventIds: ["E1"] },
		});
		const result = checkVersion({ version: roto, ...todo });
		expect(result).toMatchObject({
			kind: "invalid",
			code: "dangling-reference",
		});
	});

	it("base con menos filas → incomplete, no baseline-mismatch", async () => {
		const result = checkVersion({
			version: await version(),
			...todo,
			baseline: [BASELINE[0]],
		});
		expect(result).toMatchObject({ kind: "incomplete", baselineMissing: true });
	});

	it("y la huella distinta con el mismo tamaño → invalid", async () => {
		const otra = [makeBaseline({ sets: 9 }), BASELINE[1]];
		expect(await checkBaseline(await version(), otra)).toMatchObject({
			kind: "invalid",
			code: "baseline-mismatch",
		});
	});

	it("la huella correcta pasa", async () => {
		expect(await checkBaseline(await version(), BASELINE)).toEqual({
			kind: "ok",
		});
	});

	/** Más filas que las que conoció no es «de más»: la base es un estado. */
	it("base con más filas → la huella no cuadra", async () => {
		const crecida = [...BASELINE, makeBaseline({ id: "slot_a_03" })];
		expect(await checkBaseline(await version(), crecida)).toMatchObject({
			kind: "invalid",
			code: "baseline-mismatch",
		});
	});

	/**
	 * Lo que el fingerprint compra: dos dispositivos con los mismos logs y bases
	 * distintas no pueden decir los dos que resolvieron.
	 */
	it("dos bases distintas: como mucho una resuelve", async () => {
		const v = await version();
		const otra = [makeBaseline({ sets: 9 }), BASELINE[1]];

		const unoOk = await checkBaseline(v, BASELINE);
		const dosOk = await checkBaseline(v, otra);

		const resueltos = [unoOk, dosOk].filter((r) => r.kind === "ok");
		expect(resueltos).toHaveLength(1);
	});
});
