"use client";

import {
	DndContext,
	type DragEndEvent,
	PointerSensor,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "@tanstack/react-router";
import {
	BookOpenIcon,
	BrainIcon,
	BriefcaseBusinessIcon,
	CheckIcon,
	ChevronDownIcon,
	CloudIcon,
	CodeIcon,
	FileTextIcon,
	FolderIcon,
	FolderPlusIcon,
	GemIcon,
	HeartIcon,
	InboxIcon,
	InfoIcon,
	LayoutGridIcon,
	LightbulbIcon,
	ListIcon,
	PaletteIcon,
	PencilIcon,
	SearchIcon,
	SparklesIcon,
	StickyNotePlusIcon,
	Trash2Icon,
} from "lucide-react";
import * as React from "react";
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
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
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

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
	spaces: WorkspaceSpace[];
	spaceColors: Record<string, string>;
	spaceIcons: Record<string, string>;
	activeSpacePath: string;
	activeNotePath: string | null;
	expandedFolders: string[];
	viewMode: "list" | "grid";
	onViewModeChange: (mode: "list" | "grid") => void;
	onCreateFolder: (parentPath: string) => void;
	onCreateNote: (parentPath: string) => void;
	onCreateSpace: (title: string, color: string, icon: string) => void;
	onDeleteItem: (path: string) => void;
	onDeleteSpace: (path: string) => void;
	onMoveItem: (itemPath: string, nextParentPath: string) => void;
	onOpenNote: (note: WorkspaceNote, mode: "preview" | "pinned") => void;
	onRenameItem: (path: string, title: string) => void;
	onEditSpace: (
		path: string,
		title: string,
		color: string,
		icon: string,
	) => void;
	onSelectSpace: (path: string) => void;
	onToggleFolder: (path: string, isOpen: boolean) => void;
};

const fallbackUser = {
	name: "iydheko",
	avatar: "https://github.com/ferdinankurnian.png",
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
				item.preview.toLocaleLowerCase().includes(normalizedQuery)
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

function NoteTree({
	activeNotePath,
	expandedFolders,
	items,
	level = 0,
	onCreateFolder,
	onCreateNote,
	onDeleteItem,
	onMoveItem,
	onOpenNote,
	onRenameItem,
	onToggleFolder,
	parentPath,
	isInbox = false,
}: {
	activeNotePath: string | null;
	expandedFolders: string[];
	items: WorkspaceItem[];
	level?: number;
	onCreateFolder: (parentPath: string) => void;
	onCreateNote: (parentPath: string) => void;
	onDeleteItem: (path: string) => void;
	onMoveItem: (itemPath: string, nextParentPath: string) => void;
	onOpenNote: (note: WorkspaceNote, mode: "preview" | "pinned") => void;
	onRenameItem: (path: string, title: string) => void;
	onToggleFolder: (path: string, isOpen: boolean) => void;
	parentPath: string;
	isInbox?: boolean;
}) {
	const { isOver, setNodeRef } = useDroppable({
		id: listDropTargetId(parentPath),
	});

	return (
		<div
			ref={setNodeRef}
			className="flex min-h-8 flex-col gap-1.5 rounded-md data-[over=true]:bg-sidebar-accent/50"
			data-over={isOver}
		>
			{items.map((item) =>
				item.type === "folder" ? (
					<NoteFolderItem
						activeNotePath={activeNotePath}
						expandedFolders={expandedFolders}
						item={item}
						key={item.path}
						level={level}
						onCreateFolder={onCreateFolder}
						onCreateNote={onCreateNote}
						onDeleteItem={onDeleteItem}
						onMoveItem={onMoveItem}
						onOpenNote={onOpenNote}
						onRenameItem={onRenameItem}
						onToggleFolder={onToggleFolder}
						isInbox={isInbox}
					/>
				) : (
					<NoteCard
						isActive={activeNotePath === item.path}
						item={item}
						key={item.path}
						onMoveItem={onMoveItem}
						onOpenNote={onOpenNote}
						onDeleteItem={onDeleteItem}
						parentPath={parentPath}
					/>
				),
			)}
		</div>
	);
}

function NoteGrid({
	items,
	activeNotePath,
	onDeleteItem,
	onOpenNote,
}: {
	items: WorkspaceItem[];
	activeNotePath: string | null;
	onDeleteItem: (path: string) => void;
	onOpenNote: (note: WorkspaceNote, mode: "preview" | "pinned") => void;
}) {
	const notes = React.useMemo(
		() =>
			items.filter(
				(item): item is WorkspaceNote => item.type === "note",
			),
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
					onOpenNote={onOpenNote}
				/>
			))}
		</div>
	);
}

