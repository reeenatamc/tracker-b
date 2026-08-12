/**
 * The seed, reconciled instead of rebuilt.
 *
 * The old version deleted its rows and re-created them whenever they did not
 * match. Two things made that fatal on a restored backup. `delete` here is a
 * tombstone, so the id was still taken and the `insert` after it threw
 * `duplicate id` — and it threw *after* the deletes, so fifteen sets ended up
 * tombstoned and none rewritten, on a launch that then never finished.
 *
 * The guarantee these tests are really about is the last one in the file: a run
 * that dies half-way may leave rows to reconcile next time, and may never leave
 * fewer than it found.
 *
 * The seed is passed in, so none of this touches her content.
 */

import { describe, expect, it } from "vitest";
import type { Collections } from "@/db/collections";
import { syncSeed } from "@/lib/seed";

const SEED = {
	date: "2026-01-03",
	type: "full_body_a",
	phase: 1,
	completed: true,
	sets: [
		{
			exerciseId: "leg_press",
			exerciseName: "Prensa",
			setNumber: 1,
			load: 20,
			unit: "kg" as const,
			reps: 12,
			rir: "2",
			anklePain: null,
			note: null,
		},
		{
			exerciseId: "lat_pulldown",
			exerciseName: "Jalón",
			setNumber: 2,
			load: 25,
			unit: "kg" as const,
			reps: 10,
			rir: "1–2",
			anklePain: null,
			note: null,
		},
	],
};

const SESSION_ID = "seed-2026-01-03";
const ROW_IDS = [`${SESSION_ID}-0`, `${SESSION_ID}-1`];

type Row = Record<string, unknown> & { id: string };

/**
 * Modelled on the real thing in the one way that matters: `delete` tombstones
 * rather than removes, so the id stays taken and a later `insert` collides —
 * exactly as `@tanstack/db` does with `syncable` on top.
 */
function makeCollections(seed: { sets?: Row[]; sessions?: Row[] } = {}) {
	const failOn = {
		insert: null as string | null,
		update: null as string | null,
	};

	const collection = (rows: Row[]) => {
		const byId = new Map(rows.map((r) => [r.id, { ...r }]));
		return {
			get toArray() {
				return [...byId.values()];
			},
			has: (id: string) => byId.has(id),
			insert: (value: Row) => {
				if (byId.has(value.id)) {
					throw new Error(
						`Cannot insert document with ID "${value.id}" because it already exists in the collection`,
					);
				}
				if (failOn.insert === value.id) throw new Error("escritura fallida");
				byId.set(value.id, { ...value, deletedAt: null });
			},
			update: (id: string, mutate: (draft: Row) => void) => {
				if (failOn.update === id) throw new Error("escritura fallida");
				const draft = { ...(byId.get(id) as Row) };
				mutate(draft);
				byId.set(id, draft);
			},
			// The tombstone. The row stays; only `deletedAt` changes.
			delete: (id: string) => {
				const draft = { ...(byId.get(id) as Row) };
				draft.deletedAt = Date.now();
				byId.set(id, draft);
			},
		};
	};

	const built = {
		sets: collection(seed.sets ?? []),
		sessions: collection(seed.sessions ?? []),
	};
	return {
		collections: { ...built, raw: built } as unknown as Collections,
		failOn,
	};
}

const storedRow = (index: number, overrides: Partial<Row> = {}): Row => ({
	id: ROW_IDS[index],
	sessionId: SESSION_ID,
	exerciseId: SEED.sets[index].exerciseId,
	setNumber: SEED.sets[index].setNumber,
	isWarmup: false,
	load: SEED.sets[index].load,
	unit: "kg",
	reps: SEED.sets[index].reps,
	rir: index === 0 ? 2 : 1,
	anklePain: null,
	note: null,
	deletedAt: null,
	...overrides,
});

type Buried = { deletedAt?: number | null };

/** `deletedAt` lo añade `syncable` al escribir, así que se lee estructuralmente. */
const buried = (row: unknown): number | null | undefined =>
	(row as Buried | undefined)?.deletedAt;

