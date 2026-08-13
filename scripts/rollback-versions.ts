/**
 * The way back from E4, run over a backup file.
 *
 * Easy in one direction and impossible in the other, and the whole value of this
 * script is saying which one you are in before you do anything.
 *
 * Locally, E4 only adds: `planVersions` are captures of things that still live in
 * the logs, so dropping them loses nothing but the names. That is what this
 * script does.
 *
 * Remotely is another matter. `SYNC_SCHEMA_VERSION` is a constant in the client;
 * `sync_meta.schema_version` is a row in Postgres. The server raises it when a
 * newer client shows up and **nothing in the client can lower it**. So once any
 * E4 device has synced, a client that goes back to E3 gets a 409 — which is the
 * gate working, not the rollback failing.
 *
 * E4 does not support a remote downgrade and does not pretend to: lowering
 * `sync_meta` with schema-4 rows already written would leave E3 clients reading
 * `ProgramVersion` they cannot parse, which is worse than the 409. See §9.2 of
 * `docs/E4-versiones.md` for the coordinated procedure.
 *
 * Run with: npx tsx scripts/rollback-versions.ts <respaldo.json> [--check]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const source = args.find((arg) => !arg.startsWith("--"));

if (!source) {
	console.error(
		"Uso: npx tsx scripts/rollback-versions.ts <respaldo.json> [--check]",
	);
	process.exit(1);
}

const backup = JSON.parse(readFileSync(source, "utf8"));
const records = backup.records ?? {};
const versions = (records.planVersions ?? []) as Array<{
	id: string;
	name: string;
	cutAt: string;
}>;

console.log("Deshacer E4");
console.log(`  versiones guardadas   ${versions.length}`);
for (const version of versions.slice(0, 10)) {
	console.log(`    ${version.name}  ·  ${version.cutAt}`);
}
if (versions.length > 10) console.log(`    … y ${versions.length - 10} más`);

console.log("");
console.log("Se conserva todo lo demás: base, ajustes, instantáneas y el log de");
console.log("fases. Una versión sólo nombra lo que ya está ahí.");
console.log("");
console.log("Y lo que este script NO puede hacer:");
console.log("  bajar sync_meta.schema_version en el servidor. Si algún cliente E4");
console.log("  ya sincronizó, el remoto está en 4 y un cliente E3 recibirá 409.");
console.log("  Eso es la compuerta funcionando. Ver §9.2 de docs/E4-versiones.md:");
console.log("  el rollback seguro en ese caso es un procedimiento coordinado.");
console.log("");
console.log("  Para saber en qué escenario estás:");
console.log("    select schema_version from sync_meta where id = 1;");

if (checkOnly) {
	console.log("\n--check: no se ha escrito nada.");
	process.exit(0);
}

const output = {
	...backup,
	records: { ...records, planVersions: [] },
};

const target = join(
	dirname(source),
	`${basename(source).replace(/\.json$/, "")}-sin-e4.json`,
);
writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`);
console.log(`\nEscrito ${target}. El original queda intacto.`);
