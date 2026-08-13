/**
 * The phase log: which events still count, in what order, and what they add up to.
 *
 * The whole point of this module is that being in a phase stops being something
 * you deduce from a date range written months ago. If you take two extra weeks to
 * leave a phase, the calendar used to say you had already left. Now a phase change
 * is a thing that happened, recorded when it happened, and the calendar is only a
 * forecast.
 *
 * Two rules carry everything here:
 *
 *   An event is live if no live event references it. Recursive on purpose — it is
 *   what makes revoking a correction restore the thing the correction replaced,
 *   rather than leaving a hole. See `liveEvents`.
 *
 *   Events resolve in `occurredOn → createdAt → id` order. The last key is not
 *   decoration: two devices can stamp the same millisecond and their clocks
 *   disagree anyway, so without a tiebreak that owes nothing to time, the same
 *   database could resolve to different phases on the phone and on the laptop.
 *
 * Nothing here throws. A damaged log still has to answer "what phase am I in"
 * while you are standing between sets; saying so is `validateEvents`' job.
 */

import type {
	Phase,
	PhaseEvent,
	PhaseMoveEvent,
	Program,
	SessionRecord,
} from "./schema";

/** A calendar day, `YYYY-MM-DD`. Compared as text, which sorts chronologically. */
type IsoDate = string;

// ------------------------------------------------------------------- liveness

/** What an event annuls, if anything. At most one, by construction of the type. */
function targetOf(event: PhaseEvent): string | null {
	if (event.kind === "correction") return event.supersedesId;
	if (event.kind === "revocation") return event.revokesId;
	return null;
}

/**
 * The events that still count.
 *
 * An event is dead when a live event annuls it — which alternates along a chain,
 * exactly like an undo stack:
 *
 *   A                              → A live
 *   A ← B (corrects A)             → B live, A dead
 *   A ← B ← C (revokes B)          → A and C live: A is back
 *   A ← B ← C ← D (revokes C)      → B and D live
 *
 * Cycles cannot be resolved, so every event on one is treated as dead — all of
 * them, not whichever the traversal reached first. Losing a corrupt fragment
 * beats hanging, and beats an answer that depends on array order.
 */
/**
 * The ids a query is allowed to see. `null` means "everything present".
 *
 * E4 bounds the phase log the same way E3 bounds the adjustments, and for the
 * same reason: without it, a retroactive correction written in December moves
 * what a version captured in October says, and a version that changes on its own
 * is not a version.
 */
export type PhaseEventCut = { phaseEventIds: readonly string[] } | null;

/**
 * The log narrowed to a cut. **Applied before anything reasons about liveness.**
 *
 * The order is the whole point. Computing liveness over the full log and
 * filtering afterwards lets a correction the version never knew about annul an
 * event it did know about, and the result is a plan nobody ever saw:
 *
 *   cut  = { E1, E2, E3 }        log = { E1, E2, E3, E4 },  E4 corrects E3
 *   bad  → live({E1..E4}) kills E3 → filter → {E1, E2}
 *   good → {E1,E2,E3} → live → E3 stands
 */
export function withinCut(
	events: readonly PhaseEvent[],
	cut: PhaseEventCut,
): readonly PhaseEvent[] {
	if (cut === null) return events;
	const known = new Set(cut.phaseEventIds);
	return events.filter((event) => known.has(event.id));
}

export function liveEvents(
	events: readonly PhaseEvent[],
	cut: PhaseEventCut = null,
): PhaseEvent[] {
	events = withinCut(events, cut);
	const byId = new Map(events.map((event) => [event.id, event]));

	/*
	 * Cycles first, and separately. Resolving them inside the recursion leaves
	 * whichever node the traversal happened to reach first alive, which is the
	 * kind of answer that depends on array order — exactly what the deterministic
	 * ordering elsewhere exists to avoid. So a cycle kills everything on it.
	 */
	const onCycle = new Set<string>();
	for (const event of events) {
		const seen = new Set<string>();
		const path: string[] = [];
		let cursor: string | null = event.id;

		while (cursor !== null && byId.has(cursor)) {
			if (seen.has(cursor)) {
				// Everything from where the loop closes onwards is on the cycle.
				for (const id of path.slice(path.indexOf(cursor))) onCycle.add(id);
				break;
			}
			seen.add(cursor);
			path.push(cursor);
			cursor = targetOf(byId.get(cursor) as PhaseEvent);
		}
	}

	// Who annuls whom. A target can have several annullers; only live ones count.
	const annullers = new Map<string, string[]>();
	for (const event of events) {
		if (onCycle.has(event.id)) continue;
		const target = targetOf(event);
		if (target === null) continue;
		annullers.set(target, [...(annullers.get(target) ?? []), event.id]);
	}

	const decided = new Map<string, boolean>();

	function isLive(id: string): boolean {
		if (onCycle.has(id)) return false;

		const already = decided.get(id);
		if (already !== undefined) return already;

		// Provisional, to break any recursion the cycle pass somehow missed.
		decided.set(id, false);
		const live = (annullers.get(id) ?? [])
			.filter((annuller) => byId.has(annuller))
			.every((annuller) => !isLive(annuller));
		decided.set(id, live);
		return live;
	}

	return events.filter((event) => isLive(event.id));
}

