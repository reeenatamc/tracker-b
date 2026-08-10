/**
 * Runs sync for the life of the app and exposes what it is doing.
 *
 * Deliberately quiet. Sync state is information, not an event: it belongs in a
 * corner you can glance at, never in a toast that interrupts a set.
 */

import { createContext, type ReactNode, use, useEffect, useState } from "react";
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
		const client = createSyncClient(collections, setState);
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
