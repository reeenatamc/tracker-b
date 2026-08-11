/**
 * The six places the app goes. Fixed to the bottom, where your thumb is.
 */

import { Link } from "@tanstack/react-router";
import { RestBar } from "./RestTimer";
import { SaveStatus } from "./SaveStatus";
import { SyncStatus } from "./SyncStatus";

const TABS = [
	{ to: "/", label: "Hoy" },
	{ to: "/plan", label: "Plan" },
	{ to: "/ankle", label: "Tobillo" },
	{ to: "/progress", label: "Progreso" },
	{ to: "/inspo", label: "Inspo" },
	{ to: "/history", label: "Historial" },
] as const;

export function TabBar() {
	return (
		<nav className="fixed inset-x-0 bottom-0 border-t border-line bg-ground/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
			<div className="mx-auto max-w-lg">
				<RestBar />
				{/* Antes que el sync: que algo no se haya guardado importa más
				    que que no haya viajado. */}
				<SaveStatus />
				<SyncStatus />
			</div>
			<div className="mx-auto flex max-w-lg border-t border-line">
				{TABS.map((tab) => (
					<Link
						key={tab.to}
						to={tab.to}
						className="eyebrow flex-1 py-4 text-center transition-colors"
						activeProps={{ className: "text-reserve" }}
						activeOptions={{ exact: tab.to === "/" }}
					>
						{tab.label}
					</Link>
				))}
			</div>
		</nav>
	);
}

/** Consistent page header across screens. */
export function PageHeader({
	eyebrow,
	title,
	subtitle,
}: {
	eyebrow: string;
	title: string;
	subtitle?: string;
}) {
	return (
		<header className="px-2 pt-7 pb-1">
			<p className="eyebrow">{eyebrow}</p>
			<h1 className="mt-1 text-[1.75rem] leading-tight font-bold tracking-tight">
				{title}
			</h1>
			{subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
		</header>
	);
}
