const fs = require("node:fs/promises");
const path = require("node:path");
const Y = require("yjs");
const {
	normalizeNoteContent,
	revisionKey,
	writeFileAtomic,
	readNoteContent,
	currentNotePath,
	setPathRedirect: setWorkspaceRedirect,
	serializeNoteContent,
	writeRevisionSnapshot,
	resolveNoteContentPath,
	ensureNoteDirectory,
	syncNotesRoot,
} = require("./workspace");
const {
	yFragmentToNoteBody,
	writeNoteBodyToYFragment,
} = require("./yjs-fragment");

const syncNoteId = (notePath, content) => {
	const normalized = normalizeNoteContent(content);
	return typeof normalized.id === "string" && normalized.id
		? normalized.id
		: revisionKey(currentNotePath(notePath));
};

const syncNoteDirectory = (noteId) => path.join(syncNotesRoot(), noteId);
const syncNoteSnapshotPath = (noteId) =>
	path.join(syncNoteDirectory(noteId), "snapshot.bin");

// Snapshot writes are read-modify-write on shared files. Concurrent appends
// (multi-surface serve: electron + `paperite serve` + popout, keystroke
// bursts) read the same snapshot and the loser's update vanishes. Serialize
// per note — keyed by stable noteId when known, falling back to the
// normalized path. Two path spellings for the same note (legacy .json vs
// migrated dir, pre/post rename) must not get two independent locks, so the
// path→noteId map below promotes the path lock to the id lock once the id
// is resolved.
const yNoteWriteLocks = new Map();
const pathToNoteId = new Map();
const noteIdToPath = new Map();

const withYNoteWriteLock = (lockKey, task) => {
	const previous = yNoteWriteLocks.get(lockKey) ?? Promise.resolve();
	const next = previous.then(task, task);
	yNoteWriteLocks.set(lockKey, next);
	const cleanup = () => {
		if (yNoteWriteLocks.get(lockKey) === next) {
			yNoteWriteLocks.delete(lockKey);
		}
	};
	next.then(cleanup, cleanup);
	return next;
};

// Run `task` under the path lock, then — once the stable noteId is known —
// under the id lock too. Nested locks use different keys so there is no
// self-deadlock; the outer path lock makes id resolution itself race-free.
const withNoteWriteLock = (normalizedPath, task) => {
	const pathKey = `path:${normalizedPath}`;
	return withYNoteWriteLock(pathKey, () => {
		const noteId = pathToNoteId.get(normalizedPath);
		if (!noteId) return task();
		return withYNoteWriteLock(`id:${noteId}`, task);
	});
};

const registerNotePath = (noteId, normalizedPath) => {
	if (!noteId || !normalizedPath) return;
	pathToNoteId.set(normalizedPath, noteId);
	noteIdToPath.set(noteId, normalizedPath);
};

const registerNotePathRedirect = (fromPath, toPath) => {
	const { toPosixRelativePath } = require("./workspace");
	const from = toPosixRelativePath(fromPath);
	const to = toPosixRelativePath(toPath);
	setWorkspaceRedirect(from, to);
	const noteId = pathToNoteId.get(from);
	if (noteId) {
		pathToNoteId.delete(from);
		pathToNoteId.set(to, noteId);
		noteIdToPath.set(noteId, to);
	}
};

const clearNotePathRedirects = () => {
	const { clearPathRedirects } = require("./workspace");
	clearPathRedirects();
	pathToNoteId.clear();
	noteIdToPath.clear();
};

const clearYNoteLocksForTests = () => {
	yNoteWriteLocks.clear();
};

const conflictError = (message) => {
	const error = new Error(message);
	error.code = "Y_CONFLICT";
	error.status = 409;
	error.retryable = false;
	return error;
};

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
	// The live body lives in the fragment (keystrokes mutate it, never the
	// map). Seed it here so full-state writes set the body deterministically
	// instead of coin-flipping a map-key merge against concurrent state.
	writeNoteBodyToYFragment(doc, body);
};

const encodeYNoteFromContent = (content) => {
	const doc = new Y.Doc();
	writeYNoteContent(doc, content);

	return {
		state: Buffer.from(Y.encodeStateAsUpdate(doc)),
		stateVector: Buffer.from(Y.encodeStateVector(doc)),
	};
};

