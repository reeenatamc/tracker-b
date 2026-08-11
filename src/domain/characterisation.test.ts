/**
 * What the engine decides today, written down so it cannot drift.
 *
 * These are not assertions about what the rules *should* say — `progression.test.ts`
 * already argues that. These pin what they *do* say, for a frozen log, so that
 * moving the program out of the YAML and into a library and an adjustment log
 * cannot quietly change a single suggestion.
 *
 * A failure here is not necessarily a bug. It means a refactor changed an
 * answer, and somebody has to decide whether that was the point.
 */

import { describe, expect, it } from "vitest";
import { SCENARIOS, SESSIONS, SETS } from "./__fixtures__/log";
import { PROGRAM } from "./__fixtures__/program";
import { summarise } from "./achievements";
import { previousPerformance, setsFor } from "./history";
import { decideProgression, type ProgressionDecision } from "./progression";

/** The answer for each scenario, in the order the fixture states them. */
const EXPECTED: Record<string, ProgressionDecision> = {
	"sin historial arranca en la carga programada": {
		kind: "start",
		loadKg: 20,
		perSide: false,
	},
	"sin historial y sin carga conocida pide calibrar": { kind: "calibrate" },
	"un objetivo en segundos no se progresa con aritmética": {
		kind: "qualitative",
	},
	"menos series de las que pide la fase mantiene el peso": {
		kind: "hold",
		loadKg: 20,
		perSide: false,
		reason: "setsIncomplete",
	},
	"12/10 mantiene: no todas las series llegaron al tope": {
		kind: "hold",
		loadKg: 20,
		perSide: false,
		reason: "repsBelowTop",
	},
	"sin RIR registrado no se puede evaluar la regla": {
		kind: "hold",
		loadKg: 20,
		perSide: false,
		reason: "rirUnknown",
	},
	"reps al tope pero demasiado cerca del fallo mantiene": {
		kind: "hold",
		loadKg: 20,
		perSide: false,
		reason: "rirTooLow",
	},
	"rango completado con RIR en objetivo sube el incremento por defecto": {
		kind: "increase",
		fromKg: 20,
		toKg: 22.5,
		incrementKg: 2.5,
		perSide: false,
	},
	"el incremento de la máquina manda sobre el de por defecto": {
		kind: "increase",
		fromKg: 20,
		toKg: 25,
		incrementKg: 5,
		perSide: false,
	},
	"el peso de trabajo no es el más pesado que tocaste": {
		kind: "hold",
		loadKg: 20,
		perSide: false,
		reason: "repsBelowTop",
	},
	"a peso corporal el rango completado hace el movimiento más difícil": {
		kind: "advanceDifficulty",
	},
	"el dolor de tobillo manda sobre el rango completado": {
		kind: "blocked",
		signals: ["pain"],
	},
	"la hinchazón bloquea aunque el dolor sea cero": {
		kind: "blocked",
		signals: ["swelling"],
	},
	"hoy el dolor en un ejercicio sin tobillo no frena la subida": {
		kind: "increase",
		fromKg: 20,
		toKg: 22.5,
		incrementKg: 2.5,
		perSide: false,
	},
	"la rehabilitación no espera un RIR que nadie va a registrar": {
		kind: "advanceDifficulty",
	},
};

describe("decisiones de progresión, congeladas", () => {
	it("cubre todos los escenarios del fixture", () => {
		expect(Object.keys(EXPECTED).sort()).toEqual(
			SCENARIOS.map((scenario) => scenario.name).sort(),
		);
	});

	it.each(
		SCENARIOS.map((scenario) => [scenario.name, scenario] as const),
	)("%s", (name, scenario) => {
		expect(decideProgression(scenario)).toEqual(EXPECTED[name]);
	});
});

describe("lectura del historial, congelada", () => {
	it("la vez pasada es la sesión más reciente que registró el ejercicio", () => {
		const previous = previousPerformance(SETS, SESSIONS, "lat_pulldown", null);

		expect(previous?.date).toBe("2026-08-31");
		expect(previous?.sets.map((set) => [set.load, set.reps])).toEqual([
			[22.5, 10],
			[22.5, 10],
		]);
	});

	it("excluye la sesión en curso al buscar la anterior", () => {
		const previous = previousPerformance(
			SETS,
			SESSIONS,
			"lat_pulldown",
			"session-4",
		);

		expect(previous?.date).toBe("2026-08-24");
	});

	it("devuelve las series de una sesión en orden", () => {
		expect(
			setsFor(SETS, "session-2", "lat_pulldown").map((set) => set.setNumber),
		).toEqual([1, 2]);
	});

	it("no inventa historial para un ejercicio que nunca se registró", () => {
		expect(previousPerformance(SETS, SESSIONS, "leg_press", null)).toBeNull();
	});
});

describe("resumen de progreso, congelado", () => {
	const progress = summarise(PROGRAM, SESSIONS, SETS, "2026-08-31");

	it("cuenta la semana desde el arranque del programa", () => {
		expect(progress.week).toBe(4);
	});

	it("sitúa la fecha en su fase", () => {
		expect(progress.phaseId).toBe(2);
	});

	it("cuenta sólo las sesiones con algo registrado", () => {
		expect(progress.totalSessions).toBe(4);
	});

	it("reconoce la subida de carga como ganancia", () => {
		expect(progress.gains).toEqual([
			{
				exerciseId: "lat_pulldown",
				from: 20,
				to: 22.5,
				unit: "kg",
				perSide: false,
			},
		]);
	});
});
