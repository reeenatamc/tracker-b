/**
 * Capturing a version, and the proof that it can be resolved.
 *
 * A version is two claims: "the plan on this day" and "according to these ids".
 * The first is a date. The second is why any of this works — resolving with
 * whatever the device happens to hold today would make a named version quietly
 * change every time a sync lands, and a version that changes on its own is not
 * a version.
 *
 * The baseline is the part that does not fit that shape. It is not a log, it is
 * a state, so it cannot be bounded by a set of ids; it is *demonstrated*, with a
 * canonical fingerprint and its size. Everything here that computes that proof
 * is deterministic: no clock, no database, no ambient state.
 */

import { phaseForDate } from "./phase-events";
import { resolveWholePlan } from "./prescription";
import { danglingReferences, type SemanticReference } from "./references";
import type {
	PhaseEvent,
	PlanAdjustment,
	PrescriptionBaseline,
	PrescriptionEntry,
	Program,
	ProgramKnowledgeCut,
	ProgramVersion,
} from "./schema";

type IsoDate = string;

// --------------------------------------------------------------- fingerprint

/**
 * The baseline fields the fingerprint describes, in a fixed, written order.
 *
 * Fixed because a canonical serialisation cannot depend on key order, and
 * written because "whatever the type has" would change silently the day someone
 * adds a field.
 */
const FINGERPRINTED = [
	"id",
	"templateId",
	"exerciseId",
	"order",
	"sets",
	"target",
	"load",
	"rir",
	"restSeconds",
	"trainingRole",
	"goal",
	"progression",
	"cues",
	"allowedSubstitutions",
] as const;

/**
 * The baseline as one string, the same on every device that holds it.
 *
 * Rows by id, fields in the order above, and **`seededFrom` and `seededAt` left
 * out on purpose**: they say where and when the seeding happened, which two
 * devices migrating from the same content on different days will legitimately
 * disagree about. Including them would report the same baseline as two.
 *
 * Pure and synchronous — same input, same output, no clock and no database.
 */
export function canonicalBaseline(
	rows: readonly PrescriptionBaseline[],
): string {
	return [...rows]
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((row) =>
			JSON.stringify(
				FINGERPRINTED.map((field) => (row as Record<string, unknown>)[field]),
			),
		)
		.join("\n");
}

/**
 * SHA-256 of the canonical form.
 *
 * Async only because `crypto.subtle.digest` is; it is still a pure function of
 * its argument. The *reading* of the collections is what has to be synchronous
 * — see `captureProgramKnowledgeCut` — not the hashing that follows it.
 */
