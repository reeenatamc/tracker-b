/**
 * Migrating stored sessions onto named phases — the first stage that rewrites a
 * field every session already carries, which is why it gets this much testing.
 *
 * The one that matters most is the exhaustive date equivalence: for every day the
 * program touches, the phase derived from the seeded event log has to be the phase
 * the old date-range code returned. Not a sample. That is what backs G1, and the
 * old implementation is written out here so the comparison is against what the
 * app actually did rather than against what anyone remembers it doing.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { Collections } from "@/db/collections";
import { PROGRAM } from "@/domain/__fixtures__/program";
import { addDays, phaseForDate } from "@/domain/phase-events";
import type { PhaseEvent, Program } from "@/domain/schema";
import {
	migratePhaseIds,
	normalizeIncoming,
	sessionsWithLegacyPhase,
} from "@/lib/migrate-phase-ids";

// ---------------------------------------------------------------- in-memory db

type Row = Record<string, unknown> & { id: string };

function makeCollection(rows: Row[] = []) {
	const byId = new Map(rows.map((row) => [row.id, { ...row }]));
	return {
		get toArray() {
			return [...byId.values()];
		},
		has: (id: string) => byId.has(id),
		insert: (value: Row) => byId.set(value.id, { ...value }),
		update: (id: string, mutate: (draft: Row) => void) => {
			const draft = { ...(byId.get(id) as Row) };
			mutate(draft);
			byId.set(id, draft);
		},
	};
}

function makeCollections(sessions: Row[] = [], phaseEvents: Row[] = []) {
	const raw = {
		sessions: makeCollection(sessions),
		phaseEvents: makeCollection(phaseEvents),
	};
	return { raw, ...raw } as unknown as Collections;
}

const session = (id: string, date: string, phase: unknown): Row => ({
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

// ------------------------------------------------- the implementation E2 replaced

/**
 * `phaseForDate` as it was before E2: a scan of the phases' own date ranges,
 * clamped at both ends. Kept here verbatim so the equivalence check compares
 * against the real previous behaviour.
 */
function phaseForDateBeforeE2(program: Program, date: string): number {
	const phases = [...program.phases].sort((a, b) =>
		(a.plannedStart ?? "").localeCompare(b.plannedStart ?? ""),
	);
	const first = phases[0];
	const last = phases[phases.length - 1];

	if (date < (first.plannedStart ?? "")) return first.legacyId as number;

	for (const phase of phases) {
		const startsBy = (phase.plannedStart ?? "") <= date;
		const endsAfter = phase.plannedEnd === null || date <= phase.plannedEnd;
		if (startsBy && endsAfter) return phase.legacyId as number;
	}

	return last.legacyId as number;
}

// ------------------------------------------------------------------------ tests

let collections: Collections;

beforeEach(() => {
	collections = makeCollections();
});

describe("G1 · la fase de toda fecha pasada no cambia", () => {
	it("coincide con la implementación anterior, día a día", () => {
		migratePhaseIds(collections, PROGRAM);
		const events = collections.raw.phaseEvents
			.toArray as unknown as PhaseEvent[];

		const byLegacy = new Map(
			PROGRAM.phases.map((phase) => [phase.id, phase.legacyId]),
		);

		// Desde el arranque del programa hasta dos años después. Sin muestreo.
		let date = PROGRAM.meta.startDate;
		const end = addDays(date, 730);
		const mismatches: string[] = [];

		while (date <= end) {
			const before = phaseForDateBeforeE2(PROGRAM, date);
			const after = byLegacy.get(phaseForDate(PROGRAM, events, date).id);
			if (before !== after) mismatches.push(`${date}: ${before} ≠ ${after}`);
			date = addDays(date, 1);
		}

		expect(mismatches).toEqual([]);
	});

	it("incluye la sesión base, anterior al inicio de la primera fase", () => {
		migratePhaseIds(collections, PROGRAM);
		const events = collections.raw.phaseEvents
			.toArray as unknown as PhaseEvent[];

		// Dos días antes de que empiece la fase 1, y aun así fase 1.
		expect(phaseForDate(PROGRAM, events, "2026-08-08").id).toBe("adaptacion");
	});
});

describe("migración de las sesiones guardadas", () => {
	it("traduce el número a la fase que lo reclama", () => {
		collections = makeCollections([
			session("s1", "2026-08-10", 1),
			session("s2", "2026-09-01", 2),
			session("s3", "2026-12-01", 4),
		]);

		const report = migratePhaseIds(collections, PROGRAM);

		expect(report.sessionsMigrated).toBe(3);
		expect(collections.raw.sessions.toArray.map((s) => s.phase)).toEqual([
			"adaptacion",
			"progresion",
			"definicion_tesis",
		]);
	});

	it("es idempotente", () => {
		collections = makeCollections([session("s1", "2026-08-10", 1)]);

		migratePhaseIds(collections, PROGRAM);
		const afterFirst = collections.raw.sessions.toArray;
		const second = migratePhaseIds(collections, PROGRAM);

		expect(second.sessionsMigrated).toBe(0);
		expect(second.eventsSeeded).toBe(0);
		expect(collections.raw.sessions.toArray).toEqual(afterFirst);
	});

	/**
	 * Adivinar movería una sesión a una fase en la que nunca estuvo, en silencio.
	 * El inconveniente de arreglarlo a mano es más barato que eso.
	 */
	it("reporta lo que no puede mapear y lo deja intacto", () => {
		collections = makeCollections([session("s1", "2026-08-10", 9)]);

		const report = migratePhaseIds(collections, PROGRAM);

		expect(report.unmapped).toEqual(["9"]);
		expect(collections.raw.sessions.toArray[0].phase).toBe(9);
	});

	it("no toca una sesión que ya tiene fase con nombre", () => {
		collections = makeCollections([session("s1", "2026-08-10", "progresion")]);

		expect(migratePhaseIds(collections, PROGRAM).sessionsMigrated).toBe(0);
		expect(collections.raw.sessions.toArray[0].phase).toBe("progresion");
	});
});

