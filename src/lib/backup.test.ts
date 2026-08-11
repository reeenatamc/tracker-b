/**
 * The backup, which is the only thing between a cleared browser and a lost log.
 *
 * The log lives in OPFS and nowhere else. A backup that silently drops a
 * collection, or that restores photos pointing at files it never wrote, fails in
 * the one moment it is needed — when the original is already gone. So the
 * round trip is checked as a round trip: export, import into an empty database,
 * and compare.
 *
 * The collections are stood up in memory rather than mocked loosely: `upsert`
 * branches on `has()`, and a mock that always inserts would hide the fact that
 * importing the same file twice must not duplicate anything.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/photos", () => ({
	readPhotoUrl: vi.fn(),
	savePhoto: vi.fn(),
}));

import type { Collections } from "@/db/collections";
import { exportBackup, importBackup } from "@/lib/backup";
import { readPhotoUrl, savePhoto } from "@/lib/photos";

/**
 * Node has no FileReader, and `blobToDataUrl` needs one. Base64 of the blob's
 * own bytes is exactly what the browser would produce.
 */
class NodeFileReader {
	result: string | null = null;
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;

	readAsDataURL(blob: Blob): void {
		blob
			.arrayBuffer()
			.then((buffer) => {
				const base64 = Buffer.from(buffer).toString("base64");
				this.result = `data:${blob.type || "application/octet-stream"};base64,${base64}`;
				this.onload?.();
			})
			.catch(() => this.onerror?.());
	}
}

(globalThis as { FileReader?: unknown }).FileReader ??= NodeFileReader;
(globalThis as { URL: typeof URL }).URL.revokeObjectURL ??= () => {};

// ------------------------------------------------------------------ in-memory

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

const KEYS = [
	"sessions",
	"sets",
	"ankleChecks",
	"overrides",
	"customExercises",
	"progressChecks",
	"inspo",
] as const;

function makeCollections(seed: Partial<Record<string, Row[]>> = {}) {
	const built = Object.fromEntries(
		KEYS.map((key) => [key, makeCollection(seed[key] ?? [])]),
	);
	return built as unknown as Collections;
}

const SESSION: Row = {
	id: "session-1",
	date: "2026-08-10",
	templateId: "full_body_a",
	phase: 1,
	completed: true,
	notes: null,
	startedAt: null,
	endedAt: null,
	skippedExerciseIds: [],
	extraExerciseIds: [],
};

const SET: Row = {
	id: "set-1",
	sessionId: "session-1",
	exerciseId: "lat_pulldown",
	setNumber: 1,
	isWarmup: false,
	load: 20,
	unit: "kg",
	reps: 12,
	rir: 2,
	anklePain: null,
	note: null,
};

/** Turns an exported blob back into the File the importer expects. */
function asFile(blob: Blob, name = "backup.json"): File {
	return new File([blob], name, { type: "application/json" });
}

beforeEach(() => {
	vi.mocked(readPhotoUrl).mockReset();
	vi.mocked(savePhoto).mockReset();
});

