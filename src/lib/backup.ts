/**
 * Backup and restore.
 *
 * The log lives only on the device, which is what keeps it private and what
 * makes it fragile: a cleared browser, or on iOS a deleted home-screen icon,
 * takes it with it. This writes everything — records and photos — into one file
 * you keep wherever you like.
 *
 * Photos are inlined as data URLs so the file is genuinely everything. It is
 * bigger that way, and a backup that silently omits your progress photos would
 * not be a backup.
 */

import type { Collections } from "@/db/collections";
import { persisted } from "@/db/durability";
import { readPhotoUrl, savePhoto } from "@/lib/photos";

const FORMAT = "operacion-tesis-backup";
const VERSION = 1;

type Backup = {
	format: typeof FORMAT;
	version: number;
	exportedAt: string;
	records: Record<string, unknown[]>;
	/** photoId -> data URL. */
	photos: Record<string, string>;
};

const COLLECTION_KEYS = [
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
] as const;

export type BackupSummary = {
	sessions: number;
	sets: number;
	photos: number;
	bytes: number;
};

export async function exportBackup(
	collections: Collections,
	exportedAt: string,
): Promise<{ blob: Blob; filename: string; summary: BackupSummary }> {
	const records: Record<string, unknown[]> = {};
	for (const key of COLLECTION_KEYS) {
		records[key] = collections[key].toArray;
	}

	// Photos are stored as OPFS files; a backup has to carry the bytes.
	const photos: Record<string, string> = {};
	for (const item of collections.inspo.toArray) {
		if (!item.photoId) continue;
		const url = await readPhotoUrl(item.photoId);
		if (!url) continue;
		try {
			const blob = await (await fetch(url)).blob();
			photos[item.photoId] = await blobToDataUrl(blob);
		} finally {
			URL.revokeObjectURL(url);
		}
	}

	const backup: Backup = {
		format: FORMAT,
		version: VERSION,
		exportedAt,
		records,
		photos,
	};
	const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });

	return {
		blob,
		filename: `operacion-tesis-${exportedAt}.json`,
		summary: {
			sessions: records.sessions.length,
			sets: records.sets.length,
			photos: Object.keys(photos).length,
			bytes: blob.size,
		},
	};
}

/**
 * Restores a backup, keyed by id, so importing the same file twice is harmless
 * and importing an older one never deletes what you have logged since. Records
 * already present are overwritten by the backup's version.
 *
 * **A restore is not a write.** Rows go in through `raw`, byte for byte as the
 * file holds them, so whatever metadata they carry — or do not carry — survives.
 * The normal path stamps every write with the current `schemaVersion`, and doing
 * that here would date a session from August as if it had been written under E3
 * today. That stamp is the only evidence distinguishing "old row, the field did
 * not exist yet" from "row written under E3 that lost its field", and the second
 * is a corruption worth shouting about. Restoring must not manufacture the first
 * into the second.
 *
 * So: no `schemaVersion` in the file means no `schemaVersion` in the database,
 * and the bootstrap migrations — which run before anything reads or syncs — get
 * to see the row as old and name it `legacy`. Filling the gap in with today's
 * version here would be the same defect wearing a different hat.
 */
export async function importBackup(
	collections: Collections,
	file: File,
): Promise<BackupSummary> {
	const parsed = JSON.parse(await file.text()) as Partial<Backup>;

	if (parsed.format !== FORMAT) {
		throw new Error("Ese archivo no es un respaldo de Operación Tesis.");
	}
	if ((parsed.version ?? 0) > VERSION) {
		throw new Error("El respaldo viene de una versión más nueva de la app.");
	}

	// Photos first: a record pointing at a missing image would render as broken.
	const photos = parsed.photos ?? {};
	const remapped = new Map<string, string>();
	for (const [photoId, dataUrl] of Object.entries(photos)) {
		const blob = await (await fetch(dataUrl)).blob();
		const file = new File([blob], photoId, { type: blob.type || "image/jpeg" });
		remapped.set(photoId, await savePhoto(file));
	}

	let sessions = 0;
	let sets = 0;
	const written: Array<{ isPersisted?: { promise?: Promise<unknown> } }> = [];

	for (const key of COLLECTION_KEYS) {
		const rows = (parsed.records?.[key] ?? []) as Array<
			Record<string, unknown>
		>;
		for (const row of rows) {
			const id = row.id as string;
			if (typeof id !== "string") continue;

			const value =
				key === "inspo" && typeof row.photoId === "string"
					? { ...row, photoId: remapped.get(row.photoId) ?? row.photoId }
					: row;

			// Through `raw`: the unwrapped collection, which does not stamp.
			written.push(upsert(collections.raw[key], id, value));

			if (key === "sessions") sessions++;
			if (key === "sets") sets++;
		}
	}

	// A restore that has not reached the disk has restored nothing, and this is
	// the one moment where losing it means losing everything.
	await Promise.all(written.map((transaction) => persisted(transaction)));

	return { sessions, sets, photos: remapped.size, bytes: file.size };
}

/**
 * Writes one row into whichever collection it belongs to.
 *
 * Indexing the collections object gives a union of seven differently-typed
 * collections, whose `insert`/`update` overloads TypeScript cannot reconcile
 * into a single callable signature. The rows come from a file we validated the
 * format of and are written back to the collection they were exported from, so
 * this narrows to a structural shape rather than fighting the union.
 */
type UpsertTarget = {
	has(id: string): boolean;
	insert(value: Record<string, unknown>): {
		isPersisted?: { promise?: Promise<unknown> };
	};
	update(
		id: string,
		mutate: (draft: Record<string, unknown>) => void,
	): { isPersisted?: { promise?: Promise<unknown> } };
};

function upsert(
	collection: unknown,
	id: string,
	value: Record<string, unknown>,
): { isPersisted?: { promise?: Promise<unknown> } } {
	const target = collection as UpsertTarget;
	if (target.has(id)) {
		// `Object.assign` copies what the file has and leaves alone what it does
		// not mention — so a row already carrying E3 metadata keeps it, and one
		// that predates E3 does not acquire any.
		return target.update(id, (draft) => Object.assign(draft, value));
	}
	return target.insert(value);
}

/** Triggers the browser's own save dialog. */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	// Revoking immediately can cancel the download in some browsers.
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(new Error("No se pudo leer una imagen."));
		reader.readAsDataURL(blob);
	});
}
