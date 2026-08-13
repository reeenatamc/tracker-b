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
import { useEffect, useState } from "react";
import { PrimaryButton, Sheet } from "@/components/Sheet";
import { PageHeader, TabBar } from "@/components/TabBar";
import { persisted } from "@/db/durability";
import { useRecords } from "@/db/records";
import { useSync } from "@/db/sync-provider";
import { inForce, ordered } from "@/domain/adjustments";
import { diffVersions } from "@/domain/diff";
import { setsOf } from "@/domain/personalise";
import { phaseForDate } from "@/domain/phases";
import { resolvePrescription } from "@/domain/prescription";
import type {
	PhaseEvent,
	PlanAdjustment,
	PrescriptionBaseline,
	PrescriptionEntry,
	ProgramVersion,
} from "@/domain/schema";
import {
	type CaptureRefusal,
	captureProgramKnowledgeCut,
	resolveVersion,
} from "@/domain/versions";
import { diffVolume } from "@/domain/volume";
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
	const {
		collections,
		phaseEvents,
		prescriptionBaseline,
		planAdjustments,
		planVersions,
	} = useRecords();
	const sync = useSync();
	const today = todayIso();
	const phase = phaseForDate(program, phaseEvents, today);
	const phaseAt = (date: string) => phaseForDate(program, phaseEvents, date).id;
	const asOf = { effectiveOn: today, knows: null };

	const [revoking, setRevoking] = useState<PlanAdjustment | null>(null);
	const [saving, setSaving] = useState(false);
	const [refusal, setRefusal] = useState<string | null>(null);
	const [comparing, setComparing] = useState<[string, string] | null>(null);

	/**
	 * Capturing a version, or saying exactly why not.
	 *
	 * A version is immutable, so one born from a half-loaded database or a
	 * half-finished write is wrong for ever. Every refusal below names something
	 * that can be waited out, so the button explains instead of disabling itself.
	 */
	async function saveVersion(name: string, reason: string) {
		const captured = await captureProgramKnowledgeCut({
			read: () => ({
				adjustments: collections.raw.planAdjustments
					.toArray as PlanAdjustment[],
				phaseEvents: collections.raw.phaseEvents.toArray as never,
				baseline: collections.raw.prescriptionBaseline.toArray as never,
			}),
			cutAt: today,
			today,
			bootstrapReady: true,
			syncIdle: sync.state.status !== "syncing",
			pendingWrites: collections.tracker.pendingCount,
		});

		if ("kind" in captured) {
			setRefusal(describeRefusal(captured));
			return;
		}

		await persisted(
			collections.planVersions.insert({
				id: crypto.randomUUID(),
				name,
				cutAt: today,
				knows: captured.knows,
				createdAt: Date.now(),
				reason,
				baselineFingerprint: captured.baselineFingerprint,
				baselineSize: captured.baselineSize,
			}),
		);
		setRefusal(null);
	}

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

			<section className="card">
				<div className="flex items-baseline justify-between gap-2">
					<p className="eyebrow">Versiones</p>
					<button
						type="button"
						onClick={() => setSaving(true)}
						className="text-[0.8125rem] text-reserve"
					>
						Guardar esta versión
					</button>
				</div>

				{refusal ? (
					<p className="mt-2 text-[0.8125rem] text-stop">{refusal}</p>
				) : null}

				{planVersions.length === 0 ? (
					<p className="mt-2 text-sm text-muted">
						Ninguna todavía. Una versión guarda el plan de hoy y qué sabías al
						guardarlo, para poder compararlo más adelante.
					</p>
				) : (
					<ul className="mt-3 space-y-2">
						{[...planVersions]
							.sort((a, b) => b.createdAt - a.createdAt)
							.map((version) => (
								<VersionRow
									key={version.id}
									version={version}
									adjustments={planAdjustments}
									phaseEvents={phaseEvents}
									baseline={prescriptionBaseline}
									onCompare={(id) =>
										setComparing((current) =>
											current?.[0] === id ? null : [id, current?.[0] ?? id],
										)
									}
								/>
							))}
					</ul>
				)}
			</section>

			{saving ? (
				<SaveVersion
					today={today}
					onSave={async (name, reason) => {
						await saveVersion(name, reason);
						setSaving(false);
					}}
					onClose={() => setSaving(false)}
				/>
			) : null}

			{comparing && comparing[0] !== comparing[1] ? (
				<Comparison
					ids={comparing}
					versions={planVersions}
					adjustments={planAdjustments}
					phaseEvents={phaseEvents}
					baseline={prescriptionBaseline}
					onClose={() => setComparing(null)}
				/>
			) : null}

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

/**
 * Why a capture was refused, in the words of the thing you can do about it.
 *
 * Four of the five are "wait a second"; the fifth is not, and says so. Telling
 * someone to sync when the log has a broken reference would be advice that never
 * works.
 */