// ------------------------------------------------------------------- ordering

/**
 * Deterministic across devices. `id` is arbitrary but identical on both, which is
 * the only property that matters once the clocks have stopped agreeing.
 */
export function orderEvents<T extends PhaseMoveEvent>(
	events: readonly T[],
): T[] {
	return [...events].sort(
		(a, b) =>
			a.occurredOn.localeCompare(b.occurredOn) ||
			a.createdAt - b.createdAt ||
			a.id.localeCompare(b.id),
	);
}

/** Live events that carry a destination, in resolution order. Revocations do not. */
export function moves(
	events: readonly PhaseEvent[],
	cut: PhaseEventCut = null,
): PhaseMoveEvent[] {
	return orderEvents(
		liveEvents(events, cut).filter(
			(event): event is PhaseMoveEvent => event.kind !== "revocation",
		),
	);
}

// ----------------------------------------------------------------- resolution

/** The phase with the lowest `order`. The floor everything falls back to. */
export function firstPhase(program: Program): Phase {
	return [...program.phases].sort((a, b) => a.order - b.order)[0];
}

export function phaseByIdOrNull(program: Program, id: string): Phase | null {
	return program.phases.find((phase) => phase.id === id) ?? null;
}

/**
 * The phase in force on a date.
 *
 * Every way the log can be damaged has a defined way out, because this is called
 * from the screen you use at the gym:
 *
 *   an event pointing at a phase that no longer exists  → skipped, carry on
 *   every event broken                                  → the first phase
 *   an annulment cycle                                  → the cycle dies, carry on
 *   no events at all                                    → the first phase
 *
 * The last one holds because a program always has at least one phase — the schema
 * requires it. That is what makes "never throws" true rather than merely stated.
 */
export function phaseForDate(
	program: Program,
	events: readonly PhaseEvent[],
	date: IsoDate,
	/** E4. Absent means "everything present", which is exactly E2's behaviour. */
	cut: PhaseEventCut = null,
): Phase {
	let current: Phase | null = null;

	for (const move of moves(events, cut)) {
		if (move.occurredOn > date) break;
		const phase = phaseByIdOrNull(program, move.toPhaseId);
		// A dangling destination is reported by validateEvents, not resolved here.
		if (phase) current = phase;
	}

	return current ?? firstPhase(program);
}

/** When the phase in force on a date began, or null if no event established it. */
export function phaseStartedOn(
	program: Program,
	events: readonly PhaseEvent[],
	date: IsoDate,
	cut: PhaseEventCut = null,
): IsoDate | null {
	let start: IsoDate | null = null;

	for (const move of moves(events, cut)) {
		if (move.occurredOn > date) break;
		if (phaseByIdOrNull(program, move.toPhaseId)) start = move.occurredOn;
	}

	return start;
}

// ---------------------------------------------------------------------- drift

/** Days between what the plan said and what happened. Positive is late. */
export function driftDays(event: PhaseMoveEvent): number | null {
	if (event.plannedFor === null) return null;
	return daysBetween(event.plannedFor, event.occurredOn);
}

// --------------------------------------------------------------- disagreement

export type PhaseDisagreement = {
	session: SessionRecord;
	/** What the session carries. This is the truth for that session. */
	stored: string;
	/** What the log would say today. Correcting an event can move this. */
	derived: string;
};

/**
 * Sessions whose stored phase no longer matches what the log derives.
 *
 * Not a fault, and above all not something to fix automatically. Correcting a
 * transition is allowed to change what the log says about past dates; what it may
 * never do is reach into a session that already happened. So this reports, and
 * re-stamping stays a decision somebody makes one session at a time.
 */
export function sessionsDisagreeingWithPhase(
	program: Program,
	events: readonly PhaseEvent[],
	sessions: readonly SessionRecord[],
): PhaseDisagreement[] {
	return sessions
		.map((session) => ({
			session,
			stored: session.phase,
			derived: phaseForDate(program, events, session.date).id,
		}))
		.filter((row) => row.stored !== row.derived);
}

// ----------------------------------------------------------------- projection

