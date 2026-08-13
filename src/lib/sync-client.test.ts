import { readFileSync } from "node:fs";
import { join } from "node:path";
/**
 * What the client does when the server holds data it cannot read.
 *
 * The pure decision lives in `domain/sync.ts` and is tested there. This is the
 * other half, and the half that could quietly not work: that a 409 actually
 * stops the exchange, that nothing gets written, and that the message says what
 * to do rather than surfacing as a generic failure.
 *
 * It matters because the alternative design — assume an older client copes with
 * an unfamiliar value — is the one that damages a log rather than delaying a sync.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROGRAM } from "@/domain/__fixtures__/program";

// The client reads the program to translate an incoming numeric phase. The real
// one is bundled from `content/`, which the test runner does not resolve — the
// fixture carries the same legacyId mapping, which is all this needs.
vi.mock("@/lib/content", () => ({ program: PROGRAM }));

import type { Collections } from "@/db/collections";
import { SYNCED_COLLECTIONS } from "@/domain/collection-policy";
import { SYNC_SCHEMA_VERSION } from "@/domain/sync";
import {
	createSyncClient,
	LEGACY_STAMP,
	type SyncState,
} from "@/lib/sync-client";

// ------------------------------------------------------------------ the world

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

/*
 * From the registry, not from a list written here. A fixture that names its own
 * collections is the same defect one layer down: it would keep passing while
 * the thing it stands in for stopped covering half the database.
 */
const KEYS = SYNCED_COLLECTIONS;

function makeCollections(seed: Partial<Record<string, Row[]>> = {}) {
	const built = Object.fromEntries(
		KEYS.map((key) => [key, makeCollection(seed[key] ?? [])]),
	);
	return { ...built, raw: built } as unknown as Collections;
}

const SESSION: Row = {
	id: "s1",
	date: "2026-08-10",
	templateId: "full_body_a",
	phase: "adaptacion",
	completed: true,
	updatedAt: 1000,
	deletedAt: null,
};

const MARK_KEY = "operacion-tesis:sync-mark";

/** `mark` para arrancar con un dispositivo que ya sincronizó alguna vez. */
function stubWorld(mark?: number) {
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

beforeEach(() => {
	vi.unstubAllGlobals();
	stubWorld();
});

/**
 * `createSyncClient` starts a sync as soon as it is built, and a second call
 * while one is in flight collapses into a follow-up rather than running twice.
 * So the tests wait for the exchange to settle instead of triggering another.
 */
async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

// -------------------------------------------------------------------- tests

describe("un cliente que no sabe leer lo guardado no sincroniza", () => {
	it("manda su versión de esquema en cada intercambio", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ changes: [] }), { status: 200 }),
			);
		vi.stubGlobal("fetch", fetchMock);

		const states: SyncState[] = [];
		createSyncClient(makeCollections(), (s) => states.push(s));
		await settle();

		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.schemaVersion).toBe(SYNC_SCHEMA_VERSION);
	});

	/**
	 * The 409 is the whole mechanism. If it surfaced as a generic error the user
	 * would retry forever without knowing that updating is what fixes it — so it
	 * gets its own state rather than a message inside the error one. E4 needed
	 * that distinction: after the 3 → 4 upgrade this is what an E3 device sees,
	 * and it is not a network failure.
	 */
	it("ante un 409 dice que hay que actualizar el dispositivo", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					new Response(
						JSON.stringify({ error: "client-outdated", required: 2 }),
						{ status: 409 },
					),
				),
		);

		const states: SyncState[] = [];
		createSyncClient(makeCollections(), (s) => states.push(s));
		await settle();

		const last = states[states.length - 1];
		expect(last.status).toBe("outdated");
		// Y trae la versión que hace falta, para poder decirlo con un número.
		expect(last).toMatchObject({ required: 2 });
	});

	it("no escribe nada de lo que venía en un intercambio rechazado", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						error: "client-outdated",
						required: 2,
						// Aunque el cuerpo trajera cambios, no deben aplicarse.
						changes: [
							{
								collection: "sessions",
								id: "intruso",
								updatedAt: 9999,
								deletedAt: null,
								data: { id: "intruso", phase: 99 },
							},
						],
					}),
					{ status: 409 },
				),
			),
		);

		const collections = makeCollections({ sessions: [SESSION] });
		createSyncClient(collections, () => {});
		await settle();

		// Ni una fila nueva, ni una tocada.
		expect(collections.sessions.toArray).toEqual([SESSION]);
	});

	it("una respuesta normal sí se aplica, para que el rechazo no sea del canal", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						changes: [
							{
								collection: "sessions",
								id: "remota",
								updatedAt: 2000,
								deletedAt: null,
								data: { ...SESSION, id: "remota", phase: "progresion" },
							},
						],
					}),
					{ status: 200 },
				),
			),
		);

		const collections = makeCollections();
		createSyncClient(collections, () => {});
		await settle();

		expect(collections.sessions.toArray.map((r) => r.id)).toEqual(["remota"]);
	});

	/**
	 * The migration's other half, at the door: a device that has not migrated can
	 * still send a numbered phase, and it must not land as one.
	 */
	it("normaliza una fase numérica que llega de un dispositivo sin migrar", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						changes: [
							{
								collection: "sessions",
								id: "vieja",
								updatedAt: 2000,
								deletedAt: null,
								data: { ...SESSION, id: "vieja", phase: 2 },
							},
						],
					}),
					{ status: 200 },
				),
			),
		);

		const collections = makeCollections();
		createSyncClient(collections, () => {});
		await settle();

		const stored = collections.sessions.toArray[0];
		expect(typeof stored.phase).toBe("string");
		expect(stored.phase).not.toBe(2);
	});
});

