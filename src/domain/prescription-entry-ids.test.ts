/**
 * Slot identity, and the four things E3 promised not to become.
 *
 * The first half holds slot ids to the same rule as exercise ids in E1 and phase
 * ids in E2: once the log points at one it cannot be renamed, reused or derived
 * from a display name.
 *
 * The second half is structural — it reads the source rather than calling it —
 * because the things being guarded are absences. "There is no engine" and "the
 * bridge did not come back" are not properties any return value can show.
 *
 * The content is read from `content/` when it is there and the public example
 * otherwise, so on this machine these check the real program.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { composeProgram, indexLibrary } from "@/domain/library";
import { buildBaseline } from "@/lib/migrate-prescription";
import {
	KNOWN_ENTRY_IDS,
	SEEDED_ENTRY_ID_PATTERN,
} from "./__fixtures__/prescription-entry-ids";
import { ExerciseLibrary, ProgramFile } from "./schema";

const SRC = join(import.meta.dirname, "..");
const ROOT = join(SRC, "..");

function load(dir: string) {
	return composeProgram(
		ProgramFile.parse(parse(readFileSync(join(dir, "program.yaml"), "utf8"))),
		indexLibrary(
			ExerciseLibrary.parse(
				parse(readFileSync(join(dir, "library.yaml"), "utf8")),
			),
		),
	);
}

/**
 * The census is frozen against the **example**, on purpose. The real `content/`
 * is gitignored, and a committed list of its slot ids would publish how many
 * exercises each session has — which is the shape of her programme, in a public
 * repo. The rules below are checked against the real content when it is there;
 * only the list is kept to the example.
 */
const example = load(join(ROOT, "content.example"));
const seeded = buildBaseline(example, 0).map((row) => row.id);

const program = existsSync(join(ROOT, "content", "program.yaml"))
	? load(join(ROOT, "content"))
	: example;
const real = buildBaseline(program, 0);

/** Application sources, without tests. */
function sources(dir: string): Array<[string, string]> {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sources(path);
		if (!/\.tsx?$/.test(name) || name.includes(".test.")) return [];
		return [[path, readFileSync(path, "utf8")] as [string, string]];
	});
}

const ALL = sources(SRC);
const short = (path: string) => path.slice(SRC.length + 1);

// ------------------------------------------------------------------ identity

