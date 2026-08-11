/**
 * The way back from E3, run over a backup file.
 *
 * The plan lives in the browser, not in the repo, so this works on an exported
 * backup: it reads one, strips what the migration derived, keeps everything that
 * was observed, and writes a new file to import. The original is never touched.
 *
 * What it will not do is delete a committed snapshot. Those are what real
 * sessions had prescribed, and no rollback makes that untrue — see
 * `lib/rollback-prescription.ts`, which is where the rule is decided and tested.
 *
 * Run with: npx tsx scripts/rollback-prescription.ts <respaldo.json> [--check]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
	applyRollback,
	planRollback,
} from "../src/lib/rollback-prescription.ts";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const source = args.find((arg) => !arg.startsWith("--"));

if (!source) {
	console.error(
		"Uso: npx tsx scripts/rollback-prescription.ts <respaldo.json> [--check]",
	);
	process.exit(1);
}

const backup = JSON.parse(readFileSync(source, "utf8"));
const records = backup.records ?? {};

const input = {
	baseline: records.prescriptionBaseline ?? [],
	adjustments: records.planAdjustments ?? [],
	snapshots: records.planSnapshots ?? [],
	sessions: records.sessions ?? [],
};

const plan = planRollback(input);

console.log("Deshacer la migración de E3");
console.log(`  base sembrada          ${plan.removeBaselineIds.length} filas`);
console.log(`  ajustes migrados       ${plan.removeAdjustmentIds.length}`);
console.log(`  instantáneas deducidas ${plan.removeSnapshotIds.length}`);
console.log(`  contratos "legacy"     ${plan.clearContractSessionIds.length}`);
console.log("");
console.log("Se conservan");
console.log(
	`  ajustes tuyos          ${plan.kept.authoredAdjustmentIds.length}`,
);
console.log(
	`  instantáneas reales    ${plan.kept.committedSnapshotIds.length}  ← nunca se borran`,
);
console.log(
	`  sesiones bajo E3       ${plan.kept.snapshotContractSessionIds.length}`,
);

if (checkOnly) {
	console.log("\n--check: no se ha escrito nada.");
	process.exit(0);
}

const result = applyRollback(input, plan);
const output = {
	...backup,
	records: {
		...records,
		prescriptionBaseline: result.baseline,
		planAdjustments: result.adjustments,
		planSnapshots: result.snapshots,
		sessions: result.sessions,
	},
};

const target = join(
	dirname(source),
	basename(source).replace(/\.json$/, "") + "-sin-e3.json",
);
writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`);
console.log(`\nEscrito ${target}. El original queda intacto.`);