// ------------------------------------------------- filas anteriores al sync

/**
 * Rows written before sync existed carry no `updatedAt`, and the old code read
 * that as zero and pushed on `updatedAt > mark`. On a device that had never
 * synced that is `0 > 0`: false. The comment above it said those rows were
 * "pushed once"; they were never pushed at all, and 25 of 43 real sets had been
 * sitting on one device since the day sync was written.
 *
 * The fix is a stated rule rather than a wider comparison — a row with no
 * timestamp of its own is owed its first push, whatever the cursor says — so
 * these tests are about the rule holding in the four situations that matter.
 */
describe("una fila sin `updatedAt` es una fila pendiente de su primer envío", () => {
	const LEGACY: Row = {
		id: "vieja",
		date: "2026-01-05",
		templateId: "full_body_a",
	};
	const STAMPED: Row = { ...SESSION, id: "sellada", updatedAt: 5000 };

	function acceptAll() {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ changes: [] }), { status: 200 }),
			);
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
	}

	const sent = (mock: ReturnType<typeof vi.fn>, call = 0) =>
		JSON.parse(mock.mock.calls[call][1].body as string).changes as Array<{
			id: string;
			updatedAt: number;
		}>;

	it("con la marca en cero, se envía", async () => {
		const fetchMock = acceptAll();
		createSyncClient(makeCollections({ sessions: [LEGACY] }), () => {});
		await settle();

		expect(sent(fetchMock).map((c) => c.id)).toEqual(["vieja"]);
	});

	/**
	 * Y viaja con un sello mayor que cero, que es la mitad que no se ve: el
	 * servidor devuelve lo posterior a `since`, y una fila guardada en 0 no sale
	 * nunca para nadie. Enviarla como 0 la habría dejado igual de aislada.
	 */
	it("y viaja con un sello que el servidor puede devolver", async () => {
		const fetchMock = acceptAll();
		createSyncClient(makeCollections({ sessions: [LEGACY] }), () => {});
		await settle();

		expect(sent(fetchMock)[0].updatedAt).toBe(LEGACY_STAMP);
		expect(LEGACY_STAMP).toBeGreaterThan(0);
	});

	it("con la marca por delante, una fila restaurada después también se envía", async () => {
		vi.unstubAllGlobals();
		stubWorld(9_000_000);
		const fetchMock = acceptAll();

		createSyncClient(makeCollections({ sessions: [LEGACY] }), () => {});
		await settle();

		expect(sent(fetchMock).map((c) => c.id)).toEqual(["vieja"]);
	});

	it("mezcladas, llegan las que tocan y sólo esas", async () => {
		vi.unstubAllGlobals();
		stubWorld(6000);
		const fetchMock = acceptAll();

		createSyncClient(
			makeCollections({
				sessions: [
					LEGACY,
					STAMPED,
					{ ...SESSION, id: "vieja-ya-vista", updatedAt: 3000 },
				],
				sets: [{ id: "serie-sin-sello", sessionId: "vieja" }],
			}),
			() => {},
		);
		await settle();

		// `sellada` es 5000 y la marca 6000: ya la vio. Las dos sin sello, no.
		expect(
			sent(fetchMock)
				.map((c) => c.id)
				.sort(),
		).toEqual(["serie-sin-sello", "vieja"]);
	});

	it("tras un envío aceptado deja de reenviarse", async () => {
		const fetchMock = acceptAll();
		const collections = makeCollections({ sessions: [LEGACY] });
		const client = createSyncClient(collections, () => {});
		await settle();

		await client.syncNow();
		await settle();

		expect(sent(fetchMock, 0).map((c) => c.id)).toEqual(["vieja"]);
		expect(sent(fetchMock, 1)).toEqual([]);
	});

	/** Y el sello queda en la fila, no en una lista aparte que un restore ignoraría. */
	it("el sello se escribe en la propia fila", async () => {
		acceptAll();
		const collections = makeCollections({ sessions: [LEGACY] });
		createSyncClient(collections, () => {});
		await settle();

		expect(collections.sessions.toArray[0]).toMatchObject({
			id: "vieja",
			updatedAt: LEGACY_STAMP,
		});
	});

	it("si el envío falla, sigue debiéndose", async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new Error("se cayó la red"))
			.mockResolvedValue(
				new Response(JSON.stringify({ changes: [] }), { status: 200 }),
			);
		vi.stubGlobal("fetch", fetchMock);

		const collections = makeCollections({ sessions: [LEGACY] });
		const client = createSyncClient(collections, () => {});
		await settle();

		// No se marcó nada: el intercambio no llegó a ninguna parte.
		expect(
			(collections.sessions.toArray[0] as unknown as Row).updatedAt,
		).toBeUndefined();

		await client.syncNow();
		await settle();

		expect(sent(fetchMock, 1).map((c) => c.id)).toEqual(["vieja"]);
	});
});

