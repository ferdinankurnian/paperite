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

function isNoteContent(content: unknown): content is NoteContent {
	return isRecord(content) && typeof content.type === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
