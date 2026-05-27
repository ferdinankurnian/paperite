import { type Editor, Extension } from "@tiptap/core";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
	AlignCenterIcon,
	AlignJustifyIcon,
	AlignLeftIcon,
	AlignRightIcon,
	BoldIcon,
	ItalicIcon,
	ListIcon,
	ListOrderedIcon,
	ListTodoIcon,
	StrikethroughIcon,
	UnderlineIcon,
} from "lucide-react";
import { marked } from "marked";
import type { ComponentType } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TurndownService from "turndown";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type NoteEditorProps = {
	markdown: string;
	noteTitle: string;
	notePath: string | null;
	pageFormat?: PageFormat;
	readOnly: boolean;
	searchQuery: string;
	onChange: (markdown: string, notePath: string | null) => void;
	onContentRendered?: (notePath: string) => void;
	onRename: (title: string) => void;
	onTitleChange: (title: string) => void;
};

export type PageFormat = {
	firstLineIndent: boolean;
	lineHeight: "normal" | "1.5";
	paragraphSpacing: "default" | "compact";
};

type SearchHighlightStorage = {
	searchHighlight: {
		query: string;
	};
};

type EditorFormatCommand =
	| "bold"
	| "italic"
	| "underline"
	| "strike"
	| "typography-heading"
	| "typography-body"
	| "align-left"
	| "align-center"
	| "align-right"
	| "align-justify"
	| "bullet-list"
	| "ordered-list"
	| "task-list";

const defaultPageFormat: PageFormat = {
	firstLineIndent: false,
	lineHeight: "normal",
	paragraphSpacing: "default",
};

const taskCheckboxClassName =
	"peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input transition-colors outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary";

const taskCheckboxIndicatorClassName =
	"grid place-content-center text-current transition-none [&>svg]:size-3.5";

