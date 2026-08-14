import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	type CSSProperties,
		useCallback,
	useEffect,
	useMemo,
	useRef,
	type ReactNode,
} from "react";
import { ActiveNotePane } from "@/components/active-note-pane";
import { AppSidebar } from "@/components/app-sidebar";
import { AppShell } from "@/components/app-shell";
import { FloatingNotePanel } from "@/components/floating-note-panel";
import { NoteHeaderHost } from "@/components/note-header";
import { NoteWorkspace } from "@/components/note-workspace";
import { SaveStatusBadge } from "@/components/save-status-badge";
import { useActiveNoteLoader } from "@/hooks/use-active-note-loader";
import { useNoteSession } from "@/hooks/use-note-session";
import { useNoteAutosave } from "@/hooks/use-note-autosave";
import { useWorkspaceSession } from "@/hooks/use-workspace-session";
import { useNoteCommands } from "@/hooks/use-note-commands";
import { useNoteKeyboard } from "@/hooks/use-note-keyboard";
import { useWorkspaceCommands } from "@/hooks/use-workspace-commands";
import { useActiveNoteActions } from "@/hooks/use-active-note-actions";
import { useNotePrefetch } from "@/hooks/use-note-prefetch";
import { useMenuEvents } from "@/hooks/use-menu-events";


import { SidebarHotkeys } from "@/components/sidebar-hotkeys";
import { clerk, loadClerk } from "@/lib/clerk";
import {
	createEmptyNoteContent,
} from "@/lib/note-content";
import { getNotesEngine } from "@/lib/notes-engine";
import {
	collectNotePaths,
	normalizeAppState,
	reconcileAppState,
} from "@/lib/app-state-reconcile";
import {
	omitExact,
	resolveSpacePath,
} from "@/lib/workspace-paths";
import { updateWorkspaceNote } from "@/lib/workspace-tree";
import {
	useAppStore,
} from "@/lib/stores/app-store";
import {
	storeBumpContentEpoch,
	storeSetWorkspace,
	storeSetNotePreviews,
	storeSetNewlyCreatedFolderPath,
	storeSetPageFormats,
	storeSetTitleDrafts,
	storeSetTrashNotes,
	useEditorUiStore,
} from "@/lib/stores/editor-ui-store";

export const Route = createFileRoute("/_main/")({
	beforeLoad: async () => {
		if (!import.meta.env.BETA_PAPERITE) return;

		await loadClerk();

		if (!clerk.isSignedIn) {
			throw redirect({ to: "/login" });
		}
	},
	component: Index,
});

/** Hides sidebar in zen without re-rendering Index (plan 017). */
function ZenAwareSidebar({ children }: { children: ReactNode }) {
	const zenMode = useEditorUiStore((s) => s.zenMode);
	if (zenMode) return null;
	return children;
}

