/**
 * Bounding the phase log, and the order that makes it mean anything.
 *
 * E3 bounded the adjustments and left this written down as E4's job: *"bounding
 * the phase is half of reproducibility, and half a guarantee written into a
 * signature reads like a whole one."*
 *
 * The test that carries the weight is the one about order. Filtering after
 * computing liveness passes every other test in this file and fails that one —
 * which is the point, because the naive implementation is the tempting one.
 */

import { describe, expect, it } from "vitest";
import { PROGRAM } from "./__fixtures__/program";
import { liveEvents, phaseForDate, phaseStartedOn } from "./phase-events";
import type { PhaseEvent } from "./schema";

const move = (
	id: string,
	toPhaseId: string,
	occurredOn: string,
	createdAt = 0,
): PhaseEvent => ({
	kind: "transition",
	id,
	fromPhaseId: null,
	toPhaseId,
	occurredOn,
	plannedFor: occurredOn,
	trigger: "planned",
	reason: "",
	reviewId: null,
	createdAt,
});

const corrects = (
	id: string,
	supersedesId: string,
	toPhaseId: string,
	occurredOn: string,
	createdAt = 1,
): PhaseEvent => ({
	kind: "correction",
	id,
	supersedesId,
	fromPhaseId: null,
	toPhaseId,
	occurredOn,
	plannedFor: occurredOn,
	trigger: "planned",
	reason: "",
	reviewId: null,
	createdAt,
});

const revokes = (id: string, revokesId: string, createdAt = 2): PhaseEvent => ({
	kind: "revocation",
	id,
	revokesId,
	reason: "no ocurrió",
	createdAt,
});

const cut = (...ids: string[]) => ({ phaseEventIds: ids });

// ------------------------------------------------------- E2, sin tocar

describe("sin corte, todo se comporta como en E2", () => {
	const events = [
		move("E1", "adaptacion", "2026-08-10"),
		move("E2", "progresion", "2026-09-15"),
	];

	it("phaseForDate sigue resolviendo igual", () => {
		expect(phaseForDate(PROGRAM, events, "2026-08-20").id).toBe("adaptacion");
		expect(phaseForDate(PROGRAM, events, "2026-10-01").id).toBe("progresion");
	});

	it("y pasar `null` explícito es lo mismo que no pasar nada", () => {
		expect(phaseForDate(PROGRAM, events, "2026-10-01", null).id).toBe(
			phaseForDate(PROGRAM, events, "2026-10-01").id,
		);
	});

	it("liveEvents sin corte devuelve lo de siempre", () => {
		expect(
			liveEvents(events)
				.map((e) => e.id)
				.sort(),
		).toEqual(["E1", "E2"]);
	});
});

// ---------------------------------------------------------------- el corte

describe("con corte", () => {
	const events = [
		move("E1", "adaptacion", "2026-08-10"),
		move("E2", "progresion", "2026-09-15"),
	];

	it("un evento fuera del corte no existe para la consulta", () => {
		expect(phaseForDate(PROGRAM, events, "2026-10-01", cut("E1")).id).toBe(
			"adaptacion",
		);
	});

	it("y dentro sí", () => {
		expect(
			phaseForDate(PROGRAM, events, "2026-10-01", cut("E1", "E2")).id,
		).toBe("progresion");
	});

	it("un corte vacío cae en la primera fase, sin lanzar", () => {
		expect(phaseForDate(PROGRAM, events, "2026-10-01", cut()).id).toBe(
			"adaptacion",
		);
	});

	it("un corte que nombra ids que no están no inventa nada", () => {
		expect(
			phaseForDate(PROGRAM, events, "2026-10-01", cut("E1", "no_existe")).id,
		).toBe("adaptacion");
	});

	it("phaseStartedOn también lo respeta", () => {
		expect(phaseStartedOn(PROGRAM, events, "2026-10-01", cut("E1"))).toBe(
			"2026-08-10",
		);
		expect(phaseStartedOn(PROGRAM, events, "2026-10-01", cut("E1", "E2"))).toBe(
			"2026-09-15",
		);
	});
});

// -------------------------------------------------------------- el orden

describe("acotar precede a decidir", () => {
	/**
	 * La prueba que separa la implementación correcta de la tentadora. Con el
	 * filtro después de calcular la vigencia, `E4` habría anulado a `E3` antes de
	 * que nadie mirase el corte, y la versión resolvería sin la transición que sí
	 * conocía.
	 */
	it("una corrección fuera del corte no anula un evento de dentro", () => {
		const events = [
			move("E1", "adaptacion", "2026-08-10"),
			move("E3", "progresion", "2026-09-15"),
			corrects("E4", "E3", "progresion", "2026-09-22"),
		];

		// Hoy, sin corte: manda la fecha corregida.
		expect(phaseStartedOn(PROGRAM, events, "2026-12-01")).toBe("2026-09-22");

		// La versión que no conocía E4 sigue viendo la del 15.
		expect(phaseStartedOn(PROGRAM, events, "2026-12-01", cut("E1", "E3"))).toBe(
			"2026-09-15",
		);
	});

	it("una revocación fuera del corte no mata un evento de dentro", () => {
		const events = [
			move("E1", "adaptacion", "2026-08-10"),
			move("E2", "progresion", "2026-09-15"),
			revokes("E5", "E2"),
		];

		expect(phaseForDate(PROGRAM, events, "2026-10-01").id).toBe("adaptacion");
		expect(
			phaseForDate(PROGRAM, events, "2026-10-01", cut("E1", "E2")).id,
		).toBe("progresion");
	});

	it("y una que sí está en el corte sigue matando", () => {
		const events = [
			move("E1", "adaptacion", "2026-08-10"),
			move("E2", "progresion", "2026-09-15"),
			revokes("E5", "E2"),
		];
		expect(
			phaseForDate(PROGRAM, events, "2026-10-01", cut("E1", "E2", "E5")).id,
		).toBe("adaptacion");
	});

	/** Una cadena entera dentro del corte se comporta como la pila de deshacer. */
	it("la cadena se resuelve dentro del universo, no fuera", () => {
		const events = [
			move("E1", "adaptacion", "2026-08-10"),
			move("E2", "progresion", "2026-09-15"),
			corrects("E3", "E2", "recomposicion", "2026-09-20"),
			revokes("E4", "E3"),
		];

		// Todo: E4 revoca E3, así que E2 vuelve.
		expect(phaseForDate(PROGRAM, events, "2026-12-01").id).toBe("progresion");
		// Sin E4: manda la corrección.
		expect(
			phaseForDate(PROGRAM, events, "2026-12-01", cut("E1", "E2", "E3")).id,
		).toBe("recomposicion");
		// Sin E3 ni E4: manda la original.
		expect(
			phaseForDate(PROGRAM, events, "2026-12-01", cut("E1", "E2")).id,
		).toBe("progresion");
	});

	it("un ciclo dentro del corte sigue muriendo entero", () => {
		const events = [
			move("E1", "adaptacion", "2026-08-10"),
			corrects("E2", "E3", "progresion", "2026-09-15"),
			corrects("E3", "E2", "recomposicion", "2026-09-16"),
		];
		expect(liveEvents(events, cut("E1", "E2", "E3")).map((e) => e.id)).toEqual([
			"E1",
		]);
	});
});
