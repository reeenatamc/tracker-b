/**
 * Normalisation step of the content pipeline: pulls the exercise library out of
 * the sessions.
 *
 * Every movement used to be defined inline inside each session, so the same
 * exercise was written out up to three times and the copies drifted. This reads
 * the current `content/program.yaml`, splits each inline definition into the
 * half that belongs to the movement and the half that belongs to the
 * prescription, and writes `library.yaml` plus a slimmer `program.yaml`.
 *
 * Two things make it safe to run against real content:
 *
 *   - No exercise id is touched. The library is keyed by the ids that already
 *     exist, so nothing logged can be orphaned.
 *   - It recomposes its own output and compares it against the original,
 *     field by field, before writing anything. Differences it cannot justify
 *     abort the run; the ones it can are listed for review.
 *
 * The hand-authored half — muscles, patterns, joints, stimulus, and which cues
 * are general — is the table below. It is the only part that took judgement,
 * so it is the only part worth arguing with.
 *
 * Runs after the Excel import, which still emits the fat shape it always did —
 * keeping the split in one place rather than teaching the importer about
 * anatomy. Idempotent: a program that is already normalised is left alone.
 *
 * Run with: npx tsx scripts/extract-library.ts [--check]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import {
	changeKey,
	EXPECTED_CHANGES,
	EXPECTED_COUNTS,
} from "../src/domain/__fixtures__/expected-changes.ts";
import type {
	FunctionalTarget,
	JointId,
	MovementPattern,
	MuscleId,
	StimulusType,
	TrainingRole,
} from "../src/domain/schema.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK_ONLY = process.argv.includes("--check");

// ------------------------------------------------------------ the judgement

type Anatomy = {
	primary: MuscleId[];
	secondary: MuscleId[];
	functional: FunctionalTarget[];
	pattern: MovementPattern;
	stimulus: StimulusType;
	equipment:
		| "machine"
		| "cable"
		| "dumbbell"
		| "barbell"
		| "band"
		| "bodyweight"
		| "cardio_machine"
		| "none";
	/**
	 * Joints this loads or challenges enough that pain there is a reason to
	 * modify it. Stated for all of them: a partial list would give the future
	 * safety rules false negatives, and an untyped exercise would never trip.
	 */
	joints: JointId[];
};

