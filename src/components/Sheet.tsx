/**
 * A panel that slides up from the bottom.
 *
 * Editing happens where your thumb already is. A centred dialog on a phone puts
 * the controls at the top of the screen and the keyboard over them.
 */

import { type ReactNode, useEffect } from "react";

type SheetProps = {
	title: string;
	onClose: () => void;
	children: ReactNode;
	/** Destructive action shown in the header, e.g. deleting the record. */
	onDelete?: () => void;
	deleteLabel?: string;
};

export function Sheet({
	title,
	onClose,
	children,
	onDelete,
	deleteLabel,
}: SheetProps) {
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		// The page behind must not scroll while the sheet is up.
		const previous = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = previous;
		};
	}, [onClose]);

	return (
		<div className="fixed inset-0 z-50 flex flex-col justify-end">
			<button
				type="button"
				aria-label="Cerrar"
				onClick={onClose}
				className="absolute inset-0 bg-ink/40"
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={title}
				className="relative max-h-[88dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface pb-8"
			>
				<div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
					<button
						type="button"
						onClick={onClose}
						className="text-sm text-muted"
					>
						Cancelar
					</button>
					<p className="eyebrow">{title}</p>
					{onDelete ? (
						<button
							type="button"
							onClick={onDelete}
							className="text-sm text-stop"
						>
							{deleteLabel ?? "Borrar"}
						</button>
					) : (
						<span className="w-16" />
					)}
				</div>
				<div className="px-4 pt-4">{children}</div>
			</div>
		</div>
	);
}

/** A labelled free-text field. Used for notes, which is where the real information ends up. */
export function NoteField({
	label,
	value,
	onChange,
	placeholder,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
}) {
	return (
		<label className="block">
			<span className="eyebrow mb-2 block">{label}</span>
			<textarea
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				rows={3}
				className="w-full resize-none rounded-lg border border-line bg-ground px-3 py-2 text-[0.9375rem] text-ink placeholder:text-faint"
			/>
		</label>
	);
}

export function PrimaryButton({
	children,
	onClick,
	disabled,
}: {
	children: ReactNode;
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className="mt-5 h-14 w-full rounded-lg bg-reserve text-base font-semibold text-on-accent transition-opacity active:opacity-80 disabled:opacity-40"
		>
			{children}
		</button>
	);
}
