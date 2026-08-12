/**
 * Makes the local database available to the tree, and keeps the rest of the app
 * from having to think about the fact that opening it is asynchronous.
 */

import { createContext, type ReactNode, use, useEffect, useState } from "react";
import { program } from "@/lib/content";
import { requestPersistence } from "@/lib/persist";
import { registerServiceWorker } from "@/lib/register-service-worker";
import { bootstrap } from "./bootstrap";
import { type Collections, getCollections } from "./collections";

const CollectionsContext = createContext<Collections | null>(null);

type Status =
	| { state: "loading" }
	| { state: "ready"; collections: Collections }
	| { state: "error"; message: string };

export function CollectionsProvider({ children }: { children: ReactNode }) {
	const [status, setStatus] = useState<Status>({ state: "loading" });

	useEffect(() => {
		registerServiceWorker();
		// Everything is in one browser profile until sync is connected, so the one
		// realistic way this log is lost is the browser reclaiming space.
		void requestPersistence();

		let cancelled = false;

		/*
		 * One chain, fully awaited, with one catch at the end.
		 *
		 * The shape matters as much as the contents: the previous version put the
		 * work in a `.then` whose own failures nothing caught, so a throw inside it
		 * became an unhandled rejection and the screen sat on "Abriendo tu
		 * registro…" for ever, with no error and no way out. There are two endings
		 * here and no third one.
		 */
		(async () => {
			try {
				const collections = await getCollections();
				const report = await bootstrap(collections, program);

				if (
					report.exercises.setsMigrated > 0 ||
					report.phases.sessionsMigrated > 0 ||
					report.seed.revived > 0 ||
					report.seed.removed > 0
				) {
					console.info("Arranque:", report);
				}

				if (!cancelled) setStatus({ state: "ready", collections });
			} catch (error: unknown) {
				if (!cancelled) {
					setStatus({
						state: "error",
						message:
							error instanceof Error
								? error.message
								: "No se pudo abrir la base de datos.",
					});
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	if (status.state === "error") {
		return (
			<div className="mx-auto max-w-md p-6 text-center">
				<p className="text-lg font-semibold text-stop">
					No se pudo abrir tu base de datos
				</p>
				<p className="mt-2 text-sm text-muted">{status.message}</p>
			</div>
		);
	}

	if (status.state === "loading") {
		return (
			<div className="flex min-h-dvh items-center justify-center">
				<p className="animate-pulse text-sm text-faint">
					Abriendo tu registro…
				</p>
			</div>
		);
	}

	return (
		<CollectionsContext value={status.collections}>
			{children}
		</CollectionsContext>
	);
}

export function useCollections(): Collections {
	const collections = use(CollectionsContext);
	if (!collections) {
		throw new Error("useCollections must be used inside <CollectionsProvider>");
	}
	return collections;
}
