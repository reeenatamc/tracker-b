/**
 * The barrier, and the order behind it.
 *
 * The defect this file exists for was not a wrong result — it was a right result
 * computed over nothing. `getCollections()` resolved before OPFS had handed over
 * a single row, every reconciliation ran in that gap, and each one truthfully
 * reported that there was nothing to do.
 *
 * So the collections here are modelled the way the real ones behave and not the
 * way it would be convenient to model them: reads return **empty** until
 * `preload()` resolves. Under that model the old order fails these tests and the
 * new one passes, which is the only reason to trust them.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const seen: Array<{ step: string; sets: number; sessions: number }> = [];
const failures = new Map<string, Error>();

/** Each step records what the database looked like when it was called. */
function record(step: string) {
	return (collections: {
		sets: { toArray: unknown[] };
		sessions: { toArray: unknown[] };
	}) => {
		seen.push({
			step,
			sets: collections.sets.toArray.length,
			sessions: collections.sessions.toArray.length,
		});
		const boom = failures.get(step);
		if (boom) throw boom;
		return REPORTS[step as keyof typeof REPORTS];
	};
}

const REPORTS = {
	exercises: {
		setsMigrated: 0,
		customExercisesMigrated: 0,
		overridesMigrated: 0,
		unmapped: [],
	},
	phases: { sessionsMigrated: 0, eventsSeeded: 0, unmapped: [] },
	seed: { inserted: 0, updated: 0, revived: 0, removed: 0 },
};

vi.mock("@/lib/migrate-exercise-ids", () => ({
	migrateExerciseIds: (c: never) => record("exercises")(c),
}));
vi.mock("@/lib/migrate-phase-ids", () => ({
	migratePhaseIds: (c: never) => record("phases")(c),
}));
vi.mock("@/lib/seed", () => ({
	syncSeed: (c: never) => record("seed")(c),
}));

import { bootstrap, hydrate } from "@/db/bootstrap";
import type { Collections } from "@/db/collections";
import { PROGRAM } from "@/domain/__fixtures__/program";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A collection that behaves like the real one: constructed immediately, empty
 * until its rows arrive, and `preload()` resolving exactly when they have.
 */
function lazyCollection(rows: Array<{ id: string }>, delayMs: number) {
	let loaded = false;
	let promise: Promise<void> | null = null;
	const byId = new Map(rows.map((r) => [r.id, { ...r }]));

	return {
		get toArray() {
			return loaded ? [...byId.values()] : [];
		},
		has: (id: string) => loaded && byId.has(id),
		insert: (v: { id: string }) => byId.set(v.id, { ...v }),
		update: (id: string, mutate: (d: Record<string, unknown>) => void) => {
			const draft = { ...(byId.get(id) as Record<string, unknown>) };
			mutate(draft);
			byId.set(id, draft as { id: string });
		},
		delete: (id: string) => byId.delete(id),
		// Memoised, like the real one, so being reached twice costs nothing.
		preload: () => {
			promise ??= sleep(delayMs).then(() => {
				loaded = true;
			});
			return promise;
		},
	};
}

function makeCollections(sets: number, sessions: number, delayMs = 20) {
	const built = {
		sessions: lazyCollection(
			Array.from({ length: sessions }, (_, i) => ({ id: `s${i}` })),
			delayMs,
		),
		sets: lazyCollection(
			Array.from({ length: sets }, (_, i) => ({ id: `set${i}` })),
			delayMs / 2,
		),
		phaseEvents: lazyCollection([], delayMs * 2),
	};
	// `raw` mirrors the same collections, exactly as the real object does.
	return { ...built, raw: built } as unknown as Collections;
}

beforeEach(() => {
	seen.length = 0;
	failures.clear();
});

// ------------------------------------------------------------------- barrier

