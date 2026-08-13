/**
 * `planVersions` does not take writes after the first one.
 *
 * A version is the statement "this is what there was, and this is what I knew".
 * Editing it afterwards turns a fact into something else with the same id, and
 * every diff computed against it stops reproducing — so the collection refuses
 * rather than trusting everyone to remember.
 *
 * Renaming and retiring are out of E4 for a related but different reason, and
 * the last test holds that line: append-only removes *write* conflicts, not
 * *semantic* ones. Two concurrent renames of one version are two incompatible
 * claims about what something is called, and picking between them by clock or by
 * id is arbitrating by coin toss. E4 does not need to solve that, so it does not.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");

function sources(dir: string): Array<[string, string]> {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sources(path);
		if (!/\.tsx?$/.test(name) || name.includes(".test.")) return [];
		return [
			[path.slice(SRC.length + 1), readFileSync(path, "utf8")] as [
				string,
				string,
			],
		];
	});
}

const ALL = sources(SRC);
const collections = readFileSync(join(SRC, "db", "collections.ts"), "utf8");

describe("la colección es inmutable", () => {
	it("se declara append-only, como el log de fases", () => {
		expect(collections).toContain(
			"planVersions: appendOnly(write(planVersions))",
		);
	});

	/** `noUpdate` no bastaría: permite borrar, y una versión tampoco se borra. */
	it("y no con `noUpdate`, que dejaría borrar", () => {
		expect(collections).not.toContain("planVersions: noUpdate(");
	});

	it("nadie la actualiza ni la borra desde la app", () => {
		const offenders = ALL.filter(
			([, source]) =>
				source.includes("planVersions.update(") ||
				source.includes("planVersions.delete("),
		).map(([path]) => path);

		expect(offenders).toEqual([]);
	});
});

describe("renombrar y retirar no existen en E4", () => {
	it("no hay ninguna ruta que lo haga", () => {
		const offenders = ALL.flatMap(([path, source]) =>
			["VersionAnnotation", "renameVersion", "retireVersion"]
				.filter((name) => source.includes(name))
				.map((name) => `${path}: ${name}`),
		);
		expect(offenders).toEqual([]);
	});
});
