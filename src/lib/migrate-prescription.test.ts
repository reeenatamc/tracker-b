/**
 * The E3 migration, against synthetic data only.
 *
 * Two things get the most attention. The phase adjustments carry the *program's*
 * start date rather than the phase's planned start, so the phase gate is what
 * decides when they take effect — which is what makes them follow a late or an
 * early entry alike. And an override with no timestamp is dated at the migration,
 * never at the start of the program, because claiming it existed in August would
 * fabricate history that looks exactly like the real kind.
 *
 * The guard is tested too. Nothing calls this migration at startup, which is the
 * real protection; the guard is the belt underneath, and a belt nobody tries is
 * not a belt.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Collections } from "@/db/collections";
import { PROGRAM } from "@/domain/__fixtures__/program";
import { resolvePrescription } from "@/domain/prescription";
import type { PlanAdjustment, PrescriptionBaseline } from "@/domain/schema";
import {
	buildBaseline,
	buildOverrideAdjustments,
	buildPhaseAdjustments,
	guardMigration,
	MigrationRefused,
	migratePrescription,
	seededEntryId,
} from "@/lib/migrate-prescription";

type Row = Record<string, unknown> & { id: string };

function makeCollection(rows: Row[] = []) {
	const byId = new Map(rows.map((row) => [row.id, { ...row }]));
	return {
		get toArray() {
			return [...byId.values()];
		},
		has: (id: string) => byId.has(id),
		insert: (value: Row) => byId.set(value.id, { ...value }),
		update: (id: string, mutate: (draft: Row) => void) => {
			const draft = { ...(byId.get(id) as Row) };
			mutate(draft);
			byId.set(id, draft);
		},
	};
}

function makeCollections(seed: Partial<Record<string, Row[]>> = {}) {
	const raw = {
		sessions: makeCollection(seed.sessions ?? []),
		overrides: makeCollection(seed.overrides ?? []),
		prescriptionBaseline: makeCollection(),
		planAdjustments: makeCollection(),
		planSnapshots: makeCollection(),
	};
	return { raw, ...raw } as unknown as Collections;
}

const TEST_DB = { databaseName: "e3-test", confirmed: false };
const MIGRATED_ON = "2026-12-01";
const MIGRATED_AT = Date.parse("2026-12-01T12:00:00Z");

let collections: Collections;
beforeEach(() => {
	collections = makeCollections();
});

// --------------------------------------------------------------------- guard

describe("la migración no puede tocar la base real por accidente", () => {
	it("se niega contra la base real sin confirmación", () => {
		expect(() =>
			guardMigration({ databaseName: "operacion-tesis", confirmed: false }),
		).toThrow(MigrationRefused);
	});

	it("deja pasar una base de prueba", () => {
		expect(() => guardMigration(TEST_DB)).not.toThrow();
	});

	it("y la real sólo con confirmación explícita", () => {
		expect(() =>
			guardMigration({ databaseName: "operacion-tesis", confirmed: true }),
		).not.toThrow();
	});

	/**
	 * La protección de verdad: no está enchufada. Una guarda se puede saltar
	 * enchufándola mal; una función que nadie llama no corre por abrir localhost.
	 */
	it("nada de la app la llama", () => {
		const callers = sources(join(import.meta.dirname, ".."))
			.filter(([path]) => !path.endsWith("migrate-prescription.ts"))
			.filter(([, source]) => source.includes("migratePrescription("))
			.map(([path]) => path);

		expect(callers, `la llaman: ${callers.join(", ")}`).toEqual([]);
	});
});

/** Todo el código de aplicación, sin pruebas. */
function sources(dir: string): Array<[string, string]> {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sources(path);
		if (!/\.tsx?$/.test(name) || name.includes(".test.")) return [];
		return [[path, readFileSync(path, "utf8")] as [string, string]];
	});
}

// ------------------------------------------------------------------ baseline

describe("sembrar la base", () => {
	it("un hueco por ejercicio de cada plantilla", () => {
		const baseline = buildBaseline(PROGRAM, MIGRATED_AT);
		const template = PROGRAM.sessions[0];

		expect(baseline).toHaveLength(template.exercises.length);
		expect(baseline[0].id).toBe(seededEntryId(template.id, 0));
	});

	it("los ids son legibles y no dependen del ocupante", () => {
		const baseline = buildBaseline(PROGRAM, MIGRATED_AT);
		for (const row of baseline) {
			expect(row.id).toMatch(/^slot_[a-z0-9_]+$/);
			expect(row.id).not.toContain(row.exerciseId);
		}
	});

	it("arranca con la prescripción de la fase de menor orden", () => {
		const baseline = buildBaseline(PROGRAM, MIGRATED_AT);
		const first = PROGRAM.sessions[0].exercises[0];
		expect(baseline[0].sets).toEqual(first.setsByPhase[1]);
	});
});

