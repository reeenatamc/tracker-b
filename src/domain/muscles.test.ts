/**
 * The two layers, and the wall between them.
 *
 * The audit is computed indexed by `MuscleId` and grouped only when it is drawn.
 * That is what keeps "6 series de hombro" from hiding whether the lateral head
 * got any of them. These tests exist to keep the wall standing: that the
 * grouping is a total function nobody has to think about, that it does not fold
 * things together that were asked to stay apart, and that a function is never
 * mistaken for a muscle.
 */

import { describe, expect, it } from "vitest";
import {
	ALL_MUSCLES,
	groupLabel,
	groupOf,
	MUSCLE_GROUPS,
	muscleLabel,
	musclesIn,
} from "./muscles";
import { FunctionalTarget, MuscleId } from "./schema";

describe("la agrupación es total y sin solapes", () => {
	it("todo músculo del esquema pertenece a un grupo", () => {
		const grouped = new Set(ALL_MUSCLES);
		const missing = MuscleId.options.filter((muscle) => !grouped.has(muscle));
		expect(missing).toEqual([]);
	});

	it("ningún músculo está en dos grupos", () => {
		const seen = new Map<string, string>();
		for (const [group, muscles] of Object.entries(MUSCLE_GROUPS)) {
			for (const muscle of muscles) {
				expect(seen.get(muscle), `${muscle} repetido`).toBeUndefined();
				seen.set(muscle, group);
			}
		}
	});

	it("ningún grupo está vacío", () => {
		for (const [group, muscles] of Object.entries(MUSCLE_GROUPS)) {
			expect(muscles.length, group).toBeGreaterThan(0);
		}
	});

	it("groupOf y musclesIn son inversas", () => {
		for (const muscle of MuscleId.options) {
			expect(musclesIn(groupOf(muscle))).toContain(muscle);
		}
	});
});

describe("lo que se pidió mantener separado sigue separado", () => {
	it("glúteo mayor y medio se agregan a glúteos, pero son dos músculos", () => {
		expect(groupOf("glute_max")).toBe("glutes");
		expect(groupOf("glute_med")).toBe("glutes");
		expect(MuscleId.options).toContain("glute_max");
		expect(MuscleId.options).toContain("glute_med");
	});

	it("los tres deltoides se agregan a hombros sin dejar de ser tres", () => {
		expect(groupOf("front_delts")).toBe("shoulders");
		expect(groupOf("side_delts")).toBe("shoulders");
		expect(groupOf("rear_delts")).toBe("shoulders");
		expect(musclesIn("shoulders")).toHaveLength(3);
	});

	it("el antebrazo no vive dentro del bíceps", () => {
		expect(groupOf("forearms")).not.toBe(groupOf("biceps"));
	});

	it("los aductores no viven dentro del glúteo", () => {
		expect(groupOf("adductors")).not.toBe(groupOf("glute_max"));
	});

	it("el deltoide lateral se puede auditar suelto", () => {
		// It is a MuscleId, so the audit indexes it directly; the group is only a
		// way of drawing it.
		expect(MuscleId.options).toContain("side_delts");
	});
});

describe("anatomía y función no se mezclan", () => {
	it("ningún objetivo funcional es también un músculo", () => {
		const muscles = new Set<string>(MuscleId.options);
		const overlap = FunctionalTarget.options.filter((target) =>
			muscles.has(target),
		);
		expect(overlap).toEqual([]);
	});

	it("no queda ningún «estabilizador» disfrazado de músculo", () => {
		expect(MuscleId.options).not.toContain("ankle_stabilisers");
	});

	it("los músculos del tobillo que sí existen están nombrados", () => {
		expect(musclesIn("ankle")).toEqual(["tibialis", "peroneals"]);
	});
});

describe("etiquetas", () => {
	it("todo músculo tiene nombre en pantalla", () => {
		for (const muscle of MuscleId.options) {
			expect(muscleLabel(muscle), muscle).toBeTruthy();
		}
	});

	it("todo grupo tiene nombre en pantalla", () => {
		for (const group of Object.keys(MUSCLE_GROUPS) as Array<
			keyof typeof MUSCLE_GROUPS
		>) {
			expect(groupLabel(group), group).toBeTruthy();
		}
	});
});
