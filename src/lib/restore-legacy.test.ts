/**
 * A restored row is old, and has to keep looking old.
 *
 * This is the file for the defect that only appeared on real data. A backup
 * written before E3 does not carry `prescriptionContract`, `snapshotId` or
 * `schemaVersion` — not as `null`, but **not at all**, because the fields did
 * not exist when the file was written. Two things then went wrong at once:
 *
 *   - every check compared `=== null`, and `undefined === null` is false, so the
 *     rows the migration exists for were the exact rows it skipped;
 *   - the restore wrote through the stamping path, so each row acquired
 *     `schemaVersion: 3` — destroying the only evidence that told "old row, the
 *     field did not exist yet" from "row written under E3 that lost its field".
 *
 * The second is the one worth naming: a restore is not a write. Filling in
 * today's version because today is when you happened to press the button turns
 * a session from August into a corrupt E3 row, and the app is then right to
 * complain about it.
 *
 * So every fixture below omits properties rather than nulling them. A test that
 * writes `{ prescriptionContract: null }` passes against the broken code.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/photos", () => ({
	readPhotoUrl: vi.fn(),
	savePhoto: vi.fn(),
}));

import type { Collections } from "@/db/collections";
import type { SessionRecord } from "@/domain/schema";
import { dispositionOfSession } from "@/domain/snapshot";
import { SYNC_SCHEMA_VERSION } from "@/domain/sync";
import { importBackup } from "@/lib/backup";
import { markLegacy } from "@/lib/migrate-prescription";
import { planRecovery } from "@/lib/recover-snapshots";

type Row = Record<string, unknown> & { id: string };

/** Stamps on write, exactly as `syncable` does — so the restore path is real. */
function makeCollections(seed: Partial<Record<string, Row[]>> = {}) {
	const KEYS = [
		"sessions",
		"sets",
		"ankleChecks",
		"overrides",
		"customExercises",
		"progressChecks",
		"inspo",
		"phaseEvents",
		"prescriptionBaseline",
		"planAdjustments",
		"planSnapshots",
	];

	const build = (rows: Row[], stamping: boolean) => {
		const byId = new Map(rows.map((r) => [r.id, { ...r }]));
		return {
			get toArray() {
				return [...byId.values()];
			},
			has: (id: string) => byId.has(id),
			insert: (value: Row) => {
				byId.set(
					value.id,
					stamping
						? {
								updatedAt: 1,
								deletedAt: null,
								schemaVersion: SYNC_SCHEMA_VERSION,
								...value,
							}
						: { ...value },
				);
				return {};
			},
			update: (id: string, mutate: (draft: Row) => void) => {
				const draft = { ...(byId.get(id) as Row) };
				mutate(draft);
				if (stamping) draft.updatedAt = 2;
				byId.set(id, draft);
				return {};
			},
			shared: byId,
		};
	};

	const raw: Record<string, ReturnType<typeof build>> = {};
	const wrapped: Record<string, ReturnType<typeof build>> = {};
	for (const key of KEYS) {
		const rows = seed[key] ?? [];
		raw[key] = build(rows, false);
		// The wrapped view stamps; both read the same rows, like the real proxy.
		wrapped[key] = { ...build([], true), shared: raw[key].shared } as never;
		Object.defineProperty(wrapped[key], "toArray", {
			get: () => [...raw[key].shared.values()],
		});
		wrapped[key].has = (id: string) => raw[key].shared.has(id);
		wrapped[key].insert = (value: Row) => {
			raw[key].shared.set(value.id, {
				updatedAt: 1,
				deletedAt: null,
				schemaVersion: SYNC_SCHEMA_VERSION,
				...value,
			});
			return {};
		};
		wrapped[key].update = (id: string, mutate: (draft: Row) => void) => {
			const draft = { ...(raw[key].shared.get(id) as Row) };
			mutate(draft);
			draft.updatedAt = 2;
			raw[key].shared.set(id, draft);
			return {};
		};
	}

	return { ...wrapped, raw } as unknown as Collections;
}