export async function baselineFingerprint(
	rows: readonly PrescriptionBaseline[],
): Promise<string> {
	const bytes = new TextEncoder().encode(canonicalBaseline(rows));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

// ------------------------------------------------------------------ capture

export type CaptureRefusal =
	| { kind: "not-ready" }
	| { kind: "sync-in-flight" }
	| { kind: "writes-pending"; count: number }
	| { kind: "dangling"; references: SemanticReference[] }
	| { kind: "future-cut"; cutAt: IsoDate; today: IsoDate };

export type Captured = {
	knows: ProgramKnowledgeCut;
	baselineFingerprint: string;
	baselineSize: number;
};

/** What the caller read, in one synchronous go. See `captureProgramKnowledgeCut`. */
export type CaptureSnapshot = {
	adjustments: readonly PlanAdjustment[];
	phaseEvents: readonly PhaseEvent[];
	baseline: readonly PrescriptionBaseline[];
};

export type CaptureInput = {
	read: () => CaptureSnapshot;
	cutAt: IsoDate;
	today: IsoDate;
	bootstrapReady: boolean;
	syncIdle: boolean;
	pendingWrites: number;
};

/**
 * The knowledge cut for a new version, or the reason there will not be one.
 *
 * The preconditions are not politeness. A version is immutable, so one born
 * wrong is wrong for ever, and pressing the button again in two seconds is not.
 * Each of the three comes from something that already went wrong once:
 *
 *   - **bootstrap ready** — before the hydration barrier the collections are
 *     empty (T-002). Capturing there yields a cut of zero ids that looks
 *     perfectly valid.
 *   - **sync idle** — a pull landing mid-read gives half of one state.
 *   - **no pending writes** — an adjustment written a moment ago may not be on
 *     disk yet (T-001), and the cut would name an id that can still be lost.
 *
 * `read` is called **once and synchronously**: the caller hands over a closure
 * that takes all three arrays in a single turn of the event loop. Being idle
 * makes an interleaved pull unlikely; being synchronous makes it impossible.
 * The hashing afterwards is async and cannot see a torn read.
 */
export async function captureProgramKnowledgeCut(
	input: CaptureInput,
): Promise<Captured | CaptureRefusal> {
	if (!input.bootstrapReady) return { kind: "not-ready" };
	if (!input.syncIdle) return { kind: "sync-in-flight" };
	if (input.pendingWrites > 0) {
		return { kind: "writes-pending", count: input.pendingWrites };
	}
	if (input.cutAt > input.today) {
		return { kind: "future-cut", cutAt: input.cutAt, today: input.today };
	}

	// One synchronous section. Nothing awaits between the three reads.
	const { adjustments, phaseEvents, baseline } = input.read();

	const adjustmentIds = canonicalIds(adjustments);
	const phaseEventIds = canonicalIds(phaseEvents);

	const dangling = danglingReferences({
		adjustments,
		phaseEvents,
		knownAdjustmentIds: new Set(adjustmentIds),
		knownPhaseEventIds: new Set(phaseEventIds),
	});
	if (dangling.length > 0) return { kind: "dangling", references: dangling };

	return {
		knows: { adjustmentIds, phaseEventIds },
		baselineFingerprint: await baselineFingerprint(baseline),
		baselineSize: baseline.length,
	};
}

/** Deduplicated and sorted, so two captures of one state are byte-identical. */
function canonicalIds(rows: readonly { id: string }[]): string[] {
	return [...new Set(rows.map((row) => row.id))].sort((a, b) =>
		a.localeCompare(b),
	);
}

// --------------------------------------------------------------- resolution

export type InvalidCut = "dangling-reference" | "baseline-mismatch";

export type VersionResolution<T> =
	| { kind: "resolved"; plan: T }
	/** Names things this device does not have yet. Fixes itself. */
	| {
			kind: "incomplete";
			missingAdjustmentIds: string[];
			missingPhaseEventIds: string[];
			baselineMissing: boolean;
	  }
	/** The data is all here and the frontier does not hold. Does not fix itself. */
	| { kind: "invalid"; code: InvalidCut; detail: string };

export type ResolveVersionInput = {
	version: ProgramVersion;
	adjustments: readonly PlanAdjustment[];
	phaseEvents: readonly PhaseEvent[];
	baseline: readonly PrescriptionBaseline[];
};

/**
 * Whether a version can be resolved here, and with what.
 *
 * The order is the specification, and each step exists because reporting it as
 * the next one would send someone looking in the wrong place:
 *
 *   1. named ids present?          no  → incomplete
 *   2. cut referentially closed?   no  → invalid
 *   3. baseline big enough?        no  → incomplete
 *   4. fingerprint matches?        no  → invalid
 *
 * Missing baseline rows produce a different fingerprint, so checking size first
 * is what stops "the sync has not finished" being reported as a corruption.
 *
 * Never returns `resolved` without a demonstrated baseline.
 */
export function checkVersion(
	input: ResolveVersionInput,
):
	| { kind: "ok"; universe: Universe }
	| Exclude<VersionResolution<never>, { kind: "resolved" }> {
	const { version } = input;

	const adjustmentsById = new Map(input.adjustments.map((a) => [a.id, a]));
	const eventsById = new Map(input.phaseEvents.map((e) => [e.id, e]));

	const missingAdjustmentIds = version.knows.adjustmentIds.filter(
		(id) => !adjustmentsById.has(id),
	);
	const missingPhaseEventIds = version.knows.phaseEventIds.filter(
		(id) => !eventsById.has(id),
	);
	if (missingAdjustmentIds.length > 0 || missingPhaseEventIds.length > 0) {
		return {
			kind: "incomplete",
			missingAdjustmentIds,
			missingPhaseEventIds,
			baselineMissing: input.baseline.length < version.baselineSize,
		};
	}

	// Bound first, decide later. Everything below reasons about this universe
	// and never about the whole log.
	const universe: Universe = {
		adjustments: version.knows.adjustmentIds.map(
			(id) => adjustmentsById.get(id) as PlanAdjustment,
		),
		phaseEvents: version.knows.phaseEventIds.map(
			(id) => eventsById.get(id) as PhaseEvent,
		),
	};

	const dangling = danglingReferences({
		...universe,
		knownAdjustmentIds: new Set(version.knows.adjustmentIds),
		knownPhaseEventIds: new Set(version.knows.phaseEventIds),
	});
	if (dangling.length > 0) {
		return {
			kind: "invalid",
			code: "dangling-reference",
			detail: dangling
				.map((r) => `${r.via} de ${r.fromId} apunta a ${r.toId}, que no está`)
				.join("; "),
		};
	}

	if (input.baseline.length < version.baselineSize) {
		return {
			kind: "incomplete",
			missingAdjustmentIds: [],
			missingPhaseEventIds: [],
			baselineMissing: true,
		};
	}

	return { kind: "ok", universe };
}

/** The rows a version is allowed to see, already narrowed to its cut. */
export type Universe = {
	adjustments: PlanAdjustment[];
	phaseEvents: PhaseEvent[];
};

/**
 * The baseline half of the check, split out because it is the only async part.
 *
 * Called after `checkVersion` says `ok`. Kept separate so everything the cut
 * decides stays synchronous and testable without a crypto implementation.
 */
export async function checkBaseline(
	version: ProgramVersion,
	baseline: readonly PrescriptionBaseline[],
): Promise<
	{ kind: "ok" } | Extract<VersionResolution<never>, { kind: "invalid" }>
> {
	const fingerprint = await baselineFingerprint(baseline);
	if (fingerprint !== version.baselineFingerprint) {
		return {
			kind: "invalid",
			code: "baseline-mismatch",
			detail: `la base de este dispositivo no es la que ${version.name} conoció`,
		};
	}
	return { kind: "ok" };
}

// ------------------------------------------------------------ the whole thing

/** A version's plan: one list of entries per template. */
export type VersionPlan = Map<string, PrescriptionEntry[]>;

/**
 * A version, resolved — or the reason it cannot be.
 *
 * The order of the checks is the specification, and each step exists because
 * reporting it as the next one would send someone looking in the wrong place:
 *
 *   1. are the named ids here?      no → incomplete   (wait for the sync)
 *   2. is the cut closed?           no → invalid      (this will not fix itself)
 *   3. is the baseline big enough?  no → incomplete
 *   4. does the fingerprint match?  no → invalid
 *   5. resolve, bounded on both axes
 *
 * Step 3 before step 4 is the one worth naming: missing baseline rows produce a
 * different fingerprint too, and calling that `baseline-mismatch` would send you
 * hunting for a corruption when the sync simply had not finished.
 *
 * Never returns `resolved` without a demonstrated baseline. That is the whole
 * job of `baselineFingerprint`: two devices holding different baselines must not
 * both answer confidently, and differently, about the same version.
 */
export async function resolveVersion(
	input: ResolveVersionInput & { program: Program },
): Promise<VersionResolution<VersionPlan>> {
	const checked = checkVersion(input);
	if (checked.kind !== "ok") return checked;

	const baseline = await checkBaseline(input.version, input.baseline);
	if (baseline.kind !== "ok") return baseline;

	const { version } = input;
	const { universe } = checked;

	const plan = resolveWholePlan(
		input.baseline,
		universe.adjustments,
		{ effectiveOn: version.cutAt, knows: version.knows },
		(date) =>
			phaseForDate(input.program, universe.phaseEvents, date, {
				phaseEventIds: version.knows.phaseEventIds,
			}).id,
	);

	return { kind: "resolved", plan };
}
