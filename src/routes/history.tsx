/**
 * Past sessions, newest first — the log read back.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { useCollections } from "@/db/provider";
import { sessionById } from "@/domain/schedule";
import { program } from "@/lib/content";
import { formatDate, formatRirSummary, formatSet } from "@/lib/format";

export const Route = createFileRoute("/history")({ component: History });

function History() {
	const collections = useCollections();
	const { data: sessions = [] } = useLiveQuery((q) =>
		q.from({ s: collections.sessions }),
	);
	const { data: sets = [] } = useLiveQuery((q) =>
		q.from({ s: collections.sets }),
	);

	const ordered = [...sessions].sort((a, b) => b.date.localeCompare(a.date));

	return (
		<main className="mx-auto min-h-dvh w-full max-w-lg pb-24">
			<header className="px-4 pt-8 pb-6">
				<p className="eyebrow">Registro completo</p>
				<h1 className="tabular mt-3 text-2xl font-semibold tracking-tight uppercase">
					Historial
				</h1>
				<p className="mt-1 text-sm text-muted">
					<span className="tabular">{sessions.length}</span> sesiones ·{" "}
					<span className="tabular">
						{sets.filter((set) => !set.isWarmup).length}
					</span>{" "}
					series de trabajo
				</p>
			</header>

			{ordered.length === 0 ? (
				<div className="border-t border-line px-4 py-10">
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
						<section
							key={session.id}
							className="border-t border-line px-4 py-5"
						>
							<div className="flex items-baseline justify-between">
								<p className="eyebrow">{formatDate(session.date)}</p>
								<p className="eyebrow">Fase {session.phase}</p>
							</div>
							<h2 className="mt-1 text-[0.9375rem]">
								{templateName(session.templateId)}
							</h2>

							<ul className="mt-3 space-y-2">
								{[...byExercise].map(([exerciseId, exerciseSets]) => (
									<li key={exerciseId}>
										<p className="text-[0.8125rem] text-muted">
											{exerciseName(exerciseId)}
										</p>
										<p className="tabular mt-0.5 text-[0.8125rem] text-faint">
											{exerciseSets.map(formatSet).join("  ·  ")}
											{formatRirSummary(exerciseSets)
												? `   ${formatRirSummary(exerciseSets)}`
												: ""}
										</p>
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

			<nav className="fixed inset-x-0 bottom-0 border-t border-line bg-ground/95 backdrop-blur">
				<div className="mx-auto flex max-w-lg">
					<Link to="/" className="eyebrow flex-1 py-4 text-center">
						Hoy
					</Link>
					<Link to="/ankle" className="eyebrow flex-1 py-4 text-center">
						Tobillo
					</Link>
					<Link
						to="/history"
						className="eyebrow flex-1 py-4 text-center"
						activeProps={{ className: "text-reserve" }}
					>
						Historial
					</Link>
				</div>
			</nav>
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

/** Exercise names live in the program, keyed by the canonical id. */
function exerciseName(exerciseId: string): string {
	for (const session of program.sessions) {
		const match = session.exercises.find(
			(exercise) => exercise.id === exerciseId,
		);
		if (match) return match.name;
	}
	return exerciseId;
}