const ANATOMY: Record<string, Anatomy> = {
	bike_warmup: {
		primary: [], secondary: [], functional: [],
		pattern: "cardio", stimulus: "cardio", equipment: "cardio_machine",
		// No ankle: an easy 8–10 min bike is what you *keep* when the ankle
		// complains, not what you drop. It is the unloading option.
		joints: ["knee", "hip"],
	},
	cardio_machine: {
		primary: [], secondary: [], functional: [],
		pattern: "cardio", stimulus: "cardio", equipment: "cardio_machine",
		// Its own aliases include walking, which does load the ankle.
		joints: ["knee", "hip", "ankle"],
	},
	leg_press: {
		primary: ["quads"], secondary: ["glute_max", "adductors"], functional: [],
		pattern: "squat", stimulus: "resistance", equipment: "machine",
		joints: ["knee", "hip", "ankle"],
	},
	leg_curl: {
		primary: ["hamstrings"], secondary: [], functional: [],
		pattern: "knee_flexion", stimulus: "resistance", equipment: "machine",
		joints: ["knee"],
	},
	hip_abduction: {
		primary: ["glute_med"], secondary: ["glute_max"], functional: [],
		pattern: "hip_abduction", stimulus: "resistance", equipment: "machine",
		joints: ["hip"],
	},
	glute_kickback: {
		primary: ["glute_max"], secondary: ["hamstrings"], functional: [],
		pattern: "hip_extension", stimulus: "resistance", equipment: "machine",
		// Lumbar is not incidental — its own cue is "no arquear lumbar".
		joints: ["hip", "lumbar"],
	},
	seated_row: {
		primary: ["mid_back", "lats"], secondary: ["biceps", "rear_delts"], functional: [],
		pattern: "horizontal_pull", stimulus: "resistance", equipment: "machine",
		joints: ["shoulder", "elbow"],
	},
	lat_pulldown: {
		primary: ["lats"], secondary: ["biceps", "mid_back"], functional: [],
		pattern: "vertical_pull", stimulus: "resistance", equipment: "cable",
		joints: ["shoulder", "elbow"],
	},
	chest_press: {
		primary: ["chest"], secondary: ["triceps", "front_delts"], functional: [],
		pattern: "horizontal_push", stimulus: "resistance", equipment: "machine",
		joints: ["shoulder", "elbow"],
	},
	shoulder_press: {
		primary: ["front_delts"], secondary: ["side_delts", "triceps"], functional: [],
		pattern: "vertical_push", stimulus: "resistance", equipment: "machine",
		joints: ["shoulder", "elbow"],
	},
	lateral_raise: {
		primary: ["side_delts"], secondary: [], functional: [],
		pattern: "shoulder_abduction", stimulus: "resistance", equipment: "machine",
		joints: ["shoulder"],
	},
	biceps_curl: {
		primary: ["biceps"], secondary: ["forearms"], functional: [],
		pattern: "elbow_flexion", stimulus: "resistance", equipment: "cable",
		joints: ["elbow"],
	},
	triceps_extension: {
		primary: ["triceps"], secondary: [], functional: [],
		pattern: "elbow_extension", stimulus: "resistance", equipment: "cable",
		joints: ["elbow"],
	},
	cable_crunch: {
		primary: ["abs"], secondary: ["obliques"], functional: [],
		pattern: "trunk_flexion", stimulus: "resistance", equipment: "cable",
		joints: ["lumbar", "thoracic"],
	},
	pallof_press: {
		primary: ["obliques"], secondary: ["abs"], functional: [],
		pattern: "anti_rotation", stimulus: "resistance", equipment: "cable",
		joints: ["lumbar", "thoracic", "shoulder"],
	},
	dead_bug: {
		primary: ["abs"], secondary: ["obliques"], functional: [],
		pattern: "anti_extension", stimulus: "resistance", equipment: "bodyweight",
		joints: ["lumbar", "hip", "shoulder"],
	},
	knee_to_wall: {
		primary: [], secondary: [], functional: [],
		pattern: "mobility", stimulus: "mobility", equipment: "none",
		joints: ["ankle", "knee"],
	},
	band_eversion: {
		primary: ["peroneals"], secondary: [], functional: ["ankle_stability"],
		pattern: "ankle_eversion", stimulus: "resistance", equipment: "band",
		joints: ["ankle"],
	},
	band_dorsiflexion: {
		// Direct tibialis work: the muscle and the pattern already say what it
		// does, so no functional target is inferred on top.
		primary: ["tibialis"], secondary: [], functional: [],
		pattern: "ankle_dorsiflexion", stimulus: "resistance", equipment: "band",
		joints: ["ankle"],
	},
	calf_raise: {
		primary: ["calves"], secondary: [], functional: [],
		pattern: "ankle_plantarflexion", stimulus: "resistance", equipment: "bodyweight",
		joints: ["ankle"],
	},
	calf_raise_unilateral: {
		primary: ["calves"], secondary: [], functional: ["ankle_stability"],
		pattern: "ankle_plantarflexion", stimulus: "resistance", equipment: "bodyweight",
		joints: ["ankle"],
	},
	single_leg_balance: {
		// No primary muscle on purpose. Standing on one leg is not three direct
		// sets of anything, and pretending otherwise is how a volume audit lies.
		primary: [], secondary: [], functional: ["balance", "ankle_stability"],
		pattern: "balance", stimulus: "balance", equipment: "bodyweight",
		joints: ["ankle", "knee", "hip"],
	},
	directional_reach: {
		primary: [], secondary: ["glute_med", "quads"], functional: ["ankle_control", "balance"],
		pattern: "balance", stimulus: "balance", equipment: "bodyweight",
		joints: ["ankle", "knee", "hip"],
	},
	star_reach: {
		primary: [], secondary: ["glute_med", "quads"], functional: ["ankle_control", "balance"],
		pattern: "balance", stimulus: "balance", equipment: "bodyweight",
		joints: ["ankle", "knee", "hip"],
	},
	step_down: {
		primary: ["quads"], secondary: ["glute_med"], functional: ["ankle_control"],
		pattern: "lunge", stimulus: "resistance", equipment: "bodyweight",
		joints: ["knee", "ankle", "hip"],
	},
	soft_surface_balance: {
		primary: [], secondary: [], functional: ["balance", "ankle_stability"],
		pattern: "balance", stimulus: "balance", equipment: "bodyweight",
		joints: ["ankle", "knee"],
	},
};