// ------------------------------------------------------------ 409 vs red

/**
 * Ir por detrás del servidor no es un fallo de red.
 *
 * La compuerta hace su trabajo y devuelve 409; reintentar no arregla nada y
 * actualizar el dispositivo sí. Tratarlo como error genérico decía «no se pudo
 * sincronizar» y dejaba a quien lo lee mirando el wifi.
 */
describe("un cliente por detrás del servidor", () => {
	const source = readFileSync(
		join(import.meta.dirname, "sync-client.ts"),
		"utf8",
	);

	it("tiene su propio estado, no el de error", () => {
		expect(source).toContain('status: "outdated"');
	});

	it("y no se lanza como excepción, que caería en el catch de red", () => {
		const block = source.slice(
			source.indexOf('body.error === "client-outdated"'),
			source.indexOf('body.error === "client-outdated"') + 400,
		);
		expect(block).not.toContain("throw new Error");
		expect(block).toContain("onState({");
	});

	it("la pantalla lo dice con otras palabras", () => {
		const status = readFileSync(
			join(import.meta.dirname, "..", "components", "SyncStatus.tsx"),
			"utf8",
		);
		expect(status).toContain('state.status === "outdated"');
		expect(status).toContain("actualízalo para sincronizar");
	});
});

// ------------------------------------ T-006 · el cuerpo no decide la semántica

/**
 * Lo mismo que prueba `domain/sync.test.ts`, pero atravesando el cliente entero
 * con respuestas de verdad — porque el defecto no estaba en la decisión sino en
 * que la decisión nunca llegaba a ver el status: la respuesta se convertía en
 * `Error(texto)` antes, y el texto de un 404 con cuerpo JSON no menciona 404.
 */
