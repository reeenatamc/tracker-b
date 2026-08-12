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

/**
 * A phase id. Open, and canonical: once it appears on a session or an event it is
 * a key into the log, so it is never renamed, reused or deleted — the same rule
 * the exercise ids live by, for the same reason.
 *
 * The visible name is free to change. That is `Phase.name`.
 */
export const PhaseId = z
	.string()
	.regex(
		/^[a-z][a-z0-9_]*$/,
		"un id de fase se escribe en minúsculas, sin acentos y sin guiones",
	);
export type PhaseId = z.infer<typeof PhaseId>;

/** The numeric ids phases had before they were opened up. Migration only. */
export const LegacyPhaseId = z.union([
	z.literal(1),
	z.literal(2),
	z.literal(3),
	z.literal(4),
]);
export type LegacyPhaseId = z.infer<typeof LegacyPhaseId>;

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

/**
 * What to do with a phase's planned start when the phase before it runs long.
 *
 * `rolling` moves with the training — most phases. `anchored` does not, because
 * its date comes from outside: a trip, a deadline. If you run late, what gets
 * squeezed is whatever sits before an anchored phase, never the anchor.
 */
export const SchedulePolicy = z.enum(["rolling", "anchored"]);
export type SchedulePolicy = z.infer<typeof SchedulePolicy>;

/** Something that should hold to enter or leave a phase. Prose in E2; E6 judges it. */
export const Criterion = z.object({
	id: z.string().min(1),
	text: z.string(),
	metric: z.string().nullable().default(null),
	evidenceId: z.string().nullable().default(null),
});
export type Criterion = z.infer<typeof Criterion>;

export const Phase = z.object({
	id: PhaseId,
	name: z.string(),
	/** Intended order. Does NOT decide which phase you are in — events do. */
	order: z.number().int().positive(),
	/** A forecast, not a fact. May sit in the past without anything being wrong. */
	plannedStart: IsoDate.nullable(),
	plannedEnd: IsoDate.nullable(),
	schedulePolicy: SchedulePolicy.default("rolling"),
	entryCriteria: z.array(Criterion).default([]),
	exitCriteria: z.array(Criterion).default([]),
	/** The numeric id this phase carried before E2. Used once, by the migration. */
	legacyId: LegacyPhaseId.nullable().default(null),
	/**
	 * Where anything this phase does not state comes from: which `setsByPhase`
	 * column, which cardio prescription. It is what lets a new phase exist without
	 * a code change, and it retires in E3 when prescription stops being per-phase.
	 */
	inheritsFrom: PhaseId.nullable().default(null),
	/** No longer programmed, but still real: sessions stamped with it must resolve. */
	retired: z.boolean().default(false),
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

/**
 * The phase log: what actually happened, as opposed to what was planned.
 *
 * Three shapes, as a discriminated union rather than one object with optional
 * fields — so that a revocation cannot carry a destination. "I revoke X and also
 * move to phase C" is a sentence with no meaning, and a permissive type would let
 * somebody write it.
 *
 * Append-only, and not by convention: the collection itself refuses `update` and
 * `delete` (see `db/synced.ts`). The only ways to change an event's effect are a
 * `correction` or a `revocation`.
 */
export const PhaseTrigger = z.enum([
	"planned",
	"criteria-met",
	"review",
	"manual",
	"safety",
]);
export type PhaseTrigger = z.infer<typeof PhaseTrigger>;

const PhaseMove = {
	/** Null only on the first: the start of the program. */
	fromPhaseId: PhaseId.nullable(),
	toPhaseId: PhaseId,
	/** The day the new phase is in force from. Inclusive. */
	occurredOn: IsoDate,
	/** What the plan said. Null when nothing was planned. */
	plannedFor: IsoDate.nullable().default(null),
	trigger: PhaseTrigger,
	reason: z.string().default(""),
	reviewId: z.string().nullable().default(null),
};

export const PhaseEvent = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("transition"),
		id: z.string().min(1),
		...PhaseMove,
		createdAt: z.number(),
	}),
	/** That transition was recorded wrong; this one replaces it whole. */
	z.object({
		kind: z.literal("correction"),
		id: z.string().min(1),
		supersedesId: z.string().min(1),
		...PhaseMove,
		createdAt: z.number(),
	}),
	/** That event did not happen. Puts nothing in its place. */
	z.object({
		kind: z.literal("revocation"),
		id: z.string().min(1),
		revokesId: z.string().min(1),
		reason: z.string().default(""),
		createdAt: z.number(),
	}),
]);
export type PhaseEvent = z.infer<typeof PhaseEvent>;

