import * as Y from "yjs";
import { normalizeNoteContent } from "@/lib/note-content";

const noteContentKey = "content";
const noteMetadataKey = "metadata";

export type YNoteMetadata = {
	id: string;
	title?: string;
	updatedAt?: number;
};

export function createYNote(content?: NoteContent) {
	const doc = new Y.Doc();

	if (content) {
		writeYNoteContent(doc, content);
	}

	return doc;
}

export function writeYNoteContent(doc: Y.Doc, content: NoteContent) {
	const normalized = normalizeNoteContent(content);
	const { id, title, ...body } = normalized;
	const metadata = doc.getMap<unknown>(noteMetadataKey);
	const noteContent = doc.getMap<unknown>(noteContentKey);

	doc.transact(() => {
		if (typeof id === "string") metadata.set("id", id);
		if (typeof title === "string") metadata.set("title", title);
		metadata.set("updatedAt", Date.now());
		noteContent.set("body", body);
	});
}

export function readYNoteContent(doc: Y.Doc): NoteContent {
	const noteContent = doc.getMap<unknown>(noteContentKey);
	const body = noteContent.get("body");
	const metadata = readYNoteMetadata(doc);

	return normalizeNoteContent({
		...(isRecord(body) ? body : {}),
		...(metadata.id ? { id: metadata.id } : {}),
		...(metadata.title ? { title: metadata.title } : {}),
	});
}

export function readYNoteMetadata(doc: Y.Doc): YNoteMetadata {
	const metadata = doc.getMap<unknown>(noteMetadataKey);
	const id = metadata.get("id");
	const title = metadata.get("title");
	const updatedAt = metadata.get("updatedAt");

	return {
		id: typeof id === "string" ? id : "",
		...(typeof title === "string" ? { title } : {}),
		...(typeof updatedAt === "number" ? { updatedAt } : {}),
	};
}

export function encodeYNote(doc: Y.Doc) {
	return Y.encodeStateAsUpdate(doc);
}

export function encodeYNoteStateVector(doc: Y.Doc) {
	return Y.encodeStateVector(doc);
}

export function applyYNoteUpdate(doc: Y.Doc, update: Uint8Array) {
	Y.applyUpdate(doc, update);
}

export function mergeYNoteUpdates(updates: Uint8Array[]) {
	return Y.mergeUpdates(updates);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
