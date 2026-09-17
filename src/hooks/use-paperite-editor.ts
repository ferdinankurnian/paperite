import { useCallback, useMemo, useRef } from "react";
import { useActiveNoteActions } from "@/hooks/use-active-note-actions";
import { useActiveNoteLoader } from "@/hooks/use-active-note-loader";
import { useAppLifecycle } from "@/hooks/use-app-lifecycle";
import { useMenuEvents } from "@/hooks/use-menu-events";
import { useNoteAutosave } from "@/hooks/use-note-autosave";
import { useNoteCommands } from "@/hooks/use-note-commands";
import { useNoteKeyboard } from "@/hooks/use-note-keyboard";
import { useNotePrefetch } from "@/hooks/use-note-prefetch";
import { useNoteSession } from "@/hooks/use-note-session";
import { useWorkspaceCommands } from "@/hooks/use-workspace-commands";
import { useWorkspaceSession } from "@/hooks/use-workspace-session";
import {
	collectNotePaths,
	normalizeAppState,
	reconcileAppState,
} from "@/lib/app-state-reconcile";
import { createEmptyNoteContent } from "@/lib/note-content";
import { getNotesEngine } from "@/lib/notes-engine";
import type { NoteContent, PaperiteAppState } from "@/lib/storage/types";
import { useAppStore } from "@/lib/stores/app-store";
import {
	storeBumpContentEpoch,
	storeSetNewlyCreatedFolderPath,
	storeSetNotePreviews,
	storeSetPageFormats,
	storeSetTitleDrafts,
	storeSetTrashNotes,
	storeSetWorkspace,
	useEditorUiStore,
} from "@/lib/stores/editor-ui-store";
import { omitExact, resolveSpacePath } from "@/lib/workspace-paths";
import { updateWorkspaceNote } from "@/lib/workspace-tree";

