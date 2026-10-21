import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Y from "yjs";

const workspace = require("../server/lib/workspace");
const yjsPersist = require("../server/lib/yjs-persist");

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "paperite-yjs-merge-"));
	workspace.configure(root);
	yjsPersist.clearNotePathRedirects();
	yjsPersist.clearYNoteLocksForTests();
});

afterEach(() => {
	try {
		require("../server/lib/sqlite").close();
	} catch {}
	rmSync(root, { recursive: true, force: true });
});

const noteContent = (id: string, title: string, text: string) => ({
	id,
	title,
	type: "doc",
	content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const seedNote = async (
	notePath: string,
	seed: ReturnType<typeof noteContent>,
) => {
	await workspace.ensureNoteDirectory(notePath);
	const { writeFileAtomic, serializeNoteContent, resolveNoteContentPath } =
		workspace;
	await writeFileAtomic(
		resolveNoteContentPath(notePath),
		serializeNoteContent(seed),
	);
	await yjsPersist.writeLocalYNoteSnapshot(notePath, seed);
};

// Realistic keystroke: insert a paragraph into the live fragment, like the
// TipTap collaboration binding does — a causal delta, not a full state.
const typeParagraph = (snapshot: Uint8Array, text: string) => {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, snapshot);
	const fragment = doc.getXmlFragment("prosemirror");
	const paragraph = new Y.XmlElement("paragraph");
	doc.transact(() => {
		fragment.insert(fragment.length, [paragraph]);
		paragraph.insert(0, [new Y.XmlText(text)]);
	});
	return Y.encodeStateAsUpdate(doc);
};

const fragmentText = (snapshot: Uint8Array) => {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, snapshot);
	const fragment = doc.getXmlFragment("prosemirror");
	return fragment
		.toArray()
		.map((node) =>
			node instanceof Y.XmlElement
				? node
						.toArray()
						.map((child) =>
							child instanceof Y.XmlText ? child.toString() : "",
						)
						.join("")
				: "",
		)
		.join("\n");
};

test("concurrent typing on two surfaces converges with both paragraphs", async () => {
	const notePath = "Inbox/Shared";
	await seedNote(notePath, noteContent("shared-note-id", "v0", "base"));

	const base = await yjsPersist.readLocalYNoteState(notePath);
	const updateA = typeParagraph(base.snapshot, "typed on A");
	const updateB = typeParagraph(base.snapshot, "typed on B");

	// Fire both without awaiting — the per-note lock must serialize them.
	const [resA, resB] = await Promise.all([
		yjsPersist.appendLocalYNoteUpdate(notePath, updateA),
		yjsPersist.appendLocalYNoteUpdate(notePath, updateB),
	]);
	expect(resA.ok).toBe(true);
	expect(resB.ok).toBe(true);

	const final = await yjsPersist.readLocalYNoteState(notePath);
	const text = fragmentText(final.snapshot);
	expect(text).toContain("typed on A");
	expect(text).toContain("typed on B");

	// Re-applying either update is a no-op (idempotent, no conflict).
	const check = new Y.Doc();
	Y.applyUpdate(check, final.snapshot);
	const before = fragmentText(Y.encodeStateAsUpdate(check));
	Y.applyUpdate(check, updateA);
	Y.applyUpdate(check, updateB);
	expect(fragmentText(Y.encodeStateAsUpdate(check))).toBe(before);
});

test("keystroke projection keeps note.json fresh (kill-restart safe)", async () => {
	const notePath = "Inbox/Shared3";
	await seedNote(notePath, noteContent("shared-note-id-3", "v0", "base"));

	const base = await yjsPersist.readLocalYNoteState(notePath);
	await yjsPersist.appendLocalYNoteUpdate(
		notePath,
		typeParagraph(base.snapshot, "fresh keystroke"),
	);

	const disk = await workspace.readNoteContent(notePath, true);
	const diskText = (disk.content ?? [])
		.map((block: { content?: { text?: string }[] }) =>
			(block.content ?? []).map((span) => span.text ?? "").join(""),
		)
		.join("\n");
	expect(diskText).toContain("fresh keystroke");
});

