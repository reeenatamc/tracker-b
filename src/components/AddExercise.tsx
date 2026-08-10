/**
 * Adding an exercise that is not in the program.
 *
 * For the machine being occupied, or a day you want something the plan does not
 * have. It joins today's session at the end and behaves like any other exercise:
 * it logs, it progresses, it shows up in history.
 */

import { useState } from "react";
import { PrimaryButton, Sheet } from "@/components/Sheet";
import { Stepper } from "@/components/Stepper";
import type { CustomExercise } from "@/domain/schema";

type Kind = "load" | "bodyweight" | "time";

const KINDS: Array<{ value: Kind; label: string; hint: string }> = [
	{ value: "load", label: "Con carga", hint: "Máquina o peso libre, en kg" },
	{
		value: "bodyweight",
		label: "Peso corporal",
		hint: "Progresas por reps o dificultad",
	},
	{ value: "time", label: "Por tiempo", hint: "Planchas, equilibrio, cardio" },
];

export function AddExercise({
	onSave,
	onClose,
}: {
	onSave: (exercise: CustomExercise) => void;
	onClose: () => void;
}) {
	const [name, setName] = useState("");
	const [kind, setKind] = useState<Kind>("load");
	const [sets, setSets] = useState(3);
	const [repMin, setRepMin] = useState(8);
	const [repMax, setRepMax] = useState(12);
	const [seconds, setSeconds] = useState(30);
	const [startKg, setStartKg] = useState<number | null>(null);
	const [incrementKg, setIncrementKg] = useState(2.5);
	const [isAnkle, setIsAnkle] = useState(false);

	function build(): CustomExercise {
		return {
			id: `custom-${crypto.randomUUID()}`,
			name: name.trim(),
			sets,
			isAnkle,
			progression:
				kind === "load"
					? "Doble progresión"
					: kind === "bodyweight"
						? "Más reps, luego más dificultad"
						: "Más tiempo o más control",
			goal: "",
			target:
				kind === "time"
					? { kind: "seconds", seconds }
					: { kind: "reps", min: repMin, max: repMax },
			load: {
				startKg: kind === "load" ? startKg : null,
				perSide: false,
				relativeToBase: false,
				bodyweight: kind !== "load",
				needsCalibration: kind === "load" && startKg === null,
				incrementKg: kind === "load" ? incrementKg : null,
				raw: "",
			},
		};
	}

	return (
		<Sheet title="Añadir ejercicio" onClose={onClose}>
			<label className="block">
				<span className="eyebrow mb-2 block">Nombre</span>
				<input
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder="Hip thrust, face pull…"
					className="h-12 w-full rounded-lg border border-line bg-ground px-3 text-[0.9375rem] text-ink placeholder:text-faint"
				/>
			</label>

			<fieldset className="mt-5 border-0 p-0">
				<legend className="eyebrow mb-2">Tipo</legend>
				<div className="flex gap-2">
					{KINDS.map((option) => (
						<label
							key={option.value}
							className={`flex-1 cursor-pointer rounded-lg border px-2 py-3 text-center text-[0.8125rem] ${
								kind === option.value
									? "border-reserve bg-reserve-soft text-reserve font-semibold"
									: "border-line bg-surface text-muted"
							}`}
						>
							<input
								type="radio"
								name="kind"
								checked={kind === option.value}
								onChange={() => setKind(option.value)}
								className="sr-only"
							/>
							{option.label}
						</label>
					))}
				</div>
				<p className="mt-2 text-[0.6875rem] text-faint">
					{KINDS.find((option) => option.value === kind)?.hint}
				</p>
			</fieldset>

			<div className="mt-5 grid grid-cols-2 gap-3">
				<Stepper
					label="Series"
					value={sets}
					onChange={setSets}
					step={1}
					min={1}
					max={8}
					unit="series"
				/>
				{kind === "time" ? (
					<Stepper
						label="Tiempo"
						value={seconds}
						onChange={setSeconds}
						step={5}
						max={600}
						unit="seg"
					/>
				) : (
					<>
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
					</>
				)}
			</div>

			{kind === "load" ? (
				<div className="mt-5 grid grid-cols-2 gap-3">
					<Stepper
						label="Carga inicial"
						value={startKg}
						onChange={setStartKg}
						step={2.5}
						max={300}
						unit="kg"
						placeholder="calibrar"
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

			<label className="mt-5 flex items-center gap-3 text-[0.8125rem] text-muted">
				<input
					type="checkbox"
					checked={isAnkle}
					onChange={(event) => setIsAnkle(event.target.checked)}
					className="size-5 accent-[var(--color-reserve)]"
				/>
				Carga el tobillo (pide dolor y respeta las señales de alarma)
			</label>

			<PrimaryButton
				disabled={name.trim() === ""}
				onClick={() => onSave(build())}
			>
				Añadir a la sesión de hoy
			</PrimaryButton>
		</Sheet>
	);
}
