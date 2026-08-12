/**
 * The two endings, and the one that must not exist.
 *
 * The incident that produced this file ended with the app sitting on «Abriendo
 * tu registro…» for ever. Not an error screen — the loading screen, because the
 * throw happened inside a `.then` callback whose own rejection nothing caught.
 * `getCollections()` had already succeeded, so its error handler never ran, and
 * the promise died unobserved.
 *
 * There is no DOM here to render the provider into, so these read the source.
 * That is the right instrument anyway: what went wrong was the *shape* of the
 * chain, not a value it computed, and a shape is exactly what a structural test
 * can hold still.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");
const provider = readFileSync(join(SRC, "db", "provider.tsx"), "utf8");
const root = readFileSync(join(SRC, "routes", "__root.tsx"), "utf8");

describe("el arranque termina en uno de dos sitios", () => {
	it("todo el trabajo va dentro de un try/catch", () => {
		const effect = provider.slice(
			provider.indexOf("useEffect(() => {"),
			provider.indexOf('if (status.state === "error")'),
		);

		expect(effect).toContain("try {");
		expect(effect).toContain("} catch (error");
		// Y las dos escrituras de estado están las dos dentro.
		expect(effect.indexOf('state: "ready"')).toBeGreaterThan(
			effect.indexOf("try {"),
		);
		expect(effect.indexOf('state: "error"')).toBeGreaterThan(
			effect.indexOf("} catch (error"),
		);
	});

	/**
	 * La forma exacta que falló: `getCollections().then(hacerTrabajo, alFallar)`.
	 * El segundo argumento sólo atrapa fallos de la promesa original, nunca los
	 * del primer argumento — y ahí es donde estaba todo el trabajo.
	 */
	it("no vuelve al `.then(alHacerlo, alFallar)` que lo causó", () => {
		expect(provider).not.toMatch(/getCollections\(\)\.then\(/);
	});

	it("el arranque se espera, no se dispara y se olvida", () => {
		expect(provider).toContain("await bootstrap(collections, program)");
	});

	it("y el estado de carga sigue teniendo su salida visible", () => {
		expect(provider).toContain('status.state === "error"');
		expect(provider).toContain("No se pudo abrir tu base de datos");
	});
});

describe("las reconciliaciones ya no viven en el provider", () => {
	/**
	 * No es limpieza: mientras estuvieran aquí, cada una decidía por su cuenta
	 * cuándo leer, y eso es exactamente lo que hizo que las tres leyeran una base
	 * vacía. La barrera sólo puede garantizarse en un sitio.
	 */
	it("el provider llama al arranque y a nada más", () => {
		for (const name of ["syncSeed", "migrateExerciseIds", "migratePhaseIds"]) {
			expect(provider, `${name} sigue suelto en el provider`).not.toContain(
				`${name}(`,
			);
		}
		expect(provider).toContain("bootstrap(");
	});
});

describe("el sync remoto no empieza antes de READY", () => {
	/**
	 * Se sostiene por la composición, no por una comprobación: `CollectionsProvider`
	 * no renderiza sus hijos hasta estar listo, y `SyncProvider` es hijo suyo. Con
	 * la barrera dentro del arranque, «listo» pasa a significar además «hidratada»
	 * — que es lo que impide que el primer `syncOnce()` lea una colección a medias
	 * y que `applyRemote` inserte sobre una fila que sí estaba en disco.
	 */
	it("SyncProvider está dentro de CollectionsProvider", () => {
		const collectionsAt = root.indexOf("<CollectionsProvider>");
		const syncAt = root.indexOf("<SyncProvider>");
		const closeAt = root.indexOf("</CollectionsProvider>");

		expect(collectionsAt).toBeGreaterThan(-1);
		expect(syncAt).toBeGreaterThan(collectionsAt);
		expect(syncAt).toBeLessThan(closeAt);
	});

	it("y los hijos sólo se renderizan en el estado listo", () => {
		const tail = provider.slice(
			provider.indexOf('if (status.state === "error")'),
		);
		// Antes del render de los hijos hay una salida para error y otra para carga.
		expect(tail.indexOf('status.state === "loading"')).toBeLessThan(
			tail.indexOf("{children}"),
		);
		expect(tail).toContain("<CollectionsContext value={status.collections}>");
	});
});
