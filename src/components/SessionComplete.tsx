/**
 * The end of a session.
 *
 * It congratulates, but the useful part is underneath: what every exercise's
 * next target became, computed from what you just did. That is the column the
 * spreadsheet made you fill in by hand, and this is the moment it matters — you
 * are still standing there and can still write it down in your head.
 */

import type { ProgressionDecision } from "@/domain/progression";
import type { Exercise, SetRecord } from "@/domain/schema";
import { describeDecision } from "@/lib/format";

const TONE_TEXT = {
	reserve: "text-reserve",
	effort: "text-effort",
	stop: "text-stop",
	neutral: "text-muted",
} as const;

export type NextTarget = { exercise: Exercise; decision: ProgressionDecision };

export function SessionComplete({
	exerciseCount,
	sets,
	nextTargets,
	weekday,
}: {
	exerciseCount: number;
	sets: readonly SetRecord[];
	nextTargets: readonly NextTarget[];
	weekday: string;
}) {
	const working = sets.filter((set) => !set.isWarmup);
	const volume = working.reduce(
		(total, set) =>
			total + (set.unit === "kg" ? (set.load ?? 0) * (set.reps ?? 0) : 0),
		0,
	);
	const increases = nextTargets.filter(
		(target) => target.decision.kind === "increase",
	).length;

	return (
		<section className="border-t border-line bg-reserve-soft px-4 py-6">
			<p className="eyebrow text-reserve">Sesión completa</p>
			<h2 className="mt-2 text-xl font-semibold text-ink">
				{headline(increases)}
			</h2>

			<dl className="mt-4 grid grid-cols-3 gap-3">
				<Stat label="Ejercicios" value={String(exerciseCount)} />
				<Stat label="Series" value={String(working.length)} />
				<Stat
					label="Volumen"
					value={
						volume > 0 ? `${Math.round(volume).toLocaleString("es")} kg` : "—"
					}
				/>
			</dl>

			{volume > 0 ? (
				<p className="mt-3 text-[0.6875rem] text-faint">
					Volumen = carga × reps sumado en las series de trabajo.
				</p>
			) : null}

			{nextTargets.length > 0 ? (
				<div className="mt-6">
					<p className="eyebrow mb-2">Para la próxima</p>
					<ul className="space-y-2">
						{nextTargets.map(({ exercise, decision }) => {
							const copy = describeDecision(decision, exercise.progression);
							return (
								<li
									key={exercise.id}
									className="flex items-baseline justify-between gap-3"
								>
									<span className="min-w-0 flex-1 truncate text-[0.8125rem] text-muted">
										{exercise.name}
									</span>
									<span
										className={`shrink-0 text-[0.8125rem] font-semibold ${TONE_TEXT[copy.tone]}`}
									>
										{copy.headline}
									</span>
								</li>
							);
						})}
					</ul>
				</div>
			) : null}

			<p className="mt-6 text-[0.8125rem] text-muted">
				Nos vemos el {weekday}.
			</p>
		</section>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<dt className="eyebrow">{label}</dt>
			<dd className="tabular mt-1 text-lg font-semibold text-ink">{value}</dd>
		</div>
	);
}

/**
 * Says something true about the session rather than the same word every time —
 * praise that never varies stops being read after the third session.
 */
function headline(increases: number): string {
	if (increases === 0) return "Terminaste. Eso es lo que cuenta.";
	if (increases === 1) return "Terminaste, y te ganaste una subida de carga.";
	return `Terminaste, y te ganaste ${increases} subidas de carga.`;
}