export function NoteEditor({
	markdown,
	notePath,
	noteTitle,
	pageFormat = defaultPageFormat,
	readOnly,
	searchQuery,
	onChange,
	onContentRendered,
	onRename,
	onTitleChange,
}: NoteEditorProps) {
	const [draftTitle, setDraftTitle] = useState(editableTitle(noteTitle));
	const [blockStyleSelectOpen, setBlockStyleSelectOpen] = useState(false);
	const [formatMenuPosition, setFormatMenuPosition] = useState({
		left: 0,
		top: 0,
		visible: false,
	});
	const titleInputRef = useRef<HTMLInputElement>(null);
	const lastEditorMarkdown = useRef(markdown);
	const lastLoadedPath = useRef(notePath);
	const serializeTimer = useRef<number | null>(null);
	const turndown = useMemo(
		() =>
			new TurndownService({
				codeBlockStyle: "fenced",
				headingStyle: "atx",
			}),
		[],
	);

	const flushMarkdown = useCallback(
		(editor: Editor) => {
			if (serializeTimer.current !== null) {
				window.clearTimeout(serializeTimer.current);
				serializeTimer.current = null;
			}

			const serializeStart = performance.now();
			const nextMarkdown = turndown.turndown(editor.getHTML());
			const serializeDuration = performance.now() - serializeStart;

			if (serializeDuration > 16) {
				console.info(
					`[paperite perf] markdown serialize ${serializeDuration.toFixed(1)}ms`,
				);
			}

			lastEditorMarkdown.current = nextMarkdown;
			onChange(nextMarkdown, lastLoadedPath.current);
		},
		[onChange, turndown],
	);

	const editor = useEditor({
		extensions: [
			StarterKit,
			TaskList,
			ShadcnTaskItem.configure({
				nested: true,
			}),
			TaskMarkdownShortcut,
			SearchHighlight,
			TextAlign.configure({
				types: ["heading", "paragraph"],
			}),
			Underline,
		],
		content: markdownToHtml(markdown),
		editable: !readOnly,
		editorProps: {
			attributes: {
				class: "prose-paperite max-w-none min-h-full outline-none",
			},
			handleKeyDown: (_view, event) => {
				if (event.key !== "ArrowUp") return false;
				const { empty, from } = editor?.state.selection ?? {
					empty: false,
					from: Number.POSITIVE_INFINITY,
				};

				if (empty && from <= 1) {
					event.preventDefault();
					titleInputRef.current?.focus();
					titleInputRef.current?.setSelectionRange(
						titleInputRef.current.value.length,
						titleInputRef.current.value.length,
					);
					return true;
				}

				return false;
			},
		},
		onUpdate: ({ editor }) => {
			if (serializeTimer.current !== null) {
				window.clearTimeout(serializeTimer.current);
			}

			serializeTimer.current = window.setTimeout(() => {
				flushMarkdown(editor);
			}, 250);
		},
	});

	useEffect(
		() => () => {
			if (serializeTimer.current !== null) {
				window.clearTimeout(serializeTimer.current);
			}
		},
		[],
	);

	useEffect(() => {
		if (!editor) return;
		(
			editor.storage as unknown as SearchHighlightStorage
		).searchHighlight.query = searchQuery;
		editor.view.dispatch(editor.state.tr);
	}, [editor, searchQuery]);

	useEffect(() => {
		turndown.addRule("taskListItems", {
			filter: (node) =>
				node.nodeName === "LI" &&
				(node as Element).querySelector('input[type="checkbox"]') !== null,
			replacement: (content, node) => {
				const checked =
					(node as Element)
						.querySelector('input[type="checkbox"]')
						?.hasAttribute("checked") ?? false;
				return `- [${checked ? "x" : " "}] ${content.trim()}\n`;
			},
		});
	}, [turndown]);

	useEffect(() => {
		if (!editor) return;
		const isSameNote = notePath === lastLoadedPath.current;

		if (isSameNote && markdown === lastEditorMarkdown.current) return;

		if (!isSameNote) {
			flushMarkdown(editor);
		}

		lastLoadedPath.current = notePath;
		lastEditorMarkdown.current = markdown;
		const setContentStart = performance.now();
		editor.commands.setContent(markdownToHtml(markdown), { emitUpdate: false });
		const setContentDuration = performance.now() - setContentStart;

		if (setContentDuration > 16) {
			console.info(
				`[paperite perf] editor setContent ${setContentDuration.toFixed(1)}ms`,
			);
		}

		if (notePath) {
			requestAnimationFrame(() => onContentRendered?.(notePath));
		}
	}, [editor, flushMarkdown, markdown, notePath, onContentRendered]);

	useEffect(() => {
		editor?.setEditable(!readOnly);
	}, [editor, readOnly]);

	useEffect(() => {
		if (!editor) return;

		const handleFormat = (event: Event) => {
			if (readOnly) return;

			const detail = (event as CustomEvent<{ command?: EditorFormatCommand }>)
				.detail;
			const command = detail?.command;
			if (!command) return;

			switch (command) {
				case "bold":
					editor.chain().focus().toggleBold().run();
					break;
				case "italic":
					editor.chain().focus().toggleItalic().run();
					break;
				case "underline":
					editor.chain().focus().toggleUnderline().run();
					break;
				case "strike":
					editor.chain().focus().toggleStrike().run();
					break;
				case "typography-heading":
					editor.chain().focus().toggleHeading({ level: 1 }).run();
					break;
				case "typography-body":
					editor.chain().focus().setParagraph().run();
					break;
				case "align-left":
					editor.chain().focus().setTextAlign("left").run();
					break;
				case "align-center":
					editor.chain().focus().setTextAlign("center").run();
					break;
				case "align-right":
					editor.chain().focus().setTextAlign("right").run();
					break;
				case "align-justify":
					editor.chain().focus().setTextAlign("justify").run();
					break;
				case "bullet-list":
					editor.chain().focus().toggleBulletList().run();
					break;
				case "ordered-list":
					editor.chain().focus().toggleOrderedList().run();
					break;
				case "task-list":
					toggleCurrentBlockTask(editor);
					break;
			}
		};

		window.addEventListener("paperite:editor-format", handleFormat);
		return () => {
			window.removeEventListener("paperite:editor-format", handleFormat);
		};
	}, [editor, readOnly]);

	useEffect(() => {
		if (!editor) return;

		const updateFormatMenuPosition = () => {
			const { from, to, empty } = editor.state.selection;

			if (readOnly || (empty && !blockStyleSelectOpen)) {
				setFormatMenuPosition((current) =>
					current.visible ? { ...current, visible: false } : current,
				);
				return;
			}

			const start = editor.view.coordsAtPos(from);
			const end = editor.view.coordsAtPos(to);
			const left = Math.max(12, Math.min(start.left, end.left));
			const top = Math.max(12, Math.max(start.bottom, end.bottom) + 10);

			setFormatMenuPosition((current) =>
				current.left === left && current.top === top && current.visible
					? current
					: { left, top, visible: true },
			);
		};

		updateFormatMenuPosition();
		editor.on("selectionUpdate", updateFormatMenuPosition);
		window.addEventListener("resize", updateFormatMenuPosition);
		window.addEventListener("scroll", updateFormatMenuPosition, true);
		return () => {
			editor.off("selectionUpdate", updateFormatMenuPosition);
			window.removeEventListener("resize", updateFormatMenuPosition);
			window.removeEventListener("scroll", updateFormatMenuPosition, true);
		};
	}, [blockStyleSelectOpen, editor, readOnly]);

	useEffect(() => {
		setDraftTitle(editableTitle(noteTitle));
	}, [noteTitle]);

	const commitTitle = () => {
		const nextTitle = draftTitle.trim();

		if (!nextTitle) {
			return;
		}

		if (nextTitle !== noteTitle) {
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
		<div className="flex min-h-full flex-1 flex-col">
			<div className="mx-auto flex min-h-full w-full max-w-4xl flex-1 flex-col">
				<input
					type="text"
					ref={titleInputRef}
					value={draftTitle}
					aria-label="Note title"
					className="mx-8 mt-10 mb-2 bg-transparent text-3xl font-semibold tracking-normal outline-none placeholder:text-muted-foreground md:mx-14 lg:mx-20"
					readOnly={readOnly}
					placeholder="Untitled"
					onBlur={commitTitle}
					onChange={(event) => {
						setDraftTitle(event.target.value);
						onTitleChange(event.target.value);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							event.currentTarget.blur();
						}

						if (event.key === "ArrowDown") {
							event.preventDefault();
							editor?.chain().focus("start").run();
						}

						if (event.key === "Escape") {
							setDraftTitle(noteTitle);
							onTitleChange(noteTitle);
							event.currentTarget.blur();
						}
					}}
				/>
				{editor && formatMenuPosition.visible ? (
					<div
						className="app-region-no-drag no-scrollbar fixed z-50 flex max-w-[350px] origin-top-left animate-in items-center gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-lg bg-popover p-1 text-popover-foreground shadow-[0_12px_36px_rgb(0_0_0/0.22),0_0_0_1px_rgb(255_255_255/0.08)] ring-1 ring-foreground/10 duration-100 fade-in-0 zoom-in-95 slide-in-from-top-1"
						style={{
							left: formatMenuPosition.left,
							top: formatMenuPosition.top,
						}}
						onPointerDown={(event) => event.stopPropagation()}
					>
						<BlockStyleSelect
							editor={editor}
							open={blockStyleSelectOpen}
							onOpenChange={(nextOpen) => {
								setBlockStyleSelectOpen(nextOpen);
							}}
						/>
						<span className="mx-0.5 h-5 w-px bg-border" />
						<FormatButton
							label="Bold"
							active={editor.isActive("bold")}
							onClick={() => editor.chain().focus().toggleBold().run()}
							icon={BoldIcon}
						/>
						<FormatButton
							label="Italic"
							active={editor.isActive("italic")}
							onClick={() => editor.chain().focus().toggleItalic().run()}
							icon={ItalicIcon}
						/>
						<FormatButton
							label="Underline"
							active={editor.isActive("underline")}
							onClick={() => editor.chain().focus().toggleUnderline().run()}
							icon={UnderlineIcon}
						/>
						<FormatButton
							label="Strikethrough"
							active={editor.isActive("strike")}
							onClick={() => editor.chain().focus().toggleStrike().run()}
							icon={StrikethroughIcon}
						/>
						<span className="mx-0.5 h-5 w-px bg-border" />
						<FormatButton
							label="Align left"
							active={editor.isActive({ textAlign: "left" })}
							onClick={() => editor.chain().focus().setTextAlign("left").run()}
							icon={AlignLeftIcon}
						/>
						<FormatButton
							label="Align center"
							active={editor.isActive({ textAlign: "center" })}
							onClick={() =>
								editor.chain().focus().setTextAlign("center").run()
							}
							icon={AlignCenterIcon}
						/>
						<FormatButton
							label="Align right"
							active={editor.isActive({ textAlign: "right" })}
							onClick={() => editor.chain().focus().setTextAlign("right").run()}
							icon={AlignRightIcon}
						/>
						<FormatButton
							label="Justify"
							active={editor.isActive({ textAlign: "justify" })}
							onClick={() =>
								editor.chain().focus().setTextAlign("justify").run()
							}
							icon={AlignJustifyIcon}
						/>
						<span className="mx-0.5 h-5 w-px bg-border" />
						<FormatButton
							label="Bullet list"
							active={editor.isActive("bulletList")}
							onClick={() => editor.chain().focus().toggleBulletList().run()}
							icon={ListIcon}
						/>
						<FormatButton
							label="Numbered list"
							active={editor.isActive("orderedList")}
							onClick={() => editor.chain().focus().toggleOrderedList().run()}
							icon={ListOrderedIcon}
						/>
						<FormatButton
							label="Checkbox"
							active={editor.isActive("taskList")}
							onClick={() => toggleCurrentBlockTask(editor)}
							icon={ListTodoIcon}
						/>
					</div>
				) : null}
				<EditorContent
					editor={editor}
					className={cn(
						"flex min-h-0 flex-1 px-8 pb-8 md:px-14 lg:px-20 [&_.ProseMirror]:min-h-full [&_.ProseMirror]:flex-1",
						pageFormat.lineHeight === "1.5" && "[&_.ProseMirror]:leading-[1.5]",
						pageFormat.firstLineIndent && "[&_.ProseMirror_p]:first-line:pl-8",
						pageFormat.paragraphSpacing === "compact" &&
							"[&_.ProseMirror_p]:my-0",
					)}
					onClick={() => editor?.chain().focus().run()}
				/>
			</div>
		</div>
	);
}

