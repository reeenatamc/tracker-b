import { describe, expect, it } from "vitest";
import { PROGRAM } from "./__fixtures__/program";
import {
	loadGains,
	personalRecords,
	sessionMinutes,
	volumeChange,
	weekStreak,
	sessionVolume,
	summarise,
	weekNumber,
} from "./achievements";
import type { SessionRecord, SetRecord } from "./schema";

function session(id: string, date: string): SessionRecord {
	return {
		id,
		date,
		templateId: "full_body_a",
		phase: 1,
		completed: true,
		notes: null,
		skippedExerciseIds: [],
		extraExerciseIds: [],
	};
}

function set(
	sessionId: string,
	exerciseId: string,
	overrides: Partial<SetRecord> = {},
): SetRecord {
	return {
		id: `${sessionId}-${exerciseId}-${overrides.setNumber ?? 1}`,
		sessionId,
		exerciseId,
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

describe("weekNumber", () => {
	it("counts the starting week as week 1", () => {
		expect(weekNumber("2026-08-08", "2026-08-08")).toBe(1);
		expect(weekNumber("2026-08-08", "2026-08-14")).toBe(1);
		expect(weekNumber("2026-08-08", "2026-08-15")).toBe(2);
	});

	it("never reports week zero for a date before the start", () => {
		expect(weekNumber("2026-08-08", "2026-08-01")).toBe(1);
	});
});

describe("loadGains", () => {
	it("reports an exercise that went up between two days", () => {
		const sessions = [session("s1", "2026-08-10"), session("s2", "2026-08-17")];
		const sets = [
			set("s1", "jalon-al-pecho", { load: 20 }),
			set("s2", "jalon-al-pecho", { load: 25 }),
		];

		expect(loadGains(sessions, sets)).toEqual([
			{
				exerciseId: "jalon-al-pecho",
				from: 20,
				to: 25,
				unit: "kg",
				perSide: false,
			},
		]);
	});

	it("ignores a single session's warm-up ramp, which is not progress", () => {
		const sessions = [session("s1", "2026-08-10")];
		const sets = [
			set("s1", "prensa", { load: 5, setNumber: 1 }),
			set("s1", "prensa", { load: 20, setNumber: 2 }),
		];

		expect(loadGains(sessions, sets)).toEqual([]);
	});

	it("does not count approach sets as the starting load", () => {
		const sessions = [session("s1", "2026-08-10"), session("s2", "2026-08-17")];
		const sets = [
			set("s1", "prensa", { load: 5, isWarmup: true, setNumber: 1 }),
			set("s1", "prensa", { load: 20, setNumber: 2 }),
			set("s2", "prensa", { load: 25 }),
		];

		expect(loadGains(sessions, sets)[0]).toMatchObject({ from: 20, to: 25 });
	});

	it("stays quiet when the load went down", () => {
		const sessions = [session("s1", "2026-08-10"), session("s2", "2026-08-17")];
		const sets = [
			set("s1", "prensa", { load: 30 }),
			set("s2", "prensa", { load: 20 }),
		];

		expect(loadGains(sessions, sets)).toEqual([]);
	});

	it("compares the best set of each day, so one bad set is not a regression", () => {
		const sessions = [session("s1", "2026-08-10"), session("s2", "2026-08-17")];
		const sets = [
			set("s1", "prensa", { load: 20, setNumber: 1 }),
			set("s2", "prensa", { load: 25, setNumber: 1 }),
			set("s2", "prensa", { load: 15, setNumber: 2 }),
		];

		expect(loadGains(sessions, sets)[0]).toMatchObject({ from: 20, to: 25 });
	});

	it("measures bodyweight work in reps, which is the only thing that can rise", () => {
		const sessions = [session("s1", "2026-08-10"), session("s2", "2026-08-17")];
		const sets = [
			set("s1", "calf-raise", { load: null, unit: "bodyweight", reps: 12 }),
			set("s2", "calf-raise", { load: null, unit: "bodyweight", reps: 15 }),
		];

		expect(loadGains(sessions, sets)).toEqual([
			{
				exerciseId: "calf-raise",
				from: 12,
				to: 15,
				unit: "reps",
				perSide: false,
			},
		]);
	});

	it("measures timed work in seconds", () => {
		const sessions = [session("s1", "2026-08-10"), session("s2", "2026-08-17")];
		const sets = [
			set("s1", "balance-unilateral", {
				load: null,
				unit: "seconds",
				reps: 20,
			}),
			set("s2", "balance-unilateral", {
				load: null,
				unit: "seconds",
				reps: 30,
			}),
		];

		expect(loadGains(sessions, sets)[0]).toMatchObject({
			from: 20,
			to: 30,
			unit: "seconds",
		});
	});

	it("ranks the biggest relative gain first", () => {
		const sessions = [session("s1", "2026-08-10"), session("s2", "2026-08-17")];
		const sets = [
			set("s1", "a", { load: 100 }),
			set("s2", "a", { load: 105 }), // +5%
			set("s1", "b", { load: 10 }),
			set("s2", "b", { load: 20 }), // +100%
		];

		expect(loadGains(sessions, sets).map((gain) => gain.exerciseId)).toEqual([
			"b",
			"a",
		]);
	});

	it("says nothing at all when there is nothing logged", () => {
		expect(loadGains([], [])).toEqual([]);
	});
});

describe("summarise", () => {
	const sessions = [
		session("s1", "2026-08-10"),
		session("s2", "2026-08-12"),
		session("s3", "2026-08-03"),
	];
	const sets = [
		set("s1", "prensa", { load: 20 }),
		set("s2", "prensa", { load: 25 }),
		set("s3", "prensa", { load: 15 }),
	];

	it("counts only this week's sessions for the weekly target", () => {
		// 2026-08-12 is a Wednesday; its week starts Monday 2026-08-10.
		const progress = summarise(PROGRAM, sessions, sets, "2026-08-12");
		expect(progress.sessionsThisWeek).toBe(2);
		expect(progress.sessionsTarget).toBe(3);
		expect(progress.totalSessions).toBe(3);
	});

	it("does not count a session with nothing logged in it", () => {
		const withEmpty = [...sessions, session("s4", "2026-08-11")];
		expect(
			summarise(PROGRAM, withEmpty, sets, "2026-08-12").totalSessions,
		).toBe(3);
	});

	it("reports where you are in the program", () => {
		const progress = summarise(PROGRAM, sessions, sets, "2026-08-12");
		expect(progress.week).toBe(1);
		expect(progress.phaseId).toBe(1);
		expect(progress.phaseName).toBe("Adaptación");
		expect(progress.weeksToCheckpoint).toBe(18);
		expect(progress.totalWeeks).toBe(19);
	});
});

describe("sessionVolume", () => {
	it("adds load times reps across the working sets", () => {
		const sets = [
			set("s1", "prensa", { load: 20, reps: 12, setNumber: 1 }),
			set("s1", "prensa", { load: 20, reps: 10, setNumber: 2 }),
		];
		expect(sessionVolume(sets, "s1")).toBe(440);
	});

	it("leaves out approach sets and anything without a load", () => {
		const sets = [
			set("s1", "prensa", { load: 20, reps: 12, setNumber: 1 }),
			set("s1", "prensa", { load: 10, reps: 10, isWarmup: true, setNumber: 2 }),
			set("s1", "balance", {
				load: null,
				unit: "seconds",
				reps: 30,
				setNumber: 3,
			}),
		];
		expect(sessionVolume(sets, "s1")).toBe(240);
	});
});

describe("personalRecords", () => {
	const sessions = [session("s1", "2026-08-10"), session("s2", "2026-08-17")];

	it("reports beating a previous best", () => {
		const sets = [
			set("s1", "prensa", { load: 20 }),
			set("s2", "prensa", { load: 25 }),
		];
		expect(personalRecords(sessions, sets, "s2")).toEqual([
			{ exerciseId: "prensa", value: 25, previous: 20, unit: "kg" },
		]);
	});

	it("does not call matching a previous best a record", () => {
		// Otherwise "record" comes to mean "showed up", and stops meaning anything.
		const sets = [
			set("s1", "prensa", { load: 20 }),
			set("s2", "prensa", { load: 20 }),
		];
		expect(personalRecords(sessions, sets, "s2")).toEqual([]);
	});

	it("has no record on the first time an exercise is ever logged", () => {
		expect(
			personalRecords(sessions, [set("s1", "prensa", { load: 20 })], "s1"),
		).toEqual([]);
	});

	it("ignores approach sets on both sides of the comparison", () => {
		const sets = [
			set("s1", "prensa", { load: 40, isWarmup: true, setNumber: 1 }),
			set("s1", "prensa", { load: 20, setNumber: 2 }),
			set("s2", "prensa", { load: 25 }),
		];
		expect(personalRecords(sessions, sets, "s2")[0]).toMatchObject({
			value: 25,
			previous: 20,
		});
	});

	it("compares only against earlier sessions, never later ones", () => {
		const sets = [
			set("s1", "prensa", { load: 20 }),
			set("s2", "prensa", { load: 25 }),
		];
		// Judging the first session must not see the second.
		expect(personalRecords(sessions, sets, "s1")).toEqual([]);
	});

	it("recognises a record in reps for bodyweight work", () => {
		const sets = [
			set("s1", "calf-raise", { load: null, unit: "bodyweight", reps: 12 }),
			set("s2", "calf-raise", { load: null, unit: "bodyweight", reps: 15 }),
		];
		expect(personalRecords(sessions, sets, "s2")[0]).toMatchObject({
			value: 15,
			previous: 12,
			unit: "reps",
		});
	});
});

describe("volumeChange", () => {
	it("compares against the last time the same session was done", () => {
		const sessions = [session("s1", "2026-08-10"), session("s2", "2026-08-17")];
		const sets = [
			set("s1", "prensa", { load: 20, reps: 10 }), // 200
			set("s2", "prensa", { load: 20, reps: 12 }), // 240
		];
		expect(volumeChange(sessions, sets, "s2")).toBe(20);
	});

	it("has nothing to say about the first session of its kind", () => {
		const sessions = [session("s1", "2026-08-10")];
		expect(volumeChange(sessions, [set("s1", "prensa")], "s1")).toBeNull();
	});
});

describe("weekStreak", () => {
	const week = (dates: string[]) =>
		dates.map((date, index) => session(`w${index}-${date}`, date));

	it("counts consecutive weeks that met the target", () => {
		const sessions = [
			...week(["2026-08-10", "2026-08-12", "2026-08-14"]),
			...week(["2026-08-03", "2026-08-05", "2026-08-07"]),
		];
		const sets = sessions.map((s) => set(s.id, "prensa"));
		expect(weekStreak(sessions, sets, "2026-08-14")).toBe(2);
	});

	it("stops at the first week that fell short", () => {
		const sessions = [
			...week(["2026-08-10", "2026-08-12", "2026-08-14"]),
			...week(["2026-08-03"]),
			...week(["2026-07-27", "2026-07-29", "2026-07-31"]),
		];
		const sets = sessions.map((s) => set(s.id, "prensa"));
		expect(weekStreak(sessions, sets, "2026-08-14")).toBe(1);
	});

	it("is zero when this week has not met the target yet", () => {
		const sessions = week(["2026-08-10"]);
		const sets = sessions.map((s) => set(s.id, "prensa"));
		expect(weekStreak(sessions, sets, "2026-08-10")).toBe(0);
	});
});

describe("sessionMinutes", () => {
	it("measures first set to last", () => {
		const sets = [
			{ ...set("s1", "a", { setNumber: 1 }), updatedAt: 1_000_000 },
			{
				...set("s1", "b", { setNumber: 2 }),
				updatedAt: 1_000_000 + 45 * 60_000,
			},
			// `updatedAt` is added by the syncable wrapper at write time, so it is
			// not part of the declared row type.
		] as unknown as SetRecord[];
		expect(sessionMinutes(sets, "s1")).toBe(45);
	});

	it("is null for sessions logged before writes were timestamped", () => {
		expect(sessionMinutes([set("s1", "a")], "s1")).toBeNull();
	});
});
