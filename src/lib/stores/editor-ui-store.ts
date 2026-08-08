import { create } from "zustand";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

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
}));

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
