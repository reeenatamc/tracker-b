/**
 * Publishes the built app to Vercel, then verifies nothing is left open.
 *
 * Deploys `dist/client` rather than letting Vercel build: the program lives in
 * `content/`, which is gitignored, so a remote build would ship the generic
 * example instead — and this way the raw YAML never reaches Vercel at all.
 *
 * Two things here are guardrails, not conveniences:
 *
 * 1. The project link is read from the repo root and passed as environment
 *    variables. The CLI otherwise looks for `.vercel` inside the directory being
 *    deployed — which every build wipes — and a missing link makes it silently
 *    create a NEW, unprotected project named after the folder.
 *
 * 2. Vercel's Standard Protection covers deployment URLs but not the project's
 *    auto-assigned production domain, and that domain is re-attached on every
 *    production deploy. So after deploying, every alias is probed and any one
 *    that answers without the SSO redirect is removed. The bundle contains the
 *    training program; none of its URLs may be public.
 */

import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "dist/client");
const LINK = resolve(ROOT, ".vercel/project.json");

function fail(message) {
	console.error(`\n  ${message}\n`);
	process.exit(1);
}

function vercel(args, options = {}) {
	return spawnSync("npx", ["--yes", "vercel@latest", ...args], {
		encoding: "utf8",
		...options,
		env: { ...process.env, ...env, ...options.env },
	});
}

if (!existsSync(OUT_DIR)) fail("No hay build. Corre `npm run build` primero.");
if (!existsSync(LINK)) {
	fail(
		"Este repo no está enlazado a un proyecto de Vercel.\n" +
			"  Corre:  npx vercel link --project tracker-b\n" +
			"  Sin el enlace, Vercel crearía un proyecto nuevo y SIN protección.",
	);
}

const { projectId, orgId } = JSON.parse(readFileSync(LINK, "utf8"));
if (!projectId || !orgId) fail("`.vercel/project.json` está incompleto.");
const env = { VERCEL_PROJECT_ID: projectId, VERCEL_ORG_ID: orgId };

copyFileSync(resolve(ROOT, "deploy/vercel.json"), resolve(OUT_DIR, "vercel.json"));

/*
 * The sync endpoint ships alongside the static build. Vercel turns any `api/*`
 * file in the uploaded directory into a serverless function, and installs the
 * dependencies listed in a package.json next to it — so the function gets its
 * driver without the app's whole dependency tree coming along.
 */
mkdirSync(resolve(OUT_DIR, "api"), { recursive: true });
copyFileSync(resolve(ROOT, "api/sync.ts"), resolve(OUT_DIR, "api/sync.ts"));

const { dependencies } = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
writeFileSync(
	resolve(OUT_DIR, "package.json"),
	`${JSON.stringify(
		{
			name: "operacion-tesis-api",
			private: true,
			dependencies: { postgres: dependencies.postgres },
		},
		null,
		2,
	)}\n`,
);

const deployed = vercel(["deploy", "--prod", "--yes", OUT_DIR], {
	stdio: ["inherit", "pipe", "inherit"],
});
if (deployed.status !== 0) fail("El deploy falló.");

// The CLI mixes progress output and JSON into stdout, so pull the host out
// rather than trusting any single line to be the URL.
const deploymentHost = ((deployed.stdout ?? "").match(/[a-z0-9-]+\.vercel\.app/g) ?? []).at(-1);
if (!deploymentHost) fail("No se pudo leer la URL del despliegue.");
console.log(`\n  Desplegado: https://${deploymentHost}`);

/** True when the URL hands you to Vercel's login instead of serving the app. */
async function isProtected(url) {
	try {
		const response = await fetch(url, { redirect: "manual" });
		const location = response.headers.get("location") ?? "";
		return response.status === 404 || location.startsWith("https://vercel.com/sso");
	} catch {
		// Unreachable is not proof of protection, so treat it as unknown-but-safe
		// only after the request genuinely failed rather than returned a page.
		return true;
	}
}

/*
 * `vercel alias ls` lists the whole account, so only the rows whose source is
 * the deployment we just created are considered. Anything broader would reach
 * into unrelated projects — an earlier version of this script took down a
 * different site's production alias that way.
 */
const aliasList = vercel(["alias", "ls"]);
const aliases = [
	...new Set(
		(aliasList.stdout ?? "")
			.split("\n")
			.filter((line) => line.includes(deploymentHost))
			.flatMap((line) => line.match(/[a-z0-9-]+\.vercel\.app/g) ?? [])
			.filter((host) => host !== deploymentHost),
	),
];

console.log("\n  Comprobando protección de cada URL:");
let stable = null;

for (const host of aliases) {
	const url = `https://${host}`;
	if (await isProtected(url)) {
		console.log(`    🔒 ${host}`);
		stable ??= url;
		continue;
	}

	console.log(`    ⚠️  ${host} — abierta, quitando alias`);
	const removed = vercel(["alias", "rm", host, "--yes"], { input: "y\n" });
	if (removed.status !== 0) {
		console.log(`       ${(removed.stderr ?? "").trim().split("\n").slice(-2).join(" · ")}`);
	}

	// Vercel's edge takes a few seconds to stop serving a removed alias.
	let closed = false;
	for (let attempt = 0; attempt < 8 && !closed; attempt++) {
		await new Promise((r) => setTimeout(r, 2000));
		closed = await isProtected(url);
	}

	if (closed) {
		console.log(`    ✅ ${host} cerrada`);
	} else {
		fail(
			`${host} sigue accesible sin autenticación y contiene tu programa.\n` +
				"  Ciérrala a mano en Vercel antes de compartir nada.",
		);
	}
}

if (stable) console.log(`\n  Usa esta URL:  ${stable}\n`);
