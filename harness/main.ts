/**
 * T-001 · does a logged set ever fail to survive?
 *
 * One set went missing during the E1 smoke test and four attempts to reproduce it
 * failed. This is the fifth through the two-hundredth: an automated harness that
 * writes through the app's real persistence layer, disrupts the page at varying
 * distances from the write, and then reopens the database and counts.
 *
 * It deliberately does not fix anything. The point is evidence about *which* of
 * four things happens, because they have different causes and three of them are
 * not data loss:
 *
 *   click-not-received      the write was never attempted
 *   started-not-finished    insert() was called but had not returned
 *   stale-view              the row is on disk; the first read after the
 *                           disruption did not show it
 *   write-lost              insert() returned, and the row is not on disk
 *
 * Only the last one is the bug. Telling them apart is why every attempt writes a
 * marker before the write and clears it after, and why a miss is re-read before
 * being called a loss.
 *
 * Runs on its own origin (port 4500), so its OPFS is its own and nothing here can
 * touch the real log.
 */

import { getCollections } from "@/db/collections";

// --------------------------------------------------------------------- plan

type Disruption = "reload" | "navigate" | "none";

type Scenario = {
	name: string;
	/** How long after the write the page is disrupted. */
	delayMs: number;
	disruption: Disruption;
	/** Sets written in one go. */
	writes: number;
	/** Hammer the collection with reads while writing. */
	underLoad?: boolean;
	/** Fire `pagehide` by hand before the disruption. */
	forcePagehide?: boolean;
};

const ITERATIONS = 25;

const SCENARIOS: Scenario[] = [
	// The control. If this ever fails, the harness itself is wrong.
	{ name: "sin interrupción", delayMs: 250, disruption: "reload", writes: 1 },

	// The reported case: save, then leave, at shrinking distances.
	{ name: "guardar → recargar 0 ms", delayMs: 0, disruption: "reload", writes: 1 },
	{ name: "guardar → recargar 5 ms", delayMs: 5, disruption: "reload", writes: 1 },
	{ name: "guardar → recargar 50 ms", delayMs: 50, disruption: "reload", writes: 1 },

	// Navigating away is a different teardown path from reloading.
	{ name: "guardar → navegar 0 ms", delayMs: 0, disruption: "navigate", writes: 1 },
	{ name: "guardar → navegar 5 ms", delayMs: 5, disruption: "navigate", writes: 1 },

	// Two writes in the same tick: the double click.
	{ name: "doble click", delayMs: 0, disruption: "reload", writes: 2 },

	// Ten in a burst: the repeated-tap case.
	{ name: "ráfaga de 10", delayMs: 0, disruption: "reload", writes: 10 },

	// The same burst while something else is reading hard, which is the closest
	// this can get to "sync was running".
	{
		name: "ráfaga bajo carga",
		delayMs: 0,
		disruption: "reload",
		writes: 10,
		underLoad: true,
	},

	/*
	 * `db/collections.ts` releases the OPFS handles on `pagehide`. If a write in
	 * flight can be cut off by that release, this is where it shows.
	 */
	{
		name: "pagehide durante la escritura",
		delayMs: 0,
		disruption: "reload",
		writes: 1,
		forcePagehide: true,
	},
];

// -------------------------------------------------------------------- state

type Outcome =
	| "ok"
	| "click-not-received"
	| "started-not-finished"
	| "stale-view"
	| "write-lost";

type Pending = {
	scenario: number;
	ids: string[];
	/** Set before insert() is called. Absent means the attempt never happened. */
	attemptedAt: number;
	/** Set after every insert() returned. */
	returnedAt: number | null;
	countBefore: number;
};

type State = {
	scenario: number;
	iteration: number;
	pending: Pending | null;
	results: Record<string, number>;
	losses: string[];
	startedAt: number;
};

const KEY = "t001-state";

function load(): State {
	const raw = localStorage.getItem(KEY);
	if (raw) return JSON.parse(raw) as State;
	return {
		scenario: 0,
		iteration: 0,
		pending: null,
		results: {},
		losses: [],
		startedAt: Date.now(),
	};
}

function save(state: State): void {
	localStorage.setItem(KEY, JSON.stringify(state));
}

function record(state: State, scenario: Scenario, outcome: Outcome): void {
	const key = `${scenario.name} · ${outcome}`;
	state.results[key] = (state.results[key] ?? 0) + 1;
}

// ---------------------------------------------------------------------- ui

const out = document.querySelector("#out") as HTMLElement;
const bar = document.querySelector("#bar") as HTMLElement;

function render(state: State, note = ""): void {
	const total = SCENARIOS.length * ITERATIONS;
	const done = state.scenario * ITERATIONS + state.iteration;
	bar.style.width = `${Math.round((done / total) * 100)}%`;

	const lines: string[] = [];
	lines.push(`${done} / ${total} iteraciones`);
	if (state.scenario < SCENARIOS.length) {
		lines.push(`actual: ${SCENARIOS[state.scenario].name}`);
	}
	lines.push("");

	for (const scenario of SCENARIOS) {
		const row = (Object.keys(state.results) as string[])
			.filter((key) => key.startsWith(`${scenario.name} · `))
			.map((key) => `${key.split(" · ")[1]}=${state.results[key]}`)
			.join("  ");
		if (row) lines.push(`${scenario.name.padEnd(30)} ${row}`);
	}

	if (state.losses.length > 0) {
		lines.push("", "PÉRDIDAS:", ...state.losses.slice(0, 20));
	}
	if (note) lines.push("", note);
	out.textContent = lines.join("\n");
}

