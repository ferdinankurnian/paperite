import { memo } from "react";
import type * as Y from "yjs";
import { NoteEditor } from "@/components/note-editor";
import type { NoteContent, PageFormat } from "@/lib/storage/types";
import { useAppStore } from "@/lib/stores/app-store";
import { useEditorUiStore } from "@/lib/stores/editor-ui-store";
import type { LoadedYNote } from "@/lib/y-note-store";

const MemoNoteEditor = memo(
	NoteEditor,
	(prev, next) =>
		prev.content === next.content &&
		prev.noteTitle === next.noteTitle &&
		prev.notePath === next.notePath &&
		prev.isActive === next.isActive &&
		prev.pageFormat === next.pageFormat &&
		prev.yDoc === next.yDoc &&
		prev.searchQuery === next.searchQuery &&
		prev.onChange === next.onChange &&
		prev.onContentRendered === next.onContentRendered &&
		prev.onContentSnapshot === next.onContentSnapshot &&
		prev.onRename === next.onRename &&
		prev.onTitleChange === next.onTitleChange,
);

const FALLBACK_PAGE_FORMAT: PageFormat = {
	firstLineIndent: false,
	lineHeight: "normal",
	paragraphSpacing: "default",
};

type ActiveNotePaneProps = {
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

/**
 * Owns openTabs + activeNotePath + defaultPageFormat + readyEditorPaths +
 * search query/enabled so Index does not pass them (plan 017 selective-render).
 */
function ActiveNotePaneInner({
	loadedYNotes,
	contentCache,
	onChange,
	onContentRendered,
	onContentSnapshot,
	onRename,
	onTitleChange,
}: ActiveNotePaneProps) {
	const openTabs = useAppStore((s) => s.openTabs);
	const activeNotePath = useAppStore((s) => s.activeNotePath);
	const defaultPageFormat =
		useAppStore((s) => s.defaultPageFormat) ?? FALLBACK_PAGE_FORMAT;
	const readyEditorPaths = useEditorUiStore((s) => s.readyEditorPaths);
	// Subscribe so programmatic content commits re-render this pane only.
	const contentEpoch = useEditorUiStore((s) => s.contentEpoch);
	void contentEpoch;
	const titleDrafts = useEditorUiStore((s) => s.titleDrafts);
	const pageFormats = useEditorUiStore((s) => s.pageFormats);
	const zenMode = useEditorUiStore((s) => s.zenMode);
	const findText = useEditorUiStore((s) => s.findText);
	const floatingPanelMode = useEditorUiStore((s) => s.floatingPanelMode);
	const searchEnabled =
		floatingPanelMode === "find" || floatingPanelMode === "replace";

	return (
		<section
			aria-label="Note editor"
			className="relative flex min-h-0 flex-1 overflow-hidden overscroll-contain"
			onKeyDown={(event) => {
				if (
					event.key.toLowerCase() === "b" &&
					(event.ctrlKey || event.metaKey)
				) {
					event.stopPropagation();
				}
			}}
		>
			{!activeNotePath ? (
				<div className="flex flex-1 items-center justify-center">
					<h1 className="font-brand text-5xl text-muted-foreground/50 select-none">
						Paperite
					</h1>
				</div>
			) : (
				openTabs.map((tab) => {
					const isActive = tab.path === activeNotePath;
					const isReady = readyEditorPaths.has(tab.path);
					const yNote = loadedYNotes.get(tab.path);
					const cachedContent = contentCache.get(tab.path);

					if (!isReady || !yNote || cachedContent === undefined) {
						if (!isActive) return null;
						return (
							<div
								key={tab.path}
								className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground"
							>
								Loading note...
							</div>
						);
					}

					const contentTitle =
						typeof cachedContent.title === "string"
							? cachedContent.title.trim()
							: "";
					const draft = titleDrafts[tab.path]?.trim();
					const tabTitle = draft
						? titleDrafts[tab.path]
						: contentTitle || tab.title || "Untitled";

					return (
						<div
							key={tab.path}
							className={
								isActive
									? "relative z-10 flex min-h-0 flex-1 overflow-hidden"
									: "pointer-events-none hidden overflow-hidden"
							}
							aria-hidden={!isActive}
							inert={!isActive ? true : undefined}
						>
							<MemoNoteEditor
								content={cachedContent}
								noteTitle={tabTitle}
								notePath={tab.path}
								isActive={isActive}
								pageFormat={pageFormats[tab.path] ?? defaultPageFormat}
								yDoc={yNote.doc as Y.Doc}
								searchQuery={isActive && searchEnabled ? findText : ""}
								zenMode={zenMode}
								onChange={onChange}
								onContentRendered={onContentRendered}
								onContentSnapshot={onContentSnapshot}
								onRename={onRename}
								onTitleChange={onTitleChange}
							/>
						</div>
					);
				})
			)}
		</section>
	);
}

export const ActiveNotePane = memo(
	ActiveNotePaneInner,
	(prev, next) =>
		prev.loadedYNotes === next.loadedYNotes &&
		prev.contentCache === next.contentCache &&
		prev.onChange === next.onChange &&
		prev.onContentRendered === next.onContentRendered &&
		prev.onContentSnapshot === next.onContentSnapshot &&
		prev.onRename === next.onRename &&
		prev.onTitleChange === next.onTitleChange,
);
