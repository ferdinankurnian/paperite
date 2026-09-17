import {
	Extension,
	getSchema,
	type Editor as TiptapEditor,
} from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Collaboration from "@tiptap/extension-collaboration";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
	EditorContent,
	ReactNodeViewRenderer,
	useEditor,
	useEditorState,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { prosemirrorJSONToYDoc, yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import { common, createLowlight } from "lowlight";
import {
	AlignCenterIcon,
	AlignJustifyIcon,
	AlignLeftIcon,
	AlignRightIcon,
	BoldIcon,
	ChevronUpIcon,
	Code2Icon,
	HighlighterIcon,
	ClipboardPasteIcon,
	ExternalLinkIcon,
	ImagePlusIcon,
	ItalicIcon,
	UploadIcon,
	ListIcon,
	ListOrderedIcon,
	ListTodoIcon,
	QuoteIcon,
	StrikethroughIcon,
	UnderlineIcon,
} from "lucide-react";
import {
	type ChangeEvent,
	type ComponentType,
	type DragEvent,
	type MouseEvent,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import * as Y from "yjs";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuGroup,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { CodeBlockView } from "@/components/code-block-view";
import { normalizeNoteContent, noteContentText, serializeNoteContent } from "@/lib/note-content";
import { cn } from "@/lib/utils";

/** Per-mounted-editor view/edit controllers. Not persisted — lives with the tab instance. */
type NoteReadOnlyController = {
	get: () => boolean;
	toggle: () => void;
	subscribe: (listener: (readOnly: boolean) => void) => () => void;
};

const noteReadOnlyControllers = new Map<string, NoteReadOnlyController>();
const noteReadOnlyRegistryListeners = new Set<() => void>();

function notifyNoteReadOnlyRegistry() {
	for (const listener of noteReadOnlyRegistryListeners) listener();
}

export function getNoteReadOnlyController(
	path: string | null | undefined,
): NoteReadOnlyController | null {
	if (!path) return null;
	return noteReadOnlyControllers.get(path) ?? null;
}

/** Fires when any editor registers/unregisters its view/edit controller. */
export function subscribeNoteReadOnlyRegistry(listener: () => void): () => void {
	noteReadOnlyRegistryListeners.add(listener);
	return () => {
		noteReadOnlyRegistryListeners.delete(listener);
	};
}

function isRelativeAssetSrc(src: string): boolean {
	return (
		!src.startsWith("data:") &&
		!src.startsWith("http") &&
		!src.startsWith("file://") &&
		!src.startsWith("/")
	);
}

async function resolveImagePaths(
	notePath: string,
	node: NoteContent,
): Promise<NoteContent> {
	if (
		node.type === "image" &&
		typeof node.attrs?.src === "string" &&
		isRelativeAssetSrc(node.attrs.src)
	) {
		const url = await window.electron?.notes.getAssetUrl(
			notePath,
			node.attrs.src,
		);
		if (url) {
			return { ...node, attrs: { ...node.attrs, src: url } };
		}
	}
	if (node.content) {
		const resolvedChildren = await Promise.all(
			node.content.map((child) => resolveImagePaths(notePath, child)),
		);
		return { ...node, content: resolvedChildren };
	}
	return node;
}

function toRelativeAssetSrc(src: string): string {
	if (!src.startsWith("file://")) return src;
	const assetsIdx = src.indexOf("/assets/");
	if (assetsIdx === -1) return src;
	return src.slice(assetsIdx + 1);
}

function denormalizeImagePaths(node: NoteContent): NoteContent {
	if (
		node.type === "image" &&
		typeof node.attrs?.src === "string" &&
		node.attrs.src.startsWith("file://")
	) {
		return {
			...node,
			attrs: { ...node.attrs, src: toRelativeAssetSrc(node.attrs.src) },
		};
	}
	if (node.content) {
		return { ...node, content: node.content.map(denormalizeImagePaths) };
	}
	return node;
}

/** Save image to assets/ and return a displayable file:// URL (falls back to data URL). */
async function saveImageToNote(
	notePath: string,
	dataUrl: string,
	filename: string,
): Promise<string> {
	try {
		const result = await window.electron?.notes.saveImage(
			notePath,
			dataUrl,
			filename,
		);
		if (result?.path) {
			const displayUrl = await window.electron?.notes.getAssetUrl(
				notePath,
				result.path,
			);
			if (displayUrl) return displayUrl;
			return result.path;
		}
	} catch {
		// fall through to base64
	}
	return dataUrl;
}



type NoteEditorProps = {
	content: NoteContent;
	noteTitle: string;
	notePath: string | null;
	isActive?: boolean;
	pageFormat?: PageFormat;
	/** Optional override (e.g. popout always editable). When set, local toggle is ignored. */
	readOnly?: boolean;
	searchQuery: string;
	yDoc?: Y.Doc | null;
	zenMode?: boolean;
	onChange: (
		content: NoteContent,
		notePath: string | null,
		isUserEdit: boolean,
	) => void;
	onContentRendered?: (notePath: string) => void;
	onContentSnapshot?: (
		notePath: string | null,
		getContent: (() => NoteContent) | null,
	) => void;
	onRename: (title: string) => void;
	onTitleChange: (title: string) => void;
};

import type { PageFormat } from "@/lib/storage/types";

export type { PageFormat };

type TextAlignment = "left" | "center" | "right" | "justify";

type EditorFormatCommand =
	| "bold"
	| "italic"
	| "underline"
	| "strike"
	| "highlight"
	| "quote"
	| "code-block"
	| "typography-heading-1"
	| "typography-heading-2"
	| "typography-heading-3"
	| "typography-body"
	| "bullet-list"
	| "ordered-list"
	| "task-list"
	| "align-left"
	| "align-center"
	| "align-right"
	| "align-justify";

type LinkHover = {
	href: string;
	left: number;
	top: number;
};

type EmojiItem = {
	name: string;
	emoji: string;
};

const textColors = [
	"#ff6b6b",
	"#ff9f43",
	"#ffd43b",
	"#69db7c",
	"#38d9a9",
	"#4dabf7",
	"#b197fc",
	"#f783ac",
	"#e599f7",
	"#74c0fc",
];

const highlightColors = [
	"#fde047",
	"#fb923c",
	"#fb7185",
	"#86efac",
	"#5eead4",
	"#93c5fd",
	"#c4b5fd",
	"#f0abfc",
];

const emojiItems = [
	{ name: "smile", emoji: "😄" },
	{ name: "laugh", emoji: "😂" },
	{ name: "heart", emoji: "❤️" },
	{ name: "fire", emoji: "🔥" },
	{ name: "sparkles", emoji: "✨" },
	{ name: "thumbsup", emoji: "👍" },
	{ name: "check", emoji: "✅" },
	{ name: "eyes", emoji: "👀" },
	{ name: "thinking", emoji: "🤔" },
	{ name: "rocket", emoji: "🚀" },
] satisfies EmojiItem[];

const defaultPageFormat: PageFormat = {
	indentation: "none",
	lineHeight: "normal",
	paragraphSpacing: "none",
};

const collaborationField = "prosemirror";

/** Transaction origin for saved-content reconciliation (persisted like user edits). */
const yNoteReconcileOrigin = "paperite:y-note-reconcile";

const lowlight = createLowlight(common);

function createBaseExtensions() {
	return [
		StarterKit.configure({
			underline: false,
			undoRedo: false,
			codeBlock: false,
		}),
		CodeBlockLowlight.extend({
			addNodeView() {
				return ReactNodeViewRenderer(CodeBlockView);
			},
		}).configure({
			lowlight,
		}),
		Underline,
		TextStyle.configure({
			mergeNestedSpanStyles: true,
		}),
		Color,
		Highlight.configure({ multicolor: true }),
		Image.configure({
			allowBase64: true,
			HTMLAttributes: {
				class: "paperite-editor-image",
			},
			resize: {
				enabled: true,
				directions: ["left", "right", "bottom-left", "bottom-right"],
				minWidth: 120,
				minHeight: 80,
				alwaysPreserveAspectRatio: true,
			},
		}),
		Link.configure({
			autolink: true,
			defaultProtocol: "https",
			enableClickSelection: true,
			linkOnPaste: true,
			openOnClick: false,
			HTMLAttributes: {
				rel: "noopener noreferrer",
				target: null,
			},
		}),
		TextAlign.configure({
			types: ["heading", "paragraph"],
		}),
		TaskList,
		TaskItem.configure({
			nested: true,
		}),
	];
}

const alignCommands = [
	{
		command: "align-left",
		icon: AlignLeftIcon,
		label: "Align left",
		value: "left",
	},
	{
		command: "align-center",
		icon: AlignCenterIcon,
		label: "Align center",
		value: "center",
	},
	{
		command: "align-right",
		icon: AlignRightIcon,
		label: "Align right",
		value: "right",
	},
	{
		command: "align-justify",
		icon: AlignJustifyIcon,
		label: "Justify",
		value: "justify",
	},
] satisfies Array<{
	command: EditorFormatCommand;
	icon: ComponentType<{ className?: string }>;
	label: string;
	value: TextAlignment;
}>;

const blockStyleOptions = [
	{ value: "heading-1", label: "Heading 1", command: "typography-heading-1" },
	{ value: "heading-2", label: "Heading 2", command: "typography-heading-2" },
	{ value: "heading-3", label: "Heading 3", command: "typography-heading-3" },
	{ value: "body", label: "Body", command: "typography-body" },
] satisfies Array<{
	value: string;
	label: string;
	command: EditorFormatCommand;
}>;

export function NoteEditor({
	content,
	notePath,
	isActive = true,
	noteTitle,
	pageFormat = defaultPageFormat,
	readOnly: readOnlyProp,
	searchQuery,
	yDoc,
	zenMode,
	onChange,
	onContentRendered,
	onContentSnapshot,
	onRename,
	onTitleChange,
}: NoteEditorProps) {
	// View/edit is per mounted editor instance — not global app state.
	const [localReadOnly, setLocalReadOnly] = useState(false);
	const readOnly = readOnlyProp ?? localReadOnly;
	const [draftTitle, setDraftTitle] = useState(editableTitle(noteTitle));
	const [linkHover, setLinkHover] = useState<LinkHover | null>(null);
	const titleInputRef = useRef<HTMLTextAreaElement>(null);
	const notePathRef = useRef(notePath);
	const editorRef = useRef<TiptapEditor | null>(null);
	const onChangeRef = useRef(onChange);
	const readOnlyRef = useRef(readOnly);
	const localReadOnlyRef = useRef(localReadOnly);
	localReadOnlyRef.current = localReadOnly;

	// Header toggle lives outside this tree — register so it can flip this instance only.
	useEffect(() => {
		if (!notePath || readOnlyProp !== undefined) return;
		const listeners = new Set<(v: boolean) => void>();
		const controller: NoteReadOnlyController = {
			get: () => localReadOnlyRef.current,
			toggle: () => {
				setLocalReadOnly((prev) => {
					const next = !prev;
					for (const listener of listeners) listener(next);
					return next;
				});
			},
			subscribe: (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
		};
		noteReadOnlyControllers.set(notePath, controller);
		notifyNoteReadOnlyRegistry();
		return () => {
			if (noteReadOnlyControllers.get(notePath) === controller) {
				noteReadOnlyControllers.delete(notePath);
				notifyNoteReadOnlyRegistry();
			}
		};
	}, [notePath, readOnlyProp]);
	const searchQueryRef = useRef(searchQuery);
	const syncingExternalDocRef = useRef(false);
	const hasUserInteractedRef = useRef(false);
	const lastCommittedTitleRef = useRef(noteTitle || "");
	const [resolvedContent, setResolvedContent] = useState<NoteContent>(() => {
		const cleaned = normalizeNoteContent(content);
		const { id: _id, title: _title, ...editorReady } = cleaned;
		return editorReady as NoteContent;
	});

	useEffect(() => {
		if (!notePath || !window.electron?.notes.getAssetUrl) {
			const cleaned = normalizeNoteContent(content);
			const { id: _id, title: _title, ...editorReady } = cleaned;
			setResolvedContent(editorReady as NoteContent);
			return;
		}
		let cancelled = false;
		resolveImagePaths(notePath, content).then((resolved) => {
			if (cancelled) return;
			const cleaned = normalizeNoteContent(resolved);
			const { id: _id, title: _title, ...editorReady } = cleaned;
			setResolvedContent(editorReady as NoteContent);
		});
		return () => {
			cancelled = true;
		};
	}, [content, notePath]);

	const initialContentRef = useRef(resolvedContent);

	notePathRef.current = notePath;
	onChangeRef.current = onChange;
	readOnlyRef.current = readOnly;

	const resizeTitleInput = useCallback(() => {
		const textarea = titleInputRef.current;
		if (textarea) {
			textarea.style.height = "auto";
			textarea.style.height = `${textarea.scrollHeight}px`;
		}
	}, []);

	useEffect(() => {
		if (!isActive) return;
		requestAnimationFrame(resizeTitleInput);
	}, [isActive, resizeTitleInput]);

	const baseExtensions = useMemo(() => createBaseExtensions(), []);

	// The persisted note file is the source of truth. The collaboration
	// fragment can hold stale content (snapshot rewritten from disk, lost
	// merge, crash) and the old "seed only when empty" rule let that stale
	// fragment shadow newer saved content — the "Saved but gone" data loss.
	// Rebuild the fragment from the saved content whenever they diverge;
	// skipped once the user interacts so live edits are never clobbered by
	// async content resolution.
	useMemo(() => {
		if (!yDoc) return;
		if (hasUserInteractedRef.current) return;

		const fragment = yDoc.getXmlFragment(collaborationField);
		const schema = getSchema(baseExtensions);

		let fragmentMatches = false;
		try {
			const fragmentJson = yXmlFragmentToProsemirrorJSON(
				fragment,
			) as NoteContent;
			fragmentMatches =
				noteContentText(fragmentJson) === noteContentText(resolvedContent);
		} catch {
			fragmentMatches = false;
		}

		if (fragmentMatches) return;

		const importedDoc = prosemirrorJSONToYDoc(schema, resolvedContent);
		yDoc.transact(() => {
			if (fragment.length > 0) fragment.delete(0, fragment.length);
		}, yNoteReconcileOrigin);
		Y.applyUpdate(
			yDoc,
			Y.encodeStateAsUpdate(importedDoc),
			yNoteReconcileOrigin,
		);
	}, [baseExtensions, resolvedContent, yDoc]);

	const extensions = useMemo(
		() => [
			...baseExtensions,
			...(yDoc
				? [
						Collaboration.configure({
							document: yDoc,
							field: collaborationField,
						}),
					]
				: []),
			createTitleNavigationExtension(titleInputRef),
			createSearchHighlightExtension(searchQueryRef),
			createEmojiSuggestionExtension(),
		],
		[baseExtensions, yDoc],
	);

	const editor = useEditor({
		extensions,
		content: yDoc ? undefined : initialContentRef.current,
		editable: !readOnly,
		editorProps: {
			attributes: {
				"aria-label": "Note content",
				class: "paperite-prosemirror min-h-full outline-none",
			},
			handleDOMEvents: {
				keydown: () => {
					hasUserInteractedRef.current = true;
					return false;
				},
				mouseover: (_view, event) => {
					const target = event.target;
					if (!(target instanceof HTMLElement)) return false;

					const link = target.closest("a[href]");
					if (!(link instanceof HTMLAnchorElement)) return false;

					const rect = link.getBoundingClientRect();
					setLinkHover({
						href: link.href,
						left: rect.left + rect.width / 2,
						top: rect.top,
					});
					return false;
				},
			},
			handlePaste: (_view, event) => {
				if (readOnlyRef.current) return false;
				const path = notePathRef.current;
				if (!path) return false;

				const items = Array.from(event.clipboardData?.items ?? []);
				const imageItem = items.find((item) => item.type.startsWith("image/"));
				if (!imageItem) return false;

				const file = imageItem.getAsFile();
				if (!file) return false;

				event.preventDefault();
				hasUserInteractedRef.current = true;

				const reader = new FileReader();
				reader.addEventListener("load", async () => {
					if (typeof reader.result !== "string") return;
					const src = await saveImageToNote(
						path,
						reader.result,
						file.name || "image",
					);
					editorRef.current
						?.chain()
						.focus()
						.setImage({ src, alt: file.name })
						.run();
				});
				reader.readAsDataURL(file);
				return true;
			},
		},
		// Keep transaction re-renders off — toolbar subscribes itself, and
		// parent state must not update on every keystroke (see updateNoteContent).
		shouldRerenderOnTransaction: false,
		onUpdate: ({ editor: currentEditor }) => {
			if (syncingExternalDocRef.current) return;

			const raw = currentEditor.getJSON() as NoteContent;
			onChangeRef.current(
				denormalizeImagePaths(raw),
				notePathRef.current,
				hasUserInteractedRef.current,
			);
		},
	});

	editorRef.current = editor;

	useEffect(() => {
		if (!editor) return;
		if (yDoc) {
			if (notePath) requestAnimationFrame(() => onContentRendered?.(notePath));
			return;
		}

		const currentSerialized = serializeNoteContent(
			editor.getJSON() as NoteContent,
		);
		const nextSerialized = serializeNoteContent(resolvedContent);

		if (currentSerialized !== nextSerialized) {
			syncingExternalDocRef.current = true;
			try {
				editor.commands.setContent(resolvedContent, { emitUpdate: false });
			} finally {
				syncingExternalDocRef.current = false;
			}
		}

		if (notePath) requestAnimationFrame(() => onContentRendered?.(notePath));
	}, [resolvedContent, editor, notePath, onContentRendered, yDoc]);

	useLayoutEffect(() => {
		if (!editor || !notePath) {
			onContentSnapshot?.(null, null);
			return;
		}

		const getContent = () => denormalizeImagePaths(editor.getJSON() as NoteContent);
		onContentSnapshot?.(notePath, getContent);

		return () => onContentSnapshot?.(notePath, null);
	}, [editor, notePath, onContentSnapshot]);

	useEffect(() => {
		editor?.setEditable(!readOnly);
	}, [editor, readOnly]);

	useEffect(() => {
		searchQueryRef.current = searchQuery;
		if (!editor) return;

		editor.view.dispatch(editor.state.tr.setMeta("paperiteSearchQuery", true));
	}, [editor, searchQuery]);

	useEffect(() => {
		const handleFormat = (event: Event) => {
			const command = (event as CustomEvent<{ command?: EditorFormatCommand }>)
				.detail?.command;

			if (command && !readOnlyRef.current) runFormatCommand(editor, command);
		};

		window.addEventListener("paperite:editor-format", handleFormat);
		return () =>
			window.removeEventListener("paperite:editor-format", handleFormat);
	}, [editor]);

	useEffect(() => {
		setDraftTitle(editableTitle(noteTitle));
	}, [noteTitle]);

	useEffect(() => {
		if (!linkHover) return;

		const closeWhenAway = (event: globalThis.MouseEvent) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			if (target.closest("a[href], .paperite-link-hover-card")) return;
			setLinkHover(null);
		};

		window.addEventListener("mousemove", closeWhenAway);
		return () => window.removeEventListener("mousemove", closeWhenAway);
	}, [linkHover]);

	// Only focus when the empty canvas chrome is clicked. Clicks inside the
	// ProseMirror surface are handled natively — calling focus() again was
	// forcing selection updates (and parent re-renders) on every click.
	const focusEditorCanvas = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			if (!editor) return;
			if (event.target !== event.currentTarget) return;
			// The canvas padding sits outside ProseMirror, so a drag-select
			// released there lands here as a plain click. focus("end") would
			// collapse it — keep the selection and just restore focus.
			if (!editor.state.selection.empty) {
				editor.commands.focus();
				return;
			}
			editor.commands.focus("end");
		},
		[editor],
	);

	const commitTitle = () => {
		const nextTitle = draftTitle.trim();
		const committedTitle = lastCommittedTitleRef.current;
		// Sync chrome (tab label) once on blur — not per keystroke.
		onTitleChange(nextTitle || noteTitle || "Untitled");
		if (nextTitle && nextTitle !== committedTitle) {
			lastCommittedTitleRef.current = nextTitle;
			onRename(nextTitle);
		}
	};

	if (!notePath) {
		return (
			<div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
				Open a note from the sidebar.
			</div>
		);
	}

	return (
		<div className="relative flex min-h-0 flex-1 overflow-hidden">
			<div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto overscroll-contain">
				<div className="mx-auto flex w-full max-w-4xl flex-1 flex-col">
					{readOnly ? (
						<h1
							aria-label="Note title"
							className={`mx-8 mb-4 w-[calc(100%-4rem)] select-text text-3xl font-semibold leading-tight tracking-normal md:mx-14 md:w-[calc(100%-7rem)] lg:mx-20 lg:w-[calc(100%-10rem)] ${zenMode ? "mt-16 md:mt-20" : "mt-10"}`}
						>
							{draftTitle.trim() || "Untitled"}
						</h1>
					) : (
						<textarea
							ref={titleInputRef}
							value={draftTitle}
							aria-label="Note title"
							className={`mx-8 mb-4 w-[calc(100%-4rem)] resize-none bg-transparent text-3xl font-semibold leading-tight tracking-normal outline-none placeholder:text-muted-foreground md:mx-14 md:w-[calc(100%-7rem)] lg:mx-20 lg:w-[calc(100%-10rem)] ${zenMode ? "mt-16 md:mt-20" : "mt-10"}`}
							rows={1}
							placeholder="Untitled"
							onBlur={commitTitle}
							onInput={(event) => {
								const textarea = event.currentTarget;
								textarea.style.height = "auto";
								textarea.style.height = `${textarea.scrollHeight}px`;
							}}
							onChange={(event) => {
								setDraftTitle(event.target.value);
								// Live tab/sidebar labels via lightweight draft store (not Index state).
								onTitleChange(event.target.value);
								const textarea = event.currentTarget;
								textarea.style.height = "auto";
								textarea.style.height = `${textarea.scrollHeight}px`;
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									event.currentTarget.blur();
								}
								if (event.key === "ArrowDown") {
									event.preventDefault();
									editor?.commands.focus();
								}
								if (event.key === "Escape") {
									const currentFileTitle = noteTitle || "Untitled";
									setDraftTitle(editableTitle(currentFileTitle));
									onTitleChange(currentFileTitle);
									event.currentTarget.blur();
								}
							}}
						/>
					)}
					<ContextMenu>
						<ContextMenuTrigger asChild>
							<div
								role="application"
								tabIndex={0}
								className={cn(
									"paperite-tiptap flex min-h-0 flex-1 select-text px-8 pb-44 md:px-14 lg:px-20",
									pageFormat.lineHeight === "1.5" &&
										"paperite-tiptap-leading-compact",
									pageFormat.paragraphSpacing === "none" &&
										"paperite-tiptap-spacing-none",
									pageFormat.indentation === "first-line" &&
										"paperite-tiptap-indent-first-line",
									pageFormat.indentation === "hanging" &&
										"paperite-tiptap-indent-hanging",
								)}
								onClick={readOnly ? undefined : focusEditorCanvas}
								onKeyDown={
									readOnly ? undefined : () => editor?.commands.focus()
								}
							>
								<EditorContent editor={editor} className="min-h-full flex-1" />
							</div>
						</ContextMenuTrigger>
						<ContextMenuContent className="w-52">
							<ContextMenuGroup className="grid grid-cols-4 gap-0.5">
								<ContextMenuFormatItem
									editor={editor}
									readOnly={readOnly}
									label="Bold"
									title="Bold (⌘B)"
									mark="bold"
									icon={BoldIcon}
									command={(instance) => instance.chain().focus().toggleBold().run()}
								/>
								<ContextMenuFormatItem
									editor={editor}
									readOnly={readOnly}
									label="Italic"
									title="Italic (⌘I)"
									mark="italic"
									icon={ItalicIcon}
									command={(instance) => instance.chain().focus().toggleItalic().run()}
								/>
								<ContextMenuFormatItem
									editor={editor}
									readOnly={readOnly}
									label="Underline"
									title="Underline (⌘U)"
									mark="underline"
									icon={UnderlineIcon}
									command={(instance) => instance.chain().focus().toggleUnderline().run()}
								/>
								<ContextMenuFormatItem
									editor={editor}
									readOnly={readOnly}
									label="Strikethrough"
									title="Strikethrough (⌘⇧X)"
									mark="strike"
									icon={StrikethroughIcon}
									command={(instance) => instance.chain().focus().toggleStrike().run()}
								/>
							</ContextMenuGroup>
							<ContextMenuSeparator />
							<ContextMenuItem
								disabled={readOnly}
								onSelect={() => {
									editor?.commands.focus();
									document.execCommand("cut");
								}}
							>
								Cut
								<ContextMenuShortcut>⌘X</ContextMenuShortcut>
							</ContextMenuItem>
							<ContextMenuItem
								onSelect={() => {
									editor?.commands.focus();
									document.execCommand("copy");
								}}
							>
								Copy
								<ContextMenuShortcut>⌘C</ContextMenuShortcut>
							</ContextMenuItem>
							<ContextMenuItem
								disabled={readOnly}
								onSelect={() => {
									editor?.commands.focus();
									document.execCommand("paste");
								}}
							>
								Paste
								<ContextMenuShortcut>⌘V</ContextMenuShortcut>
							</ContextMenuItem>
							<ContextMenuItem
								onSelect={() => {
								editor?.chain().focus().selectAll().run();
							}}
							>
								Select all
								<ContextMenuShortcut>⌘A</ContextMenuShortcut>
							</ContextMenuItem>
							<ContextMenuSeparator />
							<ContextMenuItem
								disabled={readOnly}
								onSelect={() => editor?.chain().focus().toggleHighlight().run()}
							>
								Highlight
							</ContextMenuItem>
							<ContextMenuItem
								disabled={readOnly}
								onSelect={() => editor?.chain().focus().toggleBlockquote().run()}
							>
								Quote
							</ContextMenuItem>
							<ContextMenuItem
								disabled={readOnly}
								onSelect={() => editor?.chain().focus().toggleCodeBlock().run()}
							>
								Code block
							</ContextMenuItem>
						</ContextMenuContent>
					</ContextMenu>
				</div>
				<div className="pointer-events-none absolute right-0 bottom-0 left-0 z-20 h-24 bg-gradient-to-t from-background via-background/80 to-transparent" />
				{editor && !readOnly ? (
					<FormatMenu editor={editor} notePath={notePath} />
				) : null}
			</div>
			{linkHover ? (
				<LinkHoverCard hover={linkHover} onClose={() => setLinkHover(null)} />
			) : null}
		</div>
	);
}