const ShadcnTaskItem = TaskItem.extend({
	addNodeView() {
		return ({ node, HTMLAttributes, getPos, editor }) => {
			const listItem = document.createElement("li");
			const checkboxWrapper = document.createElement("label");
			const checkbox = document.createElement("button");
			const indicator = document.createElement("span");
			const content = document.createElement("div");

			const syncCheckbox = (currentNode: ProseMirrorNode) => {
				const checked = Boolean(currentNode.attrs.checked);
				listItem.dataset.checked = String(checked);
				checkbox.dataset.state = checked ? "checked" : "unchecked";
				checkbox.setAttribute("aria-checked", String(checked));
				checkbox.toggleAttribute("data-checked", checked);
				indicator.hidden = !checked;
			};

			checkboxWrapper.contentEditable = "false";
			checkbox.type = "button";
			checkbox.setAttribute("role", "checkbox");
			checkbox.setAttribute("data-slot", "checkbox");
			checkbox.className = taskCheckboxClassName;
			checkbox.addEventListener("mousedown", (event) => event.preventDefault());
			checkbox.addEventListener("click", () => {
				if (!editor.isEditable || typeof getPos !== "function") return;

				editor
					.chain()
					.focus(undefined, { scrollIntoView: false })
					.command(({ tr }) => {
						const position = getPos();

						if (typeof position !== "number") return false;

						const currentNode = tr.doc.nodeAt(position);
						tr.setNodeMarkup(position, undefined, {
							...currentNode?.attrs,
							checked: !currentNode?.attrs.checked,
						});

						return true;
					})
					.run();
			});

			indicator.setAttribute("data-slot", "checkbox-indicator");
			indicator.className = taskCheckboxIndicatorClassName;
			indicator.innerHTML =
				'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

			for (const [key, value] of Object.entries(this.options.HTMLAttributes)) {
				listItem.setAttribute(key, value);
			}

			for (const [key, value] of Object.entries(HTMLAttributes)) {
				listItem.setAttribute(key, value);
			}

			checkbox.append(indicator);
			checkboxWrapper.append(checkbox);
			listItem.append(checkboxWrapper, content);
			syncCheckbox(node);

			return {
				dom: listItem,
				contentDOM: content,
				update: (updatedNode) => {
					if (updatedNode.type !== this.type) return false;

					syncCheckbox(updatedNode);
					return true;
				},
			};
		};
	},
});

