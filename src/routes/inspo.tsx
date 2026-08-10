/**
 * Inspo — what you're aiming at, and what you've actually done.
 *
 * Two sections because they answer different questions. References are outside
 * you: things that make you want to go. Progress is you: the spreadsheet already
 * listed photos as a measure of body composition and abdomen, alongside weight
 * and waist, and it was the one measure the app had nowhere to put.
 *
 * Both live entirely on the device.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { useEffect, useRef, useState } from "react";
import { Photo } from "@/components/Photo";
import { NoteField, PrimaryButton, Sheet } from "@/components/Sheet";
import { PageHeader, TabBar } from "@/components/TabBar";
import { useCollections } from "@/db/provider";
import type { InspoItem } from "@/domain/schema";
import { formatDayMonth, todayIso } from "@/lib/format";
import { deletePhoto, formatBytes, photosSize, savePhoto } from "@/lib/photos";

export const Route = createFileRoute("/inspo")({ component: Inspo });

type Kind = InspoItem["kind"];

function Inspo() {
	const collections = useCollections();
	const { data: items = [] } = useLiveQuery((q) =>
		q.from({ i: collections.inspo }),
	);

	const [adding, setAdding] = useState<Kind | null>(null);
	const [editing, setEditing] = useState<InspoItem | null>(null);
	const [storage, setStorage] = useState(0);

	useEffect(() => {
		photosSize().then(setStorage);
	}, []);

	const references = byNewest(
		items.filter((item) => item.kind === "reference"),
	);
	const progress = byNewest(items.filter((item) => item.kind === "progress"));

	async function remove(item: InspoItem) {
		if (item.photoId) await deletePhoto(item.photoId);
		collections.inspo.delete(item.id);
		setEditing(null);
		photosSize().then(setStorage);
	}

	return (
		<main className="mx-auto min-h-dvh w-full max-w-lg pb-24">
			<PageHeader
				eyebrow="Referencias y progreso"
				title="Inspo"
				subtitle={
					storage > 0
						? `${items.length} elementos · ${formatBytes(storage)} en este dispositivo`
						: "Todo se guarda solo en este dispositivo."
				}
			/>

			<Section
				title="Referencias"
				hint="Lo que te hace querer ir."
				onAdd={() => setAdding("reference")}
			>
				{references.length === 0 ? (
					<Empty text="Guarda una foto o un enlace que te sirva de referencia." />
				) : (
					<div className="grid grid-cols-2 gap-2">
						{references.map((item) => (
							<ReferenceCard
								key={item.id}
								item={item}
								onOpen={() => setEditing(item)}
							/>
						))}
					</div>
				)}
			</Section>

			<Section
				title="Mi progreso"
				hint="La misma pose, la misma luz, cada mes."
				onAdd={() => setAdding("progress")}
			>
				{progress.length === 0 ? (
					<Empty text="Tu primera foto es la referencia contra la que comparas todo lo demás." />
				) : (
					<>
						{progress.length >= 2 ? (
							<Comparison
								oldest={progress[progress.length - 1]}
								newest={progress[0]}
							/>
						) : null}
						<div className="mt-3 grid grid-cols-3 gap-2">
							{progress.map((item) => (
								<button
									key={item.id}
									type="button"
									onClick={() => setEditing(item)}
									className="overflow-hidden rounded-lg border border-line"
								>
									{item.photoId ? (
										<Photo
											photoId={item.photoId}
											alt={`Progreso ${formatDayMonth(item.date)}`}
											className="aspect-[3/4] w-full object-cover"
										/>
									) : null}
									<span className="eyebrow block py-1 text-center">
										{formatDayMonth(item.date)}
									</span>
								</button>
							))}
						</div>
					</>
				)}
			</Section>

			{adding ? (
				<AddItem
					kind={adding}
					onClose={() => setAdding(null)}
					onSave={(item) => {
						collections.inspo.insert(item);
						setAdding(null);
						photosSize().then(setStorage);
					}}
				/>
			) : null}

			{editing ? (
				<Sheet
					title={
						editing.kind === "progress" ? "Foto de progreso" : "Referencia"
					}
					onClose={() => setEditing(null)}
					onDelete={() => remove(editing)}
				>
					{editing.photoId ? (
						<Photo
							photoId={editing.photoId}
							alt="Ampliada"
							className="max-h-[55dvh] w-full rounded-lg object-contain"
						/>
					) : null}
					{editing.url ? (
						<a
							href={editing.url}
							target="_blank"
							rel="noreferrer noopener"
							className="mt-3 block truncate text-sm text-reserve underline"
						>
							{editing.url}
						</a>
					) : null}
					<p className="mt-3 text-[0.8125rem] text-muted">{editing.note}</p>
					<p className="eyebrow mt-3">{formatDayMonth(editing.date)}</p>
				</Sheet>
			) : null}

			<TabBar />
		</main>
	);
}

function Section({
	title,
	hint,
	onAdd,
	children,
}: {
	title: string;
	hint: string;
	onAdd: () => void;
	children: React.ReactNode;
}) {
	return (
		<section className="border-t border-line px-4 py-6">
			<div className="mb-1 flex items-center justify-between">
				<p className="eyebrow">{title}</p>
				<button
					type="button"
					onClick={onAdd}
					className="text-sm font-semibold text-reserve"
				>
					Añadir
				</button>
			</div>
			<p className="mb-4 text-[0.8125rem] text-faint">{hint}</p>
			{children}
		</section>
	);
}

function Empty({ text }: { text: string }) {
	return <p className="text-[0.8125rem] text-faint">{text}</p>;
}

function ReferenceCard({
	item,
	onOpen,
}: {
	item: InspoItem;
	onOpen: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onOpen}
			className="overflow-hidden rounded-lg border border-line bg-surface text-left"
		>
			{item.photoId ? (
				<Photo
					photoId={item.photoId}
					alt={item.note ?? "Referencia"}
					className="aspect-square w-full object-cover"
				/>
			) : (
				<span className="flex aspect-square w-full items-center justify-center bg-raised px-2 text-center text-[0.6875rem] break-all text-faint">
					{hostOf(item.url)}
				</span>
			)}
			{item.note ? (
				<span className="block px-2 py-2 text-[0.8125rem] text-muted">
					{item.note}
				</span>
			) : null}
		</button>
	);
}

/** The whole point of progress photos: two dates, same width, side by side. */
function Comparison({
	oldest,
	newest,
}: {
	oldest: InspoItem;
	newest: InspoItem;
}) {
	return (
		<div className="grid grid-cols-2 gap-2">
			{[oldest, newest].map((item, index) => (
				<figure key={item.id} className="m-0">
					<figcaption className="eyebrow mb-1">
						{index === 0 ? "Primera" : "Última"} · {formatDayMonth(item.date)}
					</figcaption>
					{item.photoId ? (
						<Photo
							photoId={item.photoId}
							alt={`Progreso ${formatDayMonth(item.date)}`}
							className="aspect-[3/4] w-full rounded-lg border border-line object-cover"
						/>
					) : null}
				</figure>
			))}
		</div>
	);
}

