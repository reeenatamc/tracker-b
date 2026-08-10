import { describe, expect, it } from "vitest";
import {
	makeExercise,
	makeSet,
	makeSets,
	PROGRAM,
} from "./__fixtures__/program";
import { DEFAULT_INCREMENT_KG, decideProgression } from "./progression";
import { targetSets } from "./phases";

const PHASE_1_RIR = { min: 2, max: 3 };
const PHASE_3_RIR = { min: 1, max: 2 };

/** The pull-down example spelled out in the spreadsheet's own rules. */
describe("double progression — the spreadsheet example", () => {
	const exercise = makeExercise(); // Jalón al pecho, 10–12 reps, 20 kg
	const decide = (lastSets: ReturnType<typeof makeSets>) =>
		decideProgression({
			exercise,
			lastSets,
			targetRir: PHASE_1_RIR,
			targetSets: { min: 2, max: 2 },
		});

	it("holds when a set falls short of the top of the range (12/10)", () => {
		const decision = decide(
			makeSets(20, [
				[12, 2],
				[10, 2],
			]),
		);
		expect(decision).toEqual({
			kind: "hold",
			loadKg: 20,
			perSide: false,
			reason: "repsBelowTop",
		});
	});

	it("increases when every set owns the range at the target RIR (12/12 @ RIR 2)", () => {
		const decision = decide(
			makeSets(20, [
				[12, 2],
				[12, 2],
			]),
		);
		expect(decision).toEqual({
			kind: "increase",
			fromKg: 20,
			toKg: 20 + DEFAULT_INCREMENT_KG,
			incrementKg: DEFAULT_INCREMENT_KG,
			perSide: false,
		});
	});

	it("holds when the reps are there but too close to failure (12/12 @ RIR 0)", () => {
		const decision = decide(
			makeSets(20, [
				[12, 0],
				[12, 0],
			]),
		);
		expect(decision).toEqual({
			kind: "hold",
			loadKg: 20,
			perSide: false,
			reason: "rirTooLow",
		});
	});

	it("holds when a single set is at RIR 0, even if the others had reserve", () => {
		const decision = decide(
			makeSets(20, [
				[12, 2],
				[12, 0],
			]),
		);
		expect(decision).toMatchObject({ kind: "hold", reason: "rirTooLow" });
	});
});

/**
 * The 8-Aug pull-down, verbatim from the spreadsheet: 20 kg × 12, then 25 kg × 8,
 * RIR 0–1. Its own "Próximo objetivo" column reads "Trabajar 20 kg, 2×10–12",
 * so the expected answer is written down and not a matter of opinion.
 */
describe("a too-heavy exploratory set is not the working weight", () => {
	const exercise = makeExercise(); // 10–12 reps

	it("holds at 20 kg, not at the 25 kg that only made 8 reps", () => {
		const decision = decideProgression({
			exercise,
			lastSets: [
				makeSet({ id: "a", setNumber: 1, load: 20, reps: 12, rir: 1 }),
				makeSet({ id: "b", setNumber: 2, load: 25, reps: 8, rir: 0 }),
			],
			targetRir: PHASE_1_RIR,
			targetSets: { min: 2, max: 2 },
		});
		expect(decision).toEqual({
			kind: "hold",
			loadKg: 20,
			perSide: false,
			reason: "repsBelowTop",
		});
	});

	it("falls back to the lightest load when no set reached the range", () => {
		const decision = decideProgression({
			exercise,
			lastSets: [
				makeSet({ id: "a", setNumber: 1, load: 25, reps: 8, rir: 0 }),
				makeSet({ id: "b", setNumber: 2, load: 30, reps: 5, rir: 0 }),
			],
			targetRir: PHASE_1_RIR,
			targetSets: { min: 2, max: 2 },
		});
		expect(decision).toMatchObject({ kind: "hold", loadKg: 25 });
	});

	it("takes the heaviest qualifying load when several worked", () => {
		const decision = decideProgression({
			exercise,
			lastSets: [
				makeSet({ id: "a", setNumber: 1, load: 20, reps: 12, rir: 3 }),
				makeSet({ id: "b", setNumber: 2, load: 22.5, reps: 11, rir: 2 }),
			],
			targetRir: PHASE_1_RIR,
			targetSets: { min: 2, max: 2 },
		});
		expect(decision).toMatchObject({
			kind: "hold",
			loadKg: 22.5,
			reason: "repsBelowTop",
		});
	});
});

