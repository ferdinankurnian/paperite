import { create } from "zustand";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

type EditorUiStore = {
	saveStatus: SaveStatus;
	setSaveStatus: (
		next: SaveStatus | ((current: SaveStatus) => SaveStatus),
	) => void;
	/** Live title drafts while typing — keyed by note path. */
	titleDrafts: Record<string, string>;
	setTitleDraft: (path: string, title: string) => void;
	clearTitleDraft: (path: string) => void;
	moveTitleDraft: (fromPath: string, toPath: string) => void;
};

export const useEditorUiStore = create<EditorUiStore>((set, get) => ({
	saveStatus: "idle",
	setSaveStatus: (next) => {
		const value = typeof next === "function" ? next(get().saveStatus) : next;
		if (value === get().saveStatus) return;
		set({ saveStatus: value });
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
