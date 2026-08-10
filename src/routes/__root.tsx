import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { CollectionsProvider } from "@/db/provider";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			// Locked scale: pinch-zooming mid-set is an accident, not an intent.
			{
				name: "viewport",
				content:
					"width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1",
			},
			{ name: "theme-color", content: "#0e1116" },
			{ name: "apple-mobile-web-app-capable", content: "yes" },
			{
				name: "apple-mobile-web-app-status-bar-style",
				content: "black-translucent",
			},
			{ title: "Operación Tesis" },
		],
		links: [
			{ rel: "stylesheet", href: appCss },
			{ rel: "manifest", href: "/manifest.webmanifest" },
			{ rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
			{ rel: "icon", href: "/icon-192.png", type: "image/png" },
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang="es">
			<head>
				<HeadContent />
			</head>
			<body>
				<CollectionsProvider>{children}</CollectionsProvider>
				<Scripts />
			</body>
		</html>
	);
}