/**
 * Cues that describe the movement rather than this person's prescription.
 *
 * Everything not listed here stays on the template that wrote it. The two leg
 * press cues are the clearest case: "pies algo más altos por tobillo" is an
 * accommodation for one ankle, and "misma postura sin dolor" refers back to
 * Monday. Neither is a property of a leg press. "No llegar al fallo sola" is the
 * subtle one — it reads like technique but is really about training with nobody
 * there to rack the weight, which is context, not form.
 */
const GENERAL_CUES = new Set<string>([
	"No convertirlo en cardio duro",
	"Bajada controlada",
	"Sin balancear torso",
	"Sin encoger hombros",
	"Codos estables",
	"Flexionar tronco, no tirar con brazos",
	"No arquear lumbar",
	"Agarre cómodo; no detrás de cabeza",
	"Sin hiperextender espalda",
	"Codos pegados",
	"Control, sin rebotes",
	"No rotar",
]);

/** Which role each template plays. Prescription, not property. */
const ROLE_BY_EXERCISE: Record<string, TrainingRole> = {
	bike_warmup: "warmup",
	cardio_machine: "cardio",
};

// -------------------------------------------------------------------- migrate

type Inline = Record<string, unknown> & {
	id: string;
	name: string;
	order: number;
	muscle?: string;
	technique?: string;
	substitution?: string;
	restSeconds?: unknown;
	target?: { kind: string; min?: number; max?: number };
};

const programPath = resolve(ROOT, "content", "program.yaml");
const program = parse(readFileSync(programPath, "utf8"));

// Already normalised: the sessions reference the library instead of restating
// it. Re-running is a no-op rather than an error, so the import pipeline can
// always end with this step.
const firstExercise = program.sessions?.[0]?.exercises?.[0] ?? {};
if (firstExercise.exerciseId !== undefined) {
	console.log("content/program.yaml ya está normalizado; nada que hacer.");
	process.exit(0);
}

/** Every inline definition, grouped by the id it already carries. */
const occurrences = new Map<string, Inline[]>();
for (const session of program.sessions) {
	for (const exercise of session.exercises as Inline[]) {
		const list = occurrences.get(exercise.id) ?? [];
		list.push(exercise);
		occurrences.set(exercise.id, list);
	}
}
for (const entry of program.ankleRehab as Inline[]) {
	const list = occurrences.get(entry.id) ?? [];
	list.push(entry);
	occurrences.set(entry.id, list);
}

/** The canonical registry, read as data so the two files cannot disagree. */
const registrySource = readFileSource("src/domain/exercise-ids.ts");
const REGISTRY = parseRegistry(registrySource);

function readFileSource(relative: string): string {
	return readFileSync(resolve(ROOT, relative), "utf8");
}

