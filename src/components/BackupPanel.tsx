/**
 * Export and restore everything.
 *
 * Until sync exists this is the only copy that survives a lost phone or a
 * cleared browser. It stays useful afterwards: it is how a device that logged
 * before sync existed hands its history over.
 */

import { useRef, useState } from "react";
import { useCollections } from "@/db/provider";
import {
	type BackupSummary,
	downloadBlob,
	exportBackup,
	importBackup,
} from "@/lib/backup";
import { formatBytes } from "@/lib/photos";
import { todayIso } from "@/lib/format";

type Status =
	| { state: "idle" }
	| { state: "busy"; what: "export" | "import" }
	| { state: "done"; what: "export" | "import"; summary: BackupSummary }
	| { state: "error"; message: string };

export function BackupPanel() {
	const collections = useCollections();
	const fileInput = useRef<HTMLInputElement>(null);
	const [status, setStatus] = useState<Status>({ state: "idle" });

	async function run(
		what: "export" | "import",
		action: () => Promise<BackupSummary>,
	) {
		setStatus({ state: "busy", what });
		try {
			setStatus({ state: "done", what, summary: await action() });
		} catch (cause) {
			setStatus({
				state: "error",
				message: cause instanceof Error ? cause.message : "Algo salió mal.",
			});
		}
	}

	const busy = status.state === "busy";

	return (
		<section className="card">
			<p className="eyebrow mb-1">Respaldo</p>
			<p className="mb-4 text-[0.8125rem] text-faint">
				Todo vive solo en este dispositivo. Guarda una copia donde quieras — es
				lo único que sobrevive a un celular perdido o a un navegador borrado.
			</p>

			<div className="flex gap-3">
				<button
					type="button"
					disabled={busy}
					onClick={() =>
						run("export", async () => {
							const { blob, filename, summary } = await exportBackup(
								collections,
								todayIso(),
							);
							downloadBlob(blob, filename);
							return summary;
						})
					}
					className="h-12 flex-1 rounded-lg bg-reserve text-sm font-semibold text-on-accent disabled:opacity-50"
				>
					{busy && status.what === "export"
						? "Preparando…"
						: "Descargar respaldo"}
				</button>

				<button
					type="button"
					disabled={busy}
					onClick={() => fileInput.current?.click()}
					className="h-12 flex-1 rounded-lg border border-line text-sm text-muted disabled:opacity-50"
				>
					{busy && status.what === "import" ? "Restaurando…" : "Restaurar"}
				</button>
			</div>

			<input
				ref={fileInput}
				type="file"
				accept="application/json,.json"
				className="sr-only"
				onChange={(event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (file) run("import", () => importBackup(collections, file));
				}}
			/>

			{status.state === "done" ? (
				<p className="mt-3 text-[0.8125rem] text-reserve">
					{status.what === "export" ? "Respaldo listo: " : "Restaurado: "}
					<span className="tabular">
						{status.summary.sessions} sesiones · {status.summary.sets} series ·{" "}
						{status.summary.photos} fotos · {formatBytes(status.summary.bytes)}
					</span>
				</p>
			) : null}

			{status.state === "error" ? (
				<p className="mt-3 text-[0.8125rem] text-stop">{status.message}</p>
			) : null}

			<p className="mt-3 text-[0.6875rem] text-faint">
				Restaurar no borra nada: combina por registro, así que importar el mismo
				archivo dos veces es inofensivo y uno viejo nunca se lleva lo que
				registraste después.
			</p>
		</section>
	);
}
