/**
 * Turns `.yaml` imports into plain object modules.
 *
 * Content is static, so parsing belongs in the build — this keeps the YAML
 * parser out of the browser bundle entirely.
 *
 * Shared by the app build and the test runner. The tests need it because the
 * modules that read content (`lib/content.ts`, and everything that imports it)
 * are not testable at all without it, and a module nobody can import is a module
 * whose behaviour gets argued about instead of checked.
 */

import type { Plugin } from "vite";
import { parse } from "yaml";

export function yamlContent(): Plugin {
	return {
		name: "yaml-content",
		transform(code, id) {
			if (!/\.ya?ml$/.test(id)) return null;
			return {
				code: `export default ${JSON.stringify(parse(code))}`,
				map: null,
			};
		},
	};
}