// ---------------------------------------------------------- phase adjustments

describe("la variación por fase se vuelve un ajuste del programa", () => {
	const baseline = buildBaseline(PROGRAM, MIGRATED_AT);
	const adjustments = buildPhaseAdjustments(PROGRAM, baseline, MIGRATED_AT);

	/** Sin esto, los bucles de abajo pasarían sin comprobar nada. */
	it("hay variación que convertir", () => {
		expect(adjustments.length).toBeGreaterThan(0);
	});

	it("los marca como venidos del plan, no como decisiones tuyas", () => {
		for (const adjustment of adjustments) {
			expect(adjustment.origin).toBe("program");
			expect(adjustment.provenance).toMatchObject({
				kind: "migrated",
				from: "setsByPhase",
				assumedEffectiveOn: false,
			});
		}
	});

	/** El punto de la corrección: la compuerta es la fase, no la fecha. */
	it("llevan la fecha de inicio del programa, no el plannedStart de su fase", () => {
		for (const adjustment of adjustments) {
			expect(adjustment.effectiveOn).toBe(PROGRAM.meta.startDate);
			expect(adjustment.onlyInPhase).not.toBeNull();
		}
	});

	it("cada uno lleva su motivo escrito", () => {
		for (const adjustment of adjustments) {
			expect(adjustment.reason.length).toBeGreaterThan(20);
		}
	});

	it("sólo hay ajuste cuando las series difieren de la base", () => {
		const withoutVariation = adjustments.filter((adjustment) => {
			if (adjustment.kind !== "set_field") return false;
			const slot = baseline.find((row) => row.id === adjustment.entryId);
			return (
				JSON.stringify(slot?.sets) === JSON.stringify(adjustment.change.value)
			);
		});
		expect(withoutVariation).toEqual([]);
	});

	/**
	 * La compuerta es `onlyInPhase`, así que la misma fecha da una cosa u otra según
	 * en qué fase estés de verdad. Entrar tarde y entrar pronto tienen que dar los
	 * dos lo mismo — es lo que `plannedStart` habría roto en el segundo caso.
	 */
	describe("y sigue la entrada real a la fase", () => {
		const sets = (date: string, phase: string) =>
			resolvePrescription(
				baseline,
				adjustments,
				baseline[0].templateId,
				{ effectiveOn: date, knows: null },
				() => phase,
			).map((entry) => JSON.stringify(entry.sets));

		// prensa · abducción · step-down · equilibrio, por `order`.
		const target = "progresion";
		const inPhase = ["3", "2", "2", "3"];
		const base = ["2", "2", "null", "3"];

		it("entrando tarde", () => {
			expect(sets("2026-12-20", target)).toEqual(inPhase);
			expect(sets("2026-12-20", "adaptacion")).toEqual(base);
		});

		it("y entrando pronto — el caso que plannedStart habría roto", () => {
			expect(sets("2026-08-20", target)).toEqual(inPhase);
			expect(sets("2026-08-20", "adaptacion")).toEqual(base);
		});

		it("pero nunca antes de que empezara el programa", () => {
			expect(sets("2026-08-01", target)).toEqual(base);
		});
	});
});

// ------------------------------------------------------- override adjustments

describe("migrar un ExerciseOverride", () => {
	const baseline: PrescriptionBaseline[] = buildBaseline(PROGRAM, MIGRATED_AT);
	const exerciseId = baseline[0].exerciseId;

	it("con fecha fiable conserva su fecha", () => {
		const { adjustments, assumedDates } = buildOverrideAdjustments(
			[
				{
					id: "ov1",
					exerciseId,
					setsOverride: 4,
					updatedAt: Date.parse("2026-09-15T10:00:00Z"),
				},
			],
			baseline,
			MIGRATED_ON,
			MIGRATED_AT,
		);

		expect(adjustments[0].effectiveOn).toBe("2026-09-15");
		expect(adjustments[0].provenance).toMatchObject({
			assumedEffectiveOn: false,
		});
		expect(assumedDates).toEqual([]);
	});

	/**
	 * Sin fecha, se data en la migración. Ponerle el inicio del programa afirmaría
	 * que existía entonces, y no lo sabemos.
	 */
	it("sin fecha se data en la migración, y se anota la suposición", () => {
		const { adjustments, assumedDates } = buildOverrideAdjustments(
			[{ id: "ov2", exerciseId, setsOverride: 4 }],
			baseline,
			MIGRATED_ON,
			MIGRATED_AT,
		);

		expect(adjustments[0].effectiveOn).toBe(MIGRATED_ON);
		expect(adjustments[0].effectiveOn).not.toBe(PROGRAM.meta.startDate);
		expect(adjustments[0].provenance).toMatchObject({
			kind: "migrated",
			from: "exerciseOverride",
			assumedEffectiveOn: true,
		});
		expect(assumedDates).toEqual(["ov2"]);
	});

	it("y por eso no aparece en una sesión anterior a la migración", () => {
		const { adjustments } = buildOverrideAdjustments(
			[{ id: "ov3", exerciseId, setsOverride: 9 }],
			baseline,
			MIGRATED_ON,
			MIGRATED_AT,
		);

		const before = resolvePrescription(
			baseline,
			adjustments,
			baseline[0].templateId,
			{ effectiveOn: "2026-09-01", knows: null },
			() => "adaptacion",
		);
		expect(before.find((entry) => entry.id === baseline[0].id)?.sets).not.toBe(
			9,
		);
	});
});

