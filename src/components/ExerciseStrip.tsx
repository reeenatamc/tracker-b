/**
 * The session at a glance, and how you move through it.
 *
 * It replaces the scrolling list of ten exercises. One block per exercise shows
 * what is done and where you are; tapping one jumps there. That is the whole
 * navigation, and it stays pinned above the exercise you are working on, so you
 * never lose the shape of the session while looking at one part of it.
 */

import type { Exercise } from "@/domain/schema";

export function ExerciseStrip({
	exercises,
	done,
	currentId,
	onSelect,
}: {
	exercises: readonly Exercise[];
	done: ReadonlySet<string>;
	currentId: string | null;
	onSelect: (exerciseId: string) => void;
}) {
	return (
		<div className="px-4 pb-4">
			<div className="flex gap-1">
				{exercises.map((exercise, index) => {
					const isDone = done.has(exercise.id);
					const isCurrent = exercise.id === currentId;
					return (
						<button
							key={exercise.id}
							type="button"
							onClick={() => onSelect(exercise.id)}
							aria-label={`Ir a ${exercise.name}`}
							aria-current={isCurrent ? "step" : undefined}
							// A tall invisible hit area over a short visible bar: the bar
							// should stay thin, the target should not.
							className="group relative h-8 flex-1"
						>
							<span
								className={`absolute inset-x-0 top-3 h-2 rounded-full transition-colors ${
									isCurrent
										? "bg-reserve ring-2 ring-reserve/40"
										: isDone
											? "bg-reserve"
											: "bg-line"
								}`}
							/>
							<span className="sr-only">
								{index + 1}. {exercise.name}
								{isDone ? " (hecho)" : ""}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

/** Previous / next, at the bottom where the thumb already is. */
export function ExerciseNav({
	position,
	total,
	onPrevious,
	onNext,
	nextLabel,
}: {
	position: number;
	total: number;
	onPrevious: () => void;
	onNext: () => void;
	nextLabel: string | null;
}) {
	return (
		<div className="flex items-center gap-3 border-t border-line px-4 py-4">
			<button
				type="button"
				onClick={onPrevious}
				disabled={position === 0}
				aria-label="Ejercicio anterior"
				className="h-12 w-12 shrink-0 rounded-lg border border-line text-lg text-muted disabled:opacity-30"
			>
				←
			</button>

			<span className="eyebrow flex-1 text-center">
				{position + 1} de {total}
			</span>

			<button
				type="button"
				onClick={onNext}
				disabled={position >= total - 1}
				className="flex h-12 min-w-0 flex-1 items-center justify-end gap-2 rounded-lg border border-line px-3 text-sm text-muted disabled:opacity-30"
			>
				<span className="min-w-0 truncate">{nextLabel ?? "Fin"}</span>
				<span className="shrink-0 text-lg">→</span>
			</button>
		</div>
	);
}
