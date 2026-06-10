import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	type DragEndEvent,
	type Modifier,
	DndContext,
	closestCenter,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	useSortable,
	horizontalListSortingStrategy,
	arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	AlignLeftIcon,
	BookOpenIcon,
	CheckIcon,
	DownloadIcon,
	ExternalLinkIcon,
	FileSearchIcon,
	FileTextIcon,
	InfoIcon,
	MoreVerticalIcon,
	PencilIcon,
	PrinterIcon,
	SearchIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import {
	type CSSProperties,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { NoteEditor, type PageFormat } from "@/components/note-editor";
import { SidebarHotkeys } from "@/components/sidebar-hotkeys";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import { clerk, loadClerk } from "@/lib/clerk";
import {
	createEmptyNoteContent,
	noteContentPreview,
	replaceInNoteContent,
	serializeNoteContent,
	serializeNoteContentBody,
} from "@/lib/note-content";
import { getNotesEngine } from "@/lib/notes-engine";

export const Route = createFileRoute("/_main/")({
	beforeLoad: async () => {
		await loadClerk();

		if (!clerk.isSignedIn) {
			throw redirect({ to: "/login" });
		}
	},
	component: Index,
});

const defaultAppState: PaperiteAppState = {
	activeNotePath: null,
	activeSpacePath: "Inbox",
	expandedFolders: [],
	openTabs: [],
	spaceColors: {},
	spaceIcons: {},
	readOnlyNotes: {},
	sidebarOpen: true,
	inboxViewMode: "list",
};

type SaveStatus = "idle" | "saving" | "saved" | "error";
type FloatingPanelMode = "find" | "format" | "replace" | null;

const defaultPageFormat: PageFormat = {
	firstLineIndent: false,
	lineHeight: "normal",
	paragraphSpacing: "default",
};

type SortableTabProps = {
	note: OpenNoteTab;
	isActive: boolean;
	displayTitle: (title: string) => string;
	onSelect: () => void;
	onDoubleClick: () => void;
	onClose: () => void;
};

function SortableTab({
	note,
	isActive,
	displayTitle,
	onSelect,
	onDoubleClick,
	onClose,
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
		opacity: 1,
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			data-active={isActive}
			data-preview={note.preview}
			className="group relative z-10 my-2 w-28 shrink-0 rounded-md text-[13px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground data-[preview=true]:italic data-[preview=true]:opacity-70 sm:w-36 lg:w-44 cursor-grab active:cursor-grabbing"
			{...attributes}
			{...listeners}
		>
			<button
				type="button"
				className="flex h-full w-full items-center rounded-md pr-7 pl-2.5 text-left outline-none"
				onClick={onSelect}
				onDoubleClick={onDoubleClick}
			>
				<span className="min-w-0 flex-1 truncate">
					{displayTitle(note.title)}
				</span>
			</button>
			<button
				type="button"
				aria-label={`Close ${displayTitle(note.title)}`}
				className="-translate-y-1/2 absolute top-1/2 right-2 flex size-4 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover:opacity-65 group-data-[active=true]:opacity-65 hover:opacity-100"
				onClick={(event) => {
					event.stopPropagation();
					onClose();
				}}
			>
				<XIcon className="size-3.5" />
			</button>
		</div>
	);
}

function Index() {
	const notesApi = getNotesEngine();
	const workspaceRef = useRef<WorkspaceSnapshot | null>(null);
	const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
	const [appState, setAppState] = useState<PaperiteAppState>(defaultAppState);
	const inboxViewMode = appState.inboxViewMode;
	const setInboxViewMode = useCallback(
		(mode: "list" | "grid") =>
			setAppState((prev) => ({ ...prev, inboxViewMode: mode })),
		[],
	);
	const [noteContent, setNoteContent] = useState<NoteContent>(() =>
		createEmptyNoteContent(),
	);
	const [loadedNotePath, setLoadedNotePath] = useState<string | null>(null);
	const [notePreviews, setNotePreviews] = useState<Record<string, string>>({});
	const [noteTitleDrafts, setNoteTitleDrafts] = useState<
		Record<string, string>
	>({});
	const [floatingPanelMode, setFloatingPanelMode] =
		useState<FloatingPanelMode>(null);
	const [zenMode, setZenMode] = useState(false);
	const [findText, setFindText] = useState("");
	const [replaceText, setReplaceText] = useState("");
	const [pageFormats, setPageFormats] = useState<Record<string, PageFormat>>(
		{},
	);
	const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
	const didHydrate = useRef(false);
	const findInputRef = useRef<HTMLInputElement>(null);
	const lastLoadedNote = useRef<string | null>(null);
	const lastPersistedContent = useRef("");
	const activeNotePathRef = useRef<string | null>(null);
	const noteContentRef = useRef<NoteContent>(createEmptyNoteContent());
	const tabListRef = useRef<HTMLDivElement>(null);
	const activeEditorContentRef = useRef<(() => NoteContent) | null>(null);
	const noteContentCache = useRef(new Map<string, NoteContent>());
	const notePersistedCache = useRef(new Map<string, NoteContent>());
	const noteWriteQueue = useRef(new Map<string, Promise<void>>());
	const pendingSwitchBenchmark = useRef<{
		direction: 1 | -1;
		notePath: string;
		source: "benchmark" | "tabs";
		start: number;
	} | null>(null);
	const saveSequence = useRef(0);
	const [lockedNotePaths, setLockedNotePaths] = useState<Set<string>>(
		() => new Set(),
	);

	const restrictToHorizontalAxis: Modifier = ({ transform, activeNodeRect }) => {
		const listRect = tabListRef.current?.getBoundingClientRect();
		if (!listRect || !activeNodeRect) return { ...transform, y: 0 };

		const minX = listRect.left - activeNodeRect.left;
		const maxX = listRect.right - activeNodeRect.right;

		return {
			...transform,
			x: Math.min(maxX, Math.max(minX, transform.x)),
			y: 0,
		};
	};

	const dndSensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 5 },
		}),
	);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			const { active, over } = event;
			if (!over || active.id === over.id) return;

			setAppState((current) => {
				const oldIndex = current.openTabs.findIndex(
					(tab) => tab.path === active.id,
				);
				const newIndex = current.openTabs.findIndex(
					(tab) => tab.path === over.id,
				);
				if (oldIndex === -1 || newIndex === -1) return current;
				return {
					...current,
					openTabs: arrayMove(current.openTabs, oldIndex, newIndex),
				};
			});
		},
		[],
	);

	const getActiveContent = useCallback(
		() => activeEditorContentRef.current?.() ?? noteContentRef.current,
		[],
	);

	const enqueueNoteWrite = useCallback(
		(notePath: string, content: NoteContent) => {
			if (!notesApi) return Promise.resolve();

			const previousWrite =
				noteWriteQueue.current.get(notePath) ?? Promise.resolve();
			const queuedWrite = previousWrite
				.catch(() => undefined)
				.then(() =>
					notesApi.writeNote(notePath, content).then(() => undefined),
				);
			const trackedWrite = queuedWrite
				.catch(() => undefined)
				.finally(() => {
					if (noteWriteQueue.current.get(notePath) === trackedWrite) {
						noteWriteQueue.current.delete(notePath);
					}
				});

			noteWriteQueue.current.set(notePath, trackedWrite);

			return queuedWrite;
		},
		[notesApi],
	);

	const activeTab = appState.openTabs.find(
		(tab) => tab.path === appState.activeNotePath,
	);

	const activeNoteTitle =
		(appState.activeNotePath &&
		noteTitleDrafts[appState.activeNotePath] !== undefined
			? noteTitleDrafts[appState.activeNotePath]
			: undefined) ??
		(activeTab?.title || "Untitled");

	const activePageFormat = appState.activeNotePath
		? (pageFormats[appState.activeNotePath] ?? defaultPageFormat)
		: defaultPageFormat;

	useEffect(() => {
		activeNotePathRef.current = appState.activeNotePath;
	}, [appState.activeNotePath]);

	useEffect(() => {
		noteContentRef.current = noteContent;

		if (
			appState.activeNotePath &&
			lastLoadedNote.current === appState.activeNotePath
		) {
			noteContentCache.current.set(appState.activeNotePath, noteContent);
		}
	}, [appState.activeNotePath, noteContent]);

	useEffect(() => {
		const title = appState.activeNotePath
			? `${displayNoteTitle(activeNoteTitle)} - Paperite`
			: "Paperite";

		document.title = title;
		window.dispatchEvent(new Event("paperite:title-change"));
		window.electron?.app.setTitle(title);
	}, [activeNoteTitle, appState.activeNotePath]);

	const refreshWorkspace = useCallback(async () => {
		if (!notesApi) return;
		const nextWorkspace = await notesApi.getWorkspace();
		setWorkspace(nextWorkspace);
	}, [notesApi]);

	const syncExternalWorkspace = useCallback(async () => {
		if (!notesApi) return;

		const nextWorkspace = await notesApi.getWorkspace();
		const notePaths = collectNotePaths(nextWorkspace.spaces);

		workspaceRef.current = nextWorkspace;
		setWorkspace(nextWorkspace);
		setNotePreviews((current) => pickByPaths(current, notePaths));
		setNoteTitleDrafts((current) => pickByPaths(current, notePaths));
		setAppState((current) => reconcileAppState(current, nextWorkspace));

		const activeNotePath = appState.activeNotePath;
		if (!activeNotePath || !notePaths.has(activeNotePath)) return;
		if (serializeNoteContentBody(noteContent) !== lastPersistedContent.current) {
			return;
		}

		try {
			const content = await notesApi.readNote(activeNotePath);
			if (activeNotePathRef.current !== activeNotePath) return;
			if (
				serializeNoteContentBody(noteContentRef.current) !==
				lastPersistedContent.current
			) {
				return;
			}

			lastLoadedNote.current = activeNotePath;
			lastPersistedContent.current = serializeNoteContentBody(content);
			noteContentCache.current.set(activeNotePath, content);
			notePersistedCache.current.set(activeNotePath, content);
			setNoteContent(content);
			setSaveStatus("saved");
		} catch {
			setSaveStatus("error");
		}
	}, [appState.activeNotePath, noteContent, notesApi]);

	useEffect(() => {
		if (!notesApi) return;

		let cancelled = false;

		const hydrate = async () => {
			const [nextWorkspace, savedState] = await Promise.all([
				notesApi.getWorkspace(),
				notesApi.readAppState(),
			]);

			if (cancelled) return;

			setWorkspace(nextWorkspace);
			setAppState(
				reconcileAppState(
					normalizeAppState({ ...defaultAppState, ...savedState }),
					nextWorkspace,
				),
			);
			didHydrate.current = true;
		};

		hydrate().catch((error) => {
			console.error("[paperite] failed to hydrate workspace", error);
			setSaveStatus("error");
		});

		return () => {
			cancelled = true;
		};
	}, [notesApi]);

	useEffect(() => {
		if (!notesApi) return;

		return window.electron?.onWorkspaceChanged(() => {
			syncExternalWorkspace();
		});
	}, [notesApi, syncExternalWorkspace]);

	useEffect(() => {
		if (!notesApi || !didHydrate.current) return;

		notesApi.writeAppState(appState);
	}, [appState, notesApi]);

	useEffect(() => {
		if (!floatingPanelMode) return;

		findInputRef.current?.focus();
	}, [floatingPanelMode]);

	useEffect(() => {
		if (zenMode) {
			setFloatingPanelMode(null);
		}
	}, [zenMode]);

	useEffect(() => {
		const handleToggleZenMode = (event: CustomEvent<{ enabled?: boolean }>) => {
			if (event.detail?.enabled !== undefined) {
				setZenMode(event.detail.enabled);
			} else {
				setZenMode((current) => !current);
			}
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.key.toLowerCase() === "f" &&
				event.ctrlKey &&
				event.shiftKey &&
				!event.metaKey &&
				!event.altKey
			) {
				event.preventDefault();
				window.dispatchEvent(new CustomEvent("paperite:toggle-zen-mode"));
				return;
			}

			if (event.key === "Escape") {
				window.dispatchEvent(
					new CustomEvent("paperite:toggle-zen-mode", {
						detail: { enabled: false },
					}),
				);
			}
		};

		window.addEventListener("paperite:toggle-zen-mode", handleToggleZenMode as EventListener);
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("paperite:toggle-zen-mode", handleToggleZenMode as EventListener);
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, []);

	useEffect(() => {
		if (!window.electron) return;

		const cleanup = window.electron.onPopoutClosed((notePath) => {
			setLockedNotePaths((prev) => {
				const next = new Set(prev);
				next.delete(notePath);
				return next;
			});
		});

		return cleanup;
	}, []);

	useEffect(() => {
		if (!notesApi || !appState.activeNotePath) {
			lastLoadedNote.current = null;
			setLoadedNotePath(null);
			return;
		}

		let cancelled = false;
		const notePath = appState.activeNotePath;

		const loadNote = async () => {
			setSaveStatus("idle");
			const cachedContent = noteContentCache.current.get(notePath);
			setNotePreviews((current) => omitExact(current, notePath));

			if (cachedContent !== undefined) {
				const persistedContent = notePersistedCache.current.get(notePath);
				const cachedSerialized = serializeNoteContent(cachedContent);
				const persistedSerialized = persistedContent
					? serializeNoteContent(persistedContent)
					: "";

				setNoteContent(cachedContent);
				setLoadedNotePath(notePath);
				setSaveStatus(
					persistedContent
						? cachedSerialized === persistedSerialized
							? "saved"
							: "saving"
						: "idle",
				);
			} else {
				lastLoadedNote.current = null;
				lastPersistedContent.current = "";
				setLoadedNotePath(null);
				setNoteContent(createEmptyNoteContent());
			}

			const readStart = performance.now();
			const content = await notesApi.readNote(notePath);
			const readDuration = performance.now() - readStart;

			if (cancelled) return;

			const currentCachedContent = noteContentCache.current.get(notePath);
			const currentPersistedContent = notePersistedCache.current.get(notePath);
			const readSerialized = serializeNoteContent(content);
			const readSerializedBody = serializeNoteContentBody(content);
			const currentCachedSerialized = currentCachedContent
				? serializeNoteContent(currentCachedContent)
				: undefined;
			const currentPersistedSerialized = currentPersistedContent
				? serializeNoteContent(currentPersistedContent)
				: undefined;
			const currentPersistedSerializedBody = currentPersistedContent
				? serializeNoteContentBody(currentPersistedContent)
				: undefined;
			const hasDirtyCachedContent =
				currentCachedSerialized !== undefined &&
				currentCachedSerialized !== readSerialized &&
				(noteWriteQueue.current.has(notePath) ||
					currentPersistedSerialized === undefined ||
					currentCachedSerialized !== currentPersistedSerialized);

			if (hasDirtyCachedContent) {
				lastLoadedNote.current = notePath;
				lastPersistedContent.current =
					currentPersistedSerializedBody ?? readSerializedBody;
				if (!currentPersistedContent) {
					notePersistedCache.current.set(notePath, content);
				}
				setLoadedNotePath(notePath);
				setSaveStatus("saving");
				return;
			}

			lastLoadedNote.current = notePath;
			lastPersistedContent.current = readSerializedBody;
			noteContentCache.current.set(notePath, content);
			notePersistedCache.current.set(notePath, content);
			setNoteContent(content);
			setLoadedNotePath(notePath);
			setSaveStatus("saved");

			if (readDuration > 16) {
				console.info(
					`[paperite perf] readNote ${readDuration.toFixed(1)}ms ${notePath}`,
				);
			}
		};

		loadNote().catch(() => setSaveStatus("error"));

		return () => {
			cancelled = true;
		};
	}, [appState.activeNotePath, notesApi]);

	useEffect(() => {
		if (!notesApi || !appState.activeNotePath) return;
		if (loadedNotePath !== appState.activeNotePath) return;
		if (lastLoadedNote.current !== appState.activeNotePath) return;
		const serializedContentBody = serializeNoteContentBody(noteContent);

		if (serializedContentBody === lastPersistedContent.current) {
			setSaveStatus("saved");
			return;
		}

		setSaveStatus("saving");
		const saveTimer = window.setTimeout(() => {
			const notePath = appState.activeNotePath;
			if (!notePath) return;
			const latestContent =
				notePath === activeNotePathRef.current
					? getActiveContent()
					: noteContent;
			const trackedBody = serializeNoteContentBody(noteContentRef.current);

			if (trackedBody === lastPersistedContent.current) {
				setSaveStatus("saved");
				return;
			}

			const sequence = saveSequence.current + 1;
			saveSequence.current = sequence;

			enqueueNoteWrite(notePath, latestContent)
				.then(() => {
					if (
						saveSequence.current !== sequence ||
						activeNotePathRef.current !== notePath
					) {
						return;
					}

					lastPersistedContent.current = trackedBody;
					noteContentCache.current.set(notePath, latestContent);
					notePersistedCache.current.set(notePath, latestContent);
					setSaveStatus(
						serializeNoteContentBody(noteContentRef.current) === trackedBody
							? "saved"
							: "saving",
					);
					setWorkspace((current) =>
						current
							? updateWorkspaceNote(current, notePath, {
									preview: noteContentPreview(latestContent),
									updatedAt: Date.now(),
								})
							: current,
					);
				})
				.catch(() => setSaveStatus("error"));
		}, 700);

		return () => window.clearTimeout(saveTimer);
	}, [
		appState.activeNotePath,
		enqueueNoteWrite,
		getActiveContent,
		loadedNotePath,
		noteContent,
		notesApi,
	]);

	// debug: log workspace note order changes
	useEffect(() => {
		if (!workspace) return;
		const notes: { path: string; updatedAt: number }[] = [];
		for (const space of workspace.spaces) {
			const collect = (items: WorkspaceItem[]) => {
				for (const item of items) {
					if (item.type === "note") notes.push(item);
					if (item.type === "folder") collect(item.children);
				}
			};
			collect(space.children);
		}
	}, [workspace]);

	const currentSpacePath = useMemo(() => {
		if (
			!workspace?.spaces.some(
				(space) => space.path === appState.activeSpacePath,
			)
		) {
			return workspace?.spaces[0]?.path ?? "Inbox";
		}

		return appState.activeSpacePath;
	}, [appState.activeSpacePath, workspace]);

	const visibleSpaces = useMemo(
		() =>
			applyNoteDecorations(
				workspace?.spaces ?? [],
				notePreviews,
				noteTitleDrafts,
			),
		[workspace, notePreviews, noteTitleDrafts],
	);

	const setActiveSpacePath = (path: string) => {
		setAppState((current) => ({ ...current, activeSpacePath: path }));
	};

	const openNote = (note: WorkspaceNote, mode: "preview" | "pinned") => {
		const activeNotePath = activeNotePathRef.current;
		if (activeNotePath && activeNotePath !== note.path) {
			flushNote(activeNotePath, getActiveContent());
		}

		setAppState((current) => {
			const existing = current.openTabs.find((tab) => tab.path === note.path);
			const previewIndex = current.openTabs.findIndex((tab) => tab.preview);
			const nextTab: OpenNoteTab = {
				path: note.path,
				title: note.title,
				preview: mode === "preview" && !existing,
			};
			const openTabs = existing
				? current.openTabs.map((tab) =>
						tab.path === note.path
							? { ...tab, preview: mode === "pinned" ? false : tab.preview }
							: tab,
					)
				: replaceOrAppendPreviewTab(current.openTabs, nextTab, previewIndex);

			return {
				...current,
				activeNotePath: note.path,
				activeSpacePath: topLevelPath(note.path),
				openTabs,
			};
		});
	};

	const flushNote = useCallback(
		(notePath: string, content: NoteContent) => {
			if (!notesApi) return;

			const trackedContent = noteContentRef.current;
			const serializedBody = serializeNoteContentBody(trackedContent);
			const persistedContent = notePersistedCache.current.get(notePath);
			const persistedBody = persistedContent
				? serializeNoteContentBody(persistedContent)
				: "";

			if (serializedBody === persistedBody) return;

			const sequence = saveSequence.current + 1;
			saveSequence.current = sequence;
			setSaveStatus("saving");

			enqueueNoteWrite(notePath, content)
				.then(() => {
					noteContentCache.current.set(notePath, content);
					notePersistedCache.current.set(notePath, content);

					if (
						saveSequence.current === sequence &&
						activeNotePathRef.current === notePath
					) {
						lastPersistedContent.current = serializedBody;
						setSaveStatus(
							serializeNoteContentBody(noteContentRef.current) === serializedBody
								? "saved"
								: "saving",
						);
					}

					setWorkspace((current) =>
						current
							? updateWorkspaceNote(current, notePath, {
									preview: noteContentPreview(content),
									updatedAt: Date.now(),
								})
							: current,
					);
				})
				.catch(() => setSaveStatus("error"));
		},
		[enqueueNoteWrite, notesApi],
	);

	const closeTab = useCallback(
		(path: string, options: { flush?: boolean } = {}) => {
			if (options.flush !== false && path === activeNotePathRef.current) {
				const content = getActiveContent();

				noteContentCache.current.set(path, content);
				flushNote(path, content);
			}

			setAppState((current) => {
				const tabIndex = current.openTabs.findIndex((tab) => tab.path === path);
				const openTabs = current.openTabs.filter((tab) => tab.path !== path);
				const fallbackTab = openTabs[Math.max(0, tabIndex - 1)] ?? openTabs[0];

				return {
					...current,
					activeNotePath:
						current.activeNotePath === path
							? (fallbackTab?.path ?? null)
							: current.activeNotePath,
					openTabs,
				};
			});
		},
		[flushNote, getActiveContent],
	);

	const switchTab = useCallback(
		(direction: 1 | -1, source: "benchmark" | "tabs" = "tabs") => {
			const activeNotePath = activeNotePathRef.current;
			if (activeNotePath) flushNote(activeNotePath, getActiveContent());

			setAppState((current) => {
				if (current.openTabs.length < 2) return current;

				const activeIndex = current.openTabs.findIndex(
					(tab) => tab.path === current.activeNotePath,
				);
				const currentIndex = activeIndex === -1 ? 0 : activeIndex;
				const nextIndex =
					(currentIndex + direction + current.openTabs.length) %
					current.openTabs.length;
				const nextTab = current.openTabs[nextIndex];

				pendingSwitchBenchmark.current = {
					direction,
					notePath: nextTab.path,
					source,
					start: performance.now(),
				};

				return {
					...current,
					activeNotePath: nextTab.path,
					activeSpacePath: topLevelPath(nextTab.path),
				};
			});
		},
		[flushNote, getActiveContent],
	);

	useEffect(() => {
		const handleTabSwitch = (event: KeyboardEvent) => {
			if (!event.ctrlKey || event.metaKey) return;

			if (
				event.altKey &&
				(event.key === "ArrowRight" || event.key === "ArrowLeft")
			) {
				event.preventDefault();
				switchTab(event.key === "ArrowRight" ? 1 : -1, "benchmark");
				return;
			}

			if (event.altKey) return;

			if (event.key === "Tab") {
				event.preventDefault();
				switchTab(event.shiftKey ? -1 : 1);
				return;
			}

			if (event.key.toLowerCase() === "w" && appState.activeNotePath) {
				event.preventDefault();
				closeTab(appState.activeNotePath);
			}
		};

		window.addEventListener("keydown", handleTabSwitch);
		return () => window.removeEventListener("keydown", handleTabSwitch);
	}, [appState.activeNotePath, closeTab, switchTab]);

	const createNote = async (parentPath: string) => {
		if (!notesApi) return;

		try {
			const note = await notesApi.createNote(parentPath, "Untitled");
			await refreshWorkspace();
			setNoteTitleDrafts((current) => ({ ...current, [note.path]: "" }));
			openNote(
				{
					type: "note",
					preview: "",
					updatedAt: Date.now(),
					...note,
					title: "",
				},
				"pinned",
			);
		} catch {
			setSaveStatus("error");
		}
	};

	const createFolder = async (parentPath: string) => {
		if (!notesApi) return;

		try {
			const folder = await notesApi.createFolder(parentPath, "Untitled");
			setAppState((current) => ({
				...current,
				expandedFolders: unique([
					...current.expandedFolders,
					parentPath,
					folder.path,
				]),
			}));
			await refreshWorkspace();
		} catch {
			setSaveStatus("error");
		}
	};

	const createSpace = async (title: string, color: string, icon: string) => {
		if (!notesApi) return;

		try {
			const space = await notesApi.createSpace(title);
			setAppState((current) => ({
				...current,
				activeSpacePath: space.path,
				spaceColors: { ...current.spaceColors, [space.path]: color },
				spaceIcons: { ...current.spaceIcons, [space.path]: icon },
			}));
			await refreshWorkspace();
		} catch {
			setSaveStatus("error");
		}
	};

	const editSpace = async (
		path: string,
		title: string,
		color: string,
		icon: string,
	) => {
		if (!notesApi) return;
		if (!title.trim()) return;

		try {
			const renamed =
				title.trim() === fileName(path)
					? { path }
					: await notesApi.renameItem(path, title);
			setAppState((current) => ({
				...current,
				activeNotePath:
					current.activeNotePath &&
					isSameOrChildPath(path, current.activeNotePath)
						? movePath(current.activeNotePath, path, renamed.path)
						: current.activeNotePath,
				activeSpacePath:
					current.activeSpacePath === path
						? renamed.path
						: current.activeSpacePath,
				expandedFolders: current.expandedFolders.map((folderPath) =>
					isSameOrChildPath(path, folderPath)
						? movePath(folderPath, path, renamed.path)
						: folderPath,
				),
				openTabs: current.openTabs.map((tab) =>
					isSameOrChildPath(path, tab.path)
						? { ...tab, path: movePath(tab.path, path, renamed.path) }
						: tab,
				),
				spaceColors: {
					...moveDecorations(current.spaceColors, path, renamed.path),
					[renamed.path]: color,
				},
				spaceIcons: {
					...moveDecorations(current.spaceIcons, path, renamed.path),
					[renamed.path]: icon,
				},
				readOnlyNotes: moveDecorations(
					current.readOnlyNotes,
					path,
					renamed.path,
				),
			}));
			setNotePreviews((current) =>
				moveDecorations(current, path, renamed.path),
			);
			setNoteTitleDrafts((current) =>
				moveDecorations(current, path, renamed.path),
			);
			setPageFormats((current) => moveDecorations(current, path, renamed.path));
			await refreshWorkspace();
		} catch {
			setSaveStatus("error");
		}
	};

	const deleteSpace = async (path: string) => {
		if (!notesApi || path === "Inbox") return;

		try {
			await notesApi.deleteItem(path);
			setAppState((current) => ({
				...current,
				activeNotePath:
					current.activeNotePath &&
					isSameOrChildPath(path, current.activeNotePath)
						? null
						: current.activeNotePath,
				activeSpacePath:
					current.activeSpacePath === path ? "Inbox" : current.activeSpacePath,
				expandedFolders: current.expandedFolders.filter(
					(folderPath) => !isSameOrChildPath(path, folderPath),
				),
				openTabs: current.openTabs.filter(
					(tab) => !isSameOrChildPath(path, tab.path),
				),
				spaceColors: omitDecoration(current.spaceColors, path),
				spaceIcons: omitDecoration(current.spaceIcons, path),
				readOnlyNotes: omitDecoration(current.readOnlyNotes, path),
			}));
			setNotePreviews((current) => omitDecoration(current, path));
			setNoteTitleDrafts((current) => omitDecoration(current, path));
			setPageFormats((current) => omitDecoration(current, path));
			await refreshWorkspace();
		} catch {
			setSaveStatus("error");
		}
	};

	const toggleFolder = (path: string, isOpen: boolean) => {
		setAppState((current) => ({
			...current,
			expandedFolders: isOpen
				? unique([...current.expandedFolders, path])
				: current.expandedFolders.filter((folderPath) => folderPath !== path),
		}));
	};

	const moveItem = async (itemPath: string, nextParentPath: string) => {
		if (!notesApi) return;

		try {
			const moved = await notesApi.moveItem(itemPath, nextParentPath);
			setAppState((current) => ({
				...current,
				activeNotePath:
					current.activeNotePath &&
					isSameOrChildPath(itemPath, current.activeNotePath)
						? movePath(current.activeNotePath, itemPath, moved.path)
						: current.activeNotePath,
				activeSpacePath:
					current.activeNotePath &&
					isSameOrChildPath(itemPath, current.activeNotePath)
						? topLevelPath(moved.path)
						: current.activeSpacePath,
				expandedFolders: unique([...current.expandedFolders, nextParentPath]),
				openTabs: current.openTabs.map((tab) =>
					isSameOrChildPath(itemPath, tab.path)
						? {
								...tab,
								path: movePath(tab.path, itemPath, moved.path),
								title: stripNoteExtension(
									fileName(movePath(tab.path, itemPath, moved.path)),
								),
							}
						: tab,
				),
			}));
			setNotePreviews((current) =>
				moveDecorations(current, itemPath, moved.path),
			);
			setNoteTitleDrafts((current) =>
				moveDecorations(current, itemPath, moved.path),
			);
			setPageFormats((current) =>
				moveDecorations(current, itemPath, moved.path),
			);
			setAppState((current) => ({
				...current,
				readOnlyNotes: moveDecorations(
					current.readOnlyNotes,
					itemPath,
					moved.path,
				),
			}));
			await refreshWorkspace();
		} catch {
			setSaveStatus("error");
		}
	};

	const renameActiveNote = async (title: string) => {
		if (!notesApi || !appState.activeNotePath) return;

		try {
			const previousPath = appState.activeNotePath;
			const renamed = await notesApi.renameItem(previousPath, title);
			const nextTitle =
				renamed.path === previousPath
					? title
					: stripNoteExtension(fileName(renamed.path));

			const cachedContent = noteContentCache.current.get(previousPath);
			if (cachedContent !== undefined) {
				noteContentCache.current.set(renamed.path, cachedContent);
				noteContentCache.current.delete(previousPath);
				const persistedContent = notePersistedCache.current.get(previousPath);
				if (persistedContent !== undefined) {
					notePersistedCache.current.set(renamed.path, persistedContent);
					notePersistedCache.current.delete(previousPath);
				}
				lastLoadedNote.current = renamed.path;
				lastPersistedContent.current = serializeNoteContentBody(cachedContent);
				if (renamed.path === previousPath) {
					const updated = { ...cachedContent, title: nextTitle };
					noteContentCache.current.set(renamed.path, updated);
					setNoteContent(updated);
				} else {
					setNoteContent(cachedContent);
				}
				setLoadedNotePath(renamed.path);
			}

			setAppState((current) => ({
				...current,
				activeNotePath: renamed.path,
				activeSpacePath: topLevelPath(renamed.path),
				openTabs: current.openTabs.map((tab) =>
					tab.path === previousPath
						? { ...tab, path: renamed.path, title: nextTitle }
						: tab,
				),
			}));
			setNotePreviews((current) => {
				const { [previousPath]: preview, ...rest } = current;
				return preview ? { ...rest, [renamed.path]: preview } : rest;
			});
			setNoteTitleDrafts((current) => {
				const { [previousPath]: _previousTitle, ...rest } = current;
				return { ...rest, [renamed.path]: nextTitle };
			});
			setPageFormats((current) =>
				moveDecorations(current, previousPath, renamed.path),
			);
			await refreshWorkspace();
		} catch {
			setSaveStatus("error");
		}
	};

	const deleteActiveNote = async () => {
		if (!notesApi || !appState.activeNotePath) return;

		const notePath = appState.activeNotePath;

		try {
			await notesApi.deleteItem(notePath);
			closeTab(notePath, { flush: false });
			setNotePreviews((current) => {
				const { [notePath]: _preview, ...rest } = current;
				return rest;
			});
			setNoteTitleDrafts((current) => {
				const { [notePath]: _title, ...rest } = current;
				return rest;
			});
			setPageFormats((current) => omitExact(current, notePath));
			await refreshWorkspace();
		} catch {
			setSaveStatus("error");
		}
	};

	const renameItem = async (path: string, title: string) => {
		if (!notesApi || !title.trim()) return;

		try {
			const renamed = await notesApi.renameItem(path, title);
			const nextTitle =
				renamed.path === path
					? title
					: stripNoteExtension(fileName(renamed.path));

			setAppState((current) => ({
				...current,
				activeNotePath:
					current.activeNotePath &&
					isSameOrChildPath(path, current.activeNotePath)
						? movePath(current.activeNotePath, path, renamed.path)
						: current.activeNotePath,
				activeSpacePath:
					current.activeSpacePath === path
						? renamed.path
						: current.activeSpacePath,
				expandedFolders: current.expandedFolders.map((folderPath) =>
					isSameOrChildPath(path, folderPath)
						? movePath(folderPath, path, renamed.path)
						: folderPath,
				),
				openTabs: current.openTabs.map((tab) =>
					isSameOrChildPath(path, tab.path)
						? {
								...tab,
								path: movePath(tab.path, path, renamed.path),
								title:
									tab.path === path
										? nextTitle
										: stripNoteExtension(
												fileName(movePath(tab.path, path, renamed.path)),
											),
							}
						: tab,
				),
				readOnlyNotes: moveDecorations(
					current.readOnlyNotes,
					path,
					renamed.path,
				),
			}));
			setNotePreviews((current) =>
				moveDecorations(current, path, renamed.path),
			);
			setNoteTitleDrafts((current) =>
				moveDecorations(current, path, renamed.path),
			);
			setPageFormats((current) => moveDecorations(current, path, renamed.path));
			await refreshWorkspace();
		} catch {
			setSaveStatus("error");
		}
	};

	const deleteItem = async (path: string) => {
		if (!notesApi) return;

		try {
			await notesApi.deleteItem(path);
			setAppState((current) => ({
				...current,
				activeNotePath:
					current.activeNotePath &&
					isSameOrChildPath(path, current.activeNotePath)
						? null
						: current.activeNotePath,
				expandedFolders: current.expandedFolders.filter(
					(folderPath) => !isSameOrChildPath(path, folderPath),
				),
				openTabs: current.openTabs.filter(
					(tab) => !isSameOrChildPath(path, tab.path),
				),
				readOnlyNotes: omitDecoration(current.readOnlyNotes, path),
			}));
			setNotePreviews((current) => omitDecoration(current, path));
			setNoteTitleDrafts((current) => omitDecoration(current, path));
			setPageFormats((current) => omitDecoration(current, path));
			await refreshWorkspace();
		} catch {
			setSaveStatus("error");
		}
	};

	const replaceInNote = () => {
		if (!findText) return;
		setNoteContent((current) =>
			replaceInNoteContent(current, findText, replaceText, false),
		);
	};

	const replaceAllInNote = () => {
		if (!findText) return;
		setNoteContent((current) =>
			replaceInNoteContent(current, findText, replaceText, true),
		);
	};

	const updateActiveTitleDraft = (title: string) => {
		if (!appState.activeNotePath) return;

		setNoteTitleDrafts((current) => ({
			...current,
			[appState.activeNotePath as string]: title,
		}));
		setAppState((current) => ({
			...current,
			openTabs: current.openTabs.map((tab) =>
				tab.path === current.activeNotePath ? { ...tab, title } : tab,
			),
		}));
	};

	const updateActivePageFormat = useCallback(
		(patch: Partial<PageFormat>) => {
			if (!appState.activeNotePath) return;

			setPageFormats((current) => ({
				...current,
				[appState.activeNotePath as string]: {
					...(current[appState.activeNotePath as string] ?? defaultPageFormat),
					...patch,
				},
			}));
		},
		[appState.activeNotePath],
	);

	const updateNoteContent = useCallback(
		(nextContent: NoteContent, sourceNotePath: string | null) => {
			if (!sourceNotePath) return;
			if (sourceNotePath !== activeNotePathRef.current) return;

			noteContentRef.current = nextContent;
			noteContentCache.current.set(sourceNotePath, nextContent);
			setNoteContent(nextContent);
		},
		[],
	);

	const updateActiveContentSnapshot = useCallback(
		(getContent: (() => NoteContent) | null) => {
			activeEditorContentRef.current = getContent;
		},
		[],
	);

	const activeNoteReadOnly = appState.activeNotePath
		? appState.readOnlyNotes[appState.activeNotePath] === true
		: false;

	const toggleReadOnly = () => {
		if (!appState.activeNotePath) return;

		setAppState((current) => ({
			...current,
			readOnlyNotes: {
				...current.readOnlyNotes,
				[appState.activeNotePath as string]: !activeNoteReadOnly,
			},
		}));
	};

	const selectTab = useCallback(
		(notePath: string) => {
			const activeNotePath = activeNotePathRef.current;
			if (activeNotePath && activeNotePath !== notePath) {
				flushNote(activeNotePath, getActiveContent());
			}

			setAppState((current) => ({
				...current,
				activeNotePath: notePath,
				activeSpacePath: topLevelPath(notePath),
			}));
		},
		[flushNote, getActiveContent],
	);

	const pinTab = useCallback((notePath: string) => {
		setAppState((current) => ({
			...current,
			openTabs: current.openTabs.map((tab) =>
				tab.path === notePath ? { ...tab, preview: false } : tab,
			),
		}));
	}, []);

	const completeSwitchBenchmark = useCallback((notePath: string) => {
		const benchmark = pendingSwitchBenchmark.current;

		if (!benchmark || benchmark.notePath !== notePath) return;

		pendingSwitchBenchmark.current = null;
		const duration = performance.now() - benchmark.start;

		console.info(
			`[paperite perf] ${benchmark.source} switch ${benchmark.direction === 1 ? "next" : "previous"} ${duration.toFixed(1)}ms ${notePath}`,
		);
	}, []);

	if (!notesApi) {
		return (
			<div className="grid h-full place-items-center text-sm text-muted-foreground">
				Paperite needs the Electron shell to access local notes.
			</div>
		);
	}

	return (
		<SidebarProvider
			className="h-full min-h-0"
			open={appState.sidebarOpen}
			onOpenChange={(sidebarOpen) =>
				setAppState((current) => ({ ...current, sidebarOpen }))
			}
			style={
				{
					"--sidebar-width": "14.5rem",
				} as CSSProperties
			}
		>
			{zenMode ? null : (
				<>
					<SidebarHotkeys />
					<AppSidebar
						activeNotePath={appState.activeNotePath}
						activeSpacePath={currentSpacePath}
						expandedFolders={appState.expandedFolders}
						spaceColors={appState.spaceColors}
						spaceIcons={appState.spaceIcons}
						spaces={visibleSpaces}
						viewMode={inboxViewMode}
						onViewModeChange={setInboxViewMode}
						onCreateFolder={createFolder}
						onCreateNote={createNote}
						onCreateSpace={createSpace}
						onDeleteItem={deleteItem}
						onDeleteSpace={deleteSpace}
						onEditSpace={editSpace}
						onMoveItem={moveItem}
						onOpenNote={openNote}
						onRenameItem={renameItem}
						onSelectSpace={setActiveSpacePath}
						onToggleFolder={toggleFolder}
					/>
				</>
			)}
			<SidebarInset className="min-w-0 overflow-hidden">
				{zenMode || !appState.activeNotePath ? null : (
					<header className="relative z-10 flex h-12 shrink-0 items-stretch gap-3 px-3 transition-[width,height] ease-linear after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-8 after:bg-linear-to-b after:from-background after:to-transparent after:content-['']">
						<div className="flex shrink-0 items-center min-[56.0625rem]:hidden">
							<SidebarTrigger
								toggleNotesSheet
								className="text-muted-foreground min-[56.0625rem]:hidden"
							/>
						</div>
						<div
							ref={tabListRef}
							className="no-scrollbar flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain"
						>
							<DndContext
								sensors={dndSensors}
								collisionDetection={closestCenter}
								modifiers={[restrictToHorizontalAxis]}
								onDragEnd={handleDragEnd}
							>
							<SortableContext
								items={appState.openTabs.map((t) => t.path)}
								strategy={horizontalListSortingStrategy}
							>
								{appState.openTabs.map((note) => (
									<SortableTab
										key={note.path}
										note={note}
										isActive={
											note.path === appState.activeNotePath
										}
										displayTitle={displayNoteTitle}
										onSelect={() => selectTab(note.path)}
										onDoubleClick={() => pinTab(note.path)}
										onClose={() => closeTab(note.path)}
									/>
								))}
							</SortableContext>
							</DndContext>
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<span className="min-w-12 px-2 text-right text-xs text-muted-foreground">
								{saveStatusLabel(saveStatus)}
							</span>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className="text-muted-foreground"
								aria-label={activeNoteReadOnly ? "Edit note" : "Reading view"}
								onClick={toggleReadOnly}
							>
								{activeNoteReadOnly ? <PencilIcon /> : <BookOpenIcon />}
							</Button>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className="text-muted-foreground"
										aria-label="More note actions"
									>
										<MoreVerticalIcon />
									</Button>
								</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-56">
								<DropdownMenuItem>
									<InfoIcon />
									Note Info
								</DropdownMenuItem>
								<DropdownMenuItem
									onSelect={() => {
										setFloatingPanelMode("format");
									}}
								>
									<AlignLeftIcon />
									Format Note...
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									disabled={
										!appState.activeNotePath ||
										lockedNotePaths.has(appState.activeNotePath)
									}
									onSelect={() => {
										const activePath = appState.activeNotePath;
										if (activePath && window.electron) {
											window.electron.notes
												.popoutNote(activePath)
												.then(() => {
													setLockedNotePaths((prev) => {
														const next = new Set(prev);
														next.add(activePath);
														return next;
													});
												});
										}
									}}
								>
									<ExternalLinkIcon />
									{appState.activeNotePath &&
									lockedNotePaths.has(appState.activeNotePath)
										? "Already open in window"
										: "Pop out note"}
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem>
									<DownloadIcon />
									Export as PDF…
								</DropdownMenuItem>
								<DropdownMenuItem>
									<PrinterIcon />
									Print…
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									onSelect={() => {
										setFloatingPanelMode("find");
									}}
								>
									<SearchIcon />
									Find in note…
								</DropdownMenuItem>
								<DropdownMenuItem
									onSelect={() => {
										setFloatingPanelMode("replace");
									}}
								>
									<FileSearchIcon />
									Replace in note…
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									variant="destructive"
									onSelect={deleteActiveNote}
									disabled={!appState.activeNotePath}
								>
									<Trash2Icon />
									Delete note
								</DropdownMenuItem>
							</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</header>
				)}
				{floatingPanelMode ? (
					<div className="absolute top-12 right-4 z-20 flex w-80 flex-col gap-2 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10">
						{floatingPanelMode === "format" ? (
							<>
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground">Line height</span>
									<Button
										type="button"
										size="icon-sm"
										variant="ghost"
										aria-label="Close format page"
										onClick={() => setFloatingPanelMode(null)}
									>
										<XIcon />
									</Button>
								</div>
								<div className="grid grid-cols-[1fr_auto] items-center gap-2">
									<FormatPanelButton
										active={activePageFormat.lineHeight === "normal"}
										label="Normal"
										onClick={() =>
											updateActivePageFormat({ lineHeight: "normal" })
										}
									/>
									<FormatPanelButton
										active={activePageFormat.lineHeight === "1.5"}
										label="1.5"
										onClick={() =>
											updateActivePageFormat({ lineHeight: "1.5" })
										}
									/>
								</div>
								<span className="pt-1 text-muted-foreground">
									Paragraph spacing
								</span>
								<div className="grid grid-cols-[1fr_auto] items-center gap-2">
									<FormatPanelButton
										active={activePageFormat.paragraphSpacing === "default"}
										label="Default"
										onClick={() =>
											updateActivePageFormat({
												paragraphSpacing: "default",
											})
										}
									/>
									<FormatPanelButton
										active={activePageFormat.paragraphSpacing === "compact"}
										label="Compact"
										onClick={() =>
											updateActivePageFormat({
												paragraphSpacing: "compact",
											})
										}
									/>
								</div>
								<FormatPanelButton
									active={activePageFormat.firstLineIndent}
									label="First-line indent"
									onClick={() =>
										updateActivePageFormat({
											firstLineIndent: !activePageFormat.firstLineIndent,
										})
									}
								/>
							</>
						) : (
							<>
								<div className="flex items-center gap-2">
									<input
										ref={findInputRef}
										value={findText}
										placeholder="Find..."
										className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 outline-none focus-visible:border-ring"
										onChange={(event) => setFindText(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Escape") setFloatingPanelMode(null);
										}}
									/>
									<Button
										type="button"
										size="icon-sm"
										variant="ghost"
										aria-label="Close find and replace"
										onClick={() => setFloatingPanelMode(null)}
									>
										<XIcon />
									</Button>
								</div>
								{floatingPanelMode === "replace" ? (
									<div className="flex items-center gap-2">
										<input
											value={replaceText}
											placeholder="Replace..."
											className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 outline-none focus-visible:border-ring"
											onChange={(event) => setReplaceText(event.target.value)}
											onKeyDown={(event) => {
												if (event.key === "Escape") setFloatingPanelMode(null);
											}}
										/>
										<Button
											type="button"
											size="sm"
											variant="outline"
											onClick={replaceInNote}
										>
											One
										</Button>
										<Button type="button" size="sm" onClick={replaceAllInNote}>
											All
										</Button>
									</div>
								) : null}
							</>
						)}
					</div>
				) : null}
				<section
					aria-label="Note editor"
					className="flex min-h-0 flex-1 overflow-y-auto overscroll-contain"
					onKeyDown={(event) => {
						if (
							event.key.toLowerCase() === "b" &&
							(event.ctrlKey || event.metaKey)
						) {
							event.stopPropagation();
						}
					}}
				>
					{appState.activeNotePath &&
					loadedNotePath === appState.activeNotePath ? (
						<NoteEditor
							key={appState.activeNotePath}
							content={noteContent}
							noteTitle={activeNoteTitle}
							notePath={appState.activeNotePath}
							pageFormat={activePageFormat}
							readOnly={activeNoteReadOnly}
							searchQuery={
								floatingPanelMode === "find" || floatingPanelMode === "replace"
									? findText
									: ""
							}
							zenMode={zenMode}
							onChange={updateNoteContent}
							onContentRendered={completeSwitchBenchmark}
							onContentSnapshot={updateActiveContentSnapshot}
							onRename={renameActiveNote}
							onTitleChange={updateActiveTitleDraft}
						/>
					) : appState.activeNotePath ? (
						<div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
							Loading note...
						</div>
					) : (
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<FileTextIcon />
								</EmptyMedia>
								<EmptyTitle>No note open</EmptyTitle>
								<EmptyDescription>
									Open a note from the sidebar to start writing.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					)}
				</section>
			</SidebarInset>
		</SidebarProvider>
	);
}

