/**
 * Every shape the app knows about, defined once with Zod and inferred into
 * TypeScript. Content files are validated on load, so a bad import fails loudly
 * at startup instead of producing wrong training targets in the gym.
 */

import { z } from "zod";

// ------------------------------------------------------------------ primitives

/** Calendar day as `YYYY-MM-DD`. Stored as text so it never drifts by timezone. */
export const IsoDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const PhaseId = z.union([
	z.literal(1),
	z.literal(2),
	z.literal(3),
	z.literal(4),
]);
export type PhaseId = z.infer<typeof PhaseId>;

/** A fixed count, an inclusive range ("2–3 series"), or not programmed at all. */
export const SetCount = z.union([
	z.number().int().positive(),
	z.tuple([z.number().int().positive(), z.number().int().positive()]),
	z.null(),
]);
export type SetCount = z.infer<typeof SetCount>;

export const Range = z.object({ min: z.number(), max: z.number() });
export type Range = z.infer<typeof Range>;

/**
 * What a set is measured in. The spreadsheet mixes reps, per-side reps, held
 * seconds and cardio minutes in one column, so the unit travels with the target.
 */
export const Target = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("reps"), min: z.number(), max: z.number() }),
	z.object({
		kind: z.literal("repsPerSide"),
		min: z.number(),
		max: z.number(),
	}),
	z.object({ kind: z.literal("seconds"), seconds: z.number() }),
	z.object({ kind: z.literal("secondsPerSide"), seconds: z.number() }),
	z.object({ kind: z.literal("minutes"), min: z.number(), max: z.number() }),
	z.object({ kind: z.literal("minutesByPhase"), byPhase: z.array(Range) }),
	z.object({ kind: z.literal("freeform"), text: z.string() }),
]);
export type Target = z.infer<typeof Target>;

export const Load = z.object({
	startKg: z.number().nullable(),
	perSide: z.boolean(),
	relativeToBase: z.boolean(),
	bodyweight: z.boolean(),
	needsCalibration: z.boolean(),
	incrementKg: z.number().nullable(),
	raw: z.string(),
});
export type Load = z.infer<typeof Load>;

// --------------------------------------------------------------------- program

export const Exercise = z.object({
	/** Canonical id — shared across sessions so history follows the movement. */
	id: z.string().min(1),
	/** Display name as written for this particular session. */
	name: z.string().min(1),
	order: z.number().int().positive(),
	setsByPhase: z.object({ 1: SetCount, 2: SetCount, 3: SetCount, 4: SetCount }),
	target: Target,
	load: Load,
	progression: z.string(),
	goal: z.string(),
	/** Loads or challenges the ankle: prompts for pain, gated by safety rules. */
	isAnkle: z.boolean(),
});
export type Exercise = z.infer<typeof Exercise>;

export const Weekday = z.enum([
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
]);
export type Weekday = z.infer<typeof Weekday>;

export const SessionTemplate = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	weekday: Weekday,
	exercises: z.array(Exercise).min(1),
});
export type SessionTemplate = z.infer<typeof SessionTemplate>;

export const Phase = z.object({
	id: PhaseId,
	name: z.string(),
	startDate: IsoDate,
	/** Null on the final phase: it runs until the thesis defence. */
	endDate: IsoDate.nullable(),
	goal: z.string(),
	mainSets: SetCount,
	accessorySets: SetCount,
	targetRir: Range,
	weeklyCardioMinutes: Range,
	coreFrequency: z.string(),
	ankleStage: z.string(),
	advanceCriteria: z.string(),
});
export type Phase = z.infer<typeof Phase>;

export const WeekDayPlan = z.object({
	weekday: Weekday,
	block: z.string(),
	focus: z.string(),
	hasStrength: z.boolean(),
	cardio: z.string().nullable(),
	hasCore: z.boolean(),
	hasAnkle: z.boolean(),
	intensity: z.string(),
	notes: z.string(),
});
export type WeekDayPlan = z.infer<typeof WeekDayPlan>;

export const Program = z.object({
	meta: z.object({
		title: z.string(),
		startDate: IsoDate,
		checkpointDate: IsoDate,
		startWeightKg: z.number().nullable(),
		generatedFrom: z.string().optional(),
	}),
	phases: z.array(Phase).min(1),
	weekStructure: z.array(WeekDayPlan),
	sessions: z.array(SessionTemplate).min(1),
	progressionRules: z.array(z.object({ rule: z.string(), detail: z.string() })),
});
export type Program = z.infer<typeof Program>;

// -------------------------------------------------------------- ankle protocol

export const AnkleProtocol = z.object({
	baselineDate: IsoDate.nullable(),
	baseline: z.array(
		z.object({
			metric: z.string(),
			result: z.string(),
			interpretation: z.string(),
			initialGoal: z.string(),
			notes: z.string(),
		}),
	),
	protocol: z.array(
		z.object({
			stage: z.string(),
			weeks: z.string(),
			exercise: z.string(),
			sets: SetCount,
			target: Target,
			frequency: z.string(),
			progression: z.string(),
			stopSignal: z.string(),
			goal: z.string(),
			notes: z.string(),
		}),
	),
	safetyNotes: z.array(z.string()),
});
export type AnkleProtocol = z.infer<typeof AnkleProtocol>;

export const Sources = z.object({
	references: z.array(
		z.object({
			source: z.string(),
			supports: z.string(),
			reference: z.string(),
			url: z.string(),
		}),
	),
	notes: z.array(z.string()),
	programCriteria: z.array(z.string()),
});
export type Sources = z.infer<typeof Sources>;

// ----------------------------------------------------------------- log records

export const LoadUnit = z.enum(["kg", "bodyweight", "seconds", "minutes"]);
export type LoadUnit = z.infer<typeof LoadUnit>;

export const SessionRecord = z.object({
	id: z.string(),
	date: IsoDate,
	/** Matches SessionTemplate.id. */
	templateId: z.string(),
	phase: PhaseId,
	completed: z.boolean(),
	notes: z.string().nullable(),
});
export type SessionRecord = z.infer<typeof SessionRecord>;

export const SetRecord = z.object({
	id: z.string(),
	sessionId: z.string(),
	exerciseId: z.string(),
	setNumber: z.number().int().positive(),
	/**
	 * Warm-up and calibration sets are recorded but excluded from progression:
	 * "las series ligeras de aproximación no cuentan como series de trabajo".
	 */
	isWarmup: z.boolean(),
	load: z.number().nullable(),
	unit: LoadUnit,
	reps: z.number().nullable(),
	/** Reps in reserve. Null when not judged (warm-ups, timed holds). */
	rir: z.number().nullable(),
	anklePain: z.number().min(0).max(10).nullable(),
	note: z.string().nullable(),
});
export type SetRecord = z.infer<typeof SetRecord>;

export const AnkleCheck = z.object({
	id: z.string(),
	date: IsoDate,
	pain: z.number().min(0).max(10),
	kneeToWallInjured: z.number().nullable(),
	kneeToWallHealthy: z.number().nullable(),
	calfRaisesInjured: z.number().nullable(),
	bestBalance: z.number().nullable(),
	avgBalance: z.number().nullable(),
	/** The ankle "gives way" — an instability episode. */
	givesWay: z.boolean(),
	swelling: z.boolean(),
	notes: z.string().nullable(),
});
export type AnkleCheck = z.infer<typeof AnkleCheck>;
