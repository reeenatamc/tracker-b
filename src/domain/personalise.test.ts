/**
 * The session list, now that the prescription arrives resolved.
 *
 * The interesting change is what is *not* here any more: no `applyOverride`, no
 * phase indexing a column. This module gets a list of entries and joins it to who
 * the exercises are. Everything that decides those entries lives in
 * `prescription.ts`, which is where it can be reasoned about.
 */

import { describe, expect, it } from "vitest";
import { PROGRAM } from "./__fixtures__/program";
import {
	customToExercise,
	findExercise,
	resolveSessionExercises,
	setsOf,
	skippedExercises,
	withPrescription,
} from "./personalise";
import type {
	CustomExercise,
	PrescriptionEntry,
	SessionRecord,
	SetCount,
} from "./schema";

const template = PROGRAM.sessions[0];

function entry(
	exerciseId: string,
	sets: SetCount,
	order: number,
	overrides: Partial<PrescriptionEntry> = {},
): PrescriptionEntry {
	const source = template.exercises.find((e) => e.id === exerciseId);
	if (!source) throw new Error(`sin ejercicio ${exerciseId}`);
	return {
		id: `slot_${exerciseId}`,
		templateId: template.id,
		exerciseId,
		order,
		sets,
		target: source.target,
		load: source.load,
		rir: source.rir,
		restSeconds: source.restSeconds,
		trainingRole: "strength",
		goal: source.goal,
		progression: source.progression,
		cues: [],
		allowedSubstitutions: [],
		...overrides,
	};
}

/** What phase 1 of the fixture prescribes: no step-down yet. */
const PHASE_ONE: PrescriptionEntry[] = [
	entry("prensa", 2, 3),
	entry("abduccion", 2, 7),
	entry("step-down-bajo", null, 8),
	entry("balance-unilateral", 3, 10),
];

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
	return {
		id: "s1",
		date: "2026-08-10",
		templateId: template.id,
		phase: PROGRAM.phases[0].id,
		completed: false,
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

const CUSTOM: CustomExercise = {
	id: "custom-hip-thrust",
	name: "Hip thrust",
	target: { kind: "reps", min: 8, max: 12 },
	load: {
		startKg: 40,
		perSide: false,
		relativeToBase: false,
		bodyweight: false,
		needsCalibration: false,
		incrementKg: 5,
		raw: "40 kg",
	},
	sets: 3,
	isAnkle: false,
	progression: "Doble progresión",
	goal: "Glúteo",
};

// ------------------------------------------------------------ withPrescription

describe("withPrescription", () => {
	const prensa = template.exercises[0];

	it("toma del plan todo lo que el plan decide", () => {
		const result = withPrescription(
			prensa,
			entry("prensa", 3, 1, {
				load: { ...prensa.load, startKg: 40, incrementKg: 5 },
				rir: { min: 1, max: 2 },
				restSeconds: { min: 120, max: 120 },
			}),
		);

		expect(result.load).toMatchObject({ startKg: 40, incrementKg: 5 });
		expect(result.rir).toEqual({ min: 1, max: 2 });
		expect(result.restSeconds).toEqual({ min: 120, max: 120 });
	});

	it("y del ejercicio todo lo que es del movimiento", () => {
		const result = withPrescription(prensa, entry("prensa", 3, 1));
		expect(result.name).toBe(prensa.name);
		expect(result.muscle).toBe(prensa.muscle);
		expect(result.isAnkle).toBe(prensa.isAnkle);
	});

	it("una señal escrita para esta prescripción gana a la de la biblioteca", () => {
		const result = withPrescription(
			prensa,
			entry("prensa", 3, 1, { cues: ["rodillas fuera"] }),
		);
		expect(result.technique).toBe("rodillas fuera");
	});
});

// ----------------------------------------------------- resolveSessionExercises

describe("resolveSessionExercises", () => {
	const base = { template, entries: PHASE_ONE, customExercises: [] };

	it("devuelve lo que el plan prescribe hoy, en orden", () => {
		const list = resolveSessionExercises({ ...base, session: null });
		expect(list.map((e) => e.id)).toEqual([
			"prensa",
			"abduccion",
			"balance-unilateral",
		]);
	});

	it("omite un hueco sin series: todavía no está introducido", () => {
		const list = resolveSessionExercises({ ...base, session: null });
		expect(list.map((e) => e.id)).not.toContain("step-down-bajo");
	});

	it("quita lo que saltaste hoy", () => {
		const list = resolveSessionExercises({
			...base,
			session: makeSession({ skippedExerciseIds: ["prensa"] }),
		});
		expect(list.map((e) => e.id)).not.toContain("prensa");
	});

	it("añade lo que metiste tú, detrás de lo programado", () => {
		const list = resolveSessionExercises({
			...base,
			customExercises: [CUSTOM],
			session: makeSession({ extraExerciseIds: [CUSTOM.id] }),
		});
		expect(list.at(-1)?.id).toBe(CUSTOM.id);
	});

	/**
	 * Un hueco cuyo ejercicio ya no está en la plantilla no revienta la pantalla.
	 * Puede pasar reordenando contenido, y quedarse sin sesión sería peor.
	 */
	it("ignora un hueco que apunta a un ejercicio que no está", () => {
		const list = resolveSessionExercises({
			...base,
			entries: [
				...PHASE_ONE,
				entry("prensa", 2, 99, { exerciseId: "fantasma" }),
			],
			session: null,
		});
		expect(list).toHaveLength(3);
	});

	it("un ejercicio reordenado por el plan se coloca donde dice el plan", () => {
		const list = resolveSessionExercises({
			...base,
			entries: [entry("prensa", 2, 99), entry("abduccion", 2, 1)],
			session: null,
		});
		expect(list.map((e) => e.id)).toEqual(["abduccion", "prensa"]);
	});
});

// ------------------------------------------------------------------- setsOf

describe("setsOf", () => {
	it("un número es un rango de un punto", () => {
		expect(setsOf(entry("prensa", 2, 1))).toEqual({ min: 2, max: 2 });
	});

	it("un rango conserva las dos puntas", () => {
		expect(setsOf(entry("prensa", [2, 3], 1))).toEqual({ min: 2, max: 3 });
	});

	it("sin series es null", () => {
		expect(setsOf(entry("prensa", null, 1))).toBeNull();
	});

	it("y sin hueco también", () => {
		expect(setsOf(undefined)).toBeNull();
	});
});

// ---------------------------------------------------------- skippedExercises

describe("skippedExercises", () => {
	it("lista lo saltado, para poder reponerlo", () => {
		const list = skippedExercises({
			template,
			entries: PHASE_ONE,
			session: makeSession({
				skippedExerciseIds: ["prensa", "step-down-bajo"],
			}),
		});
		// El step-down no está prescrito todavía, así que no se ofrece de vuelta.
		expect(list.map((e) => e.id)).toEqual(["prensa"]);
	});
});

// -------------------------------------------------------------- findExercise

describe("findExercise", () => {
	it("encuentra uno programado, tal cual", () => {
		const found = findExercise(PROGRAM.sessions, [], "prensa");
		expect(found?.name).toBe("Prensa");
	});

	it("y uno tuyo", () => {
		const found = findExercise(PROGRAM.sessions, [CUSTOM], CUSTOM.id);
		expect(found).toEqual(customToExercise(CUSTOM, 0));
	});

	it("null si no está en ninguna parte", () => {
		expect(findExercise(PROGRAM.sessions, [], "no_existe")).toBeNull();
	});
});
