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
	z.object({ kind: z.literal("rounds"), text: z.string() }),
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
	/** Muscle or movement pattern, as the spreadsheet classifies it. */
	muscle: z.string().default(""),
	/** Reps in reserve for this exercise. Null on warm-ups, which state RPE. */
	rir: Range.nullable().default(null),
	/** Rest between sets, in seconds. The timer starts from the low end. */
	restSeconds: Range.nullable().default(null),
	/** What to do instead when the machine is taken. */
	substitution: z.string().default(""),
	/** The one cue that matters for this movement. */
	technique: z.string().default(""),
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
	/** Working sets per exercise for this phase — v3 states one figure, not two. */
	workingSets: SetCount.default(2),
	targetRir: Range,
	weeklyCardioMinutes: Range,
	coreWeeklySets: z.string().default(""),
	ankleStage: z.string(),
	/** What moves forward this phase, and what deliberately does not. */
	progresses: z.string().default(""),
	avoid: z.string().default(""),
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
	intensity: z.string().default(""),
	duration: z.string().default(""),
	notes: z.string().default(""),
});
export type WeekDayPlan = z.infer<typeof WeekDayPlan>;

export const CardioPrescription = z.object({
	phase: PhaseId,
	tuesday: Range.nullable(),
	thursday: Range.nullable(),
	saturday: Range.nullable(),
	weeklyTotal: Range.nullable(),
	modality: z.string(),
	intensity: z.string(),
	progression: z.string(),
	avoid: z.string(),
	reduceWhen: z.string(),
});
export type CardioPrescription = z.infer<typeof CardioPrescription>;

/**
 * Ankle rehabilitation, staged by week rather than folded into the strength
 * days. Mixing it in is what made it disappear whenever a session was
 * rearranged.
 */
export const AnkleExercise = z.object({
	id: z.string(),
	name: z.string(),
	stage: z.string(),
	weeks: Range.nullable(),
	sets: SetCount,
	target: Target,
	frequency: z.string(),
	progression: z.string(),
	goal: z.string(),
	baseline: z.string(),
	painAllowed: z.string(),
	substitution: z.string(),
	advanceCriteria: z.string(),
	technique: z.string(),
	isAnkle: z.literal(true),
});
export type AnkleExercise = z.infer<typeof AnkleExercise>;

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
	/** What the program is for, straight from the Dashboard sheet. */
	objectives: z
		.array(
			z.object({
				objective: z.string(),
				target: z.string(),
				measuredBy: z.string(),
				frequency: z.string(),
				priority: z.string(),
			}),
		)
		.default([]),
	/** The rules the program runs by — RIR, volume, ankle, review. */
	keyRules: z
		.array(z.object({ rule: z.string(), detail: z.string() }))
		.default([]),
	cardio: z.array(CardioPrescription).default([]),
	ankleRehab: z.array(AnkleExercise).default([]),
	progressionRules: z.array(
		z.object({
			rule: z.string(),
			detail: z.string(),
			example: z.string().default(""),
		}),
	),
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
	protocol: z.array(AnkleExercise),
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
	/**
	 * When the session actually began and ended, in epoch milliseconds. Explicit
	 * rather than inferred from the first and last set: the warm-up before the
	 * first logged set and the stretching after the last one are part of how long
	 * you were there, and inferring would quietly undercount both.
	 */
	startedAt: z.number().nullable().default(null),
	endedAt: z.number().nullable().default(null),
	/** Programmed today but skipped — machine taken, feeling off, whatever. */
	skippedExerciseIds: z.array(z.string()).default([]),
	/** Custom exercises pulled into this session. */
	extraExerciseIds: z.array(z.string()).default([]),
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

// ------------------------------------------------- personalisation & tracking

/**
 * Your changes to the program, keyed by canonical exercise id.
 *
 * The YAML in `content/` stays the baseline so re-importing the spreadsheet
 * never wipes your edits; these are merged over it at read time. Every field is
 * optional — an override only states what you changed.
 */
export const ExerciseOverride = z.object({
	id: z.string(),
	exerciseId: z.string(),
	startKg: z.number().nullable().optional(),
	/** The machine's real smallest jump, which the spreadsheet never stated. */
	incrementKg: z.number().nullable().optional(),
	repMin: z.number().nullable().optional(),
	repMax: z.number().nullable().optional(),
	setsOverride: z.number().nullable().optional(),
	note: z.string().nullable().optional(),
});
export type ExerciseOverride = z.infer<typeof ExerciseOverride>;

/** An exercise you added yourself, not present in the imported program. */
export const CustomExercise = z.object({
	id: z.string(),
	name: z.string().min(1),
	target: Target,
	load: Load,
	sets: z.number().int().positive(),
	isAnkle: z.boolean(),
	progression: z.string(),
	goal: z.string(),
});
export type CustomExercise = z.infer<typeof CustomExercise>;

/** Weekly measurements — the Progreso sheet, which the app never had. */
export const ProgressCheck = z.object({
	id: z.string(),
	date: IsoDate,
	weightKg: z.number().nullable(),
	waistCm: z.number().nullable(),
	hipCm: z.number().nullable(),
	thighCm: z.number().nullable(),
	strengthSessions: z.number().nullable(),
	cardioMinutes: z.number().nullable(),
	rehabSessions: z.number().nullable(),
	sleepHours: z.number().nullable(),
	energy: z.number().nullable(),
	/** 0–1, how well nutrition went. */
	nutritionAdherence: z.number().nullable(),
	notes: z.string().nullable(),
});
export type ProgressCheck = z.infer<typeof ProgressCheck>;

/** A reference that motivates you, or one of your own progress photos. */
export const InspoItem = z.object({
	id: z.string(),
	kind: z.enum(["reference", "progress"]),
	date: IsoDate,
	/** Key of an image held in OPFS; null for a link-only reference. */
	photoId: z.string().nullable(),
	url: z.string().nullable(),
	note: z.string().nullable(),
});
export type InspoItem = z.infer<typeof InspoItem>;
