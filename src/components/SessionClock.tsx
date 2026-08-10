/**
 * Marking when a session starts and ends.
 *
 * The duration used to be inferred from the first and last set logged, which
 * misses the warm-up before the first one and everything after the last — a
 * session that ran an hour would report forty minutes, and the average built on
 * top of that would be wrong in the same direction every time.
 *
 * Starting is also implicit: logging a set with no session open opens one. The
 * button exists for the case where you want the clock running from the moment
 * you walk in, which is what makes the average mean anything.
 */

import { useEffect, useState } from "react";

export function SessionClock({
	startedAt,
	endedAt,
	onStart,
	onFinish,
	canFinish,
}: {
	startedAt: number | null;
	endedAt: number | null;
	onStart: () => void;
	onFinish: () => void;
	/** False before anything is logged — there is no session to close yet. */
	canFinish: boolean;
}) {
	const running = startedAt !== null && endedAt === null;
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (!running) return;
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [running]);

	if (endedAt !== null && startedAt !== null) {
		return (
			<p className="eyebrow px-2">
				Sesión de {Math.max(1, Math.round((endedAt - startedAt) / 60_000))} min
			</p>
		);
	}

	if (!running) {
		return (
			<button
				type="button"
				onClick={onStart}
				className="h-12 w-full rounded-xl border border-line text-sm font-semibold text-reserve"
			>
				Empezar sesión
			</button>
		);
	}

	return (
		<div className="flex items-center gap-3">
			<p className="tabular flex-1 text-sm text-muted">
				<span className="font-semibold text-ink">
					{elapsed(now - (startedAt ?? now))}
				</span>{" "}
				en curso
			</p>
			<button
				type="button"
				onClick={onFinish}
				disabled={!canFinish}
				className="h-11 rounded-xl bg-reserve px-4 text-sm font-semibold text-on-accent disabled:opacity-40"
			>
				Terminar
			</button>
		</div>
	);
}

function elapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	const pad = (n: number) => String(n).padStart(2, "0");
	return hours > 0
		? `${hours}:${pad(minutes)}:${pad(seconds)}`
		: `${minutes}:${pad(seconds)}`;
}
