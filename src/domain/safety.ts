/**
 * Ankle warning signs, and the rule that they outrank progression.
 *
 * Straight from the spreadsheet's own rules:
 *
 *   "Modificar o parar si aparece dolor relevante, hinchazón o inestabilidad."
 *   "Dolor relevante, hinchazón, bloqueo o episodios de que 'se va' → detener
 *    progresión y valorar fisioterapia."
 *
 * This module returns codes, not sentences, so the wording lives in the UI and
 * the rule itself stays testable.
 */

/** Pain at or above this is "dolor relevante". The stated goal is ≤ 2/10. */
export const RELEVANT_PAIN = 3;

export type SafetySignal = "pain" | "swelling" | "givesWay";

export type SafetyInput = {
	/** Worst ankle pain recorded, 0–10. */
	pain?: number | null;
	swelling?: boolean | null;
	/** An instability episode — the ankle "se va". */
	givesWay?: boolean | null;
};

export type SafetyVerdict = {
	/** True when load must not be increased. */
	blocked: boolean;
	signals: SafetySignal[];
};

export function evaluateSafety(input: SafetyInput): SafetyVerdict {
	const signals: SafetySignal[] = [];

	if (typeof input.pain === "number" && input.pain >= RELEVANT_PAIN)
		signals.push("pain");
	if (input.swelling === true) signals.push("swelling");
	if (input.givesWay === true) signals.push("givesWay");

	return { blocked: signals.length > 0, signals };
}

/** Worst pain across a set of readings, ignoring the ones never recorded. */
export function worstPain(
	readings: ReadonlyArray<number | null | undefined>,
): number | null {
	const recorded = readings.filter(
		(value): value is number => typeof value === "number",
	);
	return recorded.length === 0 ? null : Math.max(...recorded);
}
