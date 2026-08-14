import { useCallback, useMemo, useRef } from "react";
import type { NotesEngine } from "@/lib/notes-engine";
import { getTrashEngine } from "@/lib/trash-engine";
import type { PageFormat, WorkspaceNote, WorkspaceSnapshot, PaperiteAppState } from "@/lib/storage/types";
import type { SaveStatus } from "@/lib/stores/editor-ui-store";
import {
	fileName,
	isSameOrChildPath,
	moveCustomItemOrders,
	moveDecorations,
	movePath,
	omitCustomItemOrders,
	omitDecoration,
	parentPath,
	stripNoteExtension,
	topLevelPath,
	unique,
} from "@/lib/workspace-paths";

type Ref<T> = { current: T };
type Options = {
	notesApi: NotesEngine | null;
	workspaceRef: Ref<WorkspaceSnapshot | null>;
	refreshWorkspace: () => Promise<void>;
	refreshTrash: () => Promise<void>;
	clearAutosavesForPath: (path: string) => void;
	moveNoteRuntimeState: (from: string, to: string) => void;
	setSaveStatus: (status: SaveStatus) => void;
	setAppState: (next: PaperiteAppState | ((state: PaperiteAppState) => PaperiteAppState)) => void;
	setNotePreviews: React.Dispatch<React.SetStateAction<Record<string, string>>>;
	setNoteTitleDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
	setPageFormats: React.Dispatch<React.SetStateAction<Record<string, PageFormat>>>;
	setNewlyCreatedFolderPath: React.Dispatch<React.SetStateAction<string | null>>;
	openNote: (item: WorkspaceNote, mode: "preview" | "fixed") => void;
};

