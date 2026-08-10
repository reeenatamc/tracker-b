import { describe, expect, it } from "vitest";
import { PROGRAM } from "./__fixtures__/program";
import {
	cardioFor,
	isCardioDay,
	rehabAsExercise,
	rehabStageFor,
} from "./cardio-day";
import type { AnkleExercise, CardioPrescription, Program } from "./schema";

function rehab(
	stage: string,
	name: string,
	weeks: { min: number; max: number },
): AnkleExercise {
	return {
		id: name.toLowerCase().replace(/\W+/g, "_"),
		name,
		stage,
		weeks,
		sets: 2,
		target: { kind: "repsPerSide", min: 8, max: 10 },
		frequency: "3×/sem",
		progression: "Más rango",
		goal: "Dorsiflexión",
		baseline: "",
		painAllowed: "0–2/10",
		substitution: "",
		advanceCriteria: "",
		technique: "",
		isAnkle: true,
	};
}

const CARDIO: CardioPrescription[] = [
	{
		phase: 1,
		tuesday: { min: 25, max: 30 },
		thursday: { min: 25, max: 30 },
		saturday: { min: 20, max: 30 },
		weeklyTotal: { min: 70, max: 90 },
		modality: "Bici/elíptica/caminata estable",
		intensity: "RPE 4–6",
		progression: "+5 min",
		avoid: "Correr/HIIT",
		reduceWhen: "Tobillo sensible",
	},
	{
		phase: 2,
		tuesday: { min: 30, max: 35 },
		thursday: { min: 30, max: 35 },
		saturday: { min: 30, max: 40 },
		weeklyTotal: { min: 100, max: 130 },
		modality: "Igual",
		intensity: "RPE 4–6",
		progression: "Gradual",
		avoid: "HIIT frecuente",
		reduceWhen: "Cae la fuerza",
	},
];

const program: Program = {
	...PROGRAM,
	cardio: CARDIO,
	ankleRehab: [
		rehab("Sem 1–2", "Knee-to-wall", { min: 1, max: 2 }),
		rehab("Sem 1–2", "Eversión con banda", { min: 1, max: 2 }),
		rehab("Sem 3–4", "Step-down bajo", { min: 3, max: 4 }),
		rehab("Sem 5–6", "Y/Star reach", { min: 5, max: 6 }),
	],
};

describe("isCardioDay", () => {
	it("is true on the days v3 programs cardio", () => {
		expect(isCardioDay("2026-08-11")).toBe(true); // martes
		expect(isCardioDay("2026-08-13")).toBe(true); // jueves
		expect(isCardioDay("2026-08-15")).toBe(true); // sábado
	});

	it("is false on the strength days and on Sunday", () => {
		for (const date of [
			"2026-08-10",
			"2026-08-12",
			"2026-08-14",
			"2026-08-16",
		]) {
			expect(isCardioDay(date)).toBe(false);
		}
	});
});

describe("cardioFor", () => {
	it("gives the minutes for that weekday at the current phase", () => {
		expect(cardioFor(program, "2026-08-11")?.minutes).toEqual({
			min: 25,
			max: 30,
		});
		// Phase 2 starts 24 Aug and asks for more.
		expect(cardioFor(program, "2026-08-25")?.minutes).toEqual({
			min: 30,
			max: 35,
		});
	});

	it("marks Saturday as optional, because the plan offers it rather than programs it", () => {
		const saturday = cardioFor(program, "2026-08-15");
		expect(saturday?.optional).toBe(true);
		expect(saturday?.minutes).toEqual({ min: 20, max: 30 });

		expect(cardioFor(program, "2026-08-11")?.optional).toBe(false);
	});

	it("is null on a strength day", () => {
		expect(cardioFor(program, "2026-08-10")).toBeNull();
	});

	it("survives a phase with no cardio row", () => {
		const thin = { ...program, cardio: [] };
		expect(cardioFor(thin, "2026-08-11")).toEqual({
			minutes: null,
			prescription: null,
			optional: false,
		});
	});
});

describe("rehabStageFor", () => {
	it("follows the calendar into each block", () => {
		expect(rehabStageFor(program, "2026-08-10")?.stage).toBe("Sem 1–2"); // semana 1
		expect(rehabStageFor(program, "2026-08-24")?.stage).toBe("Sem 3–4"); // semana 3
		expect(rehabStageFor(program, "2026-09-07")?.stage).toBe("Sem 5–6"); // semana 5
	});

	it("holds at the last block instead of running out", () => {
		// The protocol ends at six weeks; the ankle does not.
		expect(rehabStageFor(program, "2026-11-01")?.stage).toBe("Sem 5–6");
	});

	it("returns every exercise of the current block", () => {
		expect(
			rehabStageFor(program, "2026-08-10")?.exercises.map((e) => e.name),
		).toEqual(["Knee-to-wall", "Eversión con banda"]);
	});

	it("is null when there is no rehab programme at all", () => {
		expect(
			rehabStageFor({ ...program, ankleRehab: [] }, "2026-08-11"),
		).toBeNull();
	});
});

describe("rehabAsExercise", () => {
	it("shapes a rehab entry for the same logger everything else uses", () => {
		const exercise = rehabAsExercise(program.ankleRehab[0], 1);
		expect(exercise).toMatchObject({
			id: "knee_to_wall",
			name: "Knee-to-wall",
			order: 1,
			isAnkle: true,
			// Rehab is never taken near failure, so RIR is not the axis.
			rir: null,
		});
		expect(exercise.setsByPhase[1]).toBe(2);
	});
});