function NoteGridCard({
	note,
	isActive,
	onDeleteItem,
	onOpenNote,
}: {
	note: WorkspaceNote;
	isActive: boolean;
	onDeleteItem: (path: string) => void;
	onOpenNote: (note: WorkspaceNote, mode: "preview" | "pinned") => void;
}) {
	const [deleteOpen, setDeleteOpen] = React.useState(false);
	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<button
						type="button"
						className="mb-2 w-full break-inside-avoid rounded-lg border border-border/50 bg-sidebar p-3 text-left transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground"
						data-active={isActive}
						onClick={() => onOpenNote(note, "preview")}
						onDoubleClick={() => onOpenNote(note, "pinned")}
					>
						<div className="line-clamp-3 text-sm font-semibold leading-tight">
							{note.title.trim() || "Untitled"}
						</div>
						{note.preview ? (
							<p className="mt-1 text-xs leading-snug text-muted-foreground line-clamp-4">
								{note.preview}
							</p>
						) : null}
					</button>
				</ContextMenuTrigger>
				<ContextMenuContent className="w-44">
					<ContextMenuItem
						variant="destructive"
						onSelect={() => setDeleteOpen(true)}
					>
						<Trash2Icon />
						Delete note
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete note?</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete "{note.title || "Untitled"}".
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

function NoteFolderItem({
	activeNotePath,
	expandedFolders,
	item,
	level,
	onCreateFolder,
	onCreateNote,
	onDeleteItem,
	onMoveItem,
	onOpenNote,
	onRenameItem,
	onToggleFolder,
	isInbox = false,
}: {
	activeNotePath: string | null;
	expandedFolders: string[];
	item: WorkspaceFolder;
	level: number;
	onCreateFolder: (parentPath: string) => void;
	onCreateNote: (parentPath: string) => void;
	onDeleteItem: (path: string) => void;
	onMoveItem: (itemPath: string, nextParentPath: string) => void;
	onOpenNote: (note: WorkspaceNote, mode: "preview" | "pinned") => void;
	onRenameItem: (path: string, title: string) => void;
	onToggleFolder: (path: string, isOpen: boolean) => void;
	isInbox?: boolean;
}) {
	const isOpen = expandedFolders.includes(item.path);
	const hasChildren = item.children.length > 0;
	const [deleteOpen, setDeleteOpen] = React.useState(false);
	const [renameOpen, setRenameOpen] = React.useState(false);
	const [renameTitle, setRenameTitle] = React.useState(item.title);
	const {
		attributes,
		isDragging,
		listeners,
		setNodeRef: setDraggableRef,
		transform,
	} = useDraggable({ id: item.path });
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
						<Collapsible
							open={isOpen}
							onOpenChange={(nextOpen) => onToggleFolder(item.path, nextOpen)}
						>
							<div
								ref={setNodeRef}
								className="group/folder flex items-center gap-1 rounded-md data-[dragging=true]:opacity-60 data-[over=true]:bg-sidebar-accent"
								data-dragging={isDragging}
								data-over={isOver}
								style={{
									transform: CSS.Translate.toString(transform),
								}}
								{...attributes}
								{...listeners}
							>
								<CollapsibleTrigger className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left text-xs font-medium text-sidebar-foreground/80 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-0">
									<ChevronDownIcon
										data-open={isOpen}
										className="size-3.5 transition-transform data-[open=false]:-rotate-90"
									/>
									<FolderIcon className="size-3.5" />
									<span className="min-w-0 flex-1 truncate">{item.title}</span>
								</CollapsibleTrigger>
							<div className="flex shrink-0 opacity-0 transition-opacity group-hover/folder:opacity-100">
								<button
									type="button"
									className="flex size-6 items-center justify-center rounded-md text-sidebar-foreground/70 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-0"
									aria-label="Add note"
									onPointerDown={(event) => event.stopPropagation()}
									onClick={(event) => {
										event.stopPropagation();
										onCreateNote(item.path);
									}}
								>
									<StickyNotePlusIcon className="size-3.5" />
								</button>
								{!isInbox && (
									<button
										type="button"
										className="flex size-6 items-center justify-center rounded-md text-sidebar-foreground/70 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-0"
										aria-label="Add folder"
										onPointerDown={(event) => event.stopPropagation()}
										onClick={(event) => {
											event.stopPropagation();
											onCreateFolder(item.path);
										}}
									>
										<FolderPlusIcon className="size-3.5" />
									</button>
								)}
							</div>
							</div>
							{hasChildren ? (
								<CollapsibleContent>
									<div className="ml-3.5 border-l border-sidebar-border pl-2">
								<NoteTree
										activeNotePath={activeNotePath}
										expandedFolders={expandedFolders}
										items={item.children}
										level={level + 1}
										onCreateFolder={onCreateFolder}
										onCreateNote={onCreateNote}
										onDeleteItem={onDeleteItem}
										onMoveItem={onMoveItem}
										onOpenNote={onOpenNote}
										onRenameItem={onRenameItem}
										onToggleFolder={onToggleFolder}
										parentPath={item.path}
										isInbox={isInbox}
									/>
									</div>
								</CollapsibleContent>
							) : null}
						</Collapsible>
					</div>
				</ContextMenuTrigger>
						<ContextMenuContent className="w-48">
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
							setRenameTitle(item.title);
							setRenameOpen(true);
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
			<RenameItemDialog
				itemLabel="folder"
				open={renameOpen}
				title={renameTitle}
				onOpenChange={setRenameOpen}
				onTitleChange={setRenameTitle}
				onRename={() => {
					if (renameTitle.trim()) onRenameItem(item.path, renameTitle);
					setRenameOpen(false);
				}}
			/>
			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {item.title}?</AlertDialogTitle>
						<AlertDialogDescription>
							This deletes the folder and everything inside it.
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

function RenameItemDialog({
	itemLabel,
	onOpenChange,
	onRename,
	onTitleChange,
	open,
	title,
}: {
	itemLabel: "folder" | "note";
	onOpenChange: (open: boolean) => void;
	onRename: () => void;
	onTitleChange: (title: string) => void;
	open: boolean;
	title: string;
}) {
	const canRename = title.trim().length > 0;
	const inputRef = React.useRef<HTMLInputElement>(null);

	React.useEffect(() => {
		if (!open) return;

		window.requestAnimationFrame(() => inputRef.current?.focus());
	}, [open]);

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Rename {itemLabel}</AlertDialogTitle>
					<AlertDialogDescription>
						Pick a new name for this {itemLabel}.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<input
					ref={inputRef}
					value={title}
					className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring"
					onChange={(event) => onTitleChange(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && canRename) onRename();
					}}
				/>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction disabled={!canRename} onClick={onRename}>
						Rename
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function NoteCard({
	item,
	isActive,
	onDeleteItem,
	onOpenNote,
	parentPath,
}: {
	item: WorkspaceNote;
	isActive: boolean;
	onDeleteItem: (path: string) => void;
	onMoveItem: (itemPath: string, nextParentPath: string) => void;
	onOpenNote: (note: WorkspaceNote, mode: "preview" | "pinned") => void;
	parentPath: string;
}) {
	const [deleteOpen, setDeleteOpen] = React.useState(false);
	const [infoOpen, setInfoOpen] = React.useState(false);
	const {
		attributes,
		isDragging,
		listeners,
		setNodeRef: setDraggableRef,
		transform,
	} = useDraggable({ id: item.path });
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

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<button
						ref={setNodeRef}
						type="button"
						className="flex w-full touch-none flex-col items-start gap-1.5 rounded-md px-3 py-2.5 text-left text-sm leading-tight whitespace-nowrap outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-0 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[dragging=true]:opacity-60 data-[over=true]:bg-sidebar-accent"
						data-active={isActive}
						data-dragging={isDragging}
						data-over={isOver}
						style={{
							transform: CSS.Translate.toString(transform),
						}}
						{...attributes}
						{...listeners}
						onClick={() => onOpenNote(item, "preview")}
						onDoubleClick={() => onOpenNote(item, "pinned")}
					>
						<div className="flex w-full items-center gap-2">
							<span className="min-w-0 flex-1 truncate font-medium">
								{item.title.trim() || "Untitled"}
							</span>
						</div>
						{item.preview ? (
							<span className="line-clamp-2 w-full text-xs whitespace-break-spaces text-sidebar-foreground/65">
								{item.preview}
							</span>
						) : null}
					</button>
				</ContextMenuTrigger>
				<ContextMenuContent className="w-44">
					<ContextMenuItem onSelect={() => setInfoOpen(true)}>
						<InfoIcon />
						Note Info
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem
						variant="destructive"
						onSelect={() => setDeleteOpen(true)}
					>
						<Trash2Icon />
						Delete note
					</ContextMenuItem>
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
							This removes the note from your workspace.
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

function SpaceDropHeader({
	activeSpacePath,
	onCreateFolder,
	onCreateNote,
	onDeleteSpace,
	onEditSpace,
	onSelectSpace,
	spaceColor,
	spaceIcon,
	spaceColors,
	spaceIcons,
	spaces,
	spaceTitle,
	viewMode,
	onViewModeChange,
}: {
	activeSpacePath: string;
	onCreateFolder: (parentPath: string) => void;
	onCreateNote: (parentPath: string) => void;
	onDeleteSpace: (path: string) => void;
	onEditSpace: (
		path: string,
		title: string,
		color: string,
		icon: string,
	) => void;
	onSelectSpace: (path: string) => void;
	spaceColor?: string;
	spaceIcon?: string;
	spaceColors: Record<string, string>;
	spaceIcons: Record<string, string>;
	spaces: WorkspaceSpace[];
	spaceTitle: string;
	viewMode: "list" | "grid";
	onViewModeChange: (mode: "list" | "grid") => void;
}) {
	const { isOver, setNodeRef } = useDroppable({
		id: dropTargetId(activeSpacePath),
	});
	const isInbox = activeSpacePath === "Inbox";

	return (
		<div
			ref={setNodeRef}
			className="flex w-full items-center justify-between gap-3 rounded-md data-[over=true]:bg-sidebar-accent"
			data-over={isOver}
		>
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
										<LayoutGridIcon className="text-muted-foreground" />
										<span>Card</span>
									</DropdownMenuRadioItem>
								</DropdownMenuRadioGroup>
							</DropdownMenuSubContent>
						</DropdownMenuSub>
					) : (
						<>
							<DropdownMenuItem
								onSelect={() =>
									onEditSpace(activeSpacePath, spaceTitle, spaceColor ?? "", spaceIcon ?? "")
								}
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
			<div className="flex items-center gap-1">
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
			</div>
		</div>
	);
}

export function AppSidebar({
	activeNotePath,
	activeSpacePath,
	expandedFolders,
	onCreateFolder,
	onCreateNote,
	onCreateSpace,
	onDeleteItem,
	onDeleteSpace,
	onEditSpace,
	onMoveItem,
	onOpenNote,
	onRenameItem,
	onSelectSpace,
	onToggleFolder,
	spaceColors,
	spaceIcons,
	spaces,
	viewMode,
	onViewModeChange,
	...props
}: AppSidebarProps) {
	const navigate = useNavigate();
	const { open, setOpen } = useSidebar();
	const [user, setUser] = React.useState(fallbackUser);
	const [searchQuery, setSearchQuery] = React.useState("");
	const [notesSheetOpen, setNotesSheetOpen] = React.useState(false);
	const [tabletLayout, setTabletLayout] = React.useState(false);
	const activeSpace = spaces.find((space) => space.path === activeSpacePath);
	const visibleChildren = React.useMemo(
		() => filterWorkspaceItems(activeSpace?.children ?? [], searchQuery),
		[activeSpace?.children, searchQuery],
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
		await clerk.signOut();
		await navigate({ to: "/login" });
	};

	const moveDroppedItem = ({ active, over }: DragEndEvent) => {
		if (!over) return;

		const itemPath = String(active.id);
		const nextParentPath = parentPathFromDropTarget(String(over.id));
		if (!nextParentPath || itemPath === nextParentPath) return;
		if (parentPath(itemPath) === nextParentPath) return;

		onMoveItem(itemPath, nextParentPath);
	};

	return (
		<>
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
				<SidebarFooter>
					<NavUser onLogOut={logOut} user={user} />
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
			<aside
				data-open={notesSheetOpen}
				className="paperite-note-sidebar flex h-full min-h-0 w-80 max-w-80 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
			>
				<DndContext sensors={sensors} onDragEnd={moveDroppedItem}>
					<SidebarHeader className="gap-2 px-3 pt-3 pb-0">
					<SpaceDropHeader
						activeSpacePath={activeSpacePath}
						spaceTitle={activeSpace?.title ?? "Inbox"}
						spaceColor={spaceColors[activeSpacePath]}
						spaceIcon={spaceIcons[activeSpacePath]}
						onCreateFolder={onCreateFolder}
						onCreateNote={onCreateNote}
						onDeleteSpace={onDeleteSpace}
						onEditSpace={onEditSpace}
						onSelectSpace={onSelectSpace}
						spaceColors={spaceColors}
						spaceIcons={spaceIcons}
						spaces={spaces}
						viewMode={viewMode}
						onViewModeChange={onViewModeChange}
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
							{activeSpace && visibleChildren.length > 0 ? (
								viewMode === "grid" && activeSpacePath === "Inbox" ? (
								<NoteGrid
									items={visibleChildren}
									activeNotePath={activeNotePath}
									onDeleteItem={onDeleteItem}
									onOpenNote={onOpenNote}
								/>
								) : (
									<NoteTree
										activeNotePath={activeNotePath}
										expandedFolders={expandedFolders}
										items={visibleChildren}
										onCreateFolder={onCreateFolder}
										onCreateNote={onCreateNote}
										onDeleteItem={onDeleteItem}
										onMoveItem={onMoveItem}
										onOpenNote={onOpenNote}
										onRenameItem={onRenameItem}
										onToggleFolder={onToggleFolder}
										parentPath={activeSpacePath}
										isInbox={activeSpacePath === "Inbox"}
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
										{activeSpacePath !== "Inbox" && (
											<Button
												type="button"
												size="sm"
												variant="outline"
												onClick={() => onCreateFolder(activeSpacePath)}
											>
												<FolderPlusIcon />
												New folder
											</Button>
										)}
										<Button
											type="button"
											size="sm"
											onClick={() => onCreateNote(activeSpacePath)}
										>
											<StickyNotePlusIcon />
											New note
										</Button>
									</EmptyContent>
									</Empty>
								)}
							</SidebarGroupContent>
						</SidebarGroup>
					</SidebarContent>
				</DndContext>
			</aside>
		</>
	);
}

const dropTargetId = (path: string) => `drop:${path}`;

const listDropTargetId = (path: string) => `drop-list:${path}`;

const noteDropTargetId = (notePath: string, parentPath: string) =>
	`drop-note:${parentPath}:${notePath}`;

const parentPathFromDropTarget = (id: string) => {
	if (id.startsWith("drop:")) return id.slice("drop:".length);
	if (id.startsWith("drop-list:")) return id.slice("drop-list:".length);
	if (id.startsWith("drop-note:")) {
		const value = id.slice("drop-note:".length);
		const [, notePath] = value.split(/:(.+)/);
		return notePath ? parentPath(notePath) : null;
	}
	return null;
};

const parentPath = (itemPath: string) => {
	const separatorIndex = itemPath.lastIndexOf("/");
	return separatorIndex === -1 ? "" : itemPath.slice(0, separatorIndex);
};

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
};

const customIconPrefix = "custom:";

const getCustomIcon = (icon?: string) =>
	icon?.startsWith(customIconPrefix)
		? icon.slice(customIconPrefix.length)
		: null;
