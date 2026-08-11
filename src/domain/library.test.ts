/**
 * The library, and the promise it makes: no exercise id moves.
 *
 * Every set ever logged is filed under a canonical id. The library is keyed by
 * the ids that already existed, so this stage cannot orphan history — but
 * "cannot" is worth nothing unless something checks, so the coverage test below
 * is the one that matters. It reads the real content when it is there and the
 * public example otherwise, which means on this machine it checks the actual
 * program.
 *
 * The rest are structural. They assert relationships — that a prescription's
 * cue stays on its prescription, that two sessions of the same movement keep
 * their own substitutions — rather than quoting the program's text, which is
 * personal and does not belong in a public repo.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { EXERCISE_REGISTRY, LEGACY_IDS, normalizeName } from "./exercise-ids";
import {
	composeExercise,
	countsAsMuscularVolume,
	indexLibrary,
	resolveByName,
} from "./library";
import {
	AnkleProtocol,
	Exercise,
	ExerciseLibrary,
	ProgramFile,
} from "./schema";

const ROOT = join(import.meta.dirname, "..", "..");
const DIR = existsSync(join(ROOT, "content", "library.yaml"))
	? join(ROOT, "content")
	: join(ROOT, "content.example");

const read = (file: string) => parse(readFileSync(join(DIR, file), "utf8"));

const library = indexLibrary(ExerciseLibrary.parse(read("library.yaml")));
const programFile = ProgramFile.parse(read("program.yaml"));
const ankleProtocol = AnkleProtocol.parse(read("ankle-protocol.yaml"));
const seed = JSON.parse(readFileSync(join(DIR, "first-session.json"), "utf8"));

const templateEntries = programFile.sessions.flatMap((session) =>
	session.exercises.map((entry) => ({ session: session.id, entry })),
);

describe("cobertura de ids", () => {
	/**
	 * The whole safety argument for this stage. If an id used anywhere is
	 * missing from the library, some record somewhere has nothing to resolve to.
	 */
	it("cubre todo id que aparezca en cualquier parte del contenido", () => {
		const used = new Set<string>([
			...templateEntries.map(({ entry }) => entry.exerciseId),
			...programFile.ankleRehab.map((entry) => entry.id),
			...ankleProtocol.protocol.map((entry) => entry.id),
			...(seed.sets as Array<{ exerciseId: string }>).map(
				(set) => set.exerciseId,
			),
		]);

		const missing = [...used].filter((id) => !library.byId.has(id));
		expect(missing).toEqual([]);
	});

	it("cubre el registro canónico entero", () => {
		const missing = Object.keys(EXERCISE_REGISTRY).filter(
			(id) => !library.byId.has(id),
		);
		expect(missing).toEqual([]);
	});

	it("cubre todo destino de los ids antiguos, para que ninguno quede huérfano", () => {
		const missing = [...new Set(Object.values(LEGACY_IDS))].filter(
			(id) => !library.byId.has(id),
		);
		expect(missing).toEqual([]);
	});

	it("no inventa ejercicios: toda entrada se usa o se declara sin uso", () => {
		const used = new Set([
			...templateEntries.map(({ entry }) => entry.exerciseId),
			...programFile.ankleRehab.map((entry) => entry.id),
		]);

		const orphans = library.all
			.filter((def) => !used.has(def.id) && !def.unused)
			.map((def) => def.id);
		expect(orphans).toEqual([]);
	});
});

describe("los alias siguen resolviendo a lo mismo", () => {
	const pairs = Object.entries(EXERCISE_REGISTRY).flatMap(([id, aliases]) =>
		aliases.map((alias) => [alias, id] as const),
	);

	it.each(pairs)("«%s» resuelve a %s", (alias, id) => {
		expect(resolveByName(library, alias)).toBe(id);
	});

	it("ningún alias apunta a dos ejercicios distintos", () => {
		// indexLibrary throws on collision; reaching here means it did not.
		expect(library.byAlias.size).toBeGreaterThanOrEqual(library.byId.size);
	});

	it("el nombre canónico de cada ejercicio también resuelve", () => {
		for (const def of library.all) {
			expect(resolveByName(library, def.name)).toBe(def.id);
		}
	});

	it("los nombres que traía cada sesión sobreviven como alias", () => {
		for (const [id, aliases] of Object.entries(EXERCISE_REGISTRY)) {
			const def = library.byId.get(id);
			const known = new Set(
				[def?.name, ...(def?.aliases ?? []).map((a) => a.name)].map((name) =>
					normalizeName(String(name)),
				),
			);
			for (const alias of aliases) {
				expect(known.has(normalizeName(alias)), `${id}: ${alias}`).toBe(true);
			}
		}
	});
});

