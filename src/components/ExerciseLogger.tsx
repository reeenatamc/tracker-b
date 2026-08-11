/**
 * Logging one exercise: the screen that decides whether any of this is worth it.
 *
 * Target for a whole set is under ten seconds — which is why the load and reps
 * arrive pre-filled from what the program says and what you did last time, and
 * why nothing here opens a keyboard.
 */

import { useState } from "react";
import { Stepper } from "@/components/Stepper";
import { TickScale } from "@/components/TickScale";
import type { PreviousPerformance } from "@/domain/history";
import {
	judgesRir,
	type ProgressionDecision,
	repRangeOf,
} from "@/domain/progression";
import type { Exercise, PhaseId, Range, SetRecord } from "@/domain/schema";
import {
	describeDecision,
	formatDayMonth,
	formatLoad,
	formatRirSummary,
	formatSet,
	formatTarget,
	targetUnit,
} from "@/lib/format";

export type NewSet = Omit<SetRecord, "id" | "sessionId">;

type ExerciseLoggerProps = {
	exercise: Exercise;
	phase: PhaseId;
	targetSets: Range | null;
	targetRir: Range;
	decision: ProgressionDecision;
	previous: PreviousPerformance | null;
	todaySets: readonly SetRecord[];
	onSave: (set: NewSet) => void;
	/** Opens the editor for a set already logged today. */
	onEditSet: (set: SetRecord) => void;
};

const TONE_TEXT = {
	reserve: "text-reserve",
	effort: "text-effort",
	stop: "text-stop",
	neutral: "text-ink",
} as const;

