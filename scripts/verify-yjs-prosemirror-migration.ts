import assert from "node:assert/strict";
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

const schema = getSchema([
	StarterKit.configure({ underline: false }),
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

assert.ok(restoredDoc.getXmlFragment("prosemirror").length > 0);
assert.deepEqual(yDocToProsemirrorJSON(restoredDoc), noteJson);

console.log("Yjs ProseMirror migration verified.");
