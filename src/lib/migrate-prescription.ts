/**
 * The E3 migration: the plan stops being a value in the YAML and becomes a
 * baseline plus a log of decisions.
 *
 * **Nothing here runs on startup.** It is not wired into `db/provider.tsx`, and
 * that is the protection: a guard can be bypassed by wiring it up carelessly,
 * whereas a function nobody calls cannot run by opening localhost. `guardMigration`
 * below is the second lock, for when it does get wired.
 *
 * Seven steps, and the third carries the conceptual weight: what the plan varied
 * by phase becomes an adjustment with `origin: "program"` — which is what stops
 * the app *believing* a phase is N sets, and makes it know that the starting plan
 * said so, and since when.
 */

import type { Collections } from "@/db/collections";
import { stamp } from "@/db/synced";
import type {
	PlanAdjustment,
	PrescriptionBaseline,
	Program,
	SessionRecord,
	SetCount,
} from "@/domain/schema";

export type PrescriptionMigrationReport = {
	baselineSeeded: number;
	phaseAdjustments: number;
	overrideAdjustments: number;
	/** Overrides whose effective date had to be assumed. Named, never hidden. */
	assumedDates: string[];
	sessionsMarkedLegacy: number;
	/** Ids of the slots this run created. Empty on a second run, by design. */
	entryIds: string[];
};

/**
 * The database this migration is allowed to touch during development.
 *
 * Opening the app on the E3 branch must not be able to migrate a real log. The
 * primary protection is that nothing calls this; this is the belt underneath.
 */
export type MigrationGuard = {
	/** The name of the database being migrated. */
	databaseName: string;
	/** Whether the caller has explicitly opted in. */
	confirmed: boolean;
};

export class MigrationRefused extends Error {}

/**
 * Refuses unless the target is a test database or the caller said so out loud.
 *
 * The real log lives in `operacion-tesis`. Anything else is a harness or a test
 * fixture, and those are free to migrate.
 */
export function guardMigration(guard: MigrationGuard): void {
	const isRealLog = guard.databaseName === "operacion-tesis";
	if (isRealLog && !guard.confirmed) {
		throw new MigrationRefused(
			"La migración de E3 no corre contra la base real sin confirmación explícita. " +
				"Usa una base de prueba, o pasa confirmed: true a sabiendas.",
		);
	}
}

// ------------------------------------------------------------------ slot ids

/** Seeded slots are readable and frozen; runtime ones are opaque UUIDs. */
export function seededEntryId(templateId: string, index: number): string {
	return `slot_${templateId}_${String(index + 1).padStart(2, "0")}`;
}

// -------------------------------------------------------------------- steps

/**
 * Step 1–2: one baseline row per slot, from the composed content of E1.
 *
 * Ids are deterministic so re-seeding reconciles instead of duplicating.
 */
export function buildBaseline(
	program: Program,
	seededAt: number,
): PrescriptionBaseline[] {
	return program.sessions.flatMap((template) =>
		template.exercises.map((exercise, index) => ({
			id: seededEntryId(template.id, index),
			templateId: template.id,
			exerciseId: exercise.id,
			order: exercise.order,
			// The starting state is the lowest-order phase's prescription; what other
			// phases do differently becomes an adjustment in step 3.
			sets: exercise.setsByPhase[lowestSlot(program)],
			target: exercise.target,
			load: exercise.load,
			rir: exercise.rir,
			restSeconds: exercise.restSeconds,
			trainingRole: "strength" as const,
			goal: exercise.goal,
			progression: exercise.progression,
			cues: exercise.technique ? [exercise.technique] : [],
			allowedSubstitutions: exercise.substitution
				? [{ kind: "note" as const, text: exercise.substitution }]
				: [],
			seededFrom: program.meta.generatedFrom ?? "content",
			seededAt,
		})),
	);
}

/** Which `setsByPhase` column the first phase reads. */
function lowestSlot(program: Program): 1 | 2 | 3 | 4 {
	return columnFor(
		program,
		[...program.phases].sort((a, b) => a.order - b.order)[0],
	);
}