export type ProjectedPhase = {
	phaseId: string;
	start: IsoDate;
	/** Null on the last phase: it runs on. */
	end: IsoDate | null;
};

export type Projection = {
	phases: ProjectedPhase[];
	/** Phases an anchor leaves without room. `projectedDays` never goes below 0. */
	compressed: Array<{
		phaseId: string;
		plannedDays: number;
		projectedDays: number;
	}>;
	/** Anchors that came and went with no event entering their phase. */
	missedAnchors: Array<{
		phaseId: string;
		plannedStart: IsoDate;
		overdueDays: number;
	}>;
};

/**
 * What comes next, and when — if nothing changes.
 *
 * A `rolling` phase moves with the training: run two weeks long and everything
 * behind it shifts two weeks. An `anchored` phase does not move at all, because
 * its date comes from outside — a trip, a deadline. What gives is whatever sits
 * before it, and that squeeze is reported rather than drawn as if it were fine.
 *
 * The line this must not cross: a planned date that has already passed is not a
 * fact. If an anchor is overdue and no event ever entered that phase, it lands in
 * `missedAnchors` — never in `phases` with a start date in the past. History comes
 * from the log and from nowhere else; letting a forecast write the past would be
 * the very defect E2 exists to remove, moved from the YAML into the calendar
 * screen.
 *
 * Never stored. This answers "what is coming", which is not a thing that happened.
 */
export function projectPhases(
	program: Program,
	events: readonly PhaseEvent[],
	today: IsoDate,
): Projection {
	const ordered = [...program.phases]
		.filter((phase) => !phase.retired)
		.sort((a, b) => a.order - b.order);

	const current = phaseForDate(program, events, today);
	const currentStart = phaseStartedOn(program, events, today) ?? today;

	const entered = new Set(
		moves(events)
			.filter((move) => move.occurredOn <= today)
			.map((move) => move.toPhaseId),
	);

	const missedAnchors = ordered
		.filter(
			(phase) =>
				phase.schedulePolicy === "anchored" &&
				phase.plannedStart !== null &&
				phase.plannedStart < today &&
				!entered.has(phase.id),
		)
		.map((phase) => ({
			phaseId: phase.id,
			plannedStart: phase.plannedStart as IsoDate,
			overdueDays: daysBetween(phase.plannedStart as IsoDate, today),
		}));

	// The current phase runs from when it actually started. If it has already run
	// past its planned length, the cursor is today — the future cannot start
	// yesterday.
	const currentIndex = ordered.findIndex((phase) => phase.id === current.id);
	const plannedEnd = addDays(currentStart, plannedDays(current) ?? 0);
	let cursor =
		plannedDays(current) === null || plannedEnd < today ? today : plannedEnd;

	const projected: ProjectedPhase[] = [
		{ phaseId: current.id, start: currentStart, end: null },
	];

	for (const phase of ordered.slice(currentIndex + 1)) {
		const anchored =
			phase.schedulePolicy === "anchored" && phase.plannedStart !== null;
		const start = anchored ? (phase.plannedStart as IsoDate) : cursor;

		projected.push({ phaseId: phase.id, start, end: null });
		cursor = addDays(start, plannedDays(phase) ?? 0);
	}

	// Each phase ends where the next begins; the last one runs on.
	for (let index = 0; index < projected.length - 1; index++) {
		projected[index].end = projected[index + 1].start;
	}

	const compressed = projected.flatMap((entry) => {
		const phase = phaseByIdOrNull(program, entry.phaseId);
		const planned = phase ? plannedDays(phase) : null;
		if (planned === null || entry.end === null) return [];

		// Clamped: an anchor overrun by the phase before it yields zero days, never
		// a negative interval.
		const actual = Math.max(0, daysBetween(entry.start, entry.end));
		return actual < planned
			? [
					{
						phaseId: entry.phaseId,
						plannedDays: planned,
						projectedDays: actual,
					},
				]
			: [];
	});

	return { phases: projected, compressed, missedAnchors };
}

/** How long a phase was meant to last, from its own planned dates. */
export function plannedDays(phase: Phase): number | null {
	if (phase.plannedStart === null || phase.plannedEnd === null) return null;
	return Math.max(0, daysBetween(phase.plannedStart, phase.plannedEnd));
}

// ----------------------------------------------------------------------- dates

export function daysBetween(from: IsoDate, to: IsoDate): number {
	return Math.round(
		(Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
			86_400_000,
	);
}

export function addDays(date: IsoDate, days: number): IsoDate {
	const shifted = new Date(`${date}T12:00:00Z`);
	shifted.setUTCDate(shifted.getUTCDate() + days);
	return shifted.toISOString().slice(0, 10);
}
