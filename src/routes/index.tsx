/**
 * Today.
 *
 * One screen, because at the gym every extra tap is a tap you take with one
 * hand between sets: the session, its exercises, and the logger for whichever
 * one you are on, all in the same place.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";
import { ExerciseLogger, type NewSet } from "@/components/ExerciseLogger";
import { useCollections } from "@/db/provider";
import {
	completedExerciseIds,
	previousPerformance,
	setsFor,
} from "@/domain/history";
import {
	exercisesForPhase,
	phaseForDate,
	targetSets,
	weeksUntilCheckpoint,
} from "@/domain/phases";
import { decideProgression } from "@/domain/progression";
import { dayPlanForDate, sessionForDate } from "@/domain/schedule";
import type { Exercise, SessionRecord, SetRecord } from "@/domain/schema";
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

	const phase = phaseForDate(program, today);
	const template = sessionForDate(program, today);
	const dayPlan = dayPlanForDate(program, today);

	// `undefined` means "nothing chosen yet", which falls back to the exercise
	// you are actually on — open the app mid-session and it is already there.
	const [openOverride, setOpenOverride] = useState<string | null | undefined>(
		undefined,
	);

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

	const exercises = template
		? exercisesForPhase(template.exercises, phase.id)
		: [];
	const done = session
		? completedExerciseIds(sets, session.id)
		: new Set<string>();
	const firstPending =
		exercises.find((exercise) => !done.has(exercise.id))?.id ?? null;
	const openExerciseId =
		openOverride === undefined ? firstPending : openOverride;

	return (
		<main className="mx-auto min-h-dvh w-full max-w-lg pb-24">
			<Header
				today={today}
				phaseName={phase.name}
				phaseId={phase.id}
				weeksLeft={weeksUntilCheckpoint(program, today)}
				title={template?.name ?? dayPlan?.block ?? "Sin sesión"}
				subtitle={template ? phase.goal : (dayPlan?.focus ?? "")}
			/>

			{template ? (
				<>
					<Progress exercises={exercises} done={done} />
					<ol>
						{exercises.map((exercise, index) => (
							<ExerciseRow
								key={exercise.id}
								index={index + 1}
								exercise={exercise}
								phaseId={phase.id}
								isDone={done.has(exercise.id)}
								isOpen={openExerciseId === exercise.id}
								onToggle={() =>
									setOpenOverride(
										openExerciseId === exercise.id ? null : exercise.id,
									)
								}
							>
								<ExerciseLogger
									exercise={exercise}
									phase={phase.id}
									targetSets={targetSets(exercise, phase.id)}
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
										targetSets: targetSets(exercise, phase.id),
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
								/>
							</ExerciseRow>
						))}
					</ol>
				</>
			) : (
				<RestDay
					block={dayPlan?.block ?? "Descanso"}
					notes={dayPlan?.notes ?? ""}
				/>
			)}

			<FooterNav />
		</main>
	);
}

function Header({
	today,
	phaseName,
	phaseId,
	weeksLeft,
	title,
	subtitle,
}: {
	today: string;
	phaseName: string;
	phaseId: number;
	weeksLeft: number;
	title: string;
	subtitle: string;
}) {
	return (
		<header className="px-4 pt-8 pb-6">
			<p className="eyebrow">
				{formatDate(today)} · Fase {phaseId} {phaseName}
			</p>
			<h1 className="tabular mt-3 text-2xl font-semibold tracking-tight uppercase">
				{title}
			</h1>
			<p className="mt-1 text-sm text-muted">{subtitle}</p>
			<p className="mt-3 text-[0.6875rem] text-faint">
				<span className="tabular">{weeksLeft}</span> semanas hasta el checkpoint
			</p>
		</header>
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
	phaseId,
	isDone,
	isOpen,
	onToggle,
	children,
}: {
	index: number;
	exercise: Exercise;
	phaseId: 1 | 2 | 3 | 4;
	isDone: boolean;
	isOpen: boolean;
	onToggle: () => void;
	children: React.ReactNode;
}) {
	const sets = targetSets(exercise, phaseId);

	return (
		<li className="border-t border-line last:border-b">
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={isOpen}
				className="flex w-full items-center gap-3 px-4 py-4 text-left active:bg-surface"
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
					{sets ? `${sets.max}×` : ""}
					{formatTarget(exercise.target, phaseId)}
				</span>
			</button>
			{isOpen ? children : null}
		</li>
	);
}

function RestDay({ block, notes }: { block: string; notes: string }) {
	return (
		<div className="border-t border-line px-4 py-10">
			<p className="text-sm text-muted">{block}</p>
			{notes ? <p className="mt-2 text-sm text-faint">{notes}</p> : null}
		</div>
	);
}

function FooterNav() {
	return (
		<nav className="fixed inset-x-0 bottom-0 border-t border-line bg-ground/95 backdrop-blur">
			<div className="mx-auto flex max-w-lg">
				<NavLink to="/" label="Hoy" />
				<NavLink to="/ankle" label="Tobillo" />
				<NavLink to="/history" label="Historial" />
			</div>
		</nav>
	);
}

function NavLink({ to, label }: { to: string; label: string }) {
	return (
		<Link
			to={to}
			className="eyebrow flex-1 py-4 text-center transition-colors"
			activeProps={{ className: "text-reserve" }}
			activeOptions={{ exact: true }}
		>
			{label}
		</Link>
	);
}

export type { SessionRecord, SetRecord };
