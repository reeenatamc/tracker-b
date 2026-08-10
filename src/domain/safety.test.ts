import { describe, expect, it } from "vitest";
import { evaluateSafety, RELEVANT_PAIN, worstPain } from "./safety";

describe("evaluateSafety", () => {
	it("clears a session inside the 0–2 pain goal", () => {
		expect(evaluateSafety({ pain: 2 })).toEqual({
			blocked: false,
			signals: [],
		});
	});

	it('blocks at the "dolor relevante" threshold', () => {
		expect(RELEVANT_PAIN).toBe(3);
		expect(evaluateSafety({ pain: 3 })).toEqual({
			blocked: true,
			signals: ["pain"],
		});
	});

	it("blocks on swelling and on the ankle giving way", () => {
		expect(evaluateSafety({ swelling: true })).toEqual({
			blocked: true,
			signals: ["swelling"],
		});
		expect(evaluateSafety({ givesWay: true })).toEqual({
			blocked: true,
			signals: ["givesWay"],
		});
	});

	it("reports every signal present, not just the first", () => {
		const verdict = evaluateSafety({ pain: 7, swelling: true, givesWay: true });
		expect(verdict.blocked).toBe(true);
		expect(verdict.signals).toEqual(["pain", "swelling", "givesWay"]);
	});

	it("treats absent readings as no signal, not as a failure", () => {
		expect(evaluateSafety({})).toEqual({ blocked: false, signals: [] });
		expect(
			evaluateSafety({ pain: null, swelling: null, givesWay: null }),
		).toEqual({
			blocked: false,
			signals: [],
		});
	});

	it("does not block on pain 0 with false flags", () => {
		expect(
			evaluateSafety({ pain: 0, swelling: false, givesWay: false }).blocked,
		).toBe(false);
	});
});

describe("worstPain", () => {
	it("takes the highest recorded reading", () => {
		expect(worstPain([0, 3, 1])).toBe(3);
	});

	it("ignores gaps rather than counting them as zero", () => {
		expect(worstPain([null, 4, undefined])).toBe(4);
	});

	it("returns null when nothing was recorded", () => {
		expect(worstPain([null, undefined])).toBeNull();
		expect(worstPain([])).toBeNull();
	});
});