describe("qué estado deja cada respuesta", () => {
	const ultimo = async (response: Response | Error) => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockImplementation(() =>
					response instanceof Error
						? Promise.reject(response)
						: Promise.resolve(response.clone()),
				),
		);
		const states: SyncState[] = [];
		createSyncClient(makeCollections(), (s) => states.push(s));
		await settle();
		return states[states.length - 1];
	};

	it("404 con JSON → solo en este dispositivo", async () => {
		const state = await ultimo(
			new Response(JSON.stringify({ error: "no encontrado" }), {
				status: 404,
			}),
		);
		expect(state.status).toBe("unconfigured");
	});

	it("404 con texto → solo en este dispositivo", async () => {
		const state = await ultimo(new Response("404 Not Found", { status: 404 }));
		expect(state.status).toBe("unconfigured");
	});

	it("404 con el cuerpo vacío → solo en este dispositivo", async () => {
		const state = await ultimo(new Response(null, { status: 404 }));
		expect(state.status).toBe("unconfigured");
	});

	it("404 con HTML de una pantalla de login → solo en este dispositivo", async () => {
		const state = await ultimo(
			new Response("<!doctype html><title>404</title>", { status: 404 }),
		);
		expect(state.status).toBe("unconfigured");
	});

	it("500 → error de sincronización", async () => {
		const state = await ultimo(new Response("{}", { status: 500 }));
		expect(state.status).toBe("error");
	});

	/** La inversa que importa: el texto ya no puede reclasificar nada. */
	it("500 cuyo cuerpo habla de un 404 sigue siendo un error", async () => {
		const state = await ultimo(
			new Response(JSON.stringify({ error: "el proxy devolvió 404" }), {
				status: 500,
			}),
		);
		expect(state.status).toBe("error");
	});

	it("y un Error suelto que mencione 404, sin respuesta, tampoco", async () => {
		const state = await ultimo(new Error("algo 404 algo"));
		expect(state.status).toBe("error");
	});

	it("un servidor caído es un error, no «esta app no tiene sync»", async () => {
		const state = await ultimo(new TypeError("Failed to fetch"));
		expect(state.status).toBe("error");
	});

	it("sin conexión, es estar sin conexión", async () => {
		vi.stubGlobal("navigator", { onLine: false });
		const states: SyncState[] = [];
		createSyncClient(makeCollections(), (s) => states.push(s));
		await settle();
		expect(states[states.length - 1].status).toBe("offline");
	});

	it("409 sigue siendo «actualiza este dispositivo», con su versión", async () => {
		const state = await ultimo(
			new Response(JSON.stringify({ error: "client-outdated", required: 7 }), {
				status: 409,
			}),
		);
		expect(state).toMatchObject({ status: "outdated", required: 7 });
	});

	/** Un 409 sin el cuerpo esperado sigue siendo la compuerta, no un fallo de red. */
	it("y un 409 con otro cuerpo también", async () => {
		const state = await ultimo(new Response("{}", { status: 409 }));
		expect(state.status).toBe("outdated");
	});
});

// --------------------------------------------------------- la guarda estructural

describe("el status no se deduce de un texto", () => {
	const produccion = [
		[
			"sync-client.ts",
			readFileSync(join(import.meta.dirname, "sync-client.ts"), "utf8"),
		],
		[
			"domain/sync.ts",
			readFileSync(
				join(import.meta.dirname, "..", "domain", "sync.ts"),
				"utf8",
			),
		],
		[
			"SyncStatus.tsx",
			readFileSync(
				join(import.meta.dirname, "..", "components", "SyncStatus.tsx"),
				"utf8",
			),
		],
	] as const;

	/** Sin comentarios: explicar el defecto es justo lo que hay que conservar. */
	const codigo = (fuente: string) =>
		fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

	it("nadie busca un número de status dentro de un mensaje", () => {
		for (const [nombre, fuente] of produccion) {
			const limpio = codigo(fuente);
			for (const patron of [
				/\.includes\(\s*["'`][^"'`]*\d{3}/,
				/message\s*\.\s*match/,
				/\.match\(\s*\/[^/]*\d{3}/,
				/message\s*\.\s*indexOf/,
				/message\.includes\(/,
			]) {
				expect(patron.test(limpio), `${nombre} · ${patron}`).toBe(false);
			}
		}
	});

	it("y la clasificación vive en un solo sitio, que recibe el status", () => {
		const cliente = codigo(produccion[0][1]);
		expect(cliente).toContain("classifyFailure({");
		expect(cliente).toContain("error instanceof SyncHttpError");
	});
});
