/**
 * Phase identity, held to the same rule as exercise identity.
 *
 * The moment a phase id lands on a session or an event it is a key into the log.
 * Renaming it orphans history; reusing it fuses two stretches of training into
 * one, which is worse than losing them because nothing shows the seam; deleting
 * it leaves sessions pointing at nothing.
 *
 * The visible name is free to change, and that is the point of separating them.
 *
 * The content is read from `content/` when it is there and the public example
 * otherwise, so on this machine these check the real program.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { PHASE_EVENTS } from "./__fixtures__/log";
import { KNOWN_PHASE_IDS, PHASE_ID_PATTERN } from "./__fixtures__/phase-ids";
import { PROGRAM } from "./__fixtures__/program";
import { phaseForDate, projectPhases } from "./phase-events";
import { validateEvents } from "./phase-events-validate";
import { slotOf } from "./phases";
import { type PhaseEvent, type Program, ProgramFile } from "./schema";

const ROOT = join(import.meta.dirname, "..", "..");
const DIR = existsSync(join(ROOT, "content", "program.yaml"))
	? join(ROOT, "content")
	: join(ROOT, "content.example");

const program = ProgramFile.parse(
	parse(readFileSync(join(DIR, "program.yaml"), "utf8")),
);
const ids = program.phases.map((phase) => phase.id);

describe("los ids de fase no se mueven", () => {
	/**
	 * The one that catches a rename made before there is any stored data to expose
	 * it — which is exactly when a rename looks harmless.
	 */
	it("el programa conserva todos los ids que han existido alguna vez", () => {
		const missing = KNOWN_PHASE_IDS.filter((id) => !ids.includes(id));
		expect(missing).toEqual([]);
	});

	it("la lista congelada no se queda corta: todo id del programa está en ella", () => {
		const unknown = ids.filter((id) => !KNOWN_PHASE_IDS.includes(id));
		expect(unknown, "añádelos a __fixtures__/phase-ids.ts").toEqual([]);
	});

	it("ninguno se repite", () => {
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe("forma del id", () => {
	it.each(ids)("«%s» no puede confundirse con un nombre visible", (id) => {
		expect(PHASE_ID_PATTERN.test(id)).toBe(true);
	});

	it("los ids congelados también cumplen la forma", () => {
		for (const id of KNOWN_PHASE_IDS) {
			expect(PHASE_ID_PATTERN.test(id), id).toBe(true);
		}
	});
});

describe("cada fase sabe de dónde saca su prescripción", () => {
	it("o lleva legacyId, o dice de quién hereda", () => {
		for (const phase of program.phases) {
			expect(
				phase.legacyId !== null || phase.inheritsFrom !== null,
				`${phase.id} no tiene ni legacyId ni inheritsFrom`,
			).toBe(true);
		}
	});

	it("los legacyId cubren del 1 al 4, sin repetirse", () => {
		const legacy = program.phases
			.map((phase) => phase.legacyId)
			.filter((id) => id !== null);
		expect([...legacy].sort()).toEqual([1, 2, 3, 4]);
	});

	it("el orden es único", () => {
		const orders = program.phases.map((phase) => phase.order);
		expect(new Set(orders).size).toBe(orders.length);
	});
});

describe("una fase nueva se crea desde datos, sin tocar código", () => {
	/**
	 * The España case, in the abstract: a fifth phase, anchored to a date that
	 * comes from outside the training, inheriting its prescription from the phase
	 * before it. Nothing here is a code change — it is a row in the YAML plus one
	 * event in the database.
	 */
	const extended: Program = {
		...PROGRAM,
		phases: [
			...PROGRAM.phases,
			{
				...PROGRAM.phases[3],
				id: "fase_viaje",
				name: "Preparación viaje",
				order: 5,
				plannedStart: "2027-01-05",
				plannedEnd: null,
				schedulePolicy: "anchored",
				legacyId: null,
				inheritsFrom: "definicion_tesis",
				retired: false,
			},
		],
	};

	const entering: PhaseEvent = {
		kind: "transition",
		id: "into-viaje",
		fromPhaseId: "definicion_tesis",
		toPhaseId: "fase_viaje",
		occurredOn: "2027-01-05",
		plannedFor: "2027-01-05",
		trigger: "planned",
		reason: "",
		reviewId: null,
		createdAt: Date.parse("2027-01-05T12:00:00Z"),
	};

	const events = [...PHASE_EVENTS, entering];

	it("el programa la valida sin quejas", () => {
		expect(validateEvents(extended, events)).toEqual([]);
	});

	it("se resuelve como cualquier otra", () => {
		expect(phaseForDate(extended, events, "2027-02-01").id).toBe("fase_viaje");
		// Y antes de entrar, sigue mandando la anterior.
		expect(phaseForDate(extended, events, "2026-12-20").id).toBe(
			"definicion_tesis",
		);
	});

	it("hereda la prescripción de la fase de la que dice heredar", () => {
		const viaje = extended.phases[4];
		expect(slotOf(extended, viaje)).toBe(slotOf(extended, extended.phases[3]));
	});

	it("al estar anclada, no se mueve si lo anterior se alarga", () => {
		const late = [
			...PHASE_EVENTS.slice(0, 3),
			{
				...PHASE_EVENTS[3],
				occurredOn: "2026-12-20",
			} as PhaseEvent,
		];
		const projection = projectPhases(extended, late, "2026-12-25");
		const viaje = projection.phases.find((p) => p.phaseId === "fase_viaje");
		expect(viaje?.start).toBe("2027-01-05");
	});
});
