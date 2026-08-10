/**
 * Weekly ankle check.
 *
 * The measurements that matter are comparative — injured against healthy — so
 * they are entered and shown side by side rather than as a list of numbers you
 * would have to hold in your head.
 */

import { createFileRoute } from "@tanstack/react-router";
import { TabBar } from "@/components/TabBar";
import { useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";
import { Stepper } from "@/components/Stepper";
import { TickScale } from "@/components/TickScale";
import { useCollections } from "@/db/provider";
import { evaluateSafety } from "@/domain/safety";
import { ankleProtocol } from "@/lib/content";
import { formatDayMonth, SAFETY_LABELS, todayIso } from "@/lib/format";

export const Route = createFileRoute("/ankle")({ component: Ankle });

function Ankle() {
	const collections = useCollections();
	const today = todayIso();
	const { data: checks = [] } = useLiveQuery((q) =>
		q.from({ a: collections.ankleChecks }),
	);

	const history = [...checks].sort((a, b) => b.date.localeCompare(a.date));
	const latest = history[0] ?? null;

	const [pain, setPain] = useState(0);
	const [kneeToWallInjured, setKneeInjured] = useState<number | null>(null);
	const [kneeToWallHealthy, setKneeHealthy] = useState<number | null>(null);
	const [calfRaisesInjured, setCalfRaises] = useState<number | null>(null);
	const [bestBalance, setBestBalance] = useState<number | null>(null);
	const [avgBalance, setAvgBalance] = useState<number | null>(null);
	const [givesWay, setGivesWay] = useState(false);
	const [swelling, setSwelling] = useState(false);
	const [saved, setSaved] = useState(false);

	const verdict = evaluateSafety({ pain, swelling, givesWay });

	function save() {
		collections.ankleChecks.insert({
			id: crypto.randomUUID(),
			date: today,
			pain,
			kneeToWallInjured,
			kneeToWallHealthy,
			calfRaisesInjured,
			bestBalance,
			avgBalance,
			givesWay,
			swelling,
			notes: null,
		});
		setSaved(true);
	}

	const gap =
		kneeToWallInjured !== null && kneeToWallHealthy !== null
			? kneeToWallHealthy - kneeToWallInjured
			: null;

	return (
		<main className="mx-auto min-h-dvh w-full max-w-lg pb-[calc(8.5rem+env(safe-area-inset-bottom))]">
			<header className="px-4 pt-8 pb-6">
				<p className="eyebrow">Chequeo semanal</p>
				<h1 className="tabular mt-3 text-2xl font-semibold tracking-tight uppercase">
					Tobillo
				</h1>
				{latest ? (
					<p className="mt-1 text-sm text-muted">
						Último registro: {formatDayMonth(latest.date)} · dolor{" "}
						<span className="tabular">{latest.pain}</span>
					</p>
				) : (
					<p className="mt-1 text-sm text-muted">Aún no hay registros.</p>
				)}
			</header>

			<section className="border-t border-line px-4 py-6">
				<TickScale
					label="Dolor esta semana"
					value={pain}
					onChange={setPain}
					min={0}
					max={10}
					target={{ min: 0, max: 2 }}
					tone="stop"
					legend={["0 · sin dolor", "10 · máximo"]}
				/>
			</section>

			<section className="border-t border-line px-4 py-6">
				<p className="eyebrow mb-3">Knee-to-wall · centímetros</p>
				<div className="flex gap-3">
					<Stepper
						label="Lesionado"
						value={kneeToWallInjured}
						onChange={setKneeInjured}
						step={0.5}
						max={20}
						unit="cm"
					/>
					<Stepper
						label="Sano"
						value={kneeToWallHealthy}
						onChange={setKneeHealthy}
						step={0.5}
						max={20}
						unit="cm"
					/>
				</div>
				{gap !== null ? (
					<p className="mt-3 text-[0.8125rem] text-muted">
						Diferencia:{" "}
						<span
							className={`tabular ${gap > 0 ? "text-effort" : "text-reserve"}`}
						>
							{gap > 0 ? `${gap} cm menos` : "sin déficit"}
						</span>{" "}
						en el lado lesionado. Reducirla es la meta.
					</p>
				) : null}
			</section>

			<section className="border-t border-line px-4 py-6">
				<p className="eyebrow mb-3">Fuerza y balance · lado lesionado</p>
				<div className="flex gap-3">
					<Stepper
						label="Calf raises"
						value={calfRaisesInjured}
						onChange={setCalfRaises}
						step={1}
						max={50}
						unit="reps"
					/>
					<Stepper
						label="Mejor balance"
						value={bestBalance}
						onChange={setBestBalance}
						step={5}
						max={180}
						unit="seg"
					/>
					<Stepper
						label="Promedio de 3"
						value={avgBalance}
						onChange={setAvgBalance}
						step={5}
						max={180}
						unit="seg"
					/>
				</div>
			</section>

			<section className="border-t border-line px-4 py-6">
				<p className="eyebrow mb-3">Señales de alarma</p>
				<Flag
					label="El tobillo se fue en algún momento"
					checked={givesWay}
					onChange={setGivesWay}
				/>
				<Flag
					label="Hubo hinchazón"
					checked={swelling}
					onChange={setSwelling}
				/>

				{verdict.blocked ? (
					<div className="mt-4 border-l-2 border-stop pl-3">
						<p className="text-sm font-semibold text-stop">
							Progresión detenida
						</p>
						<p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
							Registraste{" "}
							{verdict.signals
								.map((signal) => SAFETY_LABELS[signal])
								.join(" y ")}
							. La app no va a sugerir subir carga en ejercicios de tobillo
							hasta que esto se resuelva.
						</p>
					</div>
				) : null}
			</section>

			<div className="px-4 py-6">
				<button
					type="button"
					onClick={save}
					className="h-14 w-full rounded-lg bg-reserve text-base font-semibold text-on-accent transition-opacity active:opacity-80"
				>
					{saved ? "Guardado" : "Guardar chequeo"}
				</button>
			</div>

			{history.length > 0 ? (
				<section className="border-t border-line px-4 py-6">
					<p className="eyebrow mb-3">Historial</p>
					<ul className="space-y-2">
						{history.slice(0, 8).map((check) => (
							<li
								key={check.id}
								className="tabular flex justify-between text-[0.8125rem]"
							>
								<span className="text-muted">{formatDayMonth(check.date)}</span>
								<span className="text-faint">
									dolor {check.pain}
									{check.bestBalance !== null
										? ` · balance ${check.bestBalance}s`
										: ""}
									{check.givesWay || check.swelling ? (
										<span className="ml-2 text-stop">alarma</span>
									) : null}
								</span>
							</li>
						))}
					</ul>
				</section>
			) : null}

			<section className="border-t border-line px-4 py-6">
				<p className="eyebrow mb-2">Seguridad</p>
				{ankleProtocol.safetyNotes.map((note) => (
					<p
						key={note}
						className="mt-2 text-[0.8125rem] leading-relaxed text-faint"
					>
						{note}
					</p>
				))}
			</section>

			<TabBar />
		</main>
	);
}

function Flag({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: (value: boolean) => void;
}) {
	return (
		<label className="flex items-center gap-3 py-2 text-[0.9375rem] text-ink">
			<input
				type="checkbox"
				checked={checked}
				onChange={(event) => onChange(event.target.checked)}
				className="size-5 accent-[var(--color-stop)]"
			/>
			{label}
		</label>
	);
}
