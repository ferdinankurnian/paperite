import { expect, test } from "bun:test";
import * as Y from "yjs";

const createNoteDoc = (text: string) => {
	const doc = new Y.Doc();
	const metadata = doc.getMap("metadata");
	const content = doc.getMap("content");

	doc.transact(() => {
		metadata.set("id", "note-verify");
		metadata.set("title", "Verify sync");
		content.set("body", {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text }],
				},
			],
		});
	});

	return doc;
};

const readBody = (doc: Y.Doc) => doc.getMap("content").get("body");
const encode = (doc: Y.Doc) => Y.encodeStateAsUpdate(doc);
const apply = (doc: Y.Doc, update: Uint8Array) => Y.applyUpdate(doc, update);

test("yjs updates from two devices merge without conflict", () => {
	const deviceA = createNoteDoc("hello from desktop");
	const deviceB = new Y.Doc();
	deviceB.getMap("metadata");
	deviceB.getMap("content");

	apply(deviceB, encode(deviceA));

	deviceA.getMap("metadata").set("title", "Desktop title");
	deviceB.getMap("content").set("body", {
		type: "doc",
		content: [
			{
				type: "paragraph",
				content: [{ type: "text", text: "hello from mobile" }],
			},
		],
	});

	const updateA = encode(deviceA);
	const updateB = encode(deviceB);

	apply(deviceA, updateB);
	apply(deviceB, updateA);

	expect(deviceA.toJSON()).toEqual(deviceB.toJSON());
	expect(deviceA.getMap("metadata").get("title")).toBe("Desktop title");
	expect(readBody(deviceA)).toEqual(readBody(deviceB));

	const duplicateState = JSON.stringify(deviceA.toJSON());
	apply(deviceA, updateB);
	apply(deviceA, updateA);
	expect(JSON.stringify(deviceA.toJSON())).toBe(duplicateState);
});