/** The two kinds that carry a destination. Revocations do not. */
export type PhaseMoveEvent = Extract<
	PhaseEvent,
	{ kind: "transition" | "correction" }
>;

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

// ----------------------------------------------------------- exercise library

/**
 * The library: what a movement *is*, as opposed to what a session asks of it.
 *
 * Until now every exercise was defined inline inside each session, so the same
 * movement was written out three times and the three copies drifted — one
 * carried the technique cue, the others carried an empty string. Identity lives
 * here once; prescription lives in the template.
 */

export const MuscleId = z.enum([
	"quads",
	"hamstrings",
	"glute_max",
	"glute_med",
	"adductors",
	"calves",
	"tibialis",
	"peroneals",
	"chest",
	"lats",
	"mid_back",
	"lower_back",
	"front_delts",
	"side_delts",
	"rear_delts",
	"biceps",
	"triceps",
	"forearms",
	"abs",
	"obliques",
]);
export type MuscleId = z.infer<typeof MuscleId>;

/** What an exercise trains that is not a muscle. Never counted as sets. */
export const FunctionalTarget = z.enum([
	"ankle_stability",
	"ankle_control",
	"balance",
]);
export type FunctionalTarget = z.infer<typeof FunctionalTarget>;

export const MovementPattern = z.enum([
	// hip and knee
	"squat",
	"hinge",
	"lunge",
	"knee_flexion",
	"hip_extension",
	"hip_abduction",
	// torso
	"horizontal_push",
	"horizontal_pull",
	"vertical_push",
	"vertical_pull",
	"shoulder_abduction",
	// arm
	"elbow_flexion",
	"elbow_extension",
	// core
	"anti_extension",
	"anti_rotation",
	"trunk_flexion",
	// ankle
	"ankle_plantarflexion",
	"ankle_dorsiflexion",
	"ankle_eversion",
	// not classifiable by joint
	"balance",
	"mobility",
	"cardio",
]);
export type MovementPattern = z.infer<typeof MovementPattern>;

/**
 * Joints the movement loads or challenges enough that pain there is a reason to
 * modify it. Stated for every exercise, because a partial list would give the
 * future safety rules false negatives — an untyped exercise would never trip.
 */
export const JointId = z.enum([
	"ankle",
	"knee",
	"hip",
	"lumbar",
	"thoracic",
	"shoulder",
	"elbow",
	"wrist",
	"cervical",
]);
export type JointId = z.infer<typeof JointId>;

/** What kind of stimulus the movement gives. Intrinsic to it. */
export const StimulusType = z.enum([
	"resistance",
	"balance",
	"mobility",
	"cardio",
]);
export type StimulusType = z.infer<typeof StimulusType>;

/**
 * What a prescription uses the movement for. NOT a property of the exercise:
 * `calf_raise` sits in the rehab protocol today and could be plain strength work
 * tomorrow without changing its id.
 */
export const TrainingRole = z.enum(["strength", "rehab", "warmup", "cardio"]);
export type TrainingRole = z.infer<typeof TrainingRole>;

export const EquipmentKind = z.enum([
	"machine",
	"cable",
	"dumbbell",
	"barbell",
	"band",
	"bodyweight",
	"cardio_machine",
	"none",
]);
export type EquipmentKind = z.infer<typeof EquipmentKind>;

/** A name this movement has gone by, and where that name came from. */
export const ExerciseAlias = z.object({
	name: z.string().min(1),
	source: z
		.enum(["spreadsheet-v2", "spreadsheet-v3", "gym", "manual"])
		.optional(),
});
export type ExerciseAlias = z.infer<typeof ExerciseAlias>;

/**
 * A substitution. `note` keeps the spreadsheet's free text when it does not
 * correspond to any library movement — forcing it into a reference would be
 * inventing, and dropping it would lose what the spreadsheet did know.
 *
 * There is deliberately no field for sharing load history: a different id is a
 * different history, always. The "same movement, other name" case is what
 * aliases are for, and those share an id.
 */
export const SubstitutionRef = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("exercise"),
		exerciseId: z.string().min(1),
		equivalence: z.enum([
			"same_pattern",
			"same_muscle",
			"regression",
			"progression",
		]),
		reason: z.string().default(""),
	}),
	z.object({ kind: z.literal("note"), text: z.string().min(1) }),
]);
export type SubstitutionRef = z.infer<typeof SubstitutionRef>;