const alive = (collections: Collections) =>
	collections.sets.toArray.filter((s) => buried(s) == null);

// ------------------------------------------------------------------ first run

describe("una base vacía", () => {
	it("siembra las series y la sesión", () => {
		const { collections } = makeCollections();
		const report = syncSeed(collections, SEED);

		expect(report).toEqual({ inserted: 2, updated: 0, revived: 0, removed: 0 });
		expect(alive(collections).map((s) => s.id)).toEqual(ROW_IDS);
		expect(collections.sessions.toArray).toHaveLength(1);
	});

	it('"1–2" escrito a mano se lee como 1, que es lo conservador', () => {
		const { collections } = makeCollections();
		syncSeed(collections, SEED);
		expect(collections.sets.toArray[1].rir).toBe(1);
	});

	it("una semilla sin series no hace nada", () => {
		const { collections } = makeCollections();
		const report = syncSeed(collections, { ...SEED, sets: [] });
		expect(report.inserted).toBe(0);
		expect(collections.sets.toArray).toEqual([]);
	});
});

// ------------------------------------------------------------- same id again

describe("una fila con el mismo id ya existe", () => {
	it("no provoca duplicate id: se actualiza", () => {
		const { collections } = makeCollections({
			// Lo que dejaba un respaldo anterior a E1: mismos ids, ejercicios viejos.
			sets: [
				storedRow(0, { exerciseId: "prensa-de-piernas" }),
				storedRow(1, { exerciseId: "jalon-al-pecho" }),
			],
		});

		const report = syncSeed(collections, SEED);

		expect(report).toEqual({ inserted: 0, updated: 2, revived: 0, removed: 0 });
		expect(alive(collections).map((s) => s.exerciseId)).toEqual([
			"leg_press",
			"lat_pulldown",
		]);
	});

	it("y si ya coincide, no la toca", () => {
		const { collections } = makeCollections({
			sets: [storedRow(0), storedRow(1)],
		});
		const report = syncSeed(collections, SEED);
		expect(report).toEqual({ inserted: 0, updated: 0, revived: 0, removed: 0 });
	});

	it("nunca borra una fila para volver a crear su id", () => {
		const { collections } = makeCollections({
			sets: [storedRow(0, { reps: 99 })],
		});
		syncSeed(collections, SEED);

		// La fila 0 se actualizó en su sitio: sigue viva y con el valor correcto.
		const row = collections.sets.toArray.find((s) => s.id === ROW_IDS[0]);
		expect(buried(row)).toBeNull();
		expect(row?.reps).toBe(12);
	});
});

// ---------------------------------------------------------------- tombstones

describe("una fila con lápida ocupa su id igual", () => {
	it("se recupera en vez de recrearse", () => {
		const { collections } = makeCollections({
			sets: [storedRow(0, { deletedAt: 1_700_000_000 }), storedRow(1)],
		});

		const report = syncSeed(collections, SEED);

		expect(report).toEqual({ inserted: 0, updated: 0, revived: 1, removed: 0 });
		expect(alive(collections).map((s) => s.id)).toEqual(ROW_IDS);
	});

	it("y vuelve con los valores de la hoja, no con los que tenía", () => {
		const { collections } = makeCollections({
			sets: [storedRow(0, { deletedAt: 1, reps: 999, exerciseId: "otro" })],
		});
		syncSeed(collections, SEED);

		const row = collections.sets.toArray.find((s) => s.id === ROW_IDS[0]);
		expect(row).toMatchObject({ reps: 12, exerciseId: "leg_press" });
		expect(buried(row)).toBeNull();
	});

	it("la sesión con lápida también se recupera", () => {
		const { collections } = makeCollections({
			sessions: [{ id: SESSION_ID, date: SEED.date, deletedAt: 1 }],
		});
		syncSeed(collections, SEED);
		expect(buried(collections.sessions.toArray[0])).toBeNull();
	});

	it("y una sesión viva no se pisa: sus notas son tuyas", () => {
		const { collections } = makeCollections({
			sessions: [
				{
					id: SESSION_ID,
					date: SEED.date,
					notes: "corregido a mano",
					deletedAt: null,
				},
			],
		});
		syncSeed(collections, SEED);
		expect(collections.sessions.toArray[0].notes).toBe("corregido a mano");
	});
});

