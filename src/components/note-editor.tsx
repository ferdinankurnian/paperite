import {
	Extension,
	getSchema,
	type Editor as TiptapEditor,
} from "@tiptap/core";
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
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import {
	AlignCenterIcon,
	AlignJustifyIcon,
	AlignLeftIcon,
	AlignRightIcon,
	BoldIcon,
	ChevronUpIcon,
	Code2Icon,
	HighlighterIcon,
	ImagePlusIcon,
	ItalicIcon,
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { normalizeNoteContent, serializeNoteContent } from "@/lib/note-content";
import { cn } from "@/lib/utils";

type NoteEditorProps = {
	content: NoteContent;
	noteTitle: string;
	notePath: string | null;
	pageFormat?: PageFormat;
	readOnly: boolean;
	searchQuery: string;
	yDoc?: Y.Doc | null;
	zenMode?: boolean;
	onChange: (content: NoteContent, notePath: string | null) => void;
	onContentRendered?: (notePath: string) => void;
	onContentSnapshot?: (
		notePath: string | null,
		getContent: (() => NoteContent) | null,
	) => void;
	onRename: (title: string) => void;
	onTitleChange: (title: string) => void;
};

export type PageFormat = {
	firstLineIndent: boolean;
	lineHeight: "normal" | "1.5";
	paragraphSpacing: "default" | "compact";
};

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
	firstLineIndent: false,
	lineHeight: "normal",
	paragraphSpacing: "default",
};

const collaborationField = "prosemirror";

