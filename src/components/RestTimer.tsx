/**
 * Rest between sets.
 *
 * It starts by itself when you save a set, because the moment you would tap
 * "start" is the moment you are putting the weight down. It keeps running across
 * screens and survives the app being backgrounded — the countdown is derived
 * from a timestamp, not from a tick that a sleeping phone would stop delivering.
 *
 * When it ends it makes a sound. It used to only vibrate, on the theory that a
 * phone which beeps in a gym is a phone you turn off — but iOS does not
 * implement vibration, so on the phone this actually runs on it ended in
 * silence. The sound can be muted from the bar itself, which is the honest
 * version of that theory.
 */

import {
	createContext,
	type ReactNode,
	use,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	alertEnabled,
	alertRestOver,
	requestNotifications,
	setAlertEnabled,
	unlockAlert,
} from "@/lib/alert";

const DEFAULT_SECONDS = 90;
const STEP_SECONDS = 30;

type RestApi = {
	/** Seconds left, or null when nothing is running. */
	remaining: number | null;
	total: number;
	start: (seconds?: number) => void;
	add: (seconds: number) => void;
	stop: () => void;
};

const RestContext = createContext<RestApi | null>(null);

export function RestTimerProvider({ children }: { children: ReactNode }) {
	// The end time, not a counter: a backgrounded phone stops firing intervals,
	// and a counter would come back wrong by however long the screen was off.
	const [endsAt, setEndsAt] = useState<number | null>(null);
	const [total, setTotal] = useState(DEFAULT_SECONDS);
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (endsAt === null) return;
		const id = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(id);
	}, [endsAt]);

	const remaining =
		endsAt === null ? null : Math.max(0, Math.ceil((endsAt - now) / 1000));

	// Which timer has already sounded, so returning to the app cannot re-fire it.
	const alerted = useRef<number | null>(null);

	useEffect(() => {
		if (remaining !== 0 || endsAt === null) return;
		if (alerted.current !== endsAt) {
			alerted.current = endsAt;
			alertRestOver(endsAt);
		}
		// Leave the zero on screen for a beat so it is visible, then clear.
		const id = setTimeout(() => setEndsAt(null), 4000);
		return () => clearTimeout(id);
	}, [remaining, endsAt]);

	const api = useMemo<RestApi>(
		() => ({
			remaining,
			total,
			start(seconds = DEFAULT_SECONDS) {
				// This runs inside the tap that saved the set — the only kind of
				// moment Safari lets an audio context out of suspension.
				unlockAlert();
				setTotal(seconds);
				setNow(Date.now());
				setEndsAt(Date.now() + seconds * 1000);
			},
			add(seconds) {
				setEndsAt((current) =>
					current === null ? null : current + seconds * 1000,
				);
				setTotal((current) => current + seconds);
			},
			stop() {
				setEndsAt(null);
			},
		}),
		[remaining, total],
	);

	return <RestContext value={api}>{children}</RestContext>;
}

export function useRest(): RestApi {
	const api = use(RestContext);
	if (!api) throw new Error("useRest must be used inside <RestTimerProvider>");
	return api;
}

/** The bar that appears above the tab bar while resting. */
export function RestBar() {
	const { remaining, total, add, stop } = useRest();
	const done = remaining === 0;
	const [sound, setSound] = useState(alertEnabled);

	const label = useCallback((seconds: number) => {
		const minutes = Math.floor(seconds / 60);
		return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
	}, []);

	function toggleSound() {
		const next = !sound;
		setSound(next);
		setAlertEnabled(next);
		// Asked here, on a tap, and only when she opts in — the moment a browser
		// will accept the question and the only moment it is fair to ask it.
		if (next) void requestNotifications();
	}

	if (remaining === null) return null;

	return (
		<div
			className={`border-t px-4 py-3 ${
				done ? "border-reserve bg-reserve-soft" : "border-line bg-surface"
			}`}
		>
			<div className="flex items-center gap-3">
				<span
					className={`tabular text-2xl font-semibold ${done ? "text-reserve" : "text-ink"}`}
					aria-live="polite"
				>
					{done ? "¡Va!" : label(remaining)}
				</span>

				<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
					<div
						className="h-full rounded-full bg-reserve transition-[width] duration-300"
						style={{ width: `${total === 0 ? 0 : (remaining / total) * 100}%` }}
					/>
				</div>

				<button
					type="button"
					onClick={toggleSound}
					aria-pressed={sound}
					aria-label={sound ? "Silenciar el aviso" : "Activar el aviso"}
					className={`grid size-10 shrink-0 place-items-center rounded-lg ${
						sound ? "text-muted" : "text-faint"
					}`}
				>
					<SoundIcon on={sound} />
				</button>

				{!done ? (
					<button
						type="button"
						onClick={() => add(STEP_SECONDS)}
						className="tabular h-10 rounded-lg border border-line px-3 text-sm text-muted"
					>
						+{STEP_SECONDS}s
					</button>
				) : null}

				<button
					type="button"
					onClick={stop}
					aria-label="Terminar descanso"
					className="h-10 rounded-lg px-3 text-sm text-faint"
				>
					{done ? "Listo" : "Saltar"}
				</button>
			</div>
		</div>
	);
}

/** A speaker, with the waves struck through when it is muted. */
function SoundIcon({ on }: { on: boolean }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			className="size-5"
			aria-hidden="true"
		>
			<path d="M11 5 6.5 9H3v6h3.5L11 19z" />
			{on ? (
				<>
					<path d="M15.5 8.5a5 5 0 0 1 0 7" />
					<path d="M18.5 5.5a9 9 0 0 1 0 13" />
				</>
			) : (
				<>
					<path d="M16 9.5l5 5" />
					<path d="M21 9.5l-5 5" />
				</>
			)}
		</svg>
	);
}

export { DEFAULT_SECONDS as DEFAULT_REST_SECONDS };
