/**
 * Reading the log.
 *
 * Collections keep tombstones so deletions can travel between devices; screens
 * must never show them. Every screen reads through here rather than querying a
 * collection directly, so "filter out the deleted ones" is decided once instead
 * of being remembered in fourteen places.
 */

import { useLiveQuery } from "@tanstack/react-db";
import type {
	AnkleCheck,
	CustomExercise,
	ExerciseOverride,
	InspoItem,
	PhaseEvent,
	PlanAdjustment,
	PrescriptionBaseline,
	ProgramVersion,
	ProgressCheck,
	SessionPlanSnapshot,
	SessionRecord,
	SetRecord,
} from "@/domain/schema";
import { useCollections } from "./provider";

/**
 * Rows written before sync existed have no `deletedAt` at all, which must read
 * as "alive" — treating a missing field as deleted would hide the entire
 * history the first time this shipped.
 */
function alive<T>(rows: readonly T[]): T[] {
	// `deletedAt` is added by the syncable wrapper at write time, so it is not
	// part of any collection's declared row type; it is read structurally.
	return rows.filter(
		(row) => (row as { deletedAt?: number | null }).deletedAt == null,
	);
}

export function useRecords() {
	const collections = useCollections();

	const { data: sessions = [] } = useLiveQuery((q) =>
		q.from({ s: collections.sessions }),
	);
	const { data: sets = [] } = useLiveQuery((q) =>
		q.from({ s: collections.sets }),
	);
	const { data: ankleChecks = [] } = useLiveQuery((q) =>
		q.from({ a: collections.ankleChecks }),
	);
	const { data: overrides = [] } = useLiveQuery((q) =>
		q.from({ o: collections.overrides }),
	);
	const { data: customExercises = [] } = useLiveQuery((q) =>
		q.from({ c: collections.customExercises }),
	);
	const { data: progressChecks = [] } = useLiveQuery((q) =>
		q.from({ p: collections.progressChecks }),
	);
	const { data: inspo = [] } = useLiveQuery((q) =>
		q.from({ i: collections.inspo }),
	);
	const { data: phaseEvents = [] } = useLiveQuery((q) =>
		q.from({ p: collections.phaseEvents }),
	);
	const { data: prescriptionBaseline = [] } = useLiveQuery((q) =>
		q.from({ b: collections.prescriptionBaseline }),
	);
	const { data: planAdjustments = [] } = useLiveQuery((q) =>
		q.from({ a: collections.planAdjustments }),
	);
	const { data: planSnapshots = [] } = useLiveQuery((q) =>
		q.from({ s: collections.planSnapshots }),
	);
	const { data: planVersions = [] } = useLiveQuery((q) =>
		q.from({ v: collections.planVersions }),
	);

	return {
		collections,
		sessions: alive(sessions) as SessionRecord[],
		sets: alive(sets) as SetRecord[],
		ankleChecks: alive(ankleChecks) as AnkleCheck[],
		overrides: alive(overrides) as ExerciseOverride[],
		customExercises: alive(customExercises) as CustomExercise[],
		progressChecks: alive(progressChecks) as ProgressCheck[],
		inspo: alive(inspo) as InspoItem[],
		phaseEvents: alive(phaseEvents) as PhaseEvent[],
		prescriptionBaseline: alive(prescriptionBaseline) as PrescriptionBaseline[],
		planAdjustments: alive(planAdjustments) as PlanAdjustment[],
		planSnapshots: alive(planSnapshots) as SessionPlanSnapshot[],
		planVersions: alive(planVersions) as ProgramVersion[],
	};
}
