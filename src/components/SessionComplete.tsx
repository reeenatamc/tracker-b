/**
 * The end of a session.
 *
 * Built around what the serious lifting apps get right: the moment that lands is
 * not a statistic, it is a record. Hevy and Strong both put "you beat your
 * previous best" ahead of everything else, because a stat says what happened and
 * a record says it has never happened before.
 *
 * So: records first and large, then the numbers, then where this leaves you in
 * the nineteen weeks — the part no general app could show, because it only
 * exists in a program that ends at a thesis defence.
 *
 * Everything here is checkable. "Vas progresando" stops landing after the third
 * session; "Prensa 25 kg, antes 20" keeps landing.
 */

import type { LoadGain, PersonalRecord, Progress } from "@/domain/achievements";
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
	records,
	minutes,
	volumeChange,
	streak,
	weekday,
	exerciseName,
}: {
	sets: readonly SetRecord[];
	nextTargets: readonly NextTarget[];
	progress: Progress;
	records: readonly PersonalRecord[];
	minutes: number | null;
	volumeChange: number | null;
	streak: number;
	weekday: string;
	exerciseName: (exerciseId: string) => string;
}) {
	const working = sets.filter((set) => !set.isWarmup);
	const volume = working.reduce(
		(total, set) =>
			total + (set.unit === "kg" ? (set.load ?? 0) * (set.reps ?? 0) : 0),
		0,
	);

	return (
		<section className="card bg-reserve-soft">
			<div className="flex flex-col items-center pt-2 pb-1 text-center">
				<Medal />
				<h2 className="mt-3 text-[1.75rem] leading-tight font-bold tracking-tight text-balance text-ink">
					{headline(
						records.length,
						progress.sessionsThisWeek,
						progress.sessionsTarget,
					)}
				</h2>
				{streak > 1 ? (
					<p className="mt-2 text-[0.8125rem] font-semibold text-reserve">
						{streak} semanas seguidas cumpliendo
					</p>
				) : null}
			</div>

			{records.length > 0 ? (
				<div className="mt-6">
					<p className="eyebrow mb-2 text-reserve">
						{records.length === 1
							? "Récord personal"
							: `${records.length} récords personales`}
					</p>
					<ul className="space-y-2">
						{records.map((record) => (
							<li
								key={record.exerciseId}
								className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2.5"
							>
								<span className="min-w-0 flex-1 truncate text-[0.9375rem] font-medium text-ink">
									{exerciseName(record.exerciseId)}
								</span>
								<span className="tabular shrink-0 text-right">
									<span className="block text-[0.9375rem] font-bold text-reserve">
										{format(record.value)}
										{unitOf(record.unit)}
									</span>
									<span className="block text-[0.6875rem] text-faint">
										antes {format(record.previous)}
										{unitOf(record.unit)}
									</span>
								</span>
							</li>
						))}
					</ul>
				</div>
			) : null}

			<dl className="mt-6 grid grid-cols-3 gap-3">
				<Stat
					label="Duración"
					value={minutes === null ? "—" : `${minutes} min`}
				/>
				<Stat label="Series" value={String(working.length)} />
				<Stat
					label="Volumen"
					value={
						volume > 0 ? `${Math.round(volume).toLocaleString("es")} kg` : "—"
					}
					// Against the last time this same session was done — the only
					// comparison that is like for like.
					note={
						volumeChange === null
							? undefined
							: `${volumeChange > 0 ? "+" : ""}${volumeChange}% vs. la anterior`
					}
					noteTone={
						volumeChange !== null && volumeChange > 0 ? "reserve" : "neutral"
					}
				/>
			</dl>

			<div className="mt-6 rounded-xl bg-surface p-4">
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
				<div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
					<div
						className="h-full rounded-full bg-reserve transition-[width]"
						style={{
							width: `${Math.min(100, Math.round((progress.week / progress.totalWeeks) * 100))}%`,
						}}
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

			{progress.gains.length > 0 ? (
				<div className="mt-6">
					<p className="eyebrow mb-2">Desde que empezaste</p>
					<ul className="space-y-1.5">
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
				<div className="mt-6">
					<p className="eyebrow mb-2">Para la próxima</p>
					<ul className="space-y-1.5">
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

			<p className="mt-6 text-center text-[0.8125rem] text-muted">
				Nos vemos el {weekday}.
			</p>
		</section>
	);
}

function Gain({ gain, name }: { gain: LoadGain; name: string }) {
	return (
		<li className="flex items-baseline justify-between gap-3">
			<span className="min-w-0 flex-1 truncate text-[0.8125rem] text-muted">
				{name}
			</span>
			<span className="tabular shrink-0 text-[0.8125rem] font-semibold text-reserve">
				{format(gain.from)} → {format(gain.to)}
				{unitOf(gain.unit)}
			</span>
		</li>
	);
}

function Stat({
	label,
	value,
	note,
	noteTone = "neutral",
}: {
	label: string;
	value: string;
	note?: string;
	noteTone?: keyof typeof TONE_TEXT;
}) {
	return (
		<div className="rounded-xl bg-surface px-3 py-3">
			<dt className="eyebrow">{label}</dt>
			<dd className="tabular mt-1 text-lg font-bold text-ink">{value}</dd>
			{note ? (
				<dd
					className={`tabular mt-0.5 text-[0.6875rem] ${TONE_TEXT[noteTone]}`}
				>
					{note}
				</dd>
			) : null}
		</div>
	);
}

/**
 * The one decorative thing in the app, and it only appears here. Drawn rather
 * than an emoji so it takes the accent colour and stays crisp at any size.
 */
function Medal() {
	return (
		<svg
			viewBox="0 0 48 48"
			className="size-14"
			role="img"
			aria-label="Sesión completa"
		>
			<title>Sesión completa</title>
			<path
				d="M15 5 L24 20 L33 5"
				fill="none"
				stroke="var(--color-reserve)"
				strokeWidth="3"
				strokeLinecap="round"
			/>
			<circle
				cx="24"
				cy="30"
				r="13"
				fill="var(--color-reserve)"
				stroke="var(--color-surface)"
				strokeWidth="2"
			/>
			<path
				d="M18 30.3 L22.3 34.6 L30.4 26"
				fill="none"
				stroke="var(--color-on-accent)"
				strokeWidth="3.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function unitOf(unit: LoadGain["unit"]): string {
	return unit === "kg" ? " kg" : unit === "seconds" ? " s" : " reps";
}

function format(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Reports this session rather than praising it. Praise that never varies stops
 * being read, and the app has one job it cannot afford to lose: being believed.
 */
function headline(
	records: number,
	sessionsThisWeek: number,
	target: number,
): string {
	if (records === 1) return "Récord personal.";
	if (records > 1) return `${records} récords en una sesión.`;
	if (sessionsThisWeek >= target) return "Semana completa.";
	return "Terminaste. Eso es lo que cuenta.";
}
