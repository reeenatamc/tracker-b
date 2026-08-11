/**
 * The phase log.
 *
 * Two things are load-bearing here and get most of the attention: that annulment
 * chains behave like an undo stack rather than like whatever the algorithm
 * happens to do, and that nothing throws no matter how damaged the log is —
 * because this is read from the screen you hold between sets.
 */

import { describe, expect, it } from "vitest";
import { PHASE_EVENTS } from "./__fixtures__/log";
import { PROGRAM } from "./__fixtures__/program";
import {
	driftDays,
	liveEvents,
	moves,
	phaseForDate,
	projectPhases,
	sessionsDisagreeingWithPhase,
} from "./phase-events";
import type { Phase, PhaseEvent, Program, SessionRecord } from "./schema";

// ------------------------------------------------------------------- builders

let clock = 0;

function transition(
	id: string,
	to: string,
	on: string,
	from: string | null = null,
	extra: Partial<Extract<PhaseEvent, { kind: "transition" }>> = {},
): Extract<PhaseEvent, { kind: "transition" }> {
	return {
		kind: "transition",
		id,
		fromPhaseId: from,
		toPhaseId: to,
		occurredOn: on,
		plannedFor: null,
		trigger: "manual",
		reason: "",
		reviewId: null,
		createdAt: ++clock,
		...extra,
	};
}

function correction(
	id: string,
	supersedes: string,
	to: string,
	on: string,
	from: string | null = null,
): PhaseEvent {
	return {
		kind: "correction",
		id,
		supersedesId: supersedes,
		fromPhaseId: from,
		toPhaseId: to,
		occurredOn: on,
		plannedFor: null,
		trigger: "review",
		reason: "",
		reviewId: null,
		createdAt: ++clock,
	};
}

function revocation(id: string, revokes: string): PhaseEvent {
	return {
		kind: "revocation",
		id,
		revokesId: revokes,
		reason: "",
		createdAt: ++clock,
	};
}

const ids = (events: readonly PhaseEvent[]) => events.map((e) => e.id).sort();

// ------------------------------------------------------------------- liveness

describe("cadenas de corrección y revocación", () => {
	const A = transition("A", "progresion", "2026-09-01", "adaptacion");

	it("una transición sola está viva", () => {
		expect(ids(liveEvents([A]))).toEqual(["A"]);
	});

	it("una corrección mata a la que sustituye", () => {
		const B = correction("B", "A", "progresion", "2026-09-08", "adaptacion");
		expect(ids(liveEvents([A, B]))).toEqual(["B"]);
	});

	/** El caso que había que formalizar: revocar la corrección devuelve el original. */
	it("revocar la corrección más reciente restaura el estado previo", () => {
		const B = correction("B", "A", "progresion", "2026-09-08", "adaptacion");
		const C = revocation("C", "B");
		expect(ids(liveEvents([A, B, C]))).toEqual(["A", "C"]);
	});

	it("la cadena larga se comporta como una pila de deshacer", () => {
		const B = correction("B", "A", "progresion", "2026-09-08", "adaptacion");
		const C = correction("C", "B", "progresion", "2026-09-15", "adaptacion");
		const D = revocation("D", "C");
		expect(ids(liveEvents([A, B, C, D]))).toEqual(["B", "D"]);
	});

	it("la transición efectiva sigue a la cadena", () => {
		const B = correction("B", "A", "recomposicion", "2026-09-08", "adaptacion");
		const C = revocation("C", "B");

		expect(phaseForDate(PROGRAM, [A], "2026-09-30").id).toBe("progresion");
		expect(phaseForDate(PROGRAM, [A, B], "2026-09-30").id).toBe(
			"recomposicion",
		);
		// Revocada la corrección, vuelve a mandar A.
		expect(phaseForDate(PROGRAM, [A, B, C], "2026-09-30").id).toBe(
			"progresion",
		);
	});

	it("un ciclo de anulaciones mata todo el ciclo, sin colgarse", () => {
		const X = correction("X", "Y", "progresion", "2026-09-01", "adaptacion");
		const Y = correction("Y", "X", "recomposicion", "2026-09-02", "adaptacion");

		expect(liveEvents([X, Y])).toEqual([]);
		expect(() => phaseForDate(PROGRAM, [X, Y], "2026-09-30")).not.toThrow();
	});

	it("una revocación nunca aporta destino propio", () => {
		const B = transition("B", "recomposicion", "2026-10-05", "progresion");
		const C = revocation("C", "B");
		// C anula a B y no pone nada en su lugar: sólo queda A.
		expect(moves([A, B, C]).map((move) => move.id)).toEqual(["A"]);
	});
});

