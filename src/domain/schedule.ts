/**
 * What today is supposed to be: which session, or which kind of rest.
 */

import type { Program, SessionTemplate, WeekDayPlan, Weekday } from "./schema";

const WEEKDAYS: readonly Weekday[] = [
	"sunday",
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
];

/**
 * Weekday of a calendar date. Anchored at noon UTC so a daylight-saving shift
 * can never push the date onto the neighbouring day.
 */
export function weekdayOf(date: string): Weekday {
	return WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

/** The programmed session for a date, or null on days with no session table. */
export function sessionForDate(
	program: Program,
	date: string,
): SessionTemplate | null {
	const weekday = weekdayOf(date);
	return (
		program.sessions.find((session) => session.weekday === weekday) ?? null
	);
}

export function sessionById(program: Program, id: string): SessionTemplate {
	const session = program.sessions.find((candidate) => candidate.id === id);
	if (!session) throw new Error(`Unknown session template: ${id}`);
	return session;
}

/**
 * The week-structure row for a date. Saturday and Sunday have a plan (active
 * recovery, rest) but no exercise table, so this is what the UI shows there.
 */
export function dayPlanForDate(
	program: Program,
	date: string,
): WeekDayPlan | null {
	const weekday = weekdayOf(date);
	return program.weekStructure.find((day) => day.weekday === weekday) ?? null;
}

/** Monday of the week containing `date`, as `YYYY-MM-DD`. */
export function startOfWeek(date: string): string {
	const parsed = new Date(`${date}T12:00:00Z`);
	const dayOffset = (parsed.getUTCDay() + 6) % 7; // Monday = 0
	parsed.setUTCDate(parsed.getUTCDate() - dayOffset);
	return parsed.toISOString().slice(0, 10);
}

const WEEKDAY_LABELS: Record<Weekday, string> = {
	monday: "lunes",
	tuesday: "martes",
	wednesday: "miércoles",
	thursday: "jueves",
	friday: "viernes",
	saturday: "sábado",
	sunday: "domingo",
};

/**
 * The next day that actually has a session, so the end of one points at the
 * next. Looks a week ahead and gives up rather than looping forever.
 */
export function nextSessionWeekday(program: Program, from: string): string {
	const start = new Date(`${from}T12:00:00Z`);
	for (let offset = 1; offset <= 7; offset++) {
		const next = new Date(start);
		next.setUTCDate(next.getUTCDate() + offset);
		const iso = next.toISOString().slice(0, 10);
		if (sessionForDate(program, iso)) return WEEKDAY_LABELS[weekdayOf(iso)];
	}
	return "próximo día de entrenamiento";
}
