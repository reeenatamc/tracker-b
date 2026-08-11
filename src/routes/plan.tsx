/**
 * The plan, and why it says what it says.
 *
 * The screen E3 was for. Every number here can be traced back: this is what the
 * program started with, these are the decisions taken since, this is what they
 * add up to today. Nothing is a black box, which was the requirement.
 *
 * Deliberately not here: versions, diffs between them, or anything that proposes
 * a change on its own. Those are E4 and E6. What you can do from here is take a
 * decision and say why, and revoke one you took before — which does not erase it,
 * because it was true until you changed your mind.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PrimaryButton, Sheet } from "@/components/Sheet";
import { PageHeader, TabBar } from "@/components/TabBar";
import { persisted } from "@/db/durability";
import { useRecords } from "@/db/records";
import { inForce, ordered } from "@/domain/adjustments";
import { setsOf } from "@/domain/personalise";
import { phaseForDate } from "@/domain/phases";
import { resolvePrescription } from "@/domain/prescription";
import type { PlanAdjustment, PrescriptionEntry } from "@/domain/schema";
import { program } from "@/lib/content";
import { formatDate, todayIso } from "@/lib/format";

export const Route = createFileRoute("/plan")({ component: Plan });

const ORIGIN_LABEL: Record<string, string> = {
	program: "del programa",
	review: "de una revisión",
	coach: "del coach",
	manual: "tuyo",
	safety: "por seguridad",
};

function Plan() {
	const { collections, phaseEvents, prescriptionBaseline, planAdjustments } =
		useRecords();
	const today = todayIso();
	const phase = phaseForDate(program, phaseEvents, today);
	const phaseAt = (date: string) => phaseForDate(program, phaseEvents, date).id;
	const asOf = { effectiveOn: today, knows: null };

	const [revoking, setRevoking] = useState<PlanAdjustment | null>(null);

	const live = new Set(
		inForce(planAdjustments, asOf, phaseAt).map((entry) => entry.id),
	);

	/** Newest first: what you decided last is what you are looking for. */
	const history = [...ordered(planAdjustments)].reverse();

	async function revoke(adjustment: PlanAdjustment, reason: string) {
		await persisted(
			collections.planAdjustments.insert({
				kind: "revoke",
				id: crypto.randomUUID(),
				revokesId: adjustment.id,
				// From today onwards. It held until now, and that stays true.
				effectiveOn: today,
				onlyInPhase: null,
				origin: "manual",
				reason,
				evidenceIds: [],
				provenance: { kind: "authored" },
				createdAt: Date.now(),
			}),
		);
	}

	return (
		<main className="mx-auto min-h-dvh w-full max-w-lg space-y-3 px-3 pb-[calc(8.5rem+env(safe-area-inset-bottom))]">
			<PageHeader
				eyebrow={`Fase ${phase.order} · ${phase.name}`}
				title="Plan"
				subtitle={`${live.size} ${live.size === 1 ? "ajuste vigente" : "ajustes vigentes"} · lo que ves aquí es lo que verás al entrenar`}
			/>

			{prescriptionBaseline.length === 0 ? (
				<div className="card">
					<p className="text-sm text-muted">
						Todavía no hay plan cargado en esta base.
					</p>
				</div>
			) : (
				program.sessions.map((template) => {
					const entries = resolvePrescription(
						prescriptionBaseline,
						planAdjustments,
						template.id,
						asOf,
						phaseAt,
					);
					if (entries.length === 0) return null;

					return (
						<section key={template.id} className="card">
							<p className="eyebrow">{template.name}</p>
							<ul className="mt-3 space-y-3">
								{entries.map((entry) => (
									<PlanRow
										key={entry.id}
										entry={entry}
										baselineSets={
											prescriptionBaseline.find((row) => row.id === entry.id)
												?.sets ?? null
										}
										adjustments={planAdjustments.filter(
											(adjustment) =>
												"entryId" in adjustment &&
												adjustment.entryId === entry.id &&
												live.has(adjustment.id),
										)}
										nameOf={(exerciseId) =>
											template.exercises.find((e) => e.id === exerciseId)
												?.name ?? exerciseId
										}
										onRevoke={setRevoking}
									/>
								))}
							</ul>
						</section>
					);
				})
			)}

			<section className="card">
				<p className="eyebrow">Todo lo decidido</p>
				{history.length === 0 ? (
					<p className="mt-2 text-sm text-muted">
						Nada todavía. Lo que cambies desde una sesión aparece aquí.
					</p>
				) : (
					<ul className="mt-3 space-y-3">
						{history.map((adjustment) => (
							<li key={adjustment.id} className="text-[0.8125rem]">
								<p className="flex items-baseline justify-between gap-2">
									<span className={live.has(adjustment.id) ? "" : "text-faint"}>
										{describe(adjustment)}
									</span>
									<span className="eyebrow shrink-0">
										{live.has(adjustment.id) ? "vigente" : "sin efecto"}
									</span>
								</p>
								<p className="mt-0.5 text-faint">
									{formatDate(adjustment.effectiveOn)} ·{" "}
									{ORIGIN_LABEL[adjustment.origin] ?? adjustment.origin}
									{adjustment.onlyInPhase
										? ` · sólo en ${adjustment.onlyInPhase}`
										: ""}
								</p>
								<p className="mt-0.5 text-muted italic">
									«{adjustment.reason}»
								</p>
							</li>
						))}
					</ul>
				)}
			</section>

			{revoking ? (
				<RevokeSheet
					adjustment={revoking}
					onSave={async (reason) => {
						await revoke(revoking, reason);
						setRevoking(null);
					}}
					onClose={() => setRevoking(null)}
				/>
			) : null}

			<TabBar />
		</main>
	);
}

