/**
 * Today.
 *
 * One screen, because at the gym every extra tap is a tap you take with one hand
 * between sets: the session, its exercises, and the logger for whichever one you
 * are on, all in the same place.
 *
 * Everything here reads the *resolved* program — the imported content with your
 * overrides applied, minus what you skipped, plus what you added.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { AddExercise } from "@/components/AddExercise";
import { CardioBlock } from "@/components/CardioBlock";
import { ExerciseLogger, type NewSet } from "@/components/ExerciseLogger";
import {
	ExerciseSettings,
	type PlanChange,
} from "@/components/ExerciseSettings";
import { ExerciseNav, ExerciseStrip } from "@/components/ExerciseStrip";
import { QuickFinisher } from "@/components/QuickFinisher";
import { useRest } from "@/components/RestTimer";
import { SessionClock } from "@/components/SessionClock";
import { type NextTarget, SessionComplete } from "@/components/SessionComplete";
import { SetEditor } from "@/components/SetEditor";
import { NoteField, PrimaryButton, Sheet } from "@/components/Sheet";
import { TabBar } from "@/components/TabBar";
import { persisted } from "@/db/durability";
import { useRecords } from "@/db/records";
import {
	personalRecords,
	sessionMinutes,
	summarise,
	volumeChange,
	weekStreak,
} from "@/domain/achievements";
import {
	CARDIO_EXERCISE,
	cardioFor,
	rehabAsEntry,
	rehabAsExercise,
	rehabStageFor,
} from "@/domain/cardio-day";
import {
	completedExerciseIds,
	previousPerformance,
	setsFor,
} from "@/domain/history";
import {
	resolveSessionExercises,
	setsOf as setsOfEntry,
	skippedExercises,
} from "@/domain/personalise";
import { phaseForDate } from "@/domain/phases";
import { resolvePrescription } from "@/domain/prescription";
import { decideProgression } from "@/domain/progression";
import {
	dayPlanForDate,
	nextSessionWeekday,
	sessionForDate,
	weekdayOf,
} from "@/domain/schedule";
import type {
	CustomExercise,
	Exercise,
	PrescriptionEntry,
	SetRecord,
} from "@/domain/schema";
import { activeSnapshot, freeze } from "@/domain/snapshot";
import { program } from "@/lib/content";
import { formatDate, formatTarget, todayIso } from "@/lib/format";
import {
	addToSession,
	restoreExercise,
	skipExercise,
	startSession,
} from "@/lib/session-writes";

export const Route = createFileRoute("/")({ component: Today });

function Today() {
	const {
		collections,
		sessions,
		sets,
		ankleChecks,
		customExercises,
		phaseEvents,
		prescriptionBaseline,
		planAdjustments,
		planSnapshots,
	} = useRecords();
	const rest = useRest();
	const today = todayIso();

	const phase = phaseForDate(program, phaseEvents, today);
	const phaseAt = (date: string) => phaseForDate(program, phaseEvents, date).id;
	const dayPlan = dayPlanForDate(program, today);
	const cardio = cardioFor(program, phaseEvents, today);
	const rehab = rehabStageFor(program, today);

	/*
	 * On a strength day this is the programmed session. On a cardio day it is the
	 * rehab block the calendar has reached, shaped the same way — so the strip,
	 * the logger, progression and the summary all work without knowing which kind
	 * of day it is.
	 */
	const strengthTemplate = sessionForDate(program, today);
	const template =
		strengthTemplate ??
		(rehab
			? {
					id: "cardio_ankle",
					name: dayPlan?.block ?? "Cardio + tobillo",
					weekday: weekdayOf(today),
					exercises: rehab.exercises.map(rehabAsExercise),
				}
			: null);

	// `undefined` means "nothing chosen yet", which falls back to the exercise you
	// are actually on — open the app mid-session and it is already there.
	const [openOverride, setOpenOverride] = useState<string | undefined>(
		undefined,
	);
	const [editingSet, setEditingSet] = useState<{
		set: SetRecord;
		exercise: Exercise;
	} | null>(null);
	const [settingsFor, setSettingsFor] = useState<Exercise | null>(null);
	const [addingExercise, setAddingExercise] = useState(false);
	const [addingFinisher, setAddingFinisher] = useState(false);
	const [editingNotes, setEditingNotes] = useState(false);

	const session =
		sessions.find(
			(record) =>
				record.date === today && record.templateId === (template?.id ?? ""),
		) ?? null;

	/**
	 * What today prescribes.
	 *
	 * Once the session has started this is its snapshot — a stored fact, read back
	 * rather than recalculated. Only before that is it a fold of the baseline and
	 * the adjustment log, and that fold is exactly what gets frozen.
	 *
	 * Rehab is the one exception: it is a clinical protocol indexed by week, not a
	 * slot anybody adjusts, so it is built on the spot. See `rehabAsEntry`.
	 */
	const snapshot = session ? activeSnapshot(planSnapshots, session.id) : null;
	const plan = strengthTemplate
		? { baseline: prescriptionBaseline, adjustments: planAdjustments }
		: {
				baseline: (rehab?.exercises ?? []).map((entry, index) =>
					rehabAsEntry(entry, template?.id ?? "cardio_ankle", index + 1),
				),
				adjustments: [],
			};
	const livePrescription: PrescriptionEntry[] = template
		? resolvePrescription(
				plan.baseline,
				plan.adjustments,
				template.id,
				{ effectiveOn: today, knows: null },
				phaseAt,
			)
		: [];
	const entries = snapshot ? snapshot.entries : livePrescription;
	const entryFor = (exerciseId: string) =>
		entries.find((entry) => entry.exerciseId === exerciseId);

	// The latest ankle check gates progression even when today's pain was 0.
	const latestCheck =
		[...ankleChecks].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

	/**
	 * Two quick taps must not start two sessions. The in-flight promise is the
	 * lock — everyone waits on the same start — and it is keyed by the day so it
	 * cannot leak into tomorrow.
	 */
	const starting = useRef<{ key: string; id: Promise<string> } | null>(null);

	/**
	 * The session a set will hang off, started in the order G3 needs.
	 *
	 * Snapshot first and awaited, then the session that points at it. If the second
	 * step fails what is left is an orphan snapshot — recoverable rubbish — instead
	 * of a session with no plan, which nobody could ever reconstruct: that is the
	 * whole reason the order is this way round and not the obvious one.
	 */
	function ensureSession(): Promise<string> {
		if (session) return Promise.resolve(session.id);

		const key = `${today}:${template?.id ?? "unscheduled"}`;
		if (starting.current?.key === key) return starting.current.id;

		const id = startFresh();
		starting.current = { key, id };
		return id;
	}

	async function startFresh(): Promise<string> {
		const sessionId = crypto.randomUUID();
		const snapshotId = crypto.randomUUID();

		await persisted(
			collections.planSnapshots.insert(
				freeze({
					id: snapshotId,
					sessionId,
					takenAt: Date.now(),
					phaseId: phase.id,
					templateId: template?.id ?? "unscheduled",
					baseline: plan.baseline,
					adjustments: plan.adjustments,
					asOf: { effectiveOn: today, knows: null },
					phaseAt,
				}),
			),
		);

		await persisted(
			collections.sessions.insert({
				id: sessionId,
				date: today,
				templateId: template?.id ?? "unscheduled",
				// The stamp that makes G1 hold: a session records the phase it was in,
				// and nothing ever derives it again.
				phase: phase.id,
				completed: false,
				notes: null,
				startedAt: Date.now(),
				endedAt: null,
				skippedExerciseIds: [],
				extraExerciseIds: [],
				prescriptionContract: "snapshot_v1",
				snapshotId,
			}),
		);

		return sessionId;
	}

	async function beginSession() {
		const sessionId = await ensureSession();
		await persisted(startSession(collections, sessionId, Date.now()));
	}

	async function finishSession() {
		if (!session) return;
		/*
		 * Sessions logged before the clock existed have no start time. Rather than
		 * report no duration at all, fall back to the first set's timestamp — it
		 * undercounts the warm-up, but it is a real measurement rather than a gap.
		 */
		const firstSetAt = sets
			.filter((set) => set.sessionId === session.id)
			.map((set) => (set as { updatedAt?: number }).updatedAt)
			.filter(
				(stamp): stamp is number => typeof stamp === "number" && stamp > 0,
			)
			.sort((a, b) => a - b)[0];

		return persisted(
			collections.sessions.update(session.id, (draft) => {
				draft.startedAt ??= firstSetAt ?? null;
				draft.endedAt = Date.now();
				draft.completed = true;
			}),
		);
	}

	async function saveCardio(minutes: number) {
		const sessionId = await ensureSession();
		const transaction = collections.sets.insert({
			id: crypto.randomUUID(),
			sessionId,
			exerciseId: "cardio_machine",
			setNumber:
				sets.filter(
					(set) =>
						set.sessionId === sessionId && set.exerciseId === "cardio_machine",
				).length + 1,
			isWarmup: false,
			load: null,
			unit: "minutes",
			reps: minutes,
			rir: null,
			anklePain: null,
			note: null,
		});
		await persisted(transaction);
	}

	/**
	 * A set is not saved until it is on disk.
	 *
	 * `insert` updates memory and returns; the flush lands afterwards. Walking away
	 * in between is how six sets in twenty-five used to disappear — and two saves in
	 * one tick lost one every time. Awaiting closes that window to the length of a
	 * flush, which is milliseconds.
	 */
	async function saveSet(newSet: NewSet) {
		// §7.1 step 4: a session accepts sets only once it and its snapshot are on
		// disk. Only the first set of a session ever waits for that — after it,
		// `ensureSession` resolves in a microtask.
		const sessionId = await ensureSession();
		const transaction = collections.sets.insert({
			...newSet,
			id: crypto.randomUUID(),
			sessionId,
		});
		// The rest timer starts on the write reaching memory, not on the flush: it
		// is about the muscle, and making it wait on the disk would be a lie in the
		// other direction.
		const landed = persisted(transaction);

		// Approach sets do not earn a full rest, and timed work is its own timer.
		if (newSet.isWarmup || newSet.unit === "minutes") {
			await landed;
			return;
		}

		/*
		 * v3 states rest per exercise — 90–120 s on the leg press, 60 s on the
		 * cable crunch. Starting at the low end of that range and letting you add
		 * time beats a single global number that is wrong for both.
		 */
		const prescribed = exercises.find(
			(exercise) => exercise.id === newSet.exerciseId,
		)?.restSeconds;
		rest.start(prescribed?.min);
		await landed;
	}

	/**
	 * Changing the plan from the executor.
	 *
	 * An adjustment, not an override: it is dated, it carries a reason, and it does
	 * not touch what any started session already has frozen. Effective from today,
	 * because a change decided today did not hold last Tuesday.
	 */
	async function savePlanChange(entryId: string, change: PlanChange) {
		await persisted(
			collections.planAdjustments.insert({
				kind: "set_field",
				id: crypto.randomUUID(),
				entryId,
				change: change.change,
				effectiveOn: today,
				onlyInPhase: null,
				origin: "manual",
				reason: change.reason,
				evidenceIds: [],
				provenance: { kind: "authored" },
				createdAt: Date.now(),
			}),
		);
	}

	/** Not doing it today. A deviation on the session — the plan is untouched. */
	async function skip(exerciseId: string) {
		const sessionId = await ensureSession();
		await persisted(skipExercise(collections, sessionId, exerciseId));
	}

	async function restore(exerciseId: string) {
		if (!session) return;
		await persisted(restoreExercise(collections, session.id, exerciseId));
	}

	async function addCustomExercise(custom: CustomExercise) {
		const created = collections.customExercises.insert(custom);
		const sessionId = await ensureSession();
		await Promise.all([
			persisted(created),
			persisted(addToSession(collections, sessionId, custom.id)),
		]);
	}

	async function addFinisher(custom: CustomExercise, minutes: number) {
		if (!collections.customExercises.has(custom.id)) {
			collections.customExercises.insert(custom);
		}
		const sessionId = await ensureSession();
		const attached = addToSession(collections, sessionId, custom.id);
		const transaction = collections.sets.insert({
			id: crypto.randomUUID(),
			sessionId,
			exerciseId: custom.id,
			setNumber: 1,
			isWarmup: false,
			load: null,
			unit: "minutes",
			reps: minutes,
			rir: null,
			anklePain: null,
			note: null,
		});
		await Promise.all([persisted(attached), persisted(transaction)]);
	}

	const exercises = template
		? resolveSessionExercises({ template, entries, customExercises, session })
		: [];
	const putBack = template
		? skippedExercises({ template, entries, session })
		: [];
	const done = session
		? completedExerciseIds(sets, session.id)
		: new Set<string>();
	const firstPending =
		exercises.find((exercise) => !done.has(exercise.id))?.id ?? null;
	const openExerciseId =
		openOverride === undefined ? firstPending : openOverride;
	const current =
		exercises.find((exercise) => exercise.id === openExerciseId) ??
		exercises[0] ??
		null;
	const position = current
		? exercises.findIndex((exercise) => exercise.id === current.id)
		: 0;

	const setsOf = (exercise: Exercise) => setsOfEntry(entryFor(exercise.id));

	const decisionFor = (exercise: Exercise) =>
		decideProgression({
			exercise,
			lastSets:
				previousPerformance(sets, sessions, exercise.id, session?.id ?? null)
					?.sets ?? [],
			targetRir: phase.targetRir,
			targetSets: setsOf(exercise),
			safety: latestCheck
				? { swelling: latestCheck.swelling, givesWay: latestCheck.givesWay }
				: undefined,
		});

	const progress = summarise(program, phaseEvents, sessions, sets, today);

	const exerciseName = (exerciseId: string) =>
		exercises.find((exercise) => exercise.id === exerciseId)?.name ??
		program.sessions
			.flatMap((template) => template.exercises)
			.find((exercise) => exercise.id === exerciseId)?.name ??
		customExercises.find((exercise) => exercise.id === exerciseId)?.name ??
		exerciseId;

	/*
	 * Cardio is not in the exercise list — it sits in its own block above — so on a
	 * Tuesday the day is not done just because the rehab is. Saturday's cardio is
	 * offered rather than prescribed, and does not hold the day open.
	 */
	const cardioPending =
		cardio !== null &&
		!cardio.optional &&
		!(session ? done.has("cardio_machine") : false);

	const isComplete =
		session?.endedAt != null ||
		(exercises.length > 0 && done.size === exercises.length && !cardioPending);

	// What each exercise's next target became, given today. Computed against
	// today's own sets so it reads what you just did, not the session before it.
	const nextTargets: NextTarget[] =
		isComplete && session
			? exercises.map((exercise) => ({
					exercise,
					decision: decideProgression({
						exercise,
						lastSets: setsFor(sets, session.id, exercise.id),
						targetRir: phase.targetRir,
						targetSets: setsOf(exercise),
						safety: latestCheck
							? {
									swelling: latestCheck.swelling,
									givesWay: latestCheck.givesWay,
								}
							: undefined,
					}),
				}))
			: [];

	return (
		<main className="mx-auto min-h-dvh w-full max-w-lg space-y-3 px-3 pb-[calc(8.5rem+env(safe-area-inset-bottom))]">
			<header className="px-2 pt-7 pb-1">
				<p className="eyebrow">
					{formatDate(today)} · Fase {phase.order} {phase.name}
				</p>
				<h1 className="mt-1 text-[1.75rem] leading-tight font-bold tracking-tight">
					{template?.name ?? dayPlan?.block ?? "Sin sesión"}
				</h1>
				<p className="mt-1 text-sm text-muted">
					{strengthTemplate
						? phase.goal
						: rehab
							? `Tobillo · ${rehab.stage}`
							: (dayPlan?.focus ?? "")}
				</p>
				<p className="mt-3 text-[0.6875rem] text-faint">
					<span className="tabular">{progress.weeksToCheckpoint}</span> semanas
					hasta el checkpoint
				</p>
			</header>

			{template ? (
				<>
					{isComplete ? (
						<SessionComplete
							sets={
								session
									? sets.filter((set) => set.sessionId === session.id)
									: []
							}
							nextTargets={nextTargets}
							progress={progress}
							records={
								session ? personalRecords(sessions, sets, session.id) : []
							}
							minutes={
								session ? sessionMinutes(session, sets, session.id) : null
							}
							volumeChange={
								session ? volumeChange(sessions, sets, session.id) : null
							}
							streak={weekStreak(sessions, sets, today)}
							weekday={nextSessionWeekday(program, today)}
							exerciseName={exerciseName}
						/>
					) : null}

					{cardio ? (
						<CardioBlock
							day={cardio}
							todaySets={
								session ? setsFor(sets, session.id, "cardio_machine") : []
							}
							previous={(() => {
								const last = previousPerformance(
									sets,
									sessions,
									"cardio_machine",
									session?.id ?? null,
								);
								const minutes = last?.sets.reduce(
									(total, set) => total + (set.reps ?? 0),
									0,
								);
								return last && minutes ? { date: last.date, minutes } : null;
							})()}
							onSave={saveCardio}
							onEditSet={(set) =>
								setEditingSet({ set, exercise: CARDIO_EXERCISE })
							}
						/>
					) : null}

					<div className="px-2">
						<SessionClock
							startedAt={session?.startedAt ?? null}
							endedAt={session?.endedAt ?? null}
							onStart={beginSession}
							onFinish={finishSession}
							canFinish={done.size > 0}
						/>
					</div>

					<section className="card">
						<ExerciseStrip
							exercises={exercises}
							done={done}
							currentId={current?.id ?? null}
							onSelect={setOpenOverride}
						/>

						{current ? (
							<>
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0">
										<p className="eyebrow">
											{String(position + 1).padStart(2, "0")}
											{current.isAnkle ? " · tobillo" : ""}
										</p>
										<h2 className="mt-1 text-2xl leading-tight font-semibold text-balance text-ink">
											{current.name}
										</h2>
										<p className="tabular mt-1 text-[0.8125rem] text-muted">
											{setsOf(current) ? `${setsOf(current)?.max} × ` : ""}
											{formatTarget(current.target, phase.order)}
										</p>
									</div>
									<button
										type="button"
										onClick={() => setSettingsFor(current)}
										aria-label={`Ajustes de ${current.name}`}
										className="-mr-2 shrink-0 px-3 py-2 text-lg text-faint"
									>
										⋯
									</button>
								</div>

								<ExerciseLogger
									exercise={current}
									phaseOrder={phase.order}
									targetSets={setsOf(current)}
									targetRir={phase.targetRir}
									decision={decisionFor(current)}
									previous={previousPerformance(
										sets,
										sessions,
										current.id,
										session?.id ?? null,
									)}
									todaySets={
										session ? setsFor(sets, session.id, current.id) : []
									}
									onSave={saveSet}
									onEditSet={(set) => setEditingSet({ set, exercise: current })}
								/>

								<ExerciseNav
									position={position}
									total={exercises.length}
									onPrevious={() =>
										setOpenOverride(
											exercises[Math.max(0, position - 1)]?.id ?? null,
										)
									}
									onNext={() =>
										setOpenOverride(
											exercises[Math.min(exercises.length - 1, position + 1)]
												?.id ?? null,
										)
									}
									nextLabel={exercises[position + 1]?.name ?? null}
								/>
							</>
						) : null}
					</section>

					<section className="card">
						<div className="flex gap-3">
							<button
								type="button"
								onClick={() => setAddingFinisher(true)}
								className="h-12 flex-1 rounded-lg border border-line text-sm text-reserve"
							>
								Añadir complemento
							</button>
							<button
								type="button"
								onClick={() => setAddingExercise(true)}
								className="h-12 flex-1 rounded-lg border border-line text-sm text-muted"
							>
								Añadir ejercicio
							</button>
						</div>

						{putBack.length > 0 ? (
							<div className="mt-4">
								<p className="eyebrow mb-2">Saltados hoy</p>
								<ul className="space-y-1">
									{putBack.map((exercise) => (
										<li
											key={exercise.id}
											className="flex items-center justify-between"
										>
											<span className="text-[0.8125rem] text-muted">
												{exercise.name}
											</span>
											<button
												type="button"
												onClick={() => restore(exercise.id)}
												className="text-[0.8125rem] text-reserve"
											>
												Reponer
											</button>
										</li>
									))}
								</ul>
							</div>
						) : null}

						<button
							type="button"
							onClick={() => setEditingNotes(true)}
							className="mt-4 w-full text-left"
						>
							<span className="eyebrow">Nota de la sesión</span>
							<span className="mt-1 block text-[0.8125rem] text-muted">
								{session?.notes || "Cómo fue, qué ajustar la próxima…"}
							</span>
						</button>
					</section>
				</>
			) : (
				<div className="card">
					<p className="text-sm text-muted">{dayPlan?.block ?? "Descanso"}</p>
					{dayPlan?.notes ? (
						<p className="mt-2 text-sm text-faint">{dayPlan.notes}</p>
					) : null}
				</div>
			)}

			{editingSet ? (
				<SetEditor
					set={editingSet.set}
					exercise={editingSet.exercise}
					targetRir={phase.targetRir}
					onSave={async (changes) => {
						await persisted(
							collections.sets.update(editingSet.set.id, (draft) =>
								Object.assign(draft, changes),
							),
						);
						setEditingSet(null);
					}}
					onDelete={async () => {
						await persisted(collections.sets.delete(editingSet.set.id));
						setEditingSet(null);
					}}
					onClose={() => setEditingSet(null)}
				/>
			) : null}

			{settingsFor ? (
				<ExerciseSettings
					exercise={settingsFor}
					entry={entryFor(settingsFor.id)}
					phase={phase}
					sets={setsOf(settingsFor)}
					onSave={(changes) => {
						const entry = entryFor(settingsFor.id);
						if (entry) {
							for (const change of changes) savePlanChange(entry.id, change);
						}
						setSettingsFor(null);
					}}
					onSkip={() => {
						skip(settingsFor.id);
						setSettingsFor(null);
					}}
					onClose={() => setSettingsFor(null)}
				/>
			) : null}

			{addingFinisher ? (
				<QuickFinisher
					onSave={(custom, minutes) => {
						addFinisher(custom, minutes);
						setAddingFinisher(false);
					}}
					onClose={() => setAddingFinisher(false)}
				/>
			) : null}

			{addingExercise ? (
				<AddExercise
					onSave={(custom) => {
						addCustomExercise(custom);
						setAddingExercise(false);
					}}
					onClose={() => setAddingExercise(false)}
				/>
			) : null}

			{editingNotes ? (
				<SessionNotes
					value={session?.notes ?? ""}
					onSave={async (notes) => {
						const id = await ensureSession();
						await persisted(
							collections.sessions.update(id, (draft) => {
								draft.notes = notes.trim() || null;
							}),
						);
						setEditingNotes(false);
					}}
					onClose={() => setEditingNotes(false)}
				/>
			) : null}

			<TabBar />
		</main>
	);
}

function SessionNotes({
	value,
	onSave,
	onClose,
}: {
	value: string;
	onSave: (notes: string) => void;
	onClose: () => void;
}) {
	const [notes, setNotes] = useState(value);
	return (
		<Sheet title="Nota de la sesión" onClose={onClose}>
			<NoteField
				label="Cómo fue"
				value={notes}
				onChange={setNotes}
				placeholder="Energía, molestias, qué cambiar la próxima…"
			/>
			<PrimaryButton onClick={() => onSave(notes)}>Guardar</PrimaryButton>
		</Sheet>
	);
}
