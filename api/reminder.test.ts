import { describe, expect, it } from "vitest";
import { composeReminder } from "./reminder.ts";

const SCHEDULE = {
	monday: "Full Body A",
	tuesday: "Cardio + tobillo",
	wednesday: "Full Body B",
	thursday: "Cardio + tobillo",
	friday: "Full Body C",
	saturday: "Cardio suave",
	sunday: null,
};

const row = (timeZone = "America/Guayaquil") => ({
	schedule: SCHEDULE,
	start_date: "2026-08-10",
	time_zone: timeZone,
});

describe("the daily reminder", () => {
	it("names the block programmed for today", () => {
		// 13:00 UTC on a Monday — the hour the cron is scheduled for.
		const reminder = composeReminder(row(), new Date("2026-08-10T13:00:00Z"));
		expect(reminder?.title).toBe("Hoy toca Full Body A");
		expect(reminder?.body).toBe("Semana 1 de Operación Tesis.");
	});

	it("says nothing on a rest day", () => {
		expect(
			composeReminder(row(), new Date("2026-08-16T13:00:00Z")),
		).toBeNull();
	});

	it("counts the week from the program's start", () => {
		const reminder = composeReminder(row(), new Date("2026-08-24T13:00:00Z"));
		expect(reminder?.body).toBe("Semana 3 de Operación Tesis.");
	});

	/*
	 * The bug this guards: UTC has already rolled over to Tuesday while Guayaquil
	 * is still on Monday evening, so a weekday read in UTC announces tomorrow.
	 */
	it("reads the weekday in the device's zone, not the server's", () => {
		const lateMonday = new Date("2026-08-11T02:00:00Z"); // 21:00 Monday, UTC-5
		expect(composeReminder(row(), lateMonday)?.title).toBe(
			"Hoy toca Full Body A",
		);
		expect(composeReminder(row("UTC"), lateMonday)?.title).toBe(
			"Hoy toca Cardio + tobillo",
		);
	});

	it("falls back to UTC on a time zone it does not recognise", () => {
		expect(
			composeReminder(row("Marte/Olympus"), new Date("2026-08-10T13:00:00Z"))
				?.title,
		).toBe("Hoy toca Full Body A");
	});

	it("gives no week number before the program starts", () => {
		const reminder = composeReminder(
			{ ...row(), start_date: "2026-09-01" },
			new Date("2026-08-10T13:00:00Z"),
		);
		expect(reminder?.body).toBe("Operación Tesis.");
	});
});
