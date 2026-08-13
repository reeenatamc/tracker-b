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

		// Antes del push, como el endpoint real: si se leyera después, los propios
		// cambios del cliente taparían el retroceso que esto sirve para detectar.
		const highWaterMark = [...stored.values()].reduce(
			(max, change) => Math.max(max, change.updatedAt),
			0,
		);

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

		return new Response(JSON.stringify({ changes, highWaterMark }), {
			status: 200,
		});
	}

	return {
		handle,
		stored,
		/** Una copia del servidor, para poder restaurarla más tarde. */
		copia: () => new Map([...stored.entries()].map(([k, v]) => [k, { ...v }])),
		restaurar: (copia: Map<string, Change>) => {
			stored.clear();
			for (const [k, v] of copia) stored.set(k, v);
		},
		vaciar: () => stored.clear(),
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

const insertar = (device: Collections, name: string, row: Row): void => {
	(device.raw as unknown as Record<string, { insert(value: Row): unknown }>)[
		name
	].insert(row);
};

async function settle(): Promise<void> {
	for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

/**
 * Un dispositivo entero, y su marca sobrevive entre sincronizaciones.
 *
 * Que no sobreviviera fue un fallo real de esta prueba: cada llamada arrancaba
 * con la marca a cero, así que el escenario del retroceso pasaba sin arreglar
 * nada. Un dispositivo que olvida su cursor no es un dispositivo.
 */
const almacenamientos = new WeakMap<object, Map<string, string>>();

async function syncDevice(
	collections: Collections,
	server: ReturnType<typeof makeServer>,
) {
	let store = almacenamientos.get(collections);
	if (!store) {
		store = new Map<string, string>();
		almacenamientos.set(collections, store);
	}
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
	vi.stubGlobal("fetch", vi.fn(server.handle));
	const client = createSyncClient(collections, () => {});
	await settle();
	client.stop();
	return Number(store.get(MARK_KEY) ?? 0);
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

// ------------------------------------------------- T-008 · el cursor y la historia

/**
 * Un cursor sólo vale mientras el servidor pueda justificar la historia a la que
 * apunta.
 *
 * El cursor es un máximo sobre `updatedAt`, y el servidor contesta «más nuevo
 * que esto» sacándolo de los mismos valores. Si no conserva nada tan nuevo, este
 * dispositivo está preguntando por una historia que ese servidor ya no tiene:
 * pasa al restaurar la base desde una copia vieja. Cada cliente sigue pidiendo
 * desde donde llegó, el servidor no tiene nada posterior, y todos convergen en
 * «no ha cambiado nada» para siempre.
 *
 * Y desde el lado del cliente los dos casos son idénticos —un `changes` vacío—,
 * que es justo por lo que el servidor dice dónde termina su historia en vez de
 * dejarlo deducir de una ausencia.
 *
 * ── Política de recuperación ────────────────────────────────────────────────
 * Se deja de confiar en el cursor, no en los datos. El intercambio se repite
 * como una primera sincronización: se ofrece todo, se lee todo y se reconcilia
 * por id. **La regla de mezcla no cambia**: por registro gana el `updatedAt` más
 * nuevo, como siempre. Un servidor que olvidó no gana autoridad por haber
 * olvidado — es un relevo, no un archivo, y las copias que perduran están en los
 * dispositivos y en los respaldos.
 *
 * Consecuencia deliberada: un retroceso del servidor se repuebla desde los
 * clientes. Si algún día se quisiera revertir el servidor *a propósito*, hay que
 * revertir también los dispositivos; el servidor solo no puede decidirlo.
 */
describe("un cursor que apunta más allá de la historia del servidor", () => {
	const CON_SELLO = (id: string, updatedAt: number): Row => ({
		id,
		date: "2026-08-10",
		templateId: "full_body_a",
		updatedAt,
		deletedAt: null,
	});

	it("una sincronización normal no rehace el pull entero", async () => {
		const server = makeServer();
		const a = makeDevice({ sessions: [CON_SELLO("s1", 1000)] });
		await syncDevice(a, server);

		const espia = vi.fn(server.handle);
		stubDevice(1000);
		vi.stubGlobal("fetch", espia);
		createSyncClient(
			makeDevice({ sessions: [CON_SELLO("s1", 1000)] }),
			() => {},
		);
		await settle();

		const desdes = espia.mock.calls.map((c) => JSON.parse(c[1].body).since);
		expect(desdes).not.toContain(0);
		expect(desdes.every((d) => d === 1000)).toBe(true);
	});

	it("marca 1000 contra un servidor restaurado hasta 700: lo detecta y recupera", async () => {
		const server = makeServer();
		// El servidor sólo conserva hasta 700.
		const b = makeDevice({
			sessions: [CON_SELLO("vieja", 700)],
		});
		await syncDevice(b, server);

		const espia = vi.fn(server.handle);
		stubDevice(1000);
		vi.stubGlobal("fetch", espia);
		const a = makeDevice({ sessions: [CON_SELLO("mia", 1200)] });
		createSyncClient(a, () => {});
		await settle();

		const desdes = espia.mock.calls.map((c) => JSON.parse(c[1].body).since);
		expect(desdes, "tuvo que rehacerlo desde cero").toContain(0);
		// Y recupera la fila anterior a su cursor, que el pull incremental jamás
		// le habría devuelto.
		expect(
			filas(a, "sessions")
				.map((r) => r.id)
				.sort(),
		).toEqual(["mia", "vieja"]);
	});

	it("un servidor vacío con marca local mayor que cero también es un retroceso", async () => {
		const server = makeServer();
		const espia = vi.fn(server.handle);
		stubDevice(5000);
		vi.stubGlobal("fetch", espia);

		createSyncClient(
			makeDevice({ sessions: [CON_SELLO("s1", 900)] }),
			() => {},
		);
		await settle();

		expect(espia.mock.calls.map((c) => JSON.parse(c[1].body).since)).toContain(
			0,
		);
	});

	it("si el pull completo falla, el cursor viejo sigue en pie y se reintenta", async () => {
		const server = makeServer();
		let fallar = true;
		const espia = vi.fn(async (url: string, init: { body: string }) => {
			const since = JSON.parse(init.body).since;
			if (since === 0 && fallar) {
				fallar = false;
				return new Response("{}", { status: 500 });
			}
			return server.handle(url, init);
		});
		stubDevice(9000);
		vi.stubGlobal("fetch", espia);

		const a = makeDevice({ sessions: [CON_SELLO("s1", 900)] });
		const client = createSyncClient(a, () => {});
		await settle();

		// No se guardó un cursor a medias.
		expect(localStorage.getItem(MARK_KEY)).toBe("9000");

		await client.syncNow();
		await settle();

		expect(Number(localStorage.getItem(MARK_KEY))).toBeLessThan(9000);
	});

	it("tras un pull completo con éxito el cursor es el correcto", async () => {
		const server = makeServer();
		await syncDevice(
			makeDevice({ sessions: [CON_SELLO("vieja", 700)] }),
			server,
		);

		stubDevice(1000);
		vi.stubGlobal("fetch", vi.fn(server.handle));
		createSyncClient(
			makeDevice({ sessions: [CON_SELLO("mia", 1200)] }),
			() => {},
		);
		await settle();

		// El máximo real de lo que hay, no el cursor viejo ni un cero.
		expect(Number(localStorage.getItem(MARK_KEY))).toBe(1200);
	});

	it("reconciliar dos veces no duplica", async () => {
		const server = makeServer();
		await syncDevice(
			makeDevice({ sessions: [CON_SELLO("vieja", 700)] }),
			server,
		);

		const a = makeDevice({ sessions: [CON_SELLO("mia", 1200)] });
		stubDevice(1000);
		vi.stubGlobal("fetch", vi.fn(server.handle));
		const client = createSyncClient(a, () => {});
		await settle();
		await client.syncNow();
		await settle();

		const ids = filas(a, "sessions")
			.map((r) => r.id)
			.sort();
		expect(ids).toEqual(["mia", "vieja"]);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("dos dispositivos con marcas distintas convergen", async () => {
		const server = makeServer();
		await syncDevice(
			makeDevice({ sessions: [CON_SELLO("comun", 500)] }),
			server,
		);

		const a = makeDevice({ sessions: [CON_SELLO("de-a", 1100)] });
		stubDevice(3000);
		vi.stubGlobal("fetch", vi.fn(server.handle));
		const ca = createSyncClient(a, () => {});
		await settle();
		ca.stop();

		const b = makeDevice({ sessions: [CON_SELLO("de-b", 1300)] });
		stubDevice(7000);
		vi.stubGlobal("fetch", vi.fn(server.handle));
		const cb = createSyncClient(b, () => {});
		await settle();
		cb.stop();

		// A no vio a B todavía: una vuelta más y los dos tienen lo mismo.
		stubDevice(Number(1100));
		vi.stubGlobal("fetch", vi.fn(server.handle));
		const ca2 = createSyncClient(a, () => {});
		await settle();
		ca2.stop();

		const enA = filas(a, "sessions")
			.map((r) => r.id)
			.sort();
		const enB = filas(b, "sessions")
			.map((r) => r.id)
			.sort();
		expect(enA).toEqual(["comun", "de-a", "de-b"]);
		expect(enB).toEqual(enA);
	});
});

// ------------------------------------------- el escenario completo, de punta a punta

/**
 * A ↔ servidor ↔ B, copia del servidor, filas nuevas, y el servidor vuelve atrás.
 *
 * Qué gana: por registro, el `updatedAt` más nuevo — la misma regla de siempre.
 * El retroceso invalida el cursor, no los hechos. Las filas posteriores a la
 * copia siguen en los dispositivos y vuelven al servidor en el intercambio de
 * recuperación, porque ese intercambio es una primera sincronización y ofrece
 * todo lo que el dispositivo tiene.
 */
describe("el servidor vuelve a una copia vieja y los dos dispositivos siguen", () => {
	it("detecta el retroceso y A y B convergen con lo que de verdad existe", async () => {
		const server = makeServer();
		const fila = (id: string, updatedAt: number): Row => ({
			id,
			date: "2026-08-10",
			templateId: "full_body_a",
			updatedAt,
			deletedAt: null,
		});

		const a = makeDevice({ sessions: [fila("comun", 100)] });
		const b = makeDevice();
		await syncDevice(a, server);
		await syncDevice(b, server);
		expect(filas(b, "sessions").map((r) => r.id)).toEqual(["comun"]);

		// La copia del servidor se toma aquí.
		const copia = server.copia();

		// Después cada uno añade lo suyo y los dos avanzan su marca.
		// Por `raw` y con su sello puesto: aquí interesa el transporte, no el
		// camino de escritura de la app, que ya tiene sus propias pruebas.
		insertar(a, "sessions", fila("nueva-de-a", 900));
		insertar(b, "sessions", fila("nueva-de-b", 950));
		await syncDevice(a, server);
		await syncDevice(b, server);
		await syncDevice(a, server);
		expect(server.count("sessions")).toBe(3);

		// Y el servidor se restaura a la copia vieja: pierde las dos nuevas.
		server.restaurar(copia);
		expect(server.count("sessions")).toBe(1);

		// Ninguno de los dos había perdido nada suyo.
		await syncDevice(a, server);
		await syncDevice(b, server);
		await syncDevice(a, server);

		const enA = filas(a, "sessions")
			.map((r) => r.id)
			.sort();
		const enB = filas(b, "sessions")
			.map((r) => r.id)
			.sort();
		expect(enA).toEqual(["comun", "nueva-de-a", "nueva-de-b"]);
		expect(enB).toEqual(enA);
		// Y el servidor vuelve a tenerlo todo, repoblado desde los dispositivos.
		expect(server.ids("sessions")).toEqual([
			"comun",
			"nueva-de-a",
			"nueva-de-b",
		]);
	});
});