function PlanRow({
	entry,
	baselineSets,
	adjustments,
	nameOf,
	onRevoke,
}: {
	entry: PrescriptionEntry;
	baselineSets: PrescriptionEntry["sets"];
	adjustments: readonly PlanAdjustment[];
	nameOf: (exerciseId: string) => string;
	onRevoke: (adjustment: PlanAdjustment) => void;
}) {
	const sets = setsOf(entry);
	const started = setsOf({ ...entry, sets: baselineSets });
	const moved = JSON.stringify(sets) !== JSON.stringify(started);

	return (
		<li>
			<p className="flex items-baseline justify-between gap-2">
				<span className="text-[0.9375rem]">{nameOf(entry.exerciseId)}</span>
				<span className="tabular shrink-0 text-[0.8125rem] text-muted">
					{sets ? `${sets.max} series` : "sin programar"}
				</span>
			</p>

			{/* De dónde sale ese número: con qué empezó y qué lo movió. */}
			{moved ? (
				<p className="tabular mt-0.5 text-[0.6875rem] text-faint">
					empezó en {started ? started.max : "—"}
				</p>
			) : null}

			{adjustments.map((adjustment) => (
				<button
					key={adjustment.id}
					type="button"
					onClick={() => onRevoke(adjustment)}
					className="mt-1 block w-full text-left text-[0.6875rem] text-faint active:opacity-60"
				>
					↳ {describe(adjustment)} · «{adjustment.reason}» ›
				</button>
			))}
		</li>
	);
}

function RevokeSheet({
	adjustment,
	onSave,
	onClose,
}: {
	adjustment: PlanAdjustment;
	onSave: (reason: string) => void;
	onClose: () => void;
}) {
	const [reason, setReason] = useState("");

	return (
		<Sheet title="Deshacer este ajuste" onClose={onClose}>
			<p className="text-[0.8125rem] text-muted">{describe(adjustment)}</p>
			<p className="mt-1 text-[0.8125rem] text-faint italic">
				«{adjustment.reason}»
			</p>

			<p className="mt-4 text-[0.6875rem] text-faint">
				Deja de aplicarse desde hoy. No se borra: las sesiones que lo tuvieron
				delante lo siguieron, y eso no cambia.
			</p>

			<label className="mt-5 block">
				<span className="eyebrow">Por qué lo deshaces</span>
				<input
					type="text"
					value={reason}
					onChange={(event) => setReason(event.target.value)}
					placeholder="Ya no me hace falta"
					className="mt-1 h-12 w-full rounded-lg border border-line bg-transparent px-3 text-sm"
				/>
			</label>

			<PrimaryButton
				onClick={() => onSave(reason.trim())}
				disabled={reason.trim().length === 0}
			>
				Deshacer desde hoy
			</PrimaryButton>
		</Sheet>
	);
}

/** One line saying what an adjustment does. Never a code, never a field name. */
function describe(adjustment: PlanAdjustment): string {
	switch (adjustment.kind) {
		case "set_field":
			return `${FIELD_LABEL[adjustment.change.field]} → ${value(adjustment.change.value)}`;
		case "replace_exercise":
			return `cambia el ejercicio por ${adjustment.entry.exerciseId}`;
		case "add_entry":
			return `añade ${adjustment.entry.exerciseId}`;
		case "remove_entry":
			return "quita el ejercicio del plan";
		case "revoke":
			return "deshace un ajuste anterior";
	}
}

const FIELD_LABEL: Record<string, string> = {
	sets: "series",
	target: "repeticiones",
	load: "carga",
	rir: "RIR",
	restSeconds: "descanso",
	trainingRole: "tipo de trabajo",
	cues: "señales",
	allowedSubstitutions: "sustituciones",
	goal: "objetivo",
	progression: "progresión",
	order: "orden",
};

function value(raw: unknown): string {
	if (raw === null || raw === undefined) return "—";
	if (typeof raw === "number" || typeof raw === "string") return String(raw);
	if (Array.isArray(raw)) return raw.map(value).join("–");
	const record = raw as Record<string, unknown>;
	if ("min" in record && "max" in record) {
		return record.min === record.max
			? String(record.min)
			: `${record.min}–${record.max}`;
	}
	if ("startKg" in record) return `${record.startKg} kg`;
	return "…";
}
