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
	restorePhoto: vi.fn(),
}));

import type { Collections } from "@/db/collections";
import { PROGRAM } from "@/domain/__fixtures__/program";
import { phaseForDate } from "@/domain/phase-events";
import type { PhaseEvent } from "@/domain/schema";
import { exportBackup, importBackup } from "@/lib/backup";
import { migratePhaseIds } from "@/lib/migrate-phase-ids";
import { readPhotoUrl, restorePhoto } from "@/lib/photos";

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
	"phaseEvents",
	"prescriptionBaseline",
	"planAdjustments",
	"planSnapshots",
	"planVersions",
] as const;

function makeCollections(seed: Partial<Record<string, Row[]>> = {}) {
	const built = Object.fromEntries(
		KEYS.map((key) => [key, makeCollection(seed[key] ?? [])]),
	);
	// `raw` is the same collections unwrapped — the migration writes through it so
	// a correction does not look like a fresh local edit.
	return { ...built, raw: built } as unknown as Collections;
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

const PHASE_EVENT: Row = {
	id: "seed-phase-adaptacion",
	kind: "transition",
	fromPhaseId: null,
	toPhaseId: "adaptacion",
	occurredOn: "2026-08-10",
	plannedFor: "2026-08-10",
	trigger: "planned",
	reason: "",
	reviewId: null,
	createdAt: 1,
};

/**
 * A named capture of the plan, with everything a restore has to give back
 * untouched: the two id sets, the fingerprint, its size and the two dates.
 */
const VERSION: Row = {
	id: "v3",
	name: "v3",
	cutAt: "2026-10-04",
	knows: { adjustmentIds: ["A1", "R1"], phaseEventIds: ["E1"] },
	createdAt: 1_760_000_000_000,
	reason: "antes de cambiar el bloque",
	baselineFingerprint: "abc123",
	baselineSize: 26,
};

/** Turns an exported blob back into the File the importer expects. */
function asFile(blob: Blob, name = "backup.json"): File {
	return new File([blob], name, { type: "application/json" });
}

beforeEach(() => {
	vi.mocked(readPhotoUrl).mockReset();
	vi.mocked(restorePhoto).mockReset();
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

	it("lleva todas las colecciones, no sólo las que se usan a diario", async () => {
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
			// The phase log has to travel too: restored without it, every date would
			// fall back to the first phase and the history would quietly relabel.
			phaseEvents: [PHASE_EVENT],
			// And the plan, in its three parts. A backup without the snapshots would
			// restore sessions whose prescription nobody could ever recover.
			prescriptionBaseline: [{ id: "slot_full_body_a_01", sets: 2 }],
			planAdjustments: [{ id: "adj-1", entryId: "slot_full_body_a_01" }],
			planSnapshots: [{ id: "snap-1", sessionId: SESSION.id, entries: [] }],
			planVersions: [VERSION],
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
		expect(restorePhoto).toHaveBeenCalledOnce();
		/*
		 * Con su id, el que traía el archivo. Esta prueba exigía lo contrario —que
		 * la fila apuntara a un archivo recién escrito— y esa expectativa *era* el
		 * defecto: cada restauración acuñaba un id nuevo y recomprimía la imagen.
		 * Ver T-007.
		 */
		expect(restorePhoto).toHaveBeenCalledWith("vieja.jpg", expect.anything());
		expect(target.inspo.toArray[0].photoId).toBe("vieja.jpg");
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

/**
 * The recovery that actually matters: a backup taken before E2, restored after.
 *
 * A backup is the one thing that survives a cleared browser, and the moment it
 * stops being restorable across a migration it has quietly stopped being a
 * backup. So this walks the whole path — import, migrate, seed, verify, export
 * again — rather than checking that the file parses.
 */
describe("un respaldo de E1 se recupera en E2", () => {
	/** Sessions as E1 wrote them: `phase` is a number. */
	const E1_BACKUP = {
		format: "operacion-tesis-backup",
		version: 1,
		exportedAt: "2026-08-20",
		records: {
			sessions: [
				{ ...SESSION, id: "s1", date: "2026-08-10", phase: 1 },
				{ ...SESSION, id: "s2", date: "2026-09-01", phase: 2 },
				{ ...SESSION, id: "s3", date: "2026-12-01", phase: 4 },
			],
			sets: [SET],
		},
		photos: {},
	};

	it("conserva la fase de cada sesión y deja el historial entero", async () => {
		const target = makeCollections();
		await importBackup(target, asFile(new Blob([JSON.stringify(E1_BACKUP)])));

		// Tal cual entra: todavía numérica, porque el respaldo es de antes.
		expect(target.sessions.toArray.map((row) => row.phase)).toEqual([1, 2, 4]);

		const report = migratePhaseIds(target, PROGRAM);

		expect(report.sessionsMigrated).toBe(3);
		expect(report.unmapped).toEqual([]);
		expect(report.eventsSeeded).toBe(4);

		// Cada sesión conserva su fase: 1 era adaptación y lo sigue siendo.
		expect(target.sessions.toArray.map((row) => [row.id, row.phase])).toEqual([
			["s1", "adaptacion"],
			["s2", "progresion"],
			["s3", "definicion_tesis"],
		]);

		// Y el historial sigue completo.
		expect(target.sets.toArray).toHaveLength(1);
	});

	it("la fase derivada de cada fecha coincide con la que quedó guardada", async () => {
		const target = makeCollections();
		await importBackup(target, asFile(new Blob([JSON.stringify(E1_BACKUP)])));
		migratePhaseIds(target, PROGRAM);

		const events = target.phaseEvents.toArray as unknown as PhaseEvent[];
		for (const row of target.sessions.toArray) {
			expect(
				phaseForDate(PROGRAM, events, row.date as string).id,
				`sesión ${row.id}`,
			).toBe(row.phase);
		}
	});

	it("y vuelve a exportarse sin pérdidas", async () => {
		const target = makeCollections();
		await importBackup(target, asFile(new Blob([JSON.stringify(E1_BACKUP)])));
		migratePhaseIds(target, PROGRAM);

		const { blob } = await exportBackup(target, "2026-08-21");
		const roundTripped = makeCollections();
		await importBackup(roundTripped, asFile(blob));

		expect(roundTripped.sessions.toArray).toEqual(target.sessions.toArray);
		// El log de fases viaja con él: sin esto, restaurar perdería las transiciones.
		expect(roundTripped.phaseEvents.toArray).toHaveLength(4);
	});
});

// -------------------------------------------------------------- versiones

describe("una versión sobrevive al viaje sin que nadie la recalcule", () => {
	/**
	 * Lo que hay que comprobar aquí no es que viaje, sino que llegue **igual**.
	 * Una versión es una afirmación sobre lo que se sabía; recalcular su corte al
	 * restaurarla la convertiría en una afirmación sobre lo que se sabe hoy, que
	 * es justo lo que la hace inútil.
	 */
	it("conserva corte, huella, tamaño y las dos fechas", async () => {
		const source = makeCollections({ planVersions: [VERSION] });
		const { blob } = await exportBackup(source, "2026-12-01");

		const target = makeCollections();
		await importBackup(target, asFile(blob));

		expect(target.planVersions.toArray).toEqual([VERSION]);
	});

	it("y ni el orden de los ids se toca", async () => {
		const desordenada: Row = {
			...VERSION,
			id: "v4",
			knows: { adjustmentIds: ["Z", "A"], phaseEventIds: ["E9", "E1"] },
		};
		const source = makeCollections({ planVersions: [desordenada] });
		const { blob } = await exportBackup(source, "2026-12-01");
		const target = makeCollections();
		await importBackup(target, asFile(blob));

		expect(target.planVersions.toArray[0]).toEqual(desordenada);
	});

	it("importar dos veces no la duplica ni la altera", async () => {
		const source = makeCollections({ planVersions: [VERSION] });
		const { blob } = await exportBackup(source, "2026-12-01");
		const target = makeCollections();
		await importBackup(target, asFile(blob));
		await importBackup(target, asFile(blob));

		expect(target.planVersions.toArray).toEqual([VERSION]);
	});
});
