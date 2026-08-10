/**
 * Renders a photo held in OPFS.
 *
 * The object URL is created on mount and revoked on unmount — without that, every
 * scroll past a photo grid pins another blob in memory until the tab is closed.
 */

import { useEffect, useState } from "react";
import { readPhotoUrl } from "@/lib/photos";

export function Photo({
	photoId,
	alt,
	className,
}: {
	photoId: string;
	alt: string;
	className?: string;
}) {
	const [url, setUrl] = useState<string | null>(null);
	const [missing, setMissing] = useState(false);

	useEffect(() => {
		let revoked = false;
		let current: string | null = null;

		readPhotoUrl(photoId).then((objectUrl) => {
			if (revoked) {
				if (objectUrl) URL.revokeObjectURL(objectUrl);
				return;
			}
			if (!objectUrl) setMissing(true);
			current = objectUrl;
			setUrl(objectUrl);
		});

		return () => {
			revoked = true;
			if (current) URL.revokeObjectURL(current);
		};
	}, [photoId]);

	if (missing) {
		return (
			<div
				className={`flex items-center justify-center bg-raised text-[0.6875rem] text-faint ${className ?? ""}`}
			>
				imagen no encontrada
			</div>
		);
	}

	if (!url)
		return <div className={`animate-pulse bg-raised ${className ?? ""}`} />;

	return <img src={url} alt={alt} loading="lazy" className={className} />;
}
