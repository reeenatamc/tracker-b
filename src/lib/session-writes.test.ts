/**
 * The regression for the three writes that were going nowhere.
 *
 * Each test does the thing and then reads the row back, because that is the step
 * that was missing: the old code called `update` with an object where the key
 * goes, the lookup matched nothing, and nobody noticed — the screen re-rendered
 * from a collection that had not changed and looked like it had worked.
 *
 * The collection is stood up in memory rather than mocked, so `update` really
 * has to find a row by id for any of this to pass.
 */

import { describe, expect, it } from "vitest";
import type { Collections } from "@/db/collections";
import type { SessionRecord } from "@/domain/schema";
import {
	addToSession,
	restoreExercise,
	skipExercise,
	startSession,
} from "@/lib/session-writes";

type Row = Record<string, unknown> & { id: string };

/** Stands in for what the real collection returns from a write. */
const TRANSACTION = { isPersisted: { promise: Promise.resolve() } };

function makeCollections(rows: Row[]) {
	const byId = new Map(rows.map((row) => [row.id, { ...row }]));
	const sessions = {
		get toArray() {
			return [...byId.values()];
		},
		has: (id: string) => byId.has(id),
		insert: (value: Row) => byId.set(value.id, { ...value }),
		update: (id: string, mutate: (draft: Row) => void) => {
			const existing = byId.get(id);
			// The bug's whole surface: a key that matches nothing has to do nothing,
			// exactly as the real collection does, or the test would pass anyway.
			if (existing) {
				const draft = { ...existing };
				mutate(draft);
				byId.set(id, draft);
			}
			// The real collection hands back a transaction. Returning a stand-in is
			// what lets the last test check the module passes it through rather than
			// swallowing it.
			return TRANSACTION;
		},
	};
	return { sessions, raw: { sessions } } as unknown as Collections;
}

function session(overrides: Partial<SessionRecord> = {}): Row {
	return {
		id: "s1",
		date: "2026-08-10",
		templateId: "full_body_a",
		phase: "adaptacion",
		completed: false,
		notes: null,
		startedAt: null,
		endedAt: null,
		skippedExerciseIds: [],
		extraExerciseIds: [],
		...overrides,
	} as Row;
}

const NOW = Date.parse("2026-08-10T18:00:00Z");
const read = (collections: Collections, id = "s1") =>
	collections.sessions.toArray.find((row) => row.id === id) as
		| SessionRecord
		| undefined;

describe("empezar la sesión", () => {
	it("fija startedAt en la sesión, no en ninguna otra parte", () => {
		const collections = makeCollections([session()]);
		startSession(collections, "s1", NOW);
		expect(read(collections)?.startedAt).toBe(NOW);
	});

	it("no reescribe la hora de una sesión ya empezada", () => {
		const collections = makeCollections([session({ startedAt: 111 })]);
		startSession(collections, "s1", NOW);
		expect(read(collections)?.startedAt).toBe(111);
	});

	/** Lo que fallaba: la clave no encontraba fila y la escritura se evaporaba. */
	it("con un id que no existe no toca nada", () => {
		const collections = makeCollections([session()]);
		startSession(collections, "otra", NOW);
		expect(read(collections)?.startedAt).toBeNull();
	});
});

describe("saltar un ejercicio", () => {
	it("queda asociado a la sesión correcta", () => {
		const collections = makeCollections([session(), session({ id: "s2" })]);
		skipExercise(collections, "s1", "prensa");

		expect(read(collections)?.skippedExerciseIds).toEqual(["prensa"]);
		expect(read(collections, "s2")?.skippedExerciseIds).toEqual([]);
	});

	it("saltar dos veces el mismo no lo duplica", () => {
		const collections = makeCollections([session()]);
		skipExercise(collections, "s1", "prensa");
		skipExercise(collections, "s1", "prensa");
		expect(read(collections)?.skippedExerciseIds).toEqual(["prensa"]);
	});

	it("y se puede reponer", () => {
		const collections = makeCollections([
			session({ skippedExerciseIds: ["prensa", "abduccion"] }),
		]);
		restoreExercise(collections, "s1", "prensa");
		expect(read(collections)?.skippedExerciseIds).toEqual(["abduccion"]);
	});
});

describe("añadir un ejercicio propio", () => {
	it("queda asociado a la sesión correcta", () => {
		const collections = makeCollections([session(), session({ id: "s2" })]);
		addToSession(collections, "s1", "custom-hip-thrust");

		expect(read(collections)?.extraExerciseIds).toEqual(["custom-hip-thrust"]);
		expect(read(collections, "s2")?.extraExerciseIds).toEqual([]);
	});

	it("añadirlo dos veces no lo duplica", () => {
		const collections = makeCollections([session()]);
		addToSession(collections, "s1", "custom-x");
		addToSession(collections, "s1", "custom-x");
		expect(read(collections)?.extraExerciseIds).toEqual(["custom-x"]);
	});

	it("no pisa lo que ya estaba", () => {
		const collections = makeCollections([
			session({ extraExerciseIds: ["custom-a"] }),
		]);
		addToSession(collections, "s1", "custom-b");
		expect(read(collections)?.extraExerciseIds).toEqual([
			"custom-a",
			"custom-b",
		]);
	});
});

describe("las tres devuelven su transacción", () => {
	/**
	 * T-001: una escritura no está guardada hasta que el llamante ha esperado al
	 * disco. Si alguna devolviera `void`, el sitio de llamada no tendría nada que
	 * esperar y el fallo volvería por otra puerta.
	 */
	it("para que el sitio de llamada pueda esperarla", () => {
		const collections = makeCollections([session()]);
		expect(startSession(collections, "s1", NOW)).toBe(TRANSACTION);
		expect(skipExercise(collections, "s1", "x")).toBe(TRANSACTION);
		expect(restoreExercise(collections, "s1", "x")).toBe(TRANSACTION);
		expect(addToSession(collections, "s1", "y")).toBe(TRANSACTION);
	});
});
