import type {
	PaperiteAppState,
	PageFormat,
	SidebarSortOrder,
	WorkspaceItem,
	WorkspaceSnapshot,
	WorkspaceSpace,
} from "@/lib/storage/types";
import { topLevelPath, unique } from "@/lib/workspace-paths";

export function normalizePageFormat(
	format: PageFormat | Partial<PageFormat> | undefined | null,
): PageFormat {
	return {
		indentation:
			format?.indentation === "first-line" || format?.firstLineIndent === true
				? "first-line"
				: format?.indentation === "hanging"
					? "hanging"
					: "none",
		lineHeight: format?.lineHeight === "1.5" ? "1.5" : "normal",
		paragraphSpacing:
			format?.paragraphSpacing === "spacious" ? "spacious" : "none",
	};
}

export function normalizeAppState(state: PaperiteAppState): PaperiteAppState {
	return {
		activeNotePath: state.activeNotePath ?? null,
		activeSpacePath: state.activeSpacePath || "Inbox",
		expandedFolders: unique(state.expandedFolders ?? []),
		openTabs: (state.openTabs ?? [])
			.filter((tab) => tab.path)
			.map((tab) => ({
				...tab,
				title: typeof tab.title === "string" ? tab.title : "",
				pinned: tab.pinned === true,
				preview: tab.preview === true,
			})),
		spaceColors: state.spaceColors ?? {},
		spaceIcons: state.spaceIcons ?? {},
		spaceOrder: unique(state.spaceOrder ?? []),
		spaceSortOrders: normalizeSpaceSortOrders(state.spaceSortOrders ?? {}),
		spaceFolderFirst: state.spaceFolderFirst ?? {},
		spacePreviewModes: state.spacePreviewModes ?? {},
		customItemOrders: normalizeCustomItemOrders(state.customItemOrders ?? {}),
		sidebarOpen: state.sidebarOpen ?? true,
		inboxViewMode: state.inboxViewMode === "grid" ? "grid" : "list",
		showNotePreview: state.showNotePreview !== false,
		closeButtonOnly: state.closeButtonOnly === true,
		syncSidebarWithActiveTab: state.syncSidebarWithActiveTab !== false,
		defaultPageFormat: normalizePageFormat(state.defaultPageFormat),
	};
}

export function reconcileAppState(
	state: PaperiteAppState,
	workspace: WorkspaceSnapshot,
): PaperiteAppState {
	const notePaths = collectNotePaths(workspace.spaces);
	const folderPaths = collectFolderPaths(workspace.spaces);
	const openTabs = state.openTabs.filter((tab) => notePaths.has(tab.path));
	const activeNotePath =
		state.activeNotePath && notePaths.has(state.activeNotePath)
			? state.activeNotePath
			: (openTabs[0]?.path ?? null);
	const activeSpacePath =
		state.activeSpacePath === "Trash"
			? "Trash"
			: state.activeSpacePath &&
					workspace.spaces.some((space) => space.path === state.activeSpacePath)
				? state.activeSpacePath
				: activeNotePath
					? topLevelPath(activeNotePath)
					: (workspace.spaces[0]?.path ?? "Inbox");

	return {
		activeNotePath,
		activeSpacePath,
		expandedFolders: state.expandedFolders.filter((path) =>
			folderPaths.has(path),
		),
		openTabs,
		spaceColors: state.spaceColors,
		spaceIcons: state.spaceIcons,
		spaceOrder: reconcileSpaceOrder(state.spaceOrder, workspace.spaces),
		spaceSortOrders: reconcileSpaceSortOrders(
			state.spaceSortOrders,
			workspace.spaces,
		),
		spaceFolderFirst: state.spaceFolderFirst,
		spacePreviewModes: state.spacePreviewModes,
		customItemOrders: reconcileCustomItemOrders(
			state.customItemOrders,
			workspace.spaces,
		),
		sidebarOpen: state.sidebarOpen,
		inboxViewMode: state.inboxViewMode,
		showNotePreview: state.showNotePreview,
		closeButtonOnly: state.closeButtonOnly,
		syncSidebarWithActiveTab: state.syncSidebarWithActiveTab,
		defaultPageFormat: state.defaultPageFormat,
	};
}

export function collectNotePaths(spaces: WorkspaceSpace[]) {
	const paths = new Set<string>();
	for (const space of spaces) {
		collectNotePathsFromItems(space.children, paths);
	}
	return paths;
}