// Inverse of writeYNoteContent: project a merged Y.Doc back to NoteContent
// so note.json tracks the CRDT state. The body comes from the live fragment
// (what keystrokes actually mutate) — the `content.body` map goes stale on
// the first keystroke after load and must never be projected.
const yDocToNoteContent = (doc, fallback) => {
	const metadata = doc.getMap("metadata");
	const fragmentBody = yFragmentToNoteBody(doc);
	const body =
		fragmentBody && typeof fragmentBody === "object"
			? { ...fragmentBody }
			: { type: "doc", content: [{ type: "paragraph" }] };
	const id = metadata.get("id");
	const title = metadata.get("title");
	const normalizedFallback = normalizeNoteContent(fallback ?? {});
	const out = { ...body };
	if (typeof id === "string" && id) out.id = id;
	else if (typeof normalizedFallback.id === "string")
		out.id = normalizedFallback.id;
	if (typeof title === "string") out.title = title;
	else if (typeof normalizedFallback.title === "string")
		out.title = normalizedFallback.title;
	if (
		out.pageFormat === undefined &&
		normalizedFallback.pageFormat !== undefined
	)
		out.pageFormat = normalizedFallback.pageFormat;
	if (out.pinned === undefined && normalizedFallback.pinned !== undefined)
		out.pinned = normalizedFallback.pinned;
	return normalizeNoteContent(out);
};

const readManifestNoteId = async (noteId) => {
	try {
		const raw = await fs.readFile(syncNoteManifestPath(noteId), "utf8");
		const manifest = JSON.parse(raw);
		return typeof manifest?.noteId === "string" ? manifest : null;
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		throw error;
	}
};

const writeManifest = async (noteId, normalizedPath, noteDirectory, now) => {
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
};

// Stable identity across direct file writes: prefer the id whose snapshot
// lineage already exists (manifest on disk), falling back to the
// path→noteId cache, and only then to the file's own id. Without this, a
// file that dropped its id would mint a fresh random one per read (ensureId)
// and fork a second snapshot. Pins `content.id` in place.
const resolveStableNoteIdLocked = async (normalizedPath, content) => {
	const fileId =
		typeof content?.id === "string" && content.id ? content.id : null;
	if (fileId && (await readManifestNoteId(fileId))) return fileId;
	const cached = pathToNoteId.get(normalizedPath);
	if (cached && (await readManifestNoteId(cached))) {
		if (content) content.id = cached;
		return cached;
	}
	if (fileId) return fileId;
	if (cached) {
		if (content) content.id = cached;
		return cached;
	}
	return revisionKey(normalizedPath);
};