// ------------------------------------------------------------------- the run

describe("la migración entera", () => {
	const session = (id: string, contract: string | null = null): Row => ({
		id,
		date: "2026-09-01",
		templateId: "full_body_a",
		phase: "adaptacion",
		completed: true,
		notes: null,
		startedAt: null,
		endedAt: null,
		skippedExerciseIds: [],
		extraExerciseIds: [],
		prescriptionContract: contract,
		snapshotId: null,
	});

	it("siembra, ajusta y marca el contrato", () => {
		collections = makeCollections({ sessions: [session("s1"), session("s2")] });
		const report = migratePrescription(collections, PROGRAM, {
			guard: TEST_DB,
			migratedOn: MIGRATED_ON,
			migratedAt: MIGRATED_AT,
		});

		expect(report.baselineSeeded).toBeGreaterThan(0);
		expect(report.sessionsMarkedLegacy).toBe(2);
		expect(
			collections.raw.sessions.toArray.map((row) => row.prescriptionContract),
		).toEqual(["legacy", "legacy"]);
	});

	it("es idempotente", () => {
		collections = makeCollections({ sessions: [session("s1")] });
		const options = {
			guard: TEST_DB,
			migratedOn: MIGRATED_ON,
			migratedAt: MIGRATED_AT,
		};

		migratePrescription(collections, PROGRAM, options);
		const afterFirst = collections.raw.prescriptionBaseline.toArray.length;
		const second = migratePrescription(collections, PROGRAM, options);

		expect(second.baselineSeeded).toBe(0);
		expect(second.phaseAdjustments).toBe(0);
		expect(second.sessionsMarkedLegacy).toBe(0);
		expect(collections.raw.prescriptionBaseline.toArray).toHaveLength(
			afterFirst,
		);
	});

	it("no toca una sesión que ya declara su contrato", () => {
		collections = makeCollections({
			sessions: [session("s1", "snapshot_v1")],
		});
		const report = migratePrescription(collections, PROGRAM, {
			guard: TEST_DB,
			migratedOn: MIGRATED_ON,
			migratedAt: MIGRATED_AT,
		});

		expect(report.sessionsMarkedLegacy).toBe(0);
		expect(collections.raw.sessions.toArray[0].prescriptionContract).toBe(
			"snapshot_v1",
		);
	});

	it("reporta los ids de hueco que creó", () => {
		const report = migratePrescription(collections, PROGRAM, {
			guard: TEST_DB,
			migratedOn: MIGRATED_ON,
			migratedAt: MIGRATED_AT,
		});
		expect(report.entryIds.length).toBe(report.baselineSeeded);
	});

	it("se niega contra la base real", () => {
		expect(() =>
			migratePrescription(collections, PROGRAM, {
				guard: { databaseName: "operacion-tesis", confirmed: false },
				migratedOn: MIGRATED_ON,
				migratedAt: MIGRATED_AT,
			}),
		).toThrow(MigrationRefused);
	});
});

// --------------------------------------------------------- equivalence check

describe("equivalencia con slotOf, día a día", () => {
	/**
	 * Después de sembrar y convertir, resolver en cualquier fecha tiene que dar las
	 * mismas series que daba `setsByPhase` leído por su ranura.
	 */
	it("las series resueltas coinciden con setsByPhase en cada fase", () => {
		const baseline = buildBaseline(PROGRAM, MIGRATED_AT);
		const adjustments: PlanAdjustment[] = buildPhaseAdjustments(
			PROGRAM,
			baseline,
			MIGRATED_AT,
		);
		const template = PROGRAM.sessions[0];

		for (const phase of PROGRAM.phases) {
			const resolved = resolvePrescription(
				baseline,
				adjustments,
				template.id,
				{ effectiveOn: "2027-01-01", knows: null },
				() => phase.id,
			);

			template.exercises.forEach((exercise, index) => {
				const entry = resolved.find(
					(row) => row.id === seededEntryId(template.id, index),
				);
				const expected =
					exercise.setsByPhase[(phase.legacyId ?? 1) as 1 | 2 | 3 | 4];
				expect(entry?.sets, `${phase.id} · ${exercise.id}`).toEqual(expected);
			});
		}
	});
});
