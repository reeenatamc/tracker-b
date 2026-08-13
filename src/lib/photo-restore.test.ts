/**
 * Restaurar una foto no es dar de alta una foto nueva.
 *
 * `importBackup` llamaba a la misma función que la pantalla de inspo, y esa
 * función empieza comprimiendo. Comprimir está bien **al entrar** una foto desde
 * la cámara: una foto de móvil son 3–5 MB y guardarlas enteras llena el
 * dispositivo. Al restaurar no entra nada nuevo: vuelve una foto que ya se
 * guardó, ya comprimida, y volver a codificarla la degrada otra vez. Medido
 * sobre el respaldo real: 277 kB pasaban a 192 kB en la primera pasada, y cada
 * ciclo posterior cambiaba los bytes de nuevo.
 *
 * Lo que se prueba aquí no es la compresión —que es correcta donde está— sino
 * **qué camino toma la restauración**. Por eso el doble de `@/lib/photos` finge
 * un ingreso que altera los bytes, como hace el de verdad, y una restauración
 * que los escribe tal cual: si el respaldo volviera a pasar por el ingreso, la
 * cadena de abajo lo delata en la primera vuelta.
 *
 * Ninguna foto real: los bytes son sintéticos.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/** Un almacén de blobs en memoria, con la misma forma que OPFS por id. */
const almacen = new Map<string, Uint8Array>();

/** El ingreso re-codifica. Aquí, marcando los bytes; allí, con un canvas. */
let generacion = 0;

vi.mock("@/lib/photos", () => ({
	ingestPhoto: vi.fn(async (file: File) => {
		const photoId = `ingerida-${++generacion}.jpg`;
		const bytes = new Uint8Array(await file.arrayBuffer());
		// Re-codificar cambia los bytes. Esa es toda la diferencia que importa.
		almacen.set(photoId, Uint8Array.from([...bytes, generacion]));
		return photoId;
	}),
	restorePhoto: vi.fn(async (photoId: string, blob: Blob) => {
		almacen.set(photoId, new Uint8Array(await blob.arrayBuffer()));
	}),
	readPhotoUrl: vi.fn(async (photoId: string) => {
		const bytes = almacen.get(photoId);
		return bytes ? `blob:${photoId}` : null;
	}),
}));

import { exportBackup, importBackup } from "@/lib/backup";
import { readPhotoUrl, restorePhoto } from "@/lib/photos";

// ------------------------------------------------------------------ el mundo

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

const CLAVES = [
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
];

function mundo(inspo: Row[] = []) {
	const built = Object.fromEntries(
		CLAVES.map((k) => [k, makeCollection(k === "inspo" ? inspo : [])]),
	);
	// biome-ignore lint/suspicious/noExplicitAny: doble de colecciones en memoria
	return { ...built, raw: built } as any;
}

const FOTO = "la-de-siempre.jpg";
const BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5]);

const INSPO: Row = {
	id: "insp-1",
	kind: "photo",
	photoId: FOTO,
	note: "",
	url: null,
	updatedAt: 1000,
	deletedAt: null,
};

const huella = (bytes: Uint8Array | undefined) =>
	bytes ? [...bytes].join(",") : "(no está)";

const comoArchivo = (texto: string) =>
	new File([texto], "respaldo.json", { type: "application/json" });

beforeEach(() => {
	almacen.clear();
	generacion = 0;
	vi.mocked(readPhotoUrl).mockClear();
	vi.mocked(restorePhoto).mockClear();
	almacen.set(FOTO, BYTES);
	/*
	 * Dos formas de URL, como en la app: el export lee el blob guardado por su
	 * object URL, y el import lee los bytes del `data:` que lleva el archivo.
	 */
	vi.stubGlobal("fetch", async (url: string) => {
		if (url.startsWith("blob:")) {
			return new Response(
				(almacen.get(url.slice("blob:".length)) ?? new Uint8Array()).slice()
					.buffer as ArrayBuffer,
			);
		}
		const binario = atob(url.slice(url.indexOf(",") + 1));
		return new Response(
			Uint8Array.from(binario, (c) => c.charCodeAt(0)).buffer as ArrayBuffer,
		);
	});
	vi.stubGlobal("URL", {
		createObjectURL: () => "blob:x",
		revokeObjectURL: () => {},
	});
	/*
	 * `FileReader` es de navegador y el respaldo lo usa para meter la foto como
	 * `data:` URL. El doble hace lo mismo con los bytes de verdad, así que la
	 * cadena export→import atraviesa la misma codificación que en la app.
	 */
	vi.stubGlobal(
		"FileReader",
		class {
			result: string | null = null;
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			async readAsDataURL(blob: Blob) {
				const bytes = new Uint8Array(await blob.arrayBuffer());
				const base64 = btoa(String.fromCharCode(...bytes));
				this.result = `data:${blob.type || "image/jpeg"};base64,${base64}`;
				this.onload?.();
			}
		},
	);
});

/** Exporta desde un mundo con la foto puesta, y devuelve el JSON. */
async function exportar(): Promise<string> {
	const collections = mundo([INSPO]);
	const { blob } = await exportBackup(collections, "2026-08-13");
	return blob.text();
}

/** Restaura en un mundo vacío y devuelve lo que quedó. */
async function restaurar(json: string) {
	const collections = mundo();
	const resumen = await importBackup(collections, comoArchivo(json));
	return { collections, resumen };
}

// --------------------------------------------------------- la cadena de T-007

