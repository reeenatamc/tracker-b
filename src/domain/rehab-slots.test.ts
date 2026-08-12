/**
 * Rehab slots are slots.
 *
 * They are the one part of the plan that is not seeded: the protocol is indexed
 * by week, not migrated into the baseline, so its rows are built at read time.
 * That is the shape the identity question falls out of — if the id were derived
 * from where the row happened to land, the same drill would be a different slot
 * every fortnight and nothing longitudinal could ever be said about it.
 *
 * It is not. `rehab_<id>` comes from the protocol's own hand-written id, which is
 * under the same rule as every exercise id since E1. These tests hold it there,
 * and check the consequence that makes it worth having: a rehab slot can be
 * adjusted like any other.
 *
 * Read from `content/` when it is there and the public example otherwise, so on
 * this machine this checks the real protocol.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { rehabAsEntry } from "./cardio-day";
import { resolvePrescription } from "./prescription";
import { AnkleProtocol, type PlanAdjustment } from "./schema";

const ROOT = join(import.meta.dirname, "..", "..");
const DIR = existsSync(join(ROOT, "content", "ankle-protocol.yaml"))
	? join(ROOT, "content")
	: join(ROOT, "content.example");

const protocol = AnkleProtocol.parse(
	parse(readFileSync(join(DIR, "ankle-protocol.yaml"), "utf8")),
);
const TEMPLATE = "cardio_ankle";
const PHASE = () => "adaptacion";
const live = (effectiveOn: string) => ({ effectiveOn, knows: null });

const stages = [...new Set(protocol.protocol.map((entry) => entry.stage))];
const inStage = (stage: string) =>
	protocol.protocol.filter((entry) => entry.stage === stage);

/** What one rehab day resolves to, given the stage the calendar has reached. */
const entriesFor = (stage: string) =>
	inStage(stage).map((entry, index) =>
		rehabAsEntry(entry, TEMPLATE, index + 1),
	);

// ------------------------------------------------------------------ identity

describe("el id de un hueco de rehabilitación", () => {
	it("sale del id del protocolo, no de dónde cae la fila", () => {
		for (const entry of protocol.protocol) {
			expect(rehabAsEntry(entry, TEMPLATE, 1).id).toBe(`rehab_${entry.id}`);
		}
	});

	/**
	 * Lo que lo hace longitudinal: reordenar el bloque, o llegar a él en otra
	 * semana, no cambia de quién se está hablando.
	 */
	it("no depende del orden dentro del bloque", () => {
		for (const entry of protocol.protocol) {
			const first = rehabAsEntry(entry, TEMPLATE, 1);
			const last = rehabAsEntry(entry, TEMPLATE, 99);

			expect(last.id).toBe(first.id);
			// Y el orden sí se mueve: es presentación, no identidad.
			expect(last.order).not.toBe(first.order);
		}
	});

	it("ni de la etapa por la que va el calendario", () => {
		const ids = stages.flatMap((stage) =>
			entriesFor(stage).map((entry) => entry.id),
		);
		const rebuilt = stages
			.slice()
			.reverse()
			.flatMap((stage) => entriesFor(stage).map((entry) => entry.id));

		expect(new Set(ids)).toEqual(new Set(rebuilt));
	});

	it("es único en todo el protocolo", () => {
		const ids = protocol.protocol.map((entry) => `rehab_${entry.id}`);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("no se confunde con un hueco sembrado", () => {
		for (const entry of protocol.protocol) {
			expect(rehabAsEntry(entry, TEMPLATE, 1).id).not.toMatch(/^slot_/);
		}
	});

	it("y no menciona nada que pueda cambiar de nombre", () => {
		for (const entry of protocol.protocol) {
			const built = rehabAsEntry(entry, TEMPLATE, 1);
			expect(built.id).not.toContain(entry.name);
			expect(built.id).not.toContain(entry.stage);
		}
	});
});

// --------------------------------------------------------------- adjustable

describe("y por eso puede recibir ajustes", () => {
	const first = protocol.protocol[0];
	const entryId = `rehab_${first.id}`;

	const raise: PlanAdjustment = {
		kind: "set_field",
		id: "adj_rehab",
		entryId,
		change: { field: "sets", value: 4 },
		effectiveOn: "2026-09-01",
		onlyInPhase: null,
		origin: "manual",
		reason: "el tobillo aguanta una serie más",
		evidenceIds: [],
		provenance: { kind: "authored" },
		createdAt: 0,
	};

	const resolve = (adjustments: PlanAdjustment[], date: string) =>
		resolvePrescription(
			entriesFor(first.stage),
			adjustments,
			TEMPLATE,
			live(date),
			PHASE,
		);

	it("un ajuste sobre el hueco se aplica", () => {
		const entry = resolve([raise], "2026-10-01").find((e) => e.id === entryId);
		expect(entry?.sets).toBe(4);
	});

	it("antes de su fecha, no", () => {
		const entry = resolve([raise], "2026-08-01").find((e) => e.id === entryId);
		expect(entry?.sets).toEqual(first.sets);
	});

	it("y sigue aplicándose la semana siguiente, sin volver a decidirlo", () => {
		const later = resolve([raise], "2026-11-15").find((e) => e.id === entryId);
		expect(later?.sets).toBe(4);
	});

	/** Un ajuste que apunta a otro hueco no se cuela por parecerse. */
	it("un ajuste de otro hueco no lo toca", () => {
		const other = { ...raise, id: "adj_otro", entryId: "rehab_no_existe" };
		const entry = resolve([other], "2026-10-01").find((e) => e.id === entryId);
		expect(entry?.sets).toEqual(first.sets);
	});
});

// ----------------------------------------------------------------- the wiring

describe("el ejecutor le pasa el log de ajustes", () => {
	/**
	 * La primera versión resolvía los días de tobillo con `adjustments: []`, así
	 * que el id era estable y aun así inservible. Esto es lo que lo impide.
	 */
	it("los días de tobillo no resuelven con una lista vacía", () => {
		const executor = readFileSync(
			join(import.meta.dirname, "..", "routes", "index.tsx"),
			"utf8",
		);
		const block = executor.slice(
			executor.indexOf("const plan = "),
			executor.indexOf("const livePrescription"),
		);

		expect(block).toContain("adjustments: planAdjustments");
		expect(block).not.toContain("adjustments: []");
	});
});
