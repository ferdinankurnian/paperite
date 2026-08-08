import {
	closestCenter,
	defaultDropAnimationSideEffects,
	DndContext,
	type DragEndEvent,
	type DragStartEvent,
	DragOverlay,
	type DropAnimation,
	type Modifier,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	horizontalListSortingStrategy,
	SortableContext,
	useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	CloudIcon,
	FolderIcon,
	InboxIcon,
	PinIcon,
	XIcon,
} from "lucide-react";
import {
	type CSSProperties,
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useAppStore } from "@/lib/stores/app-store";
import { useEditorUiStore } from "@/lib/stores/editor-ui-store";

function displayNoteTitle(title: string) {
	return title.trim() || "Untitled";
}

function topLevelPath(notePath: string) {
	return notePath.split("/")[0] || "Inbox";
}

type SortableTabProps = {
	note: OpenNoteTab;
	isActive: boolean;
	displayTitle: (title: string) => string;
	spacePath: string;
	spaceTitle: string;
	spaceIcon?: string;
	spaceColor?: string;
	openDelay: number;
	isTabDragging: boolean;
	onHoverOpen: () => void;
	onSelect: (path: string) => void;
	onDoubleClick: (path: string) => void;
	onClose: (path: string) => void;
	onTogglePin: (path: string) => void;
};

