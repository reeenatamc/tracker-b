/**
 * A frozen log, and the decisions the engine reaches for it today.
 *
 * This exists to be boring on purpose. Every later stage of the rebuild moves
 * where the program's data comes from, and the one thing that must not move is
 * what the engine tells you to lift. So the inputs here are written by hand,
 * never generated, and the expected outputs live next to them in
 * `characterisation.test.ts` — if a refactor changes a single suggestion, that
 * test fails and the change has to be deliberate.
 *
 * Nothing here is real training data. The numbers are chosen to sit exactly on
 * the boundaries the rules care about.
 */

import type { SafetyInput } from "../safety";
import type { Exercise, Range, SessionRecord, SetRecord } from "../schema";
import { makeExercise, makeSet } from "./program";

/** One progression question, fully specified. */
export type Scenario = {
	name: string;
	exercise: Exercise;
	/** Working sets from the most recent session holding this exercise. */
	lastSets: SetRecord[];
	targetRir: Range;
	targetSets: Range | null;
	safety?: SafetyInput;
};

const LOADED = {
	startKg: 20,
	perSide: false,
	relativeToBase: false,
	bodyweight: false,
	needsCalibration: false,
	incrementKg: null,
	raw: "20 kg",
};

const BODYWEIGHT = { ...LOADED, startKg: null, bodyweight: true, raw: "" };

/** Working sets at one load, as `[reps, rir]` pairs, with an ankle pain reading. */
function sets(
	loadKg: number | null,
	results: ReadonlyArray<[reps: number, rir: number | null]>,
	overrides: Partial<SetRecord> = {},
): SetRecord[] {
	return results.map(([reps, rir], index) =>
		makeSet({
			id: `set-${index + 1}`,
			setNumber: index + 1,
			exerciseId: "lat_pulldown",
			load: loadKg,
			unit: loadKg === null ? "bodyweight" : "kg",
			reps,
			rir,
			...overrides,
		}),
	);
}

const RIR_2: Range = { min: 2, max: 2 };
const TWO_SETS: Range = { min: 2, max: 2 };

