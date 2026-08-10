/**
 * The training plan, loaded once and validated at module init.
 *
 * Content is bundled at build time rather than fetched, which is what makes the
 * app work with no network at all: the program is part of the app, not data it
 * has to go and ask for.
 */

import ankleProtocolData from "@content/ankle-protocol.yaml";
import programData from "@content/program.yaml";
import sourcesData from "@content/sources.yaml";
import type { z } from "zod";
import { AnkleProtocol, Program, Sources } from "@/domain/schema";

/**
 * Fails loudly and specifically. A silently half-parsed program would mean
 * wrong set counts and wrong loads in the gym, which is worse than not starting.
 */
function validate<T extends z.ZodType>(
	schema: T,
	data: unknown,
	file: string,
): z.infer<T> {
	const result = schema.safeParse(data);
	if (!result.success) {
		const issues = result.error.issues
			.slice(0, 5)
			.map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
			.join("\n");
		throw new Error(`Invalid content in ${file}:\n${issues}`);
	}
	return result.data;
}

export const program = validate(Program, programData, "program.yaml");
export const ankleProtocol = validate(
	AnkleProtocol,
	ankleProtocolData,
	"ankle-protocol.yaml",
);
export const sources = validate(Sources, sourcesData, "sources.yaml");