/**
 * Which column of `setsByPhase` a phase read before E3.
 *
 * This is what the retired E2 bridge used to do for the whole app, kept here and
 * only here: the migration is the last reader of that column, and it has to
 * reproduce the old mapping exactly or the numbers move. A phase from E2 states no
 * `legacyId` and says instead which phase it inherits from, so the walk is part
 * of the mapping, not an extra.
 */
function columnFor(
	program: Program,
	phase: Program["phases"][number],
): 1 | 2 | 3 | 4 {
	const seen = new Set<string>();
	let cursor: Program["phases"][number] | undefined = phase;

	while (cursor) {
		if (cursor.legacyId !== null) return cursor.legacyId as 1 | 2 | 3 | 4;
		if (seen.has(cursor.id)) break;
		seen.add(cursor.id);
		cursor = cursor.inheritsFrom
			? program.phases.find((entry) => entry.id === cursor?.inheritsFrom)
			: undefined;
	}

	// A phase that says neither had no prescription before E3 either. It starts
	// from the baseline, which is the honest answer rather than a guess.
	return 1;
}

/**
 * Step 3: what the plan varied by phase becomes an adjustment it authored.
 *
 * `effectiveOn` is the **start of the program**, not the phase's planned start.
 * These were in the plan from day one; what decides when they take effect is
 * `onlyInPhase`, and only that. Using the planned start would work by accident
 * when you enter a phase late and fail when you enter it early — which would tie
 * the plan back to the calendar, the very thing E2 went to remove.
 */
export function buildPhaseAdjustments(
	program: Program,
	baseline: readonly PrescriptionBaseline[],
	createdAt: number,
): PlanAdjustment[] {
	const adjustments: PlanAdjustment[] = [];
	const base = lowestSlot(program);
	const start = program.meta.startDate;

	for (const template of program.sessions) {
		template.exercises.forEach((exercise, index) => {
			const entryId = seededEntryId(template.id, index);
			if (!baseline.some((row) => row.id === entryId)) return;

			for (const phase of program.phases) {
				// Every phase gets its own adjustment, including one that inherits:
				// after E3 nothing walks `inheritsFrom` for prescription, so what the
				// walk used to give has to be written down while it still can be.
				const slot = columnFor(program, phase);
				if (slot === base) continue;

				const sets = exercise.setsByPhase[slot];
				if (sameSets(sets, exercise.setsByPhase[base])) continue;

				adjustments.push({
					kind: "set_field",
					id: `adj_phase_${entryId}_${phase.id}`,
					entryId,
					change: { field: "sets", value: sets },
					effectiveOn: start,
					onlyInPhase: phase.id,
					origin: "program",
					reason:
						"Variación de series que el programa traía escrita para esta fase.",
					evidenceIds: [],
					provenance: {
						kind: "migrated",
						from: "setsByPhase",
						assumedEffectiveOn: false,
					},
					createdAt,
				});
			}
		});
	}

	return adjustments;
}

function sameSets(a: SetCount, b: SetCount): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Step 4: every `ExerciseOverride` becomes an adjustment you authored.
 *
 * With a usable timestamp, that is the effective date — known history. Without
 * one, the effective date is **the migration**, not the start of the program:
 * claiming it existed in August would fabricate history that looks exactly like
 * the real kind. Dating it here keeps its effect from now on, which is what the
 * override actually does, without inventing what came before.
 */
/** An `ExerciseOverride` as the migration needs to read it. */
export type MigratableOverride = {
	id: string;
	exerciseId: string;
	setsOverride?: number | null;
	/** Added by `syncable`. Absent on rows written before sync existed. */
	updatedAt?: number;
};