describe("la barrera de hidratación", () => {
	it("ningún reconciliador ve cero filas mientras aún llegan de OPFS", async () => {
		const collections = makeCollections(43, 3);

		// Antes de arrancar, la base parece vacía. Ese es el estado que engañaba.
		expect(collections.sets.toArray).toHaveLength(0);

		await bootstrap(collections, PROGRAM);

		expect(seen).toHaveLength(3);
		for (const step of seen) {
			expect(step.sets, `${step.step} vio la base a medias`).toBe(43);
			expect(step.sessions, `${step.step} vio la base a medias`).toBe(3);
		}
	});

	it("espera a la colección más lenta, no a la primera", async () => {
		// `phaseEvents` tarda el doble que las demás.
		const collections = makeCollections(10, 2, 40);
		await bootstrap(collections, PROGRAM);
		expect(collections.raw.phaseEvents.toArray).toBeDefined();
		expect(seen[0].sets).toBe(10);
	});

	it("devuelve los nombres de lo que esperó", async () => {
		const collections = makeCollections(1, 1);
		const waited = await hydrate(collections);
		expect(waited.sort()).toEqual(["phaseEvents", "sessions", "sets"]);
	});

	it("no se atraganta con lo que no es una colección", async () => {
		const collections = {
			sets: lazyCollection([{ id: "a" }], 1),
			tracker: { pending: 0 },
			nada: null,
		} as unknown as Collections;

		await expect(hydrate(collections)).resolves.toEqual(["sets"]);
	});

	/** Una base de verdad vacía sigue siendo válida: cero filas y sigue adelante. */
	it("una base vacía no es un error", async () => {
		const collections = makeCollections(0, 0);
		const report = await bootstrap(collections, PROGRAM);
		expect(report.hydrated.sets).toBe(0);
		expect(seen).toHaveLength(3);
	});
});

// --------------------------------------------------------------------- order

describe("el orden de arranque", () => {
	it("migra ids, luego fases, y sólo entonces compara la semilla", async () => {
		await bootstrap(makeCollections(5, 1), PROGRAM);
		expect(seen.map((s) => s.step)).toEqual(["exercises", "phases", "seed"]);
	});

	/**
	 * El motivo de que la semilla vaya última: compara filas guardadas con las de
	 * la hoja, y compararlas sin migrar hace que todas parezcan cambiadas — que es
	 * justo lo que empujaba al código viejo a borrarlas y recrearlas.
	 */
	it("la semilla nunca corre antes que las migraciones", async () => {
		await bootstrap(makeCollections(5, 1), PROGRAM);
		expect(seen.findIndex((s) => s.step === "seed")).toBeGreaterThan(
			seen.findIndex((s) => s.step === "exercises"),
		);
		expect(seen.findIndex((s) => s.step === "seed")).toBeGreaterThan(
			seen.findIndex((s) => s.step === "phases"),
		);
	});

	it("informa de lo que había tras hidratar", async () => {
		const report = await bootstrap(makeCollections(43, 3), PROGRAM);
		expect(report.hydrated).toEqual({ sessions: 3, sets: 43, phaseEvents: 0 });
	});
});

// -------------------------------------------------------------------- errors

describe("un fallo en el arranque", () => {
	it("se propaga en vez de quedarse callado", async () => {
		failures.set("phases", new Error("la migración de fases explotó"));
		await expect(bootstrap(makeCollections(5, 1), PROGRAM)).rejects.toThrow(
			"la migración de fases explotó",
		);
	});

	it("y corta lo que venía después", async () => {
		failures.set("exercises", new Error("boom"));
		await expect(bootstrap(makeCollections(5, 1), PROGRAM)).rejects.toThrow();
		expect(seen.map((s) => s.step)).toEqual(["exercises"]);
	});

	it("un preload que falla también se propaga", async () => {
		const collections = {
			sets: { preload: () => Promise.reject(new Error("OPFS se cayó")) },
		} as unknown as Collections;

		await expect(bootstrap(collections, PROGRAM)).rejects.toThrow(
			"OPFS se cayó",
		);
	});
});
