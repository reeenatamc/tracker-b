/**
 * The five places the app goes. Fixed to the bottom, where your thumb is.
 */

import { Link } from "@tanstack/react-router";

const TABS = [
	{ to: "/", label: "Hoy" },
	{ to: "/ankle", label: "Tobillo" },
	{ to: "/progress", label: "Progreso" },
	{ to: "/inspo", label: "Inspo" },
	{ to: "/history", label: "Historial" },
] as const;

export function TabBar() {
	return (
		<nav className="fixed inset-x-0 bottom-0 border-t border-line bg-ground/95 backdrop-blur">
			<div className="mx-auto flex max-w-lg">
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
		<header className="px-4 pt-8 pb-6">
			<p className="eyebrow">{eyebrow}</p>
			<h1 className="tabular mt-3 text-2xl font-semibold tracking-tight uppercase">
				{title}
			</h1>
			{subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
		</header>
	);
}
