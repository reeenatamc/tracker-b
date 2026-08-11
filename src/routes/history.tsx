/**
 * Past sessions, newest first — the log read back, and edited.
 *
 * Every set here is tappable. Mistakes get noticed later, not while you are
 * still standing at the machine, and a wrong load is not just a wrong row:
 * progression reads the last session, so it steers the next suggestion until it
 * is fixed.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { BackupPanel } from "@/components/BackupPanel";
import { SetEditor } from "@/components/SetEditor";
import { PageHeader, TabBar } from "@/components/TabBar";
import { persisted } from "@/db/durability";
import { useRecords } from "@/db/records";
import { displayName } from "@/domain/exercise-ids";
import { findExercise } from "@/domain/personalise";
import { phaseById, phaseOfSession } from "@/domain/phases";
import { sessionById } from "@/domain/schedule";
import type { Exercise, PhaseId, SetRecord } from "@/domain/schema";
import { program } from "@/lib/content";
import { formatDate, formatRirSummary, formatSet } from "@/lib/format";

export const Route = createFileRoute("/history")({ component: History });

function History() {
	const { collections, sessions, sets, overrides, customExercises } =
		useRecords();

	const [editing, setEditing] = useState<{
		set: SetRecord;
		exercise: Exercise;
		phase: PhaseId;
	} | null>(null);

	const ordered = [...sessions].sort((a, b) => b.date.localeCompare(a.date));

	/** Falls back to a permissive placeholder so no set is ever uneditable. */
	const exerciseFor = (exerciseId: string): Exercise =>
		findExercise(program.sessions, customExercises, overrides, exerciseId) ?? {
			id: exerciseId,
			name: displayName(exerciseId),
			order: 0,
			setsByPhase: { 1: 1, 2: 1, 3: 1, 4: 1 },
			target: { kind: "reps", min: 1, max: 99 },
			load: {
				startKg: null,
				perSide: false,
				relativeToBase: false,
				bodyweight: false,
				needsCalibration: false,
				incrementKg: null,
				raw: "",
			},
			progression: "",
			goal: "",
			muscle: "",
			rir: null,
			restSeconds: null,
			substitution: "",
			technique: "",
			isAnkle: false,
		};

	return (
		<main className="mx-auto min-h-dvh w-full max-w-lg space-y-3 px-3 pb-[calc(8.5rem+env(safe-area-inset-bottom))]">
			<PageHeader
				eyebrow="Registro completo"
				title="Historial"
				subtitle={`${sessions.length} sesiones · ${
					sets.filter((set) => !set.isWarmup).length
				} series de trabajo · toca una serie para corregirla`}
			/>

			{ordered.length === 0 ? (
				<div className="card">
					<p className="text-sm text-muted">
						Todavía no hay sesiones registradas.
					</p>
					<Link to="/" className="mt-3 inline-block text-sm text-reserve">
						Empezar la de hoy
					</Link>
				</div>
			) : (
				ordered.map((session) => {
					const sessionSets = sets.filter(
						(set) => set.sessionId === session.id,
					);
					const byExercise = groupByExercise(sessionSets);

					return (
						<section key={session.id} className="card">
							<div className="flex items-baseline justify-between">
								<p className="eyebrow">{formatDate(session.date)}</p>
								<p className="eyebrow">
									{phaseOfSession(program, session)?.name ?? session.phase}
								</p>
							</div>
							<h2 className="mt-1 text-[0.9375rem]">
								{templateName(session.templateId)}
							</h2>

							<ul className="mt-3 space-y-3">
								{[...byExercise].map(([exerciseId, exerciseSets]) => (
									<li key={exerciseId}>
										<p className="text-[0.8125rem] text-muted">
											{exerciseFor(exerciseId).name}
										</p>
										<div className="mt-1 flex flex-wrap items-center gap-2">
											{exerciseSets.map((set) => (
												<button
													key={set.id}
													type="button"
													onClick={() =>
														setEditing({
															set,
															exercise: exerciseFor(exerciseId),
															phase: session.phase,
														})
													}
													className="tabular rounded-md border border-line bg-surface px-2 py-1 text-[0.8125rem] text-faint active:bg-raised"
												>
													{formatSet(set)}
													{set.isWarmup ? (
														<span className="ml-1">aprox.</span>
													) : null}
												</button>
											))}
											{formatRirSummary(exerciseSets) ? (
												<span className="tabular text-[0.8125rem] text-faint">
													{formatRirSummary(exerciseSets)}
												</span>
											) : null}
										</div>
									</li>
								))}
							</ul>

							{session.notes ? (
								<p className="mt-3 text-[0.8125rem] text-faint italic">
									«{session.notes}»
								</p>
							) : null}
						</section>
					);
				})
			)}

			<BackupPanel />

			{editing ? (
				<SetEditor
					set={editing.set}
					exercise={editing.exercise}
					targetRir={phaseById(program, editing.phase).targetRir}
					onSave={async (changes) => {
						await collections.sets.update(editing.set.id, (draft) =>
							Object.assign(draft, changes),
						);
						setEditing(null);
					}}
					onDelete={async () => {
						await persisted(collections.sets.delete(editing.set.id));
						setEditing(null);
					}}
					onClose={() => setEditing(null)}
				/>
			) : null}

			<TabBar />
		</main>
	);
}

function groupByExercise<T extends { exerciseId: string; setNumber: number }>(
	sets: readonly T[],
) {
	const grouped = new Map<string, T[]>();
	for (const set of [...sets].sort((a, b) => a.setNumber - b.setNumber)) {
		const existing = grouped.get(set.exerciseId);
		if (existing) existing.push(set);
		else grouped.set(set.exerciseId, [set]);
	}
	return grouped;
}

function templateName(templateId: string): string {
	try {
		return sessionById(program, templateId).name;
	} catch {
		return "Sesión";
	}
}
