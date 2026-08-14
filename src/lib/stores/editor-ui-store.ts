import { create } from "zustand";
import type {
	PageFormat,
	TrashNote,
	WorkspaceSnapshot,
} from "@/lib/storage/types";

export type SaveStatus = "idle" | "saving" | "saved" | "error";
export type FloatingPanelMode = "find" | "format" | "info" | "replace" | null;
export type NoteInfoTarget = { path: string; title: string };

type RecordUpdater<T> = T | ((current: T) => T);

function applyRecordUpdate<T extends Record<string, unknown>>(
	current: T,
	next: RecordUpdater<T>,
): T {
	return typeof next === "function" ? (next as (c: T) => T)(current) : next;
}

type EditorUiStore = {
	saveStatus: SaveStatus;
	/** Epoch ms of the last successful local persist for the active note. */
	lastSavedAt: number | null;
	setSaveStatus: (
		next: SaveStatus | ((current: SaveStatus) => SaveStatus),
	) => void;
	/** Mark as saved and stamp the timestamp (force-save / autosave success). */
	markSaved: (at?: number) => void;
	/** Live title drafts while typing — keyed by note path. */
	titleDrafts: Record<string, string>;
	setTitleDraft: (path: string, title: string) => void;
	clearTitleDraft: (path: string) => void;
	moveTitleDraft: (fromPath: string, toPath: string) => void;
	/** Bulk replace / functional update (rename, delete, workspace sync). */
	setTitleDrafts: (next: RecordUpdater<Record<string, string>>) => void;
	/**
	 * Sidebar preview overlays — keyed by note path. Owned here so preview
	 * updates do not re-render Index (plan 017).
	 */
	notePreviews: Record<string, string>;
	setNotePreviews: (next: RecordUpdater<Record<string, string>>) => void;
	/**
	 * Paths whose content + yDoc are ready for a live TipTap instance.
	 * Owned here so Index does not re-render on mark/unmark (plan 017).
	 */
	readyEditorPaths: Set<string>;
	markEditorReady: (path: string) => void;
	unmarkEditorReady: (path: string) => void;
	/** Keep only paths present in `keep` (e.g. still-open tabs). */
	retainReadyEditorPaths: (keep: Set<string>) => void;
	/**
	 * Floating panel (find/replace/format/info) — owned here so opening the
	 * panel does not re-render Index / shell / sidebar (plan 017).
	 */
	floatingPanelMode: FloatingPanelMode;
	floatingPanelVisible: boolean;
	floatingPanelLastMode: FloatingPanelMode;
	findText: string;
	replaceText: string;
	noteInfoTarget: NoteInfoTarget | null;
	setFloatingPanelMode: (mode: FloatingPanelMode) => void;
	setFindText: (value: string) => void;
	setReplaceText: (value: string) => void;
	openNoteInfo: (target: NoteInfoTarget) => void;
	closeFloatingPanel: () => void;
	/** Per-note page format overrides (plan 017 — not Index state). */
	pageFormats: Record<string, PageFormat>;
	setPageFormats: (next: RecordUpdater<Record<string, PageFormat>>) => void;
	/** Zen mode + popout locks — owned outside Index. */
	zenMode: boolean;
	setZenMode: (next: boolean | ((current: boolean) => boolean)) => void;
	lockedNotePaths: Set<string>;
	addLockedNotePath: (path: string) => void;
	removeLockedNotePath: (path: string) => void;
	/**
	 * Bumped on programmatic content commits so ActiveNotePane memo sees
	 * cache mutations without Index re-rendering (plan 017).
	 */
	contentEpoch: number;
	bumpContentEpoch: () => void;
	/** Trash list + post-create folder rename focus (sidebar-owned). */
	trashNotes: TrashNote[];
	setTrashNotes: (
		next: TrashNote[] | ((prev: TrashNote[]) => TrashNote[]),
	) => void;
	newlyCreatedFolderPath: string | null;
	setNewlyCreatedFolderPath: (path: string | null) => void;
	/** Workspace tree — owned here so refresh does not re-render Index (plan 017). */
	workspace: WorkspaceSnapshot | null;
	setWorkspace: (
		next:
			| WorkspaceSnapshot
			| null
			| ((current: WorkspaceSnapshot | null) => WorkspaceSnapshot | null),
	) => void;
};

