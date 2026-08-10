/**
 * Where the whole thing stands.
 *
 * The spreadsheet opened on a Dashboard sheet listing five objectives, each with
 * how it is measured. This is that sheet, with the measurements filled in from
 * what has actually been logged — so the answer to "is this working" is a number
 * you can check rather than a feeling.
 *
 * An objective with nothing logged against it says so. That is the point: the
 * gaps are information too, and the first thing you notice is usually the
 * measurement you have not been taking.
 */

import type { Progress } from "@/domain/achievements";
import { consistencyScore, deltaFromBaseline, series } from "@/domain/progress";
import type { AnkleCheck, ProgressCheck, Program } from "@/domain/schema";
import { formatDayMonth } from "@/lib/format";

type Reading = {
	/** The value, or null when nothing has been logged to answer this yet. */
	value: string | null;
	tone: "reserve" | "effort" | "stop" | "neutral";
	/** What is missing, when there is no value. */
	missing?: string;
};

export function Dashboard({
	program,
	progress,
	checks,
	ankleChecks,
}: {
	program: Program;
	progress: Progress;
	checks: readonly ProgressCheck[];
	ankleChecks: readonly AnkleCheck[];
}) {
	const percent = Math.min(
		100,
		Math.round((progress.week / progress.totalWeeks) * 100),
	);
	const latestAnkle =
		[...ankleChecks].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
	const latestCheck =
		[...checks].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
	const readings = readingsFor(progress, checks, latestAnkle, latestCheck);

	return (
		<>
			<section className="card">
				<div className="flex items-baseline justify-between">
					<p className="eyebrow">
						Semana <span className="text-reserve">{progress.week}</span> de{" "}
						{progress.totalWeeks}
					</p>
					<p className="eyebrow">
						{progress.weeksToCheckpoint === 0
							? "Semana del checkpoint"
							: `Faltan ${progress.weeksToCheckpoint}`}
					</p>
				</div>

				<div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
					<div
						className="h-full rounded-full bg-reserve transition-[width]"
						style={{ width: `${percent}%` }}
					/>
				</div>

				<p className="mt-3 text-[0.8125rem] text-muted">
					Fase {progress.phaseId} · {progress.phaseName}
				</p>

				<dl className="mt-5 grid grid-cols-3 gap-3">
					<Tile
						label="Esta semana"
						value={`${progress.sessionsThisWeek}/${progress.sessionsTarget}`}
						tone={
							progress.sessionsThisWeek >= progress.sessionsTarget
								? "reserve"
								: "neutral"
						}
					/>
					<Tile
						label="Sesiones"
						value={String(progress.totalSessions)}
						tone="neutral"
					/>
					<Tile
						label="Subidas"
						value={String(progress.gains.length)}
						tone={progress.gains.length > 0 ? "reserve" : "neutral"}
					/>
				</dl>
			</section>

			<section className="card">
				<div className="mb-1 flex items-baseline justify-between">
					<p className="eyebrow">Medidas</p>
					{latestCheck ? (
						<p className="eyebrow">{formatDayMonth(latestCheck.date)}</p>
					) : null}
				</div>
				<p className="mb-4 text-[0.8125rem] text-faint">
					{latestCheck
						? "Lo último que registraste, y cuánto se movió desde el inicio."
						: "Todavía sin medidas. Regístralas abajo y aparecerán aquí."}
				</p>

				<dl className="grid grid-cols-2 gap-4">
					{MEASURES.map(({ field, label, unit }) => {
						const points = series(checks, field);
						const latest = points.at(-1)?.value ?? null;
						const delta = deltaFromBaseline(checks, field);
						return (
							<div key={field}>
								<dt className="eyebrow">{label}</dt>
								<dd className="tabular mt-1 text-xl font-bold text-ink">
									{latest === null ? "—" : `${latest} ${unit}`}
								</dd>
								{delta !== null ? (
									<dd
										className={`tabular mt-0.5 text-[0.6875rem] ${
											delta < 0
												? "text-reserve"
												: delta > 0
													? "text-effort"
													: "text-faint"
										}`}
									>
										{delta > 0 ? "+" : ""}
										{delta} {unit} desde el inicio
									</dd>
								) : latest !== null ? (
									<dd className="mt-0.5 text-[0.6875rem] text-faint">
										Falta una segunda medida para comparar
									</dd>
								) : null}
							</div>
						);
					})}
				</dl>
			</section>

			<section className="card">
				<p className="eyebrow mb-1">Objetivos del plan</p>
				<p className="mb-4 text-[0.8125rem] text-faint">
					Cómo va cada uno, con lo que has registrado.
				</p>

				<ul className="space-y-4">
					{program.objectives.map((objective) => {
						const reading = readings[objective.objective] ?? {
							value: null,
							tone: "neutral" as const,
						};
						return (
							<li key={objective.objective}>
								<div className="flex items-baseline justify-between gap-3">
									<p className="min-w-0 flex-1 text-[0.9375rem] text-ink">
										{objective.objective}
									</p>
									<p
										className={`tabular shrink-0 text-[0.8125rem] font-semibold ${TONE[reading.tone]}`}
									>
										{reading.value ?? "—"}
									</p>
								</div>
								<p className="mt-0.5 text-[0.8125rem] text-muted">
									{objective.target}
								</p>
								<p className="mt-0.5 text-[0.6875rem] text-faint">
									{reading.value === null
										? (reading.missing ??
											`Se mide con: ${objective.measuredBy}`)
										: objective.measuredBy}
								</p>
							</li>
						);
					})}
				</ul>
			</section>

			{program.keyRules.length > 0 ? (
				<details className="card">
					<summary className="eyebrow cursor-pointer">Reglas clave</summary>
					<ul className="mt-4 space-y-3">
						{program.keyRules.map((rule) => (
							<li key={rule.rule}>
								<p className="text-[0.8125rem] font-semibold text-ink">
									{rule.rule}
								</p>
								<p className="mt-0.5 text-[0.8125rem] text-muted">
									{rule.detail}
								</p>
							</li>
						))}
					</ul>
				</details>
			) : null}
		</>
	);
}

