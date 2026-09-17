import { useCallback, useRef } from "react";
import type { NoteContent, PageFormat, PaperiteAppState } from "@/lib/storage/types";
import type { NotesEngine } from "@/lib/notes-engine";
import {
	noteContentText,
	noteContentToMarkdown,
	replaceInNoteContent,
	serializeNoteContentBody,
} from "@/lib/note-content";
import { addExport, updateExport } from "@/lib/export-queue";
import { useAppStore } from "@/lib/stores/app-store";
import {
	storeBumpContentEpoch,
	storeSetNotePreviews,
	storeSetPageFormats,
	storeSetTitleDrafts,
	useEditorUiStore,
	type NoteInfoTarget,
	type SaveStatus,
} from "@/lib/stores/editor-ui-store";
import {
	fileName,
	moveCustomItemOrders,
	moveDecorations,
	omitCustomItemOrders,
	omitExact,
	stripNoteExtension,
	topLevelPath,
} from "@/lib/workspace-paths";

const FALLBACK_PAGE_FORMAT: PageFormat = {
	indentation: "none",
	lineHeight: "normal",
	paragraphSpacing: "none",
};

type Ref<T> = { current: T };

type Options = {
	notesApi: NotesEngine | null;
	activeNotePathRef: Ref<string | null>;
	noteContentRef: Ref<NoteContent>;
	noteContentCache: Ref<Map<string, NoteContent>>;
	notePersistedCache: Ref<Map<string, NoteContent>>;
	loadedYNoteCache: Ref<Map<string, unknown>>;
	lastLoadedNote: Ref<string | null>;
	lastPersistedContent: Ref<string>;
	commitNoteContent: (
		path: string,
		content: NoteContent,
		refreshEditor?: boolean,
	) => void;
	scheduleNoteAutosave: (path: string, content: NoteContent) => void;
	scheduleYjsDerivedAutosave: (path: string, content: NoteContent) => void;
	clearAutosavesForPath: (path: string) => void;
	closeTab: (path: string, options?: { flush?: boolean }) => void;
	setAppState: (
		next: PaperiteAppState | ((state: PaperiteAppState) => PaperiteAppState),
	) => void;
	setSaveStatus: (status: SaveStatus) => void;
	refreshWorkspace: () => Promise<void>;
	openNoteInfo: (target: NoteInfoTarget) => void;
};

