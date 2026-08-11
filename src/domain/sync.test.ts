import { describe, expect, it } from "vitest";
import {
	changedSince,
	checkSchemaVersion,
	clientVersionOf,
	highWaterMark,
	mergeRecords,
	takeTurn,
	visible,
} from "./sync";

type Row = {
	id: string;
	updatedAt: number;
	deletedAt: number | null;
	value?: string;
};

const row = (id: string, updatedAt: number, extra: Partial<Row> = {}): Row => ({
	id,
	updatedAt,
	deletedAt: null,
	...extra,
});

describe("mergeRecords", () => {
	it("keeps the newer copy of a record edited on both devices", () => {
		const local = [row("a", 100, { value: "laptop" })];
		const incoming = [row("a", 200, { value: "phone" })];

		const { merged, toApply } = mergeRecords(local, incoming);
		expect(merged).toEqual([row("a", 200, { value: "phone" })]);
		expect(toApply).toHaveLength(1);
	});

	it("keeps the local copy when it is newer, and marks it to push", () => {
		const local = [row("a", 300, { value: "laptop" })];
		const incoming = [row("a", 200, { value: "phone" })];

		const { merged, toApply, toPush } = mergeRecords(local, incoming);
		expect(merged[0].value).toBe("laptop");
		expect(toApply).toHaveLength(0);
		expect(toPush).toHaveLength(1);
	});

	it("takes records that exist on only one side", () => {
		const { merged, toApply, toPush } = mergeRecords(
			[row("a", 100)],
			[row("b", 100)],
		);
		expect(merged.map((r) => r.id).sort()).toEqual(["a", "b"]);
		expect(toApply.map((r) => r.id)).toEqual(["b"]);
		expect(toPush.map((r) => r.id)).toEqual(["a"]);
	});

	it("carries a deletion across, rather than resurrecting the row", () => {
		// The phone deleted a set the laptop still has a live copy of.
		const local = [row("a", 100, { value: "sigue viva" })];
		const incoming = [row("a", 200, { deletedAt: 200 })];

		const { merged, toApply } = mergeRecords(local, incoming);
		expect(merged[0].deletedAt).toBe(200);
		expect(toApply).toHaveLength(1);
		expect(visible(merged)).toEqual([]);
	});

	it("does not undelete when the deletion is the newer write", () => {
		const local = [row("a", 300, { deletedAt: 300 })];
		const incoming = [row("a", 100, { value: "copia vieja" })];

		const { merged } = mergeRecords(local, incoming);
		expect(merged[0].deletedAt).toBe(300);
	});

	it("resurrects a row that was re-created after the delete", () => {
		const local = [row("a", 100, { deletedAt: 100 })];
		const incoming = [row("a", 400, { value: "vuelta a crear" })];

		const { merged } = mergeRecords(local, incoming);
		expect(merged[0].deletedAt).toBeNull();
		expect(visible(merged)).toHaveLength(1);
	});

	it("gives ties to the incoming copy, which is the same write echoed back", () => {
		const local = [row("a", 100, { value: "local" })];
		const incoming = [row("a", 100, { value: "remoto" })];

		const { merged, toApply } = mergeRecords(local, incoming);
		expect(merged[0].value).toBe("remoto");
		// Nothing actually changed, so nothing needs writing.
		expect(toApply).toHaveLength(0);
	});

	it("is idempotent — syncing twice changes nothing the second time", () => {
		const local = [row("a", 100), row("b", 200)];
		const incoming = [row("b", 300), row("c", 400)];

		const first = mergeRecords(local, incoming);
		const second = mergeRecords(first.merged, incoming);

		expect(sorted(second.merged)).toEqual(sorted(first.merged));
		expect(second.toApply).toHaveLength(0);
	});

	it("handles both sides being empty", () => {
		expect(mergeRecords([], [])).toEqual({
			merged: [],
			toApply: [],
			toPush: [],
		});
	});
});

describe("changedSince", () => {
	it("returns only what moved after the mark", () => {
		const records = [row("a", 100), row("b", 200), row("c", 300)];
		expect(changedSince(records, 150).map((r) => r.id)).toEqual(["b", "c"]);
	});

	it("returns everything from zero", () => {
		expect(changedSince([row("a", 1)], 0)).toHaveLength(1);
	});
});

describe("highWaterMark", () => {
	it("is the newest timestamp present", () => {
		expect(highWaterMark([row("a", 100), row("b", 900), row("c", 300)])).toBe(
			900,
		);
	});

	it("never goes backwards", () => {
		expect(highWaterMark([row("a", 100)], 500)).toBe(500);
	});

	it("survives an empty sync", () => {
		expect(highWaterMark([], 42)).toBe(42);
	});
});

