/**
 * A trend line for one measure over time.
 *
 * Single series, so no legend: the title names it. The y-axis is padded around
 * the data rather than anchored at zero — a 60 kg bodyweight plotted from zero
 * would show a flat line and hide the only thing you want to see, the change.
 * The first and last values are labelled directly; nothing else is, because a
 * number on every point is noise.
 */

import { formatDayMonth } from "@/lib/format";

type Point = { date: string; value: number };

type TrendProps = {
	title: string;
	points: readonly Point[];
	unit: string;
	/** Lower is better (waist, weight when cutting) flips the delta colour. */
	lowerIsBetter?: boolean;
	/** Fixed 0–100 axis, for scores. */
	fixedScale?: [number, number];
};

const WIDTH = 320;
const HEIGHT = 84;
const PAD = { top: 12, right: 8, bottom: 4, left: 8 };

export function Trend({
	title,
	points,
	unit,
	lowerIsBetter,
	fixedScale,
}: TrendProps) {
	if (points.length === 0) {
		return (
			<figure className="m-0">
				<figcaption className="eyebrow mb-2">{title}</figcaption>
				<p className="text-[0.8125rem] text-faint">Sin datos todavía.</p>
			</figure>
		);
	}

	const values = points.map((point) => point.value);
	const first = values[0];
	const last = values[values.length - 1];
	const delta = round(last - first);

	const [min, max] = fixedScale ?? paddedDomain(values);
	const innerWidth = WIDTH - PAD.left - PAD.right;
	const innerHeight = HEIGHT - PAD.top - PAD.bottom;

	const x = (index: number) =>
		PAD.left +
		(points.length === 1
			? innerWidth / 2
			: (index / (points.length - 1)) * innerWidth);
	const y = (value: number) =>
		PAD.top + innerHeight - ((value - min) / (max - min || 1)) * innerHeight;

	const path = points
		.map(
			(point, index) =>
				`${index === 0 ? "M" : "L"}${x(index)},${y(point.value)}`,
		)
		.join(" ");

	const improving = delta === 0 ? null : lowerIsBetter ? delta < 0 : delta > 0;
	const deltaTone =
		improving === null
			? "text-faint"
			: improving
				? "text-reserve"
				: "text-effort";

	return (
		<figure className="m-0">
			<div className="mb-2 flex items-baseline justify-between">
				<figcaption className="eyebrow">{title}</figcaption>
				<p className="tabular text-[0.8125rem]">
					<span className="font-semibold text-ink">
						{format(last)} {unit}
					</span>
					{points.length > 1 ? (
						<span className={`ml-2 ${deltaTone}`}>
							{delta > 0 ? "+" : ""}
							{format(delta)}
						</span>
					) : null}
				</p>
			</div>

			<svg
				viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
				className="h-20 w-full"
				role="img"
				aria-label={`${title}: de ${format(first)} a ${format(last)} ${unit}`}
			>
				<title>{`${title}: de ${format(first)} a ${format(last)} ${unit}`}</title>
				{points.length > 1 ? (
					<path
						d={path}
						fill="none"
						stroke="var(--color-reserve)"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				) : null}
				{points.map((point, index) => {
					const isEnd = index === 0 || index === points.length - 1;
					return (
						<circle
							key={point.date}
							cx={x(index)}
							cy={y(point.value)}
							r={isEnd ? 4 : 2.5}
							fill="var(--color-reserve)"
							// A 2px surface ring keeps overlapping points readable.
							stroke="var(--color-surface)"
							strokeWidth="2"
						/>
					);
				})}
			</svg>

			<div className="flex justify-between text-[0.6875rem] text-faint">
				<span className="tabular">{formatDayMonth(points[0].date)}</span>
				{points.length > 1 ? (
					<span className="tabular">
						{formatDayMonth(points[points.length - 1].date)}
					</span>
				) : null}
			</div>
		</figure>
	);
}

/** Domain padded by 10% of the range, so the line never touches the edges. */
function paddedDomain(values: readonly number[]): [number, number] {
	const min = Math.min(...values);
	const max = Math.max(...values);
	if (min === max) return [min - 1, max + 1];
	const pad = (max - min) * 0.1;
	return [min - pad, max + pad];
}

function format(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function round(value: number): number {
	return Math.round(value * 10) / 10;
}
