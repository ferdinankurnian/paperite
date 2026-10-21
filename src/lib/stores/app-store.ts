import { create } from "zustand";
import {
	bindSpaceToTarget,
	type ConnectionMetadata,
	LOCAL_ONLY_TARGET,
	type SpaceSyncTarget,
} from "@/lib/space-sync-targets";
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
	syncSidebarWithActiveTab: true,
	defaultPageFormat: {
		indentation: "none",
		lineHeight: "normal",
		paragraphSpacing: "none",
		dragHandle: false,
	},
	connections: {},
	spaceSyncTargets: {},
	cloudSeenUpdates: {},
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
	setSyncSidebarWithActiveTab: (sync: boolean) => void;
	setDefaultPageFormat: (format: PageFormat | Partial<PageFormat>) => void;
	setSpacePreviewMode: (spacePath: string, mode: SpacePreviewMode) => void;
	setSpaceSortOrder: (spacePath: string, order: SidebarSortOrder) => void;
	setSpaceFolderFirst: (spacePath: string, folderFirst: boolean) => void;
	setConnection: (connection: ConnectionMetadata) => void;
	removeConnection: (connectionId: string) => void;
	setSpaceSyncTarget: (
		spacePath: string,
		target: Omit<SpaceSyncTarget, "updatedAt">,
	) => void;
	removeSpaceSyncTarget: (spacePath: string) => void;
	setLocalOnly: (spacePath: string) => void;
	setCloudSpaceLink: (spacePath: string, spaceId: string) => void;
	removeCloudSpaceLink: (spacePath: string) => void;
	addSeenCloudUpdates: (key: string, updateIds: string[]) => void;
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
		syncSidebarWithActiveTab: s.syncSidebarWithActiveTab,
		defaultPageFormat: s.defaultPageFormat,
		connections: s.connections,
		spaceSyncTargets: s.spaceSyncTargets,
		cloudSeenUpdates: s.cloudSeenUpdates,
	};
}

export const useAppStore = create<AppStore>((set, get) => ({
	...defaultAppState,

	replace: (next) => set({ ...next }),

	update: (fn) => {
		const current = pickState(get());
		const next = fn(current);
		if (next === current) return;
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
	setSyncSidebarWithActiveTab: (sync) =>
		set({ syncSidebarWithActiveTab: sync }),
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

	setConnection: (connection) =>
		set((s) => ({
			connections: { ...s.connections, [connection.connectionId]: connection },
		})),

	removeConnection: (connectionId) =>
		set((s) => {
			const nextConnections = { ...s.connections };
			delete nextConnections[connectionId];
			return { connections: nextConnections };
		}),

	setSpaceSyncTarget: (spacePath, target) =>
		set((s) => ({
			spaceSyncTargets: bindSpaceToTarget(s, spacePath, target),
		})),

	removeSpaceSyncTarget: (spacePath) =>
		set((s) => {
			if (!s.spaceSyncTargets[spacePath]) return s;
			const next = { ...s.spaceSyncTargets };
			delete next[spacePath];
			return { spaceSyncTargets: next };
		}),

	setLocalOnly: (spacePath) =>
		set((s) => ({
			spaceSyncTargets: bindSpaceToTarget(s, spacePath, LOCAL_ONLY_TARGET),
		})),

	setCloudSpaceLink: (spacePath, spaceId) =>
		set((s) => ({
			spaceSyncTargets: bindSpaceToTarget(s, spacePath, {
				kind: "paperite-cloud",
				remoteSpaceId: spaceId,
			}),
		})),

	removeCloudSpaceLink: (spacePath) =>
		set((s) => {
			if (!s.spaceSyncTargets[spacePath]) return s;
			const next = { ...s.spaceSyncTargets };
			delete next[spacePath];
			return { spaceSyncTargets: next };
		}),

	addSeenCloudUpdates: (key, updateIds) =>
		set((s) => {
			if (updateIds.length === 0) return s;
			const prev = s.cloudSeenUpdates[key] ?? [];
			const prevSet = new Set(prev);
			const fresh = updateIds.filter((id) => !prevSet.has(id));
			if (fresh.length === 0) return s;
			// Cap at 500 ids per note (plan 020 Step 3); keep the newest.
			const next = [...prev, ...fresh].slice(-500);
			return { cloudSeenUpdates: { ...s.cloudSeenUpdates, [key]: next } };
		}),
}));

/** Snapshot of persisted fields only (for writeAppState). */
export function getAppStateSnapshot(): PaperiteAppState {
	return pickState(useAppStore.getState());
}