describe("visible", () => {
	it("hides deleted records without dropping them from the data", () => {
		const records = [row("a", 1), row("b", 2, { deletedAt: 2 })];
		expect(visible(records).map((r) => r.id)).toEqual(["a"]);
		expect(records).toHaveLength(2);
	});
});

function sorted(rows: readonly Row[]): Row[] {
	return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}

describe("compatibilidad de esquema", () => {
	it("deja pasar a un cliente al día", () => {
		expect(checkSchemaVersion(2, 2)).toEqual({ ok: true });
	});

	it("deja pasar a un cliente por delante, y el servidor sube", () => {
		expect(checkSchemaVersion(2, 1)).toEqual({
			ok: false,
			reason: "server-outdated",
			clientVersion: 2,
		});
	});

	/**
	 * El caso que motiva todo esto: un cliente de E1 contra datos de E2. Escribir
	 * ahí valores que esa versión no sabe leer daña el historial; no sincronizar
	 * unos días sólo molesta.
	 */
	it("rechaza a un cliente que no sabe leer lo que hay guardado", () => {
		expect(checkSchemaVersion(1, 2)).toEqual({
			ok: false,
			reason: "client-outdated",
			required: 2,
		});
	});

	it("un cliente sin versión es un cliente anterior a las versiones", () => {
		expect(clientVersionOf({})).toBe(1);
		expect(clientVersionOf({ schemaVersion: 2 })).toBe(2);
		expect(clientVersionOf({ schemaVersion: "dos" })).toBe(1);
	});

	it("un cliente de E1 contra un servidor de E2 no pasa en ninguna dirección", () => {
		const verdict = checkSchemaVersion(clientVersionOf({}), 2);
		expect(verdict.ok).toBe(false);
		// Ni sube ni baja: el endpoint responde antes de leer o escribir nada.
		expect(verdict).toMatchObject({ reason: "client-outdated" });
	});
});

/**
 * The property the transaction exists for: once a schema-2 client has raised the
 * server, no schema-1 write can get in behind it.
 *
 * The endpoint takes `sync_meta` `for update` inside the same transaction as the
 * write, so two requests take turns rather than interleaving. What that turns the
 * question into is an ordering one — and ordering is what this checks, for every
 * order the lock could grant.
 *
 * What it does not check is that Postgres honours the lock. That needs a live
 * database; the structural test in `e2-invariants.test.ts` checks the mechanism
 * is in place, and this checks the rule it enforces.
 */
describe("un cliente antiguo no escribe después del upgrade", () => {
	/** Runs turns in sequence, threading the server version through. */
	function serialise(clientVersions: number[], from = 1) {
		let serverVersion = from;
		return clientVersions.map((client) => {
			const turn = takeTurn(client, serverVersion);
			serverVersion = turn.serverVersion;
			return { client, ...turn };
		});
	}

	it("el schema 2 sube el servidor y el schema 1 que venía detrás es rechazado", () => {
		const [first, second] = serialise([2, 1]);

		expect(first).toMatchObject({ admitted: true, serverVersion: 2 });
		expect(second).toMatchObject({ admitted: false, required: 2 });
	});

	it("si el schema 1 llega primero, escribe legítimamente y el 2 sube después", () => {
		const [first, second] = serialise([1, 2]);

		// Escribió cuando el servidor todavía era 1: correcto, no hay upgrade aún.
		expect(first).toMatchObject({ admitted: true, serverVersion: 1 });
		expect(second).toMatchObject({ admitted: true, serverVersion: 2 });
	});

	it("ningún orden deja pasar un schema 1 después de que el servidor sea 2", () => {
		// Todas las permutaciones de tres peticiones sobre dos versiones.
		const orders = [
			[1, 1, 2],
			[1, 2, 1],
			[2, 1, 1],
			[2, 2, 1],
			[1, 2, 2],
			[2, 1, 2],
		];

		for (const order of orders) {
			let serverVersion = 1;
			for (const client of order) {
				const upgraded = serverVersion === 2;
				const turn = takeTurn(client, serverVersion);

				if (upgraded && client === 1) {
					expect(turn.admitted, `orden ${order.join(",")}`).toBe(false);
				}
				serverVersion = turn.serverVersion;
			}
		}
	});

	it("un cliente rechazado no mueve la versión del servidor", () => {
		const turn = takeTurn(1, 2);
		expect(turn.admitted).toBe(false);
		expect(turn.serverVersion).toBe(2);
	});
});