test("direct file write (AI agent) folds into snapshot and appears in diff", async () => {
	const notePath = "Inbox/AgentNote";
	await seedNote(notePath, noteContent("agent-id", "v0", "base"));

	const base = await yjsPersist.readLocalYNoteState(notePath);
	const watcher = new Y.Doc();
	Y.applyUpdate(watcher, base.snapshot);
	const sv = Y.encodeStateVector(watcher);

	// Agent rewrites note.json directly, bypassing the Y path entirely.
	const { writeFileAtomic, serializeNoteContent, resolveNoteContentPath } =
		workspace;
	const agentContent = noteContent("agent-id", "agent title", "agent body");
	await new Promise((resolve) => setTimeout(resolve, 15));
	await writeFileAtomic(
		resolveNoteContentPath(notePath),
		serializeNoteContent(agentContent),
	);

	const delta = await yjsPersist.readLocalYNoteDiff(notePath, sv);
	expect(delta.diff.length).toBeGreaterThan(0);
	Y.applyUpdate(watcher, delta.diff);
	expect(fragmentText(Y.encodeStateAsUpdate(watcher))).toContain("agent body");
	expect(watcher.getMap("metadata").get("title")).toBe("agent title");
});

test("fold replaces the body instead of appending (no duplication)", async () => {
	const notePath = "Inbox/NoDupNote";
	await seedNote(notePath, noteContent("nodup-id", "v0", "base"));

	const { writeFileAtomic, serializeNoteContent, resolveNoteContentPath } =
		workspace;
	const agentContent = noteContent("nodup-id", "agent title", "agent body");
	await new Promise((resolve) => setTimeout(resolve, 15));
	await writeFileAtomic(
		resolveNoteContentPath(notePath),
		serializeNoteContent(agentContent),
	);

	const folded = await yjsPersist.readLocalYNoteState(notePath);
	// Exact match: the old "base" paragraph must be gone, not kept next to
	// the folded body. (The old test only asserted `contains`, which let an
	// append-instead-of-replace merge slip through and duplicate the note on
	// every save/fold pass without bound.)
	expect(fragmentText(folded.snapshot)).toBe("agent body");
});

test("repeated folds of unchanged file content are idempotent", async () => {
	const notePath = "Inbox/IdempotentNote";
	await seedNote(notePath, noteContent("idem-id", "v0", "base"));

	const { writeFileAtomic, serializeNoteContent, resolveNoteContentPath } =
		workspace;
	const agentContent = noteContent("idem-id", "agent title", "agent body");

	// Fold three times (file keeps looking "newer" than the manifest), like
	// the poll loop does across derived autosaves.
	for (let i = 0; i < 3; i++) {
		await new Promise((resolve) => setTimeout(resolve, 15));
		await writeFileAtomic(
			resolveNoteContentPath(notePath),
			serializeNoteContent(agentContent),
		);
		await yjsPersist.readLocalYNoteState(notePath);
	}

	const final = await yjsPersist.readLocalYNoteState(notePath);
	expect(fragmentText(final.snapshot)).toBe("agent body");
});

