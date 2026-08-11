/**
 * The way back from E2, for the content.
 *
 * Turns named phases back into numbered ones, using each phase's own `legacyId`.
 * Bijective for the four phases that existed before E2, which is the case this
 * exists for — reverting the code without reverting the content leaves an app
 * reading ids it does not understand.
 *
 * The stored sessions are the other half, and they live in the browser. Restore
 * the backup you took before migrating; that is what it is for.
 *
 * What this refuses to do: a session recorded after E2 in a phase created after
 * E2 has no number to go back to. Rather than sending it somewhere plausible, the
 * script names those phases and stops. Losing which phase a session belonged to,
 * silently, in order to be able to revert, would be the same sin the migration
 * was written to avoid.
 *
 * Run with: npx tsx scripts/rollback-phase-ids.ts [--check]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK_ONLY = process.argv.includes("--check");

type NamedPhase = {
	id: string;
	name: string;
	legacyId: number | null;
	plannedStart: string | null;
	plannedEnd: string | null;
	[key: string]: unknown;
};

const programPath = resolve(ROOT, "content", "program.yaml");
const program = parse(readFileSync(programPath, "utf8"));
const phases = program.phases as NamedPhase[];

if (typeof phases[0]?.id === "number") {
	console.log("content/program.yaml ya tiene fases numeradas; nada que hacer.");
	process.exit(0);
}

const orphans = phases.filter((phase) => phase.legacyId === null);

console.log(`Fases: ${phases.length}\n`);
for (const phase of phases) {
	console.log(
		`  ${phase.id.padEnd(18)} -> ${phase.legacyId ?? "SIN EQUIVALENTE"}`,
	);
}

if (orphans.length > 0) {
	console.error(
		`\nABORTA: ${orphans.length} fase(s) sin legacyId:\n` +
			orphans.map((phase) => `  ${phase.id}`).join("\n") +
			"\n\nSe crearon después de E2 y no tienen número al que volver. Cualquier\n" +
			"sesión registrada en ellas perdería su fase. Decide qué hacer con ellas\n" +
			"antes de revertir: retirarlas, reasignarlas, o quedarte en E2.",
	);
	process.exit(1);
}

const reverted = phases.map((phase) => {
	const {
		id,
		legacyId,
		plannedStart,
		plannedEnd,
		order,
		schedulePolicy,
		entryCriteria,
		exitCriteria,
		inheritsFrom,
		retired,
		...rest
	} = phase;
	void id;
	void order;
	void schedulePolicy;
	void entryCriteria;
	void exitCriteria;
	void inheritsFrom;
	void retired;
	return {
		id: legacyId,
		startDate: plannedStart,
		endDate: plannedEnd,
		...rest,
	};
});

const byId = new Map(phases.map((phase) => [phase.id, phase.legacyId]));
const cardio = (program.cardio ?? []).map((entry: { phase: string }) => ({
	...entry,
	phase: byId.get(entry.phase) ?? entry.phase,
}));

if (CHECK_ONLY) {
	console.log("\n--check: no se escribió nada.");
	process.exit(0);
}

writeFileSync(
	`${programPath}.e2.bak`,
	readFileSync(programPath, "utf8"),
	"utf8",
);
writeFileSync(
	programPath,
	stringify({ ...program, phases: reverted, cardio }, { lineWidth: 100 }),
	"utf8",
);

console.log("\ncontent/program.yaml revertido (copia de E2 en program.yaml.e2.bak)");
console.log(
	"Las sesiones guardadas viven en el navegador: restaura el respaldo previo a la migración.",
);