// ------------------------------------------------------------------- ordering

describe("orden determinista entre dispositivos", () => {
	const sameDay = [
		transition("zzz", "progresion", "2026-09-01", "adaptacion", {
			createdAt: 5,
		}),
		transition("aaa", "recomposicion", "2026-09-01", "adaptacion", {
			createdAt: 5,
		}),
	];

	it("desempata por id cuando fecha y reloj coinciden", () => {
		expect(moves(sameDay).map((move) => move.id)).toEqual(["aaa", "zzz"]);
	});

	it("el mismo conjunto barajado resuelve idéntico", () => {
		const shuffles = [
			[...PHASE_EVENTS],
			[...PHASE_EVENTS].reverse(),
			[PHASE_EVENTS[2], PHASE_EVENTS[0], PHASE_EVENTS[3], PHASE_EVENTS[1]],
		];

		const answers = shuffles.map(
			(events) => phaseForDate(PROGRAM, events, "2026-10-20").id,
		);
		expect(new Set(answers).size).toBe(1);
		expect(answers[0]).toBe("recomposicion");
	});
});

// ---------------------------------------------------------------- degradation

describe("phaseForDate no lanza nunca", () => {
	it("salta un evento que apunta a una fase inexistente y sigue con el válido", () => {
		const events = [
			transition("A", "progresion", "2026-09-01", "adaptacion"),
			transition("B", "fase_que_no_existe", "2026-09-10", "progresion"),
		];
		expect(phaseForDate(PROGRAM, events, "2026-09-30").id).toBe("progresion");
	});

	it("cae en la fase de menor orden cuando todos los eventos están rotos", () => {
		const events = [transition("A", "inventada", "2026-09-01", null)];
		expect(phaseForDate(PROGRAM, events, "2026-09-30").id).toBe("adaptacion");
	});

	it("cae en la fase de menor orden sin eventos", () => {
		expect(phaseForDate(PROGRAM, [], "2026-09-30").id).toBe("adaptacion");
	});

	it("aguanta un ciclo, un destino roto y una fecha anterior a todo", () => {
		const broken: PhaseEvent[] = [
			correction("X", "Y", "nope", "2026-09-01", null),
			correction("Y", "X", "nope", "2026-09-02", null),
			transition("Z", "tampoco", "2026-09-03", null),
		];
		expect(() => phaseForDate(PROGRAM, broken, "2020-01-01")).not.toThrow();
		expect(phaseForDate(PROGRAM, broken, "2020-01-01").id).toBe("adaptacion");
	});
});

// ---------------------------------------------------------------------- drift

describe("retraso y adelanto", () => {
	it("cuenta los días entre lo previsto y lo ocurrido", () => {
		const late = transition("A", "progresion", "2026-09-08", "adaptacion", {
			plannedFor: "2026-09-01",
		});
		const early = transition("B", "progresion", "2026-08-28", "adaptacion", {
			plannedFor: "2026-09-01",
		});

		expect(driftDays(late)).toBe(7);
		expect(driftDays(early)).toBe(-4);
	});

	it("no inventa un retraso cuando no había previsión", () => {
		expect(driftDays(transition("A", "progresion", "2026-09-08"))).toBeNull();
	});
});

// --------------------------------------------------------------- disagreement

describe("discrepancia entre lo guardado y lo derivado", () => {
	const session = (id: string, date: string, phase: string): SessionRecord => ({
		id,
		date,
		templateId: "full_body_a",
		phase,
		completed: true,
		notes: null,
		startedAt: null,
		endedAt: null,
		skippedExerciseIds: [],
		extraExerciseIds: [],
	});

	it("no encuentra ninguna cuando el log coincide con lo estampado", () => {
		const sessions = [session("s1", "2026-09-01", "progresion")];
		expect(
			sessionsDisagreeingWithPhase(PROGRAM, PHASE_EVENTS, sessions),
		).toEqual([]);
	});

	/**
	 * Corregir un evento mueve la fase derivada del pasado — eso es correcto. Lo
	 * que no puede hacer es tocar la sesión, y por eso aparece aquí en vez de
	 * arreglarse sola.
	 */
	it("la señala cuando una corrección mueve la fase derivada", () => {
		const sessions = [session("s1", "2026-09-01", "progresion")];
		const corrected = [
			...PHASE_EVENTS,
			correction(
				"fix",
				"seed-phase-progresion",
				"progresion",
				"2026-09-15",
				"adaptacion",
			),
		];

		const disagreements = sessionsDisagreeingWithPhase(
			PROGRAM,
			corrected,
			sessions,
		);

		expect(disagreements).toHaveLength(1);
		expect(disagreements[0]).toMatchObject({
			stored: "progresion",
			derived: "adaptacion",
		});
		// Y la sesión sigue diciendo lo que decía: nadie la ha tocado.
		expect(sessions[0].phase).toBe("progresion");
	});
});

