import {
	ExternalLinkIcon,
	InfoIcon,
	MoreVerticalIcon,
	SearchIcon,
	Trash2Icon,
} from "lucide-react";
import { memo, type ReactNode } from "react";
import { ReadOnlyToggleButton } from "@/components/read-only-toggle-button";
import { TabBar } from "@/components/tab-bar";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useAppStore } from "@/lib/stores/app-store";
import { useEditorUiStore } from "@/lib/stores/editor-ui-store";

type NoteHeaderProps = {
	spaceTitleFor: (path: string) => string;
	onSelect: (path: string) => void;
	onDoubleClick: (path: string) => void;
	onClose: (path: string) => void;
	onTogglePin: (path: string) => void;
	saveStatus: ReactNode;
	/** True when the active note is already popped out. */
	locked: boolean;
	onInfo: () => void;
	onSetup: () => void;
	onPopout: () => void;
	onFind: () => void;
	onReplace: () => void;
	onDelete: () => void;
	onCopyText: () => void;
	onCopyMarkdown: () => void;
	onExportMarkdown: () => void;
	onExportText: () => void;
};

function NoteHeaderInner({
	spaceTitleFor,
	onSelect,
	onDoubleClick,
	onClose,
	onTogglePin,
	saveStatus,
	locked,
	onInfo,
	onSetup,
	onPopout,
	onFind,
	onReplace,
	onDelete,
	onCopyText,
	onCopyMarkdown,
	onExportMarkdown,
	onExportText,
}: NoteHeaderProps) {
	// Own subscription so Index can stay cold when only path identity is needed
	// for disable-state in this chrome (plan 017).
	const activeNotePath = useAppStore((s) => s.activeNotePath);

	return (
		<header className="relative z-10 flex h-12 shrink-0 items-stretch gap-3 px-3 transition-[width,height] ease-linear after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-8 after:bg-linear-to-b after:from-background after:to-transparent after:content-['']">
			<div className="flex shrink-0 items-center min-[56.0625rem]:hidden">
				<SidebarTrigger
					toggleNotesSheet
					className="text-muted-foreground min-[56.0625rem]:hidden"
				/>
			</div>
			<TabBar
				spaceTitleFor={spaceTitleFor}
				onSelect={onSelect}
				onDoubleClick={onDoubleClick}
				onClose={onClose}
				onTogglePin={onTogglePin}
			/>
			<div className="flex shrink-0 items-center gap-2">
				{saveStatus}
				<ReadOnlyToggleButton />
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="text-muted-foreground"
							aria-label="More note actions"
						>
							<MoreVerticalIcon />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-56">
						<DropdownMenuItem onSelect={onInfo}>
							<InfoIcon />
							Note Info
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={onSetup}>
							<span className="size-4" />
							Note setup...
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							disabled={!activeNotePath || locked}
							onSelect={onPopout}
						>
							<ExternalLinkIcon />
							{locked ? "Already open in window" : "Pop out note"}
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuSub>
							<DropdownMenuSubTrigger>
								<span className="size-4" />
								Copy as…
							</DropdownMenuSubTrigger>
							<DropdownMenuPortal>
								<DropdownMenuSubContent>
									<DropdownMenuItem onSelect={onCopyText}>
										Plain text
									</DropdownMenuItem>
									<DropdownMenuItem onSelect={onCopyMarkdown}>
										Markdown
									</DropdownMenuItem>
								</DropdownMenuSubContent>
							</DropdownMenuPortal>
						</DropdownMenuSub>
						<DropdownMenuSub>
							<DropdownMenuSubTrigger>
								<span className="size-4" />
								Export as…
							</DropdownMenuSubTrigger>
							<DropdownMenuPortal>
								<DropdownMenuSubContent>
									<DropdownMenuItem onSelect={onExportMarkdown}>
										Markdown (.md)
									</DropdownMenuItem>
									<DropdownMenuItem onSelect={onExportText}>
										Plain Text (.txt)
									</DropdownMenuItem>
								</DropdownMenuSubContent>
							</DropdownMenuPortal>
						</DropdownMenuSub>
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={onFind}>
							<SearchIcon />
							Find in note…
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={onReplace}>
							<span className="size-4" />
							Replace in note…
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							variant="destructive"
							onSelect={onDelete}
							disabled={!activeNotePath}
						>
							<Trash2Icon />
							Delete note
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</header>
	);
}

export const NoteHeader = memo(NoteHeaderInner);

/**
 * Visibility + locked gate for NoteHeader so Index does not subscribe to
 * activeNotePath just to show/hide the header chrome (plan 017).
 */
type NoteHeaderHostProps = Omit<NoteHeaderProps, "locked">;

function NoteHeaderHostInner(headerProps: NoteHeaderHostProps) {
	const activeNotePath = useAppStore((s) => s.activeNotePath);
	const zenMode = useEditorUiStore((s) => s.zenMode);
	const lockedNotePaths = useEditorUiStore((s) => s.lockedNotePaths);
	if (zenMode || !activeNotePath) return null;
	return (
		<NoteHeader {...headerProps} locked={lockedNotePaths.has(activeNotePath)} />
	);
}

export const NoteHeaderHost = memo(NoteHeaderHostInner);
