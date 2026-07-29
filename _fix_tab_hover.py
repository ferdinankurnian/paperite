from pathlib import Path

p = Path("paperite/src/routes/_main/index.tsx")
t = p.read_text()

# 1) lucide icons
old = '''import {
	BookOpenIcon,
	CheckIcon,
	ExternalLinkIcon,
	InfoIcon,
	MoreVerticalIcon,
	PencilIcon,
	PinIcon,
	SearchIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";'''

new = '''import {
	BookOpenIcon,
	CheckIcon,
	CloudIcon,
	ExternalLinkIcon,
	FolderIcon,
	InboxIcon,
	InfoIcon,
	MoreVerticalIcon,
	PencilIcon,
	PinIcon,
	SearchIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";'''

assert old in t, "lucide import not found"
t = t.replace(old, new, 1)
print("1 lucide")

# 2) HoverCard import after Input
old = 'import { Input } from "@/components/ui/input";'
new = '''import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";'''
assert old in t, "input import not found"
t = t.replace(old, new, 1)
print("2 hover-card import")

# 3) Extend SortableTabProps
old = '''type SortableTabProps = {
	note: OpenNoteTab;
	isActive: boolean;
	displayTitle: (title: string) => string;
	onSelect: () => void;
	onDoubleClick: () => void;
	onClose: () => void;
	onTogglePin: () => void;
};'''

new = '''type SortableTabProps = {
	note: OpenNoteTab;
	isActive: boolean;
	displayTitle: (title: string) => string;
	spacePath: string;
	spaceTitle: string;
	spaceIcon?: string;
	spaceColor?: string;
	onSelect: () => void;
	onDoubleClick: () => void;
	onClose: () => void;
	onTogglePin: () => void;
};'''

assert old in t, "props type not found"
t = t.replace(old, new, 1)
print("3 props")

# 4) Replace SortableTab function body (whole function)
old = '''function SortableTab({
	note,
	isActive,
	displayTitle,
	onSelect,
	onDoubleClick,
	onClose,
	onTogglePin,
}: SortableTabProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging: isSortableDragging,
	} = useSortable({ id: note.path });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isSortableDragging ? "1" : undefined,
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					ref={setNodeRef}
					style={style}
					data-active={isActive}
					data-preview={note.preview}
					data-pinned={note.pinned}
					data-dragging={isSortableDragging}
					className="group relative z-10 my-2 w-28 shrink-0 rounded-md text-[13px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground data-[preview=true]:italic data-[preview=true]:opacity-70 data-[dragging=true]:bg-muted data-[dragging=true]:opacity-100 sm:w-36 lg:w-44 cursor-grab active:cursor-grabbing !opacity-100"
					{...attributes}
					{...listeners}
				>
					<button
						type="button"
						className="flex h-full w-full items-center rounded-md pr-7 pl-2.5 text-left outline-none"
						onClick={onSelect}
						onDoubleClick={onDoubleClick}
						onMouseDown={(event) => {
							if (event.button === 1) {
								event.preventDefault();
								if (!note.pinned) onClose();
							}
						}}
					>
						<span className="min-w-0 flex-1 truncate">
							{displayTitle(note.title)}
						</span>
					</button>
					<button
						type="button"
						aria-label={
							note.pinned
								? `Unpin ${displayTitle(note.title)}`
								: `Close ${displayTitle(note.title)}`
						}
						className={
							note.pinned
								? "-translate-y-1/2 absolute top-1/2 right-2 flex size-4 shrink-0 items-center justify-center opacity-65 hover:opacity-100"
								: "-translate-y-1/2 absolute top-1/2 right-2 flex size-4 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover:opacity-65 group-data-[active=true]:opacity-65 hover:opacity-100"
						}
						onClick={(event) => {
							event.stopPropagation();
							if (note.pinned) onTogglePin();
							else onClose();
						}}
					>
						{note.pinned ? (
							<PinIcon className="size-3.5" />
						) : (
							<XIcon className="size-3.5" />
						)}
					</button>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onSelect={onTogglePin}>
					{note.pinned ? "Unpin Tab" : "Pin Tab"}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}'''

