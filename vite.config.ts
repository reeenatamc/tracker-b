import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { serviceWorker } from "./plugins/service-worker.ts";
import { yamlContent } from "./plugins/yaml-content.ts";

const resolvePath = (path: string) =>
	fileURLToPath(new URL(path, import.meta.url));

/**
 * The training program lives in `content/`, which is gitignored: it is personal
 * planning, not source. A fresh clone falls back to the generic sample so the
 * app still builds and runs for anyone.
 */
const contentDir = existsSync(resolvePath("./content"))
	? "./content"
	: "./content.example";

export default defineConfig({
	resolve: {
		tsconfigPaths: true,
		alias: { "@content": resolvePath(contentDir) },
	},
	plugins: [
		yamlContent(),
		devtools(),
		tailwindcss(),
		// SPA mode, not SSR. This app renders from a local database that only
		// exists in the browser, so a server has nothing to render — and a
		// prerendered shell is what lets the service worker cache the whole app
		// and open it with no network at all.
		tanstackStart({
			spa: { enabled: true },
			// A test that sits next to the screen it tests is not a route, and the
			// generator warning that says so four times per build is noise that
			// trains you to ignore build output.
			router: { routeFileIgnorePattern: "\\.test\\.tsx?$" },
		}),
		viteReact(),
		serviceWorker(resolvePath("./public")),
	],
});
