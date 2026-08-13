/**
 * Two devices and a server, with the log E3 actually produces.
 *
 * The unit tests around this one check pieces. This one checks the thing that
 * was broken and that nothing was watching: that everything a real E3 database
 * holds gets from one device to the other. It had not, since E2 — the endpoint
 * accepted `phaseEvents`, `prescriptionBaseline`, `planAdjustments` and
 * `planSnapshots`, the backup carried them, and the client never sent them, so
 * a second device held sessions and sets and no plan at all.
 *
 * The server here is in memory, and mirrors `api/sync.ts`: same allow-list from
 * the same registry, same last-write-wins guard, same "pull includes what was
 * just pushed". What makes that stand-in trustworthy is not this file — it is
 * `domain/collection-policy.test.ts`, which holds the endpoint to deriving its
 * list from the same constant this one imports.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROGRAM } from "@/domain/__fixtures__/program";

vi.mock("@/lib/content", () => ({ program: PROGRAM }));

import type { Collections } from "@/db/collections";
import { SYNCED_COLLECTIONS } from "@/domain/collection-policy";
import { createSyncClient } from "@/lib/sync-client";

// ---------------------------------------------------------------- el mundo

type Row = Record<string, unknown> & { id: string };

function makeCollection(rows: Row[] = []) {
	const byId = new Map(rows.map((row) => [row.id, { ...row }]));
	return {
		get toArray() {
			return [...byId.values()];
		},
		has: (id: string) => byId.has(id),
		insert: (value: Row) => byId.set(value.id, { ...value }),
		update: (id: string, mutate: (draft: Row) => void) => {
			const draft = { ...(byId.get(id) as Row) };
			mutate(draft);
			byId.set(id, draft);
		},
	};
}

function makeDevice(seed: Partial<Record<string, Row[]>> = {}) {
	const built = Object.fromEntries(
		SYNCED_COLLECTIONS.map((key) => [key, makeCollection(seed[key] ?? [])]),
	);
	return { ...built, raw: built } as unknown as Collections;
}

type Change = {
	collection: string;
	id: string;
	updatedAt: number;
	deletedAt: number | null;
	data: Row;
};

/** `api/sync.ts` sin Postgres: mismas reglas, misma lista, mismo orden. */
function makeServer() {
	const stored = new Map<string, Change>();

	async function handle(_url: string, init: { body: string }) {
		const body = JSON.parse(init.body) as {
			since?: number;
			changes?: Change[];
		};

		for (const change of body.changes ?? []) {
			if (!SYNCED_COLLECTIONS.includes(change.collection as never)) continue;
			const key = `${change.collection}:${change.id}`;
			const mine = stored.get(key);
			// `where records.updated_at < excluded.updated_at`: una copia vieja que
			// llega tarde no pisa a la nueva.
			if (!mine || mine.updatedAt < change.updatedAt) stored.set(key, change);
		}

		const since = body.since ?? 0;
		const changes = [...stored.values()]
			.filter((change) => change.updatedAt > since)
			.sort((a, b) => a.updatedAt - b.updatedAt);

		return new Response(JSON.stringify({ changes }), { status: 200 });
	}

	return {
		handle,
		stored,
		count: (collection: string) =>
			[...stored.values()].filter((c) => c.collection === collection).length,
		ids: (collection: string) =>
			[...stored.values()]
				.filter((c) => c.collection === collection)
				.map((c) => c.id)
				.sort(),
	};
}

const MARK_KEY = "operacion-tesis:sync-mark";

/** Cada dispositivo tiene su propio localStorage, como en la vida real. */
function stubDevice(mark?: number) {
	const store = new Map<string, string>();
	if (mark !== undefined) store.set(MARK_KEY, String(mark));
	vi.stubGlobal("localStorage", {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => store.set(k, v),
	});
	vi.stubGlobal("navigator", { onLine: true });
	vi.stubGlobal("window", {
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	});
	vi.stubGlobal("document", {
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		visibilityState: "visible",
	});
}

/** Las colecciones reales llevan tipos precisos; aquí sólo se miran ids y campos sueltos. */
const filas = (device: Collections, name: string): Row[] =>
	(device.raw as unknown as Record<string, { toArray: Row[] }>)[name].toArray;

