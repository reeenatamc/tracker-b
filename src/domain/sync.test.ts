import { describe, expect, it } from "vitest";
import {
	changedSince,
	checkSchemaVersion,
	classifyFailure,
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

// ------------------------------------------------------------------ 3 → 4

/**
 * El salto que trae E4, con las mismas cuatro propiedades que se verificaron
 * para 2 → 3.
 *
 * La compuerta no se rediseña: se ejercita. Una compuerta que sólo se ha probado
 * para el salto anterior es una compuerta que no se ha probado — y ésta es la
 * única cosa entre un cliente de E3 y una fila `ProgramVersion` que no sabe leer.
 */
describe("el salto de esquema 3 → 4", () => {
	function serialise(clientVersions: number[], from = 3) {
		let serverVersion = from;
		return clientVersions.map((client) => {
			const before = serverVersion;
			const turn = takeTurn(client, serverVersion);
			serverVersion = turn.serverVersion;
			// «Subió» no es un campo del turno: es que el servidor quedó más alto
			// que como estaba. Derivarlo evita inventar API para la prueba.
			return { client, subio: turn.serverVersion > before, ...turn };
		});
	}

	/** 1 · un cliente 3 contra un servidor 4 no lee ni escribe. */
	it("un cliente 3 contra un servidor 4 es rechazado", () => {
		expect(checkSchemaVersion(3, 4)).toEqual({
			ok: false,
			reason: "client-outdated",
			required: 4,
		});
	});

	it("y el rechazo llega antes de tocar nada: no admitido", () => {
		const [turn] = serialise([3], 4);
		expect(turn).toMatchObject({ admitted: false, required: 4 });
	});

	/** 2 · el upgrade es atómico: de dos clientes 4, sólo uno sube el servidor. */
	it("dos clientes 4 contra un servidor 3: sólo uno hace el upgrade", () => {
		const turns = serialise([4, 4], 3);

		expect(turns.every((turn) => turn.admitted)).toBe(true);
		expect(turns.filter((turn) => turn.subio)).toHaveLength(1);
		expect(turns.at(-1)?.serverVersion).toBe(4);
	});

	/** 3 · después del upgrade no entra una escritura de 3, llegue cuando llegue. */
	it("tras el upgrade, ningún cliente 3 entra en ningún orden", () => {
		const orders = [
			[3, 3, 4],
			[3, 4, 3],
			[4, 3, 3],
			[4, 4, 3],
			[3, 4, 4],
			[4, 3, 4],
		];

		for (const order of orders) {
			let serverVersion = 3;
			for (const client of order) {
				const upgraded = serverVersion === 4;
				const turn = takeTurn(client, serverVersion);

				if (upgraded && client === 3) {
					expect(turn.admitted, `orden ${order.join(",")}`).toBe(false);
				}
				serverVersion = turn.serverVersion;
			}
		}
	});

	/** 4 · un rechazado no mueve la versión del servidor. */
	it("un cliente rechazado deja el servidor donde estaba", () => {
		const turn = takeTurn(3, 4);
		expect(turn.admitted).toBe(false);
		expect(turn.serverVersion).toBe(4);
	});

	it("y uno más nuevo todavía tampoco lo rompe: sube y ya", () => {
		const [turn] = serialise([5], 4);
		expect(turn).toMatchObject({ admitted: true, serverVersion: 5 });
	});

	/**
	 * La constante local es lo que un cliente dice de sí mismo, no lo que el
	 * servidor guarda. Bajarla en el cliente no baja `sync_meta` — ver §9 de
	 * `docs/E4-versiones.md`, que describe el procedimiento en vez de prometer un
	 * downgrade que no existe.
	 */
	it("volver a la constante 3 no baja el servidor: sigue en 4 y devuelve 409", () => {
		let serverVersion = 3;
		serverVersion = takeTurn(4, serverVersion).serverVersion;
		expect(serverVersion).toBe(4);

		const vuelta = takeTurn(3, serverVersion);
		expect(vuelta).toMatchObject({ admitted: false, required: 4 });
		expect(vuelta.serverVersion).toBe(4);
	});
});

// ------------------------------------------------- T-006 · quién decide el qué

/**
 * El status decide la semántica; el cuerpo sólo la explica.
 *
 * Antes era al revés: la respuesta se convertía en `Error(texto)` en cuanto
 * fallaba, y más tarde se clasificaba buscando `"404"` **dentro del mensaje**.
 * Funcionaba de casualidad —porque el servidor de desarrollo contesta 404 con
 * HTML y el mensaje acababa diciendo «El servidor respondió 404»— y se rompía en
 * cuanto el cuerpo traía JSON, que es lo que hace un servidor de verdad.
 *
 * Las dos pruebas inversas son las que importan: demuestran que el texto ya no
 * puede cambiar la clasificación, en ninguna de las dos direcciones.
 */
describe("clasificar un intercambio fallido", () => {
	const conStatus = (status: number) =>
		classifyFailure({ status, online: true }).kind;

	it("404 es que aquí no hay endpoint, y eso no es un fallo", () => {
		expect(conStatus(404)).toBe("unconfigured");
	});

	it("409 es la compuerta de esquema", () => {
		expect(conStatus(409)).toBe("outdated");
	});

	it("un servidor roto es un error, nunca «solo en este dispositivo»", () => {
		for (const status of [500, 502, 503, 504]) {
			expect(conStatus(status), String(status)).toBe("error");
		}
	});

	it("y lo mismo para lo inesperado", () => {
		for (const status of [400, 401, 403, 418, 429]) {
			expect(conStatus(status), String(status)).toBe("error");
		}
	});

	/** Sin respuesta no hubo 404: no contestó nadie. */
	it("un fetch rechazado estando conectada es un error", () => {
		expect(classifyFailure({ status: null, online: true }).kind).toBe("error");
	});

	it("y sin conexión es estar sin conexión", () => {
		expect(classifyFailure({ status: null, online: false }).kind).toBe(
			"offline",
		);
	});

	/**
	 * La prueba inversa, en sus dos direcciones. El mensaje ya no entra en la
	 * decisión, así que ni un 500 que hable de 404 ni un 404 mudo pueden mentir.
	 */
	it("un 500 no se vuelve local por mencionar un 404", () => {
		expect(conStatus(500)).toBe("error");
	});

	it("y un 404 lo es aunque su cuerpo no diga nada", () => {
		expect(conStatus(404)).toBe("unconfigured");
	});

	it("estar conectada no cambia lo que dijo el servidor", () => {
		for (const status of [404, 409, 500]) {
			expect(
				classifyFailure({ status, online: false }).kind,
				String(status),
			).toBe(classifyFailure({ status, online: true }).kind);
		}
	});
});
