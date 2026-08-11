/**
 * Integrity of the phase log.
 *
 * `phaseForDate` answers no matter what; complaining is this module's job. A
 * broken chain is the kind of damage nobody notices for months and then finds by
 * staring at a graph that looks slightly off — cheaper to check.
 */

import { describe, expect, it } from "vitest";
import { PHASE_EVENTS } from "./__fixtures__/log";
import { PROGRAM } from "./__fixtures__/program";
import { validateEvents } from "./phase-events-validate";
import type { Phase, PhaseEvent, Program } from "./schema";

const codes = (program: Program, events: readonly PhaseEvent[]) =>
	validateEvents(program, events).map((problem) => problem.code);

function move(
	id: string,
	from: string | null,
	to: string,
	on: string,
): PhaseEvent {
	return {
		kind: "transition",
		id,
		fromPhaseId: from,
		toPhaseId: to,
		occurredOn: on,
		plannedFor: null,
		trigger: "manual",
		reason: "",
		reviewId: null,
		createdAt: Date.parse(`${on}T12:00:00Z`),
	};
}

/** The program with one phase replaced, for the phase-shape checks. */
function withPhase(patch: Partial<Phase>): Program {
	return {
		...PROGRAM,
		phases: [{ ...PROGRAM.phases[0], ...patch }, ...PROGRAM.phases.slice(1)],
	};
}

describe("un log sano no tiene nada que decir", () => {
	it("acepta las transiciones sembradas por la migración", () => {
		expect(validateEvents(PROGRAM, PHASE_EVENTS)).toEqual([]);
	});

	it("acepta un log vacío", () => {
		expect(validateEvents(PROGRAM, [])).toEqual([]);
	});
});

describe("continuidad de la cadena", () => {
	it("detecta un salto: se sale de una fase en la que no se estaba", () => {
		const events = [
			move("a", null, "adaptacion", "2026-08-10"),
			move("b", "recomposicion", "progresion", "2026-08-24"),
		];
		expect(codes(PROGRAM, events)).toContain("broken-chain");
	});

	it("exige que la primera transición venga de ninguna parte", () => {
		expect(
			codes(PROGRAM, [move("a", "adaptacion", "progresion", "2026-08-24")]),
		).toContain("no-initial");
	});

	it("detecta dos transiciones iniciales", () => {
		const events = [
			move("a", null, "adaptacion", "2026-08-10"),
			move("b", null, "progresion", "2026-08-24"),
		];
		expect(codes(PROGRAM, events)).toContain("multiple-initial");
	});

	it("detecta una transición hacia la fase en la que ya se estaba", () => {
		const events = [
			move("a", null, "adaptacion", "2026-08-10"),
			move("b", "adaptacion", "adaptacion", "2026-08-24"),
		];
		expect(codes(PROGRAM, events)).toContain("self-transition");
	});

	it("detecta un destino que no existe", () => {
		const events = [move("a", null, "fase_fantasma", "2026-08-10")];
		expect(codes(PROGRAM, events)).toContain("unknown-phase");
	});
});

describe("anulaciones", () => {
	it("reporta un ciclo", () => {
		const events: PhaseEvent[] = [
			{
				kind: "correction",
				id: "x",
				supersedesId: "y",
				fromPhaseId: null,
				toPhaseId: "adaptacion",
				occurredOn: "2026-08-10",
				plannedFor: null,
				trigger: "review",
				reason: "",
				reviewId: null,
				createdAt: 1,
			},
			{
				kind: "correction",
				id: "y",
				supersedesId: "x",
				fromPhaseId: null,
				toPhaseId: "progresion",
				occurredOn: "2026-08-11",
				plannedFor: null,
				trigger: "review",
				reason: "",
				reviewId: null,
				createdAt: 2,
			},
		];
		expect(codes(PROGRAM, events)).toContain("annulment-cycle");
	});

	it("reporta dos anulaciones vivas del mismo objetivo", () => {
		const events: PhaseEvent[] = [
			move("a", null, "adaptacion", "2026-08-10"),
			{
				kind: "revocation",
				id: "r1",
				revokesId: "a",
				reason: "",
				createdAt: 2,
			},
			{
				kind: "revocation",
				id: "r2",
				revokesId: "a",
				reason: "",
				createdAt: 3,
			},
		];
		expect(codes(PROGRAM, events)).toContain("double-annulment");
	});
});

describe("forma de las fases", () => {
	it("detecta dos fases con el mismo orden", () => {
		expect(codes(withPhase({ order: 2 }), [])).toContain("duplicate-order");
	});

	it("detecta dos fases con el mismo legacyId", () => {
		expect(codes(withPhase({ legacyId: 2 }), [])).toContain(
			"duplicate-legacy-id",
		);
	});

	it("detecta una herencia hacia una fase inexistente", () => {
		expect(codes(withPhase({ inheritsFrom: "no_existe" }), [])).toContain(
			"unknown-inherits",
		);
	});

	/**
	 * `slotOf` sigue `inheritsFrom` recursivamente, así que un ciclo sin detectar
	 * se manifestaría como un desbordamiento de pila al abrir la app.
	 */
	it("detecta un ciclo de herencia", () => {
		const program: Program = {
			...PROGRAM,
			phases: [
				{ ...PROGRAM.phases[0], inheritsFrom: "progresion" },
				{ ...PROGRAM.phases[1], inheritsFrom: "adaptacion" },
				...PROGRAM.phases.slice(2),
			],
		};
		expect(codes(program, [])).toContain("inherits-cycle");
	});

	it("detecta una fase anclada sin fecha", () => {
		expect(
			codes(withPhase({ schedulePolicy: "anchored", plannedStart: null }), []),
		).toContain("anchored-without-date");
	});

	it("no se queja de una fase anclada que sí tiene fecha", () => {
		expect(
			codes(
				withPhase({ schedulePolicy: "anchored", plannedStart: "2026-08-10" }),
				[],
			),
		).not.toContain("anchored-without-date");
	});
});