function createBaseExtensions() {
	return [
		StarterKit.configure({ underline: false }),
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
	noteTitle,
	pageFormat = defaultPageFormat,
	readOnly,
	searchQuery,
	yDoc,
	zenMode,
	onChange,
	onContentRendered,
	onContentSnapshot,
	onRename,
	onTitleChange,
}: NoteEditorProps) {
	const [draftTitle, setDraftTitle] = useState(editableTitle(noteTitle));
	const [, setToolbarVersion] = useState(0);
	const [linkHover, setLinkHover] = useState<LinkHover | null>(null);
	const titleInputRef = useRef<HTMLTextAreaElement>(null);
	const notePathRef = useRef(notePath);
	const onChangeRef = useRef(onChange);
	const readOnlyRef = useRef(readOnly);
	const searchQueryRef = useRef(searchQuery);
	const syncingExternalDocRef = useRef(false);
	const editorContent = useMemo(() => {
		const cleaned = normalizeNoteContent(content);
		const { id: _id, title: _title, ...editorReady } = cleaned;
		return editorReady as NoteContent;
	}, [content]);

	const initialContentRef = useRef(editorContent);

	notePathRef.current = notePath;
	onChangeRef.current = onChange;
	readOnlyRef.current = readOnly;

	useEffect(() => {
		const textarea = titleInputRef.current;
		if (textarea) {
			textarea.style.height = "auto";
			textarea.style.height = `${textarea.scrollHeight}px`;
		}
	}, []);

	const baseExtensions = useMemo(() => createBaseExtensions(), []);

	useMemo(() => {
		if (!yDoc) return;
		if (yDoc.getXmlFragment(collaborationField).length > 0) return;

		const schema = getSchema(baseExtensions);
		const importedDoc = prosemirrorJSONToYDoc(schema, editorContent);
		Y.applyUpdate(yDoc, Y.encodeStateAsUpdate(importedDoc));
	}, [baseExtensions, editorContent, yDoc]);

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
		},
		onSelectionUpdate: () => setToolbarVersion((version) => version + 1),
		onUpdate: ({ editor: currentEditor }) => {
			if (syncingExternalDocRef.current) return;

			onChangeRef.current(
				currentEditor.getJSON() as NoteContent,
				notePathRef.current,
			);
			setToolbarVersion((version) => version + 1);
		},
	});

	useEffect(() => {
		if (!editor) return;
		const currentSerialized = serializeNoteContent(
			editor.getJSON() as NoteContent,
		);
		const nextSerialized = serializeNoteContent(editorContent);

		if (currentSerialized !== nextSerialized) {
			syncingExternalDocRef.current = true;
			try {
				editor.commands.setContent(editorContent, { emitUpdate: false });
			} finally {
				syncingExternalDocRef.current = false;
			}
		}

		if (notePath) requestAnimationFrame(() => onContentRendered?.(notePath));
	}, [editorContent, editor, notePath, onContentRendered]);

	useLayoutEffect(() => {
		if (!editor || !notePath) {
			onContentSnapshot?.(null, null);
			return;
		}

		const getContent = () => editor.getJSON() as NoteContent;
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

	const focusEditorCanvas = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			if (!editor) return;

			if (event.target === event.currentTarget) {
				editor.commands.focus("end");
				return;
			}

			editor.commands.focus();
		},
		[editor],
	);

	const commitTitle = () => {
		const nextTitle = draftTitle.trim();
		const currentTitle = noteTitle || "";
		if (nextTitle && nextTitle !== currentTitle) onRename(nextTitle);
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
					<textarea
						ref={titleInputRef}
						value={draftTitle}
						aria-label="Note title"
						className={`mx-8 mb-4 w-[calc(100%-4rem)] resize-none bg-transparent text-3xl font-semibold leading-tight tracking-normal outline-none placeholder:text-muted-foreground md:mx-14 md:w-[calc(100%-7rem)] lg:mx-20 lg:w-[calc(100%-10rem)] ${zenMode ? "mt-16 md:mt-20" : "mt-10"}`}
						rows={1}
						readOnly={readOnly}
						placeholder="Untitled"
						onBlur={commitTitle}
						onInput={(event) => {
							const textarea = event.currentTarget;
							textarea.style.height = "auto";
							textarea.style.height = `${textarea.scrollHeight}px`;
						}}
						onChange={(event) => {
							setDraftTitle(event.target.value);
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
					<div
						role="application"
						tabIndex={readOnly ? -1 : 0}
						className={cn(
							"paperite-tiptap flex min-h-0 flex-1 px-8 pb-44 md:px-14 lg:px-20",
							pageFormat.lineHeight === "1.5" &&
								"paperite-tiptap-leading-compact",
							pageFormat.paragraphSpacing === "compact" &&
								"paperite-tiptap-spacing-compact",
							pageFormat.firstLineIndent && "paperite-tiptap-indent",
						)}
						onClick={focusEditorCanvas}
						onKeyDown={() => editor?.commands.focus()}
					>
						<EditorContent editor={editor} className="min-h-full flex-1" />
					</div>
				</div>
				<div className="pointer-events-none absolute right-0 bottom-0 left-0 z-20 h-24 bg-gradient-to-t from-background via-background/80 to-transparent" />
				{editor ? <FormatMenu editor={editor} readOnly={readOnly} /> : null}
			</div>
			{linkHover ? (
				<LinkHoverCard hover={linkHover} onClose={() => setLinkHover(null)} />
			) : null}
		</div>
	);
}

function FormatMenu({
	editor,
	readOnly,
}: {
	editor: TiptapEditor;
	readOnly: boolean;
}) {
	const imageInputRef = useRef<HTMLInputElement>(null);
	const savedTextSelectionRef = useRef<{ from: number; to: number } | null>(
		null,
	);

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

	const uploadImage = (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file?.type.startsWith("image/")) return;

		const reader = new FileReader();
		reader.addEventListener("load", () => {
			if (typeof reader.result !== "string") return;
			editor
				.chain()
				.focus()
				.setImage({ src: reader.result, alt: file.name })
				.run();
		});
		reader.readAsDataURL(file);
	};

	return (
		<div className="sticky right-0 bottom-4 left-0 z-30 mx-auto mt-[-3rem] w-full max-w-4xl px-8 md:px-14 lg:px-20">
			<div
				className="app-region-no-drag no-scrollbar flex w-full items-center gap-1 overflow-x-auto overflow-y-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-[0_12px_36px_rgb(0_0_0/0.22),0_0_0_1px_rgb(255_255_255/0.08)] ring-1 ring-foreground/10 [&>*]:shrink-0"
				onPointerDown={(event) => event.stopPropagation()}
			>
				<BlockStyleSelect editor={editor} disabled={readOnly} />
				<span className="mx-0.5 h-5 w-px bg-border" />
				<FormatButton
					label="Bold"
					icon={BoldIcon}
					command="bold"
					editor={editor}
					disabled={readOnly}
				/>
				<FormatButton
					label="Italic"
					icon={ItalicIcon}
					command="italic"
					editor={editor}
					disabled={readOnly}
				/>
				<FormatButton
					label="Underline"
					icon={UnderlineIcon}
					command="underline"
					editor={editor}
					disabled={readOnly}
				/>
				<FormatButton
					label="Strikethrough"
					icon={StrikethroughIcon}
					command="strike"
					editor={editor}
					disabled={readOnly}
				/>
				<span className="mx-0.5 h-5 w-px bg-border" />
				<ColorMenu
					editor={editor}
					disabled={readOnly}
					label="Highlight"
					icon={HighlighterIcon}
					mode="highlight"
					colors={highlightColors}
					savedSelectionRef={savedTextSelectionRef}
				/>
				<ColorMenu
					editor={editor}
					disabled={readOnly}
					label="Text color"
					mode="text-color"
					colors={textColors}
					savedSelectionRef={savedTextSelectionRef}
				/>
				<span className="mx-0.5 h-5 w-px bg-border" />
				<FormatButton
					label="Quote"
					icon={QuoteIcon}
					command="quote"
					editor={editor}
					disabled={readOnly}
				/>
				<FormatButton
					label="Code block"
					icon={Code2Icon}
					command="code-block"
					editor={editor}
					disabled={readOnly}
				/>
				<ToolbarTooltip label="Upload image">
					<button
						type="button"
						aria-label="Upload image"
						disabled={readOnly}
						className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,scale] active:scale-[0.96] hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => imageInputRef.current?.click()}
					>
						<ImagePlusIcon className="size-4" />
					</button>
				</ToolbarTooltip>
				<input
					ref={imageInputRef}
					type="file"
					accept="image/*"
					className="hidden"
					onChange={uploadImage}
				/>
				<span className="mx-0.5 h-5 w-px bg-border" />
				{alignCommands.map(({ command, icon, label }) => (
					<FormatButton
						key={command}
						label={label}
						icon={icon}
						command={command}
						editor={editor}
						disabled={readOnly}
					/>
				))}
				<span className="mx-0.5 h-5 w-px bg-border" />
				<FormatButton
					label="Bullet list"
					icon={ListIcon}
					command="bullet-list"
					editor={editor}
					disabled={readOnly}
				/>
				<FormatButton
					label="Numbered list"
					icon={ListOrderedIcon}
					command="ordered-list"
					editor={editor}
					disabled={readOnly}
				/>
				<FormatButton
					label="Checkbox"
					icon={ListTodoIcon}
					command="task-list"
					editor={editor}
					disabled={readOnly}
				/>
			</div>
		</div>
	);
}

