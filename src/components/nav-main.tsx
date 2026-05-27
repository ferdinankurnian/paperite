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
import { type ChangeEvent, useRef, useState } from "react";
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
		event: ChangeEvent<HTMLInputElement>,
		onSelect: (icon: string) => void,
	) => {
		const file = event.target.files?.[0];
		event.target.value = "";
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
							<SidebarMenuButton
								tooltip={space.title}
								isActive={activeSpacePath === space.path}
								onClick={() => onSelectSpace(space.path)}
							>
								{space.icon}
								<span>{space.title}</span>
							</SidebarMenuButton>
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
										onUpload={(event) => uploadIcon(event, setEditSpaceIcon)}
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
								<SidebarMenuButton className="text-sidebar-foreground/70">
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
									onUpload={(event) => uploadIcon(event, setSpaceIcon)}
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
	onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
	value: string;
}) {
	const customIcon = getCustomIcon(value);

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between gap-2">
				<div className="text-xs text-muted-foreground">Icon</div>
				{customIcon ? (
					<button
						type="button"
						className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
						aria-label="Remove custom icon"
						onClick={() => onSelect(spaceIcons[0].key)}
					>
						<XIcon className="size-3.5" />
					</button>
				) : null}
			</div>
			<div className="grid grid-cols-6 gap-1.5">
				{spaceIcons.map((icon) => {
					const Icon = icon.icon;

					return (
						<button
							type="button"
							key={icon.key}
							aria-label={`Use ${icon.key}`}
							data-active={value === icon.key}
							className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground"
							onClick={() => onSelect(icon.key)}
						>
							<Icon className="size-4" />
						</button>
					);
				})}
				<button
					type="button"
					aria-label="Upload custom icon"
					data-active={Boolean(customIcon)}
					className="flex size-7 items-center justify-center overflow-hidden rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground"
					onClick={onChooseUpload}
				>
					{customIcon ? (
						<img
							src={customIcon}
							alt=""
							className="size-5 rounded-sm object-cover"
						/>
					) : (
						<UploadIcon className="size-4" />
					)}
				</button>
				<input
					ref={inputRef}
					type="file"
					accept="image/*"
					className="hidden"
					onChange={onUpload}
				/>
			</div>
		</div>
	);
}

const spaceColors = [
	"#ef4444",
	"#f97316",
	"#f59e0b",
	"#22c55e",
	"#14b8a6",
	"#3b82f6",
	"#8b5cf6",
	"#ec4899",
	"#f43f5e",
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
