/**
 * Complementary work at the end of a session — 30 min of bike, a walk, mobility.
 *
 * Separate from "add exercise" on purpose. That flow asks for a rep range, a
 * load and an increment, which is the wrong set of questions for something you
 * just did for twenty minutes. Here you pick the thing and the minutes, and it
 * is logged in one go.
 *
 * The ids are stable, so the same finisher accumulates history across sessions
 * instead of creating a new exercise every time.
 */

import { useState } from "react";
import { PrimaryButton, Sheet } from "@/components/Sheet";
import { Stepper } from "@/components/Stepper";
import type { CustomExercise } from "@/domain/schema";

type Preset = {
	id: string;
	name: string;
	defaultMinutes: number;
	isAnkle: boolean;
	progression: string;
};

/**
 * Straight from the program: bike, elliptical and steady walking are its
 * approved low-impact cardio, and Saturday is mobility plus ankle work.
 */
const PRESETS: Preset[] = [
	{
		id: "finisher-bicicleta",
		name: "Bicicleta",
		defaultMinutes: 30,
		isAnkle: false,
		progression: "Subir tiempo antes que intensidad",
	},
	{
		id: "finisher-eliptica",
		name: "Elíptica",
		defaultMinutes: 30,
		isAnkle: false,
		progression: "Subir tiempo antes que intensidad",
	},
	{
		id: "finisher-caminata",
		name: "Caminata",
		defaultMinutes: 30,
		isAnkle: false,
		progression: "Ritmo estable, sin impacto",
	},
	{
		id: "finisher-movilidad",
		name: "Movilidad",
		defaultMinutes: 10,
		isAnkle: true,
		progression: "Más rango sin forzar",
	},
];

export function QuickFinisher({
	onSave,
	onClose,
}: {
	/** Creates the exercise if needed, attaches it to today, and logs the set. */
	onSave: (exercise: CustomExercise, minutes: number) => void;
	onClose: () => void;
}) {
	const [preset, setPreset] = useState<Preset>(PRESETS[0]);
	const [minutes, setMinutes] = useState(PRESETS[0].defaultMinutes);

	function choose(next: Preset) {
		setPreset(next);
		setMinutes(next.defaultMinutes);
	}

	return (
		<Sheet title="Añadir complemento" onClose={onClose}>
			<fieldset className="border-0 p-0">
				<legend className="eyebrow mb-2">Qué hiciste</legend>
				<div className="grid grid-cols-2 gap-2">
					{PRESETS.map((option) => (
						<label
							key={option.id}
							className={`cursor-pointer rounded-lg border px-3 py-4 text-center text-[0.9375rem] ${
								preset.id === option.id
									? "border-reserve bg-reserve-soft font-semibold text-reserve"
									: "border-line bg-surface text-muted"
							}`}
						>
							<input
								type="radio"
								name="finisher"
								checked={preset.id === option.id}
								onChange={() => choose(option)}
								className="sr-only"
							/>
							{option.name}
						</label>
					))}
				</div>
			</fieldset>

			<div className="mt-6 flex gap-3">
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

			<p className="mt-3 text-[0.6875rem] text-faint">{preset.progression}</p>

			<PrimaryButton
				onClick={() =>
					onSave(
						{
							id: preset.id,
							name: preset.name,
							sets: 1,
							isAnkle: preset.isAnkle,
							progression: preset.progression,
							goal: "Complemento",
							target: { kind: "minutes", min: minutes, max: minutes },
							load: {
								startKg: null,
								perSide: false,
								relativeToBase: false,
								bodyweight: true,
								needsCalibration: false,
								incrementKg: null,
								raw: "",
							},
						},
						minutes,
					)
				}
			>
				Registrar {minutes} min
			</PrimaryButton>
		</Sheet>
	);
}