export function useWorkspaceCommands(options: Options) {
	const optionsRef = useRef(options);
	optionsRef.current = options;
	const fail = (current: Options) => current.setSaveStatus("error");

	const createNote = useCallback(async (parentPath: string) => {
		const current = optionsRef.current;
		if (!current.notesApi) return;
		try {
			const note = await current.notesApi.createNote(parentPath, "Untitled");
			await current.refreshWorkspace();
			current.setNoteTitleDrafts((value) => ({ ...value, [note.path]: "" }));
			current.openNote({ type: "note", preview: "", updatedAt: Date.now(), pinned: false, ...note, title: "" }, "fixed");
		} catch { fail(current); }
	}, []);

	const createFolder = useCallback(async (parentPath: string) => {
		const current = optionsRef.current;
		if (!current.notesApi) return;
		try {
			const folder = await current.notesApi.createFolder(parentPath, "Untitled");
			current.setAppState((state) => ({ ...state, expandedFolders: unique([...state.expandedFolders, parentPath, folder.path]) }));
			await current.refreshWorkspace();
			current.setNewlyCreatedFolderPath(folder.path);
		} catch { fail(current); }
	}, []);

	const createSpace = useCallback(async (title: string, color: string, icon: string) => {
		const current = optionsRef.current;
		if (!current.notesApi) return;
		try {
			const space = await current.notesApi.createSpace(title);
			current.setAppState((state) => ({ ...state, activeSpacePath: space.path, spaceColors: { ...state.spaceColors, [space.path]: color }, spaceIcons: { ...state.spaceIcons, [space.path]: icon } }));
			await current.refreshWorkspace();
		} catch { fail(current); }
	}, []);

	const editSpace = useCallback(async (path: string, title: string, color: string, icon: string) => {
		const current = optionsRef.current;
		if (!current.notesApi || !title.trim()) return;
		try {
			const renamed = title.trim() === fileName(path) ? { path } : await current.notesApi.renameItem(path, title);
			if (renamed.path !== path) current.moveNoteRuntimeState(path, renamed.path);
			current.setAppState((state) => ({ ...state,
				activeNotePath: state.activeNotePath && isSameOrChildPath(path, state.activeNotePath) ? movePath(state.activeNotePath, path, renamed.path) : state.activeNotePath,
				activeSpacePath: state.activeSpacePath === path ? renamed.path : state.activeSpacePath,
				expandedFolders: state.expandedFolders.map((item) => isSameOrChildPath(path, item) ? movePath(item, path, renamed.path) : item),
				openTabs: state.openTabs.map((tab) => isSameOrChildPath(path, tab.path) ? { ...tab, path: movePath(tab.path, path, renamed.path) } : tab),
				spaceColors: { ...moveDecorations(state.spaceColors, path, renamed.path), [renamed.path]: color },
				spaceIcons: { ...moveDecorations(state.spaceIcons, path, renamed.path), [renamed.path]: icon },
				spaceSortOrders: moveDecorations(state.spaceSortOrders, path, renamed.path), spaceFolderFirst: moveDecorations(state.spaceFolderFirst, path, renamed.path), spacePreviewModes: moveDecorations(state.spacePreviewModes, path, renamed.path), customItemOrders: moveCustomItemOrders(state.customItemOrders, path, renamed.path),
			}));
			current.setNotePreviews((value) => moveDecorations(value, path, renamed.path));
			current.setNoteTitleDrafts((value) => moveDecorations(value, path, renamed.path));
			current.setPageFormats((value) => moveDecorations(value, path, renamed.path));
			await current.refreshWorkspace();
		} catch { fail(current); }
	}, []);

	const deleteSpace = useCallback(async (path: string) => {
		const current = optionsRef.current;
		if (!current.notesApi || path === "Inbox") return;
		try {
			current.clearAutosavesForPath(path); await current.notesApi.deleteItem(path);
			current.setAppState((state) => ({ ...state, activeNotePath: state.activeNotePath && isSameOrChildPath(path, state.activeNotePath) ? null : state.activeNotePath, activeSpacePath: state.activeSpacePath === path ? "Inbox" : state.activeSpacePath, expandedFolders: state.expandedFolders.filter((item) => !isSameOrChildPath(path, item)), openTabs: state.openTabs.filter((tab) => !isSameOrChildPath(path, tab.path)), spaceColors: omitDecoration(state.spaceColors, path), spaceIcons: omitDecoration(state.spaceIcons, path), spaceSortOrders: omitDecoration(state.spaceSortOrders, path), spaceFolderFirst: omitDecoration(state.spaceFolderFirst, path), spacePreviewModes: omitDecoration(state.spacePreviewModes, path), customItemOrders: omitCustomItemOrders(state.customItemOrders, path) }));
			current.setNotePreviews((value) => omitDecoration(value, path)); current.setNoteTitleDrafts((value) => omitDecoration(value, path)); current.setPageFormats((value) => omitDecoration(value, path)); await current.refreshWorkspace();
		} catch { fail(current); }
	}, []);

	const moveItem = useCallback(async (itemPath: string, nextParentPath: string) => {
		const current = optionsRef.current; if (!current.notesApi) return;
		try {
			const moved = await current.notesApi.moveItem(itemPath, nextParentPath); if (moved.path !== itemPath) current.moveNoteRuntimeState(itemPath, moved.path);
			current.setAppState((state) => ({ ...state, activeNotePath: state.activeNotePath && isSameOrChildPath(itemPath, state.activeNotePath) ? movePath(state.activeNotePath, itemPath, moved.path) : state.activeNotePath, activeSpacePath: state.activeNotePath && isSameOrChildPath(itemPath, state.activeNotePath) ? topLevelPath(moved.path) : state.activeSpacePath, expandedFolders: unique([...state.expandedFolders, nextParentPath]), openTabs: state.openTabs.map((tab) => isSameOrChildPath(itemPath, tab.path) ? { ...tab, path: movePath(tab.path, itemPath, moved.path) } : tab), customItemOrders: moveCustomItemOrders(state.customItemOrders, itemPath, moved.path) }));
			current.setNotePreviews((value) => moveDecorations(value, itemPath, moved.path)); current.setNoteTitleDrafts((value) => moveDecorations(value, itemPath, moved.path)); current.setPageFormats((value) => moveDecorations(value, itemPath, moved.path)); await current.refreshWorkspace();
		} catch { fail(current); }
	}, []);

	const renameItem = useCallback(async (path: string, title: string) => {
		const current = optionsRef.current; if (!current.notesApi || !title.trim()) return;
		try {
			const renamed = await current.notesApi.renameItem(path, title); const nextTitle = renamed.path === path ? title : stripNoteExtension(fileName(renamed.path)); if (renamed.path !== path) current.moveNoteRuntimeState(path, renamed.path);
			current.setAppState((state) => ({ ...state, activeNotePath: state.activeNotePath && isSameOrChildPath(path, state.activeNotePath) ? movePath(state.activeNotePath, path, renamed.path) : state.activeNotePath, activeSpacePath: state.activeSpacePath === path ? renamed.path : state.activeSpacePath, expandedFolders: state.expandedFolders.map((item) => isSameOrChildPath(path, item) ? movePath(item, path, renamed.path) : item), openTabs: state.openTabs.map((tab) => isSameOrChildPath(path, tab.path) ? { ...tab, path: movePath(tab.path, path, renamed.path), title: tab.path === path ? nextTitle : tab.title } : tab), customItemOrders: moveCustomItemOrders(state.customItemOrders, path, renamed.path) }));
			current.setNotePreviews((value) => moveDecorations(value, path, renamed.path)); current.setNoteTitleDrafts((value) => moveDecorations(value, path, renamed.path)); current.setPageFormats((value) => moveDecorations(value, path, renamed.path)); await current.refreshWorkspace();
		} catch { fail(current); }
	}, []);

	const deleteItem = useCallback(async (path: string) => {
		const current = optionsRef.current; if (!current.notesApi) return;
		try { current.clearAutosavesForPath(path); await current.notesApi.deleteItem(path); current.setAppState((state) => ({ ...state, activeNotePath: state.activeNotePath && isSameOrChildPath(path, state.activeNotePath) ? null : state.activeNotePath, expandedFolders: state.expandedFolders.filter((item) => !isSameOrChildPath(path, item)), openTabs: state.openTabs.filter((tab) => !isSameOrChildPath(path, tab.path)), customItemOrders: omitCustomItemOrders(state.customItemOrders, path) })); current.setNotePreviews((value) => omitDecoration(value, path)); current.setNoteTitleDrafts((value) => omitDecoration(value, path)); current.setPageFormats((value) => omitDecoration(value, path)); await current.refreshWorkspace(); } catch { fail(current); }
	}, []);

	const restoreTrashItem = useCallback(async (name: string) => { const current = optionsRef.current; const api = getTrashEngine(); if (!api) return; try { await api.restoreItem(name); await current.refreshTrash(); await current.refreshWorkspace(); } catch { fail(current); } }, []);
	const permanentDeleteItem = useCallback(async (name: string) => { const current = optionsRef.current; const api = getTrashEngine(); if (!api) return; try { await api.permanentDeleteItem(name); await current.refreshTrash(); } catch { fail(current); } }, []);
	const emptyTrash = useCallback(async () => { const current = optionsRef.current; const api = getTrashEngine(); if (!api) return; try { await api.emptyTrash(); await current.refreshTrash(); } catch { fail(current); } }, []);
	const toggleFolder = useCallback((path: string, open: boolean) => { const current = optionsRef.current; current.setAppState((state) => ({ ...state, expandedFolders: open ? unique([...state.expandedFolders, path]) : state.expandedFolders.filter((item) => item !== path) })); }, []);
	return useMemo(() => ({ createNote, createFolder, createSpace, editSpace, deleteSpace, moveItem, renameItem, deleteItem, restoreTrashItem, permanentDeleteItem, emptyTrash, toggleFolder }), [createNote, createFolder, createSpace, editSpace, deleteSpace, moveItem, renameItem, deleteItem, restoreTrashItem, permanentDeleteItem, emptyTrash, toggleFolder]);
}