export const ExerciseDef = z.object({
	/** Canonical id. NEVER changes — it is the key the whole log hangs off. */
	id: z.string().min(1),
	/** Preferred name. Free to change: it is not identity. */
	name: z.string().min(1),
	aliases: z.array(ExerciseAlias).default([]),

	/** Only muscles. Never a group, and never a function. */
	primaryMuscles: z.array(MuscleId).default([]),
	secondaryMuscles: z.array(MuscleId).default([]),
	functionalTargets: z.array(FunctionalTarget).default([]),
	pattern: MovementPattern,
	stimulusType: StimulusType,

	equipmentKind: EquipmentKind,
	/** The muscle line as the spreadsheet wrote it, kept for display. */
	muscleLabel: z.string().default(""),

	/** General technique: true in any session. Prescription cues live elsewhere. */
	cues: z.array(z.string()).default([]),
	commonErrors: z.array(z.string()).default([]),

	/** Typical range of the movement. NOT the prescription. */
	typicalReps: Range.nullable().default(null),
	defaultRestSeconds: Range.nullable().default(null),

	/** Catalogue of known alternatives. Does not imply any are offered. */
	substitutions: z.array(SubstitutionRef).default([]),
	cautions: z.array(z.string()).default([]),

	jointLoads: z.array(JointId).default([]),

	media: z
		.array(z.object({ kind: z.enum(["image", "video"]), url: z.string() }))
		.default([]),

	/** Declared unused: kept in the library but not programmed anywhere. */
	unused: z.boolean().default(false),
});
export type ExerciseDef = z.infer<typeof ExerciseDef>;

export const ExerciseLibrary = z.object({
	exercises: z.array(ExerciseDef).min(1),
});
export type ExerciseLibrary = z.infer<typeof ExerciseLibrary>;

/**
 * A specific machine. `20 kg` on one leg press is not `20 kg` on another, so
 * load history is keyed by exercise *and* equipment; volume is keyed by exercise
 * alone.
 *
 * Defined here in E1, wired to performed sets in E3 — linking it touches stored
 * records, which this stage deliberately does not.
 */
export const Equipment = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	gym: z.string().default(""),
	kind: EquipmentKind,
	/** The machine's real smallest jump, which no spreadsheet ever stated. */
	incrementKg: z.number().nullable().default(null),
	minLoadKg: z.number().nullable().default(null),
	maxLoadKg: z.number().nullable().default(null),
	loadsPerSide: z.boolean().default(false),
	stackUnit: z.enum(["kg", "plate", "level"]).default("kg"),
	notes: z.string().default(""),
});
export type Equipment = z.infer<typeof Equipment>;

// ------------------------------------------------------- program, as written

/**
 * One exercise as a session prescribes it: a reference to the library plus
 * everything that is true of *this* exposure and not of the movement.
 *
 * This is the on-disk shape. `lib/content.ts` composes it with the library into
 * the `Exercise` the rest of the app already reads, so nothing downstream knows
 * the split happened.
 */
export const WorkoutTemplateExercise = z.object({
	exerciseId: z.string().min(1),
	order: z.number().int().positive(),
	/** When this session names it differently. Presentation, not identity. */
	displayName: z.string().optional(),

	setsByPhase: z.object({ 1: SetCount, 2: SetCount, 3: SetCount, 4: SetCount }),
	target: Target,
	load: Load,
	rir: Range.nullable().default(null),
	/** Overrides the library's default rest. */
	restSeconds: Range.nullable().default(null),

	goal: z.string().default(""),
	progression: z.string().default(""),
	trainingRole: TrainingRole,

	/** Specific to this prescription. Never promoted to the library. */
	cues: z.array(z.string()).default([]),
	/** What THIS prescription permits — not the whole catalogue. */
	allowedSubstitutions: z.array(SubstitutionRef).default([]),
});
export type WorkoutTemplateExercise = z.infer<typeof WorkoutTemplateExercise>;

export const WorkoutTemplate = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	weekday: Weekday,
	exercises: z.array(WorkoutTemplateExercise).min(1),
});
export type WorkoutTemplate = z.infer<typeof WorkoutTemplate>;

/**
 * The program as it sits on disk: the same as `Program` in every respect except
 * that its sessions reference the library instead of restating it.
 *
 * `lib/content.ts` validates this, composes it against the library, and validates
 * the result as a `Program` — so the shape the app consumes is checked, not
 * assumed.
 */
export const ProgramFile = Program.omit({ sessions: true }).extend({
	sessions: z.array(WorkoutTemplate).min(1),
});
export type ProgramFile = z.infer<typeof ProgramFile>;

// ------------------------------------------------------------- prescription

