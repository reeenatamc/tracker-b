/**
 * The end of a session.
 *
 * It celebrates, but everything it says is measured. "Vas progresando" with
 * nothing behind it stops landing after the third session; "Prensa 5 → 20
 * kg/lado desde que empezaste" keeps landing, because you can check it.
 *
 * Three layers, in the order they matter: what you just did, where that leaves
 * you in the nineteen weeks, and what each exercise's next target became — the
 * column the spreadsheet made you write by hand, at the one moment you are still
 * standing there.
 */

import type { LoadGain, Progress } from "@/domain/achievements";
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
	sets,
	nextTargets,
	progress,
	weekday,
	exerciseName,
}: {
	sets: readonly SetRecord[];
	nextTargets: readonly NextTarget[];
	progress: Progress;
	weekday: string;
	exerciseName: (exerciseId: string) => string;
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
		<section className="border-t border-line bg-reserve-soft px-4 py-7">
			<div className="flex items-start gap-3">
				<Medal />
				<div className="min-w-0 flex-1">
					<p className="eyebrow text-reserve">Sesión completa</p>
					<h2 className="mt-1 text-xl leading-snug font-semibold text-balance text-ink">
						{headline(increases)}
					</h2>
				</div>
			</div>

			<dl className="mt-5 grid grid-cols-3 gap-3">
				<Stat label="Ejercicios" value={String(nextTargets.length)} />
				<Stat label="Series" value={String(working.length)} />
				<Stat
					label="Volumen"
					value={
						volume > 0 ? `${Math.round(volume).toLocaleString("es")} kg` : "—"
					}
				/>
			</dl>

			<ProgramProgress progress={progress} />

			{progress.gains.length > 0 ? (
				<div className="mt-7">
					<p className="eyebrow mb-3">Desde que empezaste</p>
					<ul className="space-y-2">
						{progress.gains.slice(0, 4).map((gain) => (
							<Gain
								key={gain.exerciseId}
								gain={gain}
								name={exerciseName(gain.exerciseId)}
							/>
						))}
					</ul>
					{progress.gains.length > 4 ? (
						<p className="mt-2 text-[0.6875rem] text-faint">
							Y {progress.gains.length - 4} más.
						</p>
					) : null}
				</div>
			) : null}

			{nextTargets.length > 0 ? (
				<div className="mt-7">
					<p className="eyebrow mb-3">Para la próxima</p>
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

			<p className="mt-7 text-[0.8125rem] text-muted">
				Nos vemos el {weekday}.
			</p>
		</section>
	);
}

/** Where this session sits in the nineteen weeks. */
function ProgramProgress({ progress }: { progress: Progress }) {
	const percent = Math.min(
		100,
		Math.round((progress.week / progress.totalWeeks) * 100),
	);

	return (
		<div className="mt-7">
			<div className="flex items-baseline justify-between">
				<p className="eyebrow">
					Semana <span className="text-reserve">{progress.week}</span> de{" "}
					{progress.totalWeeks}
				</p>
				<p className="eyebrow">
					{progress.weeksToCheckpoint === 0
						? "Es la semana"
						: `Faltan ${progress.weeksToCheckpoint}`}
				</p>
			</div>

			<div className="mt-2 h-2 overflow-hidden rounded-full bg-surface">
				<div
					className="h-full rounded-full bg-reserve transition-[width]"
					style={{ width: `${percent}%` }}
				/>
			</div>

			<p className="mt-2 text-[0.8125rem] text-muted">
				Fase {progress.phaseId} · {progress.phaseName} ·{" "}
				<span className="tabular">
					{progress.sessionsThisWeek}/{progress.sessionsTarget}
				</span>{" "}
				sesiones esta semana
			</p>
		</div>
	);
}

function Gain({ gain, name }: { gain: LoadGain; name: string }) {
	const unit =
		gain.unit === "kg" ? " kg" : gain.unit === "seconds" ? " s" : " reps";
	return (
		<li className="flex items-baseline justify-between gap-3">
			<span className="min-w-0 flex-1 truncate text-[0.8125rem] text-muted">
				{name}
			</span>
			<span className="tabular shrink-0 text-[0.8125rem] font-semibold text-reserve">
				{format(gain.from)} → {format(gain.to)}
				{unit}
			</span>
		</li>
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
 * The one decorative thing in the whole app, and it only ever appears here.
 * Drawn rather than an emoji so it takes the accent colour and stays crisp.
 */
function Medal() {
	return (
		<svg
			viewBox="0 0 32 32"
			className="mt-0.5 size-9 shrink-0"
			role="img"
			aria-label="Sesión completa"
		>
			<title>Sesión completa</title>
			<path
				d="M11 3 L16 12 L21 3"
				fill="none"
				stroke="var(--color-reserve)"
				strokeWidth="2.5"
				strokeLinecap="round"
			/>
			<circle
				cx="16"
				cy="20"
				r="8.5"
				fill="var(--color-surface)"
				stroke="var(--color-reserve)"
				strokeWidth="2.5"
			/>
			<path
				d="M12.5 20.2 L15 22.7 L19.6 17.6"
				fill="none"
				stroke="var(--color-reserve)"
				strokeWidth="2.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function format(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Says something true about this particular session. Praise that never varies
 * stops being read, so the line reports what actually happened.
 */
function headline(increases: number): string {
	if (increases === 0) return "Terminaste. Eso es lo que cuenta.";
	if (increases === 1) return "Terminaste, y te ganaste una subida de carga.";
	return `Terminaste, y te ganaste ${increases} subidas de carga.`;
}
