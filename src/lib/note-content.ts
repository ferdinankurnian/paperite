export const createEmptyNoteContent = (): NoteContent => ({
	type: "doc",
	content: [{ type: "paragraph" }],
});

export function normalizeNoteContent(content: unknown): NoteContent {
	if (isNoteContent(content)) return content;

	if (typeof content === "string") {
		return textToNoteContent(content);
	}

	return createEmptyNoteContent();
}

export function serializeNoteContent(content: NoteContent) {
	return JSON.stringify(normalizeNoteContent(content));
}

export function serializeNoteContentBody(content: NoteContent): string {
	const normalized = normalizeNoteContent(content);
	const { id, title, ...body } = normalized;
	return JSON.stringify(body);
}

export function noteContentPreview(content: NoteContent) {
	return (
		noteContentText(content)
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find(Boolean) ?? ""
	);
}

export function noteContentText(content: NoteContent) {
	const chunks: string[] = [];

	collectText(normalizeNoteContent(content), chunks);

	return chunks.join("").replace(/\n+$/g, "");
}

export function replaceInNoteContent(
	content: NoteContent,
	search: string,
	replacement: string,
	replaceAll: boolean,
) {
	if (!search) return content;

	let didReplace = false;
	const nextContent = replaceInNode(
		normalizeNoteContent(content),
		search,
		replacement,
		replaceAll,
		() => didReplace,
		() => {
			didReplace = true;
		},
	);

	return didReplace ? nextContent : content;
}

function replaceInNode(
	node: NoteContent,
	search: string,
	replacement: string,
	replaceAll: boolean,
	hasReplaced: () => boolean,
	markReplaced: () => void,
): NoteContent {
	let changed = false;
	const nextNode: NoteContent = { ...node };

	if (typeof node.text === "string" && (replaceAll || !hasReplaced())) {
		const nextText = replaceAll
			? node.text.split(search).join(replacement)
			: replaceFirst(node.text, search, replacement);

		if (nextText !== node.text) {
			nextNode.text = nextText;
			changed = true;
			markReplaced();
		}
	}

	if (node.content) {
		const nextChildren = node.content.map((child) =>
			replaceInNode(
				child,
				search,
				replacement,
				replaceAll,
				hasReplaced,
				markReplaced,
			),
		);

		if (nextChildren.some((child, index) => child !== node.content?.[index])) {
			nextNode.content = nextChildren;
			changed = true;
		}
	}

	return changed ? nextNode : node;
}

function replaceFirst(source: string, search: string, replacement: string) {
	const index = source.indexOf(search);
	if (index === -1) return source;

	return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

function collectText(node: NoteContent, chunks: string[]) {
	if (typeof node.text === "string") {
		chunks.push(node.text);
	}

	for (const child of node.content ?? []) {
		collectText(child, chunks);
	}

	if (isBlockNode(node) && chunks.at(-1) !== "\n") {
		chunks.push("\n");
	}
}

function isBlockNode(node: NoteContent) {
	return (
		node.type === "paragraph" ||
		node.type === "heading" ||
		node.type === "blockquote" ||
		node.type === "codeBlock" ||
		node.type === "listItem" ||
		node.type === "taskItem"
	);
}

function textToNoteContent(text: string): NoteContent {
	const lines = text.split(/\r?\n/);

	return {
		type: "doc",
		content: lines.map((line) => ({
			type: "paragraph",
			content: line ? [{ type: "text", text: line }] : undefined,
		})),
	};
}

export function noteContentToMarkdown(content: NoteContent): string {
	const parts: string[] = [];
	collectMarkdown(normalizeNoteContent(content), parts);
	return (
		parts
			.join("")
			.replace(/\n{3,}/g, "\n\n")
			.trimEnd() + "\n"
	);
}

function collectMarkdown(node: NoteContent, parts: string[]) {
	const type = node.type;

	if (type === "heading") {
		const level = (node.attrs?.level as number) ?? 1;
		parts.push("#".repeat(level) + " ");
	}

	if (type === "blockquote") {
		parts.push("> ");
	}

	if (type === "codeBlock") {
		const lang = node.attrs?.language ?? "";
		parts.push(`\`\`\`${lang}\n`);
	}

	if (type === "bulletList") {
		// handled by children
	}

	if (type === "orderedList") {
		// handled by children
	}

	if (type === "listItem" || type === "taskItem") {
		const parent = (parts as any)._listParent as
			| "bullet"
			| "ordered"
			| undefined;
		if (parent === "ordered") {
			// index tracked externally would be better, but simple approach:
			parts.push("1. ");
		} else if (type === "taskItem") {
			const checked = node.attrs?.checked === true;
			parts.push(`- [${checked ? "x" : " "}] `);
		} else {
			parts.push("- ");
		}
	}

	if (type === "horizontalRule") {
		parts.push("---\n");
		return;
	}

	if (type === "hardBreak") {
		parts.push("  \n");
		return;
	}

	if (type === "image") {
		const src = node.attrs?.src ?? "";
		const alt = (node.attrs?.alt as string) ?? "";
		parts.push(`![${alt}](${src})`);
		return;
	}

	if (typeof node.text === "string") {
		let text = node.text;
		if (node.marks) {
			for (const mark of node.marks) {
				if (mark.type === "bold") text = `**${text}**`;
				else if (mark.type === "italic") text = `*${text}*`;
				else if (mark.type === "code") text = `\`${text}\``;
				else if (mark.type === "strike") text = `~~${text}~~`;
				else if (mark.type === "link") {
					const href = mark.attrs?.href ?? "";
					text = `[${text}](${href})`;
				}
			}
		}
		parts.push(text);
	}

	if (node.content) {
		const isList = type === "bulletList" || type === "orderedList";
		const prevLen = parts.length;

		for (const child of node.content) {
			if (isList) {
				(parts as any)._listParent =
					type === "orderedList" ? "ordered" : "bullet";
			}
			collectMarkdown(child, parts);
		}

		if (isList) {
			(parts as any)._listParent = undefined;
		}

		// add spacing after block nodes
		if (
			type === "paragraph" ||
			type === "heading" ||
			type === "blockquote" ||
			type === "codeBlock"
		) {
			if (parts.length > prevLen) parts.push("\n");
		}
	}

	if (type === "codeBlock") {
		parts.push("```\n");
	}
}

function isNoteContent(content: unknown): content is NoteContent {
	return isRecord(content) && typeof content.type === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