function AddItem({
	kind,
	onSave,
	onClose,
}: {
	kind: Kind;
	onSave: (item: InspoItem) => void;
	onClose: () => void;
}) {
	const fileInput = useRef<HTMLInputElement>(null);
	const [photoId, setPhotoId] = useState<string | null>(null);
	const [url, setUrl] = useState("");
	const [note, setNote] = useState("");
	const [date, setDate] = useState(todayIso());
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function pick(file: File | undefined) {
		if (!file) return;
		setBusy(true);
		setError(null);
		try {
			setPhotoId(await savePhoto(file));
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "No se pudo guardar la imagen.",
			);
		} finally {
			setBusy(false);
		}
	}

	const canSave =
		photoId !== null || (kind === "reference" && url.trim() !== "");

	return (
		<Sheet
			title={
				kind === "progress" ? "Nueva foto de progreso" : "Nueva referencia"
			}
			onClose={onClose}
		>
			{photoId ? (
				<Photo
					photoId={photoId}
					alt="Vista previa"
					className="max-h-64 w-full rounded-lg object-contain"
				/>
			) : null}

			<input
				ref={fileInput}
				type="file"
				accept="image/*"
				className="sr-only"
				onChange={(event) => pick(event.target.files?.[0])}
			/>
			<button
				type="button"
				onClick={() => fileInput.current?.click()}
				disabled={busy}
				className="mt-4 h-14 w-full rounded-lg border border-line text-sm text-ink disabled:opacity-50"
			>
				{busy ? "Procesando…" : photoId ? "Cambiar foto" : "Elegir foto"}
			</button>

			{error ? (
				<p className="mt-2 text-[0.8125rem] text-stop">{error}</p>
			) : null}

			{kind === "reference" ? (
				<label className="mt-4 block">
					<span className="eyebrow mb-2 block">O un enlace</span>
					<input
						type="url"
						inputMode="url"
						value={url}
						onChange={(event) => setUrl(event.target.value)}
						placeholder="https://…"
						className="h-12 w-full rounded-lg border border-line bg-ground px-3 text-[0.9375rem] text-ink placeholder:text-faint"
					/>
				</label>
			) : null}

			<label className="mt-4 block">
				<span className="eyebrow mb-2 block">Fecha</span>
				<input
					type="date"
					value={date}
					onChange={(event) => setDate(event.target.value)}
					className="h-12 w-full rounded-lg border border-line bg-ground px-3 text-[0.9375rem] text-ink"
				/>
			</label>

			<div className="mt-4">
				<NoteField
					label="Nota"
					value={note}
					onChange={setNote}
					placeholder={
						kind === "progress"
							? "Cómo te sentiste, qué notas"
							: "Qué te gusta de esto"
					}
				/>
			</div>

			<PrimaryButton
				disabled={!canSave || busy}
				onClick={() =>
					onSave({
						id: crypto.randomUUID(),
						kind,
						date,
						photoId,
						url: url.trim() || null,
						note: note.trim() || null,
					})
				}
			>
				Guardar
			</PrimaryButton>
		</Sheet>
	);
}

function byNewest(items: readonly InspoItem[]): InspoItem[] {
	return [...items].sort((a, b) => b.date.localeCompare(a.date));
}

function hostOf(url: string | null): string {
	if (!url) return "enlace";
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}
