/**
 * The allowlist of approved visible changes, pinned.
 *
 * `scripts/extract-library.ts` refuses to run when it computes a change that is
 * not on this list — that is the real guard, and it fires at the moment the
 * content pipeline runs. These tests guard the list itself: that the totals are
 * the ones that were reviewed, that nothing was added without moving the count,
 * and that the entries stay well-formed.
 *
 * The specific absences matter as much as the entries. Splitting cues into
 * general and prescription exists so that an accommodation written for one
 * session does not become a property of the movement, and the two leg press
 * cues plus the chest press one are exactly the cases that proved it. If any of
 * them ever shows up here, the split has stopped working.
 */

import { describe, expect, it } from "vitest";
import {
	changeKey,
	EXPECTED_CHANGES,
	EXPECTED_COUNTS,
} from "./__fixtures__/expected-changes";

describe("los totales aprobados", () => {
	it("son 14 cambios atómicos", () => {
		expect(EXPECTED_COUNTS.total).toBe(14);
		expect(EXPECTED_CHANGES).toHaveLength(14);
	});

	it("se reparten en 9 cues + 4 nombres + 1 músculo", () => {
		expect(EXPECTED_COUNTS).toMatchObject({
			technique: 9,
			name: 4,
			muscle: 1,
		});
	});

	it("la suma por tipo cuadra con el total", () => {
		const { technique, name, muscle, total } = EXPECTED_COUNTS;
		expect(technique + name + muscle).toBe(total);
	});

	it("cuenta por campo lo mismo que declara", () => {
		const byField = EXPECTED_CHANGES.reduce<Record<string, number>>(
			(counts, change) => {
				counts[change.field] = (counts[change.field] ?? 0) + 1;
				return counts;
			},
			{},
		);
		expect(byField).toEqual({ technique: 9, name: 4, muscle: 1 });
	});
});

describe("la lista está bien formada", () => {
	it("no repite ninguna coordenada", () => {
		const keys = EXPECTED_CHANGES.map(changeKey);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("sólo nombra sesiones del programa", () => {
		const sessions = new Set(["full_body_a", "full_body_b", "full_body_c"]);
		for (const change of EXPECTED_CHANGES) {
			expect(sessions.has(change.session), changeKey(change)).toBe(true);
		}
	});

	it("sólo permite cambiar los tres campos que la migración enriquece", () => {
		for (const change of EXPECTED_CHANGES) {
			expect(["technique", "name", "muscle"]).toContain(change.field);
		}
	});
});

describe("lo que NO puede estar en la lista", () => {
	const cues = EXPECTED_CHANGES.filter(
		(change) => change.field === "technique",
	);

	/**
	 * Both leg press cues are prescription: an ankle accommodation and a
	 * back-reference to Monday's posture. If either ever became general, the leg
	 * press would start changing in sessions that never asked for it.
	 */
	it("la prensa no cambia de señal en ninguna sesión", () => {
		expect(cues.filter((change) => change.exercise === "leg_press")).toEqual(
			[],
		);
	});

	/**
	 * "No llegar al fallo sola" reads like technique but is about training with
	 * nobody there to rack the weight — context, not form.
	 */
	it("el press de pecho no cambia de señal en ninguna sesión", () => {
		expect(cues.filter((change) => change.exercise === "chest_press")).toEqual(
			[],
		);
	});

	/*
	 * The type already rules these out, which is the stronger guarantee — hence
	 * the widened read rather than a comparison TypeScript would reject as
	 * impossible. The check survives someone loosening `ExpectedChange` later,
	 * which is precisely when it would start mattering.
	 */
	it("ninguna sustitución, carga, serie, RIR ni objetivo entra en la lista", () => {
		const forbidden = [
			"substitution",
			"load",
			"setsByPhase",
			"rir",
			"target",
			"isAnkle",
		];
		const fields = EXPECTED_CHANGES.map((change) => change.field as string);
		for (const field of fields) expect(forbidden).not.toContain(field);
	});
});
