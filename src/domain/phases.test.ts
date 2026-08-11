import { describe, expect, it } from "vitest";
import { PHASE_EVENTS } from "./__fixtures__/log";
import { PROGRAM } from "./__fixtures__/program";
import {
	phaseForDate,
	resolveSetCount,
	targetRir,
	weeksUntilCheckpoint,
} from "./phases";

describe("phaseForDate", () => {
	it.each([
		["2026-08-10", "adaptacion", "Adaptación"],
		["2026-08-23", "adaptacion", "Adaptación"],
		["2026-08-24", "progresion", "Construcción"],
		["2026-10-04", "progresion", "Construcción"],
		["2026-10-05", "recomposicion", "Recomposición"],
		["2026-11-15", "recomposicion", "Recomposición"],
		["2026-11-16", "definicion_tesis", "Operación Cuadritos"],
		["2026-12-20", "definicion_tesis", "Operación Cuadritos"],
	])("%s falls in phase %s", (date, id, name) => {
		const phase = phaseForDate(PROGRAM, PHASE_EVENTS, date);
		expect(phase.id).toBe(id);
		expect(phase.name).toBe(name);
	});

	it("reads the baseline session, two days before phase 1, as phase 1", () => {
		expect(phaseForDate(PROGRAM, PHASE_EVENTS, "2026-08-08").id).toBe(
			"adaptacion",
		);
	});

	it("keeps the last phase open past the checkpoint", () => {
		expect(phaseForDate(PROGRAM, PHASE_EVENTS, "2027-03-01").id).toBe(
			"definicion_tesis",
		);
	});
});

/*
 * `targetSets` y `exercisesForPhase` vivían aquí y se han ido con `slotOf`: una
 * fase ya no indexa una columna de la hoja. La equivalencia exhaustiva entre lo
 * que daban y lo que da ahora el plan resuelto está en
 * `lib/migrate-prescription.test.ts`, que es donde tiene sentido comprobarla.
 */

describe("resolveSetCount", () => {
	it("normalises fixed counts, ranges and absence", () => {
		expect(resolveSetCount(3)).toEqual({ min: 3, max: 3 });
		expect(resolveSetCount([2, 3])).toEqual({ min: 2, max: 3 });
		expect(resolveSetCount(null)).toBeNull();
	});
});

describe("targetRir", () => {
	it("tightens as the program advances", () => {
		expect(targetRir(PROGRAM.phases[0])).toEqual({ min: 2, max: 3 });
		expect(targetRir(PROGRAM.phases[1])).toEqual({ min: 2, max: 2 });
		expect(targetRir(PROGRAM.phases[2])).toEqual({ min: 1, max: 2 });
	});
});

describe("weeksUntilCheckpoint", () => {
	it("counts whole weeks to the defence checkpoint", () => {
		expect(weeksUntilCheckpoint(PROGRAM, "2026-12-13")).toBe(1);
		expect(weeksUntilCheckpoint(PROGRAM, "2026-08-10")).toBe(18);
	});

	it("never goes negative once the checkpoint has passed", () => {
		expect(weeksUntilCheckpoint(PROGRAM, "2027-01-15")).toBe(0);
	});
});
