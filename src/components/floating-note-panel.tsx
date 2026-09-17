import { XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PageFormat } from "@/lib/storage/types";
import { useAppStore } from "@/lib/stores/app-store";
import {
	type FloatingPanelMode,
	type NoteInfoTarget,
	useEditorUiStore,
} from "@/lib/stores/editor-ui-store";

export type { FloatingPanelMode, NoteInfoTarget };

const FALLBACK_PAGE_FORMAT: PageFormat = {
	indentation: "none",
	lineHeight: "normal",
	paragraphSpacing: "none",
};

type Props = {
	onFormat: (update: Partial<PageFormat>) => void;
	onReplace: (all: boolean) => void;
};

/**
 * Owns floating-panel mode/visibility/find/replace/info via editor-ui-store
 * so Index does not re-render when the panel opens (plan 017).
 */
export function FloatingNotePanel(p: Props) {
	const activeNotePath = useAppStore((s) => s.activeNotePath);
	const pageFormats = useEditorUiStore((s) => s.pageFormats);
	const defaultPageFormat =
		useAppStore((s) => s.defaultPageFormat) ?? FALLBACK_PAGE_FORMAT;
	const mode = useEditorUiStore((s) => s.floatingPanelMode);
	const visible = useEditorUiStore((s) => s.floatingPanelVisible);
	const lastMode = useEditorUiStore((s) => s.floatingPanelLastMode);
	const findText = useEditorUiStore((s) => s.findText);
	const replaceText = useEditorUiStore((s) => s.replaceText);
	const info = useEditorUiStore((s) => s.noteInfoTarget);
	const setFloatingPanelMode = useEditorUiStore((s) => s.setFloatingPanelMode);
	const setFindText = useEditorUiStore((s) => s.setFindText);
	const setReplaceText = useEditorUiStore((s) => s.setReplaceText);
	const closeFloatingPanel = useEditorUiStore((s) => s.closeFloatingPanel);
	const findInputRef = useRef<HTMLInputElement>(null);

	const pageFormat = activeNotePath
		? (pageFormats[activeNotePath] ?? defaultPageFormat)
		: defaultPageFormat;

	useEffect(() => {
		if (!mode) return;
		findInputRef.current?.focus();
	}, [mode]);

	if (!visible) return null;
	const displayMode = mode ?? lastMode;
	return (
		<div
			data-state={mode ? "open" : "closed"}
			data-open={mode ? "" : undefined}
			data-closed={!mode ? "" : undefined}
			onAnimationEnd={(e) => {
				if (e.target === e.currentTarget && !mode) closeFloatingPanel();
			}}
			className="absolute top-12 right-4 z-20 flex w-80 flex-col gap-3 rounded-xl bg-popover p-3 text-sm text-popover-foreground shadow-[0_14px_40px_rgb(0_0_0/0.35),0_0_0_1px_rgb(255_255_255/0.08)] duration-200 ease-out data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-top-2 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-top-2 data-closed:zoom-out-95"
		>
			{displayMode === "format" ? (
				<>
					<div className="flex items-center justify-between">
						<h2 className="font-medium text-sm">Note setup</h2>
						<Button
							size="icon-sm"
							variant="ghost"
							aria-label="Close note setup"
							onClick={() => setFloatingPanelMode(null)}
						>
							<XIcon />
						</Button>
					</div>
					<div className="space-y-3 rounded-lg bg-muted/35 p-2">
						<FormatChoice
							label="Paragraph spacing"
							first={pageFormat.paragraphSpacing === "none"}
							second={pageFormat.paragraphSpacing === "spacious"}
							onFirst={() => p.onFormat({ paragraphSpacing: "none" })}
							onSecond={() => p.onFormat({ paragraphSpacing: "spacious" })}
							firstLabel="None"
							secondLabel="Spacious"
						/>
						<IndentationChoice
							value={pageFormat.indentation}
							onChange={(indentation) => p.onFormat({ indentation })}
						/>
					</div>
				</>
			) : displayMode === "info" ? (
				<>
					<div className="flex items-center justify-between">
						<h2 className="font-medium text-sm">Note Info</h2>
						<Button
							size="icon-sm"
							variant="ghost"
							aria-label="Close note info"
							onClick={() => setFloatingPanelMode(null)}
						>
							<XIcon />
						</Button>
					</div>
					<div className="space-y-2 rounded-lg bg-muted/35 p-2">
						<div>
							<span className="text-muted-foreground text-xs">Title</span>
							<p>{info?.title ?? "—"}</p>
						</div>
						<div>
							<span className="text-muted-foreground text-xs">Path</span>
							<p className="break-all font-mono text-xs">{info?.path ?? "—"}</p>
						</div>
					</div>
				</>
			) : (
				<>
					<div className="flex items-center justify-between">
						<h2 className="font-medium text-sm">
							{displayMode === "replace" ? "Find & Replace" : "Find"}
						</h2>
						<Button
							size="icon-sm"
							variant="ghost"
							aria-label="Close find panel"
							onClick={() => setFloatingPanelMode(null)}
						>
							<XIcon />
						</Button>
					</div>
					<div className="space-y-2 rounded-lg bg-muted/35 p-2">
						<div className="flex items-center gap-2">
							<Input
								ref={findInputRef}
								value={findText}
								placeholder="Find..."
								onChange={(e) => setFindText(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Escape") setFloatingPanelMode(null);
								}}
							/>
						</div>
						{displayMode === "replace" ? (
							<div className="flex items-center gap-2">
								<Input
									value={replaceText}
									placeholder="Replace..."
									onChange={(e) => setReplaceText(e.target.value)}
								/>
								<Button
									size="sm"
									variant="outline"
									onClick={() => p.onReplace(false)}
								>
									One
								</Button>
								<Button size="sm" onClick={() => p.onReplace(true)}>
									All
								</Button>
							</div>
						) : null}
					</div>
				</>
			)}
		</div>
	);
}

function FormatChoice({
	label,
	first,
	second,
	onFirst,
	onSecond,
	firstLabel,
	secondLabel,
}: {
	label: string;
	first: boolean;
	second: boolean;
	onFirst: () => void;
	onSecond: () => void;
	firstLabel: string;
	secondLabel: string;
}) {
	return (
		<div className="flex flex-col gap-2">
			<span className="block text-muted-foreground text-xs">{label}</span>
			<div className="flex gap-1">
				<Button
					className="flex-1"
					variant={first ? "default" : "ghost"}
					onClick={onFirst}
				>
					{firstLabel}
				</Button>
				<Button
					className="flex-1"
					variant={second ? "default" : "ghost"}
					onClick={onSecond}
				>
					{secondLabel}
				</Button>
			</div>
		</div>
	);
}

function IndentationChoice({
	value,
	onChange,
}: {
	value: PageFormat["indentation"];
	onChange: (value: PageFormat["indentation"]) => void;
}) {
	const choices: Array<{
		value: PageFormat["indentation"];
		label: string;
	}> = [
		{ value: "none", label: "None" },
		{ value: "first-line", label: "First line" },
		{ value: "hanging", label: "Hanging" },
	];

	return (
		<div className="flex flex-col gap-2">
			<span className="block text-muted-foreground text-xs">Indentation</span>
			<div className="flex gap-1">
				{choices.map((choice) => (
					<Button
						key={choice.value}
						className="min-w-0 flex-1 px-1.5 text-xs"
						variant={value === choice.value ? "default" : "ghost"}
						onClick={() => onChange(choice.value)}
					>
						{choice.label}
					</Button>
				))}
			</div>
		</div>
	);
}
