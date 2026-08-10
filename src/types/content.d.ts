/**
 * `@content` resolves to `content/` when it exists and `content.example/`
 * otherwise (see vite.config.ts). The `yamlContent` plugin turns these into
 * plain object modules at build time, so they arrive as parsed data.
 *
 * Typed as `unknown` on purpose: the real types come from validating against
 * the Zod schemas in `src/lib/content.ts`, not from trusting the file.
 */
declare module "@content/*.yaml" {
	const content: unknown;
	export default content;
}

declare module "@content/*.json" {
	const content: unknown;
	export default content;
}
