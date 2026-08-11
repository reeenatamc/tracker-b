/**
 * The training plan, loaded once and validated at module init.
 *
 * Content is bundled at build time rather than fetched, which is what makes the
 * app work with no network at all: the program is part of the app, not data it
 * has to go and ask for.
 */

import ankleProtocolData from "@content/ankle-protocol.yaml";
import libraryData from "@content/library.yaml";
import programData from "@content/program.yaml";
import sourcesData from "@content/sources.yaml";
import type { z } from "zod";
import { composeProgram, indexLibrary } from "@/domain/library";
import {
	AnkleProtocol,
	ExerciseLibrary,
	Program,
	ProgramFile,
	Sources,
} from "@/domain/schema";

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

/**
 * The library is indexed first, then the program is composed against it.
 *
 * The composed result is validated a second time, as a `Program`. That is not
 * belt and braces: the file on disk and the shape the app reads are now two
 * different things, and only checking the input would let a bad composition
 * reach the gym looking plausible.
 */
export const library = indexLibrary(
	validate(ExerciseLibrary, libraryData, "library.yaml"),
);

export const program = validate(
	Program,
	composeProgram(validate(ProgramFile, programData, "program.yaml"), library),
	"program.yaml + library.yaml",
);

export const ankleProtocol = validate(
	AnkleProtocol,
	ankleProtocolData,
	"ankle-protocol.yaml",
);
export const sources = validate(Sources, sourcesData, "sources.yaml");
