/**
 * Photo storage.
 *
 * Images are files in OPFS, next to the database but not inside it. Two reasons:
 * a live query over the metadata never pulls megabytes of image into memory, and
 * a photo is read only when it is actually shown.
 *
 * Nothing here touches the network. Your photos never leave the device — not to
 * the server, not to the deploy, not to git.
 */

const DIRECTORY = "photos";

/** Long edge, in pixels. A phone photo is ~4000px; this is plenty to compare. */
const MAX_EDGE = 1400;
const QUALITY = 0.82;

async function photosDirectory(): Promise<FileSystemDirectoryHandle> {
	const root = await navigator.storage.getDirectory();
	return root.getDirectoryHandle(DIRECTORY, { create: true });
}

/**
 * Downscales and re-encodes before storing. A raw phone photo is 3–5 MB; at this
 * size it lands around 200 KB, which is the difference between a photo diary you
 * can keep for a year and one that fills the device.
 */
async function compress(file: File): Promise<Blob> {
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
	const width = Math.round(bitmap.width * scale);
	const height = Math.round(bitmap.height * scale);

	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("No se pudo procesar la imagen.");
	context.drawImage(bitmap, 0, 0, width, height);
	bitmap.close();

	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, "image/jpeg", QUALITY),
	);
	if (!blob) throw new Error("No se pudo comprimir la imagen.");
	return blob;
}

/**
 * Writes bytes under an id, and does not return until they are on disk.
 *
 * `close()` is what flushes an OPFS writable; resolving before it lands would
 * let a caller report a photo as stored while it is still in memory.
 */
async function writePhoto(photoId: string, blob: Blob): Promise<void> {
	const directory = await photosDirectory();
	const handle = await directory.getFileHandle(photoId, { create: true });
	const writable = await handle.createWritable();
	await writable.write(blob);
	await writable.close();
}

/**
 * A photo arriving for the first time, from the camera or the library.
 *
 * This is the path that may change the bytes, because a raw phone photo has to
 * be made small enough to keep, and it is the path that mints the id — there is
 * nothing yet for the id to come from.
 */
export async function ingestPhoto(file: File): Promise<string> {
	const photoId = `${crypto.randomUUID()}.jpg`;
	await writePhoto(photoId, await compress(file));
	return photoId;
}

/**
 * A photo that was already stored and is coming back, from a backup.
 *
 * Deliberately not `ingestPhoto` with a flag. Restoring is not a quieter kind of
 * ingesting: the bytes are already a stored fact and the id already exists, so
 * there is nothing to derive and nothing to normalise. Compressing here degraded
 * the image on every restore — 277 kB became 192 kB on the first pass and the
 * bytes moved again on each one after — and minting a new id left the previous
 * one referenced by nothing. See T-007 in `docs/issues.md`.
 *
 * The id comes from the caller because the backup carries it: it is the key of
 * the `photos` map, written when the photo was first ingested.
 */
export async function restorePhoto(photoId: string, blob: Blob): Promise<void> {
	await writePhoto(photoId, blob);
}

/**
 * An object URL for a stored photo, or null if the file is gone. Callers must
 * revoke the URL when the image unmounts, or the blobs stay pinned in memory.
 */
export async function readPhotoUrl(photoId: string): Promise<string | null> {
	try {
		const directory = await photosDirectory();
		const handle = await directory.getFileHandle(photoId);
		return URL.createObjectURL(await handle.getFile());
	} catch {
		return null;
	}
}

export async function deletePhoto(photoId: string): Promise<void> {
	try {
		const directory = await photosDirectory();
		await directory.removeEntry(photoId);
	} catch {
		// Already gone: deleting the metadata row is what matters.
	}
}

/** Total bytes held by photos, for the storage line on the inspo screen. */
export async function photosSize(): Promise<number> {
	let total = 0;
	try {
		const directory = await photosDirectory();
		for await (const handle of directory.values()) {
			if (handle.kind === "file") total += (await handle.getFile()).size;
		}
	} catch {
		return 0;
	}
	return total;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
