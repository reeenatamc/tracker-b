/**
 * The bookkeeping that lets the page know whether it is safe to let go.
 *
 * The tracker exists so that no call site has to remember to register anything —
 * thirty-four of them, and the one that forgets is the one that loses a set. So
 * what gets tested here is mostly the awkward parts: that a rejected write still
 * brings the count back to zero, that waiting drains writes that start while you
 * are waiting, and that two legitimate saves in a row both land.
 */

import { describe, expect, it, vi } from "vitest";
import { createDurabilityTracker, durable } from "./durability";

/** A collection whose flush we control. */
function fakeCollection() {
	const settle: Array<{
		resolve: () => void;
		reject: (error: unknown) => void;
	}> = [];

	const write = () => {
		let resolve!: () => void;
		let reject!: (error: unknown) => void;
		const promise = new Promise<void>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		settle.push({ resolve, reject });
		return { isPersisted: { promise } };
	};

	return {
		collection: { insert: write, update: write, delete: write },
		settle,
	};
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("cuenta de escrituras en vuelo", () => {
	it("empieza en cero", () => {
		expect(createDurabilityTracker().pendingCount).toBe(0);
	});

	it("cuenta varias escrituras simultáneas", () => {
		const tracker = createDurabilityTracker();
		const { collection } = fakeCollection();
		const sets = durable(collection, tracker);

		sets.insert();
		sets.insert();
		sets.update();

		expect(tracker.pendingCount).toBe(3);
	});

	it("vuelve a cero cuando todas asientan", async () => {
		const tracker = createDurabilityTracker();
		const { collection, settle } = fakeCollection();
		const sets = durable(collection, tracker);

		sets.insert();
		sets.insert();
		for (const one of settle) one.resolve();
		await flush();

		expect(tracker.pendingCount).toBe(0);
	});

	/**
	 * The one that matters for the page teardown: a failed write must not leave the
	 * count stuck above zero, or the database would never be released again.
	 */
	it("vuelve a cero también cuando una escritura se rechaza", async () => {
		const tracker = createDurabilityTracker();
		const { collection, settle } = fakeCollection();
		const sets = durable(collection, tracker);

		sets.insert();
		sets.insert();
		settle[0].resolve();
		settle[1].reject(new Error("disco lleno"));
		await flush();

		expect(tracker.pendingCount).toBe(0);
	});

	it("guarda el fallo en vez de tragárselo", async () => {
		const tracker = createDurabilityTracker();
		const { collection, settle } = fakeCollection();
		durable(collection, tracker).insert();

		settle[0].reject(new Error("disco lleno"));
		await flush();

		expect(tracker.failures).toHaveLength(1);
		expect((tracker.failures[0].error as Error).message).toBe("disco lleno");
	});

	it("avisa a quien escuche cada vez que cambia", async () => {
		const tracker = createDurabilityTracker();
		const { collection, settle } = fakeCollection();
		const seen: number[] = [];
		tracker.subscribe((pending) => seen.push(pending));

		durable(collection, tracker).insert();
		settle[0].resolve();
		await flush();

		expect(seen).toEqual([1, 0]);
	});
});

describe("whenAllPersisted", () => {
	it("no espera nada cuando no hay nada pendiente", async () => {
		await expect(
			createDurabilityTracker().whenAllPersisted(),
		).resolves.toBeUndefined();
	});

	it("espera a todas las pendientes", async () => {
		const tracker = createDurabilityTracker();
		const { collection, settle } = fakeCollection();
		const sets = durable(collection, tracker);

		sets.insert();
		sets.insert();

		let done = false;
		const waiting = tracker.whenAllPersisted().then(() => {
			done = true;
		});

		settle[0].resolve();
		await flush();
		expect(done, "no puede darse por terminada con una en vuelo").toBe(false);

		settle[1].resolve();
		await waiting;
		expect(done).toBe(true);
	});

	/** Awaiting can let more writes start; draining beats snapshotting once. */
	it("también espera a las que empiezan mientras espera", async () => {
		const tracker = createDurabilityTracker();
		const { collection, settle } = fakeCollection();
		const sets = durable(collection, tracker);

		sets.insert();
		const waiting = tracker.whenAllPersisted();

		// Una segunda escritura entra antes de que la primera asiente.
		settle[0].resolve();
		sets.insert();
		await flush();

		let done = false;
		void waiting.then(() => {
			done = true;
		});
		await flush();
		expect(done).toBe(false);

		settle[1].resolve();
		await waiting;
		expect(tracker.pendingCount).toBe(0);
	});

	it("una escritura rechazada no la deja colgada", async () => {
		const tracker = createDurabilityTracker();
		const { collection, settle } = fakeCollection();
		durable(collection, tracker).insert();

		const waiting = tracker.whenAllPersisted();
		settle[0].reject(new Error("nope"));

		await expect(waiting).resolves.toBeUndefined();
		expect(tracker.pendingCount).toBe(0);
	});
});

describe("qué devuelve el envoltorio", () => {
	it("devuelve la transacción intacta, para que el llamador pueda esperarla", async () => {
		const tracker = createDurabilityTracker();
		const { collection, settle } = fakeCollection();

		const transaction = durable(collection, tracker).insert();
		settle[0].resolve();

		await expect(transaction.isPersisted.promise).resolves.toBeUndefined();
	});

	it("no estorba a lo que no es una escritura", () => {
		const tracker = createDurabilityTracker();
		const collection = { toArray: [1, 2, 3], insert: () => ({}) };

		expect(durable(collection, tracker).toArray).toEqual([1, 2, 3]);
	});

	it("una escritura sin promesa no se queda contada para siempre", () => {
		const tracker = createDurabilityTracker();
		const collection = { insert: () => ({}) };

		durable(collection, tracker).insert();
		expect(tracker.pendingCount).toBe(0);
	});

	it("dos escrituras legítimas seguidas persisten las dos", async () => {
		const tracker = createDurabilityTracker();
		const { collection, settle } = fakeCollection();
		const sets = durable(collection, tracker);

		const first = sets.insert();
		const second = sets.insert();
		settle[0].resolve();
		settle[1].resolve();

		await Promise.all([first.isPersisted.promise, second.isPersisted.promise]);
		expect(tracker.pendingCount).toBe(0);
		expect(tracker.failures).toEqual([]);
	});
});

describe("cerrar la base al descargar la página", () => {
	/** The behaviour `collections.ts` implements, exercised on its own. */
	function releaseOnUnload(
		close: () => void,
		tracker: ReturnType<typeof createDurabilityTracker>,
	) {
		return () => {
			if (tracker.pendingCount > 0) return;
			close();
		};
	}

	it("con escrituras pendientes no se cierra", () => {
		const tracker = createDurabilityTracker();
		const { collection } = fakeCollection();
		durable(collection, tracker).insert();

		const close = vi.fn();
		releaseOnUnload(close, tracker)();

		expect(close).not.toHaveBeenCalled();
	});

	it("sin nada pendiente se cierra y se sueltan los bloqueos", async () => {
		const tracker = createDurabilityTracker();
		const { collection, settle } = fakeCollection();
		durable(collection, tracker).insert();
		settle[0].resolve();
		await flush();

		const close = vi.fn();
		releaseOnUnload(close, tracker)();

		expect(close).toHaveBeenCalledOnce();
	});
});