function BlockStyleSelect({
	editor,
	open,
	onOpenChange,
}: {
	editor: Editor;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const value = editor.isActive("heading", { level: 1 })
		? "heading-1"
		: editor.isActive("heading", { level: 2 })
			? "heading-2"
			: "paragraph";

	return (
		<Select
			open={open}
			onOpenChange={(nextOpen) => {
				onOpenChange(nextOpen);
				if (!nextOpen) {
					editor.chain().focus().run();
				}
			}}
			value={value}
			onValueChange={(nextValue) => {
				if (nextValue === "heading-1") {
					editor.chain().focus().toggleHeading({ level: 1 }).run();
					return;
				}

				if (nextValue === "heading-2") {
					editor.chain().focus().toggleHeading({ level: 2 }).run();
					return;
				}

				editor.chain().focus().setParagraph().run();
			}}
		>
			<SelectTrigger
				aria-label="Block style"
				className="w-30"
				onPointerDown={(event) => event.stopPropagation()}
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent
				align="start"
				sideOffset={8}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					editor.chain().focus().run();
				}}
			>
				<SelectItem value="paragraph">Body</SelectItem>
				<SelectItem value="heading-1">Heading 1</SelectItem>
				<SelectItem value="heading-2">Heading 2</SelectItem>
			</SelectContent>
		</Select>
	);
}