/** Pulls `EXERCISE_REGISTRY` out of the module without importing the module. */
function parseRegistry(source: string): Record<string, string[]> {
	const body = source.slice(
		source.indexOf("EXERCISE_REGISTRY: Record<CanonicalId, readonly string[]> = {"),
		source.indexOf("\n};", source.indexOf("EXERCISE_REGISTRY")),
	);
	const registry: Record<string, string[]> = {};
	for (const match of body.matchAll(/^\t(\w+): \[([\s\S]*?)\],$/gm)) {
		registry[match[1]] = [...match[2].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
	}
	return registry;
}

const unique = <T,>(values: T[]): T[] => [...new Set(values)];

function buildLibrary() {
	const ids = unique([...Object.keys(REGISTRY), ...occurrences.keys()]).sort();
	const missing = ids.filter((id) => !ANATOMY[id]);
	if (missing.length > 0) {
		throw new Error(`Sin anatomía asignada: ${missing.join(", ")}`);
	}

	return ids.map((id) => {
		const seen = occurrences.get(id) ?? [];
		const anatomy = ANATOMY[id];
		const names = REGISTRY[id] ?? [];
		const canonicalName = names[0] ?? seen[0]?.name ?? id;

		const aliases = unique([
			...names.slice(1),
			...seen.map((entry) => entry.name),
		])
			.filter((name) => name !== canonicalName)
			.map((name) => ({
				name,
				source: names.includes(name) ? "spreadsheet-v3" : "spreadsheet-v3",
			}));

		const cues = unique(
			seen
				.map((entry) => String(entry.technique ?? "").trim())
				.filter((cue) => cue.length > 0 && GENERAL_CUES.has(cue)),
		);

		const substitutions = unique(
			seen
				.map((entry) => String(entry.substitution ?? "").trim())
				.filter((text) => text.length > 0),
		).map((text) => ({ kind: "note" as const, text }));

		// Identical across every duplicate — verified by the recomposition below.
		const rest = seen.find((entry) => entry.restSeconds != null)?.restSeconds;

		const repTargets = unique(
			seen
				.filter((entry) => entry.target?.kind === "reps" || entry.target?.kind === "repsPerSide")
				.map((entry) => `${entry.target?.min}-${entry.target?.max}`),
		);
		const typicalReps =
			repTargets.length === 1
				? {
						min: Number(repTargets[0].split("-")[0]),
						max: Number(repTargets[0].split("-")[1]),
					}
				: null;

		// The richest label wins: "Dorsal + bíceps" says more than "Dorsal", and
		// picking the shorter one would drop information the sheet had.
		const muscleLabel = seen
			.map((entry) => String(entry.muscle ?? ""))
			.sort((a, b) => b.length - a.length)[0] ?? "";

		return {
			id,
			name: canonicalName,
			aliases,
			primaryMuscles: anatomy.primary,
			secondaryMuscles: anatomy.secondary,
			functionalTargets: anatomy.functional,
			pattern: anatomy.pattern,
			stimulusType: anatomy.stimulus,
			equipmentKind: anatomy.equipment,
			muscleLabel,
			cues,
			commonErrors: [],
			typicalReps,
			defaultRestSeconds: rest ?? null,
			substitutions,
			cautions: [],
			jointLoads: anatomy.joints,
			media: [],
			unused: seen.length === 0,
		};
	});
}

function slimSessions() {
	return program.sessions.map((session: Record<string, unknown>) => ({
		id: session.id,
		name: session.name,
		weekday: session.weekday,
		exercises: (session.exercises as Inline[]).map((exercise) => {
			const cue = String(exercise.technique ?? "").trim();
			const substitution = String(exercise.substitution ?? "").trim();

			/*
			 * No `displayName` is emitted. The name differences in the sheet are
			 * drift, not intent — "Curl femoral acostado/sentado" on Monday and
			 * "Curl femoral" on Friday are the same movement written twice, and
			 * pinning both would preserve exactly what the library exists to end.
			 * They survive as aliases, so nothing stops resolving. The field stays
			 * in the schema for a session that one day means it.
			 */
			return {
				exerciseId: exercise.id,
				order: exercise.order,
				setsByPhase: exercise.setsByPhase,
				target: exercise.target,
				load: exercise.load,
				rir: exercise.rir ?? null,
				restSeconds: null,
				goal: exercise.goal ?? "",
				progression: exercise.progression ?? "",
				trainingRole: ROLE_BY_EXERCISE[exercise.id] ?? "strength",
				cues: cue.length > 0 && !GENERAL_CUES.has(cue) ? [cue] : [],
				allowedSubstitutions:
					substitution.length > 0
						? [{ kind: "note" as const, text: substitution }]
						: [],
			};
		}),
	}));
}

// --------------------------------------------------------- prove it lossless

type Diff = { exercise: string; session: string; field: string; before: unknown; after: unknown };

function recompose(library: ReturnType<typeof buildLibrary>, sessions: ReturnType<typeof slimSessions>): Diff[] {
	const byId = new Map(library.map((def) => [def.id, def]));
	const diffs: Diff[] = [];

	program.sessions.forEach((session: { id: string; exercises: Inline[] }, index: number) => {
		session.exercises.forEach((before, position) => {
			const entry = sessions[index].exercises[position];
			const def = byId.get(entry.exerciseId);
			if (!def) throw new Error(`Sin definición: ${entry.exerciseId}`);

			const after = {
				id: entry.exerciseId,
				name: entry.displayName ?? def.name,
				order: entry.order,
				setsByPhase: entry.setsByPhase,
				target: entry.target,
				load: entry.load,
				progression: entry.progression,
				goal: entry.goal,
				muscle: def.muscleLabel,
				rir: entry.rir,
				restSeconds: entry.restSeconds ?? def.defaultRestSeconds,
				substitution: entry.allowedSubstitutions
					.map((reference: { text: string }) => reference.text)
					.join(" / "),
				technique: [...entry.cues, ...def.cues].join("; "),
				isAnkle: def.jointLoads.includes("ankle"),
			};

			for (const field of Object.keys(after) as Array<keyof typeof after>) {
				const left = JSON.stringify(before[field] ?? (typeof after[field] === "string" ? "" : null));
				const right = JSON.stringify(after[field]);
				if (left !== right) {
					diffs.push({ exercise: entry.exerciseId, session: session.id, field, before: before[field], after: after[field] });
				}
			}
		});
	});

	return diffs;
}

// -------------------------------------------------------------------- run it

const library = buildLibrary();
const sessions = slimSessions();
const diffs = recompose(library, sessions);

/*
 * Every difference has to have been approved in advance, by coordinate. The
 * field-level allowance ("technique is allowed to change") was too loose: it
 * would let a reclassified cue silently light up a session nobody reviewed.
 */
const allowed = new Set(EXPECTED_CHANGES.map(changeKey));
const unexpected = diffs.filter(
	(diff) => !allowed.has(`${diff.session}/${diff.exercise}/${diff.field}`),
);
const absent = EXPECTED_CHANGES.filter(
	(change) =>
		!diffs.some(
			(diff) =>
				diff.session === change.session &&
				diff.exercise === change.exercise &&
				diff.field === change.field,
		),
);

console.log(`Biblioteca: ${library.length} ejercicios`);
const instances = sessions.reduce(
	(total: number, session: { exercises: unknown[] }) => total + session.exercises.length,
	0,
);
console.log(`Plantillas: ${instances} instancias\n`);

if (diffs.length === 0) {
	console.log("Recomposición idéntica al original.");
} else {
	console.log(`Cambios visibles al recomponer (${diffs.length}):`);
	for (const diff of diffs) {
		console.log(
			`  ${diff.session.padEnd(14)} ${diff.exercise.padEnd(20)} ${diff.field.padEnd(11)} ` +
				`${JSON.stringify(diff.before)} -> ${JSON.stringify(diff.after)}`,
		);
	}
}

if (absent.length > 0) {
	// Not fatal: an exercise leaving the program legitimately removes its change.
	console.log(`\nAvisos: ${absent.length} cambios aprobados que ya no ocurren:`);
	for (const change of absent) console.log(`  ${changeKey(change)}`);
}

if (unexpected.length > 0) {
	console.error(
		`\nABORTA: ${unexpected.length} cambio(s) que nadie aprobó.\n` +
			"Si son correctos, añádelos a src/domain/__fixtures__/expected-changes.ts\n" +
			"y hazlos revisar; esta lista existe para que no entren en silencio.",
	);
	for (const diff of unexpected) {
		console.error(`  ${diff.session}/${diff.exercise}/${diff.field}`);
	}
	process.exit(1);
}

console.log(
	`\nTodos dentro de lo aprobado (${EXPECTED_COUNTS.technique} cues + ` +
		`${EXPECTED_COUNTS.name} nombres + ${EXPECTED_COUNTS.muscle} músculo = ` +
		`${EXPECTED_COUNTS.total}).`,
);

if (CHECK_ONLY) {
	console.log("\n--check: no se escribió nada.");
	process.exit(0);
}

const HEADER =
	"# Biblioteca de ejercicios: qué ES cada movimiento.\n" +
	"# Lo que una sesión concreta le pide vive en program.yaml.\n" +
	"# Generado una vez por scripts/extract-library.ts; a partir de aquí se edita a mano.\n";

writeFileSync(
	resolve(ROOT, "content", "library.yaml"),
	HEADER + stringify({ exercises: library }, { lineWidth: 100 }),
	"utf8",
);

// Rebuilt from the parsed document rather than spliced as text: the spread
// keeps every other key, and its original order, with `sessions` replaced in
// place. Splicing strings around a YAML file is how a migration eats a program.
writeFileSync(`${programPath}.bak`, readFileSync(programPath, "utf8"), "utf8");
writeFileSync(
	programPath,
	"# Generated by scripts/import-excel.ts — edit freely, it is not regenerated automatically.\n" +
		"# Los ejercicios referencian content/library.yaml; aquí vive sólo la prescripción.\n" +
		stringify({ ...program, sessions }, { lineWidth: 100 }),
	"utf8",
);

console.log("\ncontent/library.yaml escrito");
console.log("content/program.yaml adelgazado (copia previa en program.yaml.bak)");