export const SCENARIOS: readonly Scenario[] = [
	{
		name: "sin historial arranca en la carga programada",
		exercise: makeExercise({ id: "lat_pulldown", load: LOADED }),
		lastSets: [],
		targetRir: RIR_2,
		targetSets: TWO_SETS,
	},
	{
		name: "sin historial y sin carga conocida pide calibrar",
		exercise: makeExercise({
			id: "lat_pulldown",
			load: { ...LOADED, needsCalibration: true },
		}),
		lastSets: [],
		targetRir: RIR_2,
		targetSets: TWO_SETS,
	},
	{
		name: "un objetivo en segundos no se progresa con aritmética",
		exercise: makeExercise({
			id: "single_leg_balance",
			target: { kind: "secondsPerSide", seconds: 30 },
			load: BODYWEIGHT,
		}),
		lastSets: sets(null, [[30, null]], { exerciseId: "single_leg_balance" }),
		targetRir: RIR_2,
		targetSets: TWO_SETS,
	},
	{
		name: "menos series de las que pide la fase mantiene el peso",
		exercise: makeExercise({ id: "lat_pulldown", load: LOADED }),
		lastSets: sets(20, [[12, 2]]),
		targetRir: RIR_2,
		targetSets: { min: 2, max: 2 },
	},
	{
		name: "12/10 mantiene: no todas las series llegaron al tope",
		exercise: makeExercise({ id: "lat_pulldown", load: LOADED }),
		lastSets: sets(20, [
			[12, 2],
			[10, 2],
		]),
		targetRir: RIR_2,
		targetSets: TWO_SETS,
	},
	{
		name: "sin RIR registrado no se puede evaluar la regla",
		exercise: makeExercise({ id: "lat_pulldown", load: LOADED }),
		lastSets: sets(20, [
			[12, null],
			[12, null],
		]),
		targetRir: RIR_2,
		targetSets: TWO_SETS,
	},
	{
		name: "reps al tope pero demasiado cerca del fallo mantiene",
		exercise: makeExercise({ id: "lat_pulldown", load: LOADED }),
		lastSets: sets(20, [
			[12, 0],
			[12, 0],
		]),
		targetRir: RIR_2,
		targetSets: TWO_SETS,
	},
	{
		name: "rango completado con RIR en objetivo sube el incremento por defecto",
		exercise: makeExercise({ id: "lat_pulldown", load: LOADED }),
		lastSets: sets(20, [
			[12, 2],
			[12, 2],
		]),
		targetRir: RIR_2,
		targetSets: TWO_SETS,
	},
	{
		name: "el incremento de la máquina manda sobre el de por defecto",
		exercise: makeExercise({
			id: "lat_pulldown",
			load: { ...LOADED, incrementKg: 5 },
		}),
		lastSets: sets(20, [
			[12, 2],
			[12, 2],
		]),
		targetRir: RIR_2,
		targetSets: TWO_SETS,
	},
	{
		/*
		 * The spreadsheet's own example: 25 kg for 8 hard reps is not working
		 * weight. Taking the heaviest load touched would tell you to train at a
		 * weight you could not complete.
		 */
		name: "el peso de trabajo no es el más pesado que tocaste",
		exercise: makeExercise({ id: "lat_pulldown", load: LOADED }),
		lastSets: [
			...sets(20, [[12, 2]]),
			...sets(25, [[8, 0]]).map((set) => ({
				...set,
				id: "set-2",
				setNumber: 2,
			})),
		],
		targetRir: RIR_2,
		targetSets: TWO_SETS,
	},
	{
		name: "a peso corporal el rango completado hace el movimiento más difícil",
		exercise: makeExercise({ id: "step_down", load: BODYWEIGHT }),
		lastSets: sets(null, [
			[12, 2],
			[12, 2],
		]).map((set) => ({ ...set, exerciseId: "step_down" })),
		targetRir: RIR_2,
		targetSets: TWO_SETS,
	},
	{
		name: "el dolor de tobillo manda sobre el rango completado",
		exercise: makeExercise({ id: "calf_raise", isAnkle: true, load: LOADED }),
		lastSets: sets(
			20,
			[
				[12, 2],
				[12, 2],
			],
			{ exerciseId: "calf_raise", anklePain: 4 },
		),
		targetRir: RIR_2,
		targetSets: TWO_SETS,
	},
	{
		name: "la hinchazón bloquea aunque el dolor sea cero",
		exercise: makeExercise({ id: "calf_raise", isAnkle: true, load: LOADED }),
		lastSets: sets(
			20,
			[
				[12, 2],
				[12, 2],
			],
			{ exerciseId: "calf_raise", anklePain: 0 },
		),
		targetRir: RIR_2,
		targetSets: TWO_SETS,
		safety: { swelling: true },
	},
	{
		/*
		 * Frozen deliberately, because it is a gap rather than a feature: pain
		 * recorded against a non-ankle exercise does not stop the suggestion
		 * today. E6 replaces `isAnkle` with a joint query and this answer will
		 * change — which is exactly why it should fail loudly when it does.
		 */
		name: "hoy el dolor en un ejercicio sin tobillo no frena la subida",
		exercise: makeExercise({
			id: "lat_pulldown",
			isAnkle: false,
			load: LOADED,
		}),
		lastSets: sets(20, [
			[12, 2],
			[12, 2],
		]).map((set) => ({ ...set, anklePain: 4 })),
		targetRir: RIR_2,
		targetSets: TWO_SETS,
	},
	{
		name: "la rehabilitación no espera un RIR que nadie va a registrar",
		exercise: makeExercise({
			id: "band_eversion",
			isAnkle: true,
			rir: null,
			load: BODYWEIGHT,
		}),
		lastSets: sets(null, [
			[12, null],
			[12, null],
		]).map((set) => ({ ...set, exerciseId: "band_eversion" })),
		targetRir: RIR_2,
		targetSets: TWO_SETS,
	},
];

// ------------------------------------------------------------------ historial

/**
 * Four weeks of one exercise, so "la vez pasada" and the gains strip have
 * something with a shape to read: two sessions holding 20 kg, then the jump.
 */
export const SESSIONS: readonly SessionRecord[] = [
	"2026-08-10",
	"2026-08-17",
	"2026-08-24",
	"2026-08-31",
].map((date, index) => ({
	id: `session-${index + 1}`,
	date,
	templateId: "full_body_a",
	phase: (date < "2026-08-24" ? 1 : 2) as 1 | 2,
	completed: true,
	notes: null,
	startedAt: null,
	endedAt: null,
	skippedExerciseIds: [],
	extraExerciseIds: [],
}));

const WEEKLY: ReadonlyArray<[load: number, results: Array<[number, number]>]> =
	[
		[
			20,
			[
				[10, 3],
				[10, 3],
			],
		],
		[
			20,
			[
				[12, 2],
				[11, 2],
			],
		],
		[
			20,
			[
				[12, 2],
				[12, 2],
			],
		],
		[
			22.5,
			[
				[10, 2],
				[10, 2],
			],
		],
	];

export const SETS: readonly SetRecord[] = SESSIONS.flatMap((session, week) => {
	const [load, results] = WEEKLY[week];
	return results.map(([reps, rir], index) =>
		makeSet({
			id: `${session.id}-set-${index + 1}`,
			sessionId: session.id,
			exerciseId: "lat_pulldown",
			setNumber: index + 1,
			load,
			reps,
			rir,
		}),
	);
});
