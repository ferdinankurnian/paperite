"use client";

import {
	type CollisionDetection,
	DndContext,
	type DragEndEvent,
	type DragOverEvent,
	DragOverlay,
	type DragStartEvent,
	PointerSensor,
	pointerWithin,
	rectIntersection,
	useDndContext,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
	ArrowUpDownIcon,
	BookmarkIcon,
	BookOpenIcon,
	BrainIcon,
	BriefcaseBusinessIcon,
	CameraIcon,
	CheckIcon,
	ChevronDownIcon,
	CloudIcon,
	CodeIcon,
	CompassIcon,
	FileTextIcon,
	FolderClosedIcon,
	FolderIcon,
	FolderOpenIcon,
	FolderPlusIcon,
	GemIcon,
	HeartIcon,
	InboxIcon,
	LayoutDashboardIcon,
	LightbulbIcon,
	ListIcon,
	MusicIcon,
	PencilIcon,
	PinIcon,
	RotateCcwIcon,
	SearchIcon,
	Settings2Icon,
	SparklesIcon,
	StarIcon,
	StickyNotePlusIcon,
	Trash2Icon,
	UserPlusIcon,
	UsersIcon,
	ZapIcon,
} from "lucide-react";
import * as React from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
	Avatar,
	AvatarFallback,
	AvatarGroup,
	AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarRail,
	SidebarTrigger,
	useSidebar,
} from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { clerk } from "@/lib/clerk";
import { getNotesEngine } from "@/lib/notes-engine";
import type { NoteSearchResult } from "@/lib/storage/types";
import { useAppStore } from "@/lib/stores/app-store";
import { useEditorUiStore } from "@/lib/stores/editor-ui-store";
import { cn } from "@/lib/utils";

// Per-path pub/sub store for folder expand/collapse state. A plain Set in
// Context would force EVERY consumer (every NoteTree/NoteFolderItem mounted
// anywhere in the sidebar) to re-render on any single toggle, since Context
// updates bypass React.memo for the component reading the context. Routing
// reads through useSyncExternalStore keyed by path means only the folder
// that actually changed re-renders.
class ExpandedFoldersStore {
	private expanded: Set<string>;
	private listeners = new Map<string, Set<() => void>>();

	constructor(initial: Iterable<string> = []) {
		this.expanded = new Set(initial);
	}

	isExpanded = (path: string) => this.expanded.has(path);

	subscribe = (path: string, listener: () => void) => {
		let set = this.listeners.get(path);
		if (!set) {
			set = new Set();
			this.listeners.set(path, set);
		}
		set.add(listener);
		return () => {
			set?.delete(listener);
		};
	};

	toggle = (path: string, isOpen: boolean) => {
		const wasOpen = this.expanded.has(path);
		if (isOpen === wasOpen) return;
		if (isOpen) this.expanded.add(path);
		else this.expanded.delete(path);
		this.listeners.get(path)?.forEach((listener) => listener());
	};

	replaceAll = (paths: Iterable<string>) => {
		const next = new Set(paths);
		const changedPaths = new Set<string>();
		for (const path of next) {
			if (!this.expanded.has(path)) changedPaths.add(path);
		}
		for (const path of this.expanded) {
			if (!next.has(path)) changedPaths.add(path);
		}
		this.expanded = next;
		for (const path of changedPaths) {
			this.listeners.get(path)?.forEach((listener) => listener());
		}
	};
}

const ExpandedFoldersContext = React.createContext<ExpandedFoldersStore>(
	new ExpandedFoldersStore(),
);

function useIsFolderExpanded(path: string) {
	const store = React.useContext(ExpandedFoldersContext);
	const forceExpandPaths = React.useContext(SearchExpandPathsContext);
	const expanded = React.useSyncExternalStore(
		React.useCallback((cb) => store.subscribe(path, cb), [store, path]),
		React.useCallback(() => store.isExpanded(path), [store, path]),
	);
	// While searching, keep match folders open without mutating saved expand state.
	return expanded || forceExpandPaths.has(path);
}

/** Show/hide a mounted space tree without re-rendering sibling trees. */
const SpaceVisibility = React.memo(function SpaceVisibility({
	path,
	children,
}: {
	path: string;
	children: React.ReactNode;
}) {
	const isActive = useAppStore((s) => s.activeSpacePath === path);
	return (
		<div
			className={isActive ? undefined : "hidden"}
			hidden={!isActive}
			aria-hidden={!isActive}
		>
			{children}
		</div>
	);
});

const TrashNavButton = React.memo(function TrashNavButton({
	onSelectSpace,
}: {
	onSelectSpace: (path: string) => void;
}) {
	const isActive = useAppStore((s) => s.activeSpacePath === "Trash");
	return (
		<button
			type="button"
			onClick={() => onSelectSpace("Trash")}
			className={cn(
				"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors",
				isActive
					? "bg-sidebar-accent text-sidebar-accent-foreground"
					: "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
			)}
		>
			<Trash2Icon className="size-4 shrink-0" />
			<span className="min-w-0 flex-1 truncate text-left">Trash</span>
		</button>
	);
});

const EMPTY_SPACES: WorkspaceSpace[] = [];

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
	/** Optional; defaults to workspace tree from editor-ui-store (plan 017). */
	spaces?: WorkspaceSpace[];
	spaceColors?: Record<string, string>;
	spaceIcons?: Record<string, string>;
	spacePreviewModes?: Record<string, SpacePreviewMode>;
	showNotePreview?: boolean;
	closeButtonOnly?: boolean;
	syncSidebarWithActiveTab?: boolean;
	onSetShowNotePreview?: (show: boolean) => void;
	onSetCloseButtonOnly?: (closeButtonOnly: boolean) => void;
	onSetSyncSidebarWithActiveTab?: (sync: boolean) => void;
	onSetSpacePreviewMode?: (spacePath: string, mode: SpacePreviewMode) => void;
	activeSpacePath?: string;
	expandedFolders?: string[];
	viewMode?: "list" | "grid";
	onViewModeChange?: (mode: "list" | "grid") => void;
	sortOrder?: SidebarSortOrder;
	onSortOrderChange?: (order: SidebarSortOrder) => void;
	folderFirst?: boolean;
	onFolderFirstChange?: (folderFirst: boolean) => void;
	customItemOrders?: Record<string, string[]>;
	onReorderItems: (parentPath: string, itemOrder: string[]) => void;
	onCreateFolder: (parentPath: string) => void;
	onCreateNote: (parentPath: string) => void;
	onCreateSpace: (title: string, color: string, icon: string) => void;
	onDeleteItem: (path: string) => void;
	onDeleteSpace: (path: string) => void;
	onMoveItem: (itemPath: string, nextParentPath: string) => void;
	onOpenNote: (note: WorkspaceNote, mode: "preview" | "fixed") => void;
	onPrefetchNote?: (path: string) => void;
	onRenameItem: (path: string, title: string) => void;
	onReorderSpaces: (spaceOrder: string[]) => void;
	onEditSpace: (
		path: string,
		title: string,
		color: string,
		icon: string,
	) => void;
	onSelectSpace: (path: string) => void;
	onToggleFolder: (path: string, isOpen: boolean) => void;
	onRestoreItem: (trashNoteName: string) => void;
	onPermanentDeleteItem: (trashNoteName: string) => void;
	onEmptyTrash: () => void;
	onRenameComplete: () => void;
};

type DragPreviewItem = {
	title: string;
	preview?: string;
	type: "folder" | "note";
};

const fallbackUser = {
	name: "Paperite user",
	avatar: "",
};

const SpaceIcon = ({
	className,
	color,
	icon,
	path,
}: {
	className?: string;
	color?: string;
	icon?: string;
	path: string;
}) => {
	if (path === "Inbox") return <InboxIcon className={className} />;
	const customIcon = getCustomIcon(icon);
	const iconClassName = cn("size-4 shrink-0", className);

	if (customIcon) {
		return (
			<img
				src={customIcon}
				alt=""
				className={iconClassName}
				style={{
					borderRadius: 4,
					objectFit: "cover",
				}}
			/>
		);
	}

	const Icon = spaceIconMap[icon as keyof typeof spaceIconMap] ?? CloudIcon;
	return (
		<Icon className={iconClassName} style={{ color: color ?? "#E94C08" }} />
	);
};

function filterWorkspaceItems(
	items: WorkspaceItem[],
	query: string,
): WorkspaceItem[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	if (!normalizedQuery) return items;

	const filteredItems: WorkspaceItem[] = [];

	for (const item of items) {
		if (item.type === "note") {
			if (
				item.title.toLocaleLowerCase().includes(normalizedQuery) ||
				(item.preview ?? "").toLocaleLowerCase().includes(normalizedQuery)
			) {
				filteredItems.push(item);
			}
			continue;
		}

		const children = filterWorkspaceItems(item.children, normalizedQuery);
		if (
			item.title.toLocaleLowerCase().includes(normalizedQuery) ||
			children.length > 0
		) {
			filteredItems.push({ ...item, children });
		}
	}

	return filteredItems;
}

async function toggleNotePinned(note: WorkspaceNote) {
	const next = !note.pinned;
	try {
		await window.electron?.notes.setPinned(note.path, next);
		window.dispatchEvent(new Event("paperite:refresh-workspace"));
	} catch {
		// ignore — workspace will stay as-is
	}
}

function sortWorkspaceItems(
	items: WorkspaceItem[],
	sortOrder: SidebarSortOrder,
	customItemOrders: Record<string, string[]>,
	parentPath: string,
	folderFirst = false,
): WorkspaceItem[] {
	const withSortedChildren = items.map((item) =>
		item.type === "folder"
			? {
					...item,
					children: sortWorkspaceItems(
						item.children,
						sortOrder,
						customItemOrders,
						item.path,
						folderFirst,
					),
				}
			: item,
	);

	const pinFirst = (list: WorkspaceItem[]) => {
		const pinned = list.filter(
			(item) => item.type === "note" && item.pinned === true,
		);
		const rest = list.filter(
			(item) => !(item.type === "note" && item.pinned === true),
		);
		return [...pinned, ...rest];
	};

	const foldersFirst = (list: WorkspaceItem[]) => {
		if (!folderFirst) return list;
		const folders = list.filter((item) => item.type === "folder");
		const notes = list.filter((item) => item.type !== "folder");
		return [...folders, ...notes];
	};

	if (sortOrder === "custom") {
		return pinFirst(
			foldersFirst(
				orderItemsByCustomOrder(
					withSortedChildren,
					customItemOrders[parentPath],
				),
			),
		);
	}

	if (sortOrder === "a-z" || sortOrder === "z-a") {
		const sorted = [...withSortedChildren].sort((first, second) => {
			const comparison = titleForSort(first).localeCompare(
				titleForSort(second),
				undefined,
				{ sensitivity: "base", numeric: true },
			);

			return sortOrder === "a-z" ? comparison : -comparison;
		});
		return pinFirst(foldersFirst(sorted));
	}

	const sortedNotes = withSortedChildren
		.filter((item): item is WorkspaceNote => item.type === "note")
		.sort((first, second) =>
			sortOrder === "newest"
				? second.updatedAt - first.updatedAt
				: first.updatedAt - second.updatedAt,
		);
	let noteIndex = 0;

	const dateSorted = withSortedChildren.map((item) =>
		item.type === "note" ? sortedNotes[noteIndex++] : item,
	);
	return pinFirst(foldersFirst(dateSorted));
}

function orderItemsByCustomOrder(
	items: WorkspaceItem[],
	customOrder: string[] = [],
) {
	if (customOrder.length === 0) return items;

	const originalIndex = new Map(items.map((item, index) => [item.path, index]));
	const orderIndex = new Map(customOrder.map((path, index) => [path, index]));

	return [...items].sort((first, second) => {
		const firstOrder = orderIndex.get(first.path) ?? Number.MAX_SAFE_INTEGER;
		const secondOrder = orderIndex.get(second.path) ?? Number.MAX_SAFE_INTEGER;

		if (firstOrder !== secondOrder) return firstOrder - secondOrder;

		return (
			(originalIndex.get(first.path) ?? Number.MAX_SAFE_INTEGER) -
			(originalIndex.get(second.path) ?? Number.MAX_SAFE_INTEGER)
		);
	});
}

function titleForSort(item: WorkspaceItem) {
	return item.title.trim() || "Untitled";
}

const SearchQueryContext = React.createContext("");

/** Survives folder-row remounts (virtualizer / menu focus restore). */
type FolderRenameStore = {
	path: string | null;
	draft: string;
	start: (path: string, title: string) => void;
	setDraft: (draft: string) => void;
	stop: () => void;
};
const useFolderRenameStore = create<FolderRenameStore>((set) => ({
	path: null,
	draft: "",
	start: (path, title) => set({ path, draft: title }),
	setDraft: (draft) => set({ draft }),
	stop: () => set({ path: null, draft: "" }),
}));

const EMPTY_SEARCH_EXPAND_PATHS: ReadonlySet<string> = new Set();

