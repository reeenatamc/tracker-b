/**
 * The cardio half of a Tuesday, Thursday or Saturday.
 *
 * One number matters — how long — so it is the only thing set large. Everything
 * else the spreadsheet says about cardio is guidance you read once and then
 * carry, so it sits underneath at reading size rather than competing.
 *
 * Logging it is one tap: minutes are already prescribed, and adjusting them is
 * the same stepper as everywhere else.
 */

import { useState } from "react";
import { Stepper } from "@/components/Stepper";
import type { CardioDay } from "@/domain/cardio-day";
import type { SetRecord } from "@/domain/schema";
import { formatDayMonth } from "@/lib/format";

export function CardioBlock({
	day,
	todaySets,
	previous,
	onSave,
	onEditSet,
}: {
	day: CardioDay;
	todaySets: readonly SetRecord[];
	previous: { date: string; minutes: number } | null;
	onSave: (minutes: number) => void;
	onEditSet: (set: SetRecord) => void;
}) {
	const prescribed = day.minutes;
	const [minutes, setMinutes] = useState<number | null>(prescribed?.min ?? 30);
	const logged = todaySets.reduce((total, set) => total + (set.reps ?? 0), 0);

	return (
		<section className="card">
			<div className="flex items-baseline justify-between gap-3">
				<div className="min-w-0">
					<p className="eyebrow">Cardio{day.optional ? " · opcional" : ""}</p>
					<h2 className="mt-1 text-2xl leading-tight font-bold tracking-tight">
						{prescribed
							? prescribed.min === prescribed.max
								? `${prescribed.min} min`
								: `${prescribed.min}–${prescribed.max} min`
							: "Cardio libre"}
					</h2>
					{day.prescription ? (
						<p className="mt-1 text-[0.8125rem] text-muted">
							{day.prescription.modality} · {day.prescription.intensity}
						</p>
					) : null}
				</div>
				{logged > 0 ? (
					<p className="tabular shrink-0 text-sm font-semibold text-reserve">
						{logged} min
					</p>
				) : null}
			</div>

			{previous ? (
				<div className="mt-4 border-l-2 border-line pl-3">
					<p className="eyebrow">Antes · {formatDayMonth(previous.date)}</p>
					<p className="tabular mt-0.5 text-[0.8125rem] text-muted">
						{previous.minutes} min
					</p>
				</div>
			) : null}

			<div className="mt-5">
				<Stepper
					label="Duración"
					value={minutes}
					onChange={setMinutes}
					step={5}
					min={5}
					max={180}
					unit="min"
				/>
			</div>

			<button
				type="button"
				onClick={() => minutes !== null && onSave(minutes)}
				className="mt-5 h-14 w-full rounded-xl bg-reserve text-base font-semibold text-on-accent transition-opacity active:opacity-80"
			>
				Registrar {minutes} min
			</button>

			{todaySets.length > 0 ? (
				<ul className="mt-4 space-y-1">
					{todaySets.map((set) => (
						<li key={set.id}>
							<button
								type="button"
								onClick={() => onEditSet(set)}
								className="tabular flex w-full justify-between py-1 text-left text-[0.8125rem] text-muted active:opacity-60"
							>
								<span>{set.reps} min</span>
								<span className="text-faint">›</span>
							</button>
						</li>
					))}
				</ul>
			) : null}

			{day.prescription ? (
				<dl className="mt-5 space-y-2 border-t border-line pt-4 text-[0.8125rem]">
					<Guidance label="Progresión" value={day.prescription.progression} />
					<Guidance label="Evitar" value={day.prescription.avoid} />
					<Guidance label="Reducir si" value={day.prescription.reduceWhen} />
					{day.prescription.weeklyTotal ? (
						<Guidance
							label="Objetivo semanal"
							value={`${day.prescription.weeklyTotal.min}–${day.prescription.weeklyTotal.max} min`}
						/>
					) : null}
				</dl>
			) : null}
		</section>
	);
}

function Guidance({ label, value }: { label: string; value: string }) {
	if (!value) return null;
	return (
		<div className="flex gap-3">
			<dt className="eyebrow w-28 shrink-0">{label}</dt>
			<dd className="min-w-0 flex-1 text-muted">{value}</dd>
		</div>
	);
}
