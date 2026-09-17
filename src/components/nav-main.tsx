import { useDroppable } from "@dnd-kit/core";
import {
	SortableContext,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	BookmarkIcon,
	BookOpenIcon,
	BrainIcon,
	BriefcaseBusinessIcon,
	CameraIcon,
	CloudIcon,
	CodeIcon,
	CompassIcon,
	FolderIcon,
	GemIcon,
	HeartIcon,
	LightbulbIcon,
	MoreHorizontalIcon,
	MusicIcon,
	PencilIcon,
	PinIcon,
	PlusIcon,
	SparklesIcon,
	StarIcon,
	Trash2Icon,
	UploadIcon,
	UsersIcon,
	XIcon,
	ZapIcon,
} from "lucide-react";
import {
	type ChangeEvent,
	type DragEvent,
	memo,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
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
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	SidebarGroup,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/components/ui/hover-card";
import { useAppStore } from "@/lib/stores/app-store";

export function NavMain({
	onCreateSpace,
	onDeleteSpace,
	onEditSpace,
	onSelectSpace,
	spaceColorsByPath,
	spaceIconsByPath,
	spaces,
}: {
	onCreateSpace: (title: string, color: string, icon: string) => void;
	onDeleteSpace: (path: string) => void;
	onEditSpace: (
		path: string,
		title: string,
		color: string,
		icon: string,
	) => void;
	onSelectSpace: (path: string) => void;
	spaceColorsByPath: Record<string, string>;
	spaceIconsByPath: Record<string, string>;
	spaces: {
		title: string;
		url: string;
		path: string;
		icon?: React.ReactNode;
	}[];
}) {
	// Subscribe here so space switch does not re-render AppSidebar / note trees.
	const activeSpacePath = useAppStore((s) => s.activeSpacePath);
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const { state: sidebarState, isMobile: sidebarIsMobile } = useSidebar();
	const [spaceName, setSpaceName] = useState("");
	const [spaceColor, setSpaceColor] = useState(spaceColors[0]);
	const [spaceIcon, setSpaceIcon] = useState(spaceIcons[0].key);
	const [editSpacePath, setEditSpacePath] = useState<string | null>(null);
	const [editSpaceName, setEditSpaceName] = useState("");
	const [editSpaceColor, setEditSpaceColor] = useState(spaceColors[0]);
	const [editSpaceIcon, setEditSpaceIcon] = useState(spaceIcons[0].key);
	const [deleteSpacePath, setDeleteSpacePath] = useState<string | null>(null);
	const createIconInputRef = useRef<HTMLInputElement>(null);
	const editIconInputRef = useRef<HTMLInputElement>(null);
	const createIconIsCustom = getCustomIcon(spaceIcon) !== null;
	const editIconIsCustom = getCustomIcon(editSpaceIcon) !== null;
	const inbox = spaces.find((space) => space.path === "Inbox");
	const otherSpaces = spaces.filter((space) => space.path !== "Inbox");
	const canCreate = spaceName.trim().length > 0;
	const deleteSpace = spaces.find((space) => space.path === deleteSpacePath);

	const createSpace = () => {
		if (!canCreate) return;

		onCreateSpace(spaceName, spaceColor, spaceIcon);
		setSpaceName("");
		setSpaceColor(spaceColors[0]);
		setSpaceIcon(spaceIcons[0].key);
		setIsCreateOpen(false);
	};

	const openEdit = useCallback(
		(space: { title: string; path: string }) => {
			setEditSpacePath(space.path);
			setEditSpaceName(space.title);
			setEditSpaceColor(spaceColorsByPath[space.path] ?? spaceColors[0]);
			setEditSpaceIcon(spaceIconsByPath[space.path] ?? spaceIcons[0].key);
		},
		[spaceColorsByPath, spaceIconsByPath],
	);

	useEffect(() => {
		const handler = (event: Event) => {
			const path = (event as CustomEvent).detail as string;
			const space = spaces.find((s) => s.path === path);
			if (space) openEdit(space);
		};
		window.addEventListener("paperite:open-edit-space", handler);
		return () =>
			window.removeEventListener("paperite:open-edit-space", handler);
	}, [spaces, openEdit]);

	const editSpace = () => {
		if (!editSpacePath || !editSpaceName.trim()) return;

		onEditSpace(editSpacePath, editSpaceName, editSpaceColor, editSpaceIcon);
		setEditSpacePath(null);
		setEditSpaceName("");
	};

	const uploadIcon = (
		file: File | undefined,
		onSelect: (icon: string) => void,
	) => {
		if (!file?.type.startsWith("image/")) return;
		const reader = new FileReader();
		reader.addEventListener("load", () => {
			if (typeof reader.result === "string") {
				onSelect(`${customIconPrefix}${reader.result}`);
			}
		});
		reader.readAsDataURL(file);
	};

	return (
		<>
			{inbox ? (
				<SpaceDropMenuItem
					space={inbox}
					isActive={activeSpacePath === inbox.path}
					onSelect={() => onSelectSpace(inbox.path)}
				/>
			) : null}
			<div className="h-px bg-border mx-[10px]"></div>
			<SortableContext
				items={otherSpaces.map((space) => space.path)}
				strategy={verticalListSortingStrategy}
			>
				<SidebarGroup>
					<SidebarMenu className="gap-1">
						{otherSpaces.map((space) => (
							<SortableSpaceItem key={space.path} id={space.path}>
								<SidebarMenuItem>
									<ContextMenu>
										<HoverCard openDelay={200} closeDelay={0}>
											<ContextMenuTrigger asChild>
												<HoverCardTrigger asChild>
													<SidebarMenuButton
														isActive={activeSpacePath === space.path}
														onClick={() => onSelectSpace(space.path)}
													>
														{space.icon}
														<span>{space.title}</span>
													</SidebarMenuButton>
												</HoverCardTrigger>
											</ContextMenuTrigger>
											<HoverCardContent
												side="right"
												align="center"
												hidden={
													sidebarState !== "collapsed" || sidebarIsMobile
												}
												className="w-auto px-2.5 py-1.5 text-xs"
											>
												{space.title}
											</HoverCardContent>
										</HoverCard>
										<ContextMenuContent className="w-44">
											<ContextMenuItem onSelect={() => openEdit(space)}>
												<PencilIcon className="text-muted-foreground" />
												<span>Edit Space</span>
											</ContextMenuItem>
											<ContextMenuSeparator />
											<ContextMenuItem
												variant="destructive"
												onSelect={() => setDeleteSpacePath(space.path)}
											>
												<Trash2Icon />
												<span>Delete Space</span>
											</ContextMenuItem>
										</ContextMenuContent>
									</ContextMenu>
									<Popover open={editSpacePath === space.path}>
										<PopoverAnchor asChild>
											<div className="absolute inset-0 pointer-events-none" />
										</PopoverAnchor>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<SidebarMenuAction showOnHover>
													<MoreHorizontalIcon />
													<span className="sr-only">More</span>
												</SidebarMenuAction>
											</DropdownMenuTrigger>
											<DropdownMenuContent
												className="w-44 rounded-lg"
												side="right"
												align="start"
											>
												<DropdownMenuItem
													onSelect={() => {
														openEdit(space);
													}}
												>
													<PencilIcon className="text-muted-foreground" />
													<span>Edit Space</span>
												</DropdownMenuItem>
												<DropdownMenuSeparator />
												<DropdownMenuItem
													variant="destructive"
													onSelect={() => setDeleteSpacePath(space.path)}
												>
													<Trash2Icon />
													<span>Delete Space</span>
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
										<PopoverContent side="right" align="start" className="w-56">
											<Input
												autoFocus
												value={editSpaceName}
												placeholder="Space name..."
												onChange={(event) =>
													setEditSpaceName(event.target.value)
												}
												onKeyDown={(event) => {
													if (event.key === "Enter") editSpace();
													if (event.key === "Escape") setEditSpacePath(null);
												}}
											/>
											<SpaceIconPicker
												inputRef={editIconInputRef}
												value={editSpaceIcon}
												onUpload={(file) => uploadIcon(file, setEditSpaceIcon)}
												onChooseUpload={() => editIconInputRef.current?.click()}
												onSelect={setEditSpaceIcon}
											/>
											{!editIconIsCustom ? (
												<div className="space-y-2">
													<div className="text-xs text-muted-foreground">
														Color
													</div>
													<div className="grid grid-cols-7 gap-2">
														{spaceColors.map((color) => (
															<button
																type="button"
																key={color}
																aria-label={`Use ${color}`}
																data-active={editSpaceColor === color}
																className="size-5 rounded-full ring-offset-2 ring-offset-popover data-[active=true]:ring-2 data-[active=true]:ring-ring"
																style={{ backgroundColor: color }}
																onClick={() => setEditSpaceColor(color)}
															/>
														))}
													</div>
												</div>
											) : null}
											<div className="grid grid-cols-2 gap-2">
												<Button
													type="button"
													size="sm"
													className="w-full"
													disabled={!editSpaceName.trim()}
													onClick={editSpace}
												>
													Save
												</Button>
												<Button
													type="button"
													size="sm"
													className="w-full"
													variant="ghost"
													onClick={() => setEditSpacePath(null)}
												>
													Cancel
												</Button>
											</div>
										</PopoverContent>
									</Popover>
								</SidebarMenuItem>
							</SortableSpaceItem>
						))}
						<SidebarMenuItem>
							<Popover open={isCreateOpen} onOpenChange={setIsCreateOpen}>
								<HoverCard openDelay={200} closeDelay={0}>
									<PopoverTrigger asChild>
										<HoverCardTrigger asChild>
											<SidebarMenuButton className="text-sidebar-foreground/70">
												<PlusIcon className="text-sidebar-foreground/70" />
												<span>Add Space</span>
											</SidebarMenuButton>
										</HoverCardTrigger>
									</PopoverTrigger>
									<HoverCardContent
										side="right"
										align="center"
										hidden={sidebarState !== "collapsed" || sidebarIsMobile}
										className="w-auto px-2.5 py-1.5 text-xs"
									>
										Add Space
									</HoverCardContent>
								</HoverCard>
								<PopoverContent side="right" align="start" className="w-56">
									<Input
										autoFocus
										value={spaceName}
										placeholder="Space name..."
										onChange={(event) => setSpaceName(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Enter") createSpace();
										}}
									/>
									<SpaceIconPicker
										inputRef={createIconInputRef}
										value={spaceIcon}
										onUpload={(file) => uploadIcon(file, setSpaceIcon)}
										onChooseUpload={() => createIconInputRef.current?.click()}
										onSelect={setSpaceIcon}
									/>
									{!createIconIsCustom ? (
										<div className="space-y-2">
											<div className="text-xs text-muted-foreground">Color</div>
											<div className="grid grid-cols-7 gap-2">
												{spaceColors.map((color) => (
													<button
														type="button"
														key={color}
														aria-label={`Use ${color}`}
														data-active={spaceColor === color}
														className="size-5 rounded-full ring-offset-2 ring-offset-popover data-[active=true]:ring-2 data-[active=true]:ring-ring"
														style={{ backgroundColor: color }}
														onClick={() => setSpaceColor(color)}
													/>
												))}
											</div>
										</div>
									) : null}
									<div className="grid grid-cols-2 gap-2">
										<Button
											type="button"
											size="sm"
											className="w-full"
											disabled={!canCreate}
											onClick={createSpace}
										>
											Create
										</Button>
										<Button
											type="button"
											size="sm"
											className="w-full"
											variant="ghost"
											onClick={() => setIsCreateOpen(false)}
										>
											Cancel
										</Button>
									</div>
								</PopoverContent>
							</Popover>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroup>
			</SortableContext>
			<AlertDialog
				open={deleteSpacePath !== null}
				onOpenChange={(open) => {
					if (!open) setDeleteSpacePath(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Delete {deleteSpace?.title ?? "space"}?
						</AlertDialogTitle>
						<AlertDialogDescription>
							This deletes the space and every note or folder inside it.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => {
								if (deleteSpacePath) onDeleteSpace(deleteSpacePath);
								setDeleteSpacePath(null);
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

function SpaceIconPicker({
	inputRef,
	onChooseUpload,
	onSelect,
	onUpload,
	value,
}: {
	inputRef: React.RefObject<HTMLInputElement | null>;
	onChooseUpload: () => void;
	onSelect: (icon: string) => void;
	onUpload: (file: File | undefined) => void;
	value: string;
}) {
	const customIcon = getCustomIcon(value);
	const chooseDroppedFile = (event: DragEvent<HTMLButtonElement>) => {
		event.preventDefault();
		onUpload(event.dataTransfer.files[0]);
	};

	return (
		<div className="space-y-2">
			<Tabs defaultValue={customIcon ? "upload" : "icons"} className="gap-2">
				<TabsList className="grid h-8 w-full grid-cols-2">
					<TabsTrigger value="icons">Icons</TabsTrigger>
					<TabsTrigger value="upload">Upload</TabsTrigger>
				</TabsList>
				<TabsContent value="icons">
					<div className="grid grid-cols-6 gap-1.5">
						{spaceIcons.map((icon) => {
							const Icon = icon.icon;

							return (
								<button
									type="button"
									key={icon.key}
									aria-label={`Use ${icon.key}`}
									data-active={value === icon.key}
									className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,scale] active:scale-[0.96] hover:bg-muted hover:text-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground"
									onClick={() => onSelect(icon.key)}
								>
									<Icon className="size-4" />
								</button>
							);
						})}
					</div>
				</TabsContent>
				<TabsContent value="upload">
					<div className="space-y-2">
						<button
							type="button"
							className="flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 text-center text-xs text-muted-foreground transition-[background-color,border-color,scale] active:scale-[0.96] hover:border-ring hover:bg-muted/60 hover:text-foreground"
							onClick={onChooseUpload}
							onDragOver={(event) => event.preventDefault()}
							onDrop={chooseDroppedFile}
						>
							{customIcon ? (
								<img
									src={customIcon}
									alt=""
									className="size-12 rounded-md object-cover shadow-[0_0_0_1px_rgb(255_255_255/0.12)]"
								/>
							) : (
								<UploadIcon className="size-5" />
							)}
							<span>Drop image or click to upload</span>
						</button>
						{customIcon ? (
							<button
								type="button"
								className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								onClick={() => onSelect(spaceIcons[0].key)}
							>
								<XIcon className="size-3.5" />
								Remove image
							</button>
						) : null}
					</div>
				</TabsContent>
			</Tabs>
			<input
				ref={inputRef}
				type="file"
				accept="image/*"
				className="hidden"
				onChange={(event: ChangeEvent<HTMLInputElement>) => {
					onUpload(event.target.files?.[0]);
					event.target.value = "";
				}}
			/>
		</div>
	);
}

/**
 * Space rail items share the sidebar DndContext so notes can be dropped onto
 * spaces. useSortable/useDroppable will re-render this wrapper on any drag in
 * that context — keep the wrapper cheap and pass memoized children so ContextMenu
 * / HoverCard trees don't re-render when only transform/isOver change.
 */
const SortableSpaceItem = memo(function SortableSpaceItem({
	children,
	id,
}: {
	children: React.ReactNode;
	id: string;
}) {
	const {
		attributes,
		listeners,
		setNodeRef: setSortableRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id });
	const { isOver, setNodeRef: setDroppableRef } = useDroppable({
		id: spaceDropTargetId(id),
		data: { type: "space", path: id },
	});
	const setNodeRef = useCallback(
		(node: HTMLDivElement | null) => {
			setSortableRef(node);
			setDroppableRef(node);
		},
		[setSortableRef, setDroppableRef],
	);

	return (
		<div
			ref={setNodeRef}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
			}}
			className="touch-none rounded-md data-[dragging=true]:opacity-70 data-[over=true]:bg-sidebar-accent/70 data-[space-over=true]:bg-sidebar-accent/70"
			data-dragging={isDragging}
			data-over={isOver}
			data-paperite-space-path={id}
			{...attributes}
			{...listeners}
		>
			{children}
		</div>
	);
});

function SpaceDropMenuItem({
	isActive,
	onSelect,
	space,
}: {
	isActive: boolean;
	onSelect: () => void;
	space: {
		title: string;
		path: string;
		icon?: React.ReactNode;
	};
}) {
	const { isOver, setNodeRef } = useDroppable({
		id: spaceDropTargetId(space.path),
		data: { type: "space", path: space.path },
	});
	const { state: sidebarState, isMobile } = useSidebar();

	return (
		<SidebarGroup>
			<SidebarMenu>
				<SidebarMenuItem
					ref={setNodeRef}
					data-over={isOver}
					data-paperite-space-path={space.path}
				>
					<HoverCard openDelay={200} closeDelay={0}>
						<HoverCardTrigger asChild>
							<SidebarMenuButton
								isActive={isActive}
								className="data-[over=true]:bg-sidebar-accent data-[over=true]:text-sidebar-accent-foreground"
								onClick={onSelect}
							>
								{space.icon}
								<span>{space.title}</span>
							</SidebarMenuButton>
						</HoverCardTrigger>
						<HoverCardContent
							side="right"
							align="center"
							hidden={sidebarState !== "collapsed" || isMobile}
							className="w-auto px-2.5 py-1.5 text-xs"
						>
							{space.title}
						</HoverCardContent>
					</HoverCard>
				</SidebarMenuItem>
			</SidebarMenu>
		</SidebarGroup>
	);
}

const spaceDropTargetId = (path: string) => `drop:${path}`;

const spaceColors = [
	"#f04438",
	"#fb6f24",
	"#f5b700",
	"#35c759",
	"#19b8a9",
	"#2f80ed",
	"#7c5cff",
	"#d946ef",
	"#ff4f86",
	"#e11d48",
	"#94a3b8",
	"#64748b",
	"#1e293b",
	"#f8fafc",
];

const spaceIcons = [
	{ key: "cloud", icon: CloudIcon },
	{ key: "folder", icon: FolderIcon },
	{ key: "briefcase", icon: BriefcaseBusinessIcon },
	{ key: "book", icon: BookOpenIcon },
	{ key: "idea", icon: LightbulbIcon },
	{ key: "code", icon: CodeIcon },
	{ key: "gem", icon: GemIcon },
	{ key: "heart", icon: HeartIcon },
	{ key: "brain", icon: BrainIcon },
	{ key: "sparkles", icon: SparklesIcon },
	{ key: "star", icon: StarIcon },
	{ key: "music", icon: MusicIcon },
	{ key: "camera", icon: CameraIcon },
	{ key: "bookmark", icon: BookmarkIcon },
	{ key: "zap", icon: ZapIcon },
	{ key: "compass", icon: CompassIcon },
	{ key: "users", icon: UsersIcon },
	{ key: "pin", icon: PinIcon },
];

const customIconPrefix = "custom:";

const getCustomIcon = (icon: string) =>
	icon.startsWith(customIconPrefix)
		? icon.slice(customIconPrefix.length)
		: null;