describe("la prescripción no se universaliza", () => {
	/**
	 * The point of splitting cues in two. A session-specific instruction —
	 * an accommodation for one ankle, a reminder that refers back to Monday —
	 * must not become a property of the movement.
	 */
	it("ningún cue de plantilla acaba en la biblioteca", () => {
		const libraryCues = new Set(
			library.all.flatMap((def) => def.cues.map(normalizeName)),
		);

		for (const { session, entry } of templateEntries) {
			for (const cue of entry.cues) {
				expect(
					libraryCues.has(normalizeName(cue)),
					`${session}/${entry.exerciseId}`,
				).toBe(false);
			}
		}
	});

	it("un cue de plantilla no aparece en las otras exposiciones del mismo ejercicio", () => {
		for (const { session, entry } of templateEntries) {
			if (entry.cues.length === 0) continue;

			const others = templateEntries.filter(
				(other) =>
					other.entry.exerciseId === entry.exerciseId &&
					other.session !== session,
			);

			for (const other of others) {
				const composed = composeExercise(other.entry, library).technique;
				for (const cue of entry.cues) {
					expect(
						composed,
						`${other.session}/${entry.exerciseId}`,
					).not.toContain(cue);
				}
			}
		}
	});

	it("las sustituciones permitidas son las de cada plantilla, no la unión", () => {
		const byExercise = new Map<string, Set<string>>();
		for (const { entry } of templateEntries) {
			const seen = byExercise.get(entry.exerciseId) ?? new Set<string>();
			seen.add(JSON.stringify(entry.allowedSubstitutions));
			byExercise.set(entry.exerciseId, seen);
		}

		// At least one movement is prescribed different alternatives in different
		// sessions; if the union had been applied, every set here would be size 1.
		const varied = [...byExercise.values()].filter((set) => set.size > 1);
		expect(varied.length).toBeGreaterThan(0);
	});

	it("el catálogo de la biblioteca contiene lo que permite cada plantilla", () => {
		for (const { session, entry } of templateEntries) {
			const def = library.byId.get(entry.exerciseId);
			const catalogue = new Set(
				(def?.substitutions ?? []).map((reference) =>
					JSON.stringify(reference),
				),
			);
			for (const allowed of entry.allowedSubstitutions) {
				expect(
					catalogue.has(JSON.stringify(allowed)),
					`${session}/${entry.exerciseId}`,
				).toBe(true);
			}
		}
	});
});

describe("punteros", () => {
	it("toda sustitución que apunta a un ejercicio apunta a uno que existe", () => {
		const references = [
			...library.all.flatMap((def) => def.substitutions),
			...templateEntries.flatMap(({ entry }) => entry.allowedSubstitutions),
		].filter((reference) => reference.kind === "exercise");

		for (const reference of references) {
			expect(library.byId.has(reference.exerciseId), reference.exerciseId).toBe(
				true,
			);
		}
	});
});

describe("articulaciones y seguridad", () => {
	/**
	 * `isAnkle` used to mean "is rehab" and "loads the ankle" at once — which is
	 * why the leg press carried it without being rehab. It is now derived from the
	 * joints, and this pins the derivation to the values the app had before.
	 */
	const ISANKLE_BEFORE: Record<string, boolean> = {
		bike_warmup: false,
		leg_press: true,
		leg_curl: false,
		seated_row: false,
		chest_press: false,
		lateral_raise: false,
		biceps_curl: false,
		cable_crunch: false,
		glute_kickback: false,
		lat_pulldown: false,
		shoulder_press: false,
		triceps_extension: false,
		hip_abduction: false,
		pallof_press: false,
	};

	it.each(
		templateEntries.map(({ session, entry }) => [session, entry] as const),
	)("%s conserva el isAnkle de cada ejercicio", (_session, entry) => {
		const expected = ISANKLE_BEFORE[entry.exerciseId];
		expect(expected, `sin valor previo para ${entry.exerciseId}`).toBeDefined();
		expect(composeExercise(entry, library).isAnkle).toBe(expected);
	});

	it("todo ejercicio declara sus articulaciones", () => {
		const untyped = library.all
			.filter((def) => def.pattern !== "cardio" && def.jointLoads.length === 0)
			.map((def) => def.id);
		// An exercise with no joints typed would never trip a future pain rule.
		expect(untyped).toEqual([]);
	});
});

describe("composición", () => {
	it.each(
		templateEntries.map(({ session, entry }) => [session, entry] as const),
	)("%s compone ejercicios válidos", (_session, entry) => {
		expect(() => Exercise.parse(composeExercise(entry, library))).not.toThrow();
	});

	it("la plantilla manda sobre el descanso por defecto de la biblioteca", () => {
		const def = library.all.find((entry) => entry.defaultRestSeconds !== null);
		if (!def) return;

		const entry = templateEntries.find(
			({ entry }) => entry.exerciseId === def.id,
		);
		if (!entry) return;

		const overridden = composeExercise(
			{ ...entry.entry, restSeconds: { min: 1, max: 1 } },
			library,
		);
		expect(overridden.restSeconds).toEqual({ min: 1, max: 1 });
	});

	it("falla ruidosamente si una plantilla nombra un ejercicio inexistente", () => {
		const [{ entry }] = templateEntries;
		expect(() =>
			composeExercise({ ...entry, exerciseId: "no_existe" }, library),
		).toThrow(/no está en la biblioteca/);
	});
});

describe("qué cuenta como volumen muscular", () => {
	it("sólo la resistencia aporta series por músculo", () => {
		for (const def of library.all) {
			expect(countsAsMuscularVolume(def), def.id).toBe(
				def.stimulusType === "resistance",
			);
		}
	});

	it("ningún ejercicio de balance o movilidad aporta series directas", () => {
		const contributing = library.all
			.filter(
				(def) =>
					(def.stimulusType === "balance" || def.stimulusType === "mobility") &&
					countsAsMuscularVolume(def),
			)
			.map((def) => def.id);
		expect(contributing).toEqual([]);
	});

	it("lo que aporta volumen dice de qué músculo", () => {
		const silent = library.all
			.filter(
				(def) => countsAsMuscularVolume(def) && def.primaryMuscles.length === 0,
			)
			.map((def) => def.id);
		expect(silent).toEqual([]);
	});

	it("lo que no aporta volumen sigue diciendo qué persigue", () => {
		const untyped = library.all
			.filter(
				(def) =>
					(def.stimulusType === "balance" || def.stimulusType === "mobility") &&
					def.functionalTargets.length === 0 &&
					def.secondaryMuscles.length === 0 &&
					def.pattern !== "mobility",
			)
			.map((def) => def.id);
		expect(untyped).toEqual([]);
	});
});
