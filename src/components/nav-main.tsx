import {
	BookOpenIcon,
	BrainIcon,
	BriefcaseBusinessIcon,
	CloudIcon,
	CodeIcon,
	FolderIcon,
	GemIcon,
	HeartIcon,
	LightbulbIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PlusIcon,
	SparklesIcon,
	Trash2Icon,
	UploadIcon,
	XIcon,
} from "lucide-react";
import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
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
} from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function NavMain({
	activeSpacePath,
	onCreateSpace,
	onDeleteSpace,
	onEditSpace,
	onSelectSpace,
	spaceColorsByPath,
	spaceIconsByPath,
	spaces,
}: {
	activeSpacePath: string;
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
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [spaceName, setSpaceName] = useState("");
	const [spaceColor, setSpaceColor] = useState(spaceColors[0]);
	const [spaceIcon, setSpaceIcon] = useState(spaceIcons[0].key);
	const [editSpacePath, setEditSpacePath] = useState<string | null>(null);
	const [editSpaceName, setEditSpaceName] = useState("");
	const [editSpaceColor, setEditSpaceColor] = useState(spaceColors[0]);
	const [editSpaceIcon, setEditSpaceIcon] = useState(spaceIcons[0].key);
	const [deleteSpacePath, setDeleteSpacePath] = useState<string | null>(null);
	const editOpenedAt = useRef(0);
	const createIconInputRef = useRef<HTMLInputElement>(null);
	const editIconInputRef = useRef<HTMLInputElement>(null);
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

	const openEdit = (space: { title: string; path: string }) => {
		window.setTimeout(() => {
			editOpenedAt.current = Date.now();
			setEditSpacePath(space.path);
			setEditSpaceName(space.title);
			setEditSpaceColor(spaceColorsByPath[space.path] ?? spaceColors[0]);
			setEditSpaceIcon(spaceIconsByPath[space.path] ?? spaceIcons[0].key);
		}, 0);
	};

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
				<SidebarGroup>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton
								tooltip={inbox.title}
								isActive={activeSpacePath === inbox.path}
								onClick={() => onSelectSpace(inbox.path)}
							>
								{inbox.icon}
								<span>{inbox.title}</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroup>
			) : null}
			<div className="h-px bg-border mx-[10px]"></div>
			<SidebarGroup>
				<SidebarMenu className="gap-1">
					{otherSpaces.map((space) => (
						<SidebarMenuItem key={space.title}>
							<ContextMenu>
								<ContextMenuTrigger asChild>
									<SidebarMenuButton
										tooltip={space.title}
										isActive={activeSpacePath === space.path}
										onClick={() => onSelectSpace(space.path)}
									>
										{space.icon}
										<span>{space.title}</span>
									</SidebarMenuButton>
								</ContextMenuTrigger>
								<ContextMenuContent className="w-44">
									<ContextMenuItem onSelect={() => openEdit(space)}>
										<PencilIcon className="text-muted-foreground" />
										<span>Rename Space</span>
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
							<Popover
								open={editSpacePath === space.path}
								onOpenChange={(open) => {
									if (open) return;
									if (Date.now() - editOpenedAt.current < 250) return;
									setEditSpacePath(null);
								}}
							>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<PopoverAnchor asChild>
											<SidebarMenuAction showOnHover>
												<MoreHorizontalIcon />
												<span className="sr-only">More</span>
											</SidebarMenuAction>
										</PopoverAnchor>
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
								<PopoverContent
									side="right"
									align="start"
									className="w-56"
									onEscapeKeyDown={() => setEditSpacePath(null)}
									onInteractOutside={(event) => {
										if (Date.now() - editOpenedAt.current < 250) {
											event.preventDefault();
										}
									}}
								>
									<Input
										autoFocus
										value={editSpaceName}
										placeholder="Space name..."
										onChange={(event) => setEditSpaceName(event.target.value)}
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
									<div className="space-y-2">
										<div className="text-xs text-muted-foreground">Color</div>
										<div className="flex flex-wrap gap-2">
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
									<div className="flex items-center gap-2">
										<Button
											type="button"
											size="sm"
											disabled={!editSpaceName.trim()}
											onClick={editSpace}
										>
											Save
										</Button>
										<Button
											type="button"
											size="sm"
											variant="ghost"
											onClick={() => setEditSpacePath(null)}
										>
											Cancel
										</Button>
									</div>
								</PopoverContent>
							</Popover>
						</SidebarMenuItem>
					))}
					<SidebarMenuItem>
						<Popover open={isCreateOpen} onOpenChange={setIsCreateOpen}>
							<PopoverTrigger asChild>
								<SidebarMenuButton
									tooltip="Add Space"
									className="text-sidebar-foreground/70"
								>
									<PlusIcon className="text-sidebar-foreground/70" />
									<span>Add Space</span>
								</SidebarMenuButton>
							</PopoverTrigger>
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
								<div className="space-y-2">
									<div className="text-xs text-muted-foreground">Color</div>
									<div className="flex flex-wrap gap-2">
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
								<div className="flex items-center gap-2">
									<Button
										type="button"
										size="sm"
										disabled={!canCreate}
										onClick={createSpace}
									>
										Create
									</Button>
									<Button
										type="button"
										size="sm"
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
	"#94a3b8",
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
];

const customIconPrefix = "custom:";

const getCustomIcon = (icon: string) =>
	icon.startsWith(customIconPrefix)
		? icon.slice(customIconPrefix.length)
		: null;