function ContextMenuFormatItem({
		editor,
		readOnly,
		label,
		title,
		mark,
		icon: Icon,
		command,
}: {
	editor: TiptapEditor;
	readOnly: boolean;
	label: string;
	title: string;
	mark: "bold" | "italic" | "underline" | "strike";
	icon: ComponentType<{ className?: string }>;
	command: (editor: TiptapEditor) => boolean;
}) {
	const active = useEditorState({
		editor,
		selector: ({ editor: instance }) => instance.isActive(mark),
	}) ?? false;

	return (
		<ContextMenuItem
			disabled={readOnly}
			aria-label={label}
			title={title}
			data-active={active}
			className="justify-center px-2 py-1.5 data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:ring-1 data-[active=true]:ring-primary/50 data-[active=true]:focus:bg-primary"
			onSelect={() => command(editor)}
		>
			<Icon className="size-4" />
		</ContextMenuItem>
	);
}

function FormatMenu({
	editor,
	notePath,
}: {
	editor: TiptapEditor;
	notePath: string | null;
}) {
	const imageInputRef = useRef<HTMLInputElement>(null);
	const savedTextSelectionRef = useRef<{ from: number; to: number } | null>(
		null,
	);

	// Subscribe only to the specific active-mark/node booleans the toolbar
	// buttons need. This re-renders FormatMenu (and only FormatMenu — never
	// the note title, EditorContent, or Index) when one of these actually
	// changes, instead of on every transaction/selection event.
	const toolbarState = useEditorState({
		editor,
		selector: (ctx) => ({
			bold: ctx.editor.isActive("bold"),
			italic: ctx.editor.isActive("italic"),
			underline: ctx.editor.isActive("underline"),
			strike: ctx.editor.isActive("strike"),
			highlight: ctx.editor.isActive("highlight"),
			highlightColor: ctx.editor.isActive("highlight")
				? (ctx.editor.getAttributes("highlight").color as string | undefined)
				: undefined,
			textColor: ctx.editor.getAttributes("textStyle").color as
				| string
				| undefined,
			blockquote: ctx.editor.isActive("blockquote"),
			codeBlock: ctx.editor.isActive("codeBlock"),
			heading1: ctx.editor.isActive("heading", { level: 1 }),
			heading2: ctx.editor.isActive("heading", { level: 2 }),
			heading3: ctx.editor.isActive("heading", { level: 3 }),
			paragraph: ctx.editor.isActive("paragraph"),
			bulletList: ctx.editor.isActive("bulletList"),
			orderedList: ctx.editor.isActive("orderedList"),
			taskList: ctx.editor.isActive("taskList"),
			alignLeft: ctx.editor.isActive({ textAlign: "left" }),
			alignCenter: ctx.editor.isActive({ textAlign: "center" }),
			alignRight: ctx.editor.isActive({ textAlign: "right" }),
			alignJustify: ctx.editor.isActive({ textAlign: "justify" }),
		}),
	}) ?? {
		bold: false,
		italic: false,
		underline: false,
		strike: false,
		highlight: false,
		highlightColor: undefined as string | undefined,
		textColor: undefined as string | undefined,
		blockquote: false,
		codeBlock: false,
		heading1: false,
		heading2: false,
		heading3: false,
		paragraph: false,
		bulletList: false,
		orderedList: false,
		taskList: false,
		alignLeft: false,
		alignCenter: false,
		alignRight: false,
		alignJustify: false,
	};

	useEffect(() => {
		const rememberSelection = () => {
			const { from, to, empty } = editor.state.selection;
			if (!empty && from !== to) savedTextSelectionRef.current = { from, to };
		};

		rememberSelection();
		editor.on("selectionUpdate", rememberSelection);
		return () => {
			editor.off("selectionUpdate", rememberSelection);
		};
	}, [editor]);

	const [imagePopoverOpen, setImagePopoverOpen] = useState(false);
	const [isDragOver, setIsDragOver] = useState(false);

	const insertImage = (file: File) => {
		if (!file.type.startsWith("image/")) return;
		if (!notePath) return;
		const reader = new FileReader();
		reader.addEventListener("load", async () => {
			if (typeof reader.result !== "string") return;
			const src = await saveImageToNote(
				notePath,
				reader.result,
				file.name || "image",
			);
			editor
				.chain()
				.focus()
				.setImage({ src, alt: file.name })
				.run();
			setImagePopoverOpen(false);
		});
		reader.readAsDataURL(file);
	};

	const uploadImage = (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (file) insertImage(file);
	};

	const handlePaste = async () => {
		try {
			const clipboardItems = await navigator.clipboard.read();
			for (const item of clipboardItems) {
				for (const type of item.types) {
					if (type.startsWith("image/")) {
						const blob = await item.getType(type);
						const file = new File(
							[blob],
							`pasted-image.${blob.type.split("/")[1]}`,
							{ type: blob.type },
						);
						insertImage(file);
						return;
					}
				}
			}
		} catch {
			// clipboard access might fail, silently ignore
		}
	};

	const handleDragOver = (e: DragEvent) => {
		e.preventDefault();
		setIsDragOver(true);
	};
	const handleDragLeave = () => setIsDragOver(false);
	const handleDrop = (e: DragEvent) => {
		e.preventDefault();
		setIsDragOver(false);
		const file = e.dataTransfer.files[0];
		if (file) insertImage(file);
	};

	return (
		<div className="sticky right-0 bottom-4 left-0 z-30 mx-auto mt-[-3rem] w-full max-w-4xl px-8 md:px-14 lg:px-20">
			<div
				className="app-region-no-drag no-scrollbar flex w-full items-center gap-1 overflow-x-auto overflow-y-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-[0_12px_36px_rgb(0_0_0/0.22),0_0_0_1px_rgb(255_255_255/0.08)] ring-1 ring-foreground/10 [&>*]:shrink-0"
				onPointerDown={(event) => event.stopPropagation()}
			>
				<BlockStyleSelect
					editor={editor}
					toolbarState={toolbarState}
				/>
				<span className="mx-0.5 h-5 w-px bg-border" />
				<FormatButton
					label="Bold"
					icon={BoldIcon}
					command="bold"
					editor={editor}
					active={toolbarState.bold}
				/>
				<FormatButton
					label="Italic"
					icon={ItalicIcon}
					command="italic"
					editor={editor}
					active={toolbarState.italic}
				/>
				<FormatButton
					label="Underline"
					icon={UnderlineIcon}
					command="underline"
					editor={editor}
					active={toolbarState.underline}
				/>
				<FormatButton
					label="Strikethrough"
					icon={StrikethroughIcon}
					command="strike"
					editor={editor}
					active={toolbarState.strike}
				/>
				<span className="mx-0.5 h-5 w-px bg-border" />
				<ColorMenu
					editor={editor}
					label="Highlight"
					icon={HighlighterIcon}
					mode="highlight"
					colors={highlightColors}
					savedSelectionRef={savedTextSelectionRef}
					active={toolbarState.highlight}
				/>
				<ColorMenu
					editor={editor}
					label="Text color"
					mode="text-color"
					colors={textColors}
					savedSelectionRef={savedTextSelectionRef}
					active={!!toolbarState.textColor}
				/>
				<span className="mx-0.5 h-5 w-px bg-border" />
				<FormatButton
					label="Quote"
					icon={QuoteIcon}
					command="quote"
					editor={editor}
					active={toolbarState.blockquote}
				/>
				<FormatButton
					label="Code block"
					icon={Code2Icon}
					command="code-block"
					editor={editor}
					active={toolbarState.codeBlock}
				/>
				<Popover open={imagePopoverOpen} onOpenChange={setImagePopoverOpen}>
					<ToolbarTooltip label="Upload image">
						<PopoverTrigger asChild>
							<button
								type="button"
								aria-label="Upload image"
								className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,scale] active:scale-[0.96] hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
								onMouseDown={(event) => event.preventDefault()}
							>
								<ImagePlusIcon className="size-4" />
							</button>
						</PopoverTrigger>
					</ToolbarTooltip>
					<PopoverContent
						align="center"
						side="top"
						sideOffset={8}
						onOpenAutoFocus={(e) => e.preventDefault()}
						className="w-64 p-0"
					>
						<div
							className={cn(
								"flex flex-col items-center gap-3 p-4 text-center transition-colors",
								isDragOver && "bg-muted/50",
							)}
							onDragOver={handleDragOver}
							onDragLeave={handleDragLeave}
							onDrop={handleDrop}
						>
							<div className="flex size-10 items-center justify-center rounded-full bg-muted">
								<UploadIcon className="size-5 text-muted-foreground" />
							</div>
							<div className="space-y-1">
								<p className="text-sm font-medium">
									{isDragOver ? "Drop image here" : "Drag & drop an image"}
								</p>
								<p className="text-xs text-muted-foreground">
									or click below to browse
								</p>
							</div>
							<div className="flex w-full gap-2">
								<Button
									variant="outline"
									size="xs"
									className="flex-1"
									onClick={() => imageInputRef.current?.click()}
								>
									<ImagePlusIcon className="size-3.5" />
									Browse
								</Button>
								<Button
									variant="outline"
									size="xs"
									className="flex-1"
									onClick={handlePaste}
								>
									<ClipboardPasteIcon className="size-3.5" />
									Paste
								</Button>
							</div>
						</div>
					</PopoverContent>
				</Popover>
				<input
					ref={imageInputRef}
					type="file"
					accept="image/*"
					className="hidden"
					onChange={uploadImage}
				/>
				<span className="mx-0.5 h-5 w-px bg-border" />
				{alignCommands.map(({ command, icon, label }) => {
					const active =
						command === "align-left"
							? toolbarState.alignLeft
							: command === "align-center"
								? toolbarState.alignCenter
								: command === "align-right"
									? toolbarState.alignRight
									: toolbarState.alignJustify;
					return (
						<FormatButton
							key={command}
							label={label}
							icon={icon}
							command={command}
							editor={editor}
							active={active}
						/>
					);
				})}
				<span className="mx-0.5 h-5 w-px bg-border" />
				<FormatButton
					label="Bullet list"
					icon={ListIcon}
					command="bullet-list"
					editor={editor}
					active={toolbarState.bulletList}
				/>
				<FormatButton
					label="Numbered list"
					icon={ListOrderedIcon}
					command="ordered-list"
					editor={editor}
					active={toolbarState.orderedList}
				/>
				<FormatButton
					label="Checkbox"
					icon={ListTodoIcon}
					command="task-list"
					editor={editor}
					active={toolbarState.taskList}
				/>
			</div>
		</div>
	);
}

