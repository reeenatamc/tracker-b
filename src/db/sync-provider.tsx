/**
 * Runs sync for the life of the app and exposes what it is doing.
 *
 * Deliberately quiet. Sync state is information, not an event: it belongs in a
 * corner you can glance at, never in a toast that interrupts a set.
 */

import { createContext, type ReactNode, use, useEffect, useState } from "react";
import { program } from "@/lib/content";
import { todayIso } from "@/lib/format";
import { reconcilePhaseInheritance } from "@/lib/reconcile-phases";
import { createSyncClient, type SyncState } from "@/lib/sync-client";
import { useCollections } from "./provider";

type SyncApi = { state: SyncState; syncNow: () => void; schedule: () => void };

const SyncContext = createContext<SyncApi | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
	const collections = useCollections();
	const [state, setState] = useState<SyncState>({
		status: "idle",
		lastSyncedAt: null,
	});
	const [api, setApi] = useState<Pick<SyncApi, "syncNow" | "schedule"> | null>(
		null,
	);

	useEffect(() => {
		const client = createSyncClient(collections, setState, (received) => {
			// A pull can bring a phase this device has never seen. Writing down what
			// it inherits is the same reconciliation the bootstrap runs, and it is
			// idempotent, so arriving here twice costs nothing.
			if (received === 0) return;
			const inherited = reconcilePhaseInheritance(
				collections,
				program,
				todayIso(),
				Date.now(),
			);
			if (inherited.created > 0) {
				console.info("Herencia de fases tras sincronizar:", inherited);
			}
		});
		setApi({ syncNow: () => void client.syncNow(), schedule: client.schedule });
		return () => client.stop();
	}, [collections]);

	return (
		<SyncContext
			value={{
				state,
				syncNow: api?.syncNow ?? (() => {}),
				schedule: api?.schedule ?? (() => {}),
			}}
		>
			{children}
		</SyncContext>
	);
}

export function useSync(): SyncApi {
	return (
		use(SyncContext) ?? {
			state: { status: "idle", lastSyncedAt: null },
			syncNow: () => {},
			schedule: () => {},
		}
	);
}
