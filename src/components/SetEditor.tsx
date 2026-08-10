/**
 * Fixing a set you already logged.
 *
 * Worth having because a wrong set is not just a wrong row: progression reads
 * the last session, so one mistyped load quietly steers the next suggestion.
 */

import { useState } from "react";
import { NoteField, PrimaryButton, Sheet } from "@/components/Sheet";
import { Stepper } from "@/components/Stepper";
import { TickScale } from "@/components/TickScale";
import type { Exercise, Range, SetRecord } from "@/domain/schema";

export function SetEditor({
	set,
	exercise,
	targetRir,
	onSave,
	onDelete,
	onClose,
}: {
	set: SetRecord;
	exercise: Exercise;
	targetRir: Range;
	onSave: (changes: Partial<SetRecord>) => void;
	onDelete: () => void;
	onClose: () => void;
}) {
	const [load, setLoad] = useState(set.load);
	const [reps, setReps] = useState(set.reps);
	const [rir, setRir] = useState(set.rir);
	const [pain, setPain] = useState(set.anklePain);
	const [isWarmup, setIsWarmup] = useState(set.isWarmup);
	const [note, setNote] = useState(set.note ?? "");

	const usesLoad = set.unit === "kg";

	return (
		<Sheet
			title={`${exercise.name} · serie ${set.setNumber}`}
			onClose={onClose}
			onDelete={onDelete}
		>
			<div className="grid grid-cols-2 gap-3">
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
					label="Reps"
					value={reps}
					onChange={setReps}
					step={1}
					unit="reps"
				/>
			</div>

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

			<label className="mt-5 flex items-center gap-3 text-[0.8125rem] text-muted">
				<input
					type="checkbox"
					checked={isWarmup}
					onChange={(event) => setIsWarmup(event.target.checked)}
					className="size-5 accent-[var(--color-reserve)]"
				/>
				Serie de aproximación (no cuenta para la progresión)
			</label>

			<div className="mt-5">
				<NoteField
					label="Nota"
					value={note}
					onChange={setNote}
					placeholder="Qué se sintió, qué ajustaste…"
				/>
			</div>

			<PrimaryButton
				onClick={() =>
					onSave({
						load,
						reps,
						rir,
						anklePain: exercise.isAnkle ? pain : null,
						isWarmup,
						note: note.trim() || null,
					})
				}
			>
				Guardar cambios
			</PrimaryButton>
		</Sheet>
	);
}