// ------------------------------------------------------------------- runner

/**
 * A clock Chrome does not throttle.
 *
 * A hidden tab clamps `setTimeout` to about once a minute, which turned a
 * one-second iteration into a hundred — and this harness spends its life hidden,
 * reloading itself. `MessageChannel` is not a timer, so its callbacks keep firing
 * at full speed; spinning on them until the wall clock catches up gives a real
 * delay that survives being in the background.
 *
 * It burns CPU. For delays under a second, in a page whose only job is this, that
 * is the right trade.
 */
function yieldToLoop(): Promise<void> {
	return new Promise((resolve) => {
		const channel = new MessageChannel();
		channel.port1.onmessage = () => resolve();
		channel.port2.postMessage(0);
	});
}

async function sleep(ms: number): Promise<void> {
	const until = performance.now() + ms;
	while (performance.now() < until) await yieldToLoop();
}

async function main(): Promise<void> {
	const state = load();

	(document.querySelector("#reset") as HTMLElement).onclick = () => {
		localStorage.removeItem(KEY);
		location.reload();
	};

	const collections = await getCollections();
	// Give the collection a moment to finish loading from disk before counting.
	await sleep(120);

	const setsOf = () => collections.raw.sets.toArray as Array<{ id: string }>;

	// ── classify whatever the previous page left behind ─────────────────────
	if (state.pending) {
		const pending = state.pending;
		const scenario = SCENARIOS[pending.scenario];
		const present = new Set(setsOf().map((row) => row.id));
		let missing = pending.ids.filter((id) => !present.has(id));

		let outcome: Outcome;
		if (!pending.attemptedAt) {
			outcome = "click-not-received";
		} else if (missing.length === 0) {
			outcome = "ok";
		} else {
			// A miss is not a loss until a second, later read agrees. The first read
			// after a reload can legitimately race the collection's own load.
			await sleep(400);
			const later = new Set(setsOf().map((row) => row.id));
			missing = pending.ids.filter((id) => !later.has(id));

			if (missing.length === 0) outcome = "stale-view";
			else if (pending.returnedAt === null) outcome = "started-not-finished";
			else outcome = "write-lost";
		}

		record(state, scenario, outcome);
		if (outcome === "write-lost" || outcome === "started-not-finished") {
			state.losses.push(
				`${scenario.name} #${state.iteration}: faltan ${missing.length}/${pending.ids.length}` +
					` · esperados ${pending.countBefore + pending.ids.length}` +
					` · persistidos ${setsOf().length}` +
					` · ${outcome}`,
			);
		}

		state.pending = null;
		state.iteration++;
		if (state.iteration >= ITERATIONS) {
			state.iteration = 0;
			state.scenario++;
		}
		save(state);
	}

	// ── done? ───────────────────────────────────────────────────────────────
	if (state.scenario >= SCENARIOS.length) {
		const seconds = Math.round((Date.now() - state.startedAt) / 1000);
		render(
			state,
			`TERMINADO en ${seconds}s · ${setsOf().length} sets en la base.\n` +
				(state.losses.length === 0
					? "Ninguna pérdida. T-001 no reproducido."
					: `${state.losses.length} pérdidas — ver arriba.`),
		);
		(window as unknown as { t001: unknown }).t001 = {
			done: true,
			results: state.results,
			losses: state.losses,
			persisted: setsOf().length,
			seconds,
		};
		return;
	}

	render(state);

	// ── run the next iteration ──────────────────────────────────────────────
	const scenario = SCENARIOS[state.scenario];
	const stamp = `${state.scenario}-${state.iteration}-${Date.now()}`;
	const ids = Array.from(
		{ length: scenario.writes },
		(_, index) => `t001-${stamp}-${index}`,
	);

	const pending: Pending = {
		scenario: state.scenario,
		ids,
		attemptedAt: Date.now(),
		returnedAt: null,
		countBefore: setsOf().length,
	};
	state.pending = pending;
	save(state);

	// Read pressure, to contend with the write.
	let pressure: ReturnType<typeof setInterval> | null = null;
	if (scenario.underLoad) {
		pressure = setInterval(() => void setsOf().length, 0);
	}

	for (const id of ids) {
		collections.sets.insert({
			id,
			sessionId: `t001-session-${state.scenario}`,
			exerciseId: "lat_pulldown",
			setNumber: 1,
			isWarmup: false,
			load: 20,
			unit: "kg",
			reps: 12,
			rir: 2,
			anklePain: null,
			note: null,
		});
	}

	// Every insert() has returned. If the page dies after this and the row is
	// gone, that is the real thing.
	pending.returnedAt = Date.now();
	state.pending = pending;
	save(state);

	if (scenario.delayMs > 0) await sleep(scenario.delayMs);
	if (pressure) clearInterval(pressure);

	if (scenario.forcePagehide) {
		window.dispatchEvent(new Event("pagehide"));
	}

	if (scenario.disruption === "reload") location.reload();
	else if (scenario.disruption === "navigate") location.href = "./index.html";
}

void main().catch((error: unknown) => {
	out.textContent = `harness roto: ${
		error instanceof Error ? error.stack : String(error)
	}`;
});
