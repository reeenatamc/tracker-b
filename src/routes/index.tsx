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
import { ExerciseLogger, type NewSet } from "@/components/ExerciseLogger";
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
import { phaseForDate, weeksUntilCheckpoint } from "@/domain/phases";
import { decideProgression } from "@/domain/progression";
import { dayPlanForDate, sessionForDate } from "@/domain/schedule";
import type { CustomExercise, Exercise, SetRecord } from "@/domain/schema";
import { program } from "@/lib/content";
import { formatDate, formatTarget, todayIso } from "@/lib/format";

export const Route = createFileRoute("/")({ component: Today });

function Today() {
	const collections = useCollections();
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
	const [openOverride, setOpenOverride] = useState<string | null | undefined>(
		undefined,
	);
	const [editingSet, setEditingSet] = useState<{
		set: SetRecord;
		exercise: Exercise;
	} | null>(null);
	const [settingsFor, setSettingsFor] = useState<Exercise | null>(null);
	const [addingExercise, setAddingExercise] = useState(false);
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

	const setsOf = (exercise: Exercise) =>
		resolveSets(
			exercise,
			phase.id,
			overrides.find((o) => o.exerciseId === exercise.id),
		);

	return (
		<main className="mx-auto min-h-dvh w-full max-w-lg pb-24">
			<header className="px-4 pt-8 pb-6">
				<p className="eyebrow">
					{formatDate(today)} · Fase {phase.id} {phase.name}
				</p>
				<h1 className="tabular mt-3 text-2xl font-semibold tracking-tight uppercase">
					{template?.name ?? dayPlan?.block ?? "Sin sesión"}
				</h1>
				<p className="mt-1 text-sm text-muted">
					{template ? phase.goal : (dayPlan?.focus ?? "")}
				</p>
				<p className="mt-3 text-[0.6875rem] text-faint">
					<span className="tabular">
						{weeksUntilCheckpoint(program, today)}
					</span>{" "}
					semanas hasta el checkpoint
				</p>
			</header>

			{template ? (
				<>
					<Progress exercises={exercises} done={done} />
					<ol>
						{exercises.map((exercise, index) => (
							<ExerciseRow
								key={exercise.id}
								index={index + 1}
								exercise={exercise}
								setsLabel={setsOf(exercise)}
								phaseId={phase.id}
								isDone={done.has(exercise.id)}
								isOpen={openExerciseId === exercise.id}
								onToggle={() =>
									setOpenOverride(
										openExerciseId === exercise.id ? null : exercise.id,
									)
								}
								onSettings={() => setSettingsFor(exercise)}
							>
								<ExerciseLogger
									exercise={exercise}
									phase={phase.id}
									targetSets={setsOf(exercise)}
									targetRir={phase.targetRir}
									decision={decideProgression({
										exercise,
										lastSets:
											previousPerformance(
												sets,
												sessions,
												exercise.id,
												session?.id ?? null,
											)?.sets ?? [],
										targetRir: phase.targetRir,
										targetSets: setsOf(exercise),
										safety: latestCheck
											? {
													swelling: latestCheck.swelling,
													givesWay: latestCheck.givesWay,
												}
											: undefined,
									})}
									previous={previousPerformance(
										sets,
										sessions,
										exercise.id,
										session?.id ?? null,
									)}
									todaySets={
										session ? setsFor(sets, session.id, exercise.id) : []
									}
									onSave={saveSet}
									onEditSet={(set) => setEditingSet({ set, exercise })}
								/>
							</ExerciseRow>
						))}
					</ol>

					<section className="border-t border-line px-4 py-6">
						<button
							type="button"
							onClick={() => setAddingExercise(true)}
							className="h-12 w-full rounded-lg border border-line text-sm text-reserve"
						>
							Añadir ejercicio
						</button>

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
				<div className="border-t border-line px-4 py-10">
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

/** One block per exercise: the session's shape, and how much of it is behind you. */
function Progress({
	exercises,
	done,
}: {
	exercises: readonly Exercise[];
	done: ReadonlySet<string>;
}) {
	return (
		<div className="px-4 pb-5">
			<div className="flex gap-1" aria-hidden>
				{exercises.map((exercise) => (
					<span
						key={exercise.id}
						className={`h-1.5 flex-1 rounded-full transition-colors ${
							done.has(exercise.id) ? "bg-reserve" : "bg-line"
						}`}
					/>
				))}
			</div>
			<p className="eyebrow mt-2">
				{done.size} de {exercises.length} ejercicios
			</p>
		</div>
	);
}

function ExerciseRow({
	index,
	exercise,
	setsLabel,
	phaseId,
	isDone,
	isOpen,
	onToggle,
	onSettings,
	children,
}: {
	index: number;
	exercise: Exercise;
	setsLabel: { min: number; max: number } | null;
	phaseId: 1 | 2 | 3 | 4;
	isDone: boolean;
	isOpen: boolean;
	onToggle: () => void;
	onSettings: () => void;
	children: React.ReactNode;
}) {
	return (
		<li className="border-t border-line last:border-b">
			<div className="flex items-stretch">
				<button
					type="button"
					onClick={onToggle}
					aria-expanded={isOpen}
					className="flex flex-1 items-center gap-3 px-4 py-4 text-left active:bg-surface"
				>
					<span
						className={`tabular w-6 shrink-0 text-xs ${isDone ? "text-reserve" : "text-faint"}`}
						aria-hidden
					>
						{isDone ? "✓" : String(index).padStart(2, "0")}
					</span>
					<span className="min-w-0 flex-1">
						<span className="block truncate text-[0.9375rem]">
							{exercise.name}
						</span>
						{exercise.isAnkle ? (
							<span className="eyebrow mt-0.5 block text-faint">tobillo</span>
						) : null}
					</span>
					<span className="tabular shrink-0 text-xs text-muted">
						{setsLabel ? `${setsLabel.max}×` : ""}
						{formatTarget(exercise.target, phaseId)}
					</span>
				</button>
				<button
					type="button"
					onClick={onSettings}
					aria-label={`Ajustes de ${exercise.name}`}
					className="px-4 text-lg text-faint active:bg-surface"
				>
					⋯
				</button>
			</div>
			{isOpen ? children : null}
		</li>
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