function ColorMenu({
	colors,
	disabled,
	editor,
	icon: Icon,
	label,
	mode,
	savedSelectionRef,
}: {
	colors: string[];
	disabled: boolean;
	editor: TiptapEditor;
	icon?: ComponentType<{ className?: string }>;
	label: string;
	mode: "highlight" | "text-color";
	savedSelectionRef: RefObject<{ from: number; to: number } | null>;
}) {
	const [open, setOpen] = useState(false);
	const [selectedColor, setSelectedColor] = useState(colors[0]);
	const [dropupPosition, setDropupPosition] = useState({ left: 0, top: 0 });
	const triggerRef = useRef<HTMLButtonElement>(null);
	const active =
		mode === "highlight"
			? editor.isActive("highlight")
			: editor.isActive("textStyle");

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

	const applySelectedColor = () => {
		const range = selectionRange();
		const hasActiveMark =
			mode === "highlight"
				? editor.isActive("highlight")
				: Boolean(editor.getAttributes("textStyle").color);
		const chain = editor.chain().focus();
		if (range) chain.setTextSelection(range);

		if (mode === "highlight") {
			if (hasActiveMark) {
				chain.extendMarkRange("highlight").unsetHighlight().run();
				return;
			}

			chain
				.extendMarkRange("highlight")
				.setHighlight({ color: selectedColor })
				.run();
			return;
		}

		if (hasActiveMark) {
			chain.extendMarkRange("textStyle").unsetColor().run();
			return;
		}

		chain.extendMarkRange("textStyle").setColor(selectedColor).run();
	};

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
					disabled={disabled}
					className="flex h-8 w-4 items-center justify-center rounded-r-md text-muted-foreground transition-[background-color,color,scale] active:scale-[0.96] hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
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
	disabled,
}: {
	editor: TiptapEditor;
	disabled: boolean;
}) {
	const value =
		blockStyleOptions.find(
			(option) =>
				option.value.startsWith("heading-") &&
				editor.isActive("heading", {
					level: Number(option.value.replace("heading-", "")),
				}),
		)?.value ?? "body";

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
	disabled,
}: {
	label: string;
	icon: ComponentType<{ className?: string }>;
	command: EditorFormatCommand;
	editor: TiptapEditor;
	disabled: boolean;
}) {
	const active = isFormatActive(editor, command);

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
		<Tooltip>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent side="top" sideOffset={8}>
				{label}
			</TooltipContent>
		</Tooltip>
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

function isFormatActive(editor: TiptapEditor, command: EditorFormatCommand) {
	if (command === "bold") return editor.isActive("bold");
	if (command === "italic") return editor.isActive("italic");
	if (command === "underline") return editor.isActive("underline");
	if (command === "strike") return editor.isActive("strike");
	if (command === "highlight") return editor.isActive("highlight");
	if (command === "quote") return editor.isActive("blockquote");
	if (command === "code-block") return editor.isActive("codeBlock");
	if (command === "typography-heading-1") {
		return editor.isActive("heading", { level: 1 });
	}
	if (command === "typography-heading-2") {
		return editor.isActive("heading", { level: 2 });
	}
	if (command === "typography-heading-3") {
		return editor.isActive("heading", { level: 3 });
	}
	if (command === "typography-body") return editor.isActive("paragraph");
	if (command === "bullet-list") return editor.isActive("bulletList");
	if (command === "ordered-list") return editor.isActive("orderedList");
	if (command === "task-list") return editor.isActive("taskList");

	const alignment = command.replace("align-", "") as TextAlignment;
	return editor.isActive({ textAlign: alignment });
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
			className="paperite-link-hover-card fixed z-50 w-64 -translate-x-1/2 -translate-y-[calc(100%+0.5rem)] rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10"
			style={{ left: hover.left, top: hover.top }}
			onMouseLeave={onClose}
		>
			<div className="truncate pb-2 text-xs text-muted-foreground">
				{hover.href}
			</div>
			<button
				type="button"
				className="flex h-8 w-full items-center justify-center rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-[opacity,scale] active:scale-[0.96] hover:opacity-90"
				onClick={() => window.electron?.openExternal(hover.href)}
			>
				Open in browser
			</button>
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