/**
 * The longitudinal identity of a *slot*, not of an exercise.
 *
 * The third slot of Full Body A can go from leg press to hack squat, and "what
 * has been in that slot" has to survive the change — the same argument that
 * stopped exercises being identified by their name in E1. So the exercise is a
 * field of the slot, never its name.
 *
 * Two sources, and only one can live in a fixture. Seeded slots come from the
 * migration and look like `slot_full_body_a_03`. Slots created from the app with
 * `add_entry` are opaque UUIDs: they are made on a phone with no network, maybe
 * at the same moment as the laptop, so they cannot depend on a compiled list.
 */
export const PrescriptionEntryId = z.string().min(1);
export type PrescriptionEntryId = z.infer<typeof PrescriptionEntryId>;

/** What a slot prescribes. The shape both the baseline and a snapshot carry. */
export const PrescriptionEntry = z.object({
	id: PrescriptionEntryId,
	templateId: z.string().min(1),
	/** Who occupies the slot. Changeable; not identity. */
	exerciseId: z.string().min(1),
	order: z.number().int().positive(),

	sets: SetCount,
	target: Target,
	load: Load,
	rir: Range.nullable().default(null),
	restSeconds: Range.nullable().default(null),
	trainingRole: TrainingRole,
	goal: z.string().default(""),
	progression: z.string().default(""),
	cues: z.array(z.string()).default([]),
	allowedSubstitutions: z.array(SubstitutionRef).default([]),
});
export type PrescriptionEntry = z.infer<typeof PrescriptionEntry>;

/** The starting state of every slot. Seeded once; never rewritten. */
export const PrescriptionBaseline = PrescriptionEntry.extend({
	seededFrom: z.string().default(""),
	seededAt: z.number(),
});
export type PrescriptionBaseline = z.infer<typeof PrescriptionBaseline>;

/**
 * Changing one field. A discriminated union rather than `field` + `unknown`, so
 * the relation between the two survives into the type and into Zod.
 */
export const FieldChange = z.discriminatedUnion("field", [
	z.object({ field: z.literal("sets"), value: SetCount }),
	z.object({ field: z.literal("target"), value: Target }),
	z.object({ field: z.literal("load"), value: Load }),
	z.object({ field: z.literal("rir"), value: Range.nullable() }),
	z.object({ field: z.literal("restSeconds"), value: Range.nullable() }),
	z.object({ field: z.literal("trainingRole"), value: TrainingRole }),
	z.object({ field: z.literal("cues"), value: z.array(z.string()) }),
	z.object({
		field: z.literal("allowedSubstitutions"),
		value: z.array(SubstitutionRef),
	}),
	z.object({ field: z.literal("goal"), value: z.string() }),
	z.object({ field: z.literal("progression"), value: z.string() }),
	z.object({ field: z.literal("order"), value: z.number().int().positive() }),
]);
export type FieldChange = z.infer<typeof FieldChange>;

export const AdjustmentOrigin = z.enum([
	"program",
	"review",
	"coach",
	"manual",
	"safety",
]);
export type AdjustmentOrigin = z.infer<typeof AdjustmentOrigin>;

/** Where the adjustment came from, and which of it is an assumption. */
export const Provenance = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("authored") }),
	z.object({
		kind: z.literal("migrated"),
		from: z.enum(["setsByPhase", "exerciseOverride"]),
		/** The effective date did not come from the data: the migration set it. */
		assumedEffectiveOn: z.boolean(),
	}),
	/**
	 * Copied from the phase this one says it inherits from, when it was created.
	 *
	 * The alternative was for the resolver to walk `inheritsFrom` on every read,
	 * and that has a property nobody wants: editing B would silently move C months
	 * later, with no event anywhere saying C changed. Materialising once makes the
	 * inheritance a set of decisions with a date, and leaves C independent
	 * afterwards — which is the same reason snapshots keep numbers, not references.
	 *
	 * Both fields are the audit trail: which phase it came from, and which exact
	 * adjustment it is a copy of. The second is what makes reconciling idempotent.
	 */
	z.object({
		kind: z.literal("inherited"),
		inheritedFromPhaseId: PhaseId,
		sourceAdjustmentId: z.string().min(1),
	}),
]);
export type Provenance = z.infer<typeof Provenance>;

/**
 * What happens to a live safety adjustment when the slot's exercise is replaced.
 *
 * Never carried over silently: moving an alarm to a different movement would
 * assert something nobody checked, and dropping it would assert the opposite.
 * Both are decisions, so both are asked for — and the referenced adjustments must
 * already exist and be persisted before the replacement is written.
 */
