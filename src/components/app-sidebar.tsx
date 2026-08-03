"use client";

import {
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	PointerSensor,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "@tanstack/react-router";
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
	InfoIcon,
	LayoutDashboardIcon,
	LightbulbIcon,
	ListIcon,
	MusicIcon,
	PaletteIcon,
	PencilIcon,
	PinIcon,
	RotateCcwIcon,
	SearchIcon,
	SparklesIcon,
	StarIcon,
	StickyNotePlusIcon,
	Trash2Icon,
	UsersIcon,
	ZapIcon,
} from "lucide-react";
import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/lib/stores/app-store";
import { useEditorUiStore } from "@/lib/stores/editor-ui-store";
import { getNotesEngine } from "@/lib/notes-engine";
import type { NoteSearchResult } from "@/lib/storage/types";
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
	DropdownMenu,
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
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group";
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
import { clerk } from "@/lib/clerk";
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

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
	spaces: WorkspaceSpace[];
	spaceColors?: Record<string, string>;
	spaceIcons?: Record<string, string>;
	spacePreviewModes?: Record<string, SpacePreviewMode>;
	showNotePreview?: boolean;
	closeButtonOnly?: boolean;
	onSetShowNotePreview?: (show: boolean) => void;
	onSetCloseButtonOnly?: (closeButtonOnly: boolean) => void;
	onSetSpacePreviewMode?: (spacePath: string, mode: SpacePreviewMode) => void;
	activeSpacePath?: string;
	activeNotePath?: string | null;
	expandedFolders?: string[];
	viewMode?: "list" | "grid";
	onViewModeChange?: (mode: "list" | "grid") => void;
	sortOrder?: SidebarSortOrder;
	onSortOrderChange?: (order: SidebarSortOrder) => void;
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
	trashNotes: TrashNote[];
	onRestoreItem: (trashNoteName: string) => void;
	onPermanentDeleteItem: (trashNoteName: string) => void;
	onEmptyTrash: () => void;
	newlyCreatedFolderPath: string | null;
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

	if (sortOrder === "custom") {
		return pinFirst(
			orderItemsByCustomOrder(
				withSortedChildren,
				customItemOrders[parentPath],
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
		return pinFirst(sorted);
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
	return pinFirst(dateSorted);
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

const SearchExpandPathsContext = React.createContext<ReadonlySet<string>>(
	new Set(),
);

/** Folder paths that must stay open so search hits inside them are visible. */
function collectSearchExpandPaths(
	items: WorkspaceItem[],
	query: string,
): Set<string> {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const paths = new Set<string>();
	if (!normalizedQuery) return paths;

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
	activeNotePath,
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
	activeNotePath: string | null;
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
				activeNotePath={activeNotePath}
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
				isActive={activeNotePath === item.path}
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
				className="flex min-h-8 flex-col gap-1.5 rounded-md data-[over=true]:bg-sidebar-accent/50"
				data-over={isOver}
			>
				{items.map((item) => renderItem(item))}
			</div>
		);
	}

	return (
		<div
			ref={setListRef}
			className="relative min-h-8 rounded-md data-[over=true]:bg-sidebar-accent/50"
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
		</div>
	);
}

const MemoizedNoteTree = React.memo(NoteTree);

function NoteGrid({
	items,
	activeNotePath,
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
	activeNotePath: string | null;
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
					isActive={activeNotePath === note.path}
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
	isActive,
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
	isActive: boolean;
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
						<div className="line-clamp-3 text-sm font-semibold leading-tight">
							{note.pinned ? (
								<PinIcon className="mr-1 inline size-3.5 shrink-0 text-muted-foreground" />
							) : null}
							{highlightSearchText(displayTitle, searchQuery)}
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
							<MoveToSpaceMenu
								spaces={spaces}
								spaceIcons={spaceIcons}
								spaceColors={spaceColors}
								notePath={note.path}
								onMove={(spacePath) => onMoveItem(note.path, spacePath)}
							/>
							<ContextMenuItem onSelect={() => void toggleNotePinned(note)}>
								<PinIcon />
								{note.pinned ? "Unpin note" : "Pin note"}
							</ContextMenuItem>
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
	activeNotePath,
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
	activeNotePath: string | null;
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
				activeNotePath={activeNotePath}
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
	activeNotePath,
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
	activeNotePath: string | null;
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
												if (useFolderRenameStore.getState().path !== item.path) {
													return;
												}
												if (document.activeElement === renameInputRef.current) {
													return;
												}
												const draft = useFolderRenameStore.getState().draft.trim();
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
								activeNotePath={activeNotePath}
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
					<ContextMenuItem disabled>
						<PaletteIcon />
						Change icon
					</ContextMenuItem>
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
		prev.activeNotePath === next.activeNotePath &&
		prev.canDragItems === next.canDragItems &&
		prev.showPreview === next.showPreview &&
		prev.isInbox === next.isInbox &&
		prev.newlyCreatedFolderPath === next.newlyCreatedFolderPath,
);

const MemoizedNoteCard = React.memo(function NoteCard({
	canDragItems,
	item,
	isActive,
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
	isActive: boolean;
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
	const [deleteOpen, setDeleteOpen] = React.useState(false);
	const [infoOpen, setInfoOpen] = React.useState(false);
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
	const displayTitle =
		(titleDraft !== undefined ? titleDraft : item.title).trim() || "Untitled";

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<button
						ref={setNodeRef}
						type="button"
						className={cn(
							"flex w-full flex-col items-start gap-1.5 rounded-md border border-transparent px-3 py-2.5 text-left text-sm leading-tight whitespace-nowrap outline-none transition-all duration-150 hover:border-border/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-0 active:scale-[0.98] data-[active=true]:border-border/50 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[dragging=true]:opacity-0 data-[over=true]:bg-sidebar-accent",
							canDragItems && "touch-none",
						)}
						data-active={isActive}
						data-dragging={isDragging}
						data-over={isOver}
						{...(canDragItems ? attributes : {})}
						{...(canDragItems ? listeners : {})}
						onPointerEnter={() => onPrefetchNote?.(item.path)}
						onClick={() => onOpenNote(item, "preview")}
						onDoubleClick={() => onOpenNote(item, "fixed")}
					>
						<div className="flex w-full items-center gap-2">
							<span className="min-w-0 flex-1 truncate font-medium">
								<>
								{item.pinned ? (
									<PinIcon className="mr-1 inline size-3.5 shrink-0 text-muted-foreground" />
								) : null}
								{highlightSearchText(displayTitle, searchQuery)}
							</>
							</span>
						</div>
						{showPreview && item.preview ? (
							<span className="line-clamp-2 w-full text-xs whitespace-break-spaces text-sidebar-foreground/65">
								{highlightSearchText(item.preview, searchQuery)}
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
							<ContextMenuItem onSelect={() => setInfoOpen(true)}>
								<InfoIcon />
								Note Info
							</ContextMenuItem>
							<ContextMenuSeparator />
							<MoveToSpaceMenu
								spaces={spaces}
								spaceIcons={spaceIcons}
								spaceColors={spaceColors}
								notePath={item.path}
								onMove={(spacePath) => onMoveItem(item.path, spacePath)}
							/>
							<ContextMenuItem onSelect={() => void toggleNotePinned(item)}>
								<PinIcon />
								{item.pinned ? "Unpin note" : "Pin note"}
							</ContextMenuItem>
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
			<AlertDialog open={infoOpen} onOpenChange={setInfoOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Note Info</AlertDialogTitle>
						<AlertDialogDescription className="break-all text-left">
							Title: {item.title}
							<br />
							Path: {item.path}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction onClick={() => setInfoOpen(false)}>
							OK
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
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
});

function SpaceDropHeader({
	activeSpacePath,
	onCreateFolder,
	onCreateNote,
	onDeleteSpace,
	spacePreviewModes,
	showNotePreview,
	onSetSpacePreviewMode,
	spaceColor,
	spaceIcon,
	spaceTitle,
	viewMode,
	onViewModeChange,
	sortOrder,
	onSortOrderChange,
	isTrash,
	onEmptyTrash,
}: {
	activeSpacePath: string;
	onCreateFolder: (parentPath: string) => void;
	onCreateNote: (parentPath: string) => void;
	onDeleteSpace: (path: string) => void;
	spacePreviewModes: Record<string, SpacePreviewMode>;
	showNotePreview: boolean;
	onSetSpacePreviewMode: (spacePath: string, mode: SpacePreviewMode) => void;
	spaceColor?: string;
	spaceIcon?: string;
	spaceTitle: string;
	viewMode: "list" | "grid";
	onViewModeChange: (mode: "list" | "grid") => void;
	sortOrder: SidebarSortOrder;
	onSortOrderChange: (order: SidebarSortOrder) => void;
	isTrash?: boolean;
	onEmptyTrash?: () => void;
}) {
	const { isOver, setNodeRef } = useDroppable({
		id: dropTargetId(activeSpacePath),
	});
	const isInbox = activeSpacePath === "Inbox";
	const spacePreviewMode = spacePreviewModes[activeSpacePath] ?? "global";

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
					<DropdownMenuContent align="start" className="w-56">
						{isInbox ? (
							<>
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
									</DropdownMenuSubContent>
								</DropdownMenuSub>
							</>
						) : (
							<>
								<DropdownMenuSub>
									<DropdownMenuSubTrigger>
										<ArrowUpDownIcon className="text-muted-foreground" />
										<span>Sort by</span>
									</DropdownMenuSubTrigger>
									<DropdownMenuSubContent>
										<DropdownMenuRadioGroup
											value={sortOrder}
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
											<DropdownMenuRadioItem value="custom">
												<span>Custom</span>
											</DropdownMenuRadioItem>
										</DropdownMenuRadioGroup>
									</DropdownMenuSubContent>
								</DropdownMenuSub>
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
								<DropdownMenuSeparator />
								<DropdownMenuItem
									onSelect={() => {
										window.dispatchEvent(
											new CustomEvent("paperite:open-edit-space", {
												detail: activeSpacePath,
											}),
										);
									}}
								>
									<PencilIcon className="text-muted-foreground" />
									<span>Edit Space</span>
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									variant="destructive"
									onSelect={() => onDeleteSpace(activeSpacePath)}
								>
									<Trash2Icon />
									<span>Delete Space</span>
								</DropdownMenuItem>
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			)}
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

function AppSidebarImpl({
	activeNotePath: activeNotePathProp,
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
	onSetShowNotePreview: onSetShowNotePreviewProp,
	onSetCloseButtonOnly: onSetCloseButtonOnlyProp,
	onSetSpacePreviewMode: onSetSpacePreviewModeProp,
	spaces,
	viewMode: viewModeProp,
	onViewModeChange: onViewModeChangeProp,
	sortOrder: sortOrderProp,
	onSortOrderChange: onSortOrderChangeProp,
	customItemOrders: customItemOrdersProp,
	onReorderItems,
	trashNotes,
	onRestoreItem,
	onPermanentDeleteItem,
	onEmptyTrash,
	newlyCreatedFolderPath,
	onRenameComplete,
	...props
}: AppSidebarProps) {
	const navigate = useNavigate();
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

	const storeUi = useAppStore(
		useShallow((st) => ({
			activeNotePath: st.activeNotePath,
			activeSpacePath: st.activeSpacePath,
			expandedFolders: st.expandedFolders,
			spaceColors: st.spaceColors,
			spaceIcons: st.spaceIcons,
			spacePreviewModes: st.spacePreviewModes,
			showNotePreview: st.showNotePreview,
			closeButtonOnly: st.closeButtonOnly,
			customItemOrders: st.customItemOrders,
			inboxViewMode: st.inboxViewMode,
			spaceSortOrders: st.spaceSortOrders,
		})),
	);
	const activeNotePath = storeUi.activeNotePath ?? activeNotePathProp ?? null;
	const activeSpacePath =
		storeUi.activeSpacePath ?? activeSpacePathProp ?? "Inbox";
	const expandedFolders =
		storeUi.expandedFolders ?? expandedFoldersProp ?? [];
	const spaceColors = storeUi.spaceColors ?? spaceColorsProp ?? {};
	const spaceIcons = storeUi.spaceIcons ?? spaceIconsProp ?? {};
	const spacePreviewModes =
		storeUi.spacePreviewModes ?? spacePreviewModesProp ?? {};
	const showNotePreview =
		storeUi.showNotePreview ?? showNotePreviewProp ?? true;
	const closeButtonOnly =
		storeUi.closeButtonOnly ?? closeButtonOnlyProp ?? false;
	const customItemOrders =
		storeUi.customItemOrders ?? customItemOrdersProp ?? {};
	const viewMode = storeUi.inboxViewMode ?? viewModeProp ?? "list";
	const sortOrder: SidebarSortOrder = (() => {
		if (sortOrderProp) return sortOrderProp;
		const raw = storeUi.spaceSortOrders[activeSpacePath];
		const normalized =
			raw === "newest" ||
			raw === "oldest" ||
			raw === "a-z" ||
			raw === "z-a" ||
			raw === "custom"
				? raw
				: "newest";
		return activeSpacePath === "Inbox" && normalized === "custom"
			? "newest"
			: normalized;
	})();
	const onSetShowNotePreview =
		onSetShowNotePreviewProp ??
		((show: boolean) => useAppStore.getState().setShowNotePreview(show));
	const onSetCloseButtonOnly =
		onSetCloseButtonOnlyProp ??
		((value: boolean) => useAppStore.getState().setCloseButtonOnly(value));
	const onSetSpacePreviewMode =
		onSetSpacePreviewModeProp ??
		((spacePath: string, mode: SpacePreviewMode) =>
			useAppStore.getState().setSpacePreviewMode(spacePath, mode));
	const onViewModeChange =
		onViewModeChangeProp ??
		((mode: "list" | "grid") => useAppStore.getState().setInboxViewMode(mode));
	const onSortOrderChange =
		onSortOrderChangeProp ??
		((order: SidebarSortOrder) =>
			useAppStore.getState().setSpaceSortOrder(activeSpacePath, order));

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
	const [dragPreviewItem, setDragPreviewItem] =
		React.useState<DragPreviewItem | null>(null);
	// Keep previously visited space lists mounted (hide/show) so switching
	// spaces is instant — same idea as browser tabs / editor tabs.
	const [mountedSpacePaths, setMountedSpacePaths] = React.useState<string[]>(
		() =>
			activeSpacePath && activeSpacePath !== "Trash"
				? [activeSpacePath]
				: ["Inbox"],
	);
	// One effect owns both "mount active space" and "prune dead paths".
	// Splitting them races on first hydrate: spaces starts [], the prune
	// effect wipes mountedSpacePaths to [], then activeSpacePath never
	// changes so the mount effect never re-adds Inbox — empty note list
	// forever even though notes are on disk.
	React.useEffect(() => {
		const valid = new Set(spaces.map((space) => space.path));

		setMountedSpacePaths((prev) => {
			// Workspace not hydrated yet — don't prune against an empty set.
			if (valid.size === 0) return prev;

			let next = prev.filter((path) => valid.has(path));

			if (
				activeSpacePath &&
				activeSpacePath !== "Trash" &&
				valid.has(activeSpacePath) &&
				!next.includes(activeSpacePath)
			) {
				next = [...next, activeSpacePath];
			}

			if (
				next.length === prev.length &&
				next.every((path, index) => path === prev[index])
			) {
				return prev;
			}
			return next;
		});
	}, [spaces, activeSpacePath]);
	const activeSpace = spaces.find((space) => space.path === activeSpacePath);
	const visibleChildren = React.useMemo(
		() => filterWorkspaceItems(activeSpace?.children ?? [], debouncedSearchQuery),
		[activeSpace?.children, debouncedSearchQuery],
	);

	const searchExpandPaths = React.useMemo(
		() => collectSearchExpandPaths(activeSpace?.children ?? [], debouncedSearchQuery),
		[activeSpace?.children, debouncedSearchQuery],
	);
	const sortedVisibleChildren = React.useMemo(
		() =>
			sortWorkspaceItems(
				visibleChildren,
				activeSpacePath === "Inbox" && sortOrder === "custom"
					? "newest"
					: sortOrder,
				customItemOrders,
				activeSpacePath,
			),
		[activeSpacePath, customItemOrders, visibleChildren, sortOrder],
	);
	const spaceItemsCacheRef = React.useRef(
		new Map<
			string,
			{
				children: unknown;
				searchQuery: string;
				sortOrder: string;
				customOrder: unknown;
				items: typeof sortedVisibleChildren;
			}
		>(),
	);
	const sortOrderByPathRef = React.useRef<Record<string, typeof sortOrder>>({});
	if (activeSpacePath && activeSpacePath !== "Trash") {
		sortOrderByPathRef.current[activeSpacePath] = sortOrder;
	}
	const mountedSpaceItems = React.useMemo(() => {
		const map = new Map<
			string,
			{ space: (typeof spaces)[number]; items: typeof sortedVisibleChildren }
		>();
		for (const path of mountedSpacePaths) {
			const space = spaces.find((entry) => entry.path === path);
			if (!space) continue;
			const pathSort = sortOrderByPathRef.current[path] ?? sortOrder;
			const effectiveSort =
				path === "Inbox" && pathSort === "custom" ? "newest" : pathSort;
			const customOrder = customItemOrders[path];
			const cached = spaceItemsCacheRef.current.get(path);
			if (
				cached &&
				cached.children === space.children &&
				cached.searchQuery === debouncedSearchQuery &&
				cached.sortOrder === effectiveSort &&
				cached.customOrder === customOrder
			) {
				map.set(path, { space, items: cached.items });
				continue;
			}
			const items = sortWorkspaceItems(
				filterWorkspaceItems(space.children ?? [], debouncedSearchQuery),
				effectiveSort,
				customItemOrders,
				path,
			);
			spaceItemsCacheRef.current.set(path, {
				children: space.children,
				searchQuery: debouncedSearchQuery,
				sortOrder: effectiveSort,
				customOrder,
				items,
			});
			map.set(path, { space, items });
		}
		return map;
	}, [
		mountedSpacePaths,
		spaces,
		activeSpacePath,
		sortOrder,
		customItemOrders,
		debouncedSearchQuery,
	]);
	const canDragItems = true;
	const canReorderItems = activeSpacePath !== "Inbox" && sortOrder === "custom";
	// Keep expand/collapse state in a per-path store so the sidebar paints
	// immediately AND toggling one folder doesn't re-render every other
	// mounted folder. Parent appState updates are deferred via startTransition
	// to avoid freezing the whole Electron window (TipTap editor re-render).
	const expandedFoldersStoreRef = React.useRef<ExpandedFoldersStore | null>(
		null,
	);
	if (!expandedFoldersStoreRef.current) {
		expandedFoldersStoreRef.current = new ExpandedFoldersStore(
			expandedFolders,
		);
	}
	const expandedFoldersStore = expandedFoldersStoreRef.current;

	React.useEffect(() => {
		expandedFoldersStore.replaceAll(expandedFolders);
	}, [expandedFoldersStore, expandedFolders]);

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
		const mode = spacePreviewModes[activeSpacePath] ?? "global";
		if (mode === "show") return true;
		if (mode === "hide") return false;
		return showNotePreview;
	}, [activeSpacePath, spacePreviewModes, showNotePreview]);
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

	const startDraggingItem = ({ active }: DragStartEvent) => {
		const data = active.data.current as DragPreviewItem | undefined;
		setDragPreviewItem(data?.title ? data : null);
	};

	const moveDroppedItem = ({ active, over }: DragEndEvent) => {
		setDragPreviewItem(null);
		if (!over) return;

		const itemPath = String(active.id);
		const draggedSpaceIndex = spaces.findIndex(
			(space) => space.path === itemPath,
		);
		if (draggedSpaceIndex !== -1) {
			const overSpacePath = String(over.id);
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

		const dropTarget = dropTargetFromId(String(over.id));
		if (!dropTarget) return;

		if (
			canReorderItems &&
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

	return (
		<DndContext
			sensors={sensors}
			onDragStart={startDraggingItem}
			onDragEnd={moveDroppedItem}
			onDragCancel={() => setDragPreviewItem(null)}
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
						activeSpacePath={activeSpacePath}
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
					<button
						type="button"
						onClick={() => onSelectSpace("Trash")}
						className={cn(
							"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors",
							activeSpacePath === "Trash"
								? "bg-sidebar-accent text-sidebar-accent-foreground"
								: "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
						)}
					>
						<Trash2Icon className="size-4 shrink-0" />
						<span className="min-w-0 flex-1 truncate text-left">Trash</span>
					</button>
					<NavUser
						onLogOut={logOut}
						user={user}
						showNotePreview={showNotePreview}
						closeButtonOnly={closeButtonOnly}
						onSetShowNotePreview={onSetShowNotePreview}
						onSetCloseButtonOnly={onSetCloseButtonOnly}
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
							activeSpacePath={activeSpacePath}
							spaceTitle={
								activeSpacePath === "Trash"
									? "Trash"
									: (activeSpace?.title ?? "Inbox")
							}
							spaceColor={spaceColors[activeSpacePath]}
							spaceIcon={spaceIcons[activeSpacePath]}
							spacePreviewModes={spacePreviewModes}
							showNotePreview={showNotePreview}
							onCreateFolder={onCreateFolder}
							onCreateNote={onCreateNote}
							onDeleteSpace={onDeleteSpace}
							onSetSpacePreviewMode={onSetSpacePreviewMode}
							viewMode={viewMode}
							onViewModeChange={onViewModeChange}
							sortOrder={sortOrder}
							onSortOrderChange={onSortOrderChange}
							isTrash={activeSpacePath === "Trash"}
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
								{activeSpacePath === "Trash" ? (
									trashNotes.length > 0 ? (
										<NoteGrid
											items={trashNotes.map((n) => ({
												type: "note" as const,
												title: n.title,
												path: n.trashPath,
												preview: n.preview,
												updatedAt: n.deletedAt,
												pinned: false,
											}))}
											activeNotePath={activeNotePath}
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
									)
								) : (
									mountedSpacePaths.map((spacePath) => {
										const entry = mountedSpaceItems.get(spacePath);
										if (!entry) return null;
										const isActive = spacePath === activeSpacePath;
										const { items: spaceItems } = entry;
										return (
											<div
												key={spacePath}
												className={isActive ? undefined : "hidden"}
												hidden={!isActive}
												aria-hidden={!isActive}
											>
												{spaceItems.length > 0 ? (
													viewMode === "grid" && spacePath === "Inbox" ? (
														<NoteGrid
															items={spaceItems}
															activeNotePath={activeNotePath}
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
															activeNotePath={activeNotePath}
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
															newlyCreatedFolderPath={
																isActive ? newlyCreatedFolderPath : null
															}
															onRenameComplete={onRenameComplete}
														/>
													)
												) : isActive ? (
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
												) : null}
											</div>
										);
									})
								)}
							</SidebarGroupContent>
						</SidebarGroup>
					</SidebarContent>
				</aside>
			</ExpandedFoldersContext.Provider>
			</SearchExpandPathsContext.Provider>
			</SearchQueryContext.Provider>
			<DragOverlay dropAnimation={null}>
				{dragPreviewItem ? <DragItemPreview item={dragPreviewItem} /> : null}
			</DragOverlay>
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
