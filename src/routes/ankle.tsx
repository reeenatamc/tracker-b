/**
 * Weekly ankle check.
 *
 * The measurements that matter are comparative — injured against healthy — so
 * they are entered and shown side by side rather than as a list of numbers you
 * would have to hold in your head.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Stepper } from "@/components/Stepper";
import { TabBar } from "@/components/TabBar";
import { TickScale } from "@/components/TickScale";
import { useRecords } from "@/db/records";
import { evaluateSafety } from "@/domain/safety";
import { ankleProtocol } from "@/lib/content";
import { formatDayMonth, SAFETY_LABELS, todayIso } from "@/lib/format";

export const Route = createFileRoute("/ankle")({ component: Ankle });

function Ankle() {
	const { collections, ankleChecks: checks } = useRecords();
	const today = todayIso();

	const history = [...checks].sort((a, b) => b.date.localeCompare(a.date));
	const latest = history[0] ?? null;
	/*
	 * The check being edited: today's if it exists, so reopening the tab shows
	 * what you already entered instead of an empty form — and so saving twice in
	 * a day corrects the record rather than creating a second one.
	 */
	const editing = history.find((check) => check.date === today) ?? null;

	const [pain, setPain] = useState(editing?.pain ?? 0);
	const [kneeToWallInjured, setKneeInjured] = useState<number | null>(
		editing?.kneeToWallInjured ?? null,
	);
	const [kneeToWallHealthy, setKneeHealthy] = useState<number | null>(
		editing?.kneeToWallHealthy ?? null,
	);
	const [calfRaisesInjured, setCalfRaises] = useState<number | null>(
		editing?.calfRaisesInjured ?? null,
	);
	const [bestBalance, setBestBalance] = useState<number | null>(
		editing?.bestBalance ?? null,
	);
	const [avgBalance, setAvgBalance] = useState<number | null>(
		editing?.avgBalance ?? null,
	);
	const [givesWay, setGivesWay] = useState(editing?.givesWay ?? false);
	const [swelling, setSwelling] = useState(editing?.swelling ?? false);
	const [saved, setSaved] = useState(false);

	/*
	 * The database opens asynchronously, so the first render has no check to seed
	 * the fields from — `useState` initialisers run once and would leave the form
	 * blank over a record that exists. This fills it in when the data arrives, and
	 * again if the day's check is edited elsewhere.
	 */
	const [loadedId, setLoadedId] = useState<string | null>(null);
	useEffect(() => {
		if (!editing || editing.id === loadedId) return;
		setLoadedId(editing.id);
		setPain(editing.pain);
		setKneeInjured(editing.kneeToWallInjured);
		setKneeHealthy(editing.kneeToWallHealthy);
		setCalfRaises(editing.calfRaisesInjured);
		setBestBalance(editing.bestBalance);
		setAvgBalance(editing.avgBalance);
		setGivesWay(editing.givesWay);
		setSwelling(editing.swelling);
	}, [editing, loadedId]);

	const verdict = evaluateSafety({ pain, swelling, givesWay });

	function save() {
		const record = {
			date: today,
			pain,
			kneeToWallInjured,
			kneeToWallHealthy,
			calfRaisesInjured,
			bestBalance,
			avgBalance,
			givesWay,
			swelling,
			notes: editing?.notes ?? null,
		};
		if (editing) {
			collections.ankleChecks.update(editing.id, (draft) =>
				Object.assign(draft, record),
			);
		} else {
			collections.ankleChecks.insert({ id: crypto.randomUUID(), ...record });
		}
		setSaved(true);
	}

	const gap =
		kneeToWallInjured !== null && kneeToWallHealthy !== null
			? kneeToWallHealthy - kneeToWallInjured
			: null;

	return (
		<main className="mx-auto min-h-dvh w-full max-w-lg space-y-3 px-3 pb-[calc(8.5rem+env(safe-area-inset-bottom))]">
			<header className="px-2 pt-7 pb-1">
				<p className="eyebrow">Chequeo semanal</p>
				<h1 className="mt-1 text-[1.75rem] leading-tight font-bold tracking-tight">
					Tobillo
				</h1>
				{latest ? (
					<p className="mt-1 text-sm text-muted">
						Último registro: {formatDayMonth(latest.date)} · dolor{" "}
						<span className="tabular">{latest.pain}</span>
						{latest.kneeToWallInjured !== null ? (
							<>
								{" · knee-to-wall "}
								<span className="tabular">{latest.kneeToWallInjured}</span>
								{latest.kneeToWallHealthy !== null ? (
									<span className="tabular">/{latest.kneeToWallHealthy}</span>
								) : null}
								{" cm"}
							</>
						) : null}
					</p>
				) : (
					<p className="mt-1 text-sm text-muted">Aún no hay registros.</p>
				)}
			</header>

			<section className="card">
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

			<section className="card">
				<p className="eyebrow mb-3">Knee-to-wall · centímetros</p>
				<div className="grid grid-cols-2 gap-3">
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

			<section className="card">
				<p className="eyebrow mb-3">Fuerza y balance · lado lesionado</p>
				<div className="grid grid-cols-2 gap-x-3 gap-y-4">
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

			<section className="card">
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
				<section className="card">
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
									{check.kneeToWallInjured !== null
										? ` · ${check.kneeToWallInjured}${
												check.kneeToWallHealthy !== null
													? `/${check.kneeToWallHealthy}`
													: ""
											} cm`
										: ""}
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

			<section className="card">
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
