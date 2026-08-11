/**
 * Seeds the log with the baseline session imported from the spreadsheet.
 *
 * Without it the first real session has no history, so "la vez pasada hiciste…"
 * and every progression suggestion would start blank — which is exactly the
 * part that makes this better than the spreadsheet on day one.
 *
 * Runs on every launch and reconciles by id, so re-importing the spreadsheet
 * updates the rows it already wrote instead of making new ones. It runs after
 * the id and phase migrations — see `db/bootstrap.ts` — because comparing
 * against rows those have not reached yet makes every row look changed.
 */

import seedData from "@content/first-session.json";
import { z } from "zod";
import type { Collections } from "@/db/collections";
import { IsoDate, LoadUnit } from "@/domain/schema";
import { program } from "@/lib/content";

/**
 * The importer's own output shape, which is close to but not the same as the
 * runtime records: it has no ids, and RIR is free text ("1–2") because that is
 * how it was written down.
 */
const SeedFile = z.object({
	date: IsoDate,
	type: z.string(),
	/** The importer writes the spreadsheet's numeric phase; E2 names it below. */
	phase: z.union([z.number(), z.string()]),
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

/**
 * The seed file predates named phases, and it is regenerated from the
 * spreadsheet, which still counts them. Translating here rather than rewriting
 * the file keeps the importer's job unchanged — and a seed that silently failed
 * to parse would leave the first real session with no history to progress from,
 * which is most of what makes this better than the spreadsheet on day one.
 */
function phaseIdOf(value: number | string): string {
	if (typeof value === "string") return value;
	const phase = program.phases.find((entry) => entry.legacyId === value);
	return phase?.id ?? program.phases[0].id;
}

export type SeedReport = {
	inserted: number;
	updated: number;
	/** Rows that were tombstoned and have been brought back rather than remade. */
	revived: number;
	/** Rows from an older seed the spreadsheet no longer has. Retired last. */
	removed: number;
};

/**
 * Brings the stored baseline session in line with the spreadsheet's.
 *
 * Reconciled **by id**, never deleted and re-created. The old code did the
 * latter, and it had two ways of going wrong that both happened on a restored
 * backup: `delete` here is a tombstone, so the row still exists and the `insert`
 * that followed it threw `duplicate id` — and it threw *after* the deletes,
 * leaving fifteen sets tombstoned and none rewritten. A boot that fails is
 * annoying; a boot that fails having just erased history is not.
 *
 * Hence the order below. Everything that adds or repairs happens first, and the
 * only removal — rows from a seed that has since shrunk — happens last, once
 * nothing else can throw. A run that dies half-way leaves rows that the next
 * launch will reconcile. It can never leave fewer.
 */
export function syncSeed(
	collections: Collections,
	/** The imported spreadsheet. A parameter so tests never need her content. */
	source: unknown = seedData,
): SeedReport {
	const report: SeedReport = {
		inserted: 0,
		updated: 0,
		revived: 0,
		removed: 0,
	};

	const seed = SeedFile.safeParse(source);
	if (!seed.success || seed.data.sets.length === 0) return report;

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

	/*
	 * Reads include tombstones — that is what sync needs and what `useRecords`
	 * filters out for screens. Here it is exactly right: a tombstoned row is
	 * still occupying its id, and pretending otherwise is what broke.
	 */
	const stored = new Map(
		collections.sets.toArray.map((set) => [set.id, set as SeedRow]),
	);

	for (const row of rows) {
		const existing = stored.get(row.id);

		if (!existing) {
			collections.sets.insert(row);
			report.inserted++;
			continue;
		}

		const buried = existing.deletedAt != null;
		if (!buried && sameRow(existing, row)) continue;

		collections.sets.update(row.id, (draft) => {
			Object.assign(draft, row);
			// Reviving is an update like any other: the id never became free, so
			// there was never anything to re-create. `deletedAt` is added by
			// `syncable` at write time, so it is reached structurally.
			(draft as { deletedAt?: number | null }).deletedAt = null;
		});
		if (buried) report.revived++;
		else report.updated++;
	}

	syncSeedSession(collections, sessionId, seed.data);

	// Last, and only now: rows a previous, longer seed left behind. Nothing above
	// depends on this, so a failure before here has removed nothing.
	const wanted = new Set(rows.map((row) => row.id));
	for (const set of collections.sets.toArray) {
		if (!set.id.startsWith(SEED_PREFIX)) continue;
		if (wanted.has(set.id)) continue;
		if ((set as SeedRow).deletedAt != null) continue;
		collections.sets.delete(set.id);
		report.removed++;
	}

	return report;
}

type SeedRow = {
	id: string;
	sessionId: string;
	exerciseId: string;
	setNumber: number;
	isWarmup: boolean;
	load: number | null;
	unit: string;
	reps: number | null;
	rir: number | null;
	anklePain: number | null;
	note: string | null;
	deletedAt?: number | null;
};

/** The fields the seed owns. `updatedAt` and friends are not its business. */
function sameRow(stored: SeedRow, wanted: Omit<SeedRow, "deletedAt">): boolean {
	return (
		stored.sessionId === wanted.sessionId &&
		stored.exerciseId === wanted.exerciseId &&
		stored.setNumber === wanted.setNumber &&
		stored.isWarmup === wanted.isWarmup &&
		stored.load === wanted.load &&
		stored.unit === wanted.unit &&
		stored.reps === wanted.reps &&
		stored.rir === wanted.rir &&
		stored.anklePain === wanted.anklePain &&
		stored.note === wanted.note
	);
}

/**
 * The session row, by the same rule.
 *
 * Only revived or created, never overwritten: its notes and its phase can have
 * been corrected since, and the spreadsheet has no opinion about either.
 */
function syncSeedSession(
	collections: Collections,
	sessionId: string,
	data: {
		date: string;
		type: string;
		phase: number | string;
		completed: boolean;
	},
): void {
	const existing = collections.sessions.toArray.find(
		(session) => session.id === sessionId,
	) as { deletedAt?: number | null } | undefined;

	if (existing) {
		if (existing.deletedAt != null) {
			collections.sessions.update(sessionId, (draft) => {
				(draft as { deletedAt?: number | null }).deletedAt = null;
			});
		}
		return;
	}

	collections.sessions.insert({
		id: sessionId,
		date: data.date,
		templateId: data.type,
		phase: phaseIdOf(data.phase),
		completed: data.completed,
		notes: "Sesión base importada del Excel.",
		startedAt: null,
		endedAt: null,
		skippedExerciseIds: [],
		extraExerciseIds: [],
		// La sesión base viene del Excel: es anterior a E3 por definición.
		prescriptionContract: "legacy",
		snapshotId: null,
	});
}