function describeRefusal(refusal: CaptureRefusal): string {
	switch (refusal.kind) {
		case "not-ready":
			return "Tu registro todavía se está abriendo. Espera un momento y vuelve a intentarlo.";
		case "sync-in-flight":
			return "Hay una sincronización en curso. Espera a que termine: una versión guardada a medias no se puede arreglar después.";
		case "writes-pending":
			return `Quedan ${refusal.count} cambios por guardar en el disco. Un instante y ya.`;
		case "dangling":
			return "El registro de decisiones tiene una referencia rota. Esto no se arregla esperando: revísalo antes de guardar una versión.";
		case "future-cut":
			return "Una versión no puede guardar un plan del futuro.";
	}
}

/**
 * One version, and whether this device can resolve it.
 *
 * The three states are shown as three different things because they are: one is
 * a plan, one is a sync that has not finished, and one is a row that should not
 * exist. Telling the third to "sincroniza" would be advice that never works.
 */
function VersionRow({
	version,
	adjustments,
	phaseEvents,
	baseline,
	onCompare,
}: {
	version: ProgramVersion;
	adjustments: readonly PlanAdjustment[];
	phaseEvents: readonly PhaseEvent[];
	baseline: readonly PrescriptionBaseline[];
	onCompare: (id: string) => void;
}) {
	const [state, setState] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void resolveVersion({
			version,
			adjustments,
			phaseEvents,
			baseline,
			program,
		}).then((result) => {
			if (cancelled) return;
			if (result.kind === "resolved") setState(null);
			else if (result.kind === "incomplete") {
				const faltan =
					result.missingAdjustmentIds.length +
					result.missingPhaseEventIds.length;
				setState(
					result.baselineMissing && faltan === 0
						? "Falta parte del plan base en este dispositivo. Sincroniza."
						: `Menciona ${faltan} decisiones que este dispositivo no tiene. Sincroniza.`,
				);
			} else setState(`Esta versión no cuadra: ${result.detail}`);
		});
		return () => {
			cancelled = true;
		};
	}, [version, adjustments, phaseEvents, baseline]);

	return (
		<li>
			<button
				type="button"
				onClick={() => onCompare(version.id)}
				className="w-full text-left active:opacity-60"
			>
				<span className="flex items-baseline justify-between gap-2">
					<span className="text-[0.9375rem]">{version.name}</span>
					<span className="eyebrow shrink-0">{formatDate(version.cutAt)}</span>
				</span>
				<span className="mt-0.5 block text-[0.8125rem] text-muted italic">
					«{version.reason}»
				</span>
				{state ? (
					<span className="mt-0.5 block text-[0.6875rem] text-stop">
						{state}
					</span>
				) : null}
			</button>
		</li>
	);
}

function SaveVersion({
	today,
	onSave,
	onClose,
}: {
	today: string;
	onSave: (name: string, reason: string) => void;
	onClose: () => void;
}) {
	const [name, setName] = useState("");
	const [reason, setReason] = useState("");

	return (
		<Sheet title="Guardar esta versión" onClose={onClose}>
			<p className="text-[0.8125rem] text-muted">
				Guarda el plan de hoy, {formatDate(today)}, y qué sabías al guardarlo.
				Lo que llegue después no la moverá.
			</p>

			<label className="mt-5 block">
				<span className="eyebrow">Nombre</span>
				<input
					type="text"
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder="v3"
					className="mt-1 h-12 w-full rounded-lg border border-line bg-transparent px-3 text-sm"
				/>
			</label>
			<p className="mt-1 text-[0.6875rem] text-faint">
				El nombre es definitivo: una versión no se renombra.
			</p>

			<label className="mt-4 block">
				<span className="eyebrow">Por qué</span>
				<input
					type="text"
					value={reason}
					onChange={(event) => setReason(event.target.value)}
					placeholder="antes de cambiar el bloque"
					className="mt-1 h-12 w-full rounded-lg border border-line bg-transparent px-3 text-sm"
				/>
			</label>

			<PrimaryButton
				onClick={() => onSave(name.trim(), reason.trim())}
				disabled={name.trim().length === 0 || reason.trim().length === 0}
			>
				Guardar
			</PrimaryButton>
		</Sheet>
	);
}