const SearchExpandPathsContext = React.createContext<ReadonlySet<string>>(
	EMPTY_SEARCH_EXPAND_PATHS,
);

/** Folder paths that must stay open so search hits inside them are visible. */
function collectSearchExpandPaths(
	items: WorkspaceItem[],
	query: string,
): ReadonlySet<string> {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	if (!normalizedQuery) return EMPTY_SEARCH_EXPAND_PATHS;
	const paths = new Set<string>();

	const walk = (nodes: WorkspaceItem[]): boolean => {
		let anyMatch = false;
		for (const item of nodes) {
			if (item.type === "note") {
				if (
					item.title.toLocaleLowerCase().includes(normalizedQuery) ||
					(item.preview ?? "").toLocaleLowerCase().includes(normalizedQuery)
				) {
					anyMatch = true;
				}
				continue;
			}

			const selfMatch = item.title
				.toLocaleLowerCase()
				.includes(normalizedQuery);
			const childMatch = walk(item.children);
			if (selfMatch || childMatch) {
				paths.add(item.path);
				anyMatch = true;
			}
		}
		return anyMatch;
	};

	walk(items);
	return paths;
}

/** Highlight case-insensitive matches — same yellow mark as in-note find. */
function highlightSearchText(text: string, query: string): React.ReactNode {
	const needle = query.trim();
	if (!needle || !text) return text;

	const lowerText = text.toLocaleLowerCase();
	const lowerNeedle = needle.toLocaleLowerCase();
	const parts: React.ReactNode[] = [];
	let start = 0;
	let matchIndex = lowerText.indexOf(lowerNeedle, start);
	let key = 0;

	while (matchIndex >= 0) {
		if (matchIndex > start) {
			parts.push(text.slice(start, matchIndex));
		}
		parts.push(
			<mark
				key={key}
				className="rounded-[2px] bg-yellow-300/80 px-0.5 text-neutral-950"
			>
				{text.slice(matchIndex, matchIndex + needle.length)}
			</mark>,
		);
		key += 1;
		start = matchIndex + needle.length;
		matchIndex = lowerText.indexOf(lowerNeedle, start);
	}

	if (start < text.length) parts.push(text.slice(start));
	return parts.length > 0 ? <>{parts}</> : text;
}

const NOTE_TREE_VIRTUALIZE_THRESHOLD = 40;

function findScrollParent(node: HTMLElement | null): HTMLElement | null {
	let el = node;
	while (el) {
		const { overflowY } = getComputedStyle(el);
		if (overflowY === "auto" || overflowY === "scroll") return el;
		el = el.parentElement;
	}
	return null;
}

function NoteTree({
	canDragItems,
	items,
	level = 0,
	onCreateFolder,
	onCreateNote,
	onDeleteItem,
	onMoveItem,
	onOpenNote,
	onPrefetchNote,
	onRenameItem,
	onToggleFolder,
	parentPath,
	spaces,
	spaceIcons,
	spaceColors,
	showPreview,
	isInbox = false,
	newlyCreatedFolderPath,
	onRenameComplete,
}: {
	canDragItems: boolean;
	items: WorkspaceItem[];
	level?: number;
	onCreateFolder: (parentPath: string) => void;
	onCreateNote: (parentPath: string) => void;
	onDeleteItem: (path: string) => void;
	onMoveItem: (itemPath: string, nextParentPath: string) => void;
	onOpenNote: (note: WorkspaceNote, mode: "preview" | "fixed") => void;
	onPrefetchNote?: (path: string) => void;
	onRenameItem: (path: string, title: string) => void;
	onToggleFolder: (path: string, isOpen: boolean) => void;
	parentPath: string;
	spaces: WorkspaceSpace[];
	spaceIcons: Record<string, string>;
	spaceColors: Record<string, string>;
	showPreview: boolean;
	isInbox?: boolean;
	newlyCreatedFolderPath: string | null;
	onRenameComplete: () => void;
}) {
	// isOpen is intentionally NOT read here — each NoteFolderItem subscribes to
	// its own path via useIsFolderExpanded, so toggling one folder doesn't
	// force this component (and every sibling folder under it) to re-render.
	const { isOver, setNodeRef } = useDroppable({
		id: listDropTargetId(parentPath),
	});
	const listRef = React.useRef<HTMLDivElement | null>(null);
	const setListRef = React.useCallback(
		(node: HTMLDivElement | null) => {
			listRef.current = node;
			setNodeRef(node);
		},
		[setNodeRef],
	);

	const shouldVirtualize = items.length >= NOTE_TREE_VIRTUALIZE_THRESHOLD;
	// Row estimate includes gap-1.5 (~6px). measureElement corrects folders.
	const estimateSize = showPreview ? 70 : 48;

	const virtualizer = useVirtualizer({
		count: items.length,
		getScrollElement: () => findScrollParent(listRef.current),
		estimateSize: () => estimateSize,
		overscan: 10,
		enabled: shouldVirtualize,
	});

	const renderItem = (item: WorkspaceItem) =>
		item.type === "folder" ? (
			<MemoizedNoteFolderItem
				canDragItems={canDragItems}
				item={item}
				key={item.path}
				level={level}
				onCreateFolder={onCreateFolder}
				onCreateNote={onCreateNote}
				onDeleteItem={onDeleteItem}
				onMoveItem={onMoveItem}
				onOpenNote={onOpenNote}
				onPrefetchNote={onPrefetchNote}
				onRenameItem={onRenameItem}
				onToggleFolder={onToggleFolder}
				spaces={spaces}
				spaceIcons={spaceIcons}
				spaceColors={spaceColors}
				showPreview={showPreview}
				isInbox={isInbox}
				newlyCreatedFolderPath={newlyCreatedFolderPath}
				onRenameComplete={onRenameComplete}
			/>
		) : (
			<MemoizedNoteCard
				canDragItems={canDragItems}
				item={item}
				key={item.path}
				onMoveItem={onMoveItem}
				onOpenNote={onOpenNote}
				onPrefetchNote={onPrefetchNote}
				onDeleteItem={onDeleteItem}
				parentPath={parentPath}
				spaces={spaces}
				spaceIcons={spaceIcons}
				spaceColors={spaceColors}
				showPreview={showPreview}
			/>
		);

	if (!shouldVirtualize) {
		return (
			<div
				ref={setListRef}
				className="relative flex min-h-8 flex-col gap-1.5 rounded-md"
				data-over={isOver}
			>
				{items.map((item) => renderItem(item))}
				{/* Always mounted — opacity only, avoids remount churn while dragging */}
				<div
					aria-hidden
					className={cn(
						"pointer-events-none absolute inset-x-1 bottom-0 z-10 h-0.5 translate-y-1/2 rounded-full bg-foreground transition-opacity duration-75",
						isOver ? "opacity-100" : "opacity-0",
					)}
				/>
			</div>
		);
	}

	return (
		<div
			ref={setListRef}
			className="relative min-h-8 rounded-md"
			data-over={isOver}
			style={{ height: virtualizer.getTotalSize() }}
		>
			{virtualizer.getVirtualItems().map((virtualRow) => {
				const item = items[virtualRow.index];
				if (!item) return null;
				return (
					<div
						key={item.path}
						data-index={virtualRow.index}
						ref={virtualizer.measureElement}
						className="absolute top-0 left-0 w-full pb-1.5"
						style={{
							transform: `translateY(${virtualRow.start}px)`,
						}}
					>
						{renderItem(item)}
					</div>
				);
			})}
			<div
				aria-hidden
				className={cn(
					"pointer-events-none absolute inset-x-1 bottom-0 z-10 h-0.5 translate-y-1/2 rounded-full bg-foreground transition-opacity duration-75",
					isOver ? "opacity-100" : "opacity-0",
				)}
			/>
		</div>
	);
}

const MemoizedNoteTree = React.memo(NoteTree);

function NoteGrid({
	items,
	onDeleteItem,
	onMoveItem,
	onOpenNote,
	spaces,
	spaceIcons,
	spaceColors,
	showPreview,
	isTrash,
	onRestoreItem,
	onPermanentDeleteItem,
}: {
	items: WorkspaceItem[];
	onDeleteItem: (path: string) => void;
	onMoveItem: (itemPath: string, nextParentPath: string) => void;
	onOpenNote: (note: WorkspaceNote, mode: "preview" | "fixed") => void;
	onPrefetchNote?: (path: string) => void;
	spaces: WorkspaceSpace[];
	spaceIcons: Record<string, string>;
	spaceColors: Record<string, string>;
	showPreview: boolean;
	isTrash?: boolean;
	onRestoreItem?: (trashNoteName: string) => void;
	onPermanentDeleteItem?: (trashNoteName: string) => void;
}) {
	const notes = React.useMemo(
		() => items.filter((item): item is WorkspaceNote => item.type === "note"),
		[items],
	);

	if (notes.length === 0) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<FileTextIcon />
					</EmptyMedia>
					<EmptyTitle>No notes yet</EmptyTitle>
					<EmptyDescription>Create a note to get started.</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<div className="columns-2 gap-2">
			{notes.map((note) => (
				<NoteGridCard
					key={note.path}
					note={note}
					onDeleteItem={onDeleteItem}
					onMoveItem={onMoveItem}
					onOpenNote={onOpenNote}
					spaces={spaces}
					spaceIcons={spaceIcons}
					spaceColors={spaceColors}
					showPreview={showPreview}
					isTrash={isTrash}
					onRestoreItem={onRestoreItem}
					onPermanentDeleteItem={onPermanentDeleteItem}
				/>
			))}
		</div>
	);
}

function MoveToSpaceMenu({
	spaces,
	spaceIcons,
	spaceColors,
	notePath,
	onMove,
}: {
	spaces: WorkspaceSpace[];
	spaceIcons: Record<string, string>;
	spaceColors: Record<string, string>;
	notePath: string;
	onMove: (spacePath: string) => void;
}) {
	const [query, setQuery] = React.useState("");
	const inputRef = React.useRef<HTMLInputElement>(null);
	const currentSpacePath = notePath.split("/")[0];

	const filtered = React.useMemo(
		() =>
			spaces.filter((s) => s.title.toLowerCase().includes(query.toLowerCase())),
		[spaces, query],
	);

	return (
		<ContextMenuSub
			onOpenChange={(open) => {
				if (open) {
					setQuery("");
					requestAnimationFrame(() => inputRef.current?.focus());
				}
			}}
		>
			<ContextMenuSubTrigger>
				<FolderIcon />
				Move to space
			</ContextMenuSubTrigger>
			<ContextMenuSubContent className="w-56 p-0">
				<div className="flex items-center gap-2 border-b px-2 py-1.5">
					<SearchIcon className="size-4 shrink-0 text-muted-foreground" />
					<input
						ref={inputRef}
						type="text"
						placeholder="Search spaces..."
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
						onKeyDown={(e) => {
							if (e.key === "Enter" && filtered.length === 1) {
								onMove(filtered[0].path);
							}
						}}
					/>
				</div>
				<div className="max-h-64 overflow-y-auto p-1">
					{filtered.length === 0 ? (
						<div className="px-2 py-1.5 text-sm text-muted-foreground">
							No spaces found
						</div>
					) : (
						filtered.map((space) => {
							const isCurrent = space.path === currentSpacePath;
							return (
								<ContextMenuItem
									key={space.path}
									disabled={isCurrent}
									onSelect={() => {
										if (!isCurrent) onMove(space.path);
									}}
								>
									<SpaceIcon
										color={spaceColors[space.path]}
										icon={spaceIcons[space.path]}
										path={space.path}
									/>
									{space.title}
									{isCurrent && <CheckIcon className="ml-auto" />}
								</ContextMenuItem>
							);
						})
					)}
				</div>
			</ContextMenuSubContent>
		</ContextMenuSub>
	);
}

