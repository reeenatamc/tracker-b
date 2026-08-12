/**
 * What a session's plan is built from — one answer, for both users of it.
 *
 * There are two kinds of day and they get their prescription from different
 * places: a strength day from the migrated baseline, an ankle day from the rehab
 * protocol indexed by week. That difference has to live in exactly one function,
 * because the two callers are `freeze` (a session starting now) and `reconstruct`
 * (a session from before E3), and the moment they disagree the app is saying two
 * different things about the same day.
 *
 * It did disagree. The executor knew to build rehab rows on the spot; recovery
 * did not, and handed the strength baseline to an ankle session — which resolved
 * to nothing, and then reported `complete`, meaning "reconstructed everything we
 * knew was prescribed" about a day whose prescription it had not looked for.
 *
 * So the split is here, and `gap` is the other half of the fix: when a plan
 * genuinely cannot be produced, this says why in words, and the caller turns that
 * into `partial` with the reason attached. Silence is not an option — an empty
 * answer and a confident one must never be the same answer.
 */

import { rehabAsEntry, rehabStageFor } from "./cardio-day";
import type { PrescriptionBaseline, Program } from "./schema";

type IsoDate = string;

export type SessionPlanSource = {
	/** The baseline rows this session's prescription folds over. */
	rows: PrescriptionBaseline[];
	/** Why there are none, in words, when there are none. */
	gap: string | null;
};

/**
 * The baseline a session resolves against, whichever kind of day it is.
 *
 * Strength days read the seeded baseline. Ankle days are built from the protocol
 * for that date's week — the same rows `rehabAsEntry` produces for a live
 * session, with the same `rehab_*` ids, so a slot is the same slot whether it is
 * being frozen today or reconstructed from August.
 */
export function sessionBaseline(input: {
	templateId: string;
	date: IsoDate;
	program: Program;
	seeded: readonly PrescriptionBaseline[];
}): SessionPlanSource {
	const { templateId, date, program, seeded } = input;

	const strength = program.sessions.find(
		(template) => template.id === templateId,
	);
	if (strength) {
		const rows = seeded.filter((row) => row.templateId === templateId);
		return rows.length > 0
			? { rows, gap: null }
			: {
					rows: [],
					gap: `la base sembrada no tiene huecos para ${templateId}`,
				};
	}

	if (templateId === ANKLE_TEMPLATE) {
		const stage = rehabStageFor(program, date);
		if (!stage || stage.exercises.length === 0) {
			return {
				rows: [],
				gap: `el protocolo de tobillo no cubre ${date}`,
			};
		}
		return {
			rows: stage.exercises.map((entry, index) =>
				rehabAsEntry(entry, templateId, index + 1),
			),
			gap: null,
		};
	}

	return { rows: [], gap: `la plantilla ${templateId} no está en el programa` };
}

/** The synthetic template an ankle day runs under. Not a row in the content. */
export const ANKLE_TEMPLATE = "cardio_ankle";