function backupFile(sessions: Row[], name = "backup.json"): File {
	const body = JSON.stringify({
		format: "operacion-tesis-backup",
		version: 1,
		exportedAt: "2026-08-11",
		records: { sessions, sets: [] },
		photos: {},
	});
	return new File([body], name, { type: "application/json" });
}

/** A pre-E3 session: none of the E3 keys are present. */
const PRE_E3: Row = {
	id: "vieja",
	date: "2026-08-10",
	templateId: "full_body_a",
	phase: "adaptacion",
	completed: true,
	notes: null,
	startedAt: null,
	endedAt: null,
	skippedExerciseIds: [],
	extraExerciseIds: [],
};

const sessionOf = (collections: Collections, id: string) =>
	collections.sessions.toArray.find((s) => s.id === id) as
		| (Row & Partial<SessionRecord>)
		| undefined;

// ------------------------------------------------------ A · backup anterior a E3

describe("A · un respaldo anterior a E3", () => {
	it("se restaura sin adquirir metadatos que el archivo no tenía", async () => {
		const collections = makeCollections();
		await importBackup(collections, backupFile([PRE_E3]));

		const row = sessionOf(collections, "vieja");
		expect("schemaVersion" in (row ?? {})).toBe(false);
		expect("prescriptionContract" in (row ?? {})).toBe(false);
		expect("snapshotId" in (row ?? {})).toBe(false);
	});

	it("y la migración la reconoce como legacy", async () => {
		const collections = makeCollections();
		await importBackup(collections, backupFile([PRE_E3]));

		const pendientes = markLegacy(
			collections.sessions.toArray as unknown as SessionRecord[],
		);
		expect(pendientes.map((s) => s.id)).toEqual(["vieja"]);
	});

	it("sin contrato ni sello, se reconstruye en vez de reportarse rota", () => {
		expect(
			dispositionOfSession({
				session: PRE_E3 as unknown as SessionRecord,
				hasSnapshot: false,
				hasSets: true,
				writtenUnderSchema: null,
				contractSince: 3,
			}),
		).toEqual({ kind: "reconstruct" });
	});

	/**
	 * El síntoma más ruidoso del fallo: `undefined !== null` es true, así que una
	 * sesión que nunca tuvo instantánea se denunciaba como una que apuntaba a una
	 * y la había perdido.
	 */
	it("no se denuncia como instantánea desaparecida", () => {
		const plan = planRecovery({
			sessions: [PRE_E3 as unknown as SessionRecord],
			snapshots: [],
			baseline: [],
			adjustments: [],
			phaseAt: () => "adaptacion",
			schemaOf: () => null,
			hasSets: () => true,
			now: 0,
			lastSyncedAt: null,
			idFor: (id) => `rec_${id}`,
		});

		expect(plan.violations).toEqual([]);
		expect(plan.reconstruct.map((s) => s.sessionId)).toEqual(["vieja"]);
	});
});

// ---------------------------------------------------------- B · respaldo schema 2

describe("B · un respaldo de schema 2", () => {
	const schema2: Row = { ...PRE_E3, id: "schema2", schemaVersion: 2 };

	it("conserva su sello", async () => {
		const collections = makeCollections();
		await importBackup(collections, backupFile([schema2]));
		expect(sessionOf(collections, "schema2")?.schemaVersion).toBe(2);
	});

	it("y sigue siendo legacy: el contrato no existía todavía", () => {
		expect(
			dispositionOfSession({
				session: schema2 as unknown as SessionRecord,
				hasSnapshot: false,
				hasSets: true,
				writtenUnderSchema: 2,
				contractSince: 3,
			}),
		).toEqual({ kind: "reconstruct" });
	});
});

// -------------------------------------------------------------- C · respaldo E3