const SortableTab = memo(function SortableTab({
	note,
	isActive,
	displayTitle,
	spacePath,
	spaceTitle,
	spaceIcon,
	spaceColor,
	openDelay,
	isTabDragging,
	onHoverOpen,
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
	} = useSortable({
		id: note.path,
		transition: {
			duration: 180,
			easing: "cubic-bezier(0.25, 1, 0.5, 1)",
		},
	});

	const style: CSSProperties = {
		transform: CSS.Translate.toString(transform),
		// Dragged tab stays put as a ghost; the DragOverlay follows the pointer.
		transition: isSortableDragging ? undefined : transition,
		opacity: isSortableDragging ? 0 : undefined,
	};

	const [hoverOpen, setHoverOpen] = useState(false);
	const suppressHover = isTabDragging || isSortableDragging;

	const titleDraft = useEditorUiStore((s) => s.titleDrafts[note.path]);
	const title = displayTitle(
		titleDraft !== undefined ? titleDraft : note.title,
	);
	const customIcon =
		spaceIcon?.startsWith("custom:") ? spaceIcon.slice("custom:".length) : null;

	return (
		<HoverCard
			open={hoverOpen && !suppressHover}
			openDelay={openDelay}
			closeDelay={100}
			onOpenChange={(open) => {
				if (suppressHover) {
					setHoverOpen(false);
					return;
				}
				setHoverOpen(open);
				if (open) onHoverOpen();
			}}
		>
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
							className="group relative z-10 my-2 w-28 shrink-0 cursor-default rounded-md border border-transparent text-[13px] text-muted-foreground transition-[color,background-color,border-color,transform] duration-150 hover:border-border/40 hover:bg-muted/60 hover:text-foreground active:scale-[0.98] data-[active=true]:border-border/60 data-[active=true]:bg-muted data-[active=true]:text-foreground data-[preview=true]:italic data-[preview=true]:opacity-70 data-[dragging=true]:border-border/40 data-[dragging=true]:bg-muted/50 data-[dragging=true]:cursor-default sm:w-36 lg:w-44"
							{...attributes}
							{...listeners}
						>
							<button
								type="button"
								className="flex h-full w-full items-center rounded-md pr-7 pl-2.5 text-left outline-none"
								onClick={() => {
									setHoverOpen(false);
									onSelect(note.path);
								}}
								onDoubleClick={() => onDoubleClick(note.path)}
								onMouseDown={(event) => {
									// Dismiss hover card on press (click or start of drag).
									if (event.button === 0) setHoverOpen(false);
									if (event.button === 1) {
										event.preventDefault();
										if (!note.pinned) onClose(note.path);
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
									if (note.pinned) onTogglePin(note.path);
									else onClose(note.path);
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
					<ContextMenuItem onSelect={() => onTogglePin(note.path)}>
						{note.pinned ? "Unpin Tab" : "Pin Tab"}
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<HoverCardContent
				side="bottom"
				align="start"
				sideOffset={6}
				className="w-48 gap-0 overflow-hidden p-0"
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
});

type TabBarProps = {
	spaceTitleFor: (spacePath: string) => string;
	onSelect: (path: string) => void;
	onDoubleClick: (path: string) => void;
	onClose: (path: string) => void;
	onTogglePin: (path: string) => void;
};

export const TabBar = memo(function TabBar({
	spaceTitleFor,
	onSelect,
	onDoubleClick,
	onClose,
	onTogglePin,
}: TabBarProps) {
	// Subscribe here so tab reorder does not re-render Index / sidebar / editors.
	const openTabs = useAppStore((s) => s.openTabs);
	const activeNotePath = useAppStore((s) => s.activeNotePath);
	const spaceIcons = useAppStore((s) => s.spaceIcons);
	const spaceColors = useAppStore((s) => s.spaceColors);

	const tabListRef = useRef<HTMLDivElement>(null);
	const [tabHoverWarm, setTabHoverWarm] = useState(false);
	const [isTabDragging, setIsTabDragging] = useState(false);
	const [activeDragPath, setActiveDragPath] = useState<string | null>(null);
	const tabHoverCoolTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	const markTabHoverWarm = useCallback(() => {
		if (tabHoverCoolTimerRef.current) {
			clearTimeout(tabHoverCoolTimerRef.current);
			tabHoverCoolTimerRef.current = null;
		}
		setTabHoverWarm(true);
	}, []);

	const scheduleTabHoverCool = useCallback(() => {
		if (tabHoverCoolTimerRef.current) clearTimeout(tabHoverCoolTimerRef.current);
		tabHoverCoolTimerRef.current = setTimeout(() => {
			setTabHoverWarm(false);
			tabHoverCoolTimerRef.current = null;
		}, 200);
	}, []);

	useEffect(() => {
		return () => {
			if (tabHoverCoolTimerRef.current) clearTimeout(tabHoverCoolTimerRef.current);
		};
	}, []);

	const restrictToHorizontalAxis: Modifier = useCallback(
		({ transform, activeNodeRect }) => {
			const listRect = tabListRef.current?.getBoundingClientRect();
			if (!listRect || !activeNodeRect) return { ...transform, y: 0 };

			const minX = listRect.left - activeNodeRect.left;
			const maxX = listRect.right - activeNodeRect.right;

			return {
				...transform,
				x: Math.min(maxX, Math.max(minX, transform.x)),
				y: 0,
			};
		},
		[],
	);

	const dndSensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 1 },
		}),
	);

	const openTabPaths = useMemo(
		() => openTabs.map((t) => t.path),
		[openTabs],
	);

	const tabDropAnimation: DropAnimation = {
		duration: 200,
		easing: "cubic-bezier(0.25, 1, 0.5, 1)",
		sideEffects: defaultDropAnimationSideEffects({
			styles: {
				active: { opacity: "0" },
			},
		}),
	};

	const handleDragEnd = useCallback((event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id) return;
		const activeId = String(active.id);
		const overId = String(over.id);
		useAppStore.getState().update((current) => {
			const oldIndex = current.openTabs.findIndex((tab) => tab.path === activeId);
			const newIndex = current.openTabs.findIndex((tab) => tab.path === overId);
			if (oldIndex === -1 || newIndex === -1) return current;
			return {
				...current,
				openTabs: arrayMove(current.openTabs, oldIndex, newIndex),
			};
		});
	}, []);

	return (
		<div
			ref={tabListRef}
			className="no-scrollbar flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain"
			onMouseEnter={() => {
				if (tabHoverCoolTimerRef.current) {
					clearTimeout(tabHoverCoolTimerRef.current);
					tabHoverCoolTimerRef.current = null;
				}
			}}
			onMouseLeave={scheduleTabHoverCool}
			onWheel={(e) => {
				if (e.deltaY !== 0) {
					e.preventDefault();
					tabListRef.current?.scrollBy({
						left: e.deltaY,
						behavior: "auto",
					});
				}
			}}
		>
			<DndContext
				sensors={dndSensors}
				collisionDetection={closestCenter}
				modifiers={[restrictToHorizontalAxis]}
				onDragStart={(event: DragStartEvent) => {
					setIsTabDragging(true);
					setActiveDragPath(String(event.active.id));
				}}
				onDragEnd={(event) => {
					// Apply order first so the list commits before overlay unmounts.
					handleDragEnd(event);
					setIsTabDragging(false);
					setActiveDragPath(null);
				}}
				onDragCancel={() => {
					setIsTabDragging(false);
					setActiveDragPath(null);
				}}
			>
				<SortableContext
					items={openTabPaths}
					strategy={horizontalListSortingStrategy}
				>
					{openTabs.map((note) => {
						const spacePath = topLevelPath(note.path);
						return (
							<SortableTab
								key={note.path}
								note={note}
								isActive={note.path === activeNotePath}
								displayTitle={displayNoteTitle}
								spacePath={spacePath}
								spaceTitle={spaceTitleFor(spacePath)}
								spaceIcon={spaceIcons[spacePath]}
								spaceColor={spaceColors[spacePath]}
								openDelay={tabHoverWarm ? 0 : 1000}
								isTabDragging={isTabDragging}
								onHoverOpen={markTabHoverWarm}
								onSelect={onSelect}
								onDoubleClick={onDoubleClick}
								onClose={onClose}
								onTogglePin={onTogglePin}
							/>
						);
					})}
				</SortableContext>
				<DragOverlay dropAnimation={tabDropAnimation}>
					{activeDragPath
						? (() => {
								const dragNote = openTabs.find(
									(tab) => tab.path === activeDragPath,
								);
								if (!dragNote) return null;
								const dragTitle = displayNoteTitle(
									useEditorUiStore.getState().titleDrafts[dragNote.path] ??
										dragNote.title,
								);
								const isActive = dragNote.path === activeNotePath;
								return (
									<div
										data-active={isActive}
										data-preview={dragNote.preview}
										className="flex h-8 w-28 scale-[0.98] cursor-default items-center rounded-md border px-2.5 text-[13px] shadow-md transition-transform duration-150 sm:w-36 lg:w-44 data-[active=true]:border-border/60 data-[active=true]:bg-muted data-[active=true]:text-foreground data-[active=false]:border-border/40 data-[active=false]:bg-muted/60 data-[active=false]:text-muted-foreground data-[preview=true]:italic data-[preview=true]:opacity-70"
									>
										<span className="min-w-0 flex-1 truncate">{dragTitle}</span>
									</div>
								);
						  })()
						: null}
				</DragOverlay>
			</DndContext>
		</div>
	);
});
