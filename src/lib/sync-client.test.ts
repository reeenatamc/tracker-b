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
import { createSyncClient, type SyncState } from "@/lib/sync-client";

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

function stubWorld() {
	const store = new Map<string, string>();
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
	 * would retry forever without knowing that updating is what fixes it.
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
		expect(last.status).toBe("error");
		expect(last).toMatchObject({ message: /actualiza este dispositivo/i });
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