describe("C · un respaldo de E3 en regla", () => {
	const deE3: Row = {
		...PRE_E3,
		id: "nueva",
		schemaVersion: 3,
		prescriptionContract: "snapshot_v1",
		snapshotId: "snap_1",
	};

	it("se conserva exactamente", async () => {
		const collections = makeCollections();
		await importBackup(collections, backupFile([deE3]));

		expect(sessionOf(collections, "nueva")).toMatchObject({
			schemaVersion: 3,
			prescriptionContract: "snapshot_v1",
			snapshotId: "snap_1",
		});
	});

	it("y la migración no la toca", async () => {
		const collections = makeCollections();
		await importBackup(collections, backupFile([deE3]));
		expect(
			markLegacy(collections.sessions.toArray as unknown as SessionRecord[]),
		).toEqual([]);
	});
});

// ------------------------------------------------------- D · fila de E3 corrupta

describe("D · una fila sellada bajo E3 sin contrato", () => {
	const rota: Row = { ...PRE_E3, id: "rota", schemaVersion: 3 };

	/** No es histórica: está rota, y convertirla a legacy taparía el fallo. */
	it("es una violación, no un legacy", () => {
		expect(
			dispositionOfSession({
				session: rota as unknown as SessionRecord,
				hasSnapshot: false,
				hasSets: true,
				writtenUnderSchema: 3,
				contractSince: 3,
			}),
		).toEqual({ kind: "violation", code: "contract-missing" });
	});

	it("y la recuperación la reporta sin reconstruir nada", () => {
		const plan = planRecovery({
			sessions: [rota as unknown as SessionRecord],
			snapshots: [],
			baseline: [],
			adjustments: [],
			phaseAt: () => "adaptacion",
			schemaOf: () => 3,
			hasSets: () => true,
			now: 0,
			lastSyncedAt: null,
			idFor: (id) => `rec_${id}`,
		});

		expect(plan.reconstruct).toEqual([]);
		expect(plan.violations).toEqual([
			{ sessionId: "rota", date: "2026-08-10", code: "contract-missing" },
		]);
	});
});

// --------------------------------------------------- E · restaurar no cambia nada

describe("E · restaurar no reescribe los metadatos del archivo", () => {
	it("ni añade lo que falta ni cambia lo que hay", async () => {
		const collections = makeCollections();
		const rows: Row[] = [
			PRE_E3,
			{ ...PRE_E3, id: "s2", schemaVersion: 2, updatedAt: 111 },
			{
				...PRE_E3,
				id: "s3",
				schemaVersion: 3,
				prescriptionContract: "legacy",
				snapshotId: null,
				updatedAt: 222,
			},
		];
		await importBackup(collections, backupFile(rows));

		expect(sessionOf(collections, "vieja")?.updatedAt).toBeUndefined();
		expect(sessionOf(collections, "s2")?.updatedAt).toBe(111);
		expect(sessionOf(collections, "s3")?.updatedAt).toBe(222);
		expect(sessionOf(collections, "s3")?.prescriptionContract).toBe("legacy");
	});

	/** Lo que rompía: pasar por la capa que estampa la escritura de hoy. */
	it("una escritura normal sí sella, y por eso el restore no puede usarla", () => {
		const collections = makeCollections();
		collections.sessions.insert(PRE_E3 as never);
		expect(sessionOf(collections, "vieja")?.schemaVersion).toBe(
			SYNC_SCHEMA_VERSION,
		);
	});
});

// ------------------------------------------------------------ F · dos veces

describe("F · importar el mismo respaldo dos veces", () => {
	it("converge y no duplica", async () => {
		const collections = makeCollections();
		await importBackup(collections, backupFile([PRE_E3]));
		const primera = collections.sessions.toArray.length;
		await importBackup(collections, backupFile([PRE_E3]));

		expect(collections.sessions.toArray).toHaveLength(primera);
		expect(collections.sessions.toArray).toHaveLength(1);
	});

	it("y sigue sin sello después de la segunda", async () => {
		const collections = makeCollections();
		await importBackup(collections, backupFile([PRE_E3]));
		await importBackup(collections, backupFile([PRE_E3]));
		expect("schemaVersion" in (sessionOf(collections, "vieja") ?? {})).toBe(
			false,
		);
	});
});