// -------------------------------------------------------------- what it drops

describe("sobrantes de una siembra anterior", () => {
	it("se retiran, y sólo ellos", () => {
		const { collections } = makeCollections({
			sets: [
				storedRow(0),
				storedRow(1),
				{ ...storedRow(0), id: `${SESSION_ID}-2`, exerciseId: "viejo" },
				// Una serie tuya, con id propio: intocable.
				{ id: "mia", sessionId: "otra", exerciseId: "x", deletedAt: null },
			],
		});

		const report = syncSeed(collections, SEED);

		expect(report.removed).toBe(1);
		expect(
			alive(collections)
				.map((s) => s.id)
				.sort(),
		).toEqual(["mia", ...ROW_IDS]);
	});
});

// ------------------------------------------------------------- the guarantee

describe("un fallo a mitad nunca deja menos filas de las que había", () => {
	it("si falla escribiendo, lo existente sigue vivo", () => {
		const { collections, failOn } = makeCollections({
			sets: [storedRow(0, { reps: 1 }), storedRow(1, { reps: 1 })],
		});
		const antes = alive(collections).length;

		failOn.update = ROW_IDS[1];
		expect(() => syncSeed(collections, SEED)).toThrow("escritura fallida");

		expect(alive(collections)).toHaveLength(antes);
	});

	it("si falla insertando, tampoco se pierde nada", () => {
		const { collections, failOn } = makeCollections({
			sets: [storedRow(0)],
		});
		failOn.insert = ROW_IDS[1];
		expect(() => syncSeed(collections, SEED)).toThrow("escritura fallida");

		expect(alive(collections).map((s) => s.id)).toEqual([ROW_IDS[0]]);
	});

	/**
	 * La razón del orden: lo único que retira filas va al final, cuando ya no
	 * queda nada que pueda lanzar. Una reconciliación a medias se arregla en el
	 * siguiente arranque; una serie borrada, no.
	 */
	it("el sobrante no llega a retirarse si algo anterior falla", () => {
		const { collections, failOn } = makeCollections({
			sets: [
				storedRow(0, { reps: 1 }),
				{ ...storedRow(0), id: `${SESSION_ID}-9`, exerciseId: "viejo" },
			],
		});

		failOn.update = ROW_IDS[0];
		expect(() => syncSeed(collections, SEED)).toThrow();

		const sobrante = collections.sets.toArray.find(
			(s) => s.id === `${SESSION_ID}-9`,
		);
		expect(buried(sobrante)).toBeNull();
	});

	it("y el siguiente arranque lo repara", () => {
		const { collections, failOn } = makeCollections({
			sets: [storedRow(0, { reps: 1 }), storedRow(1, { reps: 1 })],
		});

		failOn.update = ROW_IDS[1];
		expect(() => syncSeed(collections, SEED)).toThrow();

		failOn.update = null;
		const report = syncSeed(collections, SEED);
		expect(report.updated).toBe(1);
		expect(alive(collections).map((s) => s.reps)).toEqual([12, 10]);
	});
});

// -------------------------------------------------------------- idempotence

describe("arrancar dos veces converge", () => {
	it("la segunda pasada no escribe nada", () => {
		const { collections } = makeCollections();
		syncSeed(collections, SEED);
		expect(syncSeed(collections, SEED)).toEqual({
			inserted: 0,
			updated: 0,
			revived: 0,
			removed: 0,
		});
	});

	it("ni la tercera, ni cambia el número de filas", () => {
		const { collections } = makeCollections();
		syncSeed(collections, SEED);
		const filas = collections.sets.toArray.length;
		syncSeed(collections, SEED);
		syncSeed(collections, SEED);
		expect(collections.sets.toArray).toHaveLength(filas);
	});
});
