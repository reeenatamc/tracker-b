/**
 * Editing what the program says about one exercise.
 *
 * The most useful field here is the increment. The spreadsheet's "Carga inicial"
 * column is a starting load, never a step, so the app falls back to 2.5 kg —
 * which is wrong on any stack that moves in fives. Setting it once makes every
 * future "sube a X" correct.
 *
 * Changes are stored as overrides on top of the imported content, so
 * `npm run import:excel` never wipes them.
 */

import { useState } from "react";
import { PrimaryButton, Sheet } from "@/components/Sheet";
import { Stepper } from "@/components/Stepper";
import { DEFAULT_INCREMENT_KG } from "@/domain/progression";
import type {
	Exercise,
	ExerciseOverride,
	PhaseId,
	Range,
} from "@/domain/schema";
import { formatTarget } from "@/lib/format";

export type OverrideChanges = Pick<
	ExerciseOverride,
	"startKg" | "incrementKg" | "repMin" | "repMax" | "setsOverride"
>;

export function ExerciseSettings({
	exercise,
	phase,
	sets,
	onSave,
	onSkip,
	onReset,
	onClose,
}: {
	exercise: Exercise;
	phase: PhaseId;
	sets: Range | null;
	onSave: (changes: OverrideChanges) => void;
	onSkip: () => void;
	onReset: () => void;
	onClose: () => void;
}) {
	const repRange =
		exercise.target.kind === "reps" || exercise.target.kind === "repsPerSide"
			? exercise.target
			: null;

	const [startKg, setStartKg] = useState(exercise.load.startKg);
	const [incrementKg, setIncrementKg] = useState(
		exercise.load.incrementKg ?? DEFAULT_INCREMENT_KG,
	);
	const [repMin, setRepMin] = useState(repRange?.min ?? null);
	const [repMax, setRepMax] = useState(repRange?.max ?? null);
	const [setCount, setSetCount] = useState(sets?.max ?? null);

	const usesLoad =
		exercise.load.startKg !== null ||
		exercise.load.needsCalibration ||
		exercise.load.relativeToBase;

	return (
		<Sheet title={exercise.name} onClose={onClose}>
			<p className="text-[0.8125rem] text-muted">
				Fase {phase} · {sets ? `${sets.max}×` : ""}
				{formatTarget(exercise.target, phase)}
				{exercise.progression ? ` · ${exercise.progression}` : ""}
			</p>

			{usesLoad ? (
				<div className="mt-5 flex gap-3">
					<Stepper
						label="Carga inicial"
						value={startKg}
						onChange={setStartKg}
						step={2.5}
						unit={exercise.load.perSide ? "kg/lado" : "kg"}
					/>
					<Stepper
						label="Incremento"
						value={incrementKg}
						onChange={setIncrementKg}
						step={0.5}
						min={0.5}
						max={25}
						unit="kg"
					/>
				</div>
			) : null}

			{usesLoad ? (
				<p className="mt-2 text-[0.6875rem] text-faint">
					El incremento es el salto más pequeño que permite esa máquina. Es lo
					que la app suma cuando dominas el rango de reps.
				</p>
			) : null}

			{repRange ? (
				<div className="mt-5 flex gap-3">
					<Stepper
						label="Reps mín."
						value={repMin}
						onChange={setRepMin}
						step={1}
						unit="reps"
					/>
					<Stepper
						label="Reps máx."
						value={repMax}
						onChange={setRepMax}
						step={1}
						unit="reps"
					/>
				</div>
			) : null}

			<div className="mt-5 flex gap-3">
				<Stepper
					label="Series"
					value={setCount}
					onChange={setSetCount}
					step={1}
					min={1}
					max={8}
					unit="series"
				/>
				<div className="flex-1" />
			</div>

			<PrimaryButton
				onClick={() =>
					onSave({
						startKg: usesLoad ? startKg : null,
						incrementKg: usesLoad ? incrementKg : null,
						repMin: repRange ? repMin : null,
						repMax: repRange ? repMax : null,
						setsOverride: setCount,
					})
				}
			>
				Guardar
			</PrimaryButton>

			<div className="mt-3 flex gap-3">
				<button
					type="button"
					onClick={onReset}
					className="h-12 flex-1 rounded-lg border border-line text-sm text-muted"
				>
					Volver al plan
				</button>
				<button
					type="button"
					onClick={onSkip}
					className="h-12 flex-1 rounded-lg border border-line text-sm text-stop"
				>
					Saltar hoy
				</button>
			</div>
		</Sheet>
	);
}
