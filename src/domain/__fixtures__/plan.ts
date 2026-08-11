/**
 * A synthetic plan, for E3.
 *
 * Two slots in one template, hand-written so the tests never touch real content.
 * Nothing here resembles anybody's programme; the numbers are chosen to make the
 * folding visible.
 */

import type {
	PlanAdjustment,
	PrescriptionBaseline,
	PrescriptionEntry,
} from "../schema";

const LOAD = {
	startKg: 20,
	perSide: false,
	relativeToBase: false,
	bodyweight: false,
	needsCalibration: false,
	incrementKg: null,
	raw: "20 kg",
};

export function makeBaseline(
	overrides: Partial<PrescriptionBaseline> = {},
): PrescriptionBaseline {
	return {
		id: "slot_a_01",
		templateId: "template_a",
		exerciseId: "lat_pulldown",
		order: 1,
		sets: 2,
		target: { kind: "reps", min: 10, max: 12 },
		load: LOAD,
		rir: { min: 2, max: 2 },
		restSeconds: { min: 90, max: 90 },
		trainingRole: "strength",
		goal: "tirón vertical",
		progression: "doble progresión",
		cues: ["agarre cómodo"],
		allowedSubstitutions: [],
		seededFrom: "fixture",
		seededAt: 0,
		...overrides,
	};
}

export const BASELINE: PrescriptionBaseline[] = [
	makeBaseline(),
	makeBaseline({
		id: "slot_a_02",
		exerciseId: "seated_row",
		order: 2,
		sets: 3,
		goal: "tirón horizontal",
		cues: ["sin balancear torso"],
	}),
];

export function makeAdjustment(
	overrides: Partial<Extract<PlanAdjustment, { kind: "set_field" }>> = {},
): PlanAdjustment {
	return {
		kind: "set_field",
		id: "adj_1",
		entryId: "slot_a_01",
		change: { field: "sets", value: 3 },
		effectiveOn: "2026-10-01",
		onlyInPhase: null,
		origin: "manual",
		reason: "prueba",
		evidenceIds: [],
		provenance: { kind: "authored" },
		createdAt: 0,
		...overrides,
	};
}

/** The prescription of a different movement, for `replace_exercise`. */
export const REPLACEMENT: Omit<PrescriptionEntry, "id" | "templateId"> = {
	exerciseId: "chest_press",
	order: 1,
	sets: 2,
	target: { kind: "reps", min: 8, max: 10 },
	load: { ...LOAD, startKg: 30, raw: "30 kg" },
	rir: { min: 1, max: 2 },
	restSeconds: { min: 120, max: 120 },
	trainingRole: "strength",
	goal: "empuje horizontal",
	progression: "doble progresión",
	cues: ["no llegar al fallo"],
	allowedSubstitutions: [],
};