function toggleCurrentBlockTask(editor: Editor) {
	const { $from } = editor.state.selection;

	if ($from.parent.isTextblock) {
		if (editor.isActive("taskList")) {
			return editor.chain().focus().toggleTaskList().run();
		}

		return editor
			.chain()
			.focus()
			.command(({ state, tr, dispatch }) => {
				const paragraphDepth = $from.depth;
				const paragraph = $from.node(paragraphDepth);
				const taskListType = state.schema.nodes.taskList;
				const taskItemType = state.schema.nodes.taskItem;

				if (!taskListType || !taskItemType || !paragraph.isTextblock) {
					return false;
				}

				const paragraphFrom = $from.before(paragraphDepth);
				const paragraphTo = $from.after(paragraphDepth);
				const taskParagraph = paragraph.type.create(
					paragraph.attrs,
					paragraph.content,
					paragraph.marks,
				);
				const taskItem = taskItemType.create({ checked: false }, taskParagraph);
				const taskList = taskListType.create(null, taskItem);

				tr.replaceRangeWith(paragraphFrom, paragraphTo, taskList);
				dispatch?.(tr.scrollIntoView());
				return true;
			})
			.run();
	}

	return editor.chain().focus().toggleTaskList().run();
}

function FormatButton({
	label,
	active,
	icon: Icon,
	onClick,
}: {
	label: string;
	active: boolean;
	icon: ComponentType<{ className?: string }>;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			data-active={active}
			className={cn(
				"flex size-8 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,scale] active:scale-[0.96] hover:bg-muted hover:text-foreground data-[active=true]:bg-primary data-[active=true]:text-primary-foreground",
			)}
			onMouseDown={(event) => event.preventDefault()}
			onClick={onClick}
		>
			<Icon className="size-4" />
		</button>
	);
}

