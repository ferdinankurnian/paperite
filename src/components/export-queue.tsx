import {
	CheckCircle2,
	CircleX,
	Download,
	FolderOpen,
	Loader2,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
	cancelExport,
	clearCompleted,
	type ExportItem,
	getActiveCount,
	getExports,
	removeExport,
	subscribeExports,
} from "@/lib/export-queue";

function ExportItemRow({ item }: { item: ExportItem }) {
	const isRunning = item.status === "pending" || item.status === "writing";
	const isDone = item.status === "done";

	const handleOpenFolder = useCallback(async () => {
		if (item.destPath) {
			const dir = item.destPath.substring(0, item.destPath.lastIndexOf("/"));
			window.electron?.openExternal(`file://${dir}`);
		}
	}, [item.destPath]);

	const statusIcon = (() => {
		switch (item.status) {
			case "pending":
			case "writing":
				return (
					<Loader2 className="size-3.5 animate-spin text-muted-foreground" />
				);
			case "done":
				return <CheckCircle2 className="size-3.5 text-green-500" />;
			case "error":
				return <div className="size-3.5 rounded-full bg-red-500" />;
			case "cancelled":
				return <CircleX className="size-3.5 text-muted-foreground" />;
		}
	})();

	return (
		<div className="flex items-start gap-2 px-3 py-2 border-b last:border-b-0">
			<div className="mt-0.5">{statusIcon}</div>
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-1.5">
					<span className="text-sm font-medium truncate">{item.noteTitle}</span>
					<span className="shrink-0 rounded border border-border bg-muted px-1 text-[10px] leading-4 text-muted-foreground">
						.{item.format === "markdown" ? "md" : "txt"}
					</span>
				</div>
				{item.destPath && (
					<p className="text-[11px] text-muted-foreground truncate mt-0.5">
						{item.destPath}
					</p>
				)}
				{item.error && (
					<p className="text-xs text-destructive mt-0.5">{item.error}</p>
				)}
			</div>
			<div className="flex items-center gap-0.5 shrink-0">
				{isDone && item.destPath && (
					<Button
						variant="ghost"
						size="icon-xs"
						onClick={handleOpenFolder}
						title="Open in file manager"
					>
						<FolderOpen />
					</Button>
				)}
				{isRunning && (
					<Button
						variant="ghost"
						size="icon-xs"
						onClick={() => cancelExport(item.id)}
						title="Cancel"
					>
						<X />
					</Button>
				)}
				{!isRunning && (
					<Button
						variant="ghost"
						size="icon-xs"
						onClick={() => removeExport(item.id)}
						title="Remove"
					>
						<Trash2 />
					</Button>
				)}
			</div>
		</div>
	);
}

export function ExportQueue() {
	const [items, setItems] = useState<ExportItem[]>(getExports());
	const [activeCount, setActiveCount] = useState(getActiveCount());
	const [hasCompleted, setHasCompleted] = useState(false);
	const [hovered, setHovered] = useState(false);

	useEffect(() => {
		return subscribeExports(() => {
			const next = getExports();
			setItems(next);
			setActiveCount(getActiveCount());
			if (next.some((e) => e.status === "done" || e.status === "error")) {
				setHasCompleted(true);
			}
		});
	}, []);

	const isExporting = activeCount > 0;
	const showDone = hasCompleted && !isExporting && !hovered;

	if (items.length === 0) return null;

	return (
		<HoverCard openDelay={200}>
			<HoverCardTrigger asChild>
				<button
					type="button"
					aria-label="Export queue"
					className={`relative flex h-full w-8 items-center justify-center transition-colors ${
						isExporting ? "text-blue-500" : showDone ? "text-green-500" : ""
					}`}
					onMouseEnter={() => {
						setHovered(true);
						setHasCompleted(false);
					}}
					onMouseLeave={() => setHovered(false)}
				>
					{isExporting ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : showDone ? (
						<CheckCircle2 className="size-3.5" />
					) : (
						<Download className="size-3.5" />
					)}
					{activeCount > 0 && (
						<span className="absolute top-0.5 right-0 flex size-3 items-center justify-center rounded-full bg-blue-500 text-[8px] font-medium text-white">
							{activeCount}
						</span>
					)}
				</button>
			</HoverCardTrigger>
			<HoverCardContent className="w-80 p-0" align="end" sideOffset={8}>
				<div className="flex items-center justify-between border-b px-3 py-2">
					<span className="text-sm font-semibold">Exports</span>
					{items.some((e) => e.status === "done" || e.status === "error") && (
						<Button variant="ghost" size="xs" onClick={clearCompleted}>
							Clear
						</Button>
					)}
				</div>
				<div className="max-h-64 overflow-y-auto">
					{items.length === 0 ? (
						<div className="py-8 text-center text-sm text-muted-foreground">
							No exports yet
						</div>
					) : (
						items.map((item) => <ExportItemRow key={item.id} item={item} />)
					)}
				</div>
			</HoverCardContent>
		</HoverCard>
	);
}
