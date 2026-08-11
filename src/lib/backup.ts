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

			upsert(collections[key], id, value);

			if (key === "sessions") sessions++;
			if (key === "sets") sets++;
		}
	}

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
	insert(value: Record<string, unknown>): unknown;
	update(id: string, mutate: (draft: Record<string, unknown>) => void): unknown;
};

function upsert(
	collection: unknown,
	id: string,
	value: Record<string, unknown>,
): void {
	const target = collection as UpsertTarget;
	if (target.has(id)) {
		target.update(id, (draft) => Object.assign(draft, value));
	} else {
		target.insert(value);
	}
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