new = '''function SortableTab({
	note,
	isActive,
	displayTitle,
	spacePath,
	spaceTitle,
	spaceIcon,
	spaceColor,
	onSelect,
	onDoubleClick,
	onClose,
	onTogglePin,
}: SortableTabProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging: isSortableDragging,
	} = useSortable({ id: note.path });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isSortableDragging ? "1" : undefined,
	};

	const title = displayTitle(note.title);
	const customIcon =
		spaceIcon?.startsWith("custom:") ? spaceIcon.slice("custom:".length) : null;

	return (
		<HoverCard openDelay={350} closeDelay={100}>
			<ContextMenu>
				<HoverCardTrigger asChild>
					<ContextMenuTrigger asChild>
						<div
							ref={setNodeRef}
							style={style}
							data-active={isActive}
							data-preview={note.preview}
							data-pinned={note.pinned}
							data-dragging={isSortableDragging}
							className="group relative z-10 my-2 w-28 shrink-0 cursor-grab rounded-md text-[13px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground data-[preview=true]:italic data-[preview=true]:opacity-70 data-[dragging=true]:bg-muted data-[dragging=true]:opacity-100 active:cursor-grabbing sm:w-36 lg:w-44 !opacity-100"
							{...attributes}
							{...listeners}
						>
							<button
								type="button"
								className="flex h-full w-full items-center rounded-md pr-7 pl-2.5 text-left outline-none"
								onClick={onSelect}
								onDoubleClick={onDoubleClick}
								onMouseDown={(event) => {
									if (event.button === 1) {
										event.preventDefault();
										if (!note.pinned) onClose();
									}
								}}
							>
								<span className="min-w-0 flex-1 truncate">{title}</span>
							</button>
							<button
								type="button"
								aria-label={
									note.pinned ? `Unpin ${title}` : `Close ${title}`
								}
								className={
									note.pinned
										? "-translate-y-1/2 absolute top-1/2 right-2 flex size-4 shrink-0 items-center justify-center opacity-65 hover:opacity-100"
										: "-translate-y-1/2 absolute top-1/2 right-2 flex size-4 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover:opacity-65 group-data-[active=true]:opacity-65 hover:opacity-100"
								}
								onClick={(event) => {
									event.stopPropagation();
									if (note.pinned) onTogglePin();
									else onClose();
								}}
							>
								{note.pinned ? (
									<PinIcon className="size-3.5" />
								) : (
									<XIcon className="size-3.5" />
								)}
							</button>
						</div>
					</ContextMenuTrigger>
				</HoverCardTrigger>
				<ContextMenuContent>
					<ContextMenuItem onSelect={onTogglePin}>
						{note.pinned ? "Unpin Tab" : "Pin Tab"}
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<HoverCardContent
				side="bottom"
				align="start"
				sideOffset={6}
				className="w-64 gap-0 overflow-hidden p-0"
			>
				<div className="px-3 py-2.5">
					<p className="font-medium text-sm leading-snug text-popover-foreground">
						{title}
					</p>
				</div>
				<div className="flex items-center gap-2 border-border/60 border-t bg-muted/40 px-3 py-2 text-muted-foreground text-xs">
					{spacePath === "Inbox" ? (
						<InboxIcon className="size-3.5 shrink-0" />
					) : customIcon ? (
						<img
							src={customIcon}
							alt=""
							className="size-3.5 shrink-0 rounded-sm object-cover"
						/>
					) : spaceIcon === "folder" ? (
						<FolderIcon
							className="size-3.5 shrink-0"
							style={spaceColor ? { color: spaceColor } : undefined}
						/>
					) : (
						<CloudIcon
							className="size-3.5 shrink-0"
							style={spaceColor ? { color: spaceColor } : undefined}
						/>
					)}
					<span className="min-w-0 truncate">{spaceTitle}</span>
				</div>
			</HoverCardContent>
		</HoverCard>
	);
}'''

assert old in t, "SortableTab function not found"
t = t.replace(old, new, 1)
print("4 SortableTab")

# 5) Pass space props at call site
old = '''									{appState.openTabs.map((note) => (
										<SortableTab
											key={note.path}
											note={note}
											isActive={note.path === appState.activeNotePath}
											displayTitle={displayNoteTitle}
											onSelect={() => selectTab(note.path)}
											onDoubleClick={() => fixTab(note.path)}
											onClose={() => closeTab(note.path)}
											onTogglePin={() => togglePinTab(note.path)}
										/>
									))}'''

new = '''									{appState.openTabs.map((note) => {
										const spacePath = topLevelPath(note.path);
										const space =
											visibleSpaces.find((entry) => entry.path === spacePath) ??
											null;
										return (
											<SortableTab
												key={note.path}
												note={note}
												isActive={note.path === appState.activeNotePath}
												displayTitle={displayNoteTitle}
												spacePath={spacePath}
												spaceTitle={
													spacePath === "Inbox"
														? "Inbox"
														: (space?.title ?? spacePath)
												}
												spaceIcon={appState.spaceIcons[spacePath]}
												spaceColor={appState.spaceColors[spacePath]}
												onSelect={() => selectTab(note.path)}
												onDoubleClick={() => fixTab(note.path)}
												onClose={() => closeTab(note.path)}
												onTogglePin={() => togglePinTab(note.path)}
											/>
										);
									})}'''

assert old in t, "call site not found"
t = t.replace(old, new, 1)
print("5 call site")

p.write_text(t)
print("OK")
