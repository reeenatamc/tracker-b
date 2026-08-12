/**
 * T-003, held down by running the worker instead of describing it.
 *
 * The bug was not in any value the app computed. It was a caching rule: the
 * precache was filled with one shape of request and read with another, and
 * `Vary: Origin` made the two non-equivalent. Nothing short of driving real
 * requests through the real fetch handler, against a cache that implements
 * `Vary` the way the browser does, would have caught it — a mock that matches
 * on URL alone passes both the broken code and the fixed code.
 *
 * So the fake `CacheStorage` below implements `Vary` on purpose. It is the part
 * of this file that does the work.
 */

import { describe, expect, it } from "vitest";
import { renderWorker } from "./service-worker.ts";

const ASSETS = [
	"/",
	"/assets/index-AAAA.js",
	"/assets/history-BBBB.js",
	"/assets/styles-CCCC.css",
];

/** Headers a static server really sends for a built asset. */
const ASSET_HEADERS = {
	"content-type": "text/javascript",
	vary: "Origin",
	"content-encoding": "gzip",
};

const SHELL_ROOT = "<html data-route='/'><script src='/assets/index-AAAA.js'>";
const SHELL_HISTORY = "<html data-route='/history'><script src='/assets/history-BBBB.js'>";

/**
 * A cache that honours `Vary`, like the browser's.
 *
 * `cache.add(url)` stores a request with no `Origin`; a module script asks with
 * one. Under `Vary: Origin` those are different entries, which is the whole of
 * the defect.
 */
function makeCaches() {
	const store = new Map<string, Array<{ request: Request; response: Response }>>();

	const varyMatches = (
		entry: { request: Request; response: Response },
		request: Request,
	) => {
		const vary = entry.response.headers.get("vary");
		if (!vary) return true;
		return vary
			.split(",")
			.map((field) => field.trim().toLowerCase())
			.every(
				(field) =>
					entry.request.headers.get(field) === request.headers.get(field),
			);
	};

	const find = (
		name: string,
		request: Request,
		options?: { ignoreVary?: boolean },
	) => {
		const entries = store.get(name) ?? [];
		const hit = entries.find(
			(entry) =>
				entry.request.url === request.url &&
				(options?.ignoreVary || varyMatches(entry, request)),
		);
		// The real CacheStorage hands back a fresh copy each time; bodies are
		// single-use, and a fake that returns the same object makes the second
		// reader fail for a reason that has nothing to do with caching.
		return hit ? hit.response.clone() : undefined;
	};

	const cacheFor = (name: string) => ({
		add: async (url: string) => {
			// Exactly what `cache.add` does: a request with no Origin header.
			const request = new Request(new URL(url, "https://app.test").href);
			const body = url === "/" ? SHELL_ROOT : `export const x = ${JSON.stringify(url)}`;
			const response = new Response(body, {
				headers: url.endsWith(".js") ? ASSET_HEADERS : { "content-type": "text/html" },
			});
			const entries = store.get(name) ?? [];
			entries.push({ request, response });
			store.set(name, entries);
		},
		put: async (key: string | Request, response: Response) => {
			const request = typeof key === "string" ? new Request(new URL(key, "https://app.test").href) : key;
			const entries = (store.get(name) ?? []).filter(
				(entry) => entry.request.url !== request.url,
			);
			entries.push({ request, response });
			store.set(name, entries);
		},
		match: async (key: string | Request, options?: { ignoreVary?: boolean }) => {
			const request = typeof key === "string" ? new Request(new URL(key, "https://app.test").href) : key;
			return find(name, request, options);
		},
	});

	return {
		api: {
			open: async (name: string) => cacheFor(name),
			match: async (key: string | Request, options?: { ignoreVary?: boolean }) => {
				const request =
					typeof key === "string" ? new Request(new URL(key, "https://app.test").href) : key;
				for (const name of store.keys()) {
					const hit = find(name, request, options);
					if (hit) return hit;
				}
				return undefined;
			},
			keys: async () => [...store.keys()],
			delete: async (name: string) => store.delete(name),
		},
		store,
		cacheFor,
	};
}

type Handlers = Record<string, (event: unknown) => void>;

/** Loads the generated worker into a fake global scope and returns its handlers. */
function loadWorker(online: boolean, caches: ReturnType<typeof makeCaches>) {
	const handlers: Handlers = {};
	const self = {
		addEventListener: (type: string, handler: (event: unknown) => void) => {
			handlers[type] = handler;
		},
		location: { origin: "https://app.test" },
		skipWaiting: () => {},
		clients: { claim: () => Promise.resolve(), matchAll: async () => [] },
		registration: { showNotification: () => Promise.resolve() },
	};

	const fetchImpl = async (request: Request | string) => {
		if (!online) throw new TypeError("Failed to fetch");
		const url = typeof request === "string" ? request : request.url;
		const path = new URL(url).pathname;
		const body =
			path === "/" ? SHELL_ROOT : path === "/history" ? SHELL_HISTORY : `export const x = "${path}"`;
		const response = new Response(body, {
			headers: path.endsWith(".js") ? ASSET_HEADERS : { "content-type": "text/html" },
		});
		Object.defineProperty(response, "type", { value: "basic" });
		return response;
	};

	const source = renderWorker(ASSETS, "testver");
	// biome-ignore lint/security/noGlobalEval: running the generated worker is the point.
	new Function("self", "caches", "fetch", "Response", source)(
		self,
		caches.api,
		fetchImpl,
		Response,
	);
	return handlers;
}

