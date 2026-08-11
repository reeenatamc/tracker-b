/**
 * Changing what the plan says about one exercise.
 *
 * Since E3 this does not edit anything. It appends a decision: a `PlanAdjustment`
 * with a date and a reason, which folds over the baseline from that date onwards
 * and leaves every session that already started exactly as it was.
 *
 * Hence the reason field, and hence it being required. An adjustment with no
 * reason is a number with no owner, and in four weeks "¿por qué 4 series aquí?"
 * is a question the app has to be able to answer.
 */

import { useState } from "react";
import { PrimaryButton, Sheet } from "@/components/Sheet";
import { Stepper } from "@/components/Stepper";
import { DEFAULT_INCREMENT_KG } from "@/domain/progression";
import type {
	Exercise,
	FieldChange,
	Phase,
	PrescriptionEntry,
	Range,
} from "@/domain/schema";
import { formatTarget } from "@/lib/format";

/** One field, one reason. The reason travels with it and is never optional. */
export type PlanChange = { change: FieldChange; reason: string };

export function ExerciseSettings({
	exercise,
	entry,
	phase,
	sets,
	onSave,
	onSkip,
	onClose,
}: {
	exercise: Exercise;
	/** The slot this occupies. Null while a session has no prescription for it. */
	entry: PrescriptionEntry | undefined;
	phase: Phase;
	sets: Range | null;
	onSave: (changes: PlanChange[]) => void;
	onSkip: () => void;
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
	const [reason, setReason] = useState("");

	const usesLoad =
		exercise.load.startKg !== null ||
		exercise.load.needsCalibration ||
		exercise.load.relativeToBase;

	/** Only what you actually moved becomes an adjustment. */
	function changes(): PlanChange[] {
		const written: FieldChange[] = [];

		if (
			usesLoad &&
			(startKg !== exercise.load.startKg ||
				incrementKg !== (exercise.load.incrementKg ?? DEFAULT_INCREMENT_KG))
		) {
			written.push({
				field: "load",
				value: {
					...exercise.load,
					startKg,
					incrementKg,
					// An explicit starting load means it no longer needs finding.
					needsCalibration:
						startKg != null ? false : exercise.load.needsCalibration,
				},
			});
		}

		if (
			repRange &&
			(repMin !== repRange.min || repMax !== repRange.max) &&
			repMin != null &&
			repMax != null
		) {
			written.push({
				field: "target",
				value: { ...repRange, min: repMin, max: repMax },
			});
		}

		if (setCount != null && setCount !== sets?.max) {
			written.push({ field: "sets", value: setCount });
		}

		return written.map((change) => ({ change, reason: reason.trim() }));
	}

	const pending = changes();
	const canSave =
		entry !== undefined && pending.length > 0 && reason.trim().length > 0;

	return (
		<Sheet title={exercise.name} onClose={onClose}>
			<p className="text-[0.8125rem] text-muted">
				{phase.name} · {sets ? `${sets.max}×` : ""}
				{formatTarget(exercise.target, phase.order)}
				{exercise.progression ? ` · ${exercise.progression}` : ""}
			</p>

			{usesLoad ? (
				<div className="mt-5 grid grid-cols-2 gap-3">
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
				<div className="mt-5 grid grid-cols-2 gap-3">
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

			<div className="mt-5 grid grid-cols-2 gap-3">
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

			<label className="mt-5 block">
				<span className="eyebrow">Por qué</span>
				<input
					type="text"
					value={reason}
					onChange={(event) => setReason(event.target.value)}
					placeholder="El tobillo aguanta bien, subo una serie"
					className="mt-1 h-12 w-full rounded-lg border border-line bg-transparent px-3 text-sm"
				/>
			</label>

			<p className="mt-2 text-[0.6875rem] text-faint">
				{entry === undefined
					? "Este ejercicio no viene del plan, así que no se puede ajustar desde aquí."
					: pending.length === 0
						? "Cambia algo arriba y escribe el motivo."
						: `Queda apuntado desde hoy. Las sesiones ya empezadas no cambian.`}
			</p>

			<PrimaryButton onClick={() => onSave(pending)} disabled={!canSave}>
				Guardar en el plan
			</PrimaryButton>

			<div className="mt-3">
				<button
					type="button"
					onClick={onSkip}
					className="h-12 w-full rounded-lg border border-line text-sm text-stop"
				>
					Saltar hoy
				</button>
			</div>
			<p className="mt-2 text-[0.6875rem] text-faint">
				Saltarlo hoy no cambia el plan: queda apuntado en la sesión.
			</p>
		</Sheet>
	);
}