function collectNotePathsFromItems(items: WorkspaceItem[], paths: Set<string>) {
	for (const item of items) {
		if (item.type === "note") {
			paths.add(item.path);
			continue;
		}
		collectNotePathsFromItems(item.children, paths);
	}
}

export function collectFolderPaths(spaces: WorkspaceSpace[]) {
	const paths = new Set(spaces.map((space) => space.path));
	for (const space of spaces) {
		collectFolderPathsFromItems(space.children, paths);
	}
	return paths;
}

function collectFolderPathsFromItems(
	items: WorkspaceItem[],
	paths: Set<string>,
) {
	for (const item of items) {
		if (item.type !== "folder") continue;
		paths.add(item.path);
		collectFolderPathsFromItems(item.children, paths);
	}
}

function reconcileSpaceOrder(spaceOrder: string[], spaces: WorkspaceSpace[]) {
	const paths = spaces
		.map((space) => space.path)
		.filter((path) => path !== "Inbox");
	const pathSet = new Set(paths);
	const reconciled = spaceOrder.filter((path) => pathSet.has(path));
	for (const path of paths) {
		if (!reconciled.includes(path)) reconciled.push(path);
	}
	return reconciled;
}

function normalizeSortOrder(
	order: SidebarSortOrder | undefined,
	spacePath: string,
): SidebarSortOrder {
	const normalized = isSortOrder(order) ? order : "newest";
	return spacePath === "Inbox" && normalized === "custom"
		? "newest"
		: normalized;
}

function normalizeSpaceSortOrders(
	spaceSortOrders: Record<string, SidebarSortOrder>,
) {
	return Object.fromEntries(
		Object.entries(spaceSortOrders)
			.filter(([, order]) => isSortOrder(order))
			.map(([spacePath, order]) => [
				spacePath,
				normalizeSortOrder(order, spacePath),
			]),
	) as Record<string, SidebarSortOrder>;
}

function reconcileSpaceSortOrders(
	spaceSortOrders: Record<string, SidebarSortOrder>,
	spaces: WorkspaceSpace[],
) {
	const spacePaths = new Set(spaces.map((space) => space.path));
	return Object.fromEntries(
		Object.entries(spaceSortOrders)
			.filter(
				([spacePath, order]) => spacePaths.has(spacePath) && isSortOrder(order),
			)
			.map(([spacePath, order]) => [
				spacePath,
				normalizeSortOrder(order, spacePath),
			]),
	) as Record<string, SidebarSortOrder>;
}

function normalizeCustomItemOrders(customItemOrders: Record<string, string[]>) {
	return Object.fromEntries(
		Object.entries(customItemOrders).filter(
			([parentPath, itemOrder]) =>
				topLevelPath(parentPath) !== "Inbox" && Array.isArray(itemOrder),
		),
	) as Record<string, string[]>;
}

function reconcileCustomItemOrders(
	customItemOrders: Record<string, string[]>,
	spaces: WorkspaceSpace[],
) {
	const itemPathsByParent = collectItemPathsByParent(spaces);
	const reconciled: Record<string, string[]> = {};
	for (const [parent, order] of Object.entries(customItemOrders)) {
		if (topLevelPath(parent) === "Inbox") continue;
		const childPaths = itemPathsByParent.get(parent);
		if (!childPaths) continue;
		const childPathSet = new Set(childPaths);
		const nextOrder = unique(order.filter((path) => childPathSet.has(path)));
		for (const path of childPaths) {
			if (!nextOrder.includes(path)) nextOrder.push(path);
		}
		reconciled[parent] = nextOrder;
	}
	return reconciled;
}

function collectItemPathsByParent(spaces: WorkspaceSpace[]) {
	const itemPathsByParent = new Map<string, string[]>();
	for (const space of spaces) {
		itemPathsByParent.set(
			space.path,
			space.children.map((item) => item.path),
		);
		collectItemPathsByParentFromItems(space.children, itemPathsByParent);
	}
	return itemPathsByParent;
}

function collectItemPathsByParentFromItems(
	items: WorkspaceItem[],
	itemPathsByParent: Map<string, string[]>,
) {
	for (const item of items) {
		if (item.type !== "folder") continue;
		itemPathsByParent.set(
			item.path,
			item.children.map((child) => child.path),
		);
		collectItemPathsByParentFromItems(item.children, itemPathsByParent);
	}
}

function isSortOrder(order: unknown): order is SidebarSortOrder {
	return (
		order === "newest" ||
		order === "oldest" ||
		order === "a-z" ||
		order === "z-a" ||
		order === "custom"
	);
}
