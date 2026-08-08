import { create } from "zustand";
import type {
	OpenNoteTab,
	PageFormat,
	PaperiteAppState,
	SidebarSortOrder,
	SpacePreviewMode,
} from "@/lib/storage/types";

export const defaultAppState: PaperiteAppState = {
	activeNotePath: null,
	activeSpacePath: "Inbox",
	expandedFolders: [],
	openTabs: [],
	spaceColors: {},
	spaceIcons: {},
	spaceOrder: [],
	spaceSortOrders: {},
	spaceFolderFirst: {},
	spacePreviewModes: {},
	customItemOrders: {},
	sidebarOpen: true,
	inboxViewMode: "list",
	showNotePreview: true,
	closeButtonOnly: false,
	defaultPageFormat: {
		firstLineIndent: false,
		lineHeight: "normal",
		paragraphSpacing: "default",
	},
};

type AppStore = PaperiteAppState & {
	/** Replace entire state (hydrate / reconcile). */
	replace: (next: PaperiteAppState) => void;
	/** Functional update matching React's setState(prev => next). */
	update: (fn: (prev: PaperiteAppState) => PaperiteAppState) => void;
	setActiveNotePath: (path: string | null) => void;
	setActiveSpacePath: (path: string) => void;
	setOpenTabs: (tabs: OpenNoteTab[]) => void;
	setExpandedFolders: (paths: string[]) => void;
	setSidebarOpen: (open: boolean) => void;
	setInboxViewMode: (mode: "list" | "grid") => void;
	setShowNotePreview: (show: boolean) => void;
	setCloseButtonOnly: (only: boolean) => void;
	setDefaultPageFormat: (format: PageFormat | Partial<PageFormat>) => void;
	setSpacePreviewMode: (spacePath: string, mode: SpacePreviewMode) => void;
	setSpaceSortOrder: (spacePath: string, order: SidebarSortOrder) => void;
	setSpaceFolderFirst: (spacePath: string, folderFirst: boolean) => void;
};

function pickState(s: AppStore): PaperiteAppState {
	return {
		openTabs: s.openTabs,
		activeNotePath: s.activeNotePath,
		activeSpacePath: s.activeSpacePath,
		expandedFolders: s.expandedFolders,
		spaceColors: s.spaceColors,
		spaceIcons: s.spaceIcons,
		spaceOrder: s.spaceOrder,
		spaceSortOrders: s.spaceSortOrders,
		spaceFolderFirst: s.spaceFolderFirst,
		spacePreviewModes: s.spacePreviewModes,
		customItemOrders: s.customItemOrders,
		sidebarOpen: s.sidebarOpen,
		inboxViewMode: s.inboxViewMode,
		showNotePreview: s.showNotePreview,
		closeButtonOnly: s.closeButtonOnly,
		defaultPageFormat: s.defaultPageFormat,
	};
}

export const useAppStore = create<AppStore>((set, get) => ({
	...defaultAppState,

	replace: (next) => set({ ...next }),

	update: (fn) => {
		const next = fn(pickState(get()));
		set({ ...next });
	},

	setActiveNotePath: (path) => set({ activeNotePath: path }),
	setActiveSpacePath: (path) => set({ activeSpacePath: path }),
	setOpenTabs: (tabs) => set({ openTabs: tabs }),
	setExpandedFolders: (paths) => set({ expandedFolders: paths }),
	setSidebarOpen: (open) =>
		set((s) => (s.sidebarOpen === open ? s : { sidebarOpen: open })),
	setInboxViewMode: (mode) => set({ inboxViewMode: mode }),
	setShowNotePreview: (show) => set({ showNotePreview: show }),
	setCloseButtonOnly: (only) => set({ closeButtonOnly: only }),
	setDefaultPageFormat: (format) =>
		set((s) => ({
			defaultPageFormat: { ...s.defaultPageFormat, ...format },
		})),

	setSpacePreviewMode: (spacePath, mode) =>
		set((s) => ({
			spacePreviewModes: { ...s.spacePreviewModes, [spacePath]: mode },
		})),

	setSpaceSortOrder: (spacePath, order) =>
		set((s) => ({
			spaceSortOrders: { ...s.spaceSortOrders, [spacePath]: order },
		})),

	setSpaceFolderFirst: (spacePath, folderFirst) =>
		set((s) => ({
			spaceFolderFirst: { ...s.spaceFolderFirst, [spacePath]: folderFirst },
		})),
}));

/** Snapshot of persisted fields only (for writeAppState). */
export function getAppStateSnapshot(): PaperiteAppState {
	return pickState(useAppStore.getState());
}
