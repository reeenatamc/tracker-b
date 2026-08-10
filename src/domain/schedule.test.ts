import { describe, expect, it } from "vitest";
import { PROGRAM } from "./__fixtures__/program";
import {
	dayPlanForDate,
	sessionById,
	sessionForDate,
	startOfWeek,
	weekdayOf,
} from "./schedule";

describe("weekdayOf", () => {
	it("reads the weekday of a calendar date", () => {
		expect(weekdayOf("2026-08-10")).toBe("monday");
		expect(weekdayOf("2026-08-15")).toBe("saturday");
		expect(weekdayOf("2026-08-16")).toBe("sunday");
	});

	it("is stable across a daylight-saving boundary", () => {
		// Europe shifts on 2026-10-25; anchoring at noon UTC keeps the day intact.
		expect(weekdayOf("2026-10-25")).toBe("sunday");
		expect(weekdayOf("2026-10-26")).toBe("monday");
	});
});

describe("sessionForDate", () => {
	it("finds the session programmed for that weekday", () => {
		const session = sessionForDate(PROGRAM, "2026-08-10");
		expect(session?.id).toBe("full_body_a");
	});

	it("returns null on a day with no exercise table", () => {
		expect(sessionForDate(PROGRAM, "2026-08-16")).toBeNull();
	});
});

describe("dayPlanForDate", () => {
	it("still describes rest days", () => {
		const sunday = dayPlanForDate(PROGRAM, "2026-08-16");
		expect(sunday).toMatchObject({ block: "Descanso", hasStrength: false });
	});
});

describe("sessionById", () => {
	it("throws on an unknown template rather than returning undefined", () => {
		expect(() => sessionById(PROGRAM, "nope")).toThrow(
			/Unknown session template/,
		);
	});
});

describe("startOfWeek", () => {
	it("returns the Monday of that week", () => {
		expect(startOfWeek("2026-08-13")).toBe("2026-08-10");
		expect(startOfWeek("2026-08-10")).toBe("2026-08-10");
	});

	it("treats Sunday as the end of its week, not the start", () => {
		expect(startOfWeek("2026-08-16")).toBe("2026-08-10");
	});
});
