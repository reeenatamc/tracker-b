/**
 * Stable identity for exercises.
 *
 * Ids used to be slugs of the display name, which meant the spreadsheet renaming
 * "Prensa" to "Prensa de piernas" silently orphaned every set ever logged
 * against it. The name is presentation; the id is identity, and the two must not
 * be the same thing.
 *
 * So: a fixed canonical id per movement, and every name any version of the
 * spreadsheet has used for it listed as an alias. A future rename is one line
 * here, and no history moves.
 *
 * Aliases are matched accent- and case-insensitively, so "Abducción" and
 * "abduccion" resolve alike. A name that matches nothing resolves to null and is
 * reported rather than guessed — a wrong mapping quietly merges two exercises'
 * histories, which is worse than an unmapped one.
 */

export type CanonicalId = string;

/**
 * One entry per movement. The first alias is the preferred display name when the
 * app has to name an exercise with no program entry to read it from.
 */
export const EXERCISE_REGISTRY: Record<CanonicalId, readonly string[]> = {
	// ── Warm-up and cardio ────────────────────────────────────────────────────
	bike_warmup: ["Bicicleta"],
	cardio_machine: [
		"Bici o elíptica",
		"Bici/elíptica/caminata estable",
		"Bici/elíptica/caminata",
	],

	// ── Lower body ────────────────────────────────────────────────────────────
	leg_press: ["Prensa de piernas", "Prensa"],
	leg_curl: [
		"Curl femoral",
		"Curl femoral acostado/sentado",
		"Curl femoral acostado",
		"Curl femoral sentado",
	],
	hip_abduction: ["Abducción de cadera", "Abducción"],
	glute_kickback: ["Glute kickback máquina/polea", "Glute kickback"],

	// ── Upper body ────────────────────────────────────────────────────────────
	seated_row: ["Remo sentado"],
	lat_pulldown: ["Jalón al pecho"],
	chest_press: ["Press pecho máquina"],
	shoulder_press: ["Press hombro máquina"],
	lateral_raise: ["Elevación lateral", "Elevación lateral máquina/polea"],
	biceps_curl: ["Curl bíceps", "Curl bíceps polea/máquina"],
	triceps_extension: ["Extensión tríceps", "Extensión tríceps polea"],

	// ── Core ──────────────────────────────────────────────────────────────────
	cable_crunch: ["Cable crunch"],
	pallof_press: ["Pallof press"],
	dead_bug: ["Dead bug"],

	// ── Ankle rehabilitation ──────────────────────────────────────────────────
	knee_to_wall: ["Knee-to-wall"],
	band_eversion: ["Eversión con banda"],
	band_dorsiflexion: ["Dorsiflexión con banda"],
	calf_raise: ["Calf raise", "Calf raise bilateral", "Elevación de talón"],
	calf_raise_unilateral: [
		"Calf raise unilateral asistido",
		"Calf raise unilateral con apoyo",
	],
	single_leg_balance: [
		"Balance 1 pierna",
		"Balance unilateral",
		"Equilibrio unilateral",
		"Equilibrio 1 pierna",
		"Balance / reach",
	],
	directional_reach: ["Reach 3 direcciones"],
	star_reach: ["Y/Star reach", "Y-reach / star reach"],
	step_down: ["Step-down bajo"],
	soft_surface_balance: [
		"Balance superficie blanda",
		"Balance superficie algo blanda",
	],
};

/**
 * Ids written before this registry existed, when they were slugs of the name.
 * Used once, to re-point stored records; never to resolve a spreadsheet name.
 *
 * `glute-kickback-o-abduccion` is deliberately absent: the v2 spreadsheet listed
 * that exercise as a choice between two different movements, so a record under
 * it could be either one and mapping it would merge two histories.
 */
export const LEGACY_IDS: Record<string, CanonicalId> = {
	bicicleta: "bike_warmup",
	"cardio-machine": "cardio_machine",
	prensa: "leg_press",
	"curl-femoral": "leg_curl",
	"curl-femoral-acostado": "leg_curl",
	"curl-femoral-acostado-sentado": "leg_curl",
	abduccion: "hip_abduction",
	"remo-sentado": "seated_row",
	"jalon-al-pecho": "lat_pulldown",
	"press-pecho-maquina": "chest_press",
	"press-hombro-maquina": "shoulder_press",
	"cable-crunch": "cable_crunch",
	"pallof-press": "pallof_press",
	"dead-bug": "dead_bug",
	"knee-to-wall": "knee_to_wall",
	"eversion-con-banda": "band_eversion",
	"dorsiflexion-con-banda": "band_dorsiflexion",
	"calf-raise": "calf_raise",
	"elevacion-de-talon": "calf_raise",
	"balance-unilateral": "single_leg_balance",
	"equilibrio-unilateral": "single_leg_balance",
	"equilibrio-1-pierna": "single_leg_balance",
	"balance-reach": "single_leg_balance",
	"step-down-bajo": "step_down",
};

/** Accent- and case-insensitive, so the spreadsheet's typography does not matter. */
export function normalizeName(name: string): string {
	return name
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ");
}

const BY_ALIAS = new Map<string, CanonicalId>();
for (const [id, aliases] of Object.entries(EXERCISE_REGISTRY)) {
	for (const alias of aliases) BY_ALIAS.set(normalizeName(alias), id);
}

/** The canonical id for a spreadsheet name, or null when nothing matches. */
export function resolveExerciseId(name: string): CanonicalId | null {
	return BY_ALIAS.get(normalizeName(name)) ?? null;
}

/** The canonical id a stored record should now carry, or null if unchanged. */
export function migrateLegacyId(storedId: string): CanonicalId | null {
	if (storedId in EXERCISE_REGISTRY) return null;
	// Exercises you added yourself already have stable ids of their own.
	if (storedId.startsWith("custom-") || storedId.startsWith("finisher-"))
		return null;
	return LEGACY_IDS[storedId] ?? null;
}

/** Preferred display name, for records with no program entry to read from. */
export function displayName(id: CanonicalId): string {
	return EXERCISE_REGISTRY[id]?.[0] ?? id;
}
