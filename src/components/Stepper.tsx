/**
 * Numeric input by button, never by keyboard.
 *
 * A number pad on a phone at the gym means: a keyboard covers half the screen,
 * you mistype with one hand, and you have to dismiss it before you can save.
 * Two large buttons and a readout are faster and cannot be fat-fingered wrong.
 */

type StepperProps = {
	label: string;
	value: number | null;
	onChange: (value: number) => void;
	step: number;
	min?: number;
	max?: number;
	/** Shown under the readout: "kg", "kg/lado", "reps". */
	unit?: string;
	/** Readout when nothing is set yet. */
	placeholder?: string;
};

export function Stepper({
	label,
	value,
	onChange,
	step,
	min = 0,
	max = 999,
	unit,
	placeholder = "—",
}: StepperProps) {
	const current = value ?? 0;
	const clamp = (next: number) => Math.min(max, Math.max(min, round(next)));

	return (
		<div className="min-w-0 flex-1">
			<p className="eyebrow mb-2 text-center">{label}</p>
			<div className="flex items-stretch gap-1">
				<StepButton
					onPress={() => onChange(clamp(current - step))}
					disabled={value !== null && current <= min}
					label={`Bajar ${label}`}
				>
					−
				</StepButton>

				<div className="flex min-w-0 flex-1 flex-col items-center justify-center px-1">
					<span className="tabular truncate text-2xl leading-none font-semibold text-ink">
						{value === null ? placeholder : formatValue(value)}
					</span>
					{unit ? (
						<span className="mt-1 text-[0.6875rem] text-faint">{unit}</span>
					) : null}
				</div>

				<StepButton
					onPress={() => onChange(clamp(current + step))}
					disabled={value !== null && current >= max}
					label={`Subir ${label}`}
				>
					+
				</StepButton>
			</div>
		</div>
	);
}

function StepButton({
	children,
	onPress,
	disabled,
	label,
}: {
	children: string;
	onPress: () => void;
	disabled: boolean;
	label: string;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			onClick={onPress}
			disabled={disabled}
			className="h-14 w-11 shrink-0 rounded-xl border border-line bg-raised text-2xl text-ink transition-colors active:bg-line disabled:opacity-30"
		>
			{children}
		</button>
	);
}

function formatValue(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