function normalizeAppState(state: PaperiteAppState): PaperiteAppState {
	return {
		activeNotePath: state.activeNotePath ?? null,
		activeSpacePath: state.activeSpacePath || "Inbox",
		expandedFolders: unique(state.expandedFolders ?? []),
		openTabs: (state.openTabs ?? []).filter((tab) => tab.path && tab.title),
		spaceColors: state.spaceColors ?? {},
		spaceIcons: state.spaceIcons ?? {},
		readOnlyNotes: state.readOnlyNotes ?? {},
		sidebarOpen: state.sidebarOpen ?? true,
		inboxViewMode: state.inboxViewMode === "grid" ? "grid" : "list",
	};
}

function reconcileAppState(
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
		state.activeSpacePath &&
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
		readOnlyNotes: state.readOnlyNotes,
		sidebarOpen: state.sidebarOpen,
		inboxViewMode: state.inboxViewMode,
	};
}

function collectNotePaths(spaces: WorkspaceSpace[]) {
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

function collectFolderPaths(spaces: WorkspaceSpace[]) {
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

function pickByPaths<T>(record: Record<string, T>, paths: Set<string>) {
	return Object.fromEntries(
		Object.entries(record).filter(([path]) => paths.has(path)),
	) as Record<string, T>;
}

function replaceOrAppendPreviewTab(
	openTabs: OpenNoteTab[],
	nextTab: OpenNoteTab,
	previewIndex: number,
) {
	if (previewIndex === -1 || !nextTab.preview) return [...openTabs, nextTab];

	return openTabs.map((tab, index) => (index === previewIndex ? nextTab : tab));
}

function saveStatusLabel(status: SaveStatus) {
	if (status === "saving") return "Saving...";
	if (status === "saved") return "Saved";
	if (status === "error") return "Error";
	return "";
}

function FormatPanelButton({
	active,
	label,
	onClick,
}: {
	active: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			data-active={active}
			className="flex h-9 items-center justify-between rounded-md px-2.5 text-left text-sm transition-colors hover:bg-muted data-[active=true]:bg-muted"
			onClick={onClick}
		>
			<span>{label}</span>
			{active ? <CheckIcon className="size-4" /> : null}
		</button>
	);
}

function displayNoteTitle(title: string) {
	return title.trim() || "Untitled";
}

function topLevelPath(notePath: string) {
	return notePath.split("/")[0] || "Inbox";
}

function fileName(notePath: string) {
	return notePath.split("/").at(-1) ?? notePath;
}

function stripNoteExtension(filename: string) {
	return filename.replace(/\.(?:json|md)$/i, "");
}

function isSameOrChildPath(parentPath: string, childPath: string) {
	return childPath === parentPath || childPath.startsWith(`${parentPath}/`);
}

function movePath(path: string, fromPath: string, toPath: string) {
	if (path === fromPath) return toPath;
	return `${toPath}/${path.slice(fromPath.length + 1)}`;
}

function moveDecorations<T>(
	decorations: Record<string, T>,
	fromPath: string,
	toPath: string,
) {
	return Object.fromEntries(
		Object.entries(decorations).map(([path, value]) => [
			isSameOrChildPath(fromPath, path)
				? movePath(path, fromPath, toPath)
				: path,
			value,
		]),
	);
}

function omitDecoration<T>(decorations: Record<string, T>, pathToOmit: string) {
	return Object.fromEntries(
		Object.entries(decorations).filter(
			([path]) => !isSameOrChildPath(pathToOmit, path),
		),
	);
}

function omitExact<T>(record: Record<string, T>, pathToOmit: string) {
	const { [pathToOmit]: _omitted, ...rest } = record;
	return rest;
}

function updateWorkspaceNote(
	workspace: WorkspaceSnapshot,
	notePath: string,
	patch: Pick<WorkspaceNote, "preview" | "updatedAt">,
): WorkspaceSnapshot {
	return {
		...workspace,
		spaces: workspace.spaces.map((space) => ({
			...space,
			children: updateWorkspaceItems(space.children, notePath, patch),
		})),
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

	return nextItems.sort((first, second) => {
		if (first.type === "folder" || second.type === "folder") return 0;
		return second.updatedAt - first.updatedAt;
	});
}

function applyNoteDecorations(
	spaces: WorkspaceSpace[],
	previews: Record<string, string>,
	titleDrafts: Record<string, string>,
): WorkspaceSpace[] {
	return spaces.map((space) => ({
		...space,
		children: applyItemDecorations(space.children, previews, titleDrafts),
	}));
}

function applyItemDecorations(
	items: WorkspaceItem[],
	previews: Record<string, string>,
	titleDrafts: Record<string, string>,
): WorkspaceItem[] {
	return items.map((item) => {
		if (item.type === "folder") {
			return {
				...item,
				children: applyItemDecorations(item.children, previews, titleDrafts),
			};
		}

		return {
			...item,
			title: titleDrafts[item.path] ?? item.title,
			preview: previews[item.path] ?? item.preview,
		};
	});
}

function unique(values: string[]) {
	return Array.from(new Set(values.filter(Boolean)));
}
