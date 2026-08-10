/**
 * Weekly progress — the spreadsheet's Progreso sheet.
 *
 * The consistency score is its formula, kept verbatim so the numbers stay
 * comparable with what you already recorded:
 *
 *   ROUND(( MIN(fuerza/3,1)*0.4 + MIN(cardio/90,1)*0.2
 *         + MIN(rehab/3,1)*0.2  + MIN(adherencia/0.8,1)*0.2 ) * 100, 0)
 *
 * Adherence is what the plan asks for, not perfection: the targets are the
 * spreadsheet's own weekly goals, and every term is capped at its target so a
 * huge cardio week cannot paper over three missed lifts.
 */

import type { ProgressCheck } from "./schema";

export const WEEKLY_TARGETS = {
	strengthSessions: 3,
	cardioMinutes: 90,
	rehabSessions: 3,
	nutritionAdherence: 0.8,
} as const;

const WEIGHTS = {
	strengthSessions: 0.4,
	cardioMinutes: 0.2,
	rehabSessions: 0.2,
	nutritionAdherence: 0.2,
} as const;

/**
 * 0–100, or null when nothing was recorded. A missing field counts as zero for
 * its term — the score measures the week that happened, not the week you filled
 * in — but a completely empty check has no score at all.
 */
export function consistencyScore(check: ProgressCheck): number | null {
	const parts = (
		Object.keys(WEEKLY_TARGETS) as Array<keyof typeof WEEKLY_TARGETS>
	).map((key) => ({ key, value: check[key] }));
	if (parts.every((part) => part.value == null)) return null;

	const total = parts.reduce((sum, { key, value }) => {
		const ratio = Math.min((value ?? 0) / WEEKLY_TARGETS[key], 1);
		return sum + ratio * WEIGHTS[key];
	}, 0);

	return Math.round(total * 100);
}

/** Change against the first recorded check — the spreadsheet's Δ columns. */
export function deltaFromBaseline(
	checks: readonly ProgressCheck[],
	field: "weightKg" | "waistCm" | "hipCm" | "thighCm",
): number | null {
	const recorded = ordered(checks).filter((check) => check[field] != null);
	if (recorded.length < 2) return null;
	const first = recorded[0][field];
	const last = recorded[recorded.length - 1][field];
	if (first == null || last == null) return null;
	return round(last - first);
}

/** A field's values over time, oldest first, gaps dropped. */
export function series(
	checks: readonly ProgressCheck[],
	field: "weightKg" | "waistCm" | "hipCm" | "thighCm",
): Array<{ date: string; value: number }> {
	return ordered(checks)
		.filter((check) => check[field] != null)
		.map((check) => ({ date: check.date, value: check[field] as number }));
}

/** Consistency over time, for the trend strip. */
export function scoreSeries(
	checks: readonly ProgressCheck[],
): Array<{ date: string; value: number }> {
	return ordered(checks)
		.map((check) => ({ date: check.date, value: consistencyScore(check) }))
		.filter(
			(point): point is { date: string; value: number } => point.value !== null,
		);
}

function ordered(checks: readonly ProgressCheck[]): ProgressCheck[] {
	return [...checks].sort((a, b) => a.date.localeCompare(b.date));
}

function round(value: number): number {
	return Math.round(value * 10) / 10;
}
