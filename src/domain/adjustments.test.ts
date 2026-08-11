/**
 * The two axes.
 *
 * Most of this file is the worked example from the specification, because that
 * table is the semantics: the same date answering differently depending on what
 * knowledge you cite, and both answers being right.
 *
 * The rest guards the two things that could quietly go wrong: a revocation
 * reaching backwards into dates where the adjustment genuinely held, and a clock
 * getting a vote it should not have.
 */

import { describe, expect, it } from "vitest";
import {
	byPrecedence,
	inForce,
	ordered,
	validateAdjustments,
} from "./adjustments";
import type { PlanAdjustment } from "./schema";

const PHASE = () => "progresion";
const live = (effectiveOn: string) => ({ effectiveOn, knows: null });

function setSets(
	id: string,
	value: number,
	effectiveOn: string,
	extra: Partial<Extract<PlanAdjustment, { kind: "set_field" }>> = {},
): PlanAdjustment {
	return {
		kind: "set_field",
		id,
		entryId: "slot_a_01",
		change: { field: "sets", value },
		effectiveOn,
		onlyInPhase: null,
		origin: "manual",
		reason: "prueba",
		evidenceIds: [],
		provenance: { kind: "authored" },
		createdAt: 0,
		...extra,
	};
}

function revoke(
	id: string,
	revokesId: string,
	effectiveOn: string,
	createdAt = 0,
): PlanAdjustment {
	return {
		kind: "revoke",
		id,
		revokesId,
		effectiveOn,
		onlyInPhase: null,
		origin: "manual",
		reason: "prueba",
		evidenceIds: [],
		provenance: { kind: "authored" },
		createdAt,
	};
}

const idsOf = (adjustments: readonly PlanAdjustment[]) =>
	adjustments.map((entry) => entry.id).sort();

// ------------------------------------------------------------ the worked example

describe("el ejemplo de la especificación", () => {
	// Base: 2 series.
	const A1 = setSets("A1", 3, "2026-10-05", { createdAt: 1 });
	const R1 = revoke("R1", "A1", "2026-11-01", 2);
	const A2 = setSets("A2", 2, "2026-11-01", { createdAt: 3 });
	/** Escrita el 1 de diciembre, con efecto retroactivo al 20 de octubre. */
	const R2 = revoke("R2", "A1", "2026-10-20", 4);

	const all = [A1, R1, A2, R2];
	const beforeR2 = { adjustmentIds: ["A1", "R1", "A2"] };

	it("1 oct · en vivo → A1 aún no había entrado en vigor", () => {
		expect(idsOf(inForce(all, live("2026-10-01"), PHASE))).toEqual([]);
	});

	it("10 oct · en vivo → A1 vigente; ninguna revocación alcanza esa fecha", () => {
		expect(idsOf(inForce(all, live("2026-10-10"), PHASE))).toEqual(["A1"]);
	});

	it("10 oct · corte {A1} → el corte sólo contenía A1", () => {
		const asOf = {
			effectiveOn: "2026-10-10",
			knows: { adjustmentIds: ["A1"] },
		};
		expect(idsOf(inForce(all, asOf, PHASE))).toEqual(["A1"]);
	});

	/** Las dos filas que son el punto entero. */
	it("25 oct · corte sin R2 → sigue vigente A1", () => {
		const asOf = { effectiveOn: "2026-10-25", knows: beforeR2 };
		expect(idsOf(inForce(all, asOf, PHASE))).toEqual(["A1"]);
	});

	it("25 oct · en vivo → R2 existe y su efecto empieza el 20 oct", () => {
		expect(idsOf(inForce(all, live("2026-10-25"), PHASE))).toEqual([]);
	});

	it("15 nov · en vivo → manda A2", () => {
		expect(idsOf(inForce(all, live("2026-11-15"), PHASE))).toEqual(["A2"]);
	});
});

// ----------------------------------------------------------------- revocation

describe("una revocación sólo mira hacia delante", () => {
	const A = setSets("A", 3, "2026-10-01");
	const R = revoke("R", "A", "2026-11-01");

	it("no borra el ajuste de las fechas en las que sí estuvo vigente", () => {
		expect(idsOf(inForce([A, R], live("2026-10-15"), PHASE))).toEqual(["A"]);
	});

	it("sí lo retira desde su propia fecha de efecto", () => {
		expect(idsOf(inForce([A, R], live("2026-11-02"), PHASE))).toEqual([]);
	});

	it("y justo en la fecha de efecto ya no aplica", () => {
		expect(idsOf(inForce([A, R], live("2026-11-01"), PHASE))).toEqual([]);
	});
});

// ---------------------------------------------------------------- phase gate