// Order-insensitive deep compare for fold decisions (projection builds
// keys in a different order than the file on disk).
const stableStringify = (value) => {
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	if (value && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
};

// y-prosemirror skips null-valued attributes when encoding ProseMirror → Y
// (createTypeFromElementNode: `val !== null`), but the editor serializes
// defaults like `textAlign: null` into note.json on every save. Without
// canonicalization the fold "already covered" check below sees a phantom
// diff on every derived autosave and replays the whole body (delete +
// fresh-ID insert) — the live cursor teleports to the end of the document
// even though the text is byte-identical. Strip null attrs (and attrs left
// empty by that) on both sides before comparing: a null attr is
// ProseMirror's spelling of "default", so it must never count as news.
const canonicalFoldContent = (value) => {
	if (Array.isArray(value)) return value.map(canonicalFoldContent);
	if (value !== null && typeof value === "object") {
		const out = {};
		for (const key of Object.keys(value)) {
			let entry = value[key];
			if (
				key === "attrs" &&
				entry !== null &&
				typeof entry === "object" &&
				!Array.isArray(entry)
			) {
				const attrs = {};
				for (const [attrKey, attrVal] of Object.entries(entry)) {
					if (attrVal !== null && attrVal !== undefined) {
						attrs[attrKey] = attrVal;
					}
				}
				if (Object.keys(attrs).length === 0) continue;
				entry = attrs;
			} else {
				entry = canonicalFoldContent(entry);
			}
			out[key] = entry;
		}
		return out;
	}
	return value;
};

// AI agents (and anything else writing files directly) bypass the Y update
// path: they rewrite note.json without touching the snapshot. If note.json
// is newer than the snapshot manifest, fold it into the snapshot via CRDT
// merge first — otherwise live watchers diffing the snapshot never see the
// external write. Our own projection always writes the file BEFORE the
// manifest, so file-newer-than-manifest unambiguously means "external".
// Call AFTER resolveStableNoteIdLocked so `content.id` is already pinned.
const foldNoteFileIntoSnapshotLocked = async (normalizedPath, content) => {
	const noteId =
		typeof content?.id === "string" && content.id
			? content.id
			: (pathToNoteId.get(normalizedPath) ?? null);
	if (!noteId) return { noteId: null, folded: false };
	const manifest = await readManifestNoteId(noteId);
	if (!manifest) return { noteId, folded: false };

	let stats = null;
	try {
		stats = await fs.stat(resolveNoteContentPath(normalizedPath));
	} catch (error) {
		if (error?.code === "ENOENT") return { noteId, folded: false };
		throw error;
	}
	if (!(stats.mtimeMs > manifest.updatedAt)) {
		return { noteId, folded: false };
	}

	// The file moved, but is it news? Our own derived autosaves also bump
	// the file without touching the snapshot — if the fragment already
	// decodes to the same content, the snapshot covers the file and we only
	// advance the manifest timestamp (no snapshot churn, no clobber).
	const snapshotBytes = await fs.readFile(syncNoteSnapshotPath(noteId));
	const probe = new Y.Doc();
	let alreadyCovered = false;
	try {
		Y.applyUpdate(probe, snapshotBytes);
		const projected = yDocToNoteContent(probe, content);
		alreadyCovered =
			stableStringify(canonicalFoldContent(projected)) ===
			stableStringify(canonicalFoldContent(normalizeNoteContent(content)));
	} catch {
		alreadyCovered = false;
	} finally {
		probe.destroy();
	}
	if (alreadyCovered) {
		await writeManifest(
			noteId,
			normalizedPath,
			syncNoteDirectory(noteId),
			Date.now(),
		);
		registerNotePath(noteId, normalizedPath);
		return { noteId, folded: false };
	}

	const result = await writeLocalYNoteSnapshotLocked(normalizedPath, content);
	return { noteId: result.noteId, folded: true };
};

// Incremental live-watch primitive: bytes the caller's state vector has not
// seen yet. A corrupt/unknown vector is an explicit conflict (client falls
// back to a full snapshot read) — never a silent empty diff.
const readLocalYNoteDiff = (notePath, stateVector) => {
	const normalizedPath = currentNotePath(notePath);
	return withNoteWriteLock(normalizedPath, () =>
		readLocalYNoteDiffLocked(normalizedPath, stateVector),
	);
};

const readLocalYNoteDiffLocked = async (normalizedPath, stateVector) => {
	const sv = Buffer.from(stateVector ?? []);
	if (sv.length === 0) throw conflictError("missing state vector");
	const content = await readNoteContent(normalizedPath, true);
	const noteId = await resolveStableNoteIdLocked(normalizedPath, content);
	await ensureLocalYNoteSnapshotLocked(normalizedPath, content);
	await foldNoteFileIntoSnapshotLocked(normalizedPath, content);
	const snapshot = await fs.readFile(syncNoteSnapshotPath(noteId));
	registerNotePath(noteId, normalizedPath);
	let diff;
	try {
		diff = Buffer.from(Y.diffUpdate(snapshot, new Uint8Array(sv)));
	} catch (error) {
		throw conflictError(`unreadable state vector: ${error.message}`);
	}
	// Y.diffUpdate encodes "nothing new" as 2 bytes, not zero — and applying
	// that would still fire the doc's update event, causing an echo write on
	// every poll. Compare clocks explicitly and return true-zero instead.
	if (isSnapshotConverged(snapshot, new Uint8Array(sv))) {
		return { noteId, format: "yjs-v1", diff: new Uint8Array(0) };
	}
	return { noteId, format: "yjs-v1", diff: new Uint8Array(diff) };
};

// True when the client's state vector already covers the snapshot: every
// clock the snapshot knows is at or behind the client's. Lets watchers
// distinguish "nothing new" (zero bytes, skip) from "delta" cheaply.
const isSnapshotConverged = (snapshot, clientSv) => {
	let clientClocks;
	try {
		clientClocks = Y.decodeStateVector(clientSv);
	} catch {
		return false;
	}
	const probe = new Y.Doc();
	try {
		Y.applyUpdate(probe, Buffer.from(snapshot));
		const serverClocks = Y.decodeStateVector(Y.encodeStateVector(probe));
		for (const [clientId, clock] of serverClocks) {
			if ((clientClocks.get(clientId) ?? 0) < clock) return false;
		}
		return true;
	} catch {
		return false;
	} finally {
		probe.destroy();
	}
};

const writeLocalYNoteSnapshot = async (notePath, content) => {
	const normalizedPath = currentNotePath(notePath);
	return withNoteWriteLock(normalizedPath, () =>
		writeLocalYNoteSnapshotLocked(normalizedPath, content),
	);
};

const writeLocalYNoteSnapshotLocked = async (normalizedPath, content) => {
	const normalizedContent = normalizeNoteContent(content);
	if (!normalizedContent.id) normalizedContent.id = crypto.randomUUID();

	const noteId = await resolveStableNoteIdLocked(
		normalizedPath,
		normalizedContent,
	);
	const noteDirectory = syncNoteDirectory(noteId);
	const updatesDirectory = syncNoteUpdatesDirectory(noteId);
	const encoded = encodeYNoteFromContent(normalizedContent);
	const now = Date.now();

	await fs.mkdir(updatesDirectory, { recursive: true });

	// Full-state intent wins the body DETERMINISTICALLY: replay the incoming
	// body into the stored lineage with a real delete+insert in ONE
	// transaction, so old items are tombstoned instead of kept alongside the
	// new ones. A raw CRDT apply of a fresh full state on top of existing
	// state APPENDED the body (fresh inserts share the null left-origin with
	// the stored head, so both survive the merge) — every fold/save pass
	// duplicated the note without bound. Causal keystroke deltas still merge
	// via appendLocalYNoteUpdate; this path is only for whole-file states
	// (PUT, agent fold, first seed), where the file is the source of truth.
	let snapshot = encoded.state;
	let merged = false;
	try {
		const existingSnapshot = await fs.readFile(syncNoteSnapshotPath(noteId));
		if (existingSnapshot.length > 0) {
			const doc = new Y.Doc();
			try {
				Y.applyUpdate(doc, existingSnapshot);
				const { id, title, ...body } = normalizedContent;
				doc.transact(() => {
					writeNoteBodyToYFragment(doc, body);
					doc.getMap("content").set("body", body);
					const metadata = doc.getMap("metadata");
					if (typeof normalizedContent.id === "string") {
						metadata.set("id", normalizedContent.id);
					}
					if (typeof normalizedContent.title === "string") {
						metadata.set("title", normalizedContent.title);
					}
					metadata.set("updatedAt", now);
				});
				snapshot = Buffer.from(Y.encodeStateAsUpdate(doc));
				merged = true;
			} finally {
				doc.destroy();
			}
		}
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
		// No stored snapshot yet — first write wins by definition.
	}
	const stateVector = (() => {
		const doc = new Y.Doc();
		try {
			Y.applyUpdate(doc, snapshot);
			return Buffer.from(Y.encodeStateVector(doc));
		} finally {
			doc.destroy();
		}
	})();

	await writeFileAtomic(syncNoteSnapshotPath(noteId), snapshot);
	await writeFileAtomic(syncNoteStateVectorPath(noteId), stateVector);
	await writeFileAtomic(
		path.join(updatesDirectory, `${now}-${process.pid}.bin`),
		encoded.state,
	);
	await writeManifest(noteId, normalizedPath, noteDirectory, now);
	registerNotePath(noteId, normalizedPath);

	return { noteId, updatedAt: now, merged };
};

const ensureLocalYNoteSnapshot = (notePath, content) => {
	const normalizedPath = currentNotePath(notePath);
	return withNoteWriteLock(normalizedPath, () =>
		ensureLocalYNoteSnapshotLocked(normalizedPath, content),
	);
};

const ensureLocalYNoteSnapshotLocked = async (normalizedPath, content) => {
	const noteId = await resolveStableNoteIdLocked(normalizedPath, content);

	try {
		await fs.access(syncNoteSnapshotPath(noteId));
		registerNotePath(noteId, normalizedPath);
		return;
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}

	await writeLocalYNoteSnapshotLocked(normalizedPath, content);
};

const readLocalYNoteState = (notePath) => {
	const normalizedPath = currentNotePath(notePath);
	return withNoteWriteLock(normalizedPath, () =>
		readLocalYNoteStateLocked(normalizedPath),
	);
};

const readLocalYNoteStateLocked = async (normalizedPath) => {
	let content;
	try {
		content = await readNoteContent(normalizedPath, true);
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
		// No note.json yet (note created Y-first): fall back to the known
		// noteId so the snapshot stays addressable instead of throwing a
		// bare ENOENT that the client cannot act on.
		const cached = pathToNoteId.get(normalizedPath);
		if (!cached) throw error;
		const snapshot = await fs.readFile(syncNoteSnapshotPath(cached));
		return {
			noteId: cached,
			format: "yjs-v1",
			snapshot: new Uint8Array(snapshot),
		};
	}
	// Pin the stable id BEFORE ensuring: otherwise a file that dropped its
	// id would fork a fresh snapshot under a random id here.
	const noteId = await resolveStableNoteIdLocked(normalizedPath, content);
	await ensureLocalYNoteSnapshotLocked(normalizedPath, content);

	// A direct file write (AI agent) newer than the snapshot folds in first,
	// so live watchers see it on their next diff instead of never.
	await foldNoteFileIntoSnapshotLocked(normalizedPath, content);
	const snapshot = await fs.readFile(syncNoteSnapshotPath(noteId));
	registerNotePath(noteId, normalizedPath);

	return {
		noteId,
		format: "yjs-v1",
		snapshot: new Uint8Array(snapshot),
	};
};

const appendLocalYNoteUpdate = (notePath, update) => {
	const normalizedPath = currentNotePath(notePath);
	return withNoteWriteLock(normalizedPath, () =>
		appendLocalYNoteUpdateLocked(normalizedPath, update),
	);
};

const appendLocalYNoteUpdateLocked = async (normalizedPath, update) => {
	const updateBuffer = Buffer.from(update ?? []);
	if (updateBuffer.length === 0) throw conflictError("empty yjs update");
	if (updateBuffer.length > 10 * 1024 * 1024)
		throw conflictError("yjs update exceeds 10mb limit");

	const content = await readNoteContent(normalizedPath, true).catch((error) => {
		if (error?.code !== "ENOENT") throw error;
		const cached = pathToNoteId.get(normalizedPath);
		// Y-first note with no note.json yet: the snapshot (already ensured
		// below via the cached id) is the source of truth; projection recreates
		// note.json so the file and CRDT state never split.
		if (cached) return { id: cached };
		throw conflictError(`note not found: ${normalizedPath}`);
	});
	const noteId = await resolveStableNoteIdLocked(normalizedPath, content);
	await ensureLocalYNoteSnapshotLocked(normalizedPath, content);

	const noteDirectory = syncNoteDirectory(noteId);
	const updatesDirectory = syncNoteUpdatesDirectory(noteId);
	const now = Date.now();
	const doc = new Y.Doc();
	try {
		const existingSnapshot = await fs.readFile(syncNoteSnapshotPath(noteId));
		try {
			Y.applyUpdate(doc, existingSnapshot);
		} catch (error) {
			throw conflictError(`stored snapshot is corrupt: ${error.message}`);
		}
		try {
			Y.applyUpdate(doc, updateBuffer);
		} catch (error) {
			throw conflictError(`invalid yjs update: ${error.message}`);
		}

		const snapshot = Buffer.from(Y.encodeStateAsUpdate(doc));
		const stateVector = Buffer.from(Y.encodeStateVector(doc));

		await fs.mkdir(updatesDirectory, { recursive: true });
		await writeFileAtomic(
			path.join(updatesDirectory, `${now}-${process.pid}.bin`),
			updateBuffer,
		);
		await writeFileAtomic(syncNoteSnapshotPath(noteId), snapshot);
		await writeFileAtomic(syncNoteStateVectorPath(noteId), stateVector);

		// Project the merged CRDT state back to note.json under the same
		// lock so a server kill-restart cannot lose Y updates that never
		// touched the derived/PUT path. The file lands BEFORE the manifest
		// so the fold check (file-newer-than-manifest = external) stays
		// unambiguous for our own writes.
		const projected = yDocToNoteContent(doc, content);
		if (!projected.id) projected.id = noteId;
		await ensureNoteDirectory(normalizedPath);
		await writeRevisionSnapshot(normalizedPath, projected);
		await writeFileAtomic(
			resolveNoteContentPath(normalizedPath),
			serializeNoteContent(projected),
		);
		await writeManifest(noteId, normalizedPath, noteDirectory, Date.now());
	} finally {
		doc.destroy();
	}
	registerNotePath(noteId, normalizedPath);

	return { ok: true, noteId, updatedAt: now };
};

module.exports = {
	readLocalYNoteState,
	writeLocalYNoteSnapshot,
	appendLocalYNoteUpdate,
	ensureLocalYNoteSnapshot,
	readLocalYNoteDiff,
	writeLocalYNoteSnapshotLocked,
	appendLocalYNoteUpdateLocked,
	readLocalYNoteStateLocked,
	ensureLocalYNoteSnapshotLocked,
	readLocalYNoteDiffLocked,
	foldNoteFileIntoSnapshotLocked,
	resolveStableNoteIdLocked,
	syncNoteId,
	syncNoteDirectory,
	syncNoteSnapshotPath,
	syncNoteStateVectorPath,
	syncNoteManifestPath,
	syncNoteUpdatesDirectory,
	encodeYNoteFromContent,
	writeYNoteContent,
	yDocToNoteContent,
	withYNoteWriteLock,
	withNoteWriteLock,
	registerNotePath,
	registerNotePathRedirect,
	clearNotePathRedirects,
	clearYNoteLocksForTests,
	readManifestNoteId,
};
