/**
 * Makes the local database available to the tree, and keeps the rest of the app
 * from having to think about the fact that opening it is asynchronous.
 */

import { createContext, type ReactNode, use, useEffect, useState } from "react";
import { registerServiceWorker } from "@/lib/register-service-worker";
import { syncSeed } from "@/lib/seed";
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

		let cancelled = false;
		getCollections().then(
			(collections) => {
				// Brings in the baseline session, so the very first workout already has
				// history to progress from.
				syncSeed(collections);
				if (!cancelled) setStatus({ state: "ready", collections });
			},
			(error: unknown) => {
				if (!cancelled) {
					setStatus({
						state: "error",
						message:
							error instanceof Error
								? error.message
								: "No se pudo abrir la base de datos.",
					});
				}
			},
		);
		return () => {
			cancelled = true;
		};
	}, []);

	if (status.state === "error") {
		return (
			<div className="mx-auto max-w-md p-6 text-center">
				<p className="text-lg font-semibold text-rose-300">
					No se pudo abrir tu base de datos
				</p>
				<p className="mt-2 text-sm text-slate-400">{status.message}</p>
			</div>
		);
	}

	if (status.state === "loading") {
		return (
			<div className="flex min-h-dvh items-center justify-center">
				<p className="animate-pulse text-sm text-slate-500">
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
