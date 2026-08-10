/**
 * The tombstone rule, enforced structurally.
 *
 * Deleting stamps `deletedAt` instead of removing a row, so the deletion can
 * reach the other device. That means any screen querying a collection directly
 * shows records you deleted — which is exactly what happened: `useRecords` was
 * written to filter them and then no screen actually used it, so deleting a set
 * left it on the page.
 *
 * A unit test on the filter would not have caught that. The invariant is about
 * who calls it, so that is what is checked here.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTES = join(import.meta.dirname, "..", "routes");

function routeFiles(): string[] {
	return readdirSync(ROUTES).filter((name) => name.endsWith(".tsx"));
}

describe("screens read the log through useRecords", () => {
	it("finds route files to check", () => {
		expect(routeFiles().length).toBeGreaterThan(0);
	});

	it.each(routeFiles())("%s does not query collections directly", (file) => {
		const source = readFileSync(join(ROUTES, file), "utf8");
		expect(source).not.toContain("useLiveQuery");
	});
});
