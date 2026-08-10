/**
 * A scale you tap, with the target zone marked on it.
 *
 * Used for the two judgement calls in every session: reps in reserve, and ankle
 * pain. Both are bounded integer scales where the meaningful information is
 * *where you landed relative to the target*, so the target band is drawn on the
 * instrument rather than explained in text somewhere else.
 */

import { useId } from "react";

type Tone = "reserve" | "stop";

type TickScaleProps = {
	label: string;
	value: number | null;
	onChange: (value: number) => void;
	min: number;
	max: number;
	/** Inclusive band marking the programmed target, drawn behind the ticks. */
	target?: { min: number; max: number };
	/** Caption under the scale: what the ends mean. */
	legend?: [low: string, high: string];
	tone?: Tone;
};

export function TickScale({
	label,
	value,
	onChange,
	min,
	max,
	target,
	legend,
	tone = "reserve",
}: TickScaleProps) {
	// Each scale needs its own radio group name, and there are several per screen.
	const name = useId();
	const ticks = Array.from(
		{ length: max - min + 1 },
		(_, index) => min + index,
	);

	return (
		<div>
			<p className="eyebrow mb-2">{label}</p>
			{/*
			 * Real radio inputs, visually hidden behind their labels: it is one
			 * choice out of a fixed set, so arrow-key navigation and screen-reader
			 * announcements come for free instead of being reimplemented with ARIA.
			 */}
			<fieldset
				className={`grid gap-1.5 border-0 p-0 ${
					ticks.length > 7 ? "grid-cols-6" : "grid-flow-col"
				}`}
			>
				<legend className="sr-only">{label}</legend>
				{ticks.map((tick) => {
					const selected = value === tick;
					const inTarget = target
						? tick >= target.min && tick <= target.max
						: false;
					return (
						<label
							key={tick}
							className={[
								"tabular flex h-14 min-w-0 cursor-pointer items-center justify-center",
								"rounded-md border text-sm transition-colors",
								"focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-reserve",
								selected
									? SELECTED[tone]
									: inTarget
										? "border-line bg-raised text-ink"
										: "border-line/60 bg-surface text-faint",
							].join(" ")}
						>
							<input
								type="radio"
								name={name}
								value={tick}
								checked={selected}
								onChange={() => onChange(tick)}
								className="sr-only"
							/>
							{tick}
						</label>
					);
				})}
			</fieldset>

			{target ? (
				<p className="mt-2 text-[0.6875rem] text-faint">
					Objetivo de la fase:{" "}
					<span className="tabular text-muted">
						{target.min === target.max
							? target.min
							: `${target.min}–${target.max}`}
					</span>
				</p>
			) : null}

			{legend ? (
				<div className="mt-1 flex justify-between text-[0.6875rem] text-faint">
					<span>{legend[0]}</span>
					<span>{legend[1]}</span>
				</div>
			) : null}
		</div>
	);
}

const SELECTED: Record<Tone, string> = {
	reserve: "border-reserve bg-reserve-soft text-reserve font-semibold",
	stop: "border-stop bg-stop-soft text-stop font-semibold",
};