test("derived autosave attr shape does not fold (no cursor teleport)", async () => {
	const notePath = "Inbox/NoTeleportNote";
	// File shape EXACTLY as the TipTap editor saves it: every paragraph
	// carries attrs.textAlign (null when unset). y-prosemirror skips null
	// attrs when encoding, so the live fragment never has them — that shape
	// difference must not count as a fold trigger. Before the
	// canonicalFoldContent fix, every save echo replayed the whole body
	// (delete + fresh-ID insert) and teleported the live cursor to the end
	// of the document even though the text was byte-identical.
	const editorFile = (id: string, title: string, texts: string[]) => ({
		id,
		title,
		type: "doc",
		content: texts.map((text) => ({
			type: "paragraph",
			attrs: { textAlign: null },
			...(text ? { content: [{ type: "text", text }] } : {}),
		})),
	});

	await seedNote(notePath, editorFile("teleport-id", "Untitled", ["satu"]));

	// Live surface types a second paragraph (attr-less, like y-prosemirror
	// encodes it) and persists the keystroke.
	const base = await yjsPersist.readLocalYNoteState(notePath);
	const live = new Y.Doc();
	Y.applyUpdate(live, base.snapshot);
	const keystroke = typeParagraph(base.snapshot, "dua");
	await yjsPersist.appendLocalYNoteUpdate(notePath, keystroke);
	Y.applyUpdate(live, keystroke);
	const liveVector = Y.encodeStateVector(live);

	const snapshotBefore = (await yjsPersist.readLocalYNoteState(notePath))
		.snapshot;

	// Derived autosave rewrites note.json from editor state (WITH
	// textAlign:null on every paragraph, including the just-typed one)
	// without touching the snapshot — then the file watcher asks for a diff.
	const { writeFileAtomic, serializeNoteContent, resolveNoteContentPath } =
		workspace;
	await new Promise((resolve) => setTimeout(resolve, 15));
	await writeFileAtomic(
		resolveNoteContentPath(notePath),
		serializeNoteContent(editorFile("teleport-id", "Untitled", ["satu", "dua"])),
	);

	const delta = await yjsPersist.readLocalYNoteDiff(notePath, liveVector);
	// Converged: no fold replay, so no delete+insert hits the live doc and
	// the cursor stays where the user left it.
	expect(delta.diff.length).toBe(0);

	const snapshotAfter = (await yjsPersist.readLocalYNoteState(notePath))
		.snapshot;
	expect(Buffer.from(snapshotAfter)).toEqual(Buffer.from(snapshotBefore));
	expect(fragmentText(snapshotAfter)).toBe("satu\ndua");
	live.destroy();
});

test("diff returns only unseen bytes and empty diff when converged", async () => {
	const notePath = "Inbox/DiffNote";
	await seedNote(notePath, noteContent("diff-id", "v0", "base"));

	const base = await yjsPersist.readLocalYNoteState(notePath);
	const before = await yjsPersist.readLocalYNoteDiff(
		notePath,
		Y.encodeStateVector(new Y.Doc()),
	);
	// Empty local vector: diff carries the whole state.
	expect(before.diff.length).toBeGreaterThan(0);

	const current = new Y.Doc();
	Y.applyUpdate(current, base.snapshot);
	const converged = await yjsPersist.readLocalYNoteDiff(
		notePath,
		Y.encodeStateVector(current),
	);
	expect(converged.diff.length).toBe(0);

	// One more keystroke → diff carries exactly the delta.
	await yjsPersist.appendLocalYNoteUpdate(
		notePath,
		typeParagraph(base.snapshot, "delta check"),
	);
	const delta = await yjsPersist.readLocalYNoteDiff(
		notePath,
		Y.encodeStateVector(current),
	);
	expect(delta.diff.length).toBeGreaterThan(0);
	Y.applyUpdate(current, delta.diff);
	const full = await yjsPersist.readLocalYNoteState(notePath);
	const merged = new Y.Doc();
	Y.applyUpdate(merged, full.snapshot);
	expect(fragmentText(Y.encodeStateAsUpdate(current))).toBe(
		fragmentText(Y.encodeStateAsUpdate(merged)),
	);
});

test("empty yjs update is an explicit conflict, not silent loss", async () => {
	const notePath = "Inbox/Shared4";
	await seedNote(notePath, noteContent("id-4", "t", "base"));
	const error = await yjsPersist
		.appendLocalYNoteUpdate(notePath, new Uint8Array(0))
		.then(
			() => null,
			(error: unknown) => error as { code?: string; status?: number },
		);
	expect(error?.code).toBe("Y_CONFLICT");
	expect(error?.status).toBe(409);
});

test("missing state vector is an explicit conflict, not a silent empty", async () => {
	const notePath = "Inbox/DiffEmpty";
	await seedNote(notePath, noteContent("diff-empty-id", "t", "base"));
	const error = await yjsPersist
		.readLocalYNoteDiff(notePath, new Uint8Array(0))
		.then(
			() => null,
			(error: unknown) => error as { code?: string; status?: number },
		);
	expect(error?.code).toBe("Y_CONFLICT");
	expect(error?.status).toBe(409);
});