/** Two versions side by side: what moved, how much, and who decided it. */
function Comparison({
	ids,
	versions,
	adjustments,
	phaseEvents,
	baseline,
	onClose,
}: {
	ids: [string, string];
	versions: readonly ProgramVersion[];
	adjustments: readonly PlanAdjustment[];
	phaseEvents: readonly PhaseEvent[];
	baseline: readonly PrescriptionBaseline[];
	onClose: () => void;
}) {
	const [body, setBody] = useState<{
		changes: ReturnType<typeof diffVersions>["changes"];
		volume: ReturnType<typeof diffVolume>;
		unexplained: string[];
	} | null>(null);
	const [blocked, setBlocked] = useState<string | null>(null);

	const from = versions.find((v) => v.id === ids[1]);
	const to = versions.find((v) => v.id === ids[0]);

	useEffect(() => {
		if (!from || !to) return;
		let cancelled = false;

		void Promise.all([
			resolveVersion({
				version: from,
				adjustments,
				phaseEvents,
				baseline,
				program,
			}),
			resolveVersion({
				version: to,
				adjustments,
				phaseEvents,
				baseline,
				program,
			}),
		]).then(([a, b]) => {
			if (cancelled) return;
			// Comparar contra una versión a medias produce diferencias que son
			// huecos de sincronización disfrazados de decisiones.
			if (a.kind !== "resolved" || b.kind !== "resolved") {
				setBlocked(
					"Una de las dos no se puede resolver en este dispositivo todavía.",
				);
				return;
			}
			const diff = diffVersions({
				from: { version: from, plan: a.plan },
				to: { version: to, plan: b.plan },
				adjustments,
				phaseEvents,
				baseline,
				program,
			});
			setBody({
				changes: diff.changes,
				volume: diffVolume(a.plan, b.plan),
				unexplained: diff.unexplained,
			});
		});
		return () => {
			cancelled = true;
		};
	}, [from, to, adjustments, phaseEvents, baseline]);

	return (
		<Sheet
			title={`${from?.name ?? "?"} → ${to?.name ?? "?"}`}
			onClose={onClose}
		>
			{blocked ? <p className="text-[0.8125rem] text-stop">{blocked}</p> : null}

			{body ? (
				<>
					<p className="tabular text-[0.8125rem] text-muted">
						Series planificadas {body.volume.total.from} →{" "}
						{body.volume.total.to}
						{body.volume.total.delta !== 0
							? ` (${body.volume.total.delta > 0 ? "+" : ""}${body.volume.total.delta})`
							: ""}
					</p>

					{body.changes.length === 0 ? (
						<p className="mt-4 text-sm text-muted">
							No cambió nada entre las dos.
						</p>
					) : (
						<ul className="mt-4 space-y-3">
							{body.changes.map((change) => (
								<li key={change.entryId} className="text-[0.8125rem]">
									<p>
										{CHANGE_LABEL[change.kind]} · {change.entryId}
									</p>
									{change.kind === "changed"
										? change.fields.map((field) => (
												<p key={field.field} className="text-faint">
													{field.field}: {String(field.from)} →{" "}
													{String(field.to)}
												</p>
											))
										: null}
									{change.causes.map((cause) => (
										<p
											key={`${change.entryId}-${causeKey(cause)}`}
											className="mt-0.5 text-faint"
										>
											{describeCause(cause)}
										</p>
									))}
								</li>
							))}
						</ul>
					)}

					{body.unexplained.length > 0 ? (
						<p className="mt-4 text-[0.8125rem] text-stop">
							{body.unexplained.length} diferencias sin explicación. Eso es un
							fallo, no un cambio normal.
						</p>
					) : null}
				</>
			) : blocked ? null : (
				<p className="text-sm text-muted">Comparando…</p>
			)}
		</Sheet>
	);
}

const CHANGE_LABEL: Record<string, string> = {
	added: "añadido",
	removed: "quitado",
	replaced: "cambió el ejercicio",
	changed: "cambió",
};

/** Stable per cause, so React is not keying rows by where they happened to land. */
function causeKey(
	cause: ReturnType<typeof diffVersions>["changes"][number]["causes"][number],
): string {
	switch (cause.kind) {
		case "adjustment":
			return cause.adjustmentId;
		case "revocation":
			return cause.revokeId;
		case "phase":
			return `phase-${cause.via.kind}`;
		case "unexplained":
			return "unexplained";
	}
}

function describeCause(
	cause: ReturnType<typeof diffVersions>["changes"][number]["causes"][number],
): string {
	switch (cause.kind) {
		case "adjustment":
			return `causa: «${cause.reason}» · ${cause.origin} · desde ${formatDate(cause.effectiveOn)}`;
		case "revocation":
			return `deshecho: «${cause.reason}» · desde ${formatDate(cause.effectiveOn)}`;
		case "phase":
			return cause.via.kind === "date"
				? `causa: una resuelve en ${cause.from} y la otra en ${cause.to}`
				: `causa: ${cause.from} → ${cause.to}, por ${cause.via.kind === "correction" ? "una corrección" : "una transición"} del ${formatDate(cause.via.occurredOn)}`;
		case "unexplained":
			return "sin causa atribuible";
	}
}