/** Drives one request through the worker's fetch handler. */
async function ask(
	handlers: Handlers,
	request: Request,
): Promise<Response | undefined> {
	let promise: Promise<Response> | undefined;
	handlers.fetch?.({
		request,
		respondWith: (value: Promise<Response>) => {
			promise = value;
		},
	});
	return promise;
}

/** A module script: CORS mode, and it carries an Origin header. */
const moduleRequest = (path: string) =>
	new Request(`https://app.test${path}`, {
		headers: { origin: "https://app.test" },
	});

/** A plain same-origin fetch: no Origin header. */
const plainRequest = (path: string) => new Request(`https://app.test${path}`);

const navigation = (path: string) => {
	const request = new Request(`https://app.test${path}`);
	Object.defineProperty(request, "mode", { value: "navigate" });
	return request;
};

async function install(caches: ReturnType<typeof makeCaches>, online = true) {
	const handlers = loadWorker(online, caches);
	let waited: Promise<unknown> | undefined;
	handlers.install?.({ waitUntil: (p: Promise<unknown>) => { waited = p; } });
	await waited;
	return handlers;
}

// ------------------------------------------------------------------ precache

describe("el precache", () => {
	it("guarda todo lo que se le da", async () => {
		const caches = makeCaches();
		await install(caches);
		expect(caches.store.get("operacion-tesis-testver")).toHaveLength(
			ASSETS.length,
		);
	});
});

// ----------------------------------------------------------------------- T-003

describe("T-003 · un módulo tiene que encontrar su chunk sin red", () => {
	/**
	 * La prueba que falla con el código anterior. La petición del módulo lleva
	 * `Origin`; la que guardó el precache, no; la respuesta dice `Vary: Origin`.
	 * Respetando `Vary` esto es un miss, y sin red un miss es una ruta que no
	 * abre.
	 */
	it("lo encuentra aunque la respuesta diga Vary: Origin", async () => {
		const caches = makeCaches();
		await install(caches);

		const offline = loadWorker(false, caches);
		const response = await ask(offline, moduleRequest("/assets/history-BBBB.js"));

		expect(response?.status).toBe(200);
		expect(response?.headers.get("content-type")).toBe("text/javascript");
		expect(await response?.text()).toContain("export const x");
	});

	it("y un fetch normal del mismo fichero también", async () => {
		const caches = makeCaches();
		await install(caches);

		const offline = loadWorker(false, caches);
		const response = await ask(offline, plainRequest("/assets/history-BBBB.js"));
		expect(response?.status).toBe(200);
	});

	/** Las dos formas de pedirlo tienen que dar lo mismo, que es lo que no pasaba. */
	it("las dos formas de pedirlo dan el mismo cuerpo", async () => {
		const caches = makeCaches();
		await install(caches);
		const offline = loadWorker(false, caches);

		const comoModulo = await ask(offline, moduleRequest("/assets/index-AAAA.js"));
		const comoFetch = await ask(offline, plainRequest("/assets/index-AAAA.js"));

		expect(await comoModulo?.text()).toBe(await comoFetch?.text());
	});

	it("el CSS tampoco se pierde", async () => {
		const caches = makeCaches();
		await install(caches);
		const offline = loadWorker(false, caches);
		const response = await ask(offline, moduleRequest("/assets/styles-CCCC.css"));
		expect(response?.status).toBe(200);
	});
});

// --------------------------------------------------- assets are never the shell

describe("un asset jamás recibe el shell", () => {
	/**
	 * La regla que pediste: una petición a `/assets/*.js` no puede caer en el
	 * fallback de navegación. Servir HTML donde se esperaba JavaScript convierte
	 * un 404 honesto en un error de sintaxis a mitad del arranque.
	 */
	it("un chunk que no está falla, no devuelve HTML", async () => {
		const caches = makeCaches();
		await install(caches);
		const offline = loadWorker(false, caches);

		await expect(
			ask(offline, moduleRequest("/assets/nunca-visto-DDDD.js")),
		).rejects.toThrow();
	});

	it("ni siquiera cuando el shell sí está en la caché", async () => {
		const caches = makeCaches();
		await install(caches);
		expect(await caches.api.match("/")).toBeDefined();

		const offline = loadWorker(false, caches);
		await expect(
			ask(offline, plainRequest("/assets/nunca-visto-DDDD.js")),
		).rejects.toThrow();
	});
});

// ------------------------------------------------------------------ the shell

describe("el shell offline", () => {
	it("una navegación a otra ruta no lo reemplaza", async () => {
		const caches = makeCaches();
		await install(caches);

		// Con red, visitas /history. Su HTML no menciona el chunk de entrada.
		const online = loadWorker(true, caches);
		const visitada = await ask(online, navigation("/history"));
		expect(await visitada?.text()).toContain("data-route='/history'");
		await new Promise((r) => setTimeout(r, 0));

		// El shell guardado sigue siendo el de la raíz.
		const guardado = await caches.api.match("/", { ignoreVary: true });
		expect(await guardado?.text()).toContain("data-route='/'");
	});

	it("una navegación a la raíz sí lo refresca", async () => {
		const caches = makeCaches();
		await install(caches);
		const online = loadWorker(true, caches);
		await ask(online, navigation("/"));
		await new Promise((r) => setTimeout(r, 0));

		const guardado = await caches.api.match("/", { ignoreVary: true });
		expect(await guardado?.text()).toContain("data-route='/'");
	});

	it("sin red, cualquier ruta cae en el shell de la raíz", async () => {
		const caches = makeCaches();
		await install(caches);
		const offline = loadWorker(false, caches);

		for (const ruta of ["/", "/history", "/progress", "/plan"]) {
			const response = await ask(offline, navigation(ruta));
			expect(await response?.text(), ruta).toContain("data-route='/'");
		}
	});
});
