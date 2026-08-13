/**
 * Which rows point at which other rows, declared once.
 *
 * A knowledge cut is a set of ids, and it is only a frontier if it is closed:
 * a revocation whose target is outside the set is not a boundary, it is a
 * contradiction, and it would resolve differently depending on how you read it.
 * Checking that requires knowing every way one row can name another.
 *
 * That knowledge lives here and nowhere else. The closure check and the
 * structural test that guards it both read `SEMANTIC_REFERENCES` — because the
 * failure mode of a hand-maintained list is that someone adds a fourth kind of
 * reference and only updates one of the two places, and then the cut validates
 * against a rule that no longer describes the data.
 */

import type { PhaseEvent, PlanAdjustment } from "./schema";

/** The two append-only logs a cut can bound. */
export type LogName = "adjustments" | "phaseEvents";

/**
 * Every way a row names another row of the same log.
 *
 * `kind` is the discriminant of the union variant; `field` is the property that
 * carries the target's id. Adding a variant that points at something means
 * adding a line here, and the structural test fails until it is added.
 */
export const SEMANTIC_REFERENCES = [
	{ log: "adjustments", kind: "revoke", field: "revokesId" },
	{ log: "phaseEvents", kind: "correction", field: "supersedesId" },
	{ log: "phaseEvents", kind: "revocation", field: "revokesId" },
] as const;

export type SemanticReference = {
	/** The row doing the pointing. */
	fromId: string;
	/** The id it names. */
	toId: string;
	log: LogName;
	/** For the message: `revoke.revokesId`. */
	via: string;
};

function referencesOf(
	row: { id: string; kind: string } & Record<string, unknown>,
	log: LogName,
): SemanticReference[] {
	return SEMANTIC_REFERENCES.filter(
		(reference) => reference.log === log && reference.kind === row.kind,
	).flatMap((reference) => {
		const toId = row[reference.field];
		if (typeof toId !== "string" || toId.length === 0) return [];
		return [
			{
				fromId: row.id,
				toId,
				log,
				via: `${reference.kind}.${reference.field}`,
			},
		];
	});
}

export function adjustmentReferences(
	adjustment: PlanAdjustment,
): SemanticReference[] {
	return referencesOf(
		adjustment as unknown as { id: string; kind: string },
		"adjustments",
	);
}

export function phaseEventReferences(event: PhaseEvent): SemanticReference[] {
	return referencesOf(
		event as unknown as { id: string; kind: string },
		"phaseEvents",
	);
}

/** Every reference the two logs carry, from the rows given. */
export function allReferences(input: {
	adjustments: readonly PlanAdjustment[];
	phaseEvents: readonly PhaseEvent[];
}): SemanticReference[] {
	return [
		...input.adjustments.flatMap(adjustmentReferences),
		...input.phaseEvents.flatMap(phaseEventReferences),
	];
}

/**
 * References of the given rows that point outside the given id sets.
 *
 * The one question the closure check asks. Returned rather than thrown so the
 * caller can name every dangling reference at once instead of the first.
 */
export function danglingReferences(input: {
	adjustments: readonly PlanAdjustment[];
	phaseEvents: readonly PhaseEvent[];
	knownAdjustmentIds: ReadonlySet<string>;
	knownPhaseEventIds: ReadonlySet<string>;
}): SemanticReference[] {
	const known: Record<LogName, ReadonlySet<string>> = {
		adjustments: input.knownAdjustmentIds,
		phaseEvents: input.knownPhaseEventIds,
	};

	return allReferences(input).filter(
		(reference) => !known[reference.log].has(reference.toId),
	);
}
