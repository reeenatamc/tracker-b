/**
 * What the plan screen promises about versions.
 *
 * There is no DOM here, so these read the source — which is the right instrument
 * for what they check anyway: these are rules about *which* states get shown
 * differently, and about a form that must not let you create something
 * unfixable. Both are shapes, and a shape is what a structural test can hold.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const plan = readFileSync(join(import.meta.dirname, "plan.tsx"), "utf8");

describe("guardar una versión", () => {
	it("pide nombre y motivo, y no deja guardar sin los dos", () => {
		expect(plan).toContain(
			"disabled={name.trim().length === 0 || reason.trim().length === 0}",
		);
	});

	it("avisa de que el nombre es definitivo", () => {
		expect(plan).toContain("El nombre es definitivo");
	});

	/** `cutAt` sale de `today`, así que no hay forma de pedir uno futuro. */
	it("no ofrece elegir una fecha futura", () => {
		expect(plan).toContain("cutAt: today");
	});

	it("pasa las tres precondiciones a la captura", () => {
		for (const precondition of [
			"bootstrapReady:",
			"syncIdle:",
			"pendingWrites:",
		]) {
			expect(plan, precondition).toContain(precondition);
		}
	});

	it("y lee las tres colecciones en una sola función síncrona", () => {
		const read = plan.slice(
			plan.indexOf("read: () => ({"),
			plan.indexOf("}),\n\t\t\tcutAt"),
		);
		expect(read).not.toContain("await");
		expect(read).toContain("planAdjustments");
		expect(read).toContain("phaseEvents");
		expect(read).toContain("prescriptionBaseline");
	});

	it("dice la causa concreta cuando se niega, las cinco", () => {
		for (const kind of [
			"not-ready",
			"sync-in-flight",
			"writes-pending",
			"dangling",
			"future-cut",
		]) {
			expect(plan, kind).toContain(`case "${kind}":`);
		}
	});
});

describe("las tres formas de mostrar una versión recibida", () => {
	it("resuelta se muestra sin aviso", () => {
		expect(plan).toContain('if (result.kind === "resolved") setState(null);');
	});

	it("incompleta invita a sincronizar", () => {
		const block = plan.slice(
			plan.indexOf('result.kind === "incomplete"'),
			plan.indexOf("} else setState("),
		);
		expect(block).toContain("Sincroniza");
	});

	/**
	 * Y la inválida **no**. Es la distinción que costó introducir: decirle a
	 * alguien que sincronice cuando el problema es que la frontera no se sostiene
	 * es un consejo que no funciona nunca.
	 */
	it("inválida no sugiere sincronizar", () => {
		const block = plan.slice(plan.indexOf("} else setState("));
		const line = block.slice(0, block.indexOf(";"));
		expect(line).toContain("no cuadra");
		expect(line).not.toContain("Sincroniza");
	});
});

describe("la comparación", () => {
	it("no se calcula si alguna de las dos no resuelve", () => {
		expect(plan).toContain(
			'if (a.kind !== "resolved" || b.kind !== "resolved")',
		);
	});

	it("muestra las cuatro categorías", () => {
		for (const kind of ["added", "removed", "replaced", "changed"]) {
			expect(plan, kind).toContain(`${kind}:`);
		}
	});

	it("el volumen, y sólo el estructural", () => {
		expect(plan).toContain("Series planificadas");
		expect(plan).not.toContain("byMuscle");
	});

	it("y la causa de cada cambio", () => {
		expect(plan).toContain("describeCause(cause)");
		for (const kind of ["adjustment", "revocation", "phase", "unexplained"]) {
			expect(plan, kind).toContain(`case "${kind}":`);
		}
	});

	/** Sin causa no es una fila normal: se dice que es un fallo. */
	it("lo no atribuible se señala como fallo, no como cambio", () => {
		expect(plan).toContain("sin explicación");
		expect(plan).toContain("Eso es un\n\t\t\t\t\t\t\tfallo");
	});
});

describe("lo que la pantalla no hace", () => {
	it("no renombra ni retira", () => {
		for (const forbidden of ["rename", "retire", "Renombrar", "Retirar"]) {
			expect(plan, forbidden).not.toContain(forbidden);
		}
	});
});
