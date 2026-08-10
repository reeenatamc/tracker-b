/**
 * Seeds the log with the baseline session imported from the spreadsheet.
 *
 * Without it the first real session has no history, so "la vez pasada hiciste…"
 * and every progression suggestion would start blank — which is exactly the
 * part that makes this better than the spreadsheet on day one.
 *
 * Runs once: if the sessions collection already holds anything, it does nothing.
 */

import seedData from "@content/first-session.json";
import { z } from "zod";
import type { Collections } from "@/db/collections";
import { IsoDate, LoadUnit, PhaseId } from "@/domain/schema";

/**
 * The importer's own output shape, which is close to but not the same as the
 * runtime records: it has no ids, and RIR is free text ("1–2") because that is
 * how it was written down.
 */
const SeedFile = z.object({
	date: IsoDate,
	type: z.string(),
	phase: PhaseId,
	completed: z.boolean(),
	sets: z.array(
		z.object({
			exerciseId: z.string(),
			exerciseName: z.string(),
			setNumber: z.number().int().positive(),
			load: z.number().nullable(),
			unit: LoadUnit,
			loadRaw: z.string().optional(),
			reps: z.number().nullable(),
			rir: z.union([z.string(), z.number(), z.null()]),
			anklePain: z.number().nullable(),
			note: z.string().nullable(),
		}),
	),
});

/**
 * "1–2" recorded by hand becomes 1: the lower bound is the conservative read,
 * and progression should never be triggered by an optimistic rounding.
 */
function parseRir(value: string | number | null): number | null {
	if (value === null) return null;
	if (typeof value === "number") return value;
	const numbers = value.match(/\d+/g);
	return numbers ? Number(numbers[0]) : null;
}

/**
 * Rows written by the seed carry deterministic ids, so re-importing the
 * spreadsheet reconciles them instead of duplicating or going stale. Anything
 * you log yourself gets a random id and is never touched here.
 */
const SEED_PREFIX = "seed-";

export function syncSeed(collections: Collections): void {
	const seed = SeedFile.safeParse(seedData);
	if (!seed.success || seed.data.sets.length === 0) return;

	const sessionId = `${SEED_PREFIX}${seed.data.date}`;

	const rows = seed.data.sets.map((set, index) => ({
		id: `${sessionId}-${index}`,
		sessionId,
		exerciseId: set.exerciseId,
		setNumber: set.setNumber,
		isWarmup: false,
		load: set.load,
		unit: set.unit,
		reps: set.reps,
		rir: parseRir(set.rir),
		anklePain: set.anklePain,
		note: set.note,
	}));

	// Already in sync — the common case on every launch after the first.
	const existing = collections.sets.toArray.filter((set) =>
		set.id.startsWith(SEED_PREFIX),
	);
	if (existing.length === rows.length && existing.every(matches(rows))) return;

	for (const stale of existing) collections.sets.delete(stale.id);
	for (const row of rows) collections.sets.insert(row);

	if (!collections.sessions.has(sessionId)) {
		collections.sessions.insert({
			id: sessionId,
			date: seed.data.date,
			templateId: seed.data.type,
			phase: seed.data.phase,
			completed: seed.data.completed,
			notes: "Sesión base importada del Excel.",
			skippedExerciseIds: [],
			extraExerciseIds: [],
		});
	}
}

function matches(rows: ReadonlyArray<{ id: string; exerciseId: string }>) {
	const byId = new Map(rows.map((row) => [row.id, row.exerciseId]));
	return (set: { id: string; exerciseId: string }) =>
		byId.get(set.id) === set.exerciseId;
}