export const useEditorUiStore = create<EditorUiStore>((set, get) => ({
	saveStatus: "idle",
	lastSavedAt: null,
	setSaveStatus: (next) => {
		const value = typeof next === "function" ? next(get().saveStatus) : next;
		if (value === get().saveStatus) return;
		if (value === "saved") {
			set({ saveStatus: value, lastSavedAt: Date.now() });
			return;
		}
		set({ saveStatus: value });
	},
	markSaved: (at = Date.now()) => {
		set({ saveStatus: "saved", lastSavedAt: at });
	},

	titleDrafts: {},
	setTitleDraft: (path, title) => {
		const current = get().titleDrafts[path];
		if (current === title) return;
		set({ titleDrafts: { ...get().titleDrafts, [path]: title } });
	},
	clearTitleDraft: (path) => {
		if (!(path in get().titleDrafts)) return;
		const { [path]: _removed, ...rest } = get().titleDrafts;
		set({ titleDrafts: rest });
	},
	moveTitleDraft: (fromPath, toPath) => {
		const drafts = get().titleDrafts;
		if (!(fromPath in drafts) && !(toPath in drafts)) return;
		const { [fromPath]: value, ...rest } = drafts;
		if (value === undefined) {
			set({ titleDrafts: rest });
			return;
		}
		set({ titleDrafts: { ...rest, [toPath]: value } });
	},
	setTitleDrafts: (next) => {
		const value = applyRecordUpdate(get().titleDrafts, next);
		if (value === get().titleDrafts) return;
		set({ titleDrafts: value });
	},

	notePreviews: {},
	setNotePreviews: (next) => {
		const value = applyRecordUpdate(get().notePreviews, next);
		if (value === get().notePreviews) return;
		set({ notePreviews: value });
	},

	readyEditorPaths: new Set(),
	markEditorReady: (path) => {
		const current = get().readyEditorPaths;
		if (current.has(path)) return;
		const next = new Set(current);
		next.add(path);
		set({ readyEditorPaths: next });
	},
	unmarkEditorReady: (path) => {
		const current = get().readyEditorPaths;
		if (!current.has(path)) return;
		const next = new Set(current);
		next.delete(path);
		set({ readyEditorPaths: next });
	},
	retainReadyEditorPaths: (keep) => {
		const current = get().readyEditorPaths;
		let changed = false;
		const next = new Set<string>();
		for (const path of current) {
			if (keep.has(path)) next.add(path);
			else changed = true;
		}
		if (changed) set({ readyEditorPaths: next });
	},

	floatingPanelMode: null,
	floatingPanelVisible: false,
	floatingPanelLastMode: null,
	findText: "",
	replaceText: "",
	noteInfoTarget: null,
	setFloatingPanelMode: (mode) => {
		const current = get();
		if (mode === current.floatingPanelMode) return;
		if (mode) {
			set({
				floatingPanelMode: mode,
				floatingPanelVisible: true,
				floatingPanelLastMode: mode,
			});
			return;
		}
		// Closing: clear mode first; visible stays true until animation end
		// handled by FloatingNotePanel via closeFloatingPanel.
		set({ floatingPanelMode: null });
	},
	setFindText: (value) => {
		if (value === get().findText) return;
		set({ findText: value });
	},
	setReplaceText: (value) => {
		if (value === get().replaceText) return;
		set({ replaceText: value });
	},
	openNoteInfo: (target) => {
		set({
			noteInfoTarget: target,
			floatingPanelMode: "info",
			floatingPanelVisible: true,
			floatingPanelLastMode: "info",
		});
	},
	closeFloatingPanel: () => {
		const current = get();
		if (
			current.floatingPanelMode === null &&
			!current.floatingPanelVisible &&
			current.noteInfoTarget === null
		) {
			return;
		}
		set({
			floatingPanelMode: null,
			floatingPanelVisible: false,
			noteInfoTarget: null,
		});
	},

	pageFormats: {},
	setPageFormats: (next) => {
		const value = applyRecordUpdate(get().pageFormats, next);
		if (value === get().pageFormats) return;
		set({ pageFormats: value });
	},

	zenMode: false,
	setZenMode: (next) => {
		const value = typeof next === "function" ? next(get().zenMode) : next;
		if (value === get().zenMode) return;
		if (value) {
			set({ zenMode: true, floatingPanelMode: null });
			return;
		}
		set({ zenMode: false });
	},

	lockedNotePaths: new Set(),
	addLockedNotePath: (path) => {
		const current = get().lockedNotePaths;
		if (current.has(path)) return;
		const next = new Set(current);
		next.add(path);
		set({ lockedNotePaths: next });
	},
	removeLockedNotePath: (path) => {
		const current = get().lockedNotePaths;
		if (!current.has(path)) return;
		const next = new Set(current);
		next.delete(path);
		set({ lockedNotePaths: next });
	},

	contentEpoch: 0,
	bumpContentEpoch: () => {
		set({ contentEpoch: get().contentEpoch + 1 });
	},

	trashNotes: [],
	setTrashNotes: (next) => {
		const value = typeof next === "function" ? next(get().trashNotes) : next;
		if (value === get().trashNotes) return;
		set({ trashNotes: value });
	},
	newlyCreatedFolderPath: null,
	setNewlyCreatedFolderPath: (path) => {
		if (path === get().newlyCreatedFolderPath) return;
		set({ newlyCreatedFolderPath: path });
	},

	workspace: null,
	setWorkspace: (next) => {
		const value = typeof next === "function" ? next(get().workspace) : next;
		if (value === get().workspace) return;
		set({ workspace: value });
	},
}));

