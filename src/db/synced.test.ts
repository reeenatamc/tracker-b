/**
 * The phase log only grows, and that is enforced rather than trusted.
 *
 * `syncable` gives every collection `updatedAt` and `deletedAt` — enough
 * machinery to quietly edit or tombstone a row that is supposed to be a record of
 * something that happened. For phase events that would defeat the point, so the
 * collection itself refuses.
 */

import { describe, expect, it, vi } from "vitest";
import { appendOnly } from "./synced";

function fake() {
	return {
		insert: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		toArray: [] as unknown[],
	};
}

describe("appendOnly", () => {
	it("deja insertar", () => {
		const target = fake();
		appendOnly(target).insert({ id: "a" });
		expect(target.insert).toHaveBeenCalledOnce();
	});

	it("se niega a editar, y dice qué hacer en su lugar", () => {
		const target = fake();
		expect(() => appendOnly(target).update("a", () => {})).toThrow(
			/corrección/i,
		);
		expect(target.update).not.toHaveBeenCalled();
	});

	it("se niega a borrar, y dice qué hacer en su lugar", () => {
		const target = fake();
		expect(() => appendOnly(target).delete("a")).toThrow(/revocación/i);
		expect(target.delete).not.toHaveBeenCalled();
	});

	it("no estorba a la lectura", () => {
		const target = fake();
		target.toArray = [{ id: "a" }];
		expect(appendOnly(target).toArray).toEqual([{ id: "a" }]);
	});
});
