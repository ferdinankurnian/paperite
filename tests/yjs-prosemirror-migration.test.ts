import { expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import * as Y from "yjs";

const noteJson = {
	type: "doc",
	content: [
		{
			type: "heading",
			attrs: { textAlign: "left", level: 2 },
			content: [{ type: "text", text: "Migration" }],
		},
		{
			type: "paragraph",
			attrs: { textAlign: "left" },
			content: [
				{ type: "text", text: "hello " },
				{ type: "text", marks: [{ type: "bold", attrs: {} }], text: "crdt" },
			],
		},
	],
};

test("prosemirror note json round-trips through yjs without data loss", () => {
	const schema = getSchema([
		StarterKit.configure({ underline: false, undoRedo: false }),
		Underline,
		TextStyle.configure({ mergeNestedSpanStyles: true }),
		TextAlign.configure({ types: ["heading", "paragraph"] }),
		TaskList,
		TaskItem.configure({ nested: true }),
	]);

	const importedDoc = prosemirrorJSONToYDoc(schema, noteJson);
	const persistedUpdate = Y.encodeStateAsUpdate(importedDoc);
	const restoredDoc = new Y.Doc();

	Y.applyUpdate(restoredDoc, persistedUpdate);

	expect(restoredDoc.getXmlFragment("prosemirror").length).toBeGreaterThan(0);
	expect(yDocToProsemirrorJSON(restoredDoc)).toEqual(noteJson);
});
