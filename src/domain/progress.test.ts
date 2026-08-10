import { describe, expect, it } from "vitest";
import {
	consistencyScore,
	deltaFromBaseline,
	scoreSeries,
	series,
} from "./progress";
import type { ProgressCheck } from "./schema";

function makeCheck(overrides: Partial<ProgressCheck> = {}): ProgressCheck {
	return {
		id: "c1",
		date: "2026-08-16",
		weightKg: null,
		waistCm: null,
		hipCm: null,
		thighCm: null,
		strengthSessions: null,
		cardioMinutes: null,
		rehabSessions: null,
		sleepHours: null,
		energy: null,
		nutritionAdherence: null,
		notes: null,
		...overrides,
	};
}

describe("consistencyScore", () => {
	it("is 100 when the week hits every target", () => {
		const score = consistencyScore(
			makeCheck({
				strengthSessions: 3,
				cardioMinutes: 90,
				rehabSessions: 3,
				nutritionAdherence: 0.8,
			}),
		);
		expect(score).toBe(100);
	});

	it("weights strength heaviest, as the spreadsheet does", () => {
		const onlyStrength = consistencyScore(makeCheck({ strengthSessions: 3 }));
		const onlyCardio = consistencyScore(makeCheck({ cardioMinutes: 90 }));
		expect(onlyStrength).toBe(40);
		expect(onlyCardio).toBe(20);
	});

	it("caps each term so one big number cannot cover a missed one", () => {
		const capped = consistencyScore(
			makeCheck({ strengthSessions: 3, cardioMinutes: 600 }),
		);
		expect(capped).toBe(60); // 40 + 20, not 40 + 133
	});

	it("counts a missing field as zero for its term", () => {
		expect(
			consistencyScore(makeCheck({ strengthSessions: 3, cardioMinutes: 45 })),
		).toBe(50);
	});

	it("has no score at all when nothing was recorded", () => {
		expect(consistencyScore(makeCheck())).toBeNull();
		expect(consistencyScore(makeCheck({ weightKg: 60 }))).toBeNull();
	});

	it("scores a partial week proportionally", () => {
		// 2/3 strength, 45/90 cardio, 3/3 rehab, 0.4/0.8 nutrition
		const score = consistencyScore(
			makeCheck({
				strengthSessions: 2,
				cardioMinutes: 45,
				rehabSessions: 3,
				nutritionAdherence: 0.4,
			}),
		);
		expect(score).toBe(Math.round((2 / 3) * 40 + 0.5 * 20 + 20 + 0.5 * 20));
	});
});

describe("deltaFromBaseline", () => {
	const checks = [
		makeCheck({ id: "a", date: "2026-08-09", weightKg: 60, waistCm: 70 }),
		makeCheck({ id: "b", date: "2026-08-16", weightKg: 59.4 }),
		makeCheck({ id: "c", date: "2026-08-23", weightKg: 59.1, waistCm: 68.5 }),
	];

	it("compares the latest reading against the first", () => {
		expect(deltaFromBaseline(checks, "weightKg")).toBe(-0.9);
		expect(deltaFromBaseline(checks, "waistCm")).toBe(-1.5);
	});

	it("needs two readings before it means anything", () => {
		expect(deltaFromBaseline([checks[0]], "weightKg")).toBeNull();
		expect(deltaFromBaseline(checks, "hipCm")).toBeNull();
	});

	it("does not care what order the checks arrive in", () => {
		const shuffled = [checks[2], checks[0], checks[1]];
		expect(deltaFromBaseline(shuffled, "weightKg")).toBe(-0.9);
	});
});

describe("series", () => {
	it("returns points oldest first and drops the gaps", () => {
		const points = series(
			[
				makeCheck({ id: "b", date: "2026-08-16", weightKg: null }),
				makeCheck({ id: "c", date: "2026-08-23", weightKg: 59.1 }),
				makeCheck({ id: "a", date: "2026-08-09", weightKg: 60 }),
			],
			"weightKg",
		);
		expect(points).toEqual([
			{ date: "2026-08-09", value: 60 },
			{ date: "2026-08-23", value: 59.1 },
		]);
	});
});

describe("scoreSeries", () => {
	it("skips weeks that have no score", () => {
		const points = scoreSeries([
			makeCheck({ id: "a", date: "2026-08-09", strengthSessions: 3 }),
			makeCheck({ id: "b", date: "2026-08-16", weightKg: 59 }),
		]);
		expect(points).toEqual([{ date: "2026-08-09", value: 40 }]);
	});
});