function ColorMenu({
	colors,
	disabled = false,
	editor,
	icon: Icon,
	label,
	mode,
	savedSelectionRef,
	active,
}: {
	colors: string[];
	disabled?: boolean;
	editor: TiptapEditor;
	icon?: ComponentType<{ className?: string }>;
	label: string;
	mode: "highlight" | "text-color";
	savedSelectionRef: RefObject<{ from: number; to: number } | null>;
	active: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [selectedColor, setSelectedColor] = useState(colors[0]);
	const [dropupPosition, setDropupPosition] = useState({ left: 0, top: 0 });
	const triggerRef = useRef<HTMLButtonElement>(null);

	const updateDropupPosition = useCallback(() => {
		const rect = triggerRef.current?.getBoundingClientRect();
		if (!rect) return;

		setDropupPosition({
			left: rect.left,
			top: rect.top - 8,
		});
	}, []);

	useLayoutEffect(() => {
		if (!open) return;

		updateDropupPosition();
		window.addEventListener("resize", updateDropupPosition);
		window.addEventListener("scroll", updateDropupPosition, true);

		return () => {
			window.removeEventListener("resize", updateDropupPosition);
			window.removeEventListener("scroll", updateDropupPosition, true);
		};
	}, [open, updateDropupPosition]);

	const selectionRange = () => {
		const { from, to, empty } = editor.state.selection;
		if (!empty && from !== to) return { from, to };
		return savedSelectionRef.current;
	};

	const applyColor = (color: string) => {
		const range = selectionRange();
		const chain = editor.chain().focus();
		if (range) chain.setTextSelection(range);

		if (mode === "highlight") {
			const currentHighlight = editor.isActive("highlight")
				? editor.getAttributes("highlight")
				: null;
			const currentColor = currentHighlight?.color;

			if (currentColor === color) {
				chain.extendMarkRange("highlight").unsetHighlight().run();
				return;
			}

			chain.extendMarkRange("highlight").setHighlight({ color }).run();
			return;
		}

		const currentColor = editor.getAttributes("textStyle").color;
		if (currentColor === color) {
			chain.extendMarkRange("textStyle").unsetColor().run();
			return;
		}

		chain.extendMarkRange("textStyle").setColor(color).run();
	};

	const applySelectedColor = () => applyColor(selectedColor);

	const clearColor = () => {
		const range = selectionRange();
		const chain = editor.chain().focus();
		if (range) chain.setTextSelection(range);

		if (mode === "highlight") {
			chain.extendMarkRange("highlight").unsetHighlight().run();
			return;
		}

		chain.extendMarkRange("textStyle").unsetColor().run();
	};

	return (
		<div className="relative flex shrink-0 overflow-visible rounded-md">
			<ToolbarTooltip label={label}>
				<button
					type="button"
					aria-label={label}
					data-active={active}
					disabled={disabled}
					className="flex size-8 items-center justify-center rounded-l-md text-muted-foreground transition-[background-color,color,scale] active:scale-[0.96] hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[active=true]:bg-muted data-[active=true]:text-foreground"
					onMouseDown={(event) => event.preventDefault()}
					onClick={applySelectedColor}
				>
					{Icon ? (
						<Icon className="size-4" />
					) : (
						<span
							className="flex size-4 flex-col items-center justify-center font-semibold text-[13px] leading-none text-foreground"
							aria-hidden="true"
						>
							A
							<span
								className="mt-0.5 h-0.5 w-3 rounded-full"
								style={{ backgroundColor: selectedColor }}
							/>
						</span>
					)}
				</button>
			</ToolbarTooltip>
			<ToolbarTooltip label={`${label} options`}>
				<button
					ref={triggerRef}
					type="button"
					aria-label={`${label} options`}
					data-active={active}
					disabled={disabled}
					className="flex h-8 w-4 items-center justify-center rounded-r-md text-muted-foreground transition-[background-color,color,scale] active:scale-[0.96] hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[active=true]:bg-muted data-[active=true]:text-foreground"
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => {
						updateDropupPosition();
						setOpen((current) => !current);
					}}
				>
					<ChevronUpIcon className="size-3" />
				</button>
			</ToolbarTooltip>
			{open ? (
				<div
					className="fixed z-50 w-40 -translate-y-full rounded-lg bg-popover p-2 shadow-lg ring-1 ring-foreground/10"
					style={{
						left: dropupPosition.left,
						top: dropupPosition.top,
					}}
				>
					<div className="grid grid-cols-5 gap-1.5">
						{colors.map((color) => (
							<button
								type="button"
								key={color}
								aria-label={`${label} ${color}`}
								className="size-6 rounded-md shadow-[inset_0_0_0_1px_rgb(255_255_255/0.16)] transition-transform active:scale-[0.96]"
								style={{ backgroundColor: color }}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => {
									setSelectedColor(color);
									applyColor(color);
									setOpen(false);
								}}
							/>
						))}
					</div>
					<button
						type="button"
						className="mt-2 h-7 w-full rounded-md text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => {
							clearColor();
							setSelectedColor(colors[0]);
							setOpen(false);
						}}
					>
						Unset {mode === "highlight" ? "highlight" : "color"}
					</button>
				</div>
			) : null}
		</div>
	);
}

