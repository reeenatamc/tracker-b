/**
 * Test fixtures.
 *
 * Mirrors the real program's structure and its actual phase dates, but is
 * hand-written so the domain tests run on a fresh clone where `content/` (which
 * is gitignored) does not exist.
 */

import type { Exercise, Program, SetRecord } from "../schema";

export function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
	return {
		id: "jalon-al-pecho",
		name: "Jalón al pecho",
		order: 5,
		setsByPhase: { 1: 2, 2: 3, 3: 3, 4: [2, 3] },
		target: { kind: "reps", min: 10, max: 12 },
		load: {
			startKg: 20,
			perSide: false,
			relativeToBase: false,
			bodyweight: false,
			needsCalibration: false,
			incrementKg: null,
			raw: "20 kg",
		},
		progression: "Doble progresión",
		goal: "Dorsal/postura",
		muscle: "Dorsal + bíceps",
		rir: { min: 2, max: 2 },
		restSeconds: { min: 90, max: 90 },
		substitution: "Jalón agarre neutro",
		technique: "Agarre cómodo",
		isAnkle: false,
		...overrides,
	};
}

export function makeSet(overrides: Partial<SetRecord> = {}): SetRecord {
	return {
		id: "set-1",
		sessionId: "session-1",
		exerciseId: "jalon-al-pecho",
		setNumber: 1,
		isWarmup: false,
		load: 20,
		unit: "kg",
		reps: 12,
		rir: 2,
		anklePain: null,
		note: null,
		...overrides,
	};
}

/** Working sets at one load, described as `[reps, rir]` pairs. */
export function makeSets(
	loadKg: number,
	results: ReadonlyArray<[reps: number, rir: number | null]>,
	overrides: Partial<SetRecord> = {},
): SetRecord[] {
	return results.map(([reps, rir], index) =>
		makeSet({
			id: `set-${index + 1}`,
			setNumber: index + 1,
			load: loadKg,
			reps,
			rir,
			...overrides,
		}),
	);
}

export const PROGRAM: Program = {
	meta: {
		title: "Operación Tesis",
		startDate: "2026-08-08",
		checkpointDate: "2026-12-20",
		startWeightKg: 60,
	},
	phases: [
		{
			id: 1,
			name: "Adaptación",
			startDate: "2026-08-10",
			endDate: "2026-08-23",
			goal: "Técnica, tolerancia, cargas base, rehab",
			workingSets: 2,
			targetRir: { min: 2, max: 3 },
			weeklyCardioMinutes: { min: 70, max: 90 },
			coreWeeklySets: "2–3×/sem",
			ankleStage: "Base",
			progresses: "Carga",
			avoid: "Volumen",
		},
		{
			id: 2,
			name: "Construcción",
			startDate: "2026-08-24",
			endDate: "2026-10-04",
			goal: "Progresión estable y recomposición",
			workingSets: 3,
			targetRir: { min: 2, max: 2 },
			weeklyCardioMinutes: { min: 90, max: 120 },
			coreWeeklySets: "3×/sem",
			ankleStage: "Progreso",
			progresses: "Carga",
			avoid: "Volumen",
		},
		{
			id: 3,
			name: "Recomposición",
			startDate: "2026-10-05",
			endDate: "2026-11-15",
			goal: "Más fuerza/definición manteniendo volumen moderado",
			workingSets: 3,
			targetRir: { min: 1, max: 2 },
			weeklyCardioMinutes: { min: 120, max: 150 },
			coreWeeklySets: "3×/sem",
			ankleStage: "Dinámica",
			progresses: "Carga",
			avoid: "Volumen",
		},
		{
			id: 4,
			name: "Operación Cuadritos",
			startDate: "2026-11-16",
			endDate: null,
			goal: "Mantener músculo, definir, minimizar fatiga",
			workingSets: [2, 3],
			targetRir: { min: 1, max: 2 },
			weeklyCardioMinutes: { min: 120, max: 180 },
			coreWeeklySets: "3×/sem",
			ankleStage: "Mantenimiento",
			progresses: "Carga",
			avoid: "Volumen",
		},
	],
	weekStructure: [
		{
			weekday: "monday",
			block: "Full Body A",
			focus: "Pierna + espalda + glúteo + core",
			hasStrength: true,
			cardio: null,
			hasCore: true,
			hasAnkle: true,
			intensity: "RIR según fase",
			duration: "60–75 min",
			notes: "Sesión principal",
		},
		{
			weekday: "sunday",
			block: "Descanso",
			focus: "Recuperación",
			hasStrength: false,
			cardio: null,
			hasCore: false,
			hasAnkle: false,
			intensity: "—",
			duration: "—",
			notes: "Descanso total",
		},
	],
	sessions: [
		{
			id: "full_body_a",
			name: "Full Body A",
			weekday: "monday",
			exercises: [
				makeExercise({
					id: "prensa",
					name: "Prensa",
					order: 3,
					setsByPhase: { 1: 2, 2: 3, 3: 3, 4: [2, 3] },
					isAnkle: true,
					load: {
						startKg: 5,
						perSide: true,
						relativeToBase: true,
						bodyweight: false,
						needsCalibration: false,
						incrementKg: null,
						raw: "+5 kg/lado",
					},
				}),
				makeExercise({
					id: "abduccion",
					name: "Abducción",
					order: 7,
					setsByPhase: { 1: 2, 2: 2, 3: 2, 4: 2 },
					target: { kind: "reps", min: 12, max: 15 },
					load: {
						startKg: 30,
						perSide: false,
						relativeToBase: false,
						bodyweight: false,
						needsCalibration: false,
						incrementKg: null,
						raw: "30 kg",
					},
				}),
				makeExercise({
					id: "step-down-bajo",
					name: "Step-down bajo",
					order: 8,
					// Not introduced until phase 2.
					setsByPhase: { 1: null, 2: 2, 3: 2, 4: 2 },
					target: { kind: "repsPerSide", min: 8, max: 8 },
					isAnkle: true,
				}),
				makeExercise({
					id: "balance-unilateral",
					name: "Equilibrio unilateral",
					order: 10,
					setsByPhase: { 1: 3, 2: 3, 3: 3, 4: [2, 3] },
					target: { kind: "secondsPerSide", seconds: 30 },
					isAnkle: true,
					load: {
						startKg: null,
						perSide: false,
						relativeToBase: false,
						bodyweight: true,
						needsCalibration: false,
						incrementKg: null,
						raw: "",
					},
				}),
			],
		},
	],
	objectives: [
		{
			objective: "Fuerza",
			target: "Progresar sin entrenar al fallo",
			measuredBy: "Reps + carga + RIR",
			frequency: "Cada sesión",
			priority: "Alta",
		},
	],
	keyRules: [{ rule: "RIR", detail: "Deja ~2 reps en reserva." }],
	cardio: [],
	ankleRehab: [],
	progressionRules: [
		{
			rule: "Doble progresión",
			detail:
				"Mantén el peso hasta completar el tope de reps en TODAS las series con técnica limpia y ~RIR 2; luego sube el incremento mínimo.",
			example: "Jalón 20 kg: 12/12 RIR 2 → probar siguiente placa.",
		},
	],
};
