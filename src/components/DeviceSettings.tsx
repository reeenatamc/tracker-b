/**
 * What this device does when you are not looking at it.
 *
 * Sync and reminders are the same idea from two directions — one carries your
 * log to the other device, the other carries the plan back to you — and both are
 * the kind of setting you touch twice a year, so they live behind the status
 * line rather than taking room on a screen you use between sets.
 */

import { useEffect, useState } from "react";
import { Sheet } from "./Sheet";
import { useSync } from "@/db/sync-provider";
import { disablePush, enablePush, type PushState, pushState } from "@/lib/push";
import { type StorageState, storageState } from "@/lib/persist";
import { program } from "@/lib/content";

export function DeviceSettings({ onClose }: { onClose: () => void }) {
	const { state, syncNow } = useSync();
	const [push, setPush] = useState<PushState | null>(null);
	const [storage, setStorage] = useState<StorageState | null>(null);
	const [working, setWorking] = useState(false);

	useEffect(() => {
		void pushState().then(setPush);
		void storageState().then(setStorage);
	}, []);

	async function toggleReminders() {
		if (!push || working) return;
		setWorking(true);
		setPush(
			push.status === "on"
				? await disablePush()
				: await enablePush(program).catch(() => ({
						status: "unconfigured" as const,
					})),
		);
		setWorking(false);
	}

	return (
		<Sheet title="Este dispositivo" onClose={onClose}>
			<div className="space-y-6 px-4 py-5">
				<section>
					<h3 className="text-base font-semibold">Dónde vive tu registro</h3>
					<p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
						{storage ? STORAGE_COPY[storage] : "Comprobando…"}
					</p>
				</section>

				<section className="border-t border-line pt-5">
					<h3 className="text-base font-semibold">Sincronización</h3>
					<p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
						{SYNC_COPY[state.status]}
					</p>
					{state.status !== "unconfigured" ? (
						<button
							type="button"
							onClick={syncNow}
							className="mt-3 h-11 rounded-xl border border-line px-4 text-sm font-semibold text-reserve"
						>
							Sincronizar ahora
						</button>
					) : null}
				</section>

				<section className="border-t border-line pt-5">
					<div className="flex items-baseline justify-between gap-3">
						<h3 className="text-base font-semibold">Recordatorio diario</h3>
						{push?.status === "on" ? (
							<span className="eyebrow text-reserve">Activado</span>
						) : null}
					</div>
					<p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
						{push ? PUSH_COPY[push.status] : "Comprobando…"}
					</p>

					{push && CAN_TOGGLE.has(push.status) ? (
						<button
							type="button"
							onClick={toggleReminders}
							disabled={working}
							className={`mt-3 h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-40 ${
								push.status === "on"
									? "border border-line text-muted"
									: "bg-reserve text-on-accent"
							}`}
						>
							{working
								? "Un momento…"
								: push.status === "on"
									? "Desactivar"
									: "Activar recordatorio"}
						</button>
					) : null}
				</section>
			</div>
		</Sheet>
	);
}

/** The states where there is something the button can actually change. */
const CAN_TOGGLE = new Set(["on", "off", "unconfigured"]);

const STORAGE_COPY: Record<StorageState, string> = {
	persisted:
		"En este dispositivo, marcado como permanente: el navegador no lo borrará para hacer espacio. Aun así, es una sola copia — exporta de vez en cuando desde Historial.",
	"best-effort":
		"En este dispositivo, sin marca de permanente: el navegador podría borrarlo si le falta espacio. Exporta desde Historial para tener una copia fuera.",
	unknown:
		"En este dispositivo. Exporta desde Historial para tener una copia fuera de aquí.",
};

const SYNC_COPY: Record<string, string> = {
	unconfigured:
		"Todo se guarda en este dispositivo. Cuando conectes la base de datos, tu registro viajará entre el celular y la laptop solo.",
	syncing: "Sincronizando…",
	offline:
		"Sin conexión. Se sigue guardando aquí y se envía cuando vuelva la señal.",
	error:
		"Hubo un problema al sincronizar. Se guarda igual en este dispositivo.",
	idle: "Al día con la otra pantalla. Las fotos no viajan: se quedan en el dispositivo que las tomó.",
};

const PUSH_COPY: Record<PushState["status"], string> = {
	on: "Cada mañana te llega qué toca hoy y en qué semana vas.",
	off: "Un aviso por la mañana con el bloque del día. Nada más — el temporizador de descanso ya suena solo.",
	denied:
		"El navegador tiene las notificaciones bloqueadas para esta app. Se activan desde los ajustes del sistema.",
	unsupported:
		"Este navegador no puede recibir avisos. En iPhone hace falta abrir la app desde la pantalla de inicio, no desde Safari.",
	unconfigured:
		"Falta conectar la base de datos y las claves del servidor para que el aviso pueda salir.",
};
