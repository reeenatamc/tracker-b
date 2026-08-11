import { describe, expect, it } from "vitest";
import { makeExercise, PROGRAM } from "./__fixtures__/program";
import {
	applyOverride,
	resolveSessionExercises,
	resolveSets,
	skippedExercises,
} from "./personalise";
import type { CustomExercise, ExerciseOverride, SessionRecord } from "./schema";

const template = PROGRAM.sessions[0];

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
		...overrides,
	};
}

function makeOverride(
	overrides: Partial<ExerciseOverride> = {},
): ExerciseOverride {
	return { id: "o1", exerciseId: "jalon-al-pecho", ...overrides };
}

describe("applyOverride", () => {
	it("leaves the exercise alone when nothing was overridden", () => {
		const exercise = makeExercise();
		expect(applyOverride(exercise, undefined)).toBe(exercise);
	});

	it("sets the machine's real increment, which the spreadsheet never stated", () => {
		const result = applyOverride(
			makeExercise(),
			makeOverride({ incrementKg: 5 }),
		);
		expect(result.load.incrementKg).toBe(5);
		expect(result.load.startKg).toBe(20); // untouched
	});

	it("narrows the rep range", () => {
		const result = applyOverride(
			makeExercise(),
			makeOverride({ repMin: 8, repMax: 10 }),
		);
		expect(result.target).toMatchObject({ kind: "reps", min: 8, max: 10 });
	});

	it("keeps the other end of the range when only one is given", () => {
		const result = applyOverride(makeExercise(), makeOverride({ repMax: 15 }));
		expect(result.target).toMatchObject({ min: 10, max: 15 });
	});

	it("clears the calibrate flag once you set a real starting load", () => {
		const needsCalibration = makeExercise({
			load: { ...makeExercise().load, startKg: null, needsCalibration: true },
		});
		const result = applyOverride(
			needsCalibration,
			makeOverride({ startKg: 35 }),
		);
		expect(result.load).toMatchObject({ startKg: 35, needsCalibration: false });
	});

	it("does not touch a rep range on a timed exercise", () => {
		const balance = PROGRAM.sessions[0].exercises[3];
		const result = applyOverride(
			balance,
			makeOverride({ repMin: 5, repMax: 9 }),
		);
		expect(result.target).toEqual(balance.target);
	});
});

describe("resolveSessionExercises", () => {
	const base = {
		program: PROGRAM,
		template,
		phase: PROGRAM.phases[0],
		overrides: [],
		customExercises: [],
	};

	it("returns what the phase programs when nothing is personalised", () => {
		const list = resolveSessionExercises({ ...base, session: null });
		expect(list.map((e) => e.id)).toEqual([
			"prensa",
			"abduccion",
			"balance-unilateral",
		]);
	});

	it("drops the exercises you skipped today", () => {
		const list = resolveSessionExercises({
			...base,
			session: makeSession({ skippedExerciseIds: ["prensa"] }),
		});
		expect(list.map((e) => e.id)).not.toContain("prensa");
	});

	it("adds the custom exercises you pulled in, after the programmed ones", () => {
		const custom: CustomExercise = {
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
		const list = resolveSessionExercises({
			...base,
			customExercises: [custom],
			session: makeSession({ extraExerciseIds: [custom.id] }),
		});
		expect(list.at(-1)?.id).toBe("custom-hip-thrust");
	});

	it("applies overrides to custom exercises too", () => {
		const custom: CustomExercise = {
			id: "custom-x",
			name: "X",
			target: { kind: "reps", min: 8, max: 12 },
			load: {
				startKg: 10,
				perSide: false,
				relativeToBase: false,
				bodyweight: false,
				needsCalibration: false,
				incrementKg: null,
				raw: "",
			},
			sets: 2,
			isAnkle: false,
			progression: "",
			goal: "",
		};
		const list = resolveSessionExercises({
			...base,
			customExercises: [custom],
			overrides: [makeOverride({ exerciseId: "custom-x", incrementKg: 2.5 })],
			session: makeSession({ extraExerciseIds: ["custom-x"] }),
		});
		expect(list.at(-1)?.load.incrementKg).toBe(2.5);
	});

	it("still omits exercises not yet introduced in this phase", () => {
		const list = resolveSessionExercises({ ...base, session: null });
		expect(list.map((e) => e.id)).not.toContain("step-down-bajo");
	});
});

describe("resolveSets", () => {
	const prensa = template.exercises[0];

	it("uses the phase prescription by default", () => {
		expect(resolveSets(PROGRAM, prensa, PROGRAM.phases[0], undefined)).toEqual({
			min: 2,
			max: 2,
		});
		expect(resolveSets(PROGRAM, prensa, PROGRAM.phases[3], undefined)).toEqual({
			min: 2,
			max: 3,
		});
	});

	it("lets you pin a set count yourself", () => {
		expect(
			resolveSets(
				PROGRAM,
				prensa,
				PROGRAM.phases[0],
				makeOverride({ setsOverride: 4 }),
			),
		).toEqual({
			min: 4,
			max: 4,
		});
	});

	it("is null for an exercise the phase does not program", () => {
		expect(
			resolveSets(PROGRAM, template.exercises[2], PROGRAM.phases[0], undefined),
		).toBeNull();
	});
});

describe("skippedExercises", () => {
	it("lists what you skipped, so it can be put back", () => {
		const session = makeSession({
			skippedExerciseIds: ["prensa", "step-down-bajo"],
		});
		const list = skippedExercises(
			PROGRAM,
			template,
			PROGRAM.phases[0],
			session,
		);
		// step-down is not programmed in phase 1, so it is not offered back.
		expect(list.map((e) => e.id)).toEqual(["prensa"]);
	});
});
