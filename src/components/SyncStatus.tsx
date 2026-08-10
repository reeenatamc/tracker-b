/**
 * A one-line report of whether the other device has seen this yet.
 *
 * Offline is not an error state here and is not styled like one — the whole app
 * is built to work without a connection, so "sin conexión" is a normal Tuesday
 * at the gym, not a problem to solve.
 */

import { useSync } from "@/db/sync-provider";

export function SyncStatus() {
	const { state, syncNow } = useSync();

	const label =
		state.status === "unconfigured"
			? "Solo en este dispositivo"
			: state.status === "syncing"
				? "Sincronizando…"
				: state.status === "offline"
					? "Sin conexión · se guarda aquí"
					: state.status === "error"
						? state.message
						: state.lastSyncedAt
							? `Sincronizado ${timeAgo(state.lastSyncedAt)}`
							: "Sin sincronizar todavía";

	const tone = state.status === "error" ? "text-stop" : "text-faint";

	return (
		<button
			type="button"
			onClick={syncNow}
			className={`eyebrow w-full px-4 py-2 text-left ${tone}`}
		>
			{label}
		</button>
	);
}

function timeAgo(timestamp: number): string {
	const seconds = Math.round((Date.now() - timestamp) / 1000);
	if (seconds < 60) return "hace un momento";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `hace ${minutes} min`;
	const hours = Math.round(minutes / 60);
	return hours < 24 ? `hace ${hours} h` : `hace ${Math.round(hours / 24)} d`;
}
