/**
 * Note workspace shell (plan 015).
 *
 * Owns the editor-side chrome boundary opposite AppSidebar.
 * Session state stays in the route/hooks, but the workspace UI is composed
 * here so Index can stay out of the editor subtree when its own wiring updates.
 *
 * Tab strip is isolated in `tab-bar.tsx` (store subscription, no Index
 * re-render on reorder).
 * Space switch must not re-render this tree — Index no longer subscribes
 * to `activeSpacePath`.
 */
import { memo } from "react";
import { ActiveNotePane } from "@/components/active-note-pane";
import { FloatingNotePanel } from "@/components/floating-note-panel";
import { NoteHeaderHost } from "@/components/note-header";
import { SaveStatusBadge } from "@/components/save-status-badge";
import { SidebarInset } from "@/components/ui/sidebar";
import type { NoteContent, PageFormat } from "@/lib/storage/types";
import type { LoadedYNote } from "@/lib/y-note-store";

type VerifySave = () => Promise<{
	ok: boolean;
	message: string;
	detail?: string;
}>;

type NoteWorkspaceProps = {
	spaceTitleFor: (path: string) => string;
	onSelect: (path: string) => void;
	onDoubleClick: (path: string) => void;
	onClose: (path: string) => void;
	onTogglePin: (path: string) => void;
	onVerifySave: VerifySave;
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
	onFormat: (update: Partial<PageFormat>) => void;
	onReplaceText: (all: boolean) => void;
	loadedYNotes: Map<string, LoadedYNote>;
	contentCache: Map<string, NoteContent>;
	onChange: (
		content: NoteContent,
		notePath: string | null,
		isUserEdit: boolean,
	) => void;
	onContentRendered: (notePath: string) => void;
	onContentSnapshot: (
		notePath: string | null,
		getContent: (() => NoteContent) | null,
	) => void;
	onRename: (title: string) => void;
	onTitleChange: (title: string) => void;
};

export const NoteWorkspace = memo(function NoteWorkspace({
	spaceTitleFor,
	onSelect,
	onDoubleClick,
	onClose,
	onTogglePin,
	onVerifySave,
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
	onFormat,
	onReplaceText,
	loadedYNotes,
	contentCache,
	onChange,
	onContentRendered,
	onContentSnapshot,
	onRename,
	onTitleChange,
}: NoteWorkspaceProps) {
	return (
		<SidebarInset className="min-w-0 overflow-hidden">
			<NoteHeaderHost
				spaceTitleFor={spaceTitleFor}
				onSelect={onSelect}
				onDoubleClick={onDoubleClick}
				onClose={onClose}
				onTogglePin={onTogglePin}
				saveStatus={<SaveStatusBadge onVerify={onVerifySave} />}
				onInfo={onInfo}
				onSetup={onSetup}
				onPopout={onPopout}
				onFind={onFind}
				onReplace={onReplace}
				onDelete={onDelete}
				onCopyText={onCopyText}
				onCopyMarkdown={onCopyMarkdown}
				onExportMarkdown={onExportMarkdown}
				onExportText={onExportText}
			/>
			<FloatingNotePanel onFormat={onFormat} onReplace={onReplaceText} />
			<ActiveNotePane
				loadedYNotes={loadedYNotes}
				contentCache={contentCache}
				onChange={onChange}
				onContentRendered={onContentRendered}
				onContentSnapshot={onContentSnapshot}
				onRename={onRename}
				onTitleChange={onTitleChange}
			/>
		</SidebarInset>
	);
});