async function settle(): Promise<void> {
	for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Un dispositivo entero: su propio almacenamiento, su propia marca. */
async function syncDevice(
	collections: Collections,
	server: ReturnType<typeof makeServer>,
) {
	stubDevice();
	vi.stubGlobal("fetch", vi.fn(server.handle));
	const client = createSyncClient(collections, () => {});
	await settle();
	client.stop();
}

// ------------------------------------------------------------- el fixture E3

/**
 * Un registro E3 con la forma del real: la mitad de las series sin `updatedAt`
 * porque se escribieron antes de que existiera el sync, y la mitad con él.
 */
const A_SEED = (() => {
	const sessions: Row[] = [
		{
			id: "ses-a",
			date: "2026-08-08",
			templateId: "full_body_a",
			phase: "adaptacion",
			prescriptionContract: "legacy",
		},
		{
			id: "ses-b",
			date: "2026-08-10",
			templateId: "full_body_a",
			phase: "adaptacion",
			prescriptionContract: "legacy",
			updatedAt: 5_000,
			deletedAt: null,
		},
		{
			id: "ses-c",
			date: "2026-08-11",
			templateId: "cardio_ankle",
			phase: "adaptacion",
			prescriptionContract: "legacy",
			updatedAt: 5_100,
			deletedAt: null,
		},
	];

	// 43 series: 25 sin sellar (las viejas) y 18 selladas.
	const sets: Row[] = Array.from({ length: 43 }, (_, i) =>
		i < 25
			? { id: `set-${i}`, sessionId: "ses-a", reps: 10 }
			: {
					id: `set-${i}`,
					sessionId: "ses-b",
					reps: 10,
					updatedAt: 6_000 + i,
					deletedAt: null,
				},
	);

	const ankleChecks: Row[] = [
		{ id: "tob-1", date: "2026-08-08" },
		{ id: "tob-2", date: "2026-08-10" },
		{ id: "tob-3", date: "2026-08-11", updatedAt: 7_000, deletedAt: null },
	];

	const phaseEvents: Row[] = Array.from({ length: 4 }, (_, i) => ({
		id: `evento-${i}`,
		kind: "move",
		toPhaseId: "adaptacion",
		occurredOn: "2026-08-08",
		updatedAt: 8_000 + i,
		deletedAt: null,
	}));

	const prescriptionBaseline: Row[] = Array.from({ length: 26 }, (_, i) => ({
		id: `slot_full_body_a_${String(i + 1).padStart(2, "0")}`,
		templateId: "full_body_a",
		sets: 2,
		updatedAt: 9_000 + i,
		deletedAt: null,
	}));

	const planAdjustments: Row[] = [
		{
			id: "adj-1",
			kind: "set_field",
			entryId: "slot_full_body_a_01",
			effectiveOn: "2026-08-12",
			updatedAt: 10_000,
			deletedAt: null,
		},
		{
			id: "adj-2",
			kind: "revoke",
			revokesId: "adj-1",
			effectiveOn: "2026-08-13",
			updatedAt: 10_100,
			deletedAt: null,
		},
	];

	const planSnapshots: Row[] = ["ses-a", "ses-b", "ses-c"].map(
		(sessionId, i) => ({
			id: `rec_${sessionId}`,
			sessionId,
			status: "reconstructed",
			updatedAt: 11_000 + i,
			deletedAt: null,
		}),
	);

	return {
		sessions,
		sets,
		ankleChecks,
		phaseEvents,
		prescriptionBaseline,
		planAdjustments,
		planSnapshots,
	};
})();

const ESPERADO = {
	sessions: 3,
	sets: 43,
	ankleChecks: 3,
	phaseEvents: 4,
	prescriptionBaseline: 26,
	planAdjustments: 2,
	planSnapshots: 3,
};

beforeEach(() => {
	vi.unstubAllGlobals();
});

// -------------------------------------------------------------------- A → S

describe("todo lo que E3 escribe llega al servidor", () => {
	it("las siete colecciones con datos, con sus cuentas", async () => {
		const server = makeServer();
		await syncDevice(makeDevice(A_SEED), server);

		const llegado = Object.fromEntries(
			Object.keys(ESPERADO).map((k) => [k, server.count(k)]),
		);
		expect(llegado).toEqual(ESPERADO);
	});

	/** Las 25 sin sellar son justo las que antes no salían nunca del dispositivo. */
	it("las 43 series, incluidas las que no tenían `updatedAt`", async () => {
		const server = makeServer();
		await syncDevice(makeDevice(A_SEED), server);

		expect(server.ids("sets")).toEqual(
			A_SEED.sets.map((s) => s.id as string).sort(),
		);
	});

	it("ninguna colección se queda a cero", async () => {
		const server = makeServer();
		await syncDevice(makeDevice(A_SEED), server);

		for (const name of Object.keys(ESPERADO)) {
			expect(server.count(name), name).toBeGreaterThan(0);
		}
	});
});

// ---------------------------------------------------------------- S → B

describe("y de ahí al segundo dispositivo", () => {
	async function aHaciaB() {
		const server = makeServer();
		const a = makeDevice(A_SEED);
		await syncDevice(a, server);

		const b = makeDevice();
		await syncDevice(b, server);
		return { a, b, server };
	}

	it("B termina con los mismos ids en todas las colecciones", async () => {
		const { a, b } = await aHaciaB();

		for (const name of Object.keys(ESPERADO) as Array<keyof typeof ESPERADO>) {
			const enA = filas(a, name)
				.map((r) => r.id)
				.sort();
			const enB = filas(b, name)
				.map((r) => r.id)
				.sort();
			expect(enB, name).toEqual(enA);
		}
	});

	it("y con las mismas cuentas, sin duplicados", async () => {
		const { b } = await aHaciaB();

		for (const [name, n] of Object.entries(ESPERADO)) {
			const suyas = filas(b, name);
			expect(suyas.length, name).toBe(n);
			expect(new Set(suyas.map((r) => r.id)).size, `${name} duplicados`).toBe(
				n,
			);
		}
	});

	it("el contenido viaja, no sólo el id", async () => {
		const { b } = await aHaciaB();

		const base = filas(b, "prescriptionBaseline").find(
			(r) => r.id === "slot_full_body_a_01",
		);
		expect(base).toMatchObject({ templateId: "full_body_a", sets: 2 });

		const revoke = filas(b, "planAdjustments").find((r) => r.id === "adj-2");
		expect(revoke).toMatchObject({ kind: "revoke", revokesId: "adj-1" });
	});

	/** Una segunda pasada no debe reescribir ni reenviar nada. */
	it("sincronizar otra vez no duplica", async () => {
		const { b, server } = await aHaciaB();
		await syncDevice(b, server);

		expect(filas(b, "sets").length).toBe(43);
		expect(server.count("sets")).toBe(43);
	});
});

// ------------------------------------------------- las dos que faltaban

/**
 * Esta habría fallado desde E2, y ninguna prueba la hacía.
 */
describe("un evento de fase creado en A aparece en B", () => {
	it("viaja", async () => {
		const server = makeServer();
		const a = makeDevice({
			phaseEvents: [
				{
					id: "paso-a-progresion",
					kind: "move",
					toPhaseId: "progresion",
					occurredOn: "2026-09-01",
					updatedAt: 20_000,
					deletedAt: null,
				},
			],
		});
		await syncDevice(a, server);

		const b = makeDevice();
		await syncDevice(b, server);

		expect(filas(b, "phaseEvents").map((r) => r.id)).toEqual([
			"paso-a-progresion",
		]);
	});
});

/** Y ésta desde E3. */
describe("un ajuste creado en A aparece en B", () => {
	it("viaja con su motivo", async () => {
		const server = makeServer();
		const a = makeDevice({
			planAdjustments: [
				{
					id: "adj-nuevo",
					kind: "set_field",
					entryId: "slot_full_body_a_02",
					reason: "la rodilla",
					effectiveOn: "2026-09-01",
					updatedAt: 21_000,
					deletedAt: null,
				},
			],
		});
		await syncDevice(a, server);

		const b = makeDevice();
		await syncDevice(b, server);

		expect(filas(b, "planAdjustments")[0]).toMatchObject({
			id: "adj-nuevo",
			reason: "la rodilla",
		});
	});
});
