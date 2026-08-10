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
import { useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";
import { AddExercise } from "@/components/AddExercise";
import { QuickFinisher } from "@/components/QuickFinisher";
import { useRest } from "@/components/RestTimer";
import { SessionComplete, type NextTarget } from "@/components/SessionComplete";
import { ExerciseLogger, type NewSet } from "@/components/ExerciseLogger";
import { ExerciseNav, ExerciseStrip } from "@/components/ExerciseStrip";
import {
	ExerciseSettings,
	type OverrideChanges,
} from "@/components/ExerciseSettings";
import { SetEditor } from "@/components/SetEditor";
import { NoteField, PrimaryButton, Sheet } from "@/components/Sheet";
import { TabBar } from "@/components/TabBar";
import { useCollections } from "@/db/provider";
import {
	completedExerciseIds,
	previousPerformance,
	setsFor,
} from "@/domain/history";
import {
	resolveSessionExercises,
	resolveSets,
	skippedExercises,
} from "@/domain/personalise";
import {
	personalRecords,
	sessionMinutes,
	summarise,
	volumeChange,
	weekStreak,
} from "@/domain/achievements";
import { phaseForDate } from "@/domain/phases";
import { decideProgression } from "@/domain/progression";
import {
	dayPlanForDate,
	nextSessionWeekday,
	sessionForDate,
} from "@/domain/schedule";
import type { CustomExercise, Exercise, SetRecord } from "@/domain/schema";
import { program } from "@/lib/content";
import { formatDate, formatTarget, todayIso } from "@/lib/format";

export const Route = createFileRoute("/")({ component: Today });

function Today() {
	const collections = useCollections();
	const rest = useRest();
	const today = todayIso();

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

	const phase = phaseForDate(program, today);
	const template = sessionForDate(program, today);
	const dayPlan = dayPlanForDate(program, today);

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

	// The latest ankle check gates progression even when today's pain was 0.
	const latestCheck =
		[...ankleChecks].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

	function ensureSession(): string {
		if (session) return session.id;
		const id = crypto.randomUUID();
		collections.sessions.insert({
			id,
			date: today,
			templateId: template?.id ?? "unscheduled",
			phase: phase.id,
			completed: false,
			notes: null,
			skippedExerciseIds: [],
			extraExerciseIds: [],
		});
		return id;
	}

	function saveSet(newSet: NewSet) {
		collections.sets.insert({
			...newSet,
			id: crypto.randomUUID(),
			sessionId: ensureSession(),
		});
		// Approach sets do not earn a full rest, and timed work is its own timer.
		if (!newSet.isWarmup && newSet.unit !== "minutes") rest.start();
	}

	function saveOverride(exerciseId: string, changes: OverrideChanges) {
		const existing = overrides.find((o) => o.exerciseId === exerciseId);
		if (existing) {
			collections.overrides.update(existing.id, (draft) =>
				Object.assign(draft, changes),
			);
		} else {
			collections.overrides.insert({
				id: crypto.randomUUID(),
				exerciseId,
				...changes,
			});
		}
	}

	function skipExercise(exerciseId: string) {
		const id = ensureSession();
		collections.sessions.update(id, (draft) => {
			draft.skippedExerciseIds = [
				...new Set([...draft.skippedExerciseIds, exerciseId]),
			];
		});
	}

	function restoreExercise(exerciseId: string) {
		if (!session) return;
		collections.sessions.update(session.id, (draft) => {
			draft.skippedExerciseIds = draft.skippedExerciseIds.filter(
				(id) => id !== exerciseId,
			);
		});
	}

	function addCustomExercise(custom: CustomExercise) {
		collections.customExercises.insert(custom);
		const id = ensureSession();
		collections.sessions.update(id, (draft) => {
			draft.extraExerciseIds = [
				...new Set([...draft.extraExerciseIds, custom.id]),
			];
		});
	}

	function addFinisher(custom: CustomExercise, minutes: number) {
		if (!collections.customExercises.has(custom.id)) {
			collections.customExercises.insert(custom);
		}
		const id = ensureSession();
		collections.sessions.update(id, (draft) => {
			draft.extraExerciseIds = [
				...new Set([...draft.extraExerciseIds, custom.id]),
			];
		});
		collections.sets.insert({
			id: crypto.randomUUID(),
			sessionId: id,
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
	}

	const exercises = template
		? resolveSessionExercises({
				template,
				phase: phase.id,
				overrides,
				customExercises,
				session,
			})
		: [];
	const putBack = template ? skippedExercises(template, phase.id, session) : [];
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

	const setsOf = (exercise: Exercise) =>
		resolveSets(
			exercise,
			phase.id,
			overrides.find((o) => o.exerciseId === exercise.id),
		);

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

	const progress = summarise(program, sessions, sets, today);

	const exerciseName = (exerciseId: string) =>
		exercises.find((exercise) => exercise.id === exerciseId)?.name ??
		program.sessions
			.flatMap((template) => template.exercises)
			.find((exercise) => exercise.id === exerciseId)?.name ??
		customExercises.find((exercise) => exercise.id === exerciseId)?.name ??
		exerciseId;

	const isComplete = exercises.length > 0 && done.size === exercises.length;

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
					{formatDate(today)} · Fase {phase.id} {phase.name}
				</p>
				<h1 className="mt-1 text-[1.75rem] leading-tight font-bold tracking-tight">
					{template?.name ?? dayPlan?.block ?? "Sin sesión"}
				</h1>
				<p className="mt-1 text-sm text-muted">
					{template ? phase.goal : (dayPlan?.focus ?? "")}
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
							minutes={session ? sessionMinutes(sets, session.id) : null}
							volumeChange={
								session ? volumeChange(sessions, sets, session.id) : null
							}
							streak={weekStreak(sessions, sets, today)}
							weekday={nextSessionWeekday(program, today)}
							exerciseName={exerciseName}
						/>
					) : null}

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
											{formatTarget(current.target, phase.id)}
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
									phase={phase.id}
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
												onClick={() => restoreExercise(exercise.id)}
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
					onSave={(changes) => {
						collections.sets.update(editingSet.set.id, (draft) =>
							Object.assign(draft, changes),
						);
						setEditingSet(null);
					}}
					onDelete={() => {
						collections.sets.delete(editingSet.set.id);
						setEditingSet(null);
					}}
					onClose={() => setEditingSet(null)}
				/>
			) : null}

			{settingsFor ? (
				<ExerciseSettings
					exercise={settingsFor}
					phase={phase.id}
					sets={setsOf(settingsFor)}
					onSave={(changes) => {
						saveOverride(settingsFor.id, changes);
						setSettingsFor(null);
					}}
					onSkip={() => {
						skipExercise(settingsFor.id);
						setSettingsFor(null);
					}}
					onReset={() => {
						const existing = overrides.find(
							(o) => o.exerciseId === settingsFor.id,
						);
						if (existing) collections.overrides.delete(existing.id);
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
					onSave={(notes) => {
						const id = ensureSession();
						collections.sessions.update(id, (draft) => {
							draft.notes = notes.trim() || null;
						});
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