/** React.Dispatch-compatible adapters for hooks that still take setters. */
export function storeSetNotePreviews(
	next:
		| Record<string, string>
		| ((prev: Record<string, string>) => Record<string, string>),
) {
	useEditorUiStore.getState().setNotePreviews(next);
}

export function storeSetTitleDrafts(
	next:
		| Record<string, string>
		| ((prev: Record<string, string>) => Record<string, string>),
) {
	useEditorUiStore.getState().setTitleDrafts(next);
}

export function storeSetPageFormats(
	next:
		| Record<string, PageFormat>
		| ((prev: Record<string, PageFormat>) => Record<string, PageFormat>),
) {
	useEditorUiStore.getState().setPageFormats(next);
}

export function storeSetTrashNotes(
	next: TrashNote[] | ((prev: TrashNote[]) => TrashNote[]),
) {
	useEditorUiStore.getState().setTrashNotes(next);
}

export function storeSetNewlyCreatedFolderPath(path: string | null) {
	useEditorUiStore.getState().setNewlyCreatedFolderPath(path);
}

export function storeBumpContentEpoch() {
	useEditorUiStore.getState().bumpContentEpoch();
}

export function storeSetWorkspace(
	next:
		| WorkspaceSnapshot
		| null
		| ((current: WorkspaceSnapshot | null) => WorkspaceSnapshot | null),
) {
	useEditorUiStore.getState().setWorkspace(next);
}

export function saveStatusLabel(status: SaveStatus): string {
	if (status === "saving") return "Saving...";
	if (status === "saved") return "Saved";
	if (status === "error") return "Error";
	return "";
}

export function formatSavedAt(at: number | null, now = Date.now()): string {
	if (at == null) return "Not saved yet";
	const delta = Math.max(0, now - at);
	if (delta < 5_000) return "Just now";
	if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
	if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
	if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
	return new Date(at).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

export function formatSavedAtAbsolute(at: number | null): string {
	if (at == null) return "—";
	return new Date(at).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "medium",
	});
}