function NoteGridCard({
	note,
	onDeleteItem,
	onMoveItem,
	onOpenNote,
	spaces,
	spaceIcons,
	spaceColors,
	showPreview,
	isTrash,
	onRestoreItem,
	onPermanentDeleteItem,
}: {
	note: WorkspaceNote;
	onDeleteItem: (path: string) => void;
	onMoveItem: (itemPath: string, nextParentPath: string) => void;
	onOpenNote: (note: WorkspaceNote, mode: "preview" | "fixed") => void;
	onPrefetchNote?: (path: string) => void;
	spaces: WorkspaceSpace[];
	spaceIcons: Record<string, string>;
	spaceColors: Record<string, string>;
	showPreview: boolean;
	isTrash?: boolean;
	onRestoreItem?: (trashNoteName: string) => void;
	onPermanentDeleteItem?: (trashNoteName: string) => void;
}) {
	const isActive = useAppStore((s) => s.activeNotePath === note.path);
	const [deleteOpen, setDeleteOpen] = React.useState(false);
	const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
		id: note.path,
		data: {
			preview: note.preview,
			title: note.title,
			type: "note" satisfies DragPreviewItem["type"],
		},
	});
	const searchQuery = React.useContext(SearchQueryContext);
	const displayTitle = note.title.trim() || "Untitled";
	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<button
						ref={setNodeRef}
						type="button"
						className="mb-2 w-full touch-none break-inside-avoid rounded-lg border border-border/50 bg-sidebar p-3 text-left transition-all duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:scale-[0.97] data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[dragging=true]:opacity-0"
						data-active={isActive}
						data-dragging={isDragging}
						{...attributes}
						{...listeners}
						onClick={() => onOpenNote(note, "preview")}
						onDoubleClick={() => onOpenNote(note, "fixed")}
					>
						<div className="flex items-start justify-between gap-2 text-sm font-semibold leading-tight">
							<span className="min-w-0 line-clamp-3">
								{highlightSearchText(displayTitle, searchQuery)}
							</span>
							{note.pinned ? (
								<PinIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
							) : null}
						</div>
						{showPreview && note.preview ? (
							<p className="mt-1 text-xs leading-snug text-muted-foreground line-clamp-4">
								{highlightSearchText(note.preview, searchQuery)}
							</p>
						) : null}
					</button>
				</ContextMenuTrigger>
				<ContextMenuContent className="w-44">
					{isTrash ? (
						<>
							<ContextMenuItem
								onSelect={() => {
									const name = note.path.split("/").pop();
									if (name && onRestoreItem) onRestoreItem(name);
								}}
							>
								<RotateCcwIcon />
								Restore note
							</ContextMenuItem>
							<ContextMenuSeparator />
							<ContextMenuItem
								variant="destructive"
								onSelect={() => {
									const name = note.path.split("/").pop();
									if (name && onPermanentDeleteItem)
										onPermanentDeleteItem(name);
								}}
							>
								<Trash2Icon />
								Delete permanently
							</ContextMenuItem>
						</>
					) : (
						<>
							<ContextMenuItem onSelect={() => void toggleNotePinned(note)}>
								<PinIcon />
								{note.pinned ? "Unpin note" : "Pin note"}
							</ContextMenuItem>
							<MoveToSpaceMenu
								spaces={spaces}
								spaceIcons={spaceIcons}
								spaceColors={spaceColors}
								notePath={note.path}
								onMove={(spacePath) => onMoveItem(note.path, spacePath)}
							/>
							<ContextMenuSeparator />
							<ContextMenuItem
								variant="destructive"
								onSelect={() => setDeleteOpen(true)}
							>
								<Trash2Icon />
								Delete note
							</ContextMenuItem>
						</>
					)}
				</ContextMenuContent>
			</ContextMenu>
			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete note?</AlertDialogTitle>
						<AlertDialogDescription>
							This will move "{note.title || "Untitled"}" to Trash.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => onDeleteItem(note.path)}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

const MemoizedFolderChildren = React.memo(function FolderChildren({
	canDragItems,
	item,
	level,
	onCreateFolder,
	onCreateNote,
	onDeleteItem,
	onMoveItem,
	onOpenNote,
	onPrefetchNote,
	onRenameItem,
	onToggleFolder,
	spaces,
	spaceIcons,
	spaceColors,
	showPreview,
	isInbox,
	newlyCreatedFolderPath,
	onRenameComplete,
}: {
	canDragItems: boolean;
	item: WorkspaceFolder;
	level: number;
	onCreateFolder: (parentPath: string) => void;
	onCreateNote: (parentPath: string) => void;
	onDeleteItem: (path: string) => void;
	onMoveItem: (itemPath: string, nextParentPath: string) => void;
	onOpenNote: (note: WorkspaceNote, mode: "preview" | "fixed") => void;
	onPrefetchNote?: (path: string) => void;
	onRenameItem: (path: string, title: string) => void;
	onToggleFolder: (path: string, isOpen: boolean) => void;
	spaces: WorkspaceSpace[];
	spaceIcons: Record<string, string>;
	spaceColors: Record<string, string>;
	showPreview: boolean;
	isInbox: boolean;
	newlyCreatedFolderPath: string | null;
	onRenameComplete: () => void;
}) {
	// Plain conditional mount — avoid Radix CollapsibleContent height measurement,
	// which forces layout thrashing when expanding folders with many children.
	return (
		<div className="ml-3.5 border-l border-sidebar-border pl-2 pt-1">
			<MemoizedNoteTree
				canDragItems={canDragItems}
				items={item.children}
				level={level + 1}
				onCreateFolder={onCreateFolder}
				onCreateNote={onCreateNote}
				onDeleteItem={onDeleteItem}
				onMoveItem={onMoveItem}
				onOpenNote={onOpenNote}
				onPrefetchNote={onPrefetchNote}
				onRenameItem={onRenameItem}
				onToggleFolder={onToggleFolder}
				parentPath={item.path}
				spaces={spaces}
				spaceIcons={spaceIcons}
				spaceColors={spaceColors}
				showPreview={showPreview}
				isInbox={isInbox}
				newlyCreatedFolderPath={newlyCreatedFolderPath}
				onRenameComplete={onRenameComplete}
			/>
		</div>
	);
});

function NoteFolderItem({
	canDragItems,
	item,
	level,
	onCreateFolder,
	onCreateNote,
	onDeleteItem,
	onMoveItem,
	onOpenNote,
	onPrefetchNote,
	onRenameItem,
	onToggleFolder,
	spaces,
	spaceIcons,
	spaceColors,
	showPreview,
	isInbox = false,
	newlyCreatedFolderPath,
	onRenameComplete,
}: {
	canDragItems: boolean;
	item: WorkspaceFolder;
	level: number;
	onCreateFolder: (parentPath: string) => void;
	onCreateNote: (parentPath: string) => void;
	onDeleteItem: (path: string) => void;
	onMoveItem: (itemPath: string, nextParentPath: string) => void;
	onOpenNote: (note: WorkspaceNote, mode: "preview" | "fixed") => void;
	onPrefetchNote?: (path: string) => void;
	onRenameItem: (path: string, title: string) => void;
	onToggleFolder: (path: string, isOpen: boolean) => void;
	spaces: WorkspaceSpace[];
	spaceIcons: Record<string, string>;
	spaceColors: Record<string, string>;
	showPreview: boolean;
	isInbox?: boolean;
	newlyCreatedFolderPath: string | null;
	onRenameComplete: () => void;
}) {
	// This folder's own open/closed state, subscribed by path — toggling a
	// DIFFERENT folder never re-renders this one.
	const isOpen = useIsFolderExpanded(item.path);
	const hasChildren = item.children.length > 0;
	const [deleteOpen, setDeleteOpen] = React.useState(false);
	const renameInputRef = React.useRef<HTMLInputElement>(null);
	const ignoreRenameBlurRef = React.useRef(false);
	const renamingPath = useFolderRenameStore((s) => s.path);
	const renameTitle = useFolderRenameStore((s) => s.draft);
	const setRenameDraft = useFolderRenameStore((s) => s.setDraft);
	const startFolderRename = useFolderRenameStore((s) => s.start);
	const stopFolderRename = useFolderRenameStore((s) => s.stop);
	const isRenaming = renamingPath === item.path;

	const beginRename = React.useCallback(() => {
		ignoreRenameBlurRef.current = true;
		startFolderRename(item.path, item.title);
	}, [item.path, item.title, startFolderRename]);

	React.useEffect(() => {
		if (item.path === newlyCreatedFolderPath) {
			beginRename();
		}
	}, [item.path, newlyCreatedFolderPath, beginRename]);

	// Focus after the context menu has released focus; keep ignoring blur a bit longer.
	React.useEffect(() => {
		if (!isRenaming) return;
		ignoreRenameBlurRef.current = true;
		const focusTimer = window.setTimeout(() => {
			const el = renameInputRef.current;
			if (!el) return;
			el.focus();
			el.select();
		}, 120);
		const releaseTimer = window.setTimeout(() => {
			ignoreRenameBlurRef.current = false;
			// Re-assert focus+select in case the menu stole it once.
			if (useFolderRenameStore.getState().path === item.path) {
				const el = renameInputRef.current;
				if (!el) return;
				el.focus();
				el.select();
			}
		}, 180);
		return () => {
			window.clearTimeout(focusTimer);
			window.clearTimeout(releaseTimer);
		};
	}, [isRenaming, item.path]);

	const {
		attributes,
		isDragging,
		listeners,
		setNodeRef: setDraggableRef,
		transform,
	} = useDraggable({
		id: item.path,
		disabled: !canDragItems || isRenaming,
		data: {
			title: item.title,
			type: "folder" satisfies DragPreviewItem["type"],
		},
	});
	const { isOver, setNodeRef: setDroppableRef } = useDroppable({
		id: dropTargetId(item.path),
	});
	const setNodeRef = React.useCallback(
		(node: HTMLDivElement | null) => {
			setDraggableRef(node);
			setDroppableRef(node);
		},
		[setDraggableRef, setDroppableRef],
	);

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<div>
						{/* biome-ignore lint/a11y/useSemanticElements: needs div for dnd-kit drag listeners */}
						<div
							ref={setNodeRef}
							role="button"
							tabIndex={0}
							className="group/folder flex cursor-default items-center gap-1 rounded-md data-[dragging=true]:opacity-0 data-[over=true]:bg-sidebar-accent"
							data-dragging={isDragging}
							data-over={isOver}
							style={{
								transform: CSS.Translate.toString(transform),
							}}
							onClick={() => {
								if (!isRenaming) {
									onToggleFolder(item.path, !isOpen);
								}
							}}
							onKeyDown={(e) => {
								// While renaming, never intercept keys (especially Space).
								if (isRenaming) return;
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									onToggleFolder(item.path, !isOpen);
								}
							}}
							{...(canDragItems && !isRenaming ? attributes : {})}
							{...(canDragItems && !isRenaming ? listeners : {})}
						>
							{isRenaming ? (
								<div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-transparent px-2 text-left text-xs font-medium text-sidebar-foreground/80 outline-none transition-[background-color,border-color,color,transform] duration-150 hover:border-border/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
									{isOpen ? (
										<FolderOpenIcon className="size-3.5 shrink-0" />
									) : (
										<FolderClosedIcon className="size-3.5 shrink-0" />
									)}
									<input
										ref={renameInputRef}
										value={renameTitle}
										onFocus={(e) => e.currentTarget.select()}
										onChange={(e) => setRenameDraft(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												e.preventDefault();
												e.stopPropagation();
												const next = renameTitle.trim();
												if (next && next !== item.title) {
													onRenameItem(item.path, next);
												}
												stopFolderRename();
												onRenameComplete();
											} else if (e.key === "Escape") {
												e.preventDefault();
												e.stopPropagation();
												stopFolderRename();
												onRenameComplete();
											}
										}}
										onBlur={() => {
											if (ignoreRenameBlurRef.current) return;
											// Defer so menu focus restore / remounts cannot cancel rename.
											window.setTimeout(() => {
												if (ignoreRenameBlurRef.current) return;
												if (
													useFolderRenameStore.getState().path !== item.path
												) {
													return;
												}
												if (document.activeElement === renameInputRef.current) {
													return;
												}
												const draft = useFolderRenameStore
													.getState()
													.draft.trim();
												if (draft && draft !== item.title) {
													onRenameItem(item.path, draft);
												}
												stopFolderRename();
												onRenameComplete();
											}, 120);
										}}
										className="min-w-0 flex-1 bg-transparent text-xs font-medium text-sidebar-foreground outline-none"
										onClick={(e) => e.stopPropagation()}
										onPointerDown={(e) => e.stopPropagation()}
									/>
								</div>
							) : (
								<div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-transparent px-2 text-left text-xs font-medium text-sidebar-foreground/80 outline-none transition-[background-color,border-color,color,transform] duration-150 hover:border-border/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:scale-[0.98]">
									{isOpen ? (
										<FolderOpenIcon className="size-3.5 shrink-0" />
									) : (
										<FolderClosedIcon className="size-3.5 shrink-0" />
									)}
									<span className="min-w-0 flex-1 truncate">{item.title}</span>
								</div>
							)}
						</div>
						{hasChildren && isOpen ? (
							<MemoizedFolderChildren
												canDragItems={canDragItems}
								item={item}
								level={level}
								onCreateFolder={onCreateFolder}
								onCreateNote={onCreateNote}
								onDeleteItem={onDeleteItem}
								onMoveItem={onMoveItem}
								onOpenNote={onOpenNote}
								onPrefetchNote={onPrefetchNote}
								onRenameItem={onRenameItem}
								onToggleFolder={onToggleFolder}
								spaces={spaces}
								spaceIcons={spaceIcons}
								spaceColors={spaceColors}
								showPreview={showPreview}
								isInbox={isInbox}
								newlyCreatedFolderPath={newlyCreatedFolderPath}
								onRenameComplete={onRenameComplete}
							/>
						) : null}
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent
					className="w-48"
					onCloseAutoFocus={(event) => {
						// Radix restores focus to the trigger, which steals selection from the rename input.
						if (useFolderRenameStore.getState().path === item.path) {
							event.preventDefault();
							requestAnimationFrame(() => {
								const el = renameInputRef.current;
								if (!el) return;
								el.focus();
								el.select();
							});
						}
					}}
				>
					<ContextMenuItem onSelect={() => onCreateNote(item.path)}>
						<StickyNotePlusIcon />
						Add note
					</ContextMenuItem>
					{!isInbox && (
						<ContextMenuItem onSelect={() => onCreateFolder(item.path)}>
							<FolderPlusIcon />
							Add folder
						</ContextMenuItem>
					)}
					<ContextMenuSeparator />
					<ContextMenuItem
						onSelect={() => {
							beginRename();
						}}
					>
						<PencilIcon />
						Rename
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem
						variant="destructive"
						onSelect={() => setDeleteOpen(true)}
					>
						<Trash2Icon />
						Delete folder
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {item.title}?</AlertDialogTitle>
						<AlertDialogDescription>
							This will move the folder and everything inside it to Trash.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => {
								onDeleteItem(item.path);
								setDeleteOpen(false);
							}}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