export function buildOverrideAdjustments(
	overrides: ReadonlyArray<MigratableOverride>,
	baseline: readonly PrescriptionBaseline[],
	migratedOn: string,
	migratedAt: number,
): { adjustments: PlanAdjustment[]; assumedDates: string[] } {
	const adjustments: PlanAdjustment[] = [];
	const assumedDates: string[] = [];

	for (const override of overrides) {
		const slots = baseline.filter(
			(row) => row.exerciseId === override.exerciseId,
		);
		if (slots.length === 0) continue;

		const dated =
			typeof override.updatedAt === "number" && override.updatedAt > 0;
		const effectiveOn = dated
			? new Date(override.updatedAt as number).toISOString().slice(0, 10)
			: migratedOn;
		if (!dated) assumedDates.push(override.id);

		for (const slot of slots) {
			if (override.setsOverride == null) continue;
			adjustments.push({
				kind: "set_field",
				id: `adj_override_${override.id}_${slot.id}_sets`,
				entryId: slot.id,
				change: { field: "sets", value: override.setsOverride },
				effectiveOn,
				onlyInPhase: null,
				origin: "manual",
				reason: "Ajuste que ya tenías puesto antes de E3.",
				evidenceIds: [],
				provenance: {
					kind: "migrated",
					from: "exerciseOverride",
					assumedEffectiveOn: !dated,
				},
				createdAt: migratedAt,
			});
		}
	}

	return { adjustments, assumedDates };
}

/**
 * Step 6: every existing session is marked `legacy`.
 *
 * The contract travels on the row, not in a list one device captured, because a
 * pre-E3 session can arrive by sync *after* the receiver migrated — and a list
 * would call it corruption.
 */
export function markLegacy(
	sessions: readonly SessionRecord[],
): SessionRecord[] {
	// `?? null`, not `=== null`. A session restored from a pre-E3 backup does not
	// carry this key at all — the field did not exist when the file was written —
	// so a strict comparison against `null` skips exactly the rows the migration
	// exists for. Absent and null are the same statement here: nobody has said.
	return sessions.filter(
		(session) => (session.prescriptionContract ?? null) === null,
	);
}

// ------------------------------------------------------------------- the run

/**
 * The whole migration, against whichever collections it is handed.
 *
 * Idempotent: everything it writes has a deterministic id, so a second run
 * reconciles. Written through `raw` so a reconstruction does not look like a
 * fresh edit and get pushed as one.
 */
export function migratePrescription(
	collections: Collections,
	program: Program,
	options: {
		guard: MigrationGuard;
		migratedOn: string;
		migratedAt: number;
	},
): PrescriptionMigrationReport {
	guardMigration(options.guard);

	const report: PrescriptionMigrationReport = {
		baselineSeeded: 0,
		phaseAdjustments: 0,
		overrideAdjustments: 0,
		assumedDates: [],
		sessionsMarkedLegacy: 0,
		entryIds: [],
	};

	const baseline = buildBaseline(program, options.migratedAt);

	for (const row of baseline) {
		if (collections.raw.prescriptionBaseline.has(row.id)) continue;
		collections.raw.prescriptionBaseline.insert({ ...stamp(), ...row });
		report.baselineSeeded++;
		report.entryIds.push(row.id);
	}

	for (const adjustment of buildPhaseAdjustments(
		program,
		baseline,
		options.migratedAt,
	)) {
		if (collections.raw.planAdjustments.has(adjustment.id)) continue;
		collections.raw.planAdjustments.insert({ ...stamp(), ...adjustment });
		report.phaseAdjustments++;
	}

	const overrides = collections.raw.overrides.toArray as unknown as Array<{
		id: string;
		exerciseId: string;
		setsOverride?: number | null;
		updatedAt?: number;
	}>;
	const fromOverrides = buildOverrideAdjustments(
		overrides,
		baseline,
		options.migratedOn,
		options.migratedAt,
	);
	report.assumedDates = fromOverrides.assumedDates;

	for (const adjustment of fromOverrides.adjustments) {
		if (collections.raw.planAdjustments.has(adjustment.id)) continue;
		collections.raw.planAdjustments.insert({ ...stamp(), ...adjustment });
		report.overrideAdjustments++;
	}

	for (const session of markLegacy(
		collections.raw.sessions.toArray as unknown as SessionRecord[],
	)) {
		collections.raw.sessions.update(session.id, (draft) => {
			(draft as { prescriptionContract: string }).prescriptionContract =
				"legacy";
		});
		report.sessionsMarkedLegacy++;
	}

	return report;
}
