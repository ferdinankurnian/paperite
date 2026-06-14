const assert = require("node:assert/strict");
const Y = require("yjs");

const createNoteDoc = (text) => {
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

const readBody = (doc) => doc.getMap("content").get("body");
const encode = (doc) => Y.encodeStateAsUpdate(doc);
const apply = (doc, update) => Y.applyUpdate(doc, update);

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

assert.deepEqual(deviceA.toJSON(), deviceB.toJSON());
assert.equal(deviceA.getMap("metadata").get("title"), "Desktop title");
assert.deepEqual(readBody(deviceA), readBody(deviceB));

const duplicateState = JSON.stringify(deviceA.toJSON());
apply(deviceA, updateB);
apply(deviceA, updateA);
assert.equal(JSON.stringify(deviceA.toJSON()), duplicateState);

console.log("Yjs convergence verified: updates are merge-safe and idempotent.");
