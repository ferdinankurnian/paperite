const fs = require("node:fs/promises");
const path = require("node:path");
const Y = require("yjs");
const {
	normalizeNoteContent,
	revisionKey,
	writeFileAtomic,
	readNoteContent,
	workspaceRoot,
	currentNotePath,
	syncRoot,
	syncNotesRoot,
} = require("./workspace");

const syncNoteId = (notePath, content) => {
	const normalized = normalizeNoteContent(content);
	return typeof normalized.id === "string" && normalized.id
		? normalized.id
		: revisionKey(currentNotePath(notePath));
};

const syncNoteDirectory = (noteId) => path.join(syncNotesRoot(), noteId);
const syncNoteSnapshotPath = (noteId) =>
	path.join(syncNoteDirectory(noteId), "snapshot.bin");
const syncNoteStateVectorPath = (noteId) =>
	path.join(syncNoteDirectory(noteId), "state-vector.bin");
const syncNoteManifestPath = (noteId) =>
	path.join(syncNoteDirectory(noteId), "manifest.json");
const syncNoteUpdatesDirectory = (noteId) =>
	path.join(syncNoteDirectory(noteId), "updates");

const writeYNoteContent = (doc, content) => {
	const normalized = normalizeNoteContent(content);
	const { id, title, ...body } = normalized;
	const metadata = doc.getMap("metadata");
	const noteContent = doc.getMap("content");

	doc.transact(() => {
		if (typeof id === "string") metadata.set("id", id);
		if (typeof title === "string") metadata.set("title", title);
		metadata.set("updatedAt", Date.now());
		noteContent.set("body", body);
	});
};

const encodeYNoteFromContent = (content) => {
	const doc = new Y.Doc();
	writeYNoteContent(doc, content);

	return {
		state: Buffer.from(Y.encodeStateAsUpdate(doc)),
		stateVector: Buffer.from(Y.encodeStateVector(doc)),
	};
};

const writeLocalYNoteSnapshot = async (notePath, content) => {
	const normalizedContent = normalizeNoteContent(content);
	if (!normalizedContent.id) normalizedContent.id = crypto.randomUUID();

	const noteId = syncNoteId(notePath, normalizedContent);
	const noteDirectory = syncNoteDirectory(noteId);
	const updatesDirectory = syncNoteUpdatesDirectory(noteId);
	const encoded = encodeYNoteFromContent(normalizedContent);
	const now = Date.now();

	await fs.mkdir(updatesDirectory, { recursive: true });
	await writeFileAtomic(syncNoteSnapshotPath(noteId), encoded.state);
	await writeFileAtomic(syncNoteStateVectorPath(noteId), encoded.stateVector);
	await writeFileAtomic(
		path.join(updatesDirectory, `${now}-${process.pid}.bin`),
		encoded.state,
	);
	await writeFileAtomic(
		syncNoteManifestPath(noteId),
		JSON.stringify(
			{
				format: "yjs-v1",
				noteId,
				path: currentNotePath(notePath),
				updatedAt: now,
				snapshot: path.relative(noteDirectory, syncNoteSnapshotPath(noteId)),
				stateVector: path.relative(
					noteDirectory,
					syncNoteStateVectorPath(noteId),
				),
			},
			null,
			2,
		),
	);

	return { noteId, updatedAt: now };
};

const ensureLocalYNoteSnapshot = async (notePath, content) => {
	const noteId = syncNoteId(notePath, content);

	try {
		await fs.access(syncNoteSnapshotPath(noteId));
		return;
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}

	await writeLocalYNoteSnapshot(notePath, content);
};

const readLocalYNoteState = async (notePath) => {
	const normalizedPath = currentNotePath(notePath);
	const content = await readNoteContent(normalizedPath, true);
	await ensureLocalYNoteSnapshot(normalizedPath, content);

	const noteId = syncNoteId(normalizedPath, content);
	const snapshot = await fs.readFile(syncNoteSnapshotPath(noteId));

	return {
		noteId,
		format: "yjs-v1",
		snapshot: new Uint8Array(snapshot),
	};
};

const appendLocalYNoteUpdate = async (notePath, update) => {
	const normalizedPath = currentNotePath(notePath);
	const content = await readNoteContent(normalizedPath, true);
	await ensureLocalYNoteSnapshot(normalizedPath, content);

	const noteId = syncNoteId(normalizedPath, content);
	const noteDirectory = syncNoteDirectory(noteId);
	const updatesDirectory = syncNoteUpdatesDirectory(noteId);
	const updateBuffer = Buffer.from(update);
	const now = Date.now();
	const doc = new Y.Doc();
	const existingSnapshot = await fs.readFile(syncNoteSnapshotPath(noteId));

	Y.applyUpdate(doc, existingSnapshot);
	Y.applyUpdate(doc, updateBuffer);

	const snapshot = Buffer.from(Y.encodeStateAsUpdate(doc));
	const stateVector = Buffer.from(Y.encodeStateVector(doc));

	await fs.mkdir(updatesDirectory, { recursive: true });
	await writeFileAtomic(
		path.join(updatesDirectory, `${now}-${process.pid}.bin`),
		updateBuffer,
	);
	await writeFileAtomic(syncNoteSnapshotPath(noteId), snapshot);
	await writeFileAtomic(syncNoteStateVectorPath(noteId), stateVector);
	await writeFileAtomic(
		syncNoteManifestPath(noteId),
		JSON.stringify(
			{
				format: "yjs-v1",
				noteId,
				path: normalizedPath,
				updatedAt: now,
				snapshot: path.relative(noteDirectory, syncNoteSnapshotPath(noteId)),
				stateVector: path.relative(
					noteDirectory,
					syncNoteStateVectorPath(noteId),
				),
			},
			null,
			2,
		),
	);

	return { ok: true, noteId, updatedAt: now };
};

module.exports = {
	readLocalYNoteState,
	writeLocalYNoteSnapshot,
	appendLocalYNoteUpdate,
	ensureLocalYNoteSnapshot,
	syncNoteId,
	syncNoteDirectory,
	syncNoteSnapshotPath,
	syncNoteStateVectorPath,
	syncNoteManifestPath,
	syncNoteUpdatesDirectory,
	encodeYNoteFromContent,
	writeYNoteContent,
};
