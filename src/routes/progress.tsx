/**
 * Weekly progress — the spreadsheet's Progreso sheet.
 *
 * Measurements are entered on the Saturday review, which is the program's own
 * rule: "cada sábado revisar datos y ajustar, no improvisar volumen". The
 * consistency score uses the spreadsheet's formula unchanged, so the numbers
 * stay comparable with what you already recorded.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";
import { PrimaryButton, NoteField, Sheet } from "@/components/Sheet";
import { Stepper } from "@/components/Stepper";
import { PageHeader, TabBar } from "@/components/TabBar";
import { TickScale } from "@/components/TickScale";
import { Trend } from "@/components/Trend";
import { useCollections } from "@/db/provider";
import {
	consistencyScore,
	deltaFromBaseline,
	scoreSeries,
	series,
	WEEKLY_TARGETS,
} from "@/domain/progress";
import type { ProgressCheck } from "@/domain/schema";
import { program } from "@/lib/content";
import { formatDate, formatDayMonth, todayIso } from "@/lib/format";

export const Route = createFileRoute("/progress")({ component: Progress });

function Progress() {
	const collections = useCollections();
	const { data: checks = [] } = useLiveQuery((q) =>
		q.from({ p: collections.progressChecks }),
	);
	const [editing, setEditing] = useState<ProgressCheck | "new" | null>(null);

	const ordered = [...checks].sort((a, b) => b.date.localeCompare(a.date));
	const latest = ordered[0] ?? null;
	const latestScore = latest ? consistencyScore(latest) : null;

	return (
		<main className="mx-auto min-h-dvh w-full max-w-lg pb-24">
			<PageHeader
				eyebrow="Revisión semanal"
				title="Progreso"
				subtitle={
					latest
						? `Último registro: ${formatDate(latest.date)}`
						: "Los sábados: registra la semana y ajusta."
				}
			/>

			{latestScore !== null ? (
				<section className="border-t border-line px-4 py-6">
					<p className="eyebrow mb-2">Consistencia de la semana</p>
					<p className="tabular text-4xl font-semibold text-ink">
						{latestScore}
						<span className="ml-1 text-lg text-faint">/100</span>
					</p>
					<div className="mt-3 h-2 overflow-hidden rounded-full bg-line">
						<div
							className="h-full rounded-full bg-reserve transition-[width]"
							style={{ width: `${latestScore}%` }}
						/>
					</div>
					<p className="mt-3 text-[0.8125rem] text-muted">
						Fuerza pesa 40; cardio, rehabilitación y nutrición 20 cada uno. Cada
						parte tiene tope, así que una semana enorme de cardio no tapa tres
						sesiones de fuerza perdidas.
					</p>
				</section>
			) : null}

			<section className="border-t border-line px-4 py-6">
				<button
					type="button"
					onClick={() => setEditing("new")}
					className="h-14 w-full rounded-lg bg-reserve text-base font-semibold text-on-accent"
				>
					Registrar esta semana
				</button>
			</section>

			{checks.length > 0 ? (
				<section className="space-y-7 border-t border-line px-4 py-6">
					<Trend
						title="Peso"
						points={series(checks, "weightKg")}
						unit="kg"
						lowerIsBetter
					/>
					<Trend
						title="Cintura"
						points={series(checks, "waistCm")}
						unit="cm"
						lowerIsBetter
					/>
					<Trend
						title="Cadera"
						points={series(checks, "hipCm")}
						unit="cm"
						lowerIsBetter
					/>
					<Trend
						title="Consistencia"
						points={scoreSeries(checks)}
						unit="/100"
						fixedScale={[0, 100]}
					/>
				</section>
			) : null}

			{checks.length >= 2 ? (
				<section className="border-t border-line px-4 py-6">
					<p className="eyebrow mb-3">Desde el inicio</p>
					<dl className="grid grid-cols-2 gap-4">
						<Delta
							label="Peso"
							value={deltaFromBaseline(checks, "weightKg")}
							unit="kg"
						/>
						<Delta
							label="Cintura"
							value={deltaFromBaseline(checks, "waistCm")}
							unit="cm"
						/>
						<Delta
							label="Cadera"
							value={deltaFromBaseline(checks, "hipCm")}
							unit="cm"
						/>
						<Delta
							label="Muslo"
							value={deltaFromBaseline(checks, "thighCm")}
							unit="cm"
						/>
					</dl>
					{program.meta.startWeightKg !== null ? (
						<p className="mt-4 text-[0.8125rem] text-faint">
							Peso al empezar:{" "}
							<span className="tabular">{program.meta.startWeightKg} kg</span>.
							El objetivo del plan es recomposición, no perder peso: la cintura
							dice más que la báscula.
						</p>
					) : null}
				</section>
			) : null}

			{ordered.length > 0 ? (
				<section className="border-t border-line px-4 py-6">
					<p className="eyebrow mb-3">Semanas registradas</p>
					<ul className="space-y-1">
						{ordered.map((check) => (
							<li key={check.id}>
								<button
									type="button"
									onClick={() => setEditing(check)}
									className="flex w-full items-baseline justify-between py-2 text-left"
								>
									<span className="tabular text-[0.8125rem] text-muted">
										{formatDayMonth(check.date)}
									</span>
									<span className="tabular text-[0.8125rem] text-faint">
										{check.weightKg !== null ? `${check.weightKg} kg` : "—"}
										{check.waistCm !== null ? ` · ${check.waistCm} cm` : ""}
										{consistencyScore(check) !== null
											? ` · ${consistencyScore(check)}/100`
											: ""}
									</span>
								</button>
							</li>
						))}
					</ul>
				</section>
			) : null}

			{editing ? (
				<CheckEditor
					check={editing === "new" ? null : editing}
					onSave={(check) => {
						if (editing === "new") collections.progressChecks.insert(check);
						else
							collections.progressChecks.update(check.id, (draft) =>
								Object.assign(draft, check),
							);
						setEditing(null);
					}}
					onDelete={
						editing === "new"
							? undefined
							: () => {
									collections.progressChecks.delete(editing.id);
									setEditing(null);
								}
					}
					onClose={() => setEditing(null)}
				/>
			) : null}

			<TabBar />
		</main>
	);
}

function Delta({
	label,
	value,
	unit,
}: {
	label: string;
	value: number | null;
	unit: string;
}) {
	const tone =
		value === null
			? "text-faint"
			: value < 0
				? "text-reserve"
				: value > 0
					? "text-effort"
					: "text-ink";
	return (
		<div>
			<dt className="eyebrow">{label}</dt>
			<dd className={`tabular mt-1 text-lg font-semibold ${tone}`}>
				{value === null ? "—" : `${value > 0 ? "+" : ""}${value} ${unit}`}
			</dd>
		</div>
	);
}

function CheckEditor({
	check,
	onSave,
	onDelete,
	onClose,
}: {
	check: ProgressCheck | null;
	onSave: (check: ProgressCheck) => void;
	onDelete?: () => void;
	onClose: () => void;
}) {
	const [date, setDate] = useState(check?.date ?? todayIso());
	const [weightKg, setWeight] = useState(check?.weightKg ?? null);
	const [waistCm, setWaist] = useState(check?.waistCm ?? null);
	const [hipCm, setHip] = useState(check?.hipCm ?? null);
	const [thighCm, setThigh] = useState(check?.thighCm ?? null);
	const [strengthSessions, setStrength] = useState(
		check?.strengthSessions ?? null,
	);
	const [cardioMinutes, setCardio] = useState(check?.cardioMinutes ?? null);
	const [rehabSessions, setRehab] = useState(check?.rehabSessions ?? null);
	const [sleepHours, setSleep] = useState(check?.sleepHours ?? null);
	const [energy, setEnergy] = useState(check?.energy ?? null);
	const [adherence, setAdherence] = useState(
		check?.nutritionAdherence != null
			? Math.round(check.nutritionAdherence * 10)
			: null,
	);
	const [notes, setNotes] = useState(check?.notes ?? "");

	const draft: ProgressCheck = {
		id: check?.id ?? crypto.randomUUID(),
		date,
		weightKg,
		waistCm,
		hipCm,
		thighCm,
		strengthSessions,
		cardioMinutes,
		rehabSessions,
		sleepHours,
		energy,
		nutritionAdherence: adherence === null ? null : adherence / 10,
		notes: notes.trim() || null,
	};
	const score = consistencyScore(draft);

	return (
		<Sheet
			title={check ? "Editar semana" : "Registrar semana"}
			onClose={onClose}
			onDelete={onDelete}
		>
			<label className="block">
				<span className="eyebrow mb-2 block">Semana del</span>
				<input
					type="date"
					value={date}
					onChange={(event) => setDate(event.target.value)}
					className="h-12 w-full rounded-lg border border-line bg-ground px-3 text-[0.9375rem] text-ink"
				/>
			</label>

			<p className="eyebrow mt-6 mb-2">Medidas</p>
			<div className="flex gap-3">
				<Stepper
					label="Peso"
					value={weightKg}
					onChange={setWeight}
					step={0.1}
					max={200}
					unit="kg"
				/>
				<Stepper
					label="Cintura"
					value={waistCm}
					onChange={setWaist}
					step={0.5}
					max={200}
					unit="cm"
				/>
			</div>
			<div className="mt-3 flex gap-3">
				<Stepper
					label="Cadera"
					value={hipCm}
					onChange={setHip}
					step={0.5}
					max={200}
					unit="cm"
				/>
				<Stepper
					label="Muslo"
					value={thighCm}
					onChange={setThigh}
					step={0.5}
					max={120}
					unit="cm"
				/>
			</div>

			<p className="eyebrow mt-6 mb-2">La semana</p>
			<div className="flex gap-3">
				<Stepper
					label="Fuerza"
					value={strengthSessions}
					onChange={setStrength}
					step={1}
					max={14}
					unit={`de ${WEEKLY_TARGETS.strengthSessions}`}
				/>
				<Stepper
					label="Cardio"
					value={cardioMinutes}
					onChange={setCardio}
					step={5}
					max={600}
					unit="min"
				/>
				<Stepper
					label="Rehab"
					value={rehabSessions}
					onChange={setRehab}
					step={1}
					max={14}
					unit={`de ${WEEKLY_TARGETS.rehabSessions}`}
				/>
			</div>

			<div className="mt-3 flex gap-3">
				<Stepper
					label="Sueño"
					value={sleepHours}
					onChange={setSleep}
					step={0.5}
					max={14}
					unit="h prom."
				/>
				<div className="flex-1" />
			</div>

			<div className="mt-6">
				<TickScale
					label="Energía"
					value={energy}
					onChange={setEnergy}
					min={1}
					max={10}
					legend={["1 · agotada", "10 · con todo"]}
				/>
			</div>

			<div className="mt-6">
				<TickScale
					label="Adherencia nutricional"
					value={adherence}
					onChange={setAdherence}
					min={0}
					max={10}
					target={{ min: 8, max: 10 }}
					legend={["0 · nada", "10 · toda la semana"]}
				/>
			</div>

			<div className="mt-6">
				<NoteField
					label="Notas"
					value={notes}
					onChange={setNotes}
					placeholder="Qué ajustar"
				/>
			</div>

			{score !== null ? (
				<p className="mt-5 text-[0.8125rem] text-muted">
					Consistencia de esta semana:{" "}
					<span className="tabular font-semibold text-ink">{score}/100</span>
				</p>
			) : null}

			<PrimaryButton onClick={() => onSave(draft)}>Guardar</PrimaryButton>
		</Sheet>
	);
}