const MemoizedNoteFolderItem = React.memo(
	NoteFolderItem,
	(prev, next) =>
		prev.item === next.item &&
		prev.canDragItems === next.canDragItems &&
		prev.showPreview === next.showPreview &&
		prev.isInbox === next.isInbox &&
		prev.newlyCreatedFolderPath === next.newlyCreatedFolderPath,
);

const MemoizedNoteCard = React.memo(function NoteCard({
	canDragItems,
	item,
	onDeleteItem,
	onMoveItem,
	onOpenNote,
	onPrefetchNote,
	parentPath,
	spaces,
	spaceIcons,
	spaceColors,
	showPreview,
	isTrash,
	onRestoreItem,
	onPermanentDeleteItem,
}: {
	canDragItems: boolean;
	item: WorkspaceNote;
	onDeleteItem: (path: string) => void;
	onMoveItem: (itemPath: string, nextParentPath: string) => void;
	onOpenNote: (note: WorkspaceNote, mode: "preview" | "fixed") => void;
	onPrefetchNote?: (path: string) => void;
	parentPath: string;
	spaces: WorkspaceSpace[];
	spaceIcons: Record<string, string>;
	spaceColors: Record<string, string>;
	showPreview: boolean;
	isTrash?: boolean;
	onRestoreItem?: (notePath: string) => void;
	onPermanentDeleteItem?: (notePath: string) => void;
}) {
	const isActive = useAppStore((s) => s.activeNotePath === item.path);
	const [deleteOpen, setDeleteOpen] = React.useState(false);
	const {
		attributes,
		isDragging,
		listeners,
		setNodeRef: setDraggableRef,
	} = useDraggable({
		id: item.path,
		disabled: !canDragItems,
		data: {
			preview: item.preview,
			title: item.title,
			type: "note" satisfies DragPreviewItem["type"],
		},
	});
	const { isOver, setNodeRef: setDroppableRef } = useDroppable({
		id: noteDropTargetId(item.path, parentPath),
	});
	const setNodeRef = React.useCallback(
		(node: HTMLButtonElement | null) => {
			setDraggableRef(node);
			setDroppableRef(node);
		},
		[setDraggableRef, setDroppableRef],
	);
	const searchQuery = React.useContext(SearchQueryContext);
	const titleDraft = useEditorUiStore((s) => s.titleDrafts[item.path]);
	const previewOverlay = useEditorUiStore((s) => s.notePreviews[item.path]);
	const displayTitle =
		(titleDraft !== undefined ? titleDraft : item.title).trim() || "Untitled";
	const displayPreview = previewOverlay ?? item.preview;

	// Shell owns useDraggable/useDroppable (must re-render on isOver/isDragging).
	// Keep ContextMenu in a memo child so those updates don't rebuild the menu tree.
	return (
		<>
			<div className="relative">
				{/* Always mounted — toggle via opacity so isOver doesn't mount/unmount */}
				<div
					aria-hidden
					className={cn(
						"pointer-events-none absolute inset-x-1 top-0 z-10 h-0.5 -translate-y-1/2 rounded-full bg-foreground transition-opacity duration-75",
						isOver && canDragItems ? "opacity-100" : "opacity-0",
					)}
				/>
				<MemoNoteCardBody
					attributes={canDragItems ? attributes : undefined}
					canDragItems={canDragItems}
					displayPreview={displayPreview}
					displayTitle={displayTitle}
					isActive={isActive}
					isDragging={isDragging}
					isTrash={isTrash}
					item={item}
					listeners={canDragItems ? listeners : undefined}
					onDeleteItem={onDeleteItem}
					onMoveItem={onMoveItem}
					onOpenNote={onOpenNote}
					onPermanentDeleteItem={onPermanentDeleteItem}
					onPrefetchNote={onPrefetchNote}
					onRestoreItem={onRestoreItem}
					searchQuery={searchQuery}
					setNodeRef={setNodeRef}
					showPreview={showPreview}
					spaceColors={spaceColors}
					spaceIcons={spaceIcons}
					spaces={spaces}
					deleteOpen={deleteOpen}
					setDeleteOpen={setDeleteOpen}
				/>
			</div>
		</>
	);
});

const MemoNoteCardBody = React.memo(function NoteCardBody({
	attributes,
	canDragItems,
	deleteOpen,
	displayPreview,
	displayTitle,
	isActive,
	isDragging,
	isTrash,
	item,
	listeners,
	onDeleteItem,
	onMoveItem,
	onOpenNote,
	onPermanentDeleteItem,
	onPrefetchNote,
	onRestoreItem,
	searchQuery,
	setDeleteOpen,
	setNodeRef,
	showPreview,
	spaceColors,
	spaceIcons,
	spaces,
}: {
	attributes?: ReturnType<typeof useDraggable>["attributes"];
	canDragItems: boolean;
	deleteOpen: boolean;
	displayPreview: string;
	displayTitle: string;
	isActive: boolean;
	isDragging: boolean;
	isTrash?: boolean;
	item: WorkspaceNote;
	listeners?: ReturnType<typeof useDraggable>["listeners"];
	onDeleteItem: (path: string) => void;
	onMoveItem: (itemPath: string, nextParentPath: string) => void;
	onOpenNote: (note: WorkspaceNote, mode: "preview" | "fixed") => void;
	onPermanentDeleteItem?: (notePath: string) => void;
	onPrefetchNote?: (path: string) => void;
	onRestoreItem?: (notePath: string) => void;
	searchQuery: string;
	setDeleteOpen: React.Dispatch<React.SetStateAction<boolean>>;
	setNodeRef: (node: HTMLButtonElement | null) => void;
	showPreview: boolean;
	spaceColors: Record<string, string>;
	spaceIcons: Record<string, string>;
	spaces: WorkspaceSpace[];
}) {
	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<button
						ref={setNodeRef}
						type="button"
						className={cn(
							"flex w-full flex-col items-start gap-1.5 rounded-md border border-transparent px-3 py-2.5 text-left text-sm leading-tight whitespace-nowrap outline-none hover:border-border/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-0 active:scale-[0.98] data-[active=true]:border-border/50 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[dragging=true]:opacity-0",
							canDragItems && "touch-none",
						)}
						data-active={isActive}
						data-dragging={isDragging}
						{...(attributes ?? {})}
						{...(listeners ?? {})}
						onPointerEnter={() => onPrefetchNote?.(item.path)}
						onClick={() => onOpenNote(item, "preview")}
						onDoubleClick={() => onOpenNote(item, "fixed")}
					>
						<div className="flex w-full items-start justify-between gap-2">
							<span className="min-w-0 flex-1 truncate font-medium">
								{highlightSearchText(displayTitle, searchQuery)}
							</span>
							{item.pinned ? (
								<PinIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
							) : null}
						</div>
						{showPreview && displayPreview ? (
							<span className="line-clamp-2 w-full text-xs whitespace-break-spaces text-sidebar-foreground/65">
								{highlightSearchText(displayPreview, searchQuery)}
							</span>
						) : null}
					</button>
				</ContextMenuTrigger>
				<ContextMenuContent className="w-44">
					{isTrash ? (
						<>
							<ContextMenuItem
								onSelect={() => {
									const name = item.path.split("/").pop();
									if (name && onRestoreItem) onRestoreItem(name);
								}}
							>
								<RotateCcwIcon />
								Restore note
							</ContextMenuItem>
							<ContextMenuSeparator />
							<ContextMenuItem
								variant="destructive"
								onSelect={() => {
									const name = item.path.split("/").pop();
									if (name && onPermanentDeleteItem)
										onPermanentDeleteItem(name);
								}}
							>
								<Trash2Icon />
								Delete permanently
							</ContextMenuItem>
						</>
					) : (
						<>
							<ContextMenuItem onSelect={() => void toggleNotePinned(item)}>
								<PinIcon />
								{item.pinned ? "Unpin note" : "Pin note"}
							</ContextMenuItem>
							<MoveToSpaceMenu
								spaces={spaces}
								spaceIcons={spaceIcons}
								spaceColors={spaceColors}
								notePath={item.path}
								onMove={(spacePath) => onMoveItem(item.path, spacePath)}
							/>
							<ContextMenuSeparator />
							<ContextMenuItem
								variant="destructive"
								onSelect={() => setDeleteOpen(true)}
							>
								<Trash2Icon />
								Delete note
							</ContextMenuItem>
						</>
					)}
				</ContextMenuContent>
			</ContextMenu>
			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {item.title}?</AlertDialogTitle>
						<AlertDialogDescription>
							This will move the note to Trash.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => {
								onDeleteItem(item.path);
								setDeleteOpen(false);
							}}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}, function noteCardBodyPropsAreEqual(prev, next) {
	// isOver lives on the shell — body must not re-render when only the drop
	// indicator toggles. attributes/listeners refs may churn from dnd-kit.
	return (
		prev.isDragging === next.isDragging &&
		prev.isActive === next.isActive &&
		prev.item === next.item &&
		prev.canDragItems === next.canDragItems &&
		prev.displayTitle === next.displayTitle &&
		prev.displayPreview === next.displayPreview &&
		prev.searchQuery === next.searchQuery &&
		prev.showPreview === next.showPreview &&
		prev.isTrash === next.isTrash &&
		prev.deleteOpen === next.deleteOpen &&
		prev.spaces === next.spaces &&
		prev.spaceIcons === next.spaceIcons &&
		prev.spaceColors === next.spaceColors &&
		prev.setNodeRef === next.setNodeRef &&
		prev.onDeleteItem === next.onDeleteItem &&
		prev.onMoveItem === next.onMoveItem &&
		prev.onOpenNote === next.onOpenNote &&
		prev.onPrefetchNote === next.onPrefetchNote &&
		prev.onRestoreItem === next.onRestoreItem &&
		prev.onPermanentDeleteItem === next.onPermanentDeleteItem
	);
});