describe("siembra del log", () => {
	it("crea una transición por fase, encadenada", () => {
		migratePhaseIds(collections, PROGRAM);
		const events = collections.raw.phaseEvents
			.toArray as unknown as PhaseEvent[];

		expect(events).toHaveLength(4);
		expect(
			events.map((event) =>
				event.kind === "revocation" ? null : event.toPhaseId,
			),
		).toEqual([
			"adaptacion",
			"progresion",
			"recomposicion",
			"definicion_tesis",
		]);
	});

	it("sembrar dos veces no duplica", () => {
		migratePhaseIds(collections, PROGRAM);
		migratePhaseIds(collections, PROGRAM);
		expect(collections.raw.phaseEvents.toArray).toHaveLength(4);
	});

	it("las marca como venidas del plan, no como decisiones tomadas", () => {
		migratePhaseIds(collections, PROGRAM);
		const events = collections.raw.phaseEvents
			.toArray as unknown as PhaseEvent[];
		for (const event of events) {
			if (event.kind === "revocation") continue;
			expect(event.trigger).toBe("planned");
		}
	});
});

describe("sincronización: nunca una base mixta", () => {
	it("traduce una sesión numérica que llega de otro dispositivo", () => {
		const { rows, normalized } = normalizeIncoming(PROGRAM, "sessions", [
			session("s1", "2026-09-01", 2),
		]);

		expect(normalized).toBe(1);
		expect(rows[0].phase).toBe("progresion");
	});

	it("deja en paz lo que ya viene con nombre", () => {
		const { rows, normalized } = normalizeIncoming(PROGRAM, "sessions", [
			session("s1", "2026-09-01", "progresion"),
		]);

		expect(normalized).toBe(0);
		expect(rows[0].phase).toBe("progresion");
	});

	it("no toca colecciones que no son sesiones", () => {
		const { normalized } = normalizeIncoming(PROGRAM, "sets", [
			{ id: "x", phase: 2 },
		]);
		expect(normalized).toBe(0);
	});

	it("reporta un número que ninguna fase reclama, sin inventarlo", () => {
		const { rows, unmapped } = normalizeIncoming(PROGRAM, "sessions", [
			session("s1", "2026-09-01", 9),
		]);

		expect(unmapped).toEqual(["9"]);
		expect(rows[0].phase).toBe(9);
	});

	/**
	 * El caso real: este dispositivo ya migró, el otro no, y el sync trae lo suyo.
	 * Después de aplicarlo no puede quedar ni una fase numérica.
	 */
	it("dos dispositivos, uno migrado y otro no, convergen sin base mixta", () => {
		collections = makeCollections([session("local", "2026-08-10", 1)]);
		migratePhaseIds(collections, PROGRAM);

		// Llega del dispositivo sin migrar.
		const incoming = normalizeIncoming(PROGRAM, "sessions", [
			session("remota", "2026-09-01", 2),
		]);
		for (const row of incoming.rows) {
			collections.raw.sessions.insert(row as never);
		}

		expect(sessionsWithLegacyPhase(collections)).toEqual([]);
		expect(
			collections.raw.sessions.toArray.map((s) => [s.id, s.phase]),
		).toEqual([
			["local", "adaptacion"],
			["remota", "progresion"],
		]);
	});

	it("y si algo se colara, la migración de arranque lo recoge", () => {
		collections = makeCollections([session("s1", "2026-08-10", 1)]);
		migratePhaseIds(collections, PROGRAM);

		// Simula una fila numérica escrita sin pasar por la normalización.
		collections.raw.sessions.insert(
			session("colada", "2026-09-01", 2) as never,
		);
		expect(sessionsWithLegacyPhase(collections)).toHaveLength(1);

		migratePhaseIds(collections, PROGRAM);
		expect(sessionsWithLegacyPhase(collections)).toEqual([]);
	});
});

describe("las sesiones no se mueven de fase", () => {
	it("corregir una transición no reescribe ninguna sesión", () => {
		collections = makeCollections([session("s1", "2026-09-01", 2)]);
		migratePhaseIds(collections, PROGRAM);

		const before = collections.raw.sessions.toArray.map((s) => s.phase);

		// Una corrección que mueve la fase derivada del 1 de septiembre.
		const correction: PhaseEvent = {
			kind: "correction",
			id: "fix",
			supersedesId: "seed-phase-progresion",
			fromPhaseId: "adaptacion",
			toPhaseId: "progresion",
			occurredOn: "2026-09-15",
			plannedFor: "2026-08-24",
			trigger: "review",
			reason: "Entré dos semanas más tarde.",
			reviewId: null,
			createdAt: Date.parse("2026-09-15T12:00:00Z"),
		};
		collections.raw.phaseEvents.insert(correction as never);

		const events = collections.raw.phaseEvents
			.toArray as unknown as PhaseEvent[];
		expect(phaseForDate(PROGRAM, events, "2026-09-01").id).toBe("adaptacion");

		// La derivada se movió; la guardada no.
		expect(collections.raw.sessions.toArray.map((s) => s.phase)).toEqual(
			before,
		);
		expect(collections.raw.sessions.toArray[0].phase).toBe("progresion");
	});
});