describe("what counts as a working set", () => {
	const exercise = makeExercise();

	it('ignores warm-up sets — "las series de aproximación no cuentan"', () => {
		const lastSets = [
			makeSet({
				id: "w",
				setNumber: 1,
				isWarmup: true,
				load: 10,
				reps: 8,
				rir: 5,
			}),
			...makeSets(20, [
				[12, 2],
				[12, 2],
			]),
		];
		const decision = decideProgression({
			exercise,
			lastSets,
			targetRir: PHASE_1_RIR,
			targetSets: { min: 2, max: 2 },
		});
		expect(decision).toMatchObject({ kind: "increase", fromKg: 20 });
	});

	it("holds when fewer working sets were logged than the phase programs", () => {
		const decision = decideProgression({
			exercise,
			lastSets: makeSets(20, [[12, 2]]),
			targetRir: { min: 2, max: 2 },
			targetSets: { min: 3, max: 3 }, // phase 2 asks for 3 on main lifts
		});
		expect(decision).toMatchObject({ kind: "hold", reason: "setsIncomplete" });
	});

	it("will not judge progression without a recorded RIR", () => {
		const decision = decideProgression({
			exercise,
			lastSets: makeSets(20, [
				[12, null],
				[12, null],
			]),
			targetRir: PHASE_1_RIR,
			targetSets: { min: 2, max: 2 },
		});
		expect(decision).toMatchObject({ kind: "hold", reason: "rirUnknown" });
	});
});

describe("the RIR threshold follows the phase", () => {
	const exercise = makeExercise();
	const lastSets = makeSets(20, [
		[12, 1],
		[12, 1],
	]);

	it("holds at RIR 1 in phase 1, which asks for RIR 2–3", () => {
		const decision = decideProgression({
			exercise,
			lastSets,
			targetRir: PHASE_1_RIR,
			targetSets: { min: 2, max: 2 },
		});
		expect(decision).toMatchObject({ kind: "hold", reason: "rirTooLow" });
	});

	it("increases at RIR 1 in phase 3, which trains closer to failure", () => {
		const decision = decideProgression({
			exercise,
			lastSets,
			targetRir: PHASE_3_RIR,
			targetSets: { min: 3, max: 3 },
		});
		expect(decision).toMatchObject({ kind: "hold", reason: "setsIncomplete" });

		const withThreeSets = decideProgression({
			exercise,
			lastSets: makeSets(20, [
				[12, 1],
				[12, 1],
				[12, 1],
			]),
			targetRir: PHASE_3_RIR,
			targetSets: { min: 3, max: 3 },
		});
		expect(withThreeSets).toMatchObject({ kind: "increase", fromKg: 20 });
	});
});

describe("first time doing an exercise", () => {
	it("starts at the programmed load", () => {
		const decision = decideProgression({
			exercise: makeExercise(),
			lastSets: [],
			targetRir: PHASE_1_RIR,
			targetSets: { min: 2, max: 2 },
		});
		expect(decision).toEqual({ kind: "start", loadKg: 20, perSide: false });
	});

	it('asks you to calibrate when the spreadsheet says "Calibrar"', () => {
		const exercise = makeExercise({
			load: {
				...makeExercise().load,
				startKg: null,
				needsCalibration: true,
				raw: "Calibrar",
			},
		});
		const decision = decideProgression({
			exercise,
			lastSets: [],
			targetRir: PHASE_1_RIR,
			targetSets: { min: 2, max: 2 },
		});
		expect(decision).toEqual({ kind: "calibrate" });
	});

	it("carries the per-side flag for plate-loaded machines", () => {
		const prensa = PROGRAM.sessions[0].exercises[0];
		const decision = decideProgression({
			exercise: prensa,
			lastSets: [],
			targetRir: PHASE_1_RIR,
			targetSets: targetSets(prensa, 1),
		});
		expect(decision).toEqual({ kind: "start", loadKg: 5, perSide: true });
	});
});