function SpaceDropHeader({
	spaces,
	spaceColors,
	spaceIcons,
	user,
	onCreateFolder,
	onCreateNote,
	onEditSpace,
	spacePreviewModes,
	showNotePreview,
	onSetSpacePreviewMode,
	viewMode,
	onViewModeChange,
	onSortOrderChange,
	onFolderFirstChange,
	onEmptyTrash,
}: {
	spaces: WorkspaceSpace[];
	spaceColors: Record<string, string>;
	spaceIcons: Record<string, string>;
	user: { name: string; avatar: string };
	onCreateFolder: (parentPath: string) => void;
	onCreateNote: (parentPath: string) => void;
	onEditSpace: (
		path: string,
		title: string,
		color: string,
		icon: string,
	) => void;
	spacePreviewModes: Record<string, SpacePreviewMode>;
	showNotePreview: boolean;
	onSetSpacePreviewMode: (spacePath: string, mode: SpacePreviewMode) => void;
	viewMode: "list" | "grid";
	onViewModeChange: (mode: "list" | "grid") => void;
	onSortOrderChange: (order: SidebarSortOrder) => void;
	onFolderFirstChange: (folderFirst: boolean) => void;
	onEmptyTrash?: () => void;
}) {
	const activeSpacePath = useAppStore((s) => s.activeSpacePath);
	const spaceSortOrders = useAppStore((s) => s.spaceSortOrders);
	const spaceFolderFirst = useAppStore((s) => s.spaceFolderFirst);
	const activeSpace = spaces.find((space) => space.path === activeSpacePath);
	const spaceTitle =
		activeSpacePath === "Trash" ? "Trash" : (activeSpace?.title ?? "Inbox");
	const spaceColor = spaceColors[activeSpacePath];
	const spaceIcon = spaceIcons[activeSpacePath];
	const isTrash = activeSpacePath === "Trash";
	const rawSort = spaceSortOrders[activeSpacePath];
	const sortOrder: SidebarSortOrder =
		rawSort === "newest" ||
		rawSort === "oldest" ||
		rawSort === "a-z" ||
		rawSort === "z-a" ||
		rawSort === "custom"
			? activeSpacePath === "Inbox" && rawSort === "custom"
				? "newest"
				: rawSort
			: "newest";
	const folderFirst = spaceFolderFirst[activeSpacePath] ?? false;
	const { isOver, setNodeRef } = useDroppable({
		id: dropTargetId(activeSpacePath),
	});
	const isInbox = activeSpacePath === "Inbox";
	const spacePreviewMode = spacePreviewModes[activeSpacePath] ?? "global";
	const [settingsOpen, setSettingsOpen] = React.useState(false);
	const [inviteOpen, setInviteOpen] = React.useState(false);
	const [membersOpen, setMembersOpen] = React.useState(false);
	const memberInitials = user.name
		.split(" ")
		.filter(Boolean)
		.map((part) => part[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();
	const [settingsTitle, setSettingsTitle] = React.useState(spaceTitle);
	React.useEffect(() => {
		setSettingsTitle(spaceTitle);
	}, [spaceTitle]);

	return (
		<div
			ref={setNodeRef}
			className="flex w-full items-center justify-between gap-3 rounded-md data-[over=true]:bg-sidebar-accent"
			data-over={isOver}
		>
			{isTrash ? (
				<div className="flex h-8 min-w-0 items-center gap-2 truncate rounded-md px-1.5 text-left text-base font-medium text-foreground">
					<SpaceIcon
						className="size-5 shrink-0"
						color={spaceColor}
						icon={spaceIcon}
						path={activeSpacePath}
					/>
					<span className="min-w-0 truncate">{spaceTitle}</span>
				</div>
			) : (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							className="flex h-8 min-w-0 items-center gap-2 truncate rounded-md px-1.5 text-left text-base font-medium text-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-0"
						>
							<SpaceIcon
								className="size-5 shrink-0"
								color={spaceColor}
								icon={spaceIcon}
								path={activeSpacePath}
							/>
							<span className="min-w-0 truncate">{spaceTitle}</span>
							<ChevronDownIcon className="size-3.5 shrink-0 text-sidebar-foreground/60" />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="start"
						className={cn("w-56", !isInbox && "w-64 p-1.5")}
					>
						{isInbox ? (
							<>
								<DropdownMenuSub>
									<DropdownMenuSubTrigger>
										<ArrowUpDownIcon className="text-muted-foreground" />
										<span>Sort by</span>
									</DropdownMenuSubTrigger>
									<DropdownMenuSubContent>
										<DropdownMenuRadioGroup
											value={sortOrder === "custom" ? "newest" : sortOrder}
											onValueChange={(v) =>
												onSortOrderChange(v as SidebarSortOrder)
											}
										>
											<DropdownMenuRadioItem value="newest">
												<span>Newest</span>
											</DropdownMenuRadioItem>
											<DropdownMenuRadioItem value="oldest">
												<span>Oldest</span>
											</DropdownMenuRadioItem>
											<DropdownMenuRadioItem value="a-z">
												<span>A to Z</span>
											</DropdownMenuRadioItem>
											<DropdownMenuRadioItem value="z-a">
												<span>Z to A</span>
											</DropdownMenuRadioItem>
										</DropdownMenuRadioGroup>
										<DropdownMenuSeparator />
										<DropdownMenuCheckboxItem
											checked={folderFirst}
											onCheckedChange={(checked) =>
												onFolderFirstChange(checked === true)
											}
										>
											<span>Folder first</span>
										</DropdownMenuCheckboxItem>
									</DropdownMenuSubContent>
								</DropdownMenuSub>
								<DropdownMenuSub>
									<DropdownMenuSubTrigger>
										<ListIcon className="text-muted-foreground" />
										<span>View Mode</span>
									</DropdownMenuSubTrigger>
									<DropdownMenuSubContent>
										<DropdownMenuRadioGroup
											value={viewMode}
											onValueChange={(v) =>
												onViewModeChange(v as "list" | "grid")
											}
										>
											<DropdownMenuRadioItem value="list">
												<ListIcon className="text-muted-foreground" />
												<span>List</span>
											</DropdownMenuRadioItem>
											<DropdownMenuRadioItem value="grid">
												<LayoutDashboardIcon className="text-muted-foreground" />
												<span>Card</span>
											</DropdownMenuRadioItem>
										</DropdownMenuRadioGroup>
									</DropdownMenuSubContent>
								</DropdownMenuSub>
								<DropdownMenuSeparator />
								<DropdownMenuSub>
									<DropdownMenuSubTrigger>
										<FileTextIcon className="text-muted-foreground" />
										<span>Note previews</span>
									</DropdownMenuSubTrigger>
									<DropdownMenuSubContent>
										<DropdownMenuRadioGroup
											value={spacePreviewMode}
											onValueChange={(v) =>
												onSetSpacePreviewMode(
													activeSpacePath,
													v as SpacePreviewMode,
												)
											}
										>
											<DropdownMenuRadioItem value="global">
												<span>
													Follow global ({showNotePreview ? "on" : "off"})
												</span>
											</DropdownMenuRadioItem>
											<DropdownMenuRadioItem value="show">
												<span>Always show</span>
											</DropdownMenuRadioItem>
											<DropdownMenuRadioItem value="hide">
												<span>Always hide</span>
											</DropdownMenuRadioItem>
										</DropdownMenuRadioGroup>
									</DropdownMenuSubContent>
								</DropdownMenuSub>
							</>
						) : (
							<>
								<div className="-mx-1 -mt-1 mb-1 border-b border-border/70 p-2">
									<div className="flex items-end gap-3">
										<SpaceIcon
											className="size-10 shrink-0"
											color={spaceColor}
											icon={spaceIcon}
											path={activeSpacePath}
										/>
										<div className="min-w-0">
											<div className="truncate text-md font-semibold">{spaceTitle}</div>
											<div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
												<AvatarGroup className="-space-x-1">
													<Avatar className="size-5">
														<AvatarImage src={user.avatar} alt={user.name} />
														<AvatarFallback className="text-[9px] ring-0">{memberInitials || "P"}</AvatarFallback>
													</Avatar>
													<Avatar className="size-5">
														<AvatarImage src={user.avatar} alt={user.name} />
														<AvatarFallback className="text-[9px]">{memberInitials || "P"}</AvatarFallback>
													</Avatar>
												</AvatarGroup>
												<span>1 member</span>
											</div>
										</div>
									</div>
								</div>
								<DropdownMenuItem onSelect={() => setInviteOpen(true)}>
									<UserPlusIcon className="text-muted-foreground" />
									<span>Invite to space</span>
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={() => setMembersOpen(true)}>
									<UsersIcon className="text-muted-foreground" />
									<span>Manage members</span>
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
									<Settings2Icon className="text-muted-foreground" />
									<span>Space settings</span>
								</DropdownMenuItem>
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			)}
			<Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Space settings</DialogTitle>
						<DialogDescription>
							Control how this shared space looks and behaves for you.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-5">
						<div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/20 p-3">
							<SpaceIcon
								className="size-8 shrink-0"
								color={spaceColor}
								icon={spaceIcon}
								path={activeSpacePath}
							/>
							<div className="min-w-0 flex-1">
								<div className="text-xs text-muted-foreground">Space name</div>
								<Input
									value={settingsTitle}
									onChange={(event) => setSettingsTitle(event.target.value)}
									className="mt-1 h-8 bg-transparent px-2 font-medium"
								/>
							</div>
							<Button
								type="button"
								size="sm"
								disabled={!settingsTitle.trim()}
								onClick={() => {
									onEditSpace(
										activeSpacePath,
										settingsTitle.trim(),
										spaceColor ?? "#64748b",
										spaceIcon ?? "cloud",
									);
								}}
							>
								Save
							</Button>
						</div>
						<div className="space-y-3">
							<div>
								<div className="text-sm font-medium">Notes</div>
								<div className="text-xs text-muted-foreground">
									These preferences are kept in the space settings.
								</div>
							</div>
							<div className="grid gap-2">
								<label className="text-xs text-muted-foreground" htmlFor="space-sort-order">
									Sort by
								</label>
								<Select
									value={sortOrder}
									onValueChange={(value) =>
										onSortOrderChange(value as SidebarSortOrder)
									}
								>
									<SelectTrigger id="space-sort-order" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="newest">Newest</SelectItem>
										<SelectItem value="oldest">Oldest</SelectItem>
										<SelectItem value="a-z">A to Z</SelectItem>
										<SelectItem value="z-a">Z to A</SelectItem>
										<SelectItem value="custom">Custom</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2.5">
								<div>
									<div className="text-sm">Folder first</div>
									<div className="text-xs text-muted-foreground">
										Keep folders above notes.
									</div>
								</div>
								<Switch
									checked={folderFirst}
									onCheckedChange={onFolderFirstChange}
								/>
							</div>
							<div className="grid gap-2">
								<label className="text-xs text-muted-foreground" htmlFor="space-note-previews">
									Note previews
								</label>
								<Select
									value={spacePreviewMode}
									onValueChange={(value) =>
										onSetSpacePreviewMode(
											activeSpacePath,
											value as SpacePreviewMode,
										)
									}
								>
									<SelectTrigger id="space-note-previews" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="global">
											Follow global ({showNotePreview ? "on" : "off"})
										</SelectItem>
										<SelectItem value="show">Always show</SelectItem>
										<SelectItem value="hide">Always hide</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
					</div>
				</DialogContent>
			</Dialog>
			<Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
				<DialogContent className="sm:max-w-sm">
					<DialogHeader>
						<DialogTitle>Invite to {spaceTitle}</DialogTitle>
						<DialogDescription>
							Invite people to collaborate in this space.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-3">
						<Input placeholder="name@example.com" type="email" disabled />
						<Button type="button" className="w-full" disabled>
							Invite member
						</Button>
						<p className="text-center text-xs text-muted-foreground">
							Member invitations will be available when space sharing is connected.
						</p>
					</div>
				</DialogContent>
			</Dialog>
			<Dialog open={membersOpen} onOpenChange={setMembersOpen}>
				<DialogContent className="sm:max-w-sm">
					<DialogHeader>
						<DialogTitle>Manage members</DialogTitle>
						<DialogDescription>
							People who can access {spaceTitle}.
						</DialogDescription>
					</DialogHeader>
					<div className="flex items-center gap-3 rounded-lg border border-border/70 p-3">
						<Avatar>
							<AvatarImage src={user.avatar} alt={user.name} />
							<AvatarFallback>{memberInitials || "P"}</AvatarFallback>
						</Avatar>
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm font-medium">{user.name}</div>
							<div className="text-xs text-muted-foreground">Owner</div>
						</div>
					</div>
					<p className="text-xs text-muted-foreground">
						You are the only member of this local space right now.
					</p>
				</DialogContent>
			</Dialog>
			<div className="flex items-center gap-1">
				{isTrash ? (
					<button
						type="button"
						className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:ring-0"
						onClick={onEmptyTrash}
					>
						<Trash2Icon className="size-3.5" />
						Empty
					</button>
				) : (
					<>
						{!isInbox && (
							<button
								type="button"
								className="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/80 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-0"
								aria-label="Add folder"
								onClick={() => onCreateFolder(activeSpacePath)}
							>
								<FolderPlusIcon className="size-3.5" />
							</button>
						)}
						<button
							type="button"
							className="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/80 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-0"
							aria-label="Add note"
							onClick={() => onCreateNote(activeSpacePath)}
						>
							<StickyNotePlusIcon className="size-3.5" />
						</button>
					</>
				)}
			</div>
		</div>
	);
}

function DragItemPreview({ item }: { item: DragPreviewItem }) {
	return (
		<div className="pointer-events-none w-64 rounded-lg border border-border/70 bg-popover px-3 py-2.5 text-popover-foreground shadow-2xl ring-1 ring-black/10">
			<div className="flex items-center gap-2 text-sm font-medium">
				{item.type === "folder" ? (
					<FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
				) : (
					<FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
				)}
				<span className="truncate">{item.title.trim() || "Untitled"}</span>
			</div>
			{item.preview ? (
				<div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
					{item.preview}
				</div>
			) : null}
		</div>
	);
}

/** Isolated so drag-active changes don't re-render the whole sidebar tree. */
function SidebarDragOverlay() {
	const { active } = useDndContext();
	const data = active?.data.current as DragPreviewItem | undefined;
	return (
		<DragOverlay dropAnimation={null}>
			{data?.title ? <DragItemPreview item={data} /> : null}
		</DragOverlay>
	);
}

function AppSidebarImpl({
	activeSpacePath: activeSpacePathProp,
	expandedFolders: expandedFoldersProp,
	onCreateFolder,
	onCreateNote,
	onCreateSpace,
	onDeleteItem,
	onDeleteSpace,
	onEditSpace,
	onMoveItem,
	onOpenNote,
	onPrefetchNote,
	onRenameItem,
	onReorderSpaces,
	onSelectSpace,
	onToggleFolder,
	spaceColors: spaceColorsProp,
	spaceIcons: spaceIconsProp,
	spacePreviewModes: spacePreviewModesProp,
	showNotePreview: showNotePreviewProp,
	closeButtonOnly: closeButtonOnlyProp,
	syncSidebarWithActiveTab: syncSidebarWithActiveTabProp,
	onSetShowNotePreview: onSetShowNotePreviewProp,
	onSetCloseButtonOnly: onSetCloseButtonOnlyProp,
	onSetSyncSidebarWithActiveTab: onSetSyncSidebarWithActiveTabProp,
	onSetSpacePreviewMode: onSetSpacePreviewModeProp,
	spaces: spacesProp,
	viewMode: viewModeProp,
	onViewModeChange: onViewModeChangeProp,
	sortOrder: sortOrderProp,
	onSortOrderChange: onSortOrderChangeProp,
	folderFirst: folderFirstProp,
	onFolderFirstChange: onFolderFirstChangeProp,
	customItemOrders: customItemOrdersProp,
	onReorderItems,
	onRestoreItem,
	onPermanentDeleteItem,
	onEmptyTrash,
	onRenameComplete,
	...props
}: AppSidebarProps) {
	const navigate = useNavigate();
	const trashNotes = useEditorUiStore((s) => s.trashNotes);
	const workspaceSpaces = useEditorUiStore(
		(s) => s.workspace?.spaces ?? EMPTY_SPACES,
	);
	const baseSpaces = spacesProp ?? workspaceSpaces;
	const newlyCreatedFolderPath = useEditorUiStore(
		(s) => s.newlyCreatedFolderPath,
	);
	const { open, setOpen } = useSidebar();
	const [user, setUser] = React.useState(fallbackUser);
	const [searchQuery, setSearchQuery] = React.useState("");
	// Debounce filter work so typing in search doesn't re-walk the tree every key.
	const [debouncedSearchQuery, setDebouncedSearchQuery] = React.useState("");
	React.useEffect(() => {
		const handle = window.setTimeout(() => {
			setDebouncedSearchQuery(searchQuery);
		}, 120);
		return () => window.clearTimeout(handle);
	}, [searchQuery]);

	// Do NOT select expandedFolders or activeSpacePath here — either forces the
	// whole sidebar (every ContextMenu row) to re-render. Space switch only
	// flips SpaceVisibility panels; folder expand uses ExpandedFoldersStore.
	const storeUi = useAppStore(
		useShallow((st) => ({
			spaceColors: st.spaceColors,
			spaceIcons: st.spaceIcons,
			spaceOrder: st.spaceOrder,
			spacePreviewModes: st.spacePreviewModes,
			showNotePreview: st.showNotePreview,
			closeButtonOnly: st.closeButtonOnly,
			syncSidebarWithActiveTab: st.syncSidebarWithActiveTab,
			customItemOrders: st.customItemOrders,
			inboxViewMode: st.inboxViewMode,
			spaceSortOrders: st.spaceSortOrders,
			spaceFolderFirst: st.spaceFolderFirst,
		})),
	);
	// activeSpacePath is intentionally NOT read here — NavMain, SpaceDropHeader,
	// SpaceVisibility, and TrashNav each subscribe so switching spaces does not
	// re-render this shell or every note ContextMenu.
	// spaceOrder lives here (not Index) so reordering spaces does not re-render
	// the note workspace / editors (plan 017).
	const spaces = React.useMemo(() => {
		const order = storeUi.spaceOrder;
		if (!order || order.length === 0) return baseSpaces;
		const rank = new Map(order.map((path, index) => [path, index]));
		return [...baseSpaces].sort((a, b) => {
			if (a.path === "Inbox") return -1;
			if (b.path === "Inbox") return 1;
			return (
				(rank.get(a.path) ?? Number.MAX_SAFE_INTEGER) -
				(rank.get(b.path) ?? Number.MAX_SAFE_INTEGER)
			);
		});
	}, [baseSpaces, storeUi.spaceOrder]);
	const spaceColors = storeUi.spaceColors ?? spaceColorsProp ?? {};
	const spaceIcons = storeUi.spaceIcons ?? spaceIconsProp ?? {};
	const spacePreviewModes =
		storeUi.spacePreviewModes ?? spacePreviewModesProp ?? {};
	const showNotePreview =
		storeUi.showNotePreview ?? showNotePreviewProp ?? true;
	const closeButtonOnly =
		storeUi.closeButtonOnly ?? closeButtonOnlyProp ?? false;
	const syncSidebarWithActiveTab =
		storeUi.syncSidebarWithActiveTab ?? syncSidebarWithActiveTabProp ?? true;
	const customItemOrders =
		storeUi.customItemOrders ?? customItemOrdersProp ?? {};
	const viewMode = storeUi.inboxViewMode ?? viewModeProp ?? "list";
	const spaceSortOrders = storeUi.spaceSortOrders;
	const spaceFolderFirstMap = storeUi.spaceFolderFirst;
	const onSetShowNotePreview =
		onSetShowNotePreviewProp ??
		((show: boolean) => useAppStore.getState().setShowNotePreview(show));
	const onSetCloseButtonOnly =
		onSetCloseButtonOnlyProp ??
		((value: boolean) => useAppStore.getState().setCloseButtonOnly(value));
	const onSetSyncSidebarWithActiveTab =
		onSetSyncSidebarWithActiveTabProp ??
		((value: boolean) =>
			useAppStore.getState().setSyncSidebarWithActiveTab(value));
	const onSetSpacePreviewMode =
		onSetSpacePreviewModeProp ??
		((spacePath: string, mode: SpacePreviewMode) =>
			useAppStore.getState().setSpacePreviewMode(spacePath, mode));
	const onViewModeChange =
		onViewModeChangeProp ??
		((mode: "list" | "grid") => useAppStore.getState().setInboxViewMode(mode));
	const onSortOrderChange =
		onSortOrderChangeProp ??
		((order: SidebarSortOrder) => {
			const path = useAppStore.getState().activeSpacePath;
			useAppStore.getState().setSpaceSortOrder(path, order);
		});
	const onFolderFirstChange =
		onFolderFirstChangeProp ??
		((value: boolean) => {
			const path = useAppStore.getState().activeSpacePath;
			useAppStore.getState().setSpaceFolderFirst(path, value);
		});

	const [ftsResults, setFtsResults] = React.useState<NoteSearchResult[] | null>(
		null,
	);
	const [ftsLoading, setFtsLoading] = React.useState(false);
	React.useEffect(() => {
		const q = debouncedSearchQuery.trim();
		if (q.length < 2) {
			setFtsResults(null);
			setFtsLoading(false);
			return;
		}
		let cancelled = false;
		setFtsLoading(true);
		const engine = getNotesEngine();
		if (!engine) {
			setFtsLoading(false);
			setFtsResults(null);
			return;
		}
		engine
			.search(q)
			.then((results) => {
				if (cancelled) return;
				setFtsResults(results);
				setFtsLoading(false);
			})
			.catch(() => {
				if (cancelled) return;
				setFtsResults(null);
				setFtsLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [debouncedSearchQuery]);

	const [notesSheetOpen, setNotesSheetOpen] = React.useState(false);
	const [tabletLayout, setTabletLayout] = React.useState(false);
	// Hover-open while dragging: hold over a space → switch to its note list;
	// hold over a collapsed folder → expand it so you can drop inside.
	// Drag preview lives in SidebarDragOverlay (useDndContext) so setState here
	// never re-renders the note/folder tree on drag start.
	const hoverOpenTimerRef = React.useRef<number | null>(null);
	const hoverOpenTargetRef = React.useRef<string | null>(null);
	const dragPointerRef = React.useRef<{ x: number; y: number } | null>(null);
	const isNoteDragRef = React.useRef(false);
	const isDraggingRef = React.useRef(false);
	const clearHoverOpen = React.useCallback(() => {
		if (hoverOpenTimerRef.current !== null) {
			window.clearTimeout(hoverOpenTimerRef.current);
			hoverOpenTimerRef.current = null;
		}
		hoverOpenTargetRef.current = null;
	}, []);
	const spacePathUnderPointer = React.useCallback((x: number, y: number) => {
		const stack = document.elementsFromPoint(x, y);
		for (const el of stack) {
			if (!(el instanceof HTMLElement)) continue;
			// Skip the drag overlay itself.
			if (el.closest("[data-dnd-kit-drag-overlay]")) continue;
			const host = el.closest("[data-paperite-space-path]");
			if (host instanceof HTMLElement) {
				const path = host.dataset.paperiteSpacePath;
				if (path) return path;
			}
		}
		return null;
	}, []);
	// Keep previously visited space lists mounted (hide/show) so switching
	// spaces is instant. Only setState when a *new* path must mount — switching
	// between already-mounted spaces must not re-render this shell.
	const [mountedSpacePaths, setMountedSpacePaths] = React.useState<string[]>(
		() => {
			const path = useAppStore.getState().activeSpacePath;
			return path && path !== "Trash" ? [path] : ["Inbox"];
		},
	);
	React.useEffect(() => {
		const syncMounts = (activePath: string) => {
			const valid = new Set(spaces.map((space) => space.path));
			setMountedSpacePaths((prev) => {
				if (valid.size === 0) return prev;
				let next = prev.filter((path) => valid.has(path));
				if (
					activePath &&
					activePath !== "Trash" &&
					valid.has(activePath) &&
					!next.includes(activePath)
				) {
					next = [...next, activePath];
				}
				if (
					next.length === prev.length &&
					next.every((path, index) => path === prev[index])
				) {
					return prev;
				}
				return next;
			});
		};
		syncMounts(useAppStore.getState().activeSpacePath);
		let prevPath = useAppStore.getState().activeSpacePath;
		const unsub = useAppStore.subscribe((state) => {
			if (state.activeSpacePath === prevPath) return;
			prevPath = state.activeSpacePath;
			syncMounts(prevPath);
		});
		return unsub;
	}, [spaces]);

	const searchExpandPaths = React.useMemo(() => {
		const q = debouncedSearchQuery.trim();
		if (!q) return EMPTY_SEARCH_EXPAND_PATHS;
		const activePath = useAppStore.getState().activeSpacePath;
		const activeSpace = spaces.find((space) => space.path === activePath);
		return collectSearchExpandPaths(
			activeSpace?.children ?? [],
			debouncedSearchQuery,
		);
	}, [spaces, debouncedSearchQuery]);

	const spaceItemsCacheRef = React.useRef(
		new Map<
			string,
			{
				children: unknown;
				searchQuery: string;
				sortOrder: string;
				folderFirst: boolean;
				customOrder: unknown;
				// Full map so nested folder custom orders invalidate the cache.
				customItemOrders: unknown;
				items: WorkspaceItem[];
			}
		>(),
	);
	const mountedSpaceItems = React.useMemo(() => {
		const map = new Map<
			string,
			{ space: (typeof spaces)[number]; items: WorkspaceItem[] }
		>();
		for (const path of mountedSpacePaths) {
			const space = spaces.find((entry) => entry.path === path);
			if (!space) continue;
			const rawSort = sortOrderProp ?? spaceSortOrders[path];
			const pathSort: SidebarSortOrder =
				rawSort === "newest" ||
				rawSort === "oldest" ||
				rawSort === "a-z" ||
				rawSort === "z-a" ||
				rawSort === "custom"
					? rawSort
					: "newest";
			const effectiveSort =
				path === "Inbox" && pathSort === "custom" ? "newest" : pathSort;
			const pathFolderFirst =
				folderFirstProp ?? spaceFolderFirstMap[path] ?? false;
			const customOrder = customItemOrders[path];
			const cached = spaceItemsCacheRef.current.get(path);
			if (
				cached &&
				cached.children === space.children &&
				cached.searchQuery === debouncedSearchQuery &&
				cached.sortOrder === effectiveSort &&
				cached.folderFirst === pathFolderFirst &&
				cached.customOrder === customOrder &&
				cached.customItemOrders === customItemOrders
			) {
				map.set(path, { space, items: cached.items });
				continue;
			}
			const items = sortWorkspaceItems(
				filterWorkspaceItems(space.children ?? [], debouncedSearchQuery),
				effectiveSort,
				customItemOrders,
				path,
				pathFolderFirst,
			);
			spaceItemsCacheRef.current.set(path, {
				children: space.children,
				searchQuery: debouncedSearchQuery,
				sortOrder: effectiveSort,
				folderFirst: pathFolderFirst,
				customOrder,
				customItemOrders,
				items,
			});
			map.set(path, { space, items });
		}
		return map;
	}, [
		mountedSpacePaths,
		spaces,
		spaceSortOrders,
		spaceFolderFirstMap,
		sortOrderProp,
		folderFirstProp,
		customItemOrders,
		debouncedSearchQuery,
	]);
	const canDragItems = true;
	// Keep expand/collapse state in a per-path store so the sidebar paints
	// immediately AND toggling one folder doesn't re-render every other
	// mounted folder. Persist to app store in a transition; do not select
	// expandedFolders in React state (that was re-rendering the whole tree).
	const expandedFoldersStoreRef = React.useRef<ExpandedFoldersStore | null>(
		null,
	);
	if (!expandedFoldersStoreRef.current) {
		expandedFoldersStoreRef.current = new ExpandedFoldersStore(
			expandedFoldersProp ?? useAppStore.getState().expandedFolders ?? [],
		);
	}
	const expandedFoldersStore = expandedFoldersStoreRef.current;

	React.useEffect(() => {
		let prev = expandedFoldersProp ?? useAppStore.getState().expandedFolders;
		expandedFoldersStore.replaceAll(prev);
		const unsub = useAppStore.subscribe((state) => {
			if (state.expandedFolders === prev) return;
			prev = state.expandedFolders;
			expandedFoldersStore.replaceAll(prev);
		});
		return unsub;
	}, [expandedFoldersStore, expandedFoldersProp]);

	const handleToggleFolder = React.useCallback(
		(path: string, isOpen: boolean) => {
			expandedFoldersStore.toggle(path, isOpen);
			React.startTransition(() => {
				onToggleFolder(path, isOpen);
			});
		},
		[expandedFoldersStore, onToggleFolder],
	);

	/** Persist-expand ancestor folders when opening a note (e.g. from search). */
	const handleOpenNote = React.useCallback(
		(note: WorkspaceNote, mode: "preview" | "fixed") => {
			const parts = note.path.split("/");
			// path segments before the note name are folders (space/folder/.../note)
			for (let i = 1; i < parts.length - 1; i++) {
				const folderPath = parts.slice(0, i + 1).join("/");
				handleToggleFolder(folderPath, true);
			}
			onOpenNote(note, mode);
		},
		[handleToggleFolder, onOpenNote],
	);
	const resolvedShowPreview = React.useMemo(() => {
		const mode = spacePreviewModes.Trash ?? "global";
		if (mode === "show") return true;
		if (mode === "hide") return false;
		return showNotePreview;
	}, [spacePreviewModes, showNotePreview]);
	const showPreviewForSpace = React.useCallback(
		(spacePath: string) => {
			const mode = spacePreviewModes[spacePath] ?? "global";
			if (mode === "show") return true;
			if (mode === "hide") return false;
			return showNotePreview;
		},
		[spacePreviewModes, showNotePreview],
	);
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 6,
			},
		}),
	);

	React.useEffect(() => {
		const narrowWindow = window.matchMedia("(max-width: 56rem)");
		const collapseSpaceSidebar = () => {
			setTabletLayout(narrowWindow.matches);
			setNotesSheetOpen(false);
		};

		collapseSpaceSidebar();
		narrowWindow.addEventListener("change", collapseSpaceSidebar);
		return () =>
			narrowWindow.removeEventListener("change", collapseSpaceSidebar);
	}, []);

	React.useEffect(() => {
		const toggleNotesSheet = () => {
			if (tabletLayout) {
				setNotesSheetOpen((open) => !open);
			} else {
				setOpen(!open);
			}
		};

		window.addEventListener("paperite:toggle-notes-sheet", toggleNotesSheet);
		return () =>
			window.removeEventListener(
				"paperite:toggle-notes-sheet",
				toggleNotesSheet,
			);
	}, [open, setOpen, tabletLayout]);

	React.useEffect(() => {
		if (!import.meta.env.BETA_PAPERITE) return;

		const syncUser = () => {
			const clerkUser = clerk.user;

			setUser({
				name: clerkUser?.fullName ?? clerkUser?.username ?? "Paperite user",
				avatar: clerkUser?.imageUrl ?? "",
			});
		};

		syncUser();
		return clerk.addListener(syncUser);
	}, []);

	const logOut = async () => {
		if (!import.meta.env.BETA_PAPERITE) return;

		await clerk.signOut();
		await navigate({ to: "/login" });
	};

	const scheduleHoverOpen = React.useCallback(
		(hoverTarget: { kind: "space" | "folder"; path: string }) => {
			const key = `${hoverTarget.kind}:${hoverTarget.path}`;
			if (hoverOpenTargetRef.current === key) return;
			clearHoverOpen();
			hoverOpenTargetRef.current = key;
			hoverOpenTimerRef.current = window.setTimeout(() => {
				hoverOpenTimerRef.current = null;
				if (hoverTarget.kind === "space") {
					onSelectSpace(hoverTarget.path);
				} else {
					expandedFoldersStore.toggle(hoverTarget.path, true);
					React.startTransition(() => {
						onToggleFolder(hoverTarget.path, true);
					});
				}
			}, 400);
		},
		[clearHoverOpen, expandedFoldersStore, onSelectSpace, onToggleFolder],
	);

	const startDraggingItem = ({ active, activatorEvent }: DragStartEvent) => {
		const itemPath = String(active.id);
		isDraggingRef.current = true;
		isNoteDragRef.current = !spaces.some((space) => space.path === itemPath);
		if (activatorEvent && "clientX" in activatorEvent) {
			const ev = activatorEvent as PointerEvent | MouseEvent;
			dragPointerRef.current = { x: ev.clientX, y: ev.clientY };
		}
	};

	React.useEffect(() => {
		const onMove = (event: PointerEvent) => {
			if (!isDraggingRef.current) return;
			dragPointerRef.current = { x: event.clientX, y: event.clientY };
			if (!isNoteDragRef.current) return;
			const spacePath = spacePathUnderPointer(event.clientX, event.clientY);
			const currentSpace = useAppStore.getState().activeSpacePath;
			if (
				spacePath &&
				spacePath !== currentSpace &&
				spacePath !== "Trash" &&
				spaces.some((s) => s.path === spacePath)
			) {
				scheduleHoverOpen({ kind: "space", path: spacePath });
			} else if (!spacePath) {
				// Only clear space-hover timers when not over a space; folder
				// hover still comes from handleDragOver / dnd-kit.
				if (hoverOpenTargetRef.current?.startsWith("space:")) {
					clearHoverOpen();
				}
			}
		};
		window.addEventListener("pointermove", onMove);
		return () => window.removeEventListener("pointermove", onMove);
	}, [spaces, spacePathUnderPointer, scheduleHoverOpen, clearHoverOpen]);

	const handleDragOver = ({ active, over }: DragOverEvent) => {
		const itemPath = String(active.id);
		// Don't hover-open while reordering spaces.
		if (spaces.some((space) => space.path === itemPath)) {
			clearHoverOpen();
			return;
		}

		let hoverTarget: { kind: "space" | "folder"; path: string } | null = null;

		// Prefer dnd-kit over target when available.
		const currentSpace = useAppStore.getState().activeSpacePath;
		if (over) {
			const overId = String(over.id);
			const overData = over.data.current as
				| { type?: string; path?: string }
				| undefined;
			if (overData?.type === "space" && overData.path) {
				if (overData.path !== currentSpace && overData.path !== "Trash") {
					hoverTarget = { kind: "space", path: overData.path };
				}
			} else {
				const maybeSpace =
					overId.startsWith("drop:") &&
					!overId.startsWith("drop-list:") &&
					!overId.startsWith("drop-note:")
						? overId.slice("drop:".length)
						: spaces.some((s) => s.path === overId)
							? overId
							: null;

				if (maybeSpace && spaces.some((s) => s.path === maybeSpace)) {
					if (maybeSpace !== currentSpace && maybeSpace !== "Trash") {
						hoverTarget = { kind: "space", path: maybeSpace };
					}
				} else if (
					overId.startsWith("drop:") &&
					!overId.startsWith("drop-list:") &&
					!overId.startsWith("drop-note:")
				) {
					const folderPath = overId.slice("drop:".length);
					if (
						folderPath &&
						!spaces.some((s) => s.path === folderPath) &&
						folderPath !== "Trash" &&
						!expandedFoldersStore.isExpanded(folderPath)
					) {
						hoverTarget = { kind: "folder", path: folderPath };
					}
				}
			}
		}

		// Fallback: hit-test under pointer (works when dnd-kit misses space nodes).
		if (!hoverTarget && dragPointerRef.current) {
			const spacePath = spacePathUnderPointer(
				dragPointerRef.current.x,
				dragPointerRef.current.y,
			);
			if (
				spacePath &&
				spacePath !== currentSpace &&
				spacePath !== "Trash" &&
				spaces.some((s) => s.path === spacePath)
			) {
				hoverTarget = { kind: "space", path: spacePath };
			}
		}

		if (!hoverTarget) {
			clearHoverOpen();
			return;
		}

		scheduleHoverOpen(hoverTarget);
	};

	const moveDroppedItem = ({ active, over }: DragEndEvent) => {
		clearHoverOpen();
		const itemPath = String(active.id);
		const pointer = dragPointerRef.current;
		dragPointerRef.current = null;
		isNoteDragRef.current = false;
		isDraggingRef.current = false;

		// Resolve over id; fall back to space under pointer if dnd-kit missed it.
		let overId = over ? String(over.id) : null;
		if (!overId && pointer) {
			const spacePath = spacePathUnderPointer(pointer.x, pointer.y);
			if (spacePath && spaces.some((s) => s.path === spacePath)) {
				overId = `drop:${spacePath}`;
			}
		} else if (overId && pointer && !spaces.some((s) => s.path === itemPath)) {
			// Prefer explicit space under pointer when dropping notes onto the rail.
			const spacePath = spacePathUnderPointer(pointer.x, pointer.y);
			if (spacePath && spaces.some((s) => s.path === spacePath)) {
				overId = `drop:${spacePath}`;
			}
		}
		if (!overId) return;
		const draggedSpaceIndex = spaces.findIndex(
			(space) => space.path === itemPath,
		);
		if (draggedSpaceIndex !== -1) {
			// Space reorder: over can be plain space path (sortable) or drop:path.
			const overSpacePath = overId.startsWith("drop:")
				? overId.slice("drop:".length)
				: overId;
			const otherSpaces = spaces.filter((space) => space.path !== "Inbox");
			const activeIndex = otherSpaces.findIndex(
				(space) => space.path === itemPath,
			);
			const overIndex = otherSpaces.findIndex(
				(space) => space.path === overSpacePath,
			);
			if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) {
				return;
			}

			const nextSpaces = [...otherSpaces];
			const [movedSpace] = nextSpaces.splice(activeIndex, 1);
			nextSpaces.splice(overIndex, 0, movedSpace);
			onReorderSpaces(nextSpaces.map((space) => space.path));
			return;
		}

		// Note/folder drop: prefer explicit drop targets, but also accept
		// plain space path ids from SortableSpaceItem (sortable id === path).
		let dropTarget = dropTargetFromId(overId);
		if (!dropTarget) {
			const spaceHit = spaces.find((space) => space.path === overId);
			if (spaceHit) {
				dropTarget = {
					type: "container" as const,
					parentPath: spaceHit.path,
				};
			}
		}
		if (!dropTarget) return;

		const activeSpacePath = useAppStore.getState().activeSpacePath;
		const activeSpace = spaces.find((space) => space.path === activeSpacePath);
		const canReorderItems =
			activeSpacePath !== "Inbox" &&
			spaceSortOrders[activeSpacePath] === "custom";

		if (
			canReorderItems &&
			activeSpace &&
			dropTarget.type === "note" &&
			parentPath(itemPath) === dropTarget.parentPath &&
			itemPath !== dropTarget.itemPath
		) {
			const nextOrder = reorderCustomItemOrder(
				activeSpace,
				dropTarget.parentPath,
				customItemOrders,
				itemPath,
				dropTarget.itemPath,
			);
			if (nextOrder) onReorderItems(dropTarget.parentPath, nextOrder);
			return;
		}

		if (
			canReorderItems &&
			activeSpace &&
			dropTarget.type === "list" &&
			parentPath(itemPath) === dropTarget.parentPath
		) {
			const nextOrder = reorderCustomItemOrder(
				activeSpace,
				dropTarget.parentPath,
				customItemOrders,
				itemPath,
				null,
			);
			if (nextOrder) onReorderItems(dropTarget.parentPath, nextOrder);
			return;
		}

		const nextParentPath = dropTarget.parentPath;
		if (!nextParentPath || itemPath === nextParentPath) return;
		if (parentPath(itemPath) === nextParentPath) return;
		if (isSameOrChildPath(itemPath, nextParentPath)) return;

		onMoveItem(itemPath, nextParentPath);
	};

	const collisionDetection = React.useCallback<CollisionDetection>((args) => {
		const pointerHits = pointerWithin(args);
		if (pointerHits.length > 0) return pointerHits;
		return rectIntersection(args);
	}, []);

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={collisionDetection}
			onDragStart={startDraggingItem}
			onDragOver={handleDragOver}
			onDragEnd={moveDroppedItem}
			onDragCancel={() => {
				clearHoverOpen();
				dragPointerRef.current = null;
				isNoteDragRef.current = false;
				isDraggingRef.current = false;
			}}
		>
			<Sidebar
				collapsible="icon"
				forceDesktop
				forceCollapsed={tabletLayout}
				wrapperClassName={cn(
					"paperite-space-sidebar-wrapper",
					notesSheetOpen && "paperite-space-sidebar-wrapper-open",
				)}
				className="paperite-space-sidebar"
				{...props}
			>
				<SidebarHeader className="group-data-[collapsible=icon]:p-1 group-data-[collapsible=icon]:pt-3 pb-0">
					<div className="flex h-10 items-center justify-between px-2 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
						<div className="font-brand text-xl text-[#E94C08] group-data-[collapsible=icon]:hidden">
							Paperite
						</div>
						<SidebarTrigger
							toggleNotesSheet={tabletLayout}
							className="size-8 rounded-md group-data-[collapsible=icon]:p-2 [&_svg]:size-4"
						/>
					</div>
				</SidebarHeader>
				<SidebarContent>
					<NavMain
						spaces={spaces.map((space) => ({
							title: space.title,
							url: "#",
							path: space.path,
							icon: (
								<SpaceIcon
									color={spaceColors[space.path]}
									icon={spaceIcons[space.path]}
									path={space.path}
								/>
							),
						}))}
						onCreateSpace={onCreateSpace}
						onDeleteSpace={onDeleteSpace}
						onEditSpace={onEditSpace}
						onSelectSpace={onSelectSpace}
						spaceColorsByPath={spaceColors}
						spaceIconsByPath={spaceIcons}
					/>
				</SidebarContent>
				<SidebarFooter className="gap-1">
					<TrashNavButton onSelectSpace={onSelectSpace} />
					<NavUser
						onLogOut={logOut}
						user={user}
						showNotePreview={showNotePreview}
						closeButtonOnly={closeButtonOnly}
						syncSidebarWithActiveTab={syncSidebarWithActiveTab}
						onSetShowNotePreview={onSetShowNotePreview}
						onSetCloseButtonOnly={onSetCloseButtonOnly}
						onSetSyncSidebarWithActiveTab={onSetSyncSidebarWithActiveTab}
					/>
				</SidebarFooter>
				<SidebarRail />
			</Sidebar>
			{tabletLayout && notesSheetOpen ? (
				<button
					type="button"
					aria-label="Close notes sidebar"
					className="paperite-note-sidebar-backdrop"
					onClick={() => setNotesSheetOpen(false)}
				/>
			) : null}
			<SearchQueryContext.Provider value={debouncedSearchQuery}>
				<SearchExpandPathsContext.Provider value={searchExpandPaths}>
					<ExpandedFoldersContext.Provider value={expandedFoldersStore}>
						<aside
							data-open={notesSheetOpen}
							className="paperite-note-sidebar flex h-full min-h-0 w-80 max-w-80 shrink-0 flex-col border-r border-border/60 bg-sidebar text-sidebar-foreground"
						>
							<SidebarHeader className="gap-2 px-3 pt-3 pb-0">
								<SpaceDropHeader
									spaces={spaces}
									spaceColors={spaceColors}
									spaceIcons={spaceIcons}
									user={user}
									spacePreviewModes={spacePreviewModes}
									showNotePreview={showNotePreview}
									onCreateFolder={onCreateFolder}
									onCreateNote={onCreateNote}
									onEditSpace={onEditSpace}
									onSetSpacePreviewMode={onSetSpacePreviewMode}
									viewMode={viewMode}
									onViewModeChange={onViewModeChange}
									onSortOrderChange={onSortOrderChange}
									onFolderFirstChange={onFolderFirstChange}
									onEmptyTrash={onEmptyTrash}
								/>
								<InputGroup className="h-9">
									<InputGroupAddon>
										<SearchIcon className="size-4" />
									</InputGroupAddon>
									<InputGroupInput
										value={searchQuery}
										placeholder="Search..."
										onChange={(event) => setSearchQuery(event.target.value)}
									/>
								</InputGroup>
							</SidebarHeader>
							<SidebarContent className="[mask-image:linear-gradient(to_bottom,transparent_0,black_18px,black_100%)] [-webkit-mask-image:linear-gradient(to_bottom,transparent_0,black_18px,black_100%)]">
								<SidebarGroup className="px-3 pt-4 pb-8">
									<SidebarGroupContent>
										{debouncedSearchQuery.trim().length >= 2 ? (
											<div className="mb-4 flex flex-col gap-1.5">
												<p className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
													{ftsLoading
														? "Searching…"
														: ftsResults && ftsResults.length === 0
															? "No full-text matches"
															: ftsResults
																? `Full-text · ${ftsResults.length}`
																: "Full-text"}
												</p>
												{(ftsResults ?? []).slice(0, 40).map((hit) => (
													<button
														key={hit.path}
														type="button"
														className="flex w-full flex-col items-start gap-0.5 rounded-md border border-transparent px-3 py-2 text-left text-sm outline-none transition-colors hover:border-border/50 hover:bg-sidebar-accent"
														onClick={() =>
															onOpenNote(
																{
																	type: "note",
																	path: hit.path,
																	title: hit.title,
																	preview: hit.preview,
																	updatedAt: hit.updatedAt,
																	pinned: false,
																},
																"preview",
															)
														}
														onPointerEnter={() => onPrefetchNote?.(hit.path)}
													>
														<span className="w-full truncate font-medium">
															{hit.title.trim() || "Untitled"}
														</span>
														{hit.preview ? (
															<span className="line-clamp-2 w-full text-xs text-muted-foreground">
																{hit.preview}
															</span>
														) : null}
													</button>
												))}
											</div>
										) : null}
										<SpaceVisibility path="Trash">
											{trashNotes.length > 0 ? (
												<NoteGrid
													items={trashNotes.map((n) => ({
														type: "note" as const,
														title: n.title,
														path: n.trashPath,
														preview: n.preview,
														updatedAt: n.deletedAt,
														pinned: false,
													}))}
													onDeleteItem={() => {}}
													onMoveItem={() => {}}
													onOpenNote={handleOpenNote}
													spaces={spaces}
													spaceIcons={spaceIcons}
													spaceColors={spaceColors}
													showPreview={resolvedShowPreview}
													isTrash
													onRestoreItem={onRestoreItem}
													onPermanentDeleteItem={onPermanentDeleteItem}
												/>
											) : (
												<Empty>
													<EmptyHeader>
														<EmptyMedia variant="icon">
															<Trash2Icon />
														</EmptyMedia>
														<EmptyTitle>Trash is empty</EmptyTitle>
														<EmptyDescription>
															Deleted notes will appear here.
														</EmptyDescription>
													</EmptyHeader>
												</Empty>
											)}
										</SpaceVisibility>
										{mountedSpacePaths.map((spacePath) => {
											const entry = mountedSpaceItems.get(spacePath);
											if (!entry) return null;
											const { items: spaceItems } = entry;
											return (
												<SpaceVisibility key={spacePath} path={spacePath}>
													{spaceItems.length > 0 ? (
														viewMode === "grid" && spacePath === "Inbox" ? (
															<NoteGrid
																items={spaceItems}
																			onDeleteItem={onDeleteItem}
																onMoveItem={onMoveItem}
																onOpenNote={handleOpenNote}
																spaces={spaces}
																spaceIcons={spaceIcons}
																spaceColors={spaceColors}
																showPreview={showPreviewForSpace(spacePath)}
															/>
														) : (
															<MemoizedNoteTree
																			canDragItems={canDragItems}
																items={spaceItems}
																onCreateFolder={onCreateFolder}
																onCreateNote={onCreateNote}
																onDeleteItem={onDeleteItem}
																onMoveItem={onMoveItem}
																onOpenNote={handleOpenNote}
																onPrefetchNote={onPrefetchNote}
																onRenameItem={onRenameItem}
																onToggleFolder={handleToggleFolder}
																parentPath={spacePath}
																spaces={spaces}
																spaceIcons={spaceIcons}
																spaceColors={spaceColors}
																showPreview={showPreviewForSpace(spacePath)}
																isInbox={spacePath === "Inbox"}
																newlyCreatedFolderPath={newlyCreatedFolderPath}
																onRenameComplete={onRenameComplete}
															/>
														)
													) : (
														<Empty>
															<EmptyHeader>
																<EmptyMedia variant="icon">
																	<FileTextIcon />
																</EmptyMedia>
																<EmptyTitle>No notes yet</EmptyTitle>
																<EmptyDescription>
																	Create a note or drop one into this space.
																</EmptyDescription>
															</EmptyHeader>
															<EmptyContent className="flex-row justify-center">
																{spacePath !== "Inbox" && (
																	<Button
																		type="button"
																		size="sm"
																		variant="outline"
																		onClick={() => onCreateFolder(spacePath)}
																	>
																		<FolderPlusIcon />
																		New folder
																	</Button>
																)}
																<Button
																	type="button"
																	size="sm"
																	onClick={() => onCreateNote(spacePath)}
																>
																	<StickyNotePlusIcon />
																	New note
																</Button>
															</EmptyContent>
														</Empty>
													)}
												</SpaceVisibility>
											);
										})}
									</SidebarGroupContent>
								</SidebarGroup>
							</SidebarContent>
						</aside>
					</ExpandedFoldersContext.Provider>
				</SearchExpandPathsContext.Provider>
			</SearchQueryContext.Provider>
			<SidebarDragOverlay />
		</DndContext>
	);
}

export const AppSidebar = React.memo(AppSidebarImpl);

const dropTargetId = (path: string) => `drop:${path}`;

const listDropTargetId = (path: string) => `drop-list:${path}`;

const noteDropTargetId = (notePath: string, parentPath: string) =>
	`drop-note:${parentPath}:${notePath}`;

const dropTargetFromId = (id: string) => {
	if (id.startsWith("drop:")) {
		return { type: "container" as const, parentPath: id.slice("drop:".length) };
	}
	if (id.startsWith("drop-list:")) {
		return { type: "list" as const, parentPath: id.slice("drop-list:".length) };
	}
	if (id.startsWith("drop-note:")) {
		const value = id.slice("drop-note:".length);
		const [targetParentPath, notePath] = value.split(/:(.+)/);
		return notePath
			? {
					type: "note" as const,
					parentPath: targetParentPath,
					itemPath: notePath,
				}
			: null;
	}
	return null;
};

const reorderCustomItemOrder = (
	space: WorkspaceSpace | undefined,
	targetParentPath: string,
	customItemOrders: Record<string, string[]>,
	itemPath: string,
	targetItemPath: string | null,
) => {
	const siblings = workspaceItemsForParent(space, targetParentPath);
	if (!siblings.some((item) => item.path === itemPath)) return null;

	const currentOrder = orderItemsByCustomOrder(
		siblings,
		customItemOrders[targetParentPath],
	).map((item) => item.path);
	const withoutItem = currentOrder.filter((path) => path !== itemPath);
	const targetIndex = targetItemPath
		? withoutItem.indexOf(targetItemPath)
		: withoutItem.length;

	if (targetIndex === -1) return null;

	withoutItem.splice(targetIndex, 0, itemPath);
	return withoutItem;
};

const workspaceItemsForParent = (
	space: WorkspaceSpace | undefined,
	parentPathToFind: string,
): WorkspaceItem[] => {
	if (!space) return [];
	if (space.path === parentPathToFind) return space.children;

	return workspaceItemsForParentInItems(space.children, parentPathToFind);
};

const workspaceItemsForParentInItems = (
	items: WorkspaceItem[],
	parentPathToFind: string,
): WorkspaceItem[] => {
	for (const item of items) {
		if (item.type !== "folder") continue;
		if (item.path === parentPathToFind) return item.children;

		const children = workspaceItemsForParentInItems(
			item.children,
			parentPathToFind,
		);
		if (children.length > 0) return children;
	}

	return [];
};

const parentPath = (itemPath: string) => {
	const separatorIndex = itemPath.lastIndexOf("/");
	return separatorIndex === -1 ? "" : itemPath.slice(0, separatorIndex);
};

const isSameOrChildPath = (parent: string, child: string) =>
	child === parent || child.startsWith(`${parent}/`);

const spaceIconMap = {
	cloud: CloudIcon,
	folder: FolderIcon,
	briefcase: BriefcaseBusinessIcon,
	book: BookOpenIcon,
	idea: LightbulbIcon,
	code: CodeIcon,
	gem: GemIcon,
	heart: HeartIcon,
	brain: BrainIcon,
	sparkles: SparklesIcon,
	star: StarIcon,
	music: MusicIcon,
	camera: CameraIcon,
	bookmark: BookmarkIcon,
	zap: ZapIcon,
	compass: CompassIcon,
	users: UsersIcon,
	pin: PinIcon,
};

const customIconPrefix = "custom:";

const getCustomIcon = (icon?: string) =>
	icon?.startsWith(customIconPrefix)
		? icon.slice(customIconPrefix.length)
		: null;