describe("ida y vuelta", () => {
	it("restaura sesiones y series idénticas en una base vacía", async () => {
		const source = makeCollections({ sessions: [SESSION], sets: [SET] });
		const { blob, summary } = await exportBackup(source, "2026-08-11");

		expect(summary.sessions).toBe(1);
		expect(summary.sets).toBe(1);

		const target = makeCollections();
		await importBackup(target, asFile(blob));

		expect(target.sessions.toArray).toEqual([SESSION]);
		expect(target.sets.toArray).toEqual([SET]);
	});

	it("nombra el archivo por la fecha de exportación", async () => {
		const { filename } = await exportBackup(makeCollections(), "2026-08-11");
		expect(filename).toBe("operacion-tesis-2026-08-11.json");
	});

	it("lleva las siete colecciones, no sólo las que se usan a diario", async () => {
		const source = makeCollections({
			sessions: [SESSION],
			sets: [SET],
			ankleChecks: [{ id: "ankle-1", date: "2026-08-10", pain: 0 }],
			overrides: [{ id: "ov-1", exerciseId: "lat_pulldown", startKg: 25 }],
			customExercises: [{ id: "custom-1", name: "Face pull" }],
			progressChecks: [{ id: "pc-1", date: "2026-08-10", weightKg: 60 }],
			inspo: [
				{ id: "in-1", kind: "reference", date: "2026-08-10", photoId: null },
			],
		});

		const { blob } = await exportBackup(source, "2026-08-11");
		const target = makeCollections();
		await importBackup(target, asFile(blob));

		for (const key of KEYS) {
			expect(target[key].toArray, `colección ${key}`).toHaveLength(1);
		}
	});

	it("importar el mismo archivo dos veces no duplica nada", async () => {
		const source = makeCollections({ sessions: [SESSION], sets: [SET] });
		const { blob } = await exportBackup(source, "2026-08-11");

		const target = makeCollections();
		await importBackup(target, asFile(blob));
		await importBackup(target, asFile(blob));

		expect(target.sessions.toArray).toHaveLength(1);
		expect(target.sets.toArray).toHaveLength(1);
	});

	it("un respaldo viejo no borra lo registrado después", async () => {
		const old = makeCollections({ sessions: [SESSION] });
		const { blob } = await exportBackup(old, "2026-08-11");

		const current = makeCollections({
			sessions: [SESSION, { ...SESSION, id: "session-2", date: "2026-08-17" }],
		});
		await importBackup(current, asFile(blob));

		expect(current.sessions.toArray.map((row) => row.id)).toEqual([
			"session-1",
			"session-2",
		]);
	});
});

describe("fotos", () => {
	it("las lleva dentro del archivo y las vuelve a escribir al restaurar", async () => {
		vi.mocked(readPhotoUrl).mockResolvedValue(
			"data:image/jpeg;base64,/9j/4AA=",
		);
		vi.mocked(savePhoto).mockResolvedValue("nueva.jpg");

		const source = makeCollections({
			inspo: [
				{
					id: "in-1",
					kind: "progress",
					date: "2026-08-10",
					photoId: "vieja.jpg",
				},
			],
		});
		const { blob, summary } = await exportBackup(source, "2026-08-11");
		expect(summary.photos).toBe(1);

		const target = makeCollections();
		const restored = await importBackup(target, asFile(blob));

		expect(restored.photos).toBe(1);
		expect(savePhoto).toHaveBeenCalledOnce();
		// La fila tiene que apuntar al archivo recién escrito, no al viejo id.
		expect(target.inspo.toArray[0].photoId).toBe("nueva.jpg");
	});

	it("una foto que ya no está en disco no rompe la exportación", async () => {
		vi.mocked(readPhotoUrl).mockResolvedValue(null);

		const source = makeCollections({
			inspo: [
				{
					id: "in-1",
					kind: "progress",
					date: "2026-08-10",
					photoId: "perdida.jpg",
				},
			],
		});
		const { summary } = await exportBackup(source, "2026-08-11");

		expect(summary.photos).toBe(0);
	});
});

describe("archivos que no son un respaldo", () => {
	it("rechaza otro formato en vez de vaciar la base", async () => {
		const target = makeCollections({ sessions: [SESSION] });
		const alien = asFile(new Blob([JSON.stringify({ hola: "mundo" })]));

		await expect(importBackup(target, alien)).rejects.toThrow(
			/no es un respaldo/i,
		);
		expect(target.sessions.toArray).toHaveLength(1);
	});

	it("rechaza un respaldo de una versión más nueva", async () => {
		const future = asFile(
			new Blob([
				JSON.stringify({
					format: "operacion-tesis-backup",
					version: 99,
					records: {},
					photos: {},
				}),
			]),
		);

		await expect(importBackup(makeCollections(), future)).rejects.toThrow(
			/versión más nueva/i,
		);
	});
});
