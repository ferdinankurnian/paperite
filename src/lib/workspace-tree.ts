import type {
	WorkspaceItem,
	WorkspaceNote,
	WorkspaceSnapshot,
	WorkspaceSpace,
} from "@/lib/storage/types";

export function updateWorkspaceNote(
	workspace: WorkspaceSnapshot,
	notePath: string,
	patch: Pick<WorkspaceNote, "preview" | "updatedAt">,
): WorkspaceSnapshot {
	let changed = false;
	const spaces = workspace.spaces.map((space) => {
		const children = updateWorkspaceItems(space.children, notePath, patch);
		// Untouched spaces keep their identity so sidebar memos (space rail,
		// per-space lists) bail out instead of re-rendering every row.
		if (children === space.children) return space;
		changed = true;
		return { ...space, children };
	});
	if (!changed) return workspace;
	return {
		...workspace,
		spaces,
	};
}

function updateWorkspaceItems(
	items: WorkspaceItem[],
	notePath: string,
	patch: Pick<WorkspaceNote, "preview" | "updatedAt">,
): WorkspaceItem[] {
	let changed = false;
	const nextItems = items.map((item) => {
		if (item.type === "note") {
			if (item.path !== notePath) return item;
			changed = true;
			return { ...item, ...patch };
		}
		const children = updateWorkspaceItems(item.children, notePath, patch);
		if (children === item.children) return item;
		changed = true;
		return { ...item, children };
	});
	if (!changed) return items;
	return nextItems;
}

/**
 * True when two snapshots carry the same tree (paths, titles, previews,
 * pins, order) — ignoring `updatedAt`, which the indexer bumps on every
 * write including our own autosaves.
 *
 * Used to swallow self-triggered `workspace:changed` events: our own save
 * already patched the preview via `updateWorkspaceNote`, so swapping in a
 * brand-new tree would bust every sidebar memo (and every app-store
 * subscriber) for zero new information — that was the full-page re-render
 * on every save while typing.
 */
export function isWorkspaceContentEqual(
	a: WorkspaceSnapshot | null,
	b: WorkspaceSnapshot | null,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	if (a.rootPath !== b.rootPath) return false;
	if (a.spaces.length !== b.spaces.length) return false;
	return a.spaces.every((space, index) => {
		const other = b.spaces[index];
		return (
			other !== undefined &&
			space.title === other.title &&
			space.path === other.path &&
			areWorkspaceItemsEqual(space.children, other.children)
		);
	});
}

/**
 * Content equality for a bare spaces array (same tree ignoring `updatedAt`).
 * Used by sidebar memo comparators so a fresh array identity from a
 * preview-only patch doesn't re-render rails/headers whose content is
 * unchanged.
 */
export function areWorkspaceSpacesEqual(
	a: WorkspaceSpace[],
	b: WorkspaceSpace[],
): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	return a.every((space, index) => {
		const other = b[index];
		return (
			other !== undefined &&
			space.title === other.title &&
			space.path === other.path &&
			areWorkspaceItemsEqual(space.children, other.children)
		);
	});
}

function areWorkspaceItemsEqual(
	a: WorkspaceItem[],
	b: WorkspaceItem[],
): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	return a.every((item, index) => {
		const other = b[index];
		if (other === undefined || item.type !== other.type) return false;
		if (item.path !== other.path || item.title !== other.title) return false;
		if (item.type === "note" && other.type === "note") {
			return item.preview === other.preview && item.pinned === other.pinned;
		}
		if (item.type === "folder" && other.type === "folder") {
			return areWorkspaceItemsEqual(item.children, other.children);
		}
		return false;
	});
}

/**
 * Structural equality for the space header: paths, titles, and tree shape.
 * Preview/pin text is irrelevant to the header, so a preview-only autosave
 * patch must not re-render it while typing.
 */
export function areWorkspaceSpaceHeadersEqual(
	a: WorkspaceSpace[],
	b: WorkspaceSpace[],
): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	return a.every((space, index) => {
		const other = b[index];
		return (
			other !== undefined &&
			space.path === other.path &&
			space.title === other.title &&
			areWorkspaceStructureEqual(space.children, other.children)
		);
	});
}

function areWorkspaceStructureEqual(
	a: WorkspaceItem[],
	b: WorkspaceItem[],
): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	return a.every((item, index) => {
		const other = b[index];
		if (other === undefined || item.type !== other.type) return false;
		if (item.path !== other.path || item.title !== other.title) return false;
		if (item.type === "folder" && other.type === "folder") {
			return areWorkspaceStructureEqual(item.children, other.children);
		}
		return item.type === "note" && other.type === "note";
	});
}

export type WorkspaceNoteDiff = {
	/**
	 * True on add/remove/rename/pin/structure changes — the sidebar must
	 * take the incoming tree. False when notes only differ in preview text.
	 */
	structural: boolean;
	/** Note paths whose preview differs (updatedAt intentionally ignored). */
	changedNotePaths: string[];
};

/**
 * Diff two snapshots for the file-watcher echo path. Our own autosave just
 * wrote note.json and already patched the preview optimistically, so when
 * the watcher echo arrives mid-typing the disk tree is stale on exactly the
 * notes we're still editing. Callers skip the tree swap when every changed
 * path is dirty in memory — our tree is fresher — instead of busting every
 * sidebar memo with all-new object identities for zero new information.
 */
export function diffWorkspaceNotes(
	current: WorkspaceSnapshot | null,
	incoming: WorkspaceSnapshot | null,
): WorkspaceNoteDiff {
	const changedNotePaths: string[] = [];
	if (current === incoming) return { structural: false, changedNotePaths };
	if (!current || !incoming) return { structural: true, changedNotePaths };
	if (current.rootPath !== incoming.rootPath) {
		return { structural: true, changedNotePaths };
	}
	if (current.spaces.length !== incoming.spaces.length) {
		return { structural: true, changedNotePaths };
	}
	for (let i = 0; i < current.spaces.length; i++) {
		const a = current.spaces[i];
		const b = incoming.spaces[i];
		if (!a || !b || a.path !== b.path || a.title !== b.title) {
			return { structural: true, changedNotePaths };
		}
		if (!diffWorkspaceItems(a.children, b.children, changedNotePaths)) {
			return { structural: true, changedNotePaths };
		}
	}
	return { structural: false, changedNotePaths };
}

function diffWorkspaceItems(
	a: WorkspaceItem[],
	b: WorkspaceItem[],
	changedNotePaths: string[],
): boolean {
	if (a === b) return true;
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		const itemA = a[i];
		const itemB = b[i];
		if (
			itemA === undefined ||
			itemB === undefined ||
			itemA.type !== itemB.type ||
			itemA.path !== itemB.path ||
			itemA.title !== itemB.title
		) {
			return false;
		}
		if (itemA.type === "note" && itemB.type === "note") {
			if (itemA.pinned !== itemB.pinned) return false;
			if (itemA.preview !== itemB.preview) {
				changedNotePaths.push(itemA.path);
			}
			continue;
		}
		if (itemA.type === "folder" && itemB.type === "folder") {
			if (
				!diffWorkspaceItems(itemA.children, itemB.children, changedNotePaths)
			) {
				return false;
			}
			continue;
		}
		return false;
	}
	return true;
}