function editableTitle(title: string) {
	return title === "Untitled" ? "" : title;
}

function markdownToHtml(markdown: string) {
	const html = marked.parse(markdown, { async: false });
	return typeof html === "string" ? normalizeTaskListHtml(html) : "";
}

function normalizeTaskListHtml(html: string) {
	const template = document.createElement("template");
	template.innerHTML = html;

	for (const list of template.content.querySelectorAll("ul")) {
		const taskItems = Array.from(list.children).filter(
			(item): item is HTMLLIElement =>
				item instanceof HTMLLIElement &&
				item.querySelector(':scope > input[type="checkbox"]') !== null,
		);

		if (taskItems.length === 0) continue;

		list.setAttribute("data-type", "taskList");

		for (const item of taskItems) {
			const checkbox = item.querySelector<HTMLInputElement>(
				':scope > input[type="checkbox"]',
			);

			if (!checkbox) continue;

			item.setAttribute("data-type", "taskItem");
			item.setAttribute("data-checked", String(checkbox.checked));
			checkbox.remove();
		}
	}

	return template.innerHTML;
}

const SearchHighlight = Extension.create({
	name: "searchHighlight",

	addStorage() {
		return {
			query: "",
		};
	},

	addProseMirrorPlugins() {
		const extension = this;

		return [
			new Plugin({
				key: new PluginKey("searchHighlight"),
				props: {
					decorations(state) {
						const query = (
							extension.editor.storage as unknown as SearchHighlightStorage
						).searchHighlight.query.trim();

						if (!query) return DecorationSet.empty;

						const decorations: Decoration[] = [];
						const needle = query.toLocaleLowerCase();

						state.doc.descendants((node, position) => {
							if (!node.isText || !node.text) return;

							const haystack = node.text.toLocaleLowerCase();
							let index = haystack.indexOf(needle);

							while (index !== -1) {
								decorations.push(
									Decoration.inline(
										position + index,
										position + index + query.length,
										{ class: "paperite-search-highlight" },
									),
								);
								index = haystack.indexOf(needle, index + needle.length);
							}
						});

						return DecorationSet.create(state.doc, decorations);
					},
				},
			}),
		];
	},
});

const TaskMarkdownShortcut = Extension.create({
	name: "taskMarkdownShortcut",

	addProseMirrorPlugins() {
		const extension = this;

		return [
			new Plugin({
				key: new PluginKey("taskMarkdownShortcut"),
				props: {
					handleTextInput(view, from, to, text) {
						if (text !== " " || from !== to) return false;

						const markerStart = Math.max(0, from - 3);
						const marker = view.state.doc.textBetween(markerStart, from);
						const normalizedMarker = marker.toLocaleLowerCase();

						if (marker !== "[ ]" && normalizedMarker !== "[x]") {
							return false;
						}

						return extension.editor
							.chain()
							.focus()
							.deleteRange({ from: markerStart, to: from })
							.toggleTaskList()
							.updateAttributes("taskItem", {
								checked: normalizedMarker === "[x]",
							})
							.run();
					},
				},
			}),
		];
	},
});
