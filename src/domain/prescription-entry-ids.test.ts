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

	/**
	 * El versionado era la frontera de E3 y es el contenido de E4, así que esta
	 * guarda se mueve en vez de borrarse: lo que ahora no puede existir es lo que
	 * queda por detrás de E4. Una guarda que se retira sin sustituta deja de
	 * proteger nada y nadie se entera.
	 */
	it("ni readiness, ni tendencias, ni auditoría muscular", () => {
		const found = ALL.flatMap(([path, source]) =>
			["readinessScore", "trendOf", "weeklyVolumeAudit", "muscleAudit"]
				.filter((name) => source.includes(name))
				.map((name) => `${short(path)}: ${name}`),
		);
		expect(found).toEqual([]);
	});

	/**
	 * Todo ajuste nace de algo que dijiste tú. Escriben en el log el ejecutor y la
	 * pantalla de plan —los dos con un motivo escrito a mano—, la migración, que
	 * traduce lo que el programa ya traía, y la reconciliación de herencia, que
	 * copia lo que declaraste con `inheritsFrom`. Ninguno propone nada: los cuatro
	 * escriben una decisión que ya existía en otra parte.
	 */
	it("sólo escriben ajustes los sitios donde tú decides", () => {
		const writers = ALL.filter(([, source]) =>
			source.includes("planAdjustments.insert"),
		).map(([path]) => short(path));

		expect(writers.sort()).toEqual([
			"lib/migrate-prescription.ts",
			"lib/reconcile-phases.ts",
			"routes/index.tsx",
			"routes/plan.tsx",
		]);
	});

	/**
	 * Y la herencia no es una excepción a G4: se limita a copiar la capa
	 * programática. Si alguna vez copiase `safety`, estaría afirmando por su cuenta
	 * un juicio clínico sobre una fase que nadie ha entrenado.
	 */
	it("la herencia copia sólo lo programático", () => {
		const source = readFileSync(
			join(SRC, "domain", "inherit-phase.ts"),
			"utf8",
		);
		expect(source).toContain('origin === "program"');
		for (const origin of ["safety", "manual", "review", "coach"]) {
			expect(source, origin).not.toContain(`origin === "${origin}"`);
		}
	});
});

// ------------------------------------------------------- deviation ≠ adjustment

describe("registrar lo que pasó no cambia el plan", () => {
	const executor = readFileSync(join(SRC, "routes", "index.tsx"), "utf8");
	const writes = readFileSync(join(SRC, "lib", "session-writes.ts"), "utf8");

	/**
	 * Criterio 9, dicho donde de verdad se cumple: las desviaciones de una sesión
	 * pasan todas por un módulo que sólo sabe escribir en `sessions`. No es que hoy
	 * no toquen el plan — es que desde ahí no se puede.
	 */
	it("las desviaciones viven en un módulo que no conoce el plan", () => {
		for (const collection of [
			"planAdjustments",
			"prescriptionBaseline",
			"planSnapshots",
		]) {
			expect(writes, collection).not.toContain(collection);
		}
		expect(writes).toContain("collections.sessions.update");
	});

	it("saltar y añadir pasan por ahí", () => {
		const skip = between(
			executor,
			"async function skip(",
			"async function restore",
		);
		const add = between(
			executor,
			"async function addCustomExercise",
			"async function addFinisher",
		);

		expect(skip).toContain("skipExercise(collections");
		expect(add).toContain("addToSession(collections");
	});

	/** Guardar una serie escribe en `sets` y en nada más. */
	it("guardar una serie no toca el plan", () => {
		const saveSet = between(
			executor,
			"async function saveSet",
			"async function savePlanChange",
		);
		expect(saveSet).not.toContain("planAdjustments");
		expect(saveSet).not.toContain("prescriptionBaseline");
	});

	/** Y al revés: cambiar el plan no escribe nada en la sesión de hoy. */
	it("cambiar el plan no toca la sesión", () => {
		const change = between(
			executor,
			"async function savePlanChange",
			"async function skip(",
		);
		expect(change).toContain("planAdjustments.insert");
		expect(change).not.toContain("collections.sessions");
		expect(change).not.toContain("collections.sets");
	});
});

/** The body between two markers, so a rename fails loudly instead of silently. */
function between(source: string, from: string, to: string): string {
	const start = source.indexOf(from);
	const end = source.indexOf(to);
	if (start === -1) throw new Error(`no está «${from}» en el ejecutor`);
	if (end === -1) throw new Error(`no está «${to}» en el ejecutor`);
	return source.slice(start, end);
}