export function usePaperiteEditor() {
	const notesApi = getNotesEngine();
	const setAppState = useCallback(
		(
			updater:
				| PaperiteAppState
				| ((previous: PaperiteAppState) => PaperiteAppState),
		) => {
			if (typeof updater === "function") {
				useAppStore.getState().update(updater);
			} else {
				useAppStore.getState().replace(updater);
			}
		},
		[],
	);
	const setSaveStatus = useEditorUiStore((state) => state.setSaveStatus);
	const didHydrate = useRef(false);
	const lastLoadedNote = useRef<string | null>(null);
	const lastPersistedContent = useRef("");
	const activeNotePathRef = useRef<string | null>(null);
	const noteContentRef = useRef<NoteContent>(createEmptyNoteContent());

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
	const noteContentCacheMap = noteContentCache.current;
	const commitNoteContent = useCallback(
		(path: string, content: NoteContent, refreshEditor = true) => {
			noteContentCacheMap.set(path, content);
			if (path === activeNotePathRef.current) {
				noteContentRef.current = content;
			}
			if (refreshEditor) storeBumpContentEpoch();
		},
		[noteContentCacheMap],
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

	const {
		setActiveSpacePath,
		reorderSpaces,
		reorderItems,
		openNote,
		closeTab,
		switchTab,
	} = useNoteCommands({
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
	const handleReplace = useCallback(
		(all: boolean) => {
			if (all) replaceAllInNote();
			else replaceInNote();
		},
		[replaceAllInNote, replaceInNote],
	);

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
				useEditorUiStore.getState().workspace,
			),
		);
	}, [workspaceCommands]);
	const createFolderFromActiveSpace = useCallback(() => {
		const space = resolveSpacePath(
			useAppStore.getState().activeSpacePath,
			useEditorUiStore.getState().workspace,
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
	useAppLifecycle({
		workspaceRef,
		loadedYNoteCache,
		flushSaveAndSync,
	});

	const spaceTitleFor = useCallback((spacePath: string) => {
		if (spacePath === "Inbox") return "Inbox";
		const space = useEditorUiStore
			.getState()
			.workspace?.spaces.find((entry) => entry.path === spacePath);
		return space?.title ?? spacePath;
	}, []);
	const completeSwitchBenchmark = useCallback((notePath: string) => {
		const benchmark = pendingSwitchBenchmark.current;
		if (!benchmark || benchmark.notePath !== notePath) return;
		pendingSwitchBenchmark.current = null;
		const duration = performance.now() - benchmark.start;
		console.info(
			`[paperite perf] ${benchmark.source} switch ${benchmark.direction === 1 ? "next" : "previous"} ${duration.toFixed(1)}ms ${notePath}`,
		);
	}, []);

	const sidebarProps = useMemo(
		() => ({
			onReorderItems: reorderItems,
			onCreateFolder: workspaceCommands.createFolder,
			onCreateNote: workspaceCommands.createNote,
			onCreateSpace: workspaceCommands.createSpace,
			onDeleteItem: workspaceCommands.deleteItem,
			onDeleteSpace: workspaceCommands.deleteSpace,
			onEditSpace: workspaceCommands.editSpace,
			onMoveItem: workspaceCommands.moveItem,
			onOpenNote: openNote,
			onPrefetchNote: prefetchNote,
			onRenameItem: workspaceCommands.renameItem,
			onReorderSpaces: reorderSpaces,
			onSelectSpace: setActiveSpacePath,
			onToggleFolder: workspaceCommands.toggleFolder,
			onRestoreItem: workspaceCommands.restoreTrashItem,
			onPermanentDeleteItem: workspaceCommands.permanentDeleteItem,
			onEmptyTrash: workspaceCommands.emptyTrash,
			onRenameComplete: handleRenameComplete,
		}),
		[
			handleRenameComplete,
			openNote,
			prefetchNote,
			reorderItems,
			reorderSpaces,
			setActiveSpacePath,
			workspaceCommands,
		],
	);

	const loadedYNotes = loadedYNoteCache.current;
	const contentCache = noteContentCache.current;
	const workspaceProps = useMemo(
		() => ({
			spaceTitleFor,
			onSelect: selectTab,
			onDoubleClick: fixTab,
			onClose: closeTab,
			onTogglePin: togglePinTab,
			onVerifySave: verifyNoteSave,
			onInfo: openActiveNoteInfo,
			onSetup: openSetupPanel,
			onPopout: popoutActiveNote,
			onFind: openFindPanel,
			onReplace: openReplacePanel,
			onDelete: deleteActiveNote,
			onCopyText: copyActiveNoteText,
			onCopyMarkdown: copyActiveNoteMarkdown,
			onExportMarkdown: exportActiveNoteMarkdown,
			onExportText: exportActiveNoteText,
			onFormat: updateActivePageFormat,
			onReplaceText: handleReplace,
			loadedYNotes,
			contentCache,
			onChange: updateNoteContent,
			onContentRendered: completeSwitchBenchmark,
			onContentSnapshot: registerNoteContentSnapshot,
			onRename: renameActiveNote,
			onTitleChange: updateActiveTitleDraft,
		}),
		[
			closeTab,
			completeSwitchBenchmark,
			copyActiveNoteMarkdown,
			copyActiveNoteText,
			deleteActiveNote,
			exportActiveNoteMarkdown,
			exportActiveNoteText,
			fixTab,
			handleReplace,
			openActiveNoteInfo,
			openFindPanel,
			openReplacePanel,
			openSetupPanel,
			popoutActiveNote,
			registerNoteContentSnapshot,
			renameActiveNote,
			selectTab,
			spaceTitleFor,
			togglePinTab,
			updateActivePageFormat,
			updateActiveTitleDraft,
			updateNoteContent,
			verifyNoteSave,
			loadedYNotes,
			contentCache,
		],
	);

	return useMemo(
		() => ({ notesApi, sidebarProps, workspaceProps }),
		[notesApi, sidebarProps, workspaceProps],
	);
}

export type PaperiteEditor = ReturnType<typeof usePaperiteEditor>;
