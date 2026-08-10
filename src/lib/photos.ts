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

/** Stores an image and returns the key to put on the metadata row. */
export async function savePhoto(file: File): Promise<string> {
	const photoId = `${crypto.randomUUID()}.jpg`;
	const blob = await compress(file);

	const directory = await photosDirectory();
	const handle = await directory.getFileHandle(photoId, { create: true });
	const writable = await handle.createWritable();
	await writable.write(blob);
	await writable.close();

	return photoId;
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