function Index() {
	const notesApi = getNotesEngine();
	// workspace owned by editor-ui-store — AppSidebar subscribes (plan 017).
	// Plan 017: Index does NOT subscribe to activeNotePath — load + title live in
	// useActiveNoteLoader; header gate is NoteHeaderHost. Only open-tab *path set*
	// stays here for warm yDoc/content (title/pin/reorder must not hit Index).
	// open-tab path-set warm lives in useNotePrefetch (Index stays cold on close/switch).
	const setAppState = useCallback(
		(
			updater:
				| PaperiteAppState
				| ((prev: PaperiteAppState) => PaperiteAppState),
		) => {
			if (typeof updater === "function") {
				useAppStore.getState().update(updater);
			} else {
				useAppStore.getState().replace(updater);
			}
		},
		[],
	);
	// noteContent lives in noteContentRef + noteContentCache only (plan 017).
	// Load/replace/sync write refs/caches; readyEditorPaths / contentEpoch in store.
	// zenMode / pageFormats / lockedNotePaths owned by editor-ui-store (plan 017).
	const setSaveStatus = useEditorUiStore((s) => s.setSaveStatus);
	const didHydrate = useRef(false);
	const lastLoadedNote = useRef<string | null>(null);
	const lastPersistedContent = useRef("");
	const activeNotePathRef = useRef<string | null>(null);
	const noteContentRef = useRef<NoteContent>(createEmptyNoteContent());
	/** Live TipTap getters so force-save never misses in-flight keystrokes. */
	const {
		noteContentCache,
		noteLiveContentGetters,
		loadedYNoteCache,
		notePersistedCache,
		noteWriteQueue,
		readNoteOnce,
		loadYNoteOnce,
		enqueueNoteWrite,
	} = useNoteSession(notesApi);
	const {
		noteAutosaveTimers,
		yjsDerivedAutosaveTimers,
		clearAutosavesForPath,
		scheduleNoteAutosave,
		scheduleYjsDerivedAutosave,
		registerNoteContentSnapshot,
		flushSaveAndSync,
		verifyNoteSave,
		moveNoteRuntimeState,
	} = useNoteAutosave({
		notesApi,
		activeNotePathRef,
		lastPersistedContent,
		noteContentCache,
		noteLiveContentGetters,
		loadedYNoteCache,
		notePersistedCache,
		enqueueNoteWrite,
		setSaveStatus,
		setWorkspace: storeSetWorkspace,
		updateWorkspaceNote,
	});
	const commitNoteContent = useCallback(
		(path: string, content: NoteContent, refreshEditor = true) => {
			noteContentCache.current.set(path, content);
			if (path === activeNotePathRef.current) {
				noteContentRef.current = content;
			}
			if (refreshEditor) storeBumpContentEpoch();
		},
		[],
	);

	const { workspaceRef, refreshTrash, refreshWorkspace } = useWorkspaceSession({
		notesApi,
		noteContentRef,
		lastPersistedContent,
		activeNotePathRef,
		noteContentCache,
		notePersistedCache,
		setWorkspace: storeSetWorkspace,
		setNotePreviews: storeSetNotePreviews,
		setNoteTitleDrafts: storeSetTitleDrafts,
		commitNoteContent,
		setTrashNotes: storeSetTrashNotes,
		setSaveStatus,
		setAppState,
		didHydrate,
		normalizeAppState,
		reconcileAppState,
		collectNotePaths,
	});
	/** LRU order for non-open-tab warm entries (most-recent last). */
	const pendingSwitchBenchmark = useRef<{
		direction: 1 | -1;
		notePath: string;
		source: "benchmark" | "tabs";
		start: number;
	} | null>(null);

	const {
		syncOpenTabTitle,
		tryMarkEditorReady,
		touchWarm,
		pruneWarmCaches,
		prefetchNote,
	} = useNotePrefetch({
		notesApi,
		activeNotePathRef,
		noteContentCache,
		notePersistedCache,
		loadedYNoteCache,
		workspaceRef,
		readNoteOnce,
		loadYNoteOnce,
	});

	// activeNotePath subscription lives here — Index itself stays cold on warm switches.
	useActiveNoteLoader({
		notesApi,
		activeNotePathRef,
		lastLoadedNote,
		lastPersistedContent,
		noteContentRef,
		noteContentCache,
		notePersistedCache,
		noteWriteQueue,
		loadedYNoteCache,
		readNoteOnce,
		syncOpenTabTitle,
		tryMarkEditorReady,
		setNotePreviews: storeSetNotePreviews,
		setSaveStatus,
		omitExact,
	});

	const { setActiveSpacePath, reorderSpaces, reorderItems, openNote, closeTab, switchTab } = useNoteCommands({
		setAppState,
		touchWarm,
		pruneWarmCaches,
		pendingSwitchBenchmark,
		onPruneAssets: notesApi?.pruneAssets,
	});
	const workspaceCommands = useWorkspaceCommands({
		notesApi,
		workspaceRef,
		refreshWorkspace,
		refreshTrash,
		clearAutosavesForPath,
		moveNoteRuntimeState,
		setSaveStatus,
		setAppState,
		setNotePreviews: storeSetNotePreviews,
		setNoteTitleDrafts: storeSetTitleDrafts,
		setPageFormats: storeSetPageFormats,
		setNewlyCreatedFolderPath: storeSetNewlyCreatedFolderPath,
		openNote,
	});

	// Keep workspaceRef in sync with store (plan 015 / 017).
	useEffect(() => {
		workspaceRef.current = useEditorUiStore.getState().workspace;
		return useEditorUiStore.subscribe((state, prev) => {
			if (state.workspace !== prev.workspace) {
				workspaceRef.current = state.workspace;
			}
		});
	}, []);

	// Active-note load + document title owned by useActiveNoteLoader (plan 017).

	useEffect(
		() => () => {
			for (const timer of noteAutosaveTimers.current.values()) {
				window.clearTimeout(timer);
			}
			for (const timer of yjsDerivedAutosaveTimers.current.values()) {
				window.clearTimeout(timer);
			}
			noteAutosaveTimers.current.clear();
			yjsDerivedAutosaveTimers.current.clear();
		},
		[],
	);

	useEffect(
		() => () => {
			for (const note of loadedYNoteCache.current.values()) {
				note.destroy();
			}
			loadedYNoteCache.current.clear();
		},
		[],
	);



	const handleRenameComplete = useCallback(
		() => storeSetNewlyCreatedFolderPath(null),
		[],
	);

	const { openNoteInfo } = useMenuEvents({
		workspaceRef,
		workspaceCommands,
		refreshWorkspace,
	});

	const {
		renameActiveNote,
		deleteActiveNote,
		replaceInNote,
		replaceAllInNote,
		updateActiveTitleDraft,
		updateActivePageFormat,
		updateNoteContent,
		openSetupPanel,
		openFindPanel,
		openReplacePanel,
		selectTab,
		fixTab,
		togglePinTab,
		openActiveNoteInfo,
		popoutActiveNote,
		copyActiveNoteText,
		copyActiveNoteMarkdown,
		exportActiveNoteMarkdown,
		exportActiveNoteText,
	} = useActiveNoteActions({
		notesApi,
		activeNotePathRef,
		noteContentRef,
		noteContentCache,
		notePersistedCache,
		loadedYNoteCache,
		lastLoadedNote,
		lastPersistedContent,
		commitNoteContent,
		scheduleNoteAutosave,
		scheduleYjsDerivedAutosave,
		clearAutosavesForPath,
		closeTab,
		setAppState,
		setSaveStatus,
		refreshWorkspace,
		openNoteInfo,
	});

	const closeActiveTab = useCallback(() => {
		const path = useAppStore.getState().activeNotePath;
		if (path) closeTab(path);
	}, [closeTab]);
	const toggleZenMode = useCallback(
		() => window.dispatchEvent(new Event("paperite:toggle-zen-mode")),
		[],
	);
	const toggleSidebar = useCallback(
		() => window.dispatchEvent(new Event("paperite:toggle-sidebar")),
		[],
	);
	const createNoteFromActiveSpace = useCallback(() => {
		workspaceCommands.createNote(
			resolveSpacePath(
				useAppStore.getState().activeSpacePath,
				workspaceRef.current,
			),
		);
	}, [workspaceCommands]);
	const createFolderFromActiveSpace = useCallback(() => {
		const space = resolveSpacePath(
			useAppStore.getState().activeSpacePath,
			workspaceRef.current,
		);
		if (space !== "Inbox") void workspaceCommands.createFolder(space);
	}, [workspaceCommands]);

	useNoteKeyboard({
		flushSaveAndSync,
		createNote: createNoteFromActiveSpace,
		createFolder: createFolderFromActiveSpace,
		openSetup: openSetupPanel,
		openFind: openFindPanel,
		openReplace: openReplacePanel,
		switchTab,
		closeTab: closeActiveTab,
		toggleZenMode,
		toggleSidebar,
	});

	const spaceTitleFor = useCallback((spacePath: string) => {
		if (spacePath === "Inbox") return "Inbox";
		const space = useEditorUiStore
			.getState()
			.workspace?.spaces.find((entry) => entry.path === spacePath);
		return space?.title ?? spacePath;
	}, []);

	const sidebarProviderStyle = useMemo(
		() =>
			({
				"--sidebar-width": "14.5rem",
			}) as CSSProperties,
		[],
	);

	const completeSwitchBenchmark = useCallback((notePath: string) => {
		const benchmark = pendingSwitchBenchmark.current;
		if (!benchmark || benchmark.notePath !== notePath) return;
		pendingSwitchBenchmark.current = null;
		const duration = performance.now() - benchmark.start;
		console.info(
			`[paperite perf] ${benchmark.source} switch ${benchmark.direction === 1 ? "next" : "previous"} ${duration.toFixed(1)}ms ${notePath}`,
		);
	}, []);

	// Workspace command implementations are owned by useWorkspaceCommands above.
	// Keep these local aliases alive only while the remaining note-scoped commands
	// are migrated in the next extraction batch.

	if (!notesApi) {
		return (
			<div className="grid h-full place-items-center text-sm text-muted-foreground">
				{import.meta.env.PAPERITE_WEB
					? "Connecting to Paperite server..."
					: "Paperite needs the Electron shell to access local notes."}
			</div>
		);
	}

	return (
		<AppShell
			style={sidebarProviderStyle}
			sidebar={
				<ZenAwareSidebar>
					<SidebarHotkeys />
					<AppSidebar
						onReorderItems={reorderItems}
						onCreateFolder={workspaceCommands.createFolder}
						onCreateNote={workspaceCommands.createNote}
						onCreateSpace={workspaceCommands.createSpace}
						onDeleteItem={workspaceCommands.deleteItem}
						onDeleteSpace={workspaceCommands.deleteSpace}
						onEditSpace={workspaceCommands.editSpace}
						onMoveItem={workspaceCommands.moveItem}
						onOpenNote={openNote}
						onPrefetchNote={prefetchNote}
						onRenameItem={workspaceCommands.renameItem}
						onReorderSpaces={reorderSpaces}
						onSelectSpace={setActiveSpacePath}
						onToggleFolder={workspaceCommands.toggleFolder}
						onRestoreItem={workspaceCommands.restoreTrashItem}
						onPermanentDeleteItem={workspaceCommands.permanentDeleteItem}
						onEmptyTrash={workspaceCommands.emptyTrash}
						onRenameComplete={handleRenameComplete}
					/>
				</ZenAwareSidebar>
			}
		>
			<NoteWorkspace>
				<NoteHeaderHost
					spaceTitleFor={spaceTitleFor}
					onSelect={selectTab}
					onDoubleClick={fixTab}
					onClose={closeTab}
					onTogglePin={togglePinTab}
					saveStatus={<SaveStatusBadge onVerify={verifyNoteSave} />}
					onInfo={openActiveNoteInfo}
					onSetup={openSetupPanel}
					onPopout={popoutActiveNote}
					onFind={openFindPanel}
					onReplace={openReplacePanel}
					onDelete={deleteActiveNote}
					onCopyText={copyActiveNoteText}
					onCopyMarkdown={copyActiveNoteMarkdown}
					onExportMarkdown={exportActiveNoteMarkdown}
					onExportText={exportActiveNoteText}
				/>
				<FloatingNotePanel
					onFormat={updateActivePageFormat}
					onReplace={(all) => (all ? replaceAllInNote() : replaceInNote())}
				/>
				<ActiveNotePane
					loadedYNotes={loadedYNoteCache.current}
					contentCache={noteContentCache.current}
					onChange={updateNoteContent}
					onContentRendered={completeSwitchBenchmark}
					onContentSnapshot={registerNoteContentSnapshot}
					onRename={renameActiveNote}
					onTitleChange={updateActiveTitleDraft}
				/>
			</NoteWorkspace>
		</AppShell>
	);
}