export function ExerciseLogger({
	exercise,
	phase,
	targetSets,
	targetRir,
	decision,
	previous,
	todaySets,
	onSave,
	onEditSet,
}: ExerciseLoggerProps) {
	const working = todaySets.filter((set) => !set.isWarmup);
	const copy = describeDecision(decision, exercise.progression);

	const [load, setLoad] = useState<number | null>(() =>
		suggestedLoad(decision, previous),
	);
	const [reps, setReps] = useState<number | null>(() =>
		suggestedReps(exercise, previous),
	);
	const [rir, setRir] = useState<number | null>(null);
	const [pain, setPain] = useState<number | null>(null);
	const [isWarmup, setIsWarmup] = useState(false);

	// Only exercises that actually carry an external load get a load stepper.
	// A bike warm-up and a balance hold have nothing to put on them.
	const usesLoad =
		exercise.load.startKg !== null ||
		exercise.load.needsCalibration ||
		exercise.load.relativeToBase;

	// RIR only means something on sets taken to a rep target. Cardio and timed
	// holds are steered by RPE and by control, which the written rule covers.
	const usesRir = repRangeOf(exercise) !== null && judgesRir(exercise);

	const nextSetNumber = todaySets.length + 1;

	function save() {
		onSave({
			exerciseId: exercise.id,
			setNumber: nextSetNumber,
			isWarmup,
			load: usesLoad ? load : null,
			unit: usesLoad ? "kg" : unitFor(exercise),
			reps,
			rir,
			anklePain: exercise.isAnkle ? pain : null,
			note: null,
		});
		// Load carries to the next set; the judgement calls reset so they are never
		// saved stale from the previous set.
		setRir(null);
		setPain(null);
		setIsWarmup(false);
	}

	return (
		<div className="pt-5">
			{/* What to do, and why — the column the spreadsheet made you fill in. */}
			<p className={`text-sm font-semibold ${TONE_TEXT[copy.tone]}`}>
				{copy.headline}
			</p>
			<p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
				{copy.detail}
			</p>

			{previous ? (
				<div className="mt-4 border-l-2 border-line pl-3">
					<p className="eyebrow">Antes · {formatDayMonth(previous.date)}</p>
					{/* Some imported rows carry only a note — no numbers to show. */}
					{previous.sets.some(
						(set) => set.reps !== null || set.load !== null,
					) ? (
						<p className="tabular mt-1 text-[0.8125rem] text-muted">
							{previous.sets.map(formatSet).join("  ·  ")}
							{formatRirSummary(previous.sets) ? (
								<span className="ml-2 text-faint">
									{formatRirSummary(previous.sets)}
								</span>
							) : null}
						</p>
					) : null}
					{previous.sets.find((set) => set.note) ? (
						<p className="mt-1 text-[0.8125rem] text-faint italic">
							«{previous.sets.find((set) => set.note)?.note}»
						</p>
					) : null}
				</div>
			) : null}

			<div className="mt-5 flex gap-3">
				{usesLoad ? (
					<Stepper
						label="Carga"
						value={load}
						onChange={setLoad}
						step={exercise.load.incrementKg ?? 2.5}
						unit={exercise.load.perSide ? "kg/lado" : "kg"}
					/>
				) : null}
				<Stepper
					label={targetUnit(exercise.target) === "reps" ? "Reps" : "Cantidad"}
					value={reps}
					onChange={setReps}
					step={1}
					unit={targetUnit(exercise.target)}
				/>
			</div>

			{usesRir ? (
				<div className="mt-5">
					<TickScale
						label="RIR · reps en reserva"
						value={rir}
						onChange={setRir}
						min={0}
						max={5}
						target={targetRir}
						legend={["0 · al fallo", "5 · muy fácil"]}
					/>
				</div>
			) : null}

			{exercise.isAnkle ? (
				<div className="mt-5">
					<TickScale
						label="Dolor de tobillo"
						value={pain}
						onChange={setPain}
						min={0}
						max={10}
						tone="stop"
						legend={["0 · sin dolor", "10 · máximo"]}
					/>
				</div>
			) : null}

			{usesLoad ? (
				<label className="mt-5 flex items-center gap-3 text-[0.8125rem] text-muted">
					<input
						type="checkbox"
						checked={isWarmup}
						onChange={(event) => setIsWarmup(event.target.checked)}
						className="size-5 accent-[var(--color-reserve)]"
					/>
					Serie de aproximación (no cuenta para la progresión)
				</label>
			) : null}

			<button
				type="button"
				onClick={save}
				className="mt-5 h-14 w-full rounded-lg bg-reserve text-base font-semibold text-on-accent transition-opacity active:opacity-80"
			>
				Guardar serie {nextSetNumber}
				{targetSets ? ` de ${targetSets.max}` : ""}
			</button>

			{todaySets.length > 0 ? (
				<div className="mt-5">
					<p className="eyebrow mb-2">Hoy</p>
					<ul className="space-y-1">
						{/* Tap a logged set to fix it. A wrong load is not just a wrong
						    row — progression reads the last session and would carry the
						    mistake into the next suggestion. */}
						{todaySets.map((set) => (
							<li key={set.id}>
								<button
									type="button"
									onClick={() => onEditSet(set)}
									className="tabular flex w-full justify-between py-1 text-left text-[0.8125rem] active:opacity-60"
								>
									<span className="text-muted">
										<span className="text-faint">{set.setNumber}</span>{" "}
										{formatSet(set)}
										{set.isWarmup ? (
											<span className="ml-2 text-faint">aprox.</span>
										) : null}
									</span>
									<span className="text-faint">
										{set.rir !== null ? `RIR ${set.rir}` : ""}
										{set.anklePain !== null && set.anklePain > 0 ? (
											<span className="ml-2 text-stop">
												dolor {set.anklePain}
											</span>
										) : null}
										<span className="ml-2 text-faint">›</span>
									</span>
								</button>
							</li>
						))}
					</ul>
					<p className="mt-2 text-[0.6875rem] text-faint">
						{working.length} de {targetSets ? targetSets.max : "—"} series de
						trabajo · {formatTarget(exercise.target, phase)}
						{exercise.load.startKg !== null
							? ` · inicio ${formatLoad(exercise.load.startKg, exercise.load.perSide)}`
							: ""}
					</p>
				</div>
			) : null}
		</div>
	);
}

/** Pre-fills the load with whatever the progression rule just decided. */
function suggestedLoad(
	decision: ProgressionDecision,
	previous: PreviousPerformance | null,
): number | null {
	switch (decision.kind) {
		case "increase":
			return decision.toKg;
		case "hold":
			return decision.loadKg;
		case "start":
			return decision.loadKg;
		default:
			return previous?.sets.find((set) => set.load !== null)?.load ?? null;
	}
}

/** Pre-fills reps at the top of the range: the number you are aiming for. */
function suggestedReps(
	exercise: Exercise,
	previous: PreviousPerformance | null,
): number | null {
	const { target } = exercise;
	if (target.kind === "reps" || target.kind === "repsPerSide")
		return target.max;
	if (target.kind === "seconds" || target.kind === "secondsPerSide")
		return target.seconds;
	if (target.kind === "minutes") return target.max;
	return previous?.sets[0]?.reps ?? null;
}

function unitFor(exercise: Exercise) {
	switch (exercise.target.kind) {
		case "seconds":
		case "secondsPerSide":
			return "seconds" as const;
		case "minutes":
		case "minutesByPhase":
			return "minutes" as const;
		default:
			return "bodyweight" as const;
	}
}
