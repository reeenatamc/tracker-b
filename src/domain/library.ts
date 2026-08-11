/**
 * The exercise library, and how a session's prescription is put back together
 * with it.
 *
 * The split is: the library says what a movement *is* — muscles, pattern, the
 * technique that is true of it anywhere, the joints it loads. The template says
 * what *this* session asks of it — sets, reps, RIR, load, and the cues and
 * substitutions that belong to this exposure and no other.
 *
 * That distinction is not academic. "Pies algo más altos por tobillo" is written
 * against the Monday leg press, and promoting it to a property of the leg press
 * would silently turn one person's ankle accommodation into how the machine
 * works. Equally, "sin balancear torso" was written once and applies every time.
 * One of those belongs in the library and the other does not, and no automatic
 * rule can tell them apart — so they are classified by hand and kept apart here.
 *
 * `composeExercise` puts the two halves back into the exact `Exercise` shape the
 * rest of the app already reads. Nothing downstream knows the split happened,
 * which is what keeps this stage free of component changes.
 */

import { normalizeName } from "./exercise-ids";
import type {
	Exercise,
	ExerciseDef,
	ExerciseLibrary,
	Program,
	SessionTemplate,
	SubstitutionRef,
	WorkoutTemplate,
	WorkoutTemplateExercise,
} from "./schema";

export type Library = {
	byId: ReadonlyMap<string, ExerciseDef>;
	/** Normalised alias -> canonical id. */
	byAlias: ReadonlyMap<string, string>;
	all: readonly ExerciseDef[];
};

export function indexLibrary(library: ExerciseLibrary): Library {
	const byId = new Map<string, ExerciseDef>();
	const byAlias = new Map<string, string>();

	for (const def of library.exercises) {
		if (byId.has(def.id)) {
			throw new Error(`Ejercicio duplicado en la biblioteca: ${def.id}`);
		}
		byId.set(def.id, def);

		// The canonical name resolves too, so a lookup never depends on somebody
		// having remembered to also list the name among the aliases.
		for (const name of [def.name, ...def.aliases.map((alias) => alias.name)]) {
			const key = normalizeName(name);
			const existing = byAlias.get(key);
			if (existing && existing !== def.id) {
				throw new Error(
					`El alias "${name}" apunta a dos ejercicios: ${existing} y ${def.id}`,
				);
			}
			byAlias.set(key, def.id);
		}
	}

	return { byId, byAlias, all: library.exercises };
}

export function findDef(library: Library, id: string): ExerciseDef | null {
	return library.byId.get(id) ?? null;
}

/** The canonical id a written name refers to, or null when nothing matches. */
export function resolveByName(library: Library, name: string): string | null {
	return library.byAlias.get(normalizeName(name)) ?? null;
}

// ------------------------------------------------------------------ composing

/**
 * Renders a substitution as the one line the logger shows.
 *
 * A reference is shown by the substitute's own name, so renaming an exercise
 * renames it everywhere; free text is shown as written, because the spreadsheet
 * knew things the library does not yet have ids for.
 */
function substitutionText(
	reference: SubstitutionRef,
	library: Library,
): string {
	if (reference.kind === "note") return reference.text;
	return findDef(library, reference.exerciseId)?.name ?? reference.exerciseId;
}

/**
 * A template entry plus its library definition, in the shape the app reads.
 *
 * Cues are joined prescription-first: the session-specific instruction is the
 * more specific one, and it is what you want to read while standing at the
 * machine.
 */
export function composeExercise(
	entry: WorkoutTemplateExercise,
	library: Library,
): Exercise {
	const def = findDef(library, entry.exerciseId);
	if (!def) {
		throw new Error(
			`La plantilla usa un ejercicio que no está en la biblioteca: ${entry.exerciseId}`,
		);
	}

	return {
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
			.map((reference) => substitutionText(reference, library))
			.join(" / "),
		technique: [...entry.cues, ...def.cues].join("; "),
		/*
		 * Derived rather than declared. `isAnkle` used to mean two things at once —
		 * "is rehab" and "loads the ankle" — which is why the leg press carried it
		 * while not being rehab at all. The joints are the honest half; the rehab
		 * half is now the prescription's `trainingRole`, and rehab entries do not
		 * come through here at all.
		 */
		isAnkle: def.jointLoads.includes("ankle"),
	};
}

export function composeTemplate(
	template: WorkoutTemplate,
	library: Library,
): SessionTemplate {
	return {
		id: template.id,
		name: template.name,
		weekday: template.weekday,
		exercises: template.exercises.map((entry) =>
			composeExercise(entry, library),
		),
	};
}

/** The on-disk program, with its sessions composed against the library. */
export function composeProgram(
	file: Omit<Program, "sessions"> & { sessions: WorkoutTemplate[] },
	library: Library,
): Program {
	return {
		...file,
		sessions: file.sessions.map((template) =>
			composeTemplate(template, library),
		),
	};
}

// -------------------------------------------------------------------- volume

/**
 * Whether this movement contributes sets to the per-muscle audit.
 *
 * Intrinsic: balance drills and mobility tests train something real, but it is
 * not "three direct sets of a muscle", and counting them as such is how a
 * volume audit starts lying. What they do train is stated as `functionalTargets`
 * and counted separately.
 *
 * Which bucket the sets land in — strength or rehab — is the prescription's
 * `trainingRole`, not this. The same movement can be both across two templates.
 */
export function countsAsMuscularVolume(def: ExerciseDef): boolean {
	return def.stimulusType === "resistance";
}
