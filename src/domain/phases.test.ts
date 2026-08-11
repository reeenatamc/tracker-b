import { describe, expect, it } from "vitest";
import { PHASE_EVENTS } from "./__fixtures__/log";
import { PROGRAM } from "./__fixtures__/program";
import {
	exercisesForPhase,
	phaseForDate,
	resolveSetCount,
	targetRir,
	targetSets,
	weeksUntilCheckpoint,
} from "./phases";

describe("phaseForDate", () => {
	it.each([
		["2026-08-10", "adaptacion", "Adaptación"],
		["2026-08-23", "adaptacion", "Adaptación"],
		["2026-08-24", "progresion", "Construcción"],
		["2026-10-04", "progresion", "Construcción"],
		["2026-10-05", "recomposicion", "Recomposición"],
		["2026-11-15", "recomposicion", "Recomposición"],
		["2026-11-16", "definicion_tesis", "Operación Cuadritos"],
		["2026-12-20", "definicion_tesis", "Operación Cuadritos"],
	])("%s falls in phase %s", (date, id, name) => {
		const phase = phaseForDate(PROGRAM, PHASE_EVENTS, date);
		expect(phase.id).toBe(id);
		expect(phase.name).toBe(name);
	});

	it("reads the baseline session, two days before phase 1, as phase 1", () => {
		expect(phaseForDate(PROGRAM, PHASE_EVENTS, "2026-08-08").id).toBe(
			"adaptacion",
		);
	});

	it("keeps the last phase open past the checkpoint", () => {
		expect(phaseForDate(PROGRAM, PHASE_EVENTS, "2027-03-01").id).toBe(
			"definicion_tesis",
		);
	});
});

describe("targetSets", () => {
	const [prensa, abduccion, stepDown] = PROGRAM.sessions[0].exercises;

	it("gives a main lift 2 sets in phase 1 and 3 in phase 2", () => {
		expect(targetSets(PROGRAM, prensa, PROGRAM.phases[0])).toEqual({
			min: 2,
			max: 2,
		});
		expect(targetSets(PROGRAM, prensa, PROGRAM.phases[1])).toEqual({
			min: 3,
			max: 3,
		});
	});

	it("keeps an accessory at 2 sets in phase 2", () => {
		expect(targetSets(PROGRAM, abduccion, PROGRAM.phases[1])).toEqual({
			min: 2,
			max: 2,
		});
	});

	it('reads a "2–3" phase-4 prescription as a range', () => {
		expect(targetSets(PROGRAM, prensa, PROGRAM.phases[3])).toEqual({
			min: 2,
			max: 3,
		});
	});

	it("returns null for an exercise not yet introduced", () => {
		expect(targetSets(PROGRAM, stepDown, PROGRAM.phases[0])).toBeNull();
		expect(targetSets(PROGRAM, stepDown, PROGRAM.phases[1])).toEqual({
			min: 2,
			max: 2,
		});
	});
});

describe("resolveSetCount", () => {
	it("normalises fixed counts, ranges and absence", () => {
		expect(resolveSetCount(3)).toEqual({ min: 3, max: 3 });
		expect(resolveSetCount([2, 3])).toEqual({ min: 2, max: 3 });
		expect(resolveSetCount(null)).toBeNull();
	});
});

describe("targetRir", () => {
	it("tightens as the program advances", () => {
		expect(targetRir(PROGRAM.phases[0])).toEqual({ min: 2, max: 3 });
		expect(targetRir(PROGRAM.phases[1])).toEqual({ min: 2, max: 2 });
		expect(targetRir(PROGRAM.phases[2])).toEqual({ min: 1, max: 2 });
	});
});

describe("exercisesForPhase", () => {
	const exercises = PROGRAM.sessions[0].exercises;

	it("omits exercises not yet introduced and keeps program order", () => {
		const phase1 = exercisesForPhase(PROGRAM, exercises, PROGRAM.phases[0]);
		expect(phase1.map((exercise) => exercise.id)).toEqual([
			"prensa",
			"abduccion",
			"balance-unilateral",
		]);
	});

	it("includes step-down from phase 2", () => {
		const phase2 = exercisesForPhase(PROGRAM, exercises, PROGRAM.phases[1]);
		expect(phase2.map((exercise) => exercise.id)).toContain("step-down-bajo");
	});
});

describe("weeksUntilCheckpoint", () => {
	it("counts whole weeks to the defence checkpoint", () => {
		expect(weeksUntilCheckpoint(PROGRAM, "2026-12-13")).toBe(1);
		expect(weeksUntilCheckpoint(PROGRAM, "2026-08-10")).toBe(18);
	});

	it("never goes negative once the checkpoint has passed", () => {
		expect(weeksUntilCheckpoint(PROGRAM, "2027-01-15")).toBe(0);
	});
});
