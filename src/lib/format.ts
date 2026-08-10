/**
 * Spanish user-facing strings.
 *
 * The domain layer returns codes, never sentences, so every word you read in
 * the app is written here and nowhere else.
 */

import type { ProgressionDecision } from "@/domain/progression";
import type { SafetySignal } from "@/domain/safety";
import type { PhaseId, SetRecord, Target } from "@/domain/schema";

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS = [
	"ene",
	"feb",
	"mar",
	"abr",
	"may",
	"jun",
	"jul",
	"ago",
	"sep",
	"oct",
	"nov",
	"dic",
];

/** "2026-08-10" -> "lun 10 ago" */
export function formatDate(iso: string): string {
	const date = new Date(`${iso}T12:00:00Z`);
	return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** "2026-08-10" -> "10 ago" */
export function formatDayMonth(iso: string): string {
	const date = new Date(`${iso}T12:00:00Z`);
	return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export function todayIso(): string {
	const now = new Date();
	const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 10);
}

const RANGE_DASH = "–";

function range(min: number, max: number): string {
	return min === max ? String(min) : `${min}${RANGE_DASH}${max}`;
}

/** How a set is measured: "10–12", "8/lado", "30 s/lado", "8–10 min". */
export function formatTarget(target: Target, phase: PhaseId): string {
	switch (target.kind) {
		case "reps":
			return range(target.min, target.max);
		case "repsPerSide":
			return `${range(target.min, target.max)}/lado`;
		case "seconds":
			return `${target.seconds} s`;
		case "secondsPerSide":
			return `${target.seconds} s/lado`;
		case "minutes":
			return `${range(target.min, target.max)} min`;
		case "minutesByPhase": {
			const forPhase = target.byPhase[phase - 1] ?? target.byPhase[0];
			return `${range(forPhase.min, forPhase.max)} min`;
		}
		case "freeform":
			return target.text;
	}
}

/** The unit shown next to a logged number. */
export function targetUnit(target: Target): string {
	switch (target.kind) {
		case "reps":
		case "repsPerSide":
			return "reps";
		case "seconds":
		case "secondsPerSide":
			return "seg";
		case "minutes":
		case "minutesByPhase":
			return "min";
		case "freeform":
			return "";
	}
}

export function formatLoad(kg: number | null, perSide: boolean): string {
	if (kg === null) return "—";
	const value = Number.isInteger(kg) ? String(kg) : kg.toFixed(1);
	return perSide ? `${value} kg/lado` : `${value} kg`;
}

/** One previous set, log-line style: "20kg × 12". */
export function formatSet(set: SetRecord): string {
	// Imported rows sometimes carry only a note. Saying "— reps" would dress up
	// an absence as a measurement.
	if (set.reps === null && set.load === null) return "—";

	const reps = set.reps ?? "—";
	if (set.unit === "kg" && set.load !== null) return `${set.load}kg × ${reps}`;
	if (set.unit === "seconds") return `${reps} s`;
	if (set.unit === "minutes") return `${reps} min`;
	return `${reps} reps`;
}

/** The RIR across a group of sets: "RIR 2" or "RIR 0–2". */
export function formatRirSummary(sets: readonly SetRecord[]): string | null {
	const values = sets
		.map((set) => set.rir)
		.filter((rir): rir is number => typeof rir === "number");
	if (values.length === 0) return null;
	const min = Math.min(...values);
	const max = Math.max(...values);
	return `RIR ${range(min, max)}`;
}

export const SAFETY_LABELS: Record<SafetySignal, string> = {
	pain: "dolor relevante",
	swelling: "hinchazón",
	givesWay: "el tobillo se va",
};

export type DecisionCopy = {
	/** Short label for the row: what to do. */
	headline: string;
	/** Why, in the program's own terms. */
	detail: string;
	tone: "reserve" | "effort" | "stop" | "neutral";
};

/** Turns a progression decision into the sentence you read at the gym. */
export function describeDecision(
	decision: ProgressionDecision,
	progressionNote: string,
): DecisionCopy {
	switch (decision.kind) {
		case "blocked":
			return {
				headline: "No subas carga",
				detail: `Registraste ${decision.signals
					.map((signal) => SAFETY_LABELS[signal])
					.join(" y ")}. Mantén o reduce, y valora fisioterapia si sigue.`,
				tone: "stop",
			};
		case "calibrate":
			return {
				headline: "Calibra el peso",
				detail:
					"Prueba series de aproximación hasta encontrar tu peso de trabajo.",
				tone: "neutral",
			};
		case "start":
			return {
				headline:
					decision.loadKg === null
						? "Primera vez"
						: `Empieza en ${formatLoad(decision.loadKg, decision.perSide)}`,
				detail: "Sin registro previo. Esta sesión marca tu punto de partida.",
				tone: "neutral",
			};
		case "hold":
			return {
				// Bodyweight work has no load to name, so it says what to hold instead.
				headline:
					decision.loadKg === null
						? "Mantén el mismo trabajo"
						: `Mantén ${formatLoad(decision.loadKg, decision.perSide)}`,
				detail: HOLD_DETAIL[decision.reason],
				tone: decision.reason === "rirTooLow" ? "effort" : "neutral",
			};
		case "increase":
			return {
				headline: `Sube a ${formatLoad(decision.toKg, decision.perSide)}`,
				detail: `Completaste el tope de reps con reserva en todas las series. Incremento de ${decision.incrementKg} kg${
					decision.perSide ? " por lado" : ""
				}.`,
				tone: "reserve",
			};
		case "advanceDifficulty":
			return {
				headline: "Sube la dificultad",
				detail:
					progressionNote || "Dominas el rango de reps con peso corporal.",
				tone: "reserve",
			};
		case "qualitative":
			return {
				headline: "Progresa por control",
				detail:
					progressionNote ||
					"Sin carga que subir: mejora la calidad del movimiento.",
				tone: "neutral",
			};
	}
}

const HOLD_DETAIL = {
	repsBelowTop: "Todavía no completas el tope de reps en todas las series.",
	rirTooLow:
		"Llegaste al tope de reps, pero demasiado cerca del fallo para subir.",
	rirUnknown: "Falta registrar el RIR para poder decidir.",
	setsIncomplete: "Faltaron series de trabajo respecto a lo que pide la fase.",
} as const;