function BlockStyleSelect({
	editor,
	disabled = false,
	toolbarState,
}: {
	editor: TiptapEditor;
	disabled?: boolean;
	toolbarState: {
		heading1: boolean;
		heading2: boolean;
		heading3: boolean;
		paragraph: boolean;
	};
}) {
	const value = toolbarState.heading1
		? "heading-1"
		: toolbarState.heading2
			? "heading-2"
			: toolbarState.heading3
				? "heading-3"
				: "body";

	return (
		<Select
			disabled={disabled}
			value={value}
			onValueChange={(value) => {
				const command = blockStyleOptions.find(
					(option) => option.value === value,
				)?.command;

				if (command) runFormatCommand(editor, command);
			}}
		>
			<SelectTrigger aria-label="Block style" className="w-30 shrink-0">
				<SelectValue />
			</SelectTrigger>
			<SelectContent align="start" side="top" sideOffset={8}>
				{blockStyleOptions.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function FormatButton({
	label,
	icon: Icon,
	command,
	editor,
	disabled = false,
	active,
}: {
	label: string;
	icon: ComponentType<{ className?: string }>;
	command: EditorFormatCommand;
	editor: TiptapEditor;
	disabled?: boolean;
	active: boolean;
}) {

	return (
		<ToolbarTooltip label={label}>
			<button
				type="button"
				aria-label={label}
				data-active={active}
				disabled={disabled}
				className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,scale] active:scale-[0.96] hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[active=true]:bg-muted data-[active=true]:text-foreground"
				onMouseDown={(event) => event.preventDefault()}
				onClick={() => runFormatCommand(editor, command)}
			>
				<Icon className="size-4" />
			</button>
		</ToolbarTooltip>
	);
}

function ToolbarTooltip({
	children,
	label,
}: {
	children: ReactNode;
	label: string;
}) {
	return (
		<HoverCard openDelay={400} closeDelay={100}>
			<HoverCardTrigger asChild>{children}</HoverCardTrigger>
			<HoverCardContent
				side="top"
				sideOffset={8}
				className="w-auto px-2 py-1 text-xs font-medium"
			>
				{label}
			</HoverCardContent>
		</HoverCard>
	);
}

function runFormatCommand(
	editor: TiptapEditor | null,
	command: EditorFormatCommand,
) {
	if (!editor) return;

	if (command === "bold") return editor.chain().focus().toggleBold().run();
	if (command === "italic") return editor.chain().focus().toggleItalic().run();
	if (command === "underline") {
		return editor.chain().focus().toggleUnderline().run();
	}
	if (command === "strike") return editor.chain().focus().toggleStrike().run();
	if (command === "highlight") {
		return editor.chain().focus().toggleHighlight().run();
	}
	if (command === "quote") {
		return editor.chain().focus().toggleBlockquote().run();
	}
	if (command === "code-block") {
		return editor.chain().focus().toggleCodeBlock().run();
	}
	if (command === "typography-heading-1") {
		return editor.chain().focus().setHeading({ level: 1 }).run();
	}
	if (command === "typography-heading-2") {
		return editor.chain().focus().setHeading({ level: 2 }).run();
	}
	if (command === "typography-heading-3") {
		return editor.chain().focus().setHeading({ level: 3 }).run();
	}
	if (command === "typography-body") {
		return editor.chain().focus().setParagraph().run();
	}
	if (command === "bullet-list") {
		return editor.chain().focus().toggleBulletList().run();
	}
	if (command === "ordered-list") {
		return editor.chain().focus().toggleOrderedList().run();
	}
	if (command === "task-list") {
		return editor.chain().focus().toggleTaskList().run();
	}

	return editor
		.chain()
		.focus()
		.setTextAlign(command.replace("align-", "") as TextAlignment)
		.run();
}

function LinkHoverCard({
	hover,
	onClose,
}: {
	hover: LinkHover;
	onClose: () => void;
}) {
	return (
		<div
			role="tooltip"
			className="paperite-link-hover-card fixed z-50 w-64 -translate-x-1/2 -translate-y-full pb-2"
			style={{ left: hover.left, top: hover.top }}
			onMouseLeave={onClose}
		>
			<div className="rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10">
				<div className="truncate pb-2 text-xs text-muted-foreground">
					{hover.href}
				</div>
				<button
					type="button"
					className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-[opacity,scale] active:scale-[0.96] hover:opacity-90"
					onClick={() => window.electron?.openExternal(hover.href)}
				>
					<ExternalLinkIcon className="size-3.5" />
					Open in browser
				</button>
			</div>
		</div>
	);
}

function createEmojiSuggestionExtension() {
	return Extension.create({
		name: "paperiteEmojiSuggestion",
		addProseMirrorPlugins() {
			return [
				Suggestion<EmojiItem>({
					editor: this.editor,
					char: ":",
					pluginKey: new PluginKey("paperiteEmojiSuggestion"),
					items: ({ query }) => {
						const normalizedQuery = query.toLocaleLowerCase();
						return emojiItems
							.filter((item) => item.name.startsWith(normalizedQuery))
							.slice(0, 6);
					},
					command: ({ editor, range, props }) => {
						editor
							.chain()
							.focus()
							.deleteRange(range)
							.insertContent(props.emoji)
							.run();
					},
					render: createEmojiSuggestionRenderer,
				}),
			];
		},
	});
}

function createEmojiSuggestionRenderer() {
	let element: HTMLDivElement | null = null;
	let props: SuggestionProps<EmojiItem> | null = null;
	let selectedIndex = 0;

	const update = (nextProps: SuggestionProps<EmojiItem>) => {
		props = nextProps;
		selectedIndex = Math.min(
			selectedIndex,
			Math.max(nextProps.items.length - 1, 0),
		);
		if (!element) return;

		const rect = nextProps.clientRect?.();
		if (rect) {
			element.style.left = `${rect.left}px`;
			element.style.top = `${rect.bottom + 6}px`;
		}

		element.innerHTML = "";
		for (const [index, item] of nextProps.items.entries()) {
			const button = document.createElement("button");
			button.type = "button";
			button.className =
				"flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted";
			if (index === selectedIndex) button.dataset.active = "true";
			button.innerHTML = `<span>${item.emoji}</span><span>${item.name}</span>`;
			button.addEventListener("mousedown", (event) => event.preventDefault());
			button.addEventListener("click", () => nextProps.command(item));
			element.appendChild(button);
		}
	};

	return {
		onStart: (nextProps: SuggestionProps<EmojiItem>) => {
			element = document.createElement("div");
			element.className =
				"paperite-emoji-menu fixed z-50 w-40 rounded-lg bg-popover p-1.5 text-popover-foreground shadow-lg ring-1 ring-foreground/10";
			document.body.appendChild(element);
			update(nextProps);
		},
		onUpdate: update,
		onKeyDown: ({ event }: { event: KeyboardEvent }) => {
			if (!props?.items.length) return false;

			if (event.key === "ArrowDown") {
				selectedIndex = (selectedIndex + 1) % props.items.length;
				update(props);
				return true;
			}

			if (event.key === "ArrowUp") {
				selectedIndex =
					(selectedIndex - 1 + props.items.length) % props.items.length;
				update(props);
				return true;
			}

			if (event.key === "Enter") {
				props.command(props.items[selectedIndex]);
				return true;
			}

			return false;
		},
		onExit: () => {
			element?.remove();
			element = null;
			props = null;
			selectedIndex = 0;
		},
	};
}

function createTitleNavigationExtension(
	titleInputRef: RefObject<HTMLTextAreaElement | null>,
) {
	return Extension.create({
		name: "paperiteTitleNavigation",
		addKeyboardShortcuts() {
			return {
				ArrowUp: () => {
					if (this.editor.state.selection.from > 1) return false;

					titleInputRef.current?.focus();
					return true;
				},
			};
		},
	});
}

function createSearchHighlightExtension(searchQueryRef: RefObject<string>) {
	return Extension.create({
		name: "paperiteSearchHighlight",
		addProseMirrorPlugins() {
			return [
				new Plugin({
					props: {
						decorations: (state) =>
							buildSearchDecorations(state.doc, searchQueryRef.current),
					},
				}),
			];
		},
	});
}

function buildSearchDecorations(
	doc: Parameters<typeof DecorationSet.create>[0],
	query: string,
) {
	const trimmedQuery = query.trim();
	if (!trimmedQuery) return DecorationSet.empty;

	const decorations: Decoration[] = [];
	const normalizedQuery = trimmedQuery.toLocaleLowerCase();

	doc.descendants((node, position) => {
		if (!node.isText || !node.text) return;

		const normalizedText = node.text.toLocaleLowerCase();
		let matchIndex = normalizedText.indexOf(normalizedQuery);

		while (matchIndex !== -1) {
			decorations.push(
				Decoration.inline(
					position + matchIndex,
					position + matchIndex + trimmedQuery.length,
					{ class: "paperite-search-match" },
				),
			);
			matchIndex = normalizedText.indexOf(
				normalizedQuery,
				matchIndex + normalizedQuery.length,
			);
		}
	});

	return DecorationSet.create(doc, decorations);
}

function editableTitle(title: string) {
	return title === "Untitled" ? "" : title;
}