describe("onlyInPhase y la fecha son dos compuertas", () => {
	const inPhase = setSets("P", 3, "2026-10-15", {
		onlyInPhase: "recomposicion",
	});

	it("no aplica antes de su fecha de efecto, aunque estés en la fase", () => {
		const asOf = { effectiveOn: "2026-10-10", knows: null };
		expect(idsOf(inForce([inPhase], asOf, () => "recomposicion"))).toEqual([]);
	});

	it("no aplica fuera de su fase, aunque la fecha haya pasado", () => {
		const asOf = { effectiveOn: "2026-11-01", knows: null };
		expect(idsOf(inForce([inPhase], asOf, () => "progresion"))).toEqual([]);
	});

	it("aplica cuando se cumplen las dos", () => {
		const asOf = { effectiveOn: "2026-11-01", knows: null };
		expect(idsOf(inForce([inPhase], asOf, () => "recomposicion"))).toEqual([
			"P",
		]);
	});

	/**
	 * Los del programa llevan la fecha de inicio del programa, así que la fase es
	 * la única compuerta — y entran tarde o pronto, según se entre de verdad.
	 */
	describe("un ajuste del programa sigue la entrada real", () => {
		const fromProgram = setSets("PG", 3, "2026-08-08", {
			onlyInPhase: "recomposicion",
			origin: "program",
		});

		it("entrando tarde en la fase", () => {
			const asOf = { effectiveOn: "2026-10-20", knows: null };
			expect(
				idsOf(inForce([fromProgram], asOf, () => "recomposicion")),
			).toEqual(["PG"]);
		});

		it("y entrando pronto — el caso que plannedStart habría roto", () => {
			const asOf = { effectiveOn: "2026-09-15", knows: null };
			expect(
				idsOf(inForce([fromProgram], asOf, () => "recomposicion")),
			).toEqual(["PG"]);
		});
	});
});

// ------------------------------------------------------------------- clocks

describe("el reloj no decide nada", () => {
	/**
	 * Dos dispositivos sin red: el `createdAt` contradice el orden real de
	 * escritura. La frontera es un conjunto de ids, así que no importa.
	 */
	it("la frontera ignora un createdAt desalineado", () => {
		const early = setSets("Z", 3, "2026-10-01", { createdAt: 9_999 });
		const late = setSets("A", 4, "2026-10-01", { createdAt: 1 });

		const asOf = { effectiveOn: "2026-10-10", knows: { adjustmentIds: ["Z"] } };
		expect(idsOf(inForce([early, late], asOf, PHASE))).toEqual(["Z"]);
	});

	it("la precedencia desempata por id, no por reloj", () => {
		const a = setSets("aaa", 3, "2026-10-01", { createdAt: 9_999 });
		const z = setSets("zzz", 4, "2026-10-01", { createdAt: 1 });

		// Con el reloj mandando, ganaría `aaa`. Con el id, gana `zzz` — y gana lo
		// mismo en los dos dispositivos, que es lo único que importa.
		expect(ordered([a, z]).map((entry) => entry.id)).toEqual(["aaa", "zzz"]);
		expect(ordered([z, a]).map((entry) => entry.id)).toEqual(["aaa", "zzz"]);
	});

	it("safety gana a un manual posterior", () => {
		const manual = setSets("m", 4, "2026-12-01");
		const safety = setSets("s", 1, "2026-10-01", { origin: "safety" });

		expect(byPrecedence(safety, manual)).toBeGreaterThan(0);
		expect(ordered([manual, safety]).at(-1)?.id).toBe("s");
	});

	it("program cede ante todo lo demás", () => {
		const program = setSets("p", 3, "2026-12-01", { origin: "program" });
		const manual = setSets("m", 2, "2026-08-01");
		expect(ordered([program, manual]).at(-1)?.id).toBe("m");
	});
});

// ---------------------------------------------------------------- conflicts

describe("empatar no es estar de acuerdo", () => {
	it("reporta dos decisiones incompatibles, y aun así resuelve", () => {
		const a = setSets("aaa", 3, "2026-10-01");
		const b = setSets("bbb", 4, "2026-10-01");

		const problems = validateAdjustments([a, b], live("2026-10-10"), PHASE);
		const conflict = problems.find(
			(problem) => problem.code === "ambiguous-adjustment-conflict",
		);

		expect(conflict).toMatchObject({
			entryId: "slot_a_01",
			field: "sets",
			adjustmentIds: ["aaa", "bbb"],
		});
		// Y la resolución sigue siendo total: no se detiene por el conflicto.
		expect(inForce([a, b], live("2026-10-10"), PHASE)).toHaveLength(2);
	});

	it("distinta prioridad no es empate", () => {
		const manual = setSets("aaa", 3, "2026-10-01");
		const safety = setSets("bbb", 1, "2026-10-01", { origin: "safety" });

		const problems = validateAdjustments(
			[manual, safety],
			live("2026-10-10"),
			PHASE,
		);
		expect(
			problems.filter((p) => p.code === "ambiguous-adjustment-conflict"),
		).toEqual([]);
	});

	it("una revocación de revocación se rechaza", () => {
		const a = setSets("A", 3, "2026-10-01");
		const r1 = revoke("R1", "A", "2026-11-01");
		const r2 = revoke("R2", "R1", "2026-12-01");

		const problems = validateAdjustments(
			[a, r1, r2],
			live("2026-12-05"),
			PHASE,
		);
		expect(problems).toContainEqual({
			code: "revoke-of-revoke",
			adjustmentId: "R2",
			revokesId: "R1",
		});
	});

	it("una revocación hacia la nada se reporta", () => {
		const problems = validateAdjustments(
			[revoke("R", "no_existe", "2026-11-01")],
			live("2026-11-05"),
			PHASE,
		);
		expect(problems).toContainEqual({
			code: "revokes-unknown",
			adjustmentId: "R",
			revokesId: "no_existe",
		});
	});

	it("un log sano no dice nada", () => {
		const a = setSets("A", 3, "2026-10-01");
		expect(validateAdjustments([a], live("2026-10-10"), PHASE)).toEqual([]);
	});
});