export function useActiveNoteActions(options: Options) {
	const optionsRef = useRef(options);
	optionsRef.current = options;

	const renameActiveNote = useCallback(async (title: string) => {
		const current = optionsRef.current;
		if (!current.notesApi || !current.activeNotePathRef.current) return;

		try {
			const previousPath = current.activeNotePathRef.current;
			const renamed = await current.notesApi.renameItem(previousPath, title);
			const nextTitle =
				renamed.path === previousPath
					? title
					: stripNoteExtension(fileName(renamed.path));

			const cachedContent =
				current.noteContentCache.current.get(previousPath);
			if (cachedContent !== undefined) {
				current.noteContentCache.current.set(renamed.path, cachedContent);
				current.noteContentCache.current.delete(previousPath);
				const persistedContent =
					current.notePersistedCache.current.get(previousPath);
				if (persistedContent !== undefined) {
					current.notePersistedCache.current.set(
						renamed.path,
						persistedContent,
					);
					current.notePersistedCache.current.delete(previousPath);
				}
				current.lastLoadedNote.current = renamed.path;
				current.lastPersistedContent.current =
					serializeNoteContentBody(cachedContent);
				if (renamed.path === previousPath) {
					const updated = { ...cachedContent, title: nextTitle };
					current.commitNoteContent(renamed.path, updated, true);
				} else {
					current.commitNoteContent(renamed.path, cachedContent, true);
				}
			}

			current.setAppState((state) => ({
				...state,
				activeNotePath: renamed.path,
				activeSpacePath: topLevelPath(renamed.path),
				openTabs: state.openTabs.map((tab) =>
					tab.path === previousPath
						? { ...tab, path: renamed.path, title: nextTitle }
						: tab,
				),
				customItemOrders: moveCustomItemOrders(
					state.customItemOrders,
					previousPath,
					renamed.path,
				),
			}));
			storeSetNotePreviews((previews) => {
				const { [previousPath]: preview, ...rest } = previews;
				return preview ? { ...rest, [renamed.path]: preview } : rest;
			});
			storeSetTitleDrafts((drafts) => {
				const { [previousPath]: _previousTitle, ...rest } = drafts;
				return { ...rest, [renamed.path]: nextTitle };
			});
			storeSetPageFormats((formats) =>
				moveDecorations(formats, previousPath, renamed.path),
			);
			await current.refreshWorkspace();
		} catch {
			current.setSaveStatus("error");
		}
	}, []);

	const deleteActiveNote = useCallback(async () => {
		const current = optionsRef.current;
		const notePath = useAppStore.getState().activeNotePath;
		if (!current.notesApi || !notePath) return;

		try {
			current.clearAutosavesForPath(notePath);
			await current.notesApi.deleteItem(notePath);
			current.closeTab(notePath, { flush: false });
			current.setAppState((state) => ({
				...state,
				customItemOrders: omitCustomItemOrders(
					state.customItemOrders,
					notePath,
				),
			}));
			storeSetNotePreviews((previews) => {
				const { [notePath]: _preview, ...rest } = previews;
				return rest;
			});
			storeSetTitleDrafts((drafts) => {
				const { [notePath]: _title, ...rest } = drafts;
				return rest;
			});
			storeSetPageFormats((formats) => omitExact(formats, notePath));
			await current.refreshWorkspace();
		} catch {
			current.setSaveStatus("error");
		}
	}, []);

	const replaceInNote = useCallback(() => {
		const current = optionsRef.current;
		const { findText, replaceText } = useEditorUiStore.getState();
		if (!findText) return;
		const path = current.activeNotePathRef.current;
		if (!path) return;
		const next = replaceInNoteContent(
			current.noteContentRef.current,
			findText,
			replaceText,
			false,
		);
		current.commitNoteContent(path, next, true);
		current.scheduleNoteAutosave(path, next);
	}, []);

	const replaceAllInNote = useCallback(() => {
		const current = optionsRef.current;
		const { findText, replaceText } = useEditorUiStore.getState();
		if (!findText) return;
		const path = current.activeNotePathRef.current;
		if (!path) return;
		const next = replaceInNoteContent(
			current.noteContentRef.current,
			findText,
			replaceText,
			true,
		);
		current.commitNoteContent(path, next, true);
		current.scheduleNoteAutosave(path, next);
	}, []);

	const updateActiveTitleDraft = useCallback((title: string) => {
		const notePath = optionsRef.current.activeNotePathRef.current;
		if (!notePath) return;
		useEditorUiStore.getState().setTitleDraft(notePath, title);
	}, []);

	const updateActivePageFormat = useCallback(
		(patch: Partial<PageFormat>) => {
			const notePath = optionsRef.current.activeNotePathRef.current;
			if (!notePath) return;
			const fallback =
				useAppStore.getState().defaultPageFormat ?? FALLBACK_PAGE_FORMAT;
			storeSetPageFormats((formats) => ({
				...formats,
				[notePath]: {
					...(formats[notePath] ?? fallback),
					...patch,
				},
			}));
		},
		[],
	);

	const updateNoteContent = useCallback(
		(
			nextContent: NoteContent,
			sourceNotePath: string | null,
			isUserEdit: boolean,
		) => {
			if (!sourceNotePath) return;
			const current = optionsRef.current;

			current.noteContentCache.current.set(sourceNotePath, nextContent);
			if (sourceNotePath === current.activeNotePathRef.current) {
				current.noteContentRef.current = nextContent;
			}

			if (isUserEdit) {
				const tab = useAppStore
					.getState()
					.openTabs.find((item) => item.path === sourceNotePath);
				if (tab?.preview) {
					current.setAppState((state) => ({
						...state,
						openTabs: state.openTabs.map((item) =>
							item.path === sourceNotePath
								? { ...item, preview: false }
								: item,
						),
					}));
				}
			} else {
				storeBumpContentEpoch();
			}

			if (current.loadedYNoteCache.current.has(sourceNotePath)) {
				current.scheduleYjsDerivedAutosave(sourceNotePath, nextContent);
				return;
			}

			current.scheduleNoteAutosave(sourceNotePath, nextContent);
		},
		[],
	);

	const openSetupPanel = useCallback(
		() => useEditorUiStore.getState().setFloatingPanelMode("format"),
		[],
	);
	const openFindPanel = useCallback(
		() => useEditorUiStore.getState().setFloatingPanelMode("find"),
		[],
	);
	const openReplacePanel = useCallback(
		() => useEditorUiStore.getState().setFloatingPanelMode("replace"),
		[],
	);

	const selectTab = useCallback((notePath: string) => {
		optionsRef.current.setAppState((state) => {
			if (state.activeNotePath === notePath) return state;
			return {
				...state,
				activeNotePath: notePath,
				activeSpacePath: state.syncSidebarWithActiveTab
					? topLevelPath(notePath)
					: state.activeSpacePath,
			};
		});
	}, []);

	const fixTab = useCallback((notePath: string) => {
		optionsRef.current.setAppState((state) => {
			const tab = state.openTabs.find((t) => t.path === notePath);
			if (!tab?.preview) return state;
			return {
				...state,
				openTabs: state.openTabs.map((t) =>
					t.path === notePath ? { ...t, preview: false } : t,
				),
			};
		});
	}, []);

	const togglePinTab = useCallback((notePath: string) => {
		optionsRef.current.setAppState((state) => {
			const tab = state.openTabs.find((t) => t.path === notePath);
			if (!tab) return state;
			return {
				...state,
				openTabs: state.openTabs.map((t) =>
					t.path === notePath
						? { ...t, pinned: !t.pinned, preview: false }
						: t,
				),
			};
		});
	}, []);

	const exportActiveNote = useCallback((format: "markdown" | "txt") => {
		const path = useAppStore.getState().activeNotePath;
		const tab = path
			? useAppStore.getState().openTabs.find((t) => t.path === path)
			: undefined;
		const draft = path
			? useEditorUiStore.getState().titleDrafts[path]?.trim()
			: undefined;
		const title = (draft || tab?.title || "Untitled").trim() || "Untitled";
		const content = optionsRef.current.noteContentRef.current;
		const text =
			format === "markdown"
				? noteContentToMarkdown(content)
				: noteContentText(content);
		const id = addExport({ noteTitle: title, format, destPath: null });
		updateExport(id, { status: "writing" });
		window.electron?.notes
			.exportFile(text, format, title)
			.then((result) => {
				if (result.canceled) updateExport(id, { status: "cancelled" });
				else
					updateExport(id, {
						status: "done",
						destPath: result.filePath ?? null,
					});
			})
			.catch((error) =>
				updateExport(id, { status: "error", error: String(error) }),
			);
	}, []);

	const openActiveNoteInfo = useCallback(() => {
		const path = useAppStore.getState().activeNotePath;
		if (!path) return;
		const tab = useAppStore.getState().openTabs.find((t) => t.path === path);
		const draft = useEditorUiStore.getState().titleDrafts[path]?.trim();
		optionsRef.current.openNoteInfo({
			path,
			title: draft || tab?.title || "Untitled",
		});
	}, []);

	const popoutActiveNote = useCallback(() => {
		const path = useAppStore.getState().activeNotePath;
		if (!path || !window.electron) return;
		void window.electron.notes.popoutNote(path).then(() => {
			useEditorUiStore.getState().addLockedNotePath(path);
		});
	}, []);

	const copyActiveNoteText = useCallback(() => {
		void navigator.clipboard.writeText(
			noteContentText(optionsRef.current.noteContentRef.current),
		);
	}, []);

	const copyActiveNoteMarkdown = useCallback(() => {
		void navigator.clipboard.writeText(
			noteContentToMarkdown(optionsRef.current.noteContentRef.current),
		);
	}, []);

	const exportActiveNoteMarkdown = useCallback(
		() => exportActiveNote("markdown"),
		[exportActiveNote],
	);
	const exportActiveNoteText = useCallback(
		() => exportActiveNote("txt"),
		[exportActiveNote],
	);

	return {
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
		exportActiveNote,
		openActiveNoteInfo,
		popoutActiveNote,
		copyActiveNoteText,
		copyActiveNoteMarkdown,
		exportActiveNoteMarkdown,
		exportActiveNoteText,
	};
}