describe("exercises that are not progressed by load", () => {
	it("defers to the written rule for timed balance work", () => {
		const balance = PROGRAM.sessions[0].exercises[3];
		const decision = decideProgression({
			exercise: balance,
			lastSets: [],
			targetRir: PHASE_1_RIR,
			targetSets: targetSets(balance, 1),
		});
		expect(decision).toEqual({ kind: "qualitative" });
	});

	it("advances difficulty when bodyweight reps are owned", () => {
		const calfRaise = makeExercise({
			id: "calf-raise",
			name: "Calf raise",
			target: { kind: "reps", min: 12, max: 15 },
			isAnkle: true,
			load: {
				startKg: null,
				perSide: false,
				relativeToBase: false,
				bodyweight: true,
				needsCalibration: false,
				incrementKg: null,
				raw: "Peso corporal",
			},
		});
		const lastSets = makeSets(
			0,
			[
				[15, 3],
				[15, 3],
			],
			{ unit: "bodyweight", load: null },
		);
		const decision = decideProgression({
			exercise: calfRaise,
			lastSets,
			targetRir: PHASE_1_RIR,
			targetSets: { min: 2, max: 2 },
		});
		expect(decision).toEqual({ kind: "advanceDifficulty" });
	});
});

describe("an ankle warning sign outranks progression", () => {
	const prensa = PROGRAM.sessions[0].exercises[0];
	const earnedTheIncrease = makeSets(5, [
		[12, 2],
		[12, 2],
	]);

	it("blocks on relevant pain recorded during the sets", () => {
		const decision = decideProgression({
			exercise: prensa,
			lastSets: makeSets(
				5,
				[
					[12, 2],
					[12, 2],
				],
				{ anklePain: 4 },
			),
			targetRir: PHASE_1_RIR,
			targetSets: { min: 2, max: 2 },
		});
		expect(decision).toEqual({ kind: "blocked", signals: ["pain"] });
	});

	it("blocks on swelling reported in the weekly check, even with pain 0", () => {
		const decision = decideProgression({
			exercise: prensa,
			lastSets: earnedTheIncrease,
			targetRir: PHASE_1_RIR,
			targetSets: { min: 2, max: 2 },
			safety: { pain: 0, swelling: true },
		});
		expect(decision).toEqual({ kind: "blocked", signals: ["swelling"] });
	});

	it("blocks when the ankle gives way", () => {
		const decision = decideProgression({
			exercise: prensa,
			lastSets: earnedTheIncrease,
			targetRir: PHASE_1_RIR,
			targetSets: { min: 2, max: 2 },
			safety: { pain: 0, givesWay: true },
		});
		expect(decision).toEqual({ kind: "blocked", signals: ["givesWay"] });
	});

	it("does not block a non-ankle exercise on the same signals", () => {
		const decision = decideProgression({
			exercise: makeExercise(), // jalón al pecho
			lastSets: makeSets(20, [
				[12, 2],
				[12, 2],
			]),
			targetRir: PHASE_1_RIR,
			targetSets: { min: 2, max: 2 },
			safety: { pain: 6, swelling: true },
		});
		expect(decision).toMatchObject({ kind: "increase" });
	});

	it("still progresses the ankle when pain stays within the 0–2 goal", () => {
		const decision = decideProgression({
			exercise: prensa,
			lastSets: makeSets(
				5,
				[
					[12, 2],
					[12, 2],
				],
				{ anklePain: 2 },
			),
			targetRir: PHASE_1_RIR,
			targetSets: { min: 2, max: 2 },
		});
		expect(decision).toMatchObject({
			kind: "increase",
			fromKg: 5,
			perSide: true,
		});
	});
});

describe("per-exercise increment override", () => {
	it("uses the increment from content when one is set", () => {
		const exercise = makeExercise({
			load: { ...makeExercise().load, incrementKg: 5 },
		});
		const decision = decideProgression({
			exercise,
			lastSets: makeSets(20, [
				[12, 2],
				[12, 2],
			]),
			targetRir: PHASE_1_RIR,
			targetSets: { min: 2, max: 2 },
		});
		expect(decision).toMatchObject({
			kind: "increase",
			toKg: 25,
			incrementKg: 5,
		});
	});
});