describe("una foto que va y vuelve es la misma foto", () => {
	it("restaurar conserva los bytes", async () => {
		const json = await exportar();
		almacen.clear();

		await restaurar(json);

		expect(huella(almacen.get(FOTO))).toBe(huella(BYTES));
	});

	it("y conserva el id, que el respaldo ya traía", async () => {
		const json = await exportar();
		almacen.clear();

		const { collections } = await restaurar(json);

		expect([...almacen.keys()]).toEqual([FOTO]);
		expect(collections.raw.inspo.toArray[0].photoId).toBe(FOTO);
	});

	it("restaurar dos veces el mismo respaldo da exactamente lo mismo", async () => {
		const json = await exportar();
		almacen.clear();

		await restaurar(json);
		const primera = huella(almacen.get(FOTO));
		await restaurar(json);

		expect(huella(almacen.get(FOTO))).toBe(primera);
		expect([...almacen.keys()], "un blob duplicado").toEqual([FOTO]);
	});

	/**
	 * La regresión directa de T-007. Con el código anterior cada vuelta cambiaba
	 * los bytes y acuñaba un id nuevo, así que la degradación era generacional:
	 * bastaba con restaurar de vez en cuando para ir perdiendo la foto.
	 */
	it("export → restore → export, cinco veces, y la huella no se mueve", async () => {
		const huellas: string[] = [];
		const ids: string[][] = [];

		let json = await exportar();
		for (let vuelta = 0; vuelta < 5; vuelta++) {
			almacen.clear();
			await restaurar(json);
			huellas.push(huella(almacen.get(FOTO)));
			ids.push([...almacen.keys()]);
			json = await exportar();
		}

		expect(new Set(huellas).size, `huellas distintas: ${huellas}`).toBe(1);
		expect(huellas[0]).toBe(huella(BYTES));
		expect(new Set(ids.flat())).toEqual(new Set([FOTO]));
	});
});

// ------------------------------------------------------------- referencias

describe("las referencias siguen apuntando a algo", () => {
	it("la fila de inspo no se reapunta a un id nuevo", async () => {
		const json = await exportar();
		almacen.clear();

		const { collections } = await restaurar(json);
		const fila = collections.raw.inspo.toArray[0];

		expect(fila.photoId).toBe(FOTO);
		expect(almacen.has(fila.photoId), "referencia rota").toBe(true);
	});

	it("cero referencias rotas y cero blobs duplicados", async () => {
		const json = await exportar();
		almacen.clear();
		const { collections } = await restaurar(json);

		const referencias = collections.raw.inspo.toArray
			.map((fila: Row) => fila.photoId)
			.filter(Boolean) as string[];

		expect(referencias.filter((id) => !almacen.has(id))).toEqual([]);
		expect(almacen.size).toBe(new Set(referencias).size);
	});

	/**
	 * Una fila que apunta a una foto que el respaldo no trae ya venía así: en el
	 * registro real hay una, de una entrada borrada. No es motivo para fallar la
	 * restauración, y tampoco para inventar un blob.
	 */
	it("una referencia que el respaldo no trae no rompe el import", async () => {
		const collections = mundo([
			{ ...INSPO, id: "insp-2", photoId: "fantasma.jpg" },
		]);
		const json = JSON.stringify({
			format: "operacion-tesis-backup",
			version: 1,
			exportedAt: "2026-08-13",
			records: { inspo: collections.raw.inspo.toArray },
			photos: {},
		});

		const destino = mundo();
		const resumen = await importBackup(destino, comoArchivo(json));

		expect(resumen.photos).toBe(0);
		expect(destino.raw.inspo.toArray[0].photoId).toBe("fantasma.jpg");
	});
});

// -------------------------------------------------------------- durabilidad

describe("el import no termina bien si una foto no llegó", () => {
	it("un blob que falla al escribirse hace fallar el import entero", async () => {
		const json = await exportar();
		vi.mocked(restorePhoto).mockRejectedValueOnce(new Error("OPFS lleno"));

		await expect(restaurar(json)).rejects.toThrow(/foto/i);
	});

	it("y reintentarlo después funciona, porque escribir es idempotente", async () => {
		const json = await exportar();
		vi.mocked(restorePhoto).mockRejectedValueOnce(new Error("OPFS lleno"));
		await expect(restaurar(json)).rejects.toThrow();

		almacen.clear();
		const { resumen } = await restaurar(json);

		expect(resumen.photos).toBe(1);
		expect(huella(almacen.get(FOTO))).toBe(huella(BYTES));
	});
});

// ------------------------------------------------- la línea entre los caminos

describe("restaurar y dar de alta son dos caminos distintos", () => {
	it("el respaldo no toca el camino de ingreso", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const fuente = readFileSync(join(import.meta.dirname, "backup.ts"), "utf8");

		expect(fuente).toContain("restorePhoto");
		expect(fuente, "el respaldo volvería a comprimir").not.toContain(
			"ingestPhoto",
		);
		// Y no vuelve a acuñar ids: el respaldo ya trae el suyo.
		expect(fuente).not.toContain("remapped");
	});

	it("dar de alta una foto sigue pasando por el ingreso", async () => {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		const inspo = readFileSync(
			join(import.meta.dirname, "..", "routes", "inspo.tsx"),
			"utf8",
		);

		expect(inspo).toContain("ingestPhoto");
		expect(inspo).not.toContain("restorePhoto");
	});
});
