/**
 * Anatomy, and the grouping that is only ever a way of looking at it.
 *
 * Two layers, deliberately:
 *
 *   `MuscleId`    what an exercise declares, and the only thing the volume
 *                 audit ever counts. Granular by design — `glute_max` and
 *                 `glute_med` are two muscles, and the three deltoid heads are
 *                 three, because "6 series de hombro" hides whether the lateral
 *                 head got any of them.
 *
 *   `MuscleGroup` how it reads on a screen. Derived, never stored, never
 *                 declared by an exercise.
 *
 * The audit computes and returns indexed by `MuscleId`; `groupOf` is applied at
 * render time. Aggregating is a view, not a step of the calculation — which is
 * what makes it impossible to lose the granular figure by summing early.
 *
 * What is *not* here: functions. "Ankle stabilisers" is not a muscle, it is a job
 * shared by the peroneals, the posterior tibialis, the foot's intrinsics and a
 * good deal of neuromuscular control. Modelling it as anatomy is what would let
 * a balance drill be counted as "3 direct sets of stabilisers", which is a
 * sentence the audit must never be able to produce. Those live in
 * `FunctionalTarget`.
 */

import type { FunctionalTarget, MuscleId } from "./schema";

export type { FunctionalTarget, MuscleId };

/** How the audit reads on screen. Presentation only. */
export type MuscleGroup =
	| "quads"
	| "hamstrings"
	| "glutes"
	| "adductors"
	| "calves"
	| "chest"
	| "back"
	| "shoulders"
	| "biceps"
	| "triceps"
	| "forearms"
	| "core"
	| "ankle";

/**
 * Total and non-overlapping: every muscle belongs to exactly one group.
 *
 * `adductors` and `forearms` are groups of their own rather than being folded
 * into glutes and biceps — folding them would quietly answer "how much adductor
 * work am I doing?" with somebody else's number.
 */
const GROUPS: Record<MuscleGroup, readonly MuscleId[]> = {
	quads: ["quads"],
	hamstrings: ["hamstrings"],
	glutes: ["glute_max", "glute_med"],
	adductors: ["adductors"],
	calves: ["calves"],
	chest: ["chest"],
	back: ["lats", "mid_back", "lower_back"],
	shoulders: ["front_delts", "side_delts", "rear_delts"],
	biceps: ["biceps"],
	triceps: ["triceps"],
	forearms: ["forearms"],
	core: ["abs", "obliques"],
	ankle: ["tibialis", "peroneals"],
};

export const MUSCLE_GROUPS = GROUPS;

const BY_MUSCLE = new Map<MuscleId, MuscleGroup>();
for (const [group, muscles] of Object.entries(GROUPS) as Array<
	[MuscleGroup, readonly MuscleId[]]
>) {
	for (const muscle of muscles) BY_MUSCLE.set(muscle, group);
}

export const ALL_MUSCLES: readonly MuscleId[] = [...BY_MUSCLE.keys()];

/** The group a muscle rolls up into. The only way to aggregate. */
export function groupOf(muscle: MuscleId): MuscleGroup {
	const group = BY_MUSCLE.get(muscle);
	if (!group) throw new Error(`Músculo sin grupo: ${muscle}`);
	return group;
}

/** The muscles a group covers, for a screen that wants to break one open. */
export function musclesIn(group: MuscleGroup): readonly MuscleId[] {
	return GROUPS[group];
}

// ------------------------------------------------------------ display labels

const MUSCLE_LABELS: Record<MuscleId, string> = {
	quads: "Cuádriceps",
	hamstrings: "Isquios",
	glute_max: "Glúteo mayor",
	glute_med: "Glúteo medio",
	adductors: "Aductores",
	calves: "Gemelos",
	tibialis: "Tibial anterior",
	peroneals: "Peroneos",
	chest: "Pecho",
	lats: "Dorsal",
	mid_back: "Espalda media",
	lower_back: "Lumbar",
	front_delts: "Deltoide anterior",
	side_delts: "Deltoide lateral",
	rear_delts: "Deltoide posterior",
	biceps: "Bíceps",
	triceps: "Tríceps",
	forearms: "Antebrazo",
	abs: "Recto abdominal",
	obliques: "Oblicuos",
};

const GROUP_LABELS: Record<MuscleGroup, string> = {
	quads: "Cuádriceps",
	hamstrings: "Isquios",
	glutes: "Glúteos",
	adductors: "Aductores",
	calves: "Gemelos",
	chest: "Pecho",
	back: "Espalda",
	shoulders: "Hombros",
	biceps: "Bíceps",
	triceps: "Tríceps",
	forearms: "Antebrazo",
	core: "Core",
	ankle: "Tobillo",
};

const FUNCTIONAL_LABELS: Record<FunctionalTarget, string> = {
	ankle_stability: "Estabilidad de tobillo",
	ankle_control: "Control de tobillo",
	balance: "Equilibrio",
};

export function muscleLabel(muscle: MuscleId): string {
	return MUSCLE_LABELS[muscle];
}

export function groupLabel(group: MuscleGroup): string {
	return GROUP_LABELS[group];
}

export function functionalLabel(target: FunctionalTarget): string {
	return FUNCTIONAL_LABELS[target];
}
