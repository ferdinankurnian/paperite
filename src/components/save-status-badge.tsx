import { Loader2Icon, ShieldCheckIcon } from "lucide-react";
import { type MouseEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
	formatSavedAt,
	formatSavedAtAbsolute,
	saveStatusLabel,
	useEditorUiStore,
} from "@/lib/stores/editor-ui-store";

export function SaveStatusBadge({
	onVerify,
}: {
	onVerify: () => Promise<{ ok: boolean; message: string; detail?: string }>;
}) {
	const saveStatus = useEditorUiStore((s) => s.saveStatus);
	const lastSavedAt = useEditorUiStore((s) => s.lastSavedAt);
	const label = saveStatusLabel(saveStatus);
	const relative = formatSavedAt(lastSavedAt);
	const absolute = formatSavedAtAbsolute(lastSavedAt);
	const [verifying, setVerifying] = useState(false);
	const [verifyResult, setVerifyResult] = useState<{
		ok: boolean;
		message: string;
		detail?: string;
	} | null>(null);

	useEffect(() => {
		if (!verifyResult) return;
		const timer = window.setTimeout(() => setVerifyResult(null), 10_000);
		return () => window.clearTimeout(timer);
	}, [verifyResult]);

	const statusColor =
		saveStatus === "error" ? "text-destructive" : "text-muted-foreground";

	const displayLabel =
		saveStatus === "saving"
			? "Saving..."
			: saveStatus === "error"
				? "Error"
				: saveStatus === "saved"
					? "Saved"
					: label;

	const handleVerify = async (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		if (verifying) return;
		setVerifying(true);
		setVerifyResult(null);
		try {
			const result = await onVerify();
			setVerifyResult(result);
		} catch {
			setVerifyResult({
				ok: false,
				message: "Verify failed",
				detail: "Unexpected error while checking the file.",
			});
		} finally {
			setVerifying(false);
		}
	};

	if (!displayLabel) {
		return (
			<span className="min-w-14 px-2 text-right text-xs text-muted-foreground" />
		);
	}

	return (
		<HoverCard openDelay={500} closeDelay={120}>
			<HoverCardTrigger asChild>
				<button
					type="button"
					className={`min-w-14 max-w-28 truncate px-2 text-right text-xs transition-colors hover:text-foreground ${statusColor}`}
					aria-label={
						saveStatus === "saved" ? `Saved ${absolute}` : displayLabel
					}
				>
					{displayLabel}
				</button>
			</HoverCardTrigger>
			<HoverCardContent
				side="bottom"
				align="end"
				className="w-64 space-y-2 p-3 text-xs"
				onPointerDownOutside={(e) => {
					if (verifying) e.preventDefault();
				}}
			>
				<div className="font-medium text-foreground">
					{saveStatus === "saving"
						? "Saving note…"
						: saveStatus === "error"
							? "Save failed"
							: "Note saved"}
				</div>
				{lastSavedAt != null ? (
					<>
						<div className="text-muted-foreground">Last saved {relative}</div>
						<div className="text-muted-foreground/80 tabular-nums">
							{absolute}
						</div>
					</>
				) : (
					<div className="text-muted-foreground">No local save yet</div>
				)}
				<div className="text-muted-foreground/70">Ctrl+S force save</div>
				<div className="border-t border-border/60 pt-2">
					<Button
						type="button"
						variant="outline"
						size="xs"
						className="w-full justify-center gap-1.5"
						disabled={verifying}
						onClick={handleVerify}
						onMouseDown={(event) => event.preventDefault()}
					>
						{verifying ? (
							<Loader2Icon className="size-3.5 animate-spin" />
						) : (
							<ShieldCheckIcon className="size-3.5" />
						)}
						{verifying ? "Verifying…" : "Verify save note"}
					</Button>
					{verifyResult ? (
						<div
							className={
								verifyResult.ok
									? "mt-2 space-y-0.5 text-emerald-600 dark:text-emerald-400"
									: "mt-2 space-y-0.5 text-destructive"
							}
						>
							<div className="font-medium">{verifyResult.message}</div>
							{verifyResult.detail ? (
								<div className="text-[11px] opacity-90">
									{verifyResult.detail}
								</div>
							) : null}
						</div>
					) : null}
				</div>
			</HoverCardContent>
		</HoverCard>
	);
}