export const SafetyResolution = z.object({
	safetyAdjustmentIds: z.array(z.string()).min(1),
	decision: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("keep") }),
		z.object({
			kind: z.literal("reformulate"),
			replacementAdjustmentId: z.string().min(1),
		}),
		z.object({
			kind: z.literal("revoke"),
			revocationAdjustmentId: z.string().min(1),
		}),
	]),
	reason: z.string().min(1),
});
export type SafetyResolution = z.infer<typeof SafetyResolution>;

const AdjustmentBase = {
	id: z.string().min(1),
	/**
	 * The date it applies from. Mandatory on every adjustment: one is a state that
	 * lasts, and a state with no start cannot be resolved.
	 */
	effectiveOn: IsoDate,
	/** Extra gate: only while in that phase. Never retroactive by itself. */
	onlyInPhase: PhaseId.nullable().default(null),
	origin: AdjustmentOrigin,
	/** Non-empty. An adjustment with no reason is a number with no owner. */
	reason: z.string().min(1),
	evidenceIds: z.array(z.string()).default([]),
	provenance: Provenance.default({ kind: "authored" }),
	/** For ordering on screen and for audit. Never for deciding. */
	createdAt: z.number(),
};

export const PlanAdjustment = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("set_field"),
		entryId: PrescriptionEntryId,
		change: FieldChange,
		...AdjustmentBase,
	}),
	/** The slot gets a different occupant, with its whole prescription. */
	z.object({
		kind: z.literal("replace_exercise"),
		entryId: PrescriptionEntryId,
		entry: PrescriptionEntry.omit({ id: true, templateId: true }),
		safetyResolution: SafetyResolution.nullable().default(null),
		...AdjustmentBase,
	}),
	z.object({
		kind: z.literal("add_entry"),
		entry: PrescriptionEntry,
		...AdjustmentBase,
	}),
	z.object({
		kind: z.literal("remove_entry"),
		entryId: PrescriptionEntryId,
		...AdjustmentBase,
	}),
	/**
	 * That adjustment stops applying **from `effectiveOn` onwards**. It does not
	 * erase it from the dates on which it did apply.
	 *
	 * May not point at another revocation: chaining negations would make "what
	 * held on 25 October?" depend on counting them.
	 */
	z.object({
		kind: z.literal("revoke"),
		revokesId: z.string().min(1),
		...AdjustmentBase,
	}),
]);
export type PlanAdjustment = z.infer<typeof PlanAdjustment>;

/** The adjustments a query is allowed to know about. E3 only cuts adjustments. */
export const PrescriptionKnowledgeCut = z.object({
	adjustmentIds: z.array(z.string()),
});
export type PrescriptionKnowledgeCut = z.infer<typeof PrescriptionKnowledgeCut>;

/**
 * What a session had prescribed, frozen when it started.
 *
 * Self-contained on purpose: it stores resolved values, not references. Revoke
 * tomorrow the adjustment that made it three sets and Tuesday's session still
 * says three sets, because it never knew about that adjustment — only the number.
 * That is the whole of G3.
 */
export const SessionPlanSnapshot = z.object({
	id: z.string().min(1),
	sessionId: z.string().min(1),
	takenAt: z.number(),
	phaseId: PhaseId,
	entries: z.array(PrescriptionEntry),

	/**
	 * `committed`     — frozen at session start. An observed fact.
	 * `reconstructed` — deduced afterwards for a pre-E3 session. A derivative.
	 *
	 * "Provisional" is not stored: it is what you observe when no session points
	 * at a committed snapshot yet. Storing it would need a status transition, and
	 * that is an update on something that must not take them.
	 */
	status: z.enum(["committed", "reconstructed"]),
	reconstructionConfidence: z
		.enum(["complete", "partial"])
		.nullable()
		.default(null),
	/** What could not be placed, so "partial" says in what. */
	reconstructionGaps: z.array(z.string()).default([]),

	/** Which adjustments held. For explaining only; rendering never needs them. */
	adjustmentIds: z.array(z.string()).default([]),
});
export type SessionPlanSnapshot = z.infer<typeof SessionPlanSnapshot>;

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
	/**
	 * Which prescription contract this session was created under.
	 *
	 * It travels with the row rather than living in a list captured by one device,
	 * because a pre-E3 session can arrive by sync *after* the receiver migrated —
	 * and a list would call it corruption. `legacy` is reconstructible;
	 * `snapshot_v1` without a snapshot is a G3 violation, however many sets it has.
	 *
	 * Absent is only `legacy` when the row is demonstrably older than schema 3.
	 */
	prescriptionContract: z
		.enum(["legacy", "snapshot_v1"])
		.nullable()
		.default(null),
	/** The snapshot frozen when this session started. */
	snapshotId: z.string().nullable().default(null),
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
