/**
 * When a write does not reach the disk, this is where you find out.
 *
 * Deliberately not folded into `SyncStatus`. Sync failing means the other device
 * has not caught up, which is an inconvenience; persistence failing means what you
 * just logged may not exist, which is the one thing this app cannot be quiet
 * about. They read differently because they are different news.
 *
 * It stays until dismissed. A message about a possibly-lost set that fades after
 * three seconds is a message for whoever happened to be looking at the screen, and
 * the whole point is that you were probably looking at the barbell.
 */

import { useEffect, useState } from "react";
import { useCollections } from "@/db/provider";

export function SaveStatus() {
	const collections = useCollections();
	const [failures, setFailures] = useState(0);
	const [dismissed, setDismissed] = useState(0);

	useEffect(() => {
		// Anything that failed before this mounted still counts: the failure may
		// well be why the screen is being looked at.
		setFailures(collections.tracker.failures.length);
		return collections.tracker.onFailure(() => {
			setFailures(collections.tracker.failures.length);
		});
	}, [collections]);

	const unseen = failures - dismissed;
	if (unseen <= 0) return null;

	return (
		<div className="flex items-center gap-3 border-t border-stop/30 bg-stop-soft px-3 py-2">
			<p className="flex-1 text-[0.8125rem] text-stop">
				{unseen === 1
					? "No se pudo guardar un registro. Puede que no esté en tu historial."
					: `No se pudieron guardar ${unseen} registros. Puede que no estén en tu historial.`}{" "}
				Comprueba el historial antes de seguir.
			</p>
			<button
				type="button"
				onClick={() => setDismissed(failures)}
				className="eyebrow shrink-0 text-stop"
			>
				Entendido
			</button>
		</div>
	);
}