describe("los ids de hueco no se mueven", () => {
	it("el programa conserva todos los que han existido", () => {
		const missing = KNOWN_ENTRY_IDS.filter((id) => !seeded.includes(id));
		expect(missing).toEqual([]);
	});

	it("la lista congelada no se queda corta", () => {
		const unknown = seeded.filter((id) => !KNOWN_ENTRY_IDS.includes(id));
		expect(
			unknown,
			"añádelos a __fixtures__/prescription-entry-ids.ts",
		).toEqual([]);
	});

	it("ninguno se repite", () => {
		expect(new Set(seeded).size).toBe(seeded.length);
	});

	it("todos tienen la forma congelada", () => {
		const wrong = real
			.map((row) => row.id)
			.filter((id) => !SEEDED_ENTRY_ID_PATTERN.test(id));
		expect(wrong).toEqual([]);
	});

	it("y en el programa de verdad tampoco se repiten", () => {
		const ids = real.map((row) => row.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	/**
	 * Lo que hace que el hueco sobreviva a cambiar de ejercicio: su id no lo
	 * menciona. Si lo mencionara, sustituir la prensa por una hack squat dejaría
	 * un id que miente o rompería el historial.
	 */
	it("ninguno menciona a su ocupante", () => {
		for (const row of real) {
			expect(row.id).not.toContain(row.exerciseId);
		}
	});
});

// ---------------------------------------------------------------- the bridge

describe("el puente de E2 no ha vuelto", () => {
	it("`slotOf` no existe en ninguna parte", () => {
		const found = ALL.filter(([, source]) => /\bslotOf\b/.test(source)).map(
			([path]) => short(path),
		);
		expect(found).toEqual([]);
	});

	/**
	 * `setsByPhase` sigue existiendo: es lo que dice el contenido en disco, y la
	 * migración es su último lector. Lo que no puede es volver a decidir nada en
	 * tiempo de ejecución.
	 */
	it("nada en tiempo de ejecución lee `setsByPhase`", () => {
		const allowed = [
			"lib/migrate-prescription.ts",
			// Compone el contenido: lo copia de la plantilla, no lo interpreta.
			"domain/library.ts",
			// Lo declara.
			"domain/schema.ts",
			// Construyen un ejercicio sintético; el campo va a `Exercise` y ahí muere.
			"domain/cardio-day.ts",
			"domain/personalise.ts",
			"routes/history.tsx",
			// Datos de prueba.
			"domain/__fixtures__/program.ts",
		];
		const readers = ALL.filter(([, source]) => source.includes("setsByPhase"))
			.map(([path]) => short(path))
			.filter((path) => !allowed.includes(path));

		expect(readers).toEqual([]);
	});
});

// -------------------------------------------------------------------- G4

describe("G4 · E3 no trae motor", () => {
	const ENGINE = [
		"decideAdaptation",
		"suggestAdjustment",
		"proposeAdjustment",
		"detectStagnation",
		"trendOf",
		"autoAdjust",
	];

	it("no hay nada que proponga cambios de plan por su cuenta", () => {
		const found = ALL.flatMap(([path, source]) =>
			ENGINE.filter((name) => source.includes(name)).map(
				(name) => `${short(path)}: ${name}`,
			),
		);
		expect(found).toEqual([]);
	});

	/** Criterio 12b: E3 tampoco trae versionado. Eso es E4. */
	it("ni versiones ni diff entre planes", () => {
		const found = ALL.flatMap(([path, source]) =>
			["ProgramVersion", "diffVersions", "planDiff"]
				.filter((name) => source.includes(name))
				.map((name) => `${short(path)}: ${name}`),
		);
		expect(found).toEqual([]);
	});

	/**
	 * Todo ajuste nace de una acción tuya. El único sitio que escribe en el log es
	 * la pantalla de plan y la hoja de ajustes, las dos con un motivo escrito a
	 * mano — y la migración, que es de una vez.
	 */
	it("sólo escriben ajustes los sitios donde tú decides", () => {
		const writers = ALL.filter(([, source]) =>
			source.includes("planAdjustments.insert"),
		).map(([path]) => short(path));

		expect(writers.sort()).toEqual([
			"lib/migrate-prescription.ts",
			"routes/index.tsx",
			"routes/plan.tsx",
		]);
	});
});

// ------------------------------------------------------- deviation ≠ adjustment

describe("registrar lo que pasó no cambia el plan", () => {
	const executor = readFileSync(join(SRC, "routes", "index.tsx"), "utf8");

	/** Criterio 9. Guardar una serie escribe en `sets` y en nada más. */
	it("guardar una serie no toca el plan", () => {
		const saveSet = executor.slice(
			executor.indexOf("async function saveSet"),
			executor.indexOf("async function savePlanChange"),
		);
		expect(saveSet).not.toContain("planAdjustments");
		expect(saveSet).not.toContain("prescriptionBaseline");
	});

	it("saltar un ejercicio tampoco: queda en la sesión", () => {
		const skip = executor.slice(
			executor.indexOf("async function skipExercise"),
			executor.indexOf("function restoreExercise"),
		);
		expect(skip).toContain("skippedExerciseIds");
		expect(skip).not.toContain("planAdjustments");
	});

	it("ni añadir un ejercicio suelto", () => {
		const add = executor.slice(
			executor.indexOf("async function addCustomExercise"),
			executor.indexOf("async function addFinisher"),
		);
		expect(add).toContain("extraExerciseIds");
		expect(add).not.toContain("planAdjustments");
	});

	/** Y al revés: cambiar el plan no escribe nada en la sesión de hoy. */
	it("cambiar el plan no toca la sesión", () => {
		const change = executor.slice(
			executor.indexOf("async function savePlanChange"),
			executor.indexOf("async function skipExercise"),
		);
		expect(change).toContain("planAdjustments.insert");
		expect(change).not.toContain("collections.sessions");
		expect(change).not.toContain("collections.sets");
	});
});
