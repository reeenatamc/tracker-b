import { describe, expect, it } from "vitest";
import {
	EXERCISE_REGISTRY,
	LEGACY_IDS,
	displayName,
	migrateLegacyId,
	resolveExerciseId,
} from "./exercise-ids";

describe("resolveExerciseId", () => {
	it("resolves both spellings of a renamed exercise to the same id", () => {
		// The rename that motivated all of this.
		expect(resolveExerciseId("Prensa")).toBe("leg_press");
		expect(resolveExerciseId("Prensa de piernas")).toBe("leg_press");
		expect(resolveExerciseId("Abducción")).toBe("hip_abduction");
		expect(resolveExerciseId("Abducción de cadera")).toBe("hip_abduction");
	});

	it("ignores accents and case, which vary between spreadsheet versions", () => {
		expect(resolveExerciseId("abduccion de cadera")).toBe("hip_abduction");
		expect(resolveExerciseId("ELEVACION DE TALON")).toBe("calf_raise");
		expect(resolveExerciseId("  Jalón al pecho  ")).toBe("lat_pulldown");
	});

	it("unifies the four names used for single-leg balance", () => {
		for (const name of [
			"Balance 1 pierna",
			"Balance unilateral",
			"Equilibrio unilateral",
			"Equilibrio 1 pierna",
		]) {
			expect(resolveExerciseId(name)).toBe("single_leg_balance");
		}
	});

	it("keeps assisted single-leg calf raises separate from bilateral ones", () => {
		// Different exercise, not a rename — merging them would make a record of
		// 15 bilateral reps read as a record on the unilateral version.
		expect(resolveExerciseId("Calf raise bilateral")).toBe("calf_raise");
		expect(resolveExerciseId("Calf raise unilateral asistido")).toBe(
			"calf_raise_unilateral",
		);
	});

	it("returns null for an unknown name rather than guessing", () => {
		expect(resolveExerciseId("Peso muerto rumano")).toBeNull();
		expect(resolveExerciseId("Glute kickback o abducción")).toBeNull();
	});
});

describe("migrateLegacyId", () => {
	it("re-points ids that were slugs of the display name", () => {
		expect(migrateLegacyId("prensa")).toBe("leg_press");
		expect(migrateLegacyId("elevacion-de-talon")).toBe("calf_raise");
		expect(migrateLegacyId("equilibrio-1-pierna")).toBe("single_leg_balance");
	});

	it("leaves an already-canonical id alone", () => {
		expect(migrateLegacyId("leg_press")).toBeNull();
	});

	it("leaves the ids you created yourself alone", () => {
		expect(migrateLegacyId("custom-hip-thrust")).toBeNull();
		expect(migrateLegacyId("finisher-bicicleta")).toBeNull();
	});

	it("refuses the ambiguous v2 either/or entry", () => {
		// "Glute kickback o abducción" could be either movement, and merging two
		// histories is worse than leaving one record unmapped.
		expect(migrateLegacyId("glute-kickback-o-abduccion")).toBeNull();
	});

	it("returns null for something it has never seen", () => {
		expect(migrateLegacyId("no-such-exercise")).toBeNull();
	});
});

describe("the registry itself", () => {
	it("has no alias claimed by two exercises", () => {
		const seen = new Map<string, string>();
		for (const [id, aliases] of Object.entries(EXERCISE_REGISTRY)) {
			for (const alias of aliases) {
				const key = alias.toLowerCase();
				expect(seen.has(key), `"${alias}" en ${id} y ${seen.get(key)}`).toBe(
					false,
				);
				seen.set(key, id);
			}
		}
	});

	it("only maps legacy ids onto exercises that exist", () => {
		for (const [legacy, canonical] of Object.entries(LEGACY_IDS)) {
			expect(
				EXERCISE_REGISTRY[canonical],
				`${legacy} -> ${canonical}`,
			).toBeDefined();
		}
	});

	it("names every exercise it knows", () => {
		for (const id of Object.keys(EXERCISE_REGISTRY)) {
			expect(displayName(id)).not.toBe(id);
		}
	});
});