/** The four the spreadsheet tracks, in the order it lists them. */
const MEASURES = [
	{ field: "weightKg", label: "Peso", unit: "kg" },
	{ field: "waistCm", label: "Cintura", unit: "cm" },
	{ field: "hipCm", label: "Cadera", unit: "cm" },
	{ field: "thighCm", label: "Muslo", unit: "cm" },
] as const;

const TONE = {
	reserve: "text-reserve",
	effort: "text-effort",
	stop: "text-stop",
	neutral: "text-muted",
} as const;

/**
 * Maps each objective onto the measurement the spreadsheet said would answer it.
 * Keyed by the objective's own name, so editing `content/program.yaml` changes
 * what is listed without touching this — an unknown objective simply shows how
 * it is meant to be measured.
 */
function readingsFor(
	progress: Progress,
	checks: readonly ProgressCheck[],
	ankle: AnkleCheck | null,
	latestCheck: ProgressCheck | null,
): Record<string, Reading> {
	const waist = deltaFromBaseline(checks, "waistCm");
	const weight = deltaFromBaseline(checks, "weightKg");
	const score = latestCheck ? consistencyScore(latestCheck) : null;

	return {
		"Composición corporal": {
			value:
				weight === null
					? null
					: `${weight > 0 ? "+" : ""}${weight} kg${waist !== null ? ` · ${waist > 0 ? "+" : ""}${waist} cm` : ""}`,
			// The plan is recomposition, so down is the direction that matters and
			// holding steady is not a failure.
			tone:
				weight === null
					? "neutral"
					: waist !== null && waist < 0
						? "reserve"
						: "neutral",
			missing: "Falta registrar peso y cintura dos semanas seguidas.",
		},
		Abdomen: {
			value: waist === null ? null : `${waist > 0 ? "+" : ""}${waist} cm`,
			tone: waist === null ? "neutral" : waist < 0 ? "reserve" : "neutral",
			missing: "Falta medir la cintura.",
		},
		Tobillo: {
			value: ankle
				? `dolor ${ankle.pain}${ankle.bestBalance !== null ? ` · ${ankle.bestBalance} s` : ""}`
				: null,
			tone: !ankle
				? "neutral"
				: ankle.pain >= 3 || ankle.swelling || ankle.givesWay
					? "stop"
					: "reserve",
			missing: "Falta el chequeo semanal del tobillo.",
		},
		Fuerza: {
			value:
				progress.gains.length === 0
					? null
					: `${progress.gains.length} ${progress.gains.length === 1 ? "ejercicio" : "ejercicios"} ↑`,
			tone: progress.gains.length > 0 ? "reserve" : "neutral",
			missing: "Hacen falta dos sesiones del mismo ejercicio para comparar.",
		},
		Adherencia: {
			value: score === null ? null : `${score}/100`,
			tone:
				score === null
					? "neutral"
					: score >= 80
						? "reserve"
						: score >= 50
							? "effort"
							: "stop",
			missing: "Falta registrar la semana en Progreso.",
		},
	};
}

function Tile({
	label,
	value,
	tone,
}: {
	label: string;
	value: string;
	tone: keyof typeof TONE;
}) {
	return (
		<div>
			<dt className="eyebrow">{label}</dt>
			<dd className={`tabular mt-1 text-xl font-semibold ${TONE[tone]}`}>
				{value}
			</dd>
		</div>
	);
}