// ----------------------------------------------------------------- projection

describe("proyección", () => {
	/** Un programa de dos fases: una rodante y una anclada a una fecha externa. */
	function twoPhases(policy: "rolling" | "anchored"): Program {
		const base = PROGRAM.phases[0];
		const phases: Phase[] = [
			{
				...base,
				id: "fase_a",
				order: 1,
				legacyId: 1,
				plannedStart: "2026-01-01",
				plannedEnd: "2026-02-01",
				schedulePolicy: "rolling",
			},
			{
				...base,
				id: "fase_b",
				order: 2,
				legacyId: 2,
				plannedStart: "2026-02-01",
				plannedEnd: "2026-03-01",
				schedulePolicy: policy,
			},
		];
		return { ...PROGRAM, phases };
	}

	it("una fase rodante se desplaza cuando la anterior se alarga", () => {
		const program = twoPhases("rolling");
		// Entró en fase_a dos semanas tarde.
		const events = [transition("A", "fase_a", "2026-01-15")];

		const projection = projectPhases(program, events, "2026-01-20");
		const next = projection.phases.find((p) => p.phaseId === "fase_b");

		expect(next?.start).toBe("2026-02-15");
	});

	it("una fase anclada no se mueve, y lo que se comprime se reporta", () => {
		const program = twoPhases("anchored");
		const events = [transition("A", "fase_a", "2026-01-15")];

		const projection = projectPhases(program, events, "2026-01-20");
		const next = projection.phases.find((p) => p.phaseId === "fase_b");

		expect(next?.start).toBe("2026-02-01");
		expect(projection.compressed).toContainEqual({
			phaseId: "fase_a",
			plannedDays: 31,
			projectedDays: 17,
		});
	});

	it("nunca produce un intervalo negativo", () => {
		const program = twoPhases("anchored");
		// Tan tarde que el ancla ya pasó.
		const events = [transition("A", "fase_a", "2026-02-20")];

		const projection = projectPhases(program, events, "2026-02-25");
		for (const entry of projection.compressed) {
			expect(entry.projectedDays).toBeGreaterThanOrEqual(0);
		}
	});

	/**
	 * La línea que no se cruza: una fecha planificada que venció no es un hecho.
	 * Si la proyección la diera por empezada, tendríamos otra vez el defecto que E2
	 * vino a arreglar, escondido en la pantalla del calendario.
	 */
	it("un ancla vencida sin evento real se reporta, no se da por empezada", () => {
		const program = twoPhases("anchored");
		const events = [transition("A", "fase_a", "2026-01-01")];

		const projection = projectPhases(program, events, "2026-02-13");

		expect(projection.missedAnchors).toEqual([
			{ phaseId: "fase_b", plannedStart: "2026-02-01", overdueDays: 12 },
		]);

		// Y lo que importa tanto como el reporte: no se ha inventado la transición.
		expect(phaseForDate(program, events, "2026-02-13").id).toBe("fase_a");
		// La fase anclada aparece en la proyección como algo que viene, no como
		// algo que empezó: su inicio no queda por detrás de hoy.
		const anchored = projection.phases.find((p) => p.phaseId === "fase_b");
		expect(anchored?.start).toBe("2026-02-01");
		expect(
			events.some((e) => "toPhaseId" in e && e.toPhaseId === "fase_b"),
		).toBe(false);
	});

	it("un ancla que ya se cumplió no aparece como perdida", () => {
		const program = twoPhases("anchored");
		const events = [
			transition("A", "fase_a", "2026-01-01"),
			transition("B", "fase_b", "2026-02-01", "fase_a"),
		];

		expect(projectPhases(program, events, "2026-02-13").missedAnchors).toEqual(
			[],
		);
	});
});
