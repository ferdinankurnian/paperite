const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const http = require("node:http");
const nodeCrypto = require("node:crypto");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
	app,
	BrowserWindow,
	ipcMain,
	Menu,
	powerMonitor,
	shell,
	dialog,
} = require("electron");
const Y = require("yjs");
const {
	yFragmentToNoteBody,
	writeNoteBodyToYFragment,
} = require("./server/lib/yjs-fragment");
const deviceAuth = require("./server/lib/device-auth");

let keytar;

try {
	keytar = require("keytar");
} catch {
	keytar = null;
}

const loadLocalEnv = () => {
	const loadEnvFile = (fileName, override = false) => {
		const envPath = path.join(__dirname, fileName);

		try {
			const env = fsSync.readFileSync(envPath, "utf8");

			for (const line of env.split(/\r?\n/)) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith("#")) continue;

				const separatorIndex = trimmed.indexOf("=");
				if (separatorIndex === -1) continue;

				const key = trimmed.slice(0, separatorIndex).trim();
				const rawValue = trimmed.slice(separatorIndex + 1).trim();
				const value = rawValue.replace(/^(['"])(.*)\1$/, "$2");

				if (key && (override || process.env[key] === undefined)) {
					process.env[key] = value;
				}
			}
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}
	};

	loadEnvFile(".env");
	loadEnvFile(".env.local", true);
};

loadLocalEnv();

// Headless mode: the packaged binary (AppImage, tarball, or `electron .`)
// doubles as the `paperite serve` CLI. Boot the standalone server and skip
// every window / single-instance branch below — the http server keeps the
// event loop alive. `serve` must be the first user arg:
// packaged: [binary, serve, ...], dev: [electron, ., serve, ...].
// A bare includes() check is too wide: `paperite --workspace serve` (a
// directory literally named "serve") must boot Electron, not headless.
// `paperite` with no args boots normal Electron; only an explicit serve
// token enters headless mode. server/index.js owns help/lock/port errors
// and exits the process itself, so Electron must not create windows after.
const serveRawArgs = process.argv.slice(1);
const serveUserArgs =
	serveRawArgs[0] === "." || serveRawArgs[0]?.endsWith(".js")
		? serveRawArgs.slice(1)
		: serveRawArgs;
const isServeMode =
	serveUserArgs[0] === "serve" || serveUserArgs[0] === "--serve";

if (isServeMode) {
	require("./server/index.js");
}

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const shouldUseMacChrome = process.platform === "darwin";
const shouldSimulateMacChrome = process.env.IS_MACOS === "1";
const shouldUseMacLayout = shouldUseMacChrome || shouldSimulateMacChrome;

// Blank window after lock/suspend (linux): chromium backgrounds occluded
// renderers — paint + timers pause while the screen is locked. On some
// wayland compositors the occlusion signal sticks after unlock, so the
// page never repaints until a manual reload. Discord/VSCode ship these
// same switches; must run before app.ready.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
let mainWindow; // hoist ke luar
const popoutWindows = new Map(); // key: notePath, value: BrowserWindow
let pendingAuthCallbackUrl;
let workspaceWatchTimer;
const workspaceWatchers = new Map();
let indexDb;
let workspaceOwnerServer;
let workspaceOwnerWs;
let workspaceOwnerSecret;
let attachedServeUrl;
const pendingBridgeRequests = new Map();

const requestAttachedApi = async (apiPath, options = {}) => {
	if (!attachedServeUrl) throw new Error("workspace owner is not attached");
	const response = await fetch(`${attachedServeUrl}${apiPath}`, {
		headers: { "content-type": "application/json", ...options.headers },
		...options,
	});
	if (!response.ok) {
		throw new Error(`workspace owner API ${response.status}`);
	}
	return response.json();
};
let legacyMigrationPromise;
const legacyPathMigrations = new Map();
const ownerRpcHandlers = new Map();

const registerOwnerIpcHandler = (channel, handler) => {
	ownerRpcHandlers.set(channel, handler);
	return ipcMain.handle(channel, handler);
};

const requestRendererBridge = (kind, payload = {}) => {
	if (!mainWindow || mainWindow.isDestroyed()) {
		return Promise.reject(new Error("Paperite window is unavailable"));
	}

	const requestId = nodeCrypto.randomUUID();
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			pendingBridgeRequests.delete(requestId);
			reject(new Error("Paperite renderer did not answer the auth request"));
		}, 5000);
		pendingBridgeRequests.set(requestId, {
			resolve,
			reject,
			timeout,
		});
		mainWindow.webContents.send(`auth:bridge-${kind}-request`, {
			requestId,
			...payload,
		});
	});
};

const resolveBridgeRequest = (requestId, result, error) => {
	const pending = pendingBridgeRequests.get(requestId);
	if (!pending) return;
	clearTimeout(pending.timeout);
	pendingBridgeRequests.delete(requestId);
	if (error) pending.reject(new Error(String(error)));
	else pending.resolve(result);
};

ipcMain.on("auth:bridge-session-response", (_event, requestId, result) => {
	resolveBridgeRequest(requestId, result, result?.error);
});
ipcMain.on("auth:bridge-sessions-response", (_event, requestId, result) => {
	resolveBridgeRequest(requestId, result, result?.error);
});
ipcMain.on("auth:bridge-sign-out-response", (_event, requestId, result) => {
	resolveBridgeRequest(requestId, result, result?.error);
});

const workspaceRoot = () => path.join(app.getPath("documents"), "Paperite");
const trashRoot = () => path.join(workspaceRoot(), "Trash");
const trashMetaPath = () => path.join(trashRoot(), ".trash-meta.json");
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const statePath = () => path.join(workspaceRoot(), ".paperite", "state.json");
const indexPath = () => path.join(workspaceRoot(), ".paperite", "index.sqlite");
const revisionsRoot = () =>
	path.join(workspaceRoot(), ".paperite", "revisions");
const syncRoot = () => path.join(workspaceRoot(), ".paperite", "sync");
const syncNotesRoot = () => path.join(syncRoot(), "notes");
const tombstonesPath = () =>
	path.join(workspaceRoot(), ".paperite", "tombstones.jsonl");

const keychainService = "dev.iydheko.paperite";
const personalServerCredentialAccount = (connectionId) =>
	`personal-server-credential:${connectionId}`;

const purgeLegacyDriveToken = async () => {
	const legacyTokenAccount = ["google", "drive", "token"].join("-");
	try {
		if (keytar)
			await keytar.deletePassword(keychainService, legacyTokenAccount);
	} catch {
		// Legacy cleanup is best effort; startup must not fail over an old token.
	}
	try {
		await fs.rm(path.join(syncRoot(), `${legacyTokenAccount}.json`), {
			force: true,
		});
	} catch {
		// Best effort cleanup of the pre-keychain token file.
	}
};

const validateCredentialConnectionId = (connectionId) => {
	if (
		typeof connectionId !== "string" ||
		!connectionId ||
		connectionId.length > 200 ||
		!/^[A-Za-z0-9._:-]+$/.test(connectionId)
	) {
		throw new Error("Invalid personal-server connection id");
	}
	return connectionId;
};

const readPersonalServerCredential = async (connectionId) => {
	if (!keytar) {
		throw new Error(
			"OS keychain is unavailable for personal-server credentials",
		);
	}
	return keytar.getPassword(
		keychainService,
		personalServerCredentialAccount(
			validateCredentialConnectionId(connectionId),
		),
	);
};

const writePersonalServerCredential = async (connectionId, credential) => {
	if (!keytar) {
		throw new Error(
			"OS keychain is unavailable for personal-server credentials",
		);
	}
	if (typeof credential !== "string" || !credential) {
		throw new Error("Personal-server credential is empty");
	}
	await keytar.setPassword(
		keychainService,
		personalServerCredentialAccount(
			validateCredentialConnectionId(connectionId),
		),
		credential,
	);
	return { ok: true };
};

const deletePersonalServerCredential = async (connectionId) => {
	if (keytar) {
		await keytar.deletePassword(
			keychainService,
			personalServerCredentialAccount(
				validateCredentialConnectionId(connectionId),
			),
		);
	}
	return { ok: true };
};

const normalizeRelativePath = (relativePath = "") => {
	const normalized = path
		.normalize(relativePath)
		.replace(/^(\.\.(\/|\\|$))+/, "");
	if (path.isAbsolute(normalized)) {
		throw new Error("absolute paths are not allowed");
	}
	return normalized === "." ? "" : normalized;
};

const resolveWorkspacePath = (relativePath = "") => {
	const root = workspaceRoot();
	const target = path.resolve(root, normalizeRelativePath(relativePath));

	if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
		throw new Error("path escapes workspace");
	}

	return target;
};

const ensureWorkspace = async () => {
	await fs.mkdir(path.join(workspaceRoot(), "Inbox"), { recursive: true });
	await fs.mkdir(trashRoot(), { recursive: true });
	await fs.mkdir(path.dirname(statePath()), { recursive: true });
	await fs.mkdir(revisionsRoot(), { recursive: true });
	await fs.mkdir(syncNotesRoot(), { recursive: true });
};

const readTrashMeta = async () => {
	try {
		return JSON.parse(await fs.readFile(trashMetaPath(), "utf8"));
	} catch {
		return {};
	}
};

const writeTrashMeta = async (meta) => {
	await writeFileAtomic(trashMetaPath(), JSON.stringify(meta, null, 2));
};

const purgeOldTrashItems = async () => {
	try {
		await ensureWorkspace();
		const trashMeta = await readTrashMeta();
		const now = Date.now();
		let changed = false;

		for (const [name, meta] of Object.entries(trashMeta)) {
			if (now - meta.deletedAt > TRASH_RETENTION_MS) {
				await fs
					.rm(path.join(trashRoot(), name), { recursive: true, force: true })
					.catch(() => {});
				delete trashMeta[name];
				changed = true;
			}
		}

		if (changed) await writeTrashMeta(trashMeta);
	} catch (error) {
		console.error("[paperite] trash auto-purge failed:", error);
	}
};

const scanTrashDirectory = async () => {
	const trashMeta = await readTrashMeta();
	const entries = await fs.readdir(trashRoot(), { withFileTypes: true });
	const notes = [];

	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

		const metaEntry = trashMeta[entry.name];
		if (!metaEntry) continue;

		try {
			const manifestPath = path.join(
				trashRoot(),
				entry.name,
				noteManifestFilename,
			);
			const stats = await fs.stat(manifestPath);
			const rawContent = await fs.readFile(manifestPath, "utf8");
			const content = normalizeNoteContent(JSON.parse(rawContent.trim()));
			const title =
				readNoteTitle(content) || toNoteTitle(entry.name) || "Untitled";
			const preview = toNotePreviewFromContent(content);

			notes.push({
				title,
				trashPath: `Trash/${entry.name}`,
				originalPath: metaEntry.originalPath,
				deletedAt: metaEntry.deletedAt,
				preview,
			});
		} catch {
			// Skip entries that can't be read
		}
	}

	notes.sort((a, b) => b.deletedAt - a.deletedAt);
	return notes;
};

const writeFileAtomic = async (targetPath, content) => {
	const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;

	try {
		await fs.writeFile(
			temporaryPath,
			content,
			typeof content === "string" ? "utf8" : undefined,
		);
		await fs.rename(temporaryPath, targetPath);
	} catch (error) {
		await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
		throw error;
	}
};

const noteFileExtension = ".json";
const noteManifestFilename = "note.json";
const noteAssetsDirectoryName = "assets";
const toPosixRelativePath = (relativePath = "") =>
	normalizeRelativePath(relativePath).replaceAll(path.sep, "/");
const isNoteManifestPath = (itemPath) =>
	path.posix.basename(itemPath) === noteManifestFilename;
const noteContentPath = (notePath) =>
	path.posix.join(toPosixRelativePath(notePath), noteManifestFilename);
const resolveNoteContentPath = (notePath) =>
	resolveWorkspacePath(noteContentPath(notePath));
const noteAssetsPath = (notePath) =>
	path.posix.join(toPosixRelativePath(notePath), noteAssetsDirectoryName);
const currentNotePath = (notePath) => {
	const normalized = toPosixRelativePath(notePath);
	return legacyPathMigrations.get(normalized) ?? normalized;
};
const isNoteFilePath = (itemPath) =>
	/\.json$/i.test(itemPath) && !isNoteManifestPath(itemPath);
const isLegacyMarkdownPath = (itemPath) => /\.md$/i.test(itemPath);
const isMigratableNotePath = (itemPath) =>
	isNoteFilePath(itemPath) || isLegacyMarkdownPath(itemPath);
const toNoteTitle = (filename) => filename.replace(/\.(?:json|md)$/i, "");

const createEmptyNoteContent = (title) => ({
	id: crypto.randomUUID(),
	type: "doc",
	...(title ? { title } : {}),
	content: [{ type: "paragraph" }],
});

const normalizePageFormat = (format) => ({
	indentation:
		format?.indentation === "first-line" || format?.firstLineIndent === true
			? "first-line"
			: format?.indentation === "hanging"
				? "hanging"
				: "none",
	lineHeight: format?.lineHeight === "1.5" ? "1.5" : "normal",
	paragraphSpacing:
		format?.paragraphSpacing === "spacious" ? "spacious" : "none",
	dragHandle: format?.dragHandle === true,
});

const isUuidFilename = (notePath) =>
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.json)?$/i.test(
		path.posix.basename(notePath),
	);

const readNoteTitle = (content) => {
	const normalized = normalizeNoteContent(content);
	return typeof normalized.title === "string" ? normalized.title : "";
};

const isNoteDirectory = async (notePath) => {
	try {
		const stats = await fs.stat(resolveNoteContentPath(notePath));
		return stats.isFile();
	} catch (error) {
		if (error?.code === "ENOENT") return false;
		throw error;
	}
};

const ensureNoteDirectory = async (notePath) => {
	await fs.mkdir(resolveWorkspacePath(notePath), { recursive: true });
	await fs.mkdir(resolveWorkspacePath(noteAssetsPath(notePath)), {
		recursive: true,
	});
};

const isPlainObject = (value) =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const textToNoteContent = (text) => ({
	type: "doc",
	content: text.split(/\r?\n/).map((line) => ({
		type: "paragraph",
		content: line ? [{ type: "text", text: line }] : undefined,
	})),
});

const normalizeNoteContent = (content) => {
	if (isPlainObject(content) && typeof content.type === "string") {
		return content;
	}

	if (typeof content === "string") return textToNoteContent(content);

	return createEmptyNoteContent();
};

const serializeNoteContent = (content) =>
	JSON.stringify(normalizeNoteContent(content), null, 2);

const collectNoteText = (node, chunks) => {
	if (typeof node?.text === "string") chunks.push(node.text);

	for (const child of node?.content ?? []) collectNoteText(child, chunks);

	if (
		node?.type === "paragraph" ||
		node?.type === "heading" ||
		node?.type === "blockquote" ||
		node?.type === "codeBlock" ||
		node?.type === "listItem" ||
		node?.type === "taskItem"
	) {
		if (chunks.at(-1) !== "\n") chunks.push("\n");
	}
};

const noteContentText = (content) => {
	const chunks = [];
	collectNoteText(normalizeNoteContent(content), chunks);
	return chunks.join("").replace(/\n+$/g, "");
};

const toNotePreviewFromContent = (content) =>
	noteContentText(content)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find(Boolean) ?? "";

const readNoteContent = async (notePath, ensureId) => {
	const normalizedPath = currentNotePath(notePath);
	const rawContent = await fs.readFile(
		isMigratableNotePath(normalizedPath)
			? resolveWorkspacePath(normalizedPath)
			: resolveNoteContentPath(normalizedPath),
		"utf8",
	);
	const trimmedContent = rawContent.trim();

	if (!trimmedContent) return createEmptyNoteContent();

	if (isLegacyMarkdownPath(normalizedPath)) {
		const content = textToNoteContent(rawContent);
		if (ensureId && !content.id) content.id = crypto.randomUUID();
		return content;
	}

	try {
		const content = normalizeNoteContent(JSON.parse(rawContent));
		if (ensureId && !content.id) content.id = crypto.randomUUID();
		return content;
	} catch {
		const content = textToNoteContent(rawContent);
		if (ensureId && !content.id) content.id = crypto.randomUUID();
		return content;
	}
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

// Snapshot writes are read-modify-write on shared files. Keystroke bursts fire
// many concurrent IPC appends — without a per-note lock, two handlers read the
// same snapshot, merge separately, and the loser's update vanishes from the
// snapshot (observed as stale/corrupt snapshot.bin). Serialize per note path.
const yNoteWriteLocks = new Map();
const yPathToNoteId = new Map();

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

// Mirror of server/lib/yjs-persist.js withNoteWriteLock (022: every fix
// lands in both copies until phase 2b deletes one). Run `task` under the
// path lock, then — once the stable noteId is known — under the id lock
// too. Nested locks use different keys so there is no self-deadlock; the
// outer path lock makes id resolution itself race-free.
const withNoteWriteLock = (normalizedPath, task) => {
	const pathKey = `path:${normalizedPath}`;
	return withYNoteWriteLock(pathKey, () => {
		const noteId = yPathToNoteId.get(normalizedPath);
		if (!noteId) return task();
		return withYNoteWriteLock(`id:${noteId}`, task);
	});
};

// Stable per-note identity: two path spellings (or a pre/post-rename path)
// for one note must share one snapshot lineage, or concurrent writers fork
// it. Populated by every op below.
const registerYNotePath = (noteId, normalizedPath) => {
	if (!noteId || !normalizedPath) return;
	yPathToNoteId.set(normalizedPath, noteId);
};

// Rename rekey for the Electron copy of the Y map (mirror of
// registerNotePathRedirect in server/lib/yjs-persist.js — 022: every fix
// lands in both copies until phase 2b deletes one). Moves the entry and
// the whole subtree so a renamed folder keeps its snapshot lineage.
const registerYNotePathRedirect = (fromPath, toPath) => {
	if (!fromPath || !toPath || fromPath === toPath) return;
	for (const [notePath, noteId] of [...yPathToNoteId]) {
		if (notePath !== fromPath && !notePath.startsWith(`${fromPath}/`)) {
			continue;
		}
		yPathToNoteId.delete(notePath);
		yPathToNoteId.set(
			notePath === fromPath ? toPath : toPath + notePath.slice(fromPath.length),
			noteId,
		);
	}
};

const yConflictError = (message) => {
	const error = new Error(message);
	error.code = "Y_CONFLICT";
	error.status = 409;
	error.retryable = false;
	return error;
};

const readYNoteManifest = async (noteId) => {
	try {
		const raw = await fs.readFile(syncNoteManifestPath(noteId), "utf8");
		const manifest = JSON.parse(raw);
		return typeof manifest?.noteId === "string" ? manifest : null;
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		throw error;
	}
};

// Prefer the id whose snapshot lineage already exists (manifest on disk),
// then the path map, then the file's own id. Pins `content.id` in place so
// a file that dropped its id cannot fork a second snapshot per read.
const resolveStableYNoteIdLocked = async (normalizedPath, content) => {
	const fileId =
		typeof content?.id === "string" && content.id ? content.id : null;
	if (fileId && (await readYNoteManifest(fileId))) return fileId;
	const cached = yPathToNoteId.get(normalizedPath);
	if (cached && (await readYNoteManifest(cached))) {
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

const stableYStringify = (value) => {
	if (Array.isArray(value)) {
		return `[${value.map(stableYStringify).join(",")}]`;
	}
	if (value && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableYStringify(value[key])}`)
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

// Direct file writes (AI agents, serve sharing this workspace) bypass the Y
// update path. Fold a newer note.json into the snapshot via CRDT merge so
// live watchers see it. Our own projection writes the file BEFORE the
// manifest, so file-newer-than-manifest means "external". When the fragment
// already decodes to the file content (our own derived autosave), only the
// manifest timestamp advances — no churn, no clobber.
const foldYNoteFileIntoSnapshotLocked = async (normalizedPath, content) => {
	const noteId =
		typeof content?.id === "string" && content.id
			? content.id
			: (yPathToNoteId.get(normalizedPath) ?? null);
	if (!noteId) return { noteId: null, folded: false };
	const manifest = await readYNoteManifest(noteId);
	if (!manifest) return { noteId, folded: false };
	let stats = null;
	try {
		stats = await fs.stat(resolveNoteContentPath(normalizedPath));
	} catch (error) {
		if (error?.code === "ENOENT") return { noteId, folded: false };
		throw error;
	}
	if (!(stats.mtimeMs > manifest.updatedAt)) return { noteId, folded: false };
	const snapshotBytes = await fs.readFile(syncNoteSnapshotPath(noteId));
	const probe = new Y.Doc();
	let alreadyCovered = false;
	try {
		Y.applyUpdate(probe, snapshotBytes);
		const projected = yDocToNoteContentMain(probe, content);
		alreadyCovered =
			stableYStringify(canonicalFoldContent(projected)) ===
			stableYStringify(canonicalFoldContent(normalizeNoteContent(content)));
	} catch {
		alreadyCovered = false;
	} finally {
		probe.destroy();
	}
	if (alreadyCovered) {
		await writeFileAtomic(
			syncNoteManifestPath(noteId),
			JSON.stringify(
				{
					format: "yjs-v1",
					noteId,
					path: normalizedPath,
					updatedAt: Date.now(),
					snapshot: path.relative(
						syncNoteDirectory(noteId),
						syncNoteSnapshotPath(noteId),
					),
					stateVector: path.relative(
						syncNoteDirectory(noteId),
						syncNoteStateVectorPath(noteId),
					),
				},
				null,
				2,
			),
		);
		registerYNotePath(noteId, normalizedPath);
		return { noteId, folded: false };
	}
	const result = await writeLocalYNoteSnapshotLocked(normalizedPath, content);
	return { noteId: result.noteId, folded: true };
};

// Inverse of writeYNoteContent: project a merged Y.Doc back to NoteContent
// so note.json tracks the CRDT state across restarts. The body comes from
// the live fragment — the `content.body` map goes stale on first keystroke.
const yDocToNoteContentMain = (doc, fallback) => {
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
	// map). Seed it here so full-state writes set the body deterministically.
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

const writeLocalYNoteSnapshot = (notePath, content) => {
	const normalizedPath = currentNotePath(notePath);
	return withNoteWriteLock(normalizedPath, () =>
		writeLocalYNoteSnapshotLocked(normalizedPath, content),
	);
};

const writeLocalYNoteSnapshotLocked = async (normalizedPath, content) => {
	const normalizedContent = normalizeNoteContent(content);
	if (!normalizedContent.id) normalizedContent.id = crypto.randomUUID();

	const noteId = await resolveStableYNoteIdLocked(
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
	// (022: mirror of server/lib/yjs-persist.js — every fix lands in both.)
	let snapshot = encoded.state;
	try {
		const existingSnapshot = await fs.readFile(syncNoteSnapshotPath(noteId));
		if (existingSnapshot.length > 0) {
			const mergeDoc = new Y.Doc();
			try {
				Y.applyUpdate(mergeDoc, existingSnapshot);
				const { id, title, ...body } = normalizedContent;
				mergeDoc.transact(() => {
					writeNoteBodyToYFragment(mergeDoc, body);
					mergeDoc.getMap("content").set("body", body);
					const mergeMetadata = mergeDoc.getMap("metadata");
					if (typeof normalizedContent.id === "string") {
						mergeMetadata.set("id", normalizedContent.id);
					}
					if (typeof normalizedContent.title === "string") {
						mergeMetadata.set("title", normalizedContent.title);
					}
					mergeMetadata.set("updatedAt", now);
				});
				snapshot = Buffer.from(Y.encodeStateAsUpdate(mergeDoc));
			} finally {
				mergeDoc.destroy();
			}
		}
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}
	const mergedStateVector = (() => {
		const vectorDoc = new Y.Doc();
		try {
			Y.applyUpdate(vectorDoc, snapshot);
			return Buffer.from(Y.encodeStateVector(vectorDoc));
		} finally {
			vectorDoc.destroy();
		}
	})();

	await writeFileAtomic(syncNoteSnapshotPath(noteId), snapshot);
	await writeFileAtomic(syncNoteStateVectorPath(noteId), mergedStateVector);
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
	registerYNotePath(noteId, normalizedPath);

	return { noteId, updatedAt: now, merged: snapshot !== encoded.state };
};

const ensureLocalYNoteSnapshot = (notePath, content) => {
	const normalizedPath = currentNotePath(notePath);
	return withNoteWriteLock(normalizedPath, () =>
		ensureLocalYNoteSnapshotLocked(normalizedPath, content),
	);
};

const ensureLocalYNoteSnapshotLocked = async (normalizedPath, content) => {
	const noteId = await resolveStableYNoteIdLocked(normalizedPath, content);

	try {
		await fs.access(syncNoteSnapshotPath(noteId));
		registerYNotePath(noteId, normalizedPath);
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
	const content = await readNoteContent(normalizedPath, true);
	const noteId = await resolveStableYNoteIdLocked(normalizedPath, content);
	await ensureLocalYNoteSnapshotLocked(normalizedPath, content);
	await foldYNoteFileIntoSnapshotLocked(normalizedPath, content);
	const snapshot = await fs.readFile(syncNoteSnapshotPath(noteId));
	registerYNotePath(noteId, normalizedPath);

	return {
		noteId,
		format: "yjs-v1",
		snapshot: new Uint8Array(snapshot),
	};
};

const readLocalYNoteDiff = (notePath, stateVector) => {
	const normalizedPath = currentNotePath(notePath);
	return withNoteWriteLock(normalizedPath, () =>
		readLocalYNoteDiffLocked(normalizedPath, stateVector),
	);
};

const readLocalYNoteDiffLocked = async (normalizedPath, stateVector) => {
	const sv = Buffer.from(stateVector ?? []);
	if (sv.length === 0) throw yConflictError("missing state vector");
	const content = await readNoteContent(normalizedPath, true);
	const noteId = await resolveStableYNoteIdLocked(normalizedPath, content);
	await ensureLocalYNoteSnapshotLocked(normalizedPath, content);
	await foldYNoteFileIntoSnapshotLocked(normalizedPath, content);
	const snapshot = await fs.readFile(syncNoteSnapshotPath(noteId));
	registerYNotePath(noteId, normalizedPath);
	let diff;
	try {
		diff = Buffer.from(Y.diffUpdate(snapshot, new Uint8Array(sv)));
	} catch (error) {
		throw yConflictError(`unreadable state vector: ${error.message}`);
	}
	if (isYSnapshotConverged(snapshot, new Uint8Array(sv))) {
		return { noteId, format: "yjs-v1", diff: new Uint8Array(0) };
	}
	return { noteId, format: "yjs-v1", diff: new Uint8Array(diff) };
};

// Y.diffUpdate encodes "nothing new" as 2 bytes, not zero — applying that
// would still fire update events and echo-write on every poll.
const isYSnapshotConverged = (snapshot, clientSv) => {
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

const appendLocalYNoteUpdate = (notePath, update) => {
	const normalizedPath = currentNotePath(notePath);
	return withNoteWriteLock(normalizedPath, () =>
		appendLocalYNoteUpdateLocked(normalizedPath, update),
	);
};

const appendLocalYNoteUpdateLocked = async (normalizedPath, update) => {
	const updateBuffer = Buffer.from(update ?? []);
	if (updateBuffer.length === 0) throw yConflictError("empty yjs update");
	if (updateBuffer.length > 10 * 1024 * 1024)
		throw yConflictError("yjs update exceeds 10mb limit");

	const content = await readNoteContent(normalizedPath, true);
	const noteId = await resolveStableYNoteIdLocked(normalizedPath, content);
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
			throw yConflictError(`stored snapshot is corrupt: ${error.message}`);
		}
		try {
			Y.applyUpdate(doc, updateBuffer);
		} catch (error) {
			throw yConflictError(`invalid yjs update: ${error.message}`);
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
		// lock so a restart cannot lose Y updates. The file lands BEFORE
		// the manifest so the fold check stays unambiguous for our writes.
		const projected = yDocToNoteContentMain(doc, content);
		if (!projected.id) projected.id = noteId;
		await ensureNoteDirectory(normalizedPath);
		await writeRevisionSnapshot(normalizedPath, projected);
		await writeFileAtomic(
			resolveNoteContentPath(normalizedPath),
			serializeNoteContent(projected),
		);
		await writeFileAtomic(
			syncNoteManifestPath(noteId),
			JSON.stringify(
				{
					format: "yjs-v1",
					noteId,
					path: normalizedPath,
					updatedAt: Date.now(),
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
	} finally {
		doc.destroy();
	}
	registerYNotePath(noteId, normalizedPath);

	return { ok: true, noteId, updatedAt: now };
};

const writeDerivedNoteContent = async (notePath, content) => {
	const normalizedPath = currentNotePath(notePath);
	const normalizedContent = normalizeNoteContent(content);

	if (!normalizedContent.id || !normalizedContent.title) {
		try {
			const existingContent = await readNoteContent(normalizedPath, true);
			if (!normalizedContent.id && existingContent.id) {
				normalizedContent.id = existingContent.id;
			}
			if (!normalizedContent.title && existingContent.title) {
				normalizedContent.title = existingContent.title;
			}
			if (
				normalizedContent.pinned === undefined &&
				existingContent.pinned !== undefined
			) {
				normalizedContent.pinned = existingContent.pinned;
			}
			if (
				normalizedContent.pageFormat === undefined &&
				existingContent.pageFormat !== undefined
			) {
				normalizedContent.pageFormat = existingContent.pageFormat;
			}
		} catch {
			// Keep the derived payload as-is when the manifest is missing.
		}
	}

	if (!normalizedContent.id) normalizedContent.id = crypto.randomUUID();

	await ensureNoteDirectory(normalizedPath);
	await writeRevisionSnapshot(normalizedPath, normalizedContent);
	await writeFileAtomic(
		resolveNoteContentPath(normalizedPath),
		serializeNoteContent(normalizedContent),
	);
	const stats = await fs.stat(resolveNoteContentPath(normalizedPath));
	await getIndexedNote(normalizedPath, stats);

	return { ok: true };
};

const listLocalSyncNotes = async () => {
	await ensureWorkspace();
	const entries = await fs.readdir(syncNotesRoot(), { withFileTypes: true });
	const notes = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		try {
			const manifest = JSON.parse(
				await fs.readFile(syncNoteManifestPath(entry.name), "utf8"),
			);
			notes.push({ noteId: entry.name, manifest });
		} catch {
			// Ignore partial local sync directories.
		}
	}

	return notes;
};

const applyRemoteYjsFile = async ({
	noteId,
	notePath,
	updateName,
	content,
}) => {
	await ensureNoteDirectory(notePath);

	try {
		await fs.access(resolveNoteContentPath(notePath));
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
		const content = createEmptyNoteContent(path.posix.basename(notePath));
		content.id = noteId;
		await writeFileAtomic(
			resolveNoteContentPath(notePath),
			serializeNoteContent(content),
		);
	}

	const syncDirectory = syncNoteDirectory(noteId);
	const updatesDirectory = syncNoteUpdatesDirectory(noteId);
	await fs.mkdir(updatesDirectory, { recursive: true });

	const doc = new Y.Doc();
	try {
		Y.applyUpdate(doc, await fs.readFile(syncNoteSnapshotPath(noteId)));
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}
	Y.applyUpdate(doc, content);

	await writeFileAtomic(path.join(updatesDirectory, updateName), content);
	await writeFileAtomic(
		syncNoteSnapshotPath(noteId),
		Buffer.from(Y.encodeStateAsUpdate(doc)),
	);
	await writeFileAtomic(
		syncNoteStateVectorPath(noteId),
		Buffer.from(Y.encodeStateVector(doc)),
	);
	await writeFileAtomic(
		syncNoteManifestPath(noteId),
		JSON.stringify(
			{
				format: "yjs-v1",
				noteId,
				path: notePath,
				updatedAt: Date.now(),
				snapshot: path.relative(syncDirectory, syncNoteSnapshotPath(noteId)),
				stateVector: path.relative(
					syncDirectory,
					syncNoteStateVectorPath(noteId),
				),
			},
			null,
			2,
		),
	);
};

const revisionKey = (notePath) => Buffer.from(notePath).toString("base64url");

const writeRevisionSnapshot = async (notePath, nextContent) => {
	const normalizedPath = currentNotePath(notePath);

	try {
		const currentContent = await readNoteContent(normalizedPath);
		const currentSerialized = serializeNoteContent(currentContent);
		const nextSerialized = serializeNoteContent(nextContent);
		if (currentSerialized === nextSerialized) return;

		const revisionDirectory = path.join(
			revisionsRoot(),
			revisionKey(normalizedPath),
		);
		await fs.mkdir(revisionDirectory, { recursive: true });
		await writeFileAtomic(
			path.join(revisionDirectory, `${Date.now()}${noteFileExtension}`),
			currentSerialized,
		);
	} catch (error) {
		if (error?.code === "ENOENT") return;
		throw error;
	}
};

const collectDeletedNotes = async (itemPath) => {
	const normalizedPath = currentNotePath(itemPath);
	const absolutePath = resolveWorkspacePath(normalizedPath);

	try {
		const stats = await fs.stat(absolutePath);

		if (stats.isFile()) {
			return isMigratableNotePath(normalizedPath) ? [normalizedPath] : [];
		}

		if (!stats.isDirectory()) return [];
		if (await isNoteDirectory(normalizedPath)) return [normalizedPath];

		const entries = await fs.readdir(absolutePath, { withFileTypes: true });
		const deletedNotes = [];

		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;

			deletedNotes.push(
				...(await collectDeletedNotes(
					path.posix.join(normalizedPath, entry.name),
				)),
			);
		}

		return deletedNotes;
	} catch (error) {
		if (error?.code === "ENOENT") return [];
		throw error;
	}
};

const appendTombstones = async (notePaths) => {
	if (notePaths.length === 0) return;

	const deletedAt = Date.now();
	const lines = notePaths
		.map((notePath) => JSON.stringify({ path: notePath, deletedAt }))
		.join("\n");

	await fs.appendFile(tombstonesPath(), `${lines}\n`, "utf8");
};

const createNoteId = (notePath) => revisionKey(notePath);

const createAvailableNoteId = (db, notePath) => {
	const baseId = createNoteId(notePath);
	let candidate = baseId;
	let suffix = 1;

	while (db.prepare("SELECT 1 FROM notes WHERE id = ?").get(candidate)) {
		candidate = `${baseId}-${suffix}`;
		suffix += 1;
	}

	return candidate;
};

const nodeTextContent = (node) => {
	const chunks = [];
	collectNoteText(node, chunks);
	return chunks.join("").replace(/\n+$/g, "").trim();
};

const extractNoteMetadata = (content) => {
	const headings = [];
	const tasks = [];
	const tags = new Set();
	const backlinks = new Set();
	let line = 1;

	const visit = (node) => {
		if (!node) return;

		if (node.type === "heading") {
			headings.push({
				depth: Number(node.attrs?.level) || 1,
				text: nodeTextContent(node),
				line,
			});
		}

		if (node.type === "taskItem") {
			tasks.push({
				checked: node.attrs?.checked === true,
				text: nodeTextContent(node),
				line,
			});
		}

		for (const child of node.content ?? []) visit(child);

		if (
			node.type === "paragraph" ||
			node.type === "heading" ||
			node.type === "blockquote" ||
			node.type === "codeBlock" ||
			node.type === "listItem" ||
			node.type === "taskItem"
		) {
			line += 1;
		}
	};

	visit(normalizeNoteContent(content));

	for (const textLine of noteContentText(content).split(/\r?\n/)) {
		for (const match of textLine.matchAll(/(?:^|[\s(])#([A-Za-z0-9_/-]+)/g)) {
			tags.add(match[1]);
		}

		for (const match of textLine.matchAll(
			/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g,
		)) {
			backlinks.add(match[1].trim());
		}
	}

	return {
		headings,
		tasks,
		tags: [...tags],
		backlinks: [...backlinks],
	};
};

const addColumnIfMissing = (db, table, column, definition) => {
	const columns = db.prepare(`PRAGMA table_info(${table})`).all();

	if (columns.some((existingColumn) => existingColumn.name === column)) return;

	db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
};

const getIndexDb = async () => {
	if (indexDb) return indexDb;

	await ensureWorkspace();
	indexDb = new DatabaseSync(indexPath());
	indexDb.exec(`
		PRAGMA journal_mode = WAL;
		PRAGMA synchronous = NORMAL;
		CREATE TABLE IF NOT EXISTS notes (
			id TEXT NOT NULL UNIQUE,
			path TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			preview TEXT NOT NULL,
			mtime_ms REAL NOT NULL,
			size INTEGER NOT NULL,
			indexed_at INTEGER NOT NULL,
			sync_status TEXT NOT NULL DEFAULT 'local',
			sync_version INTEGER NOT NULL DEFAULT 0,
			remote_id TEXT,
			last_synced_at INTEGER
		);
		CREATE TABLE IF NOT EXISTS note_headings (
			note_id TEXT NOT NULL,
			depth INTEGER NOT NULL,
			text TEXT NOT NULL,
			line INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS note_tags (
			note_id TEXT NOT NULL,
			tag TEXT NOT NULL,
			PRIMARY KEY (note_id, tag)
		);
		CREATE TABLE IF NOT EXISTS note_tasks (
			note_id TEXT NOT NULL,
			text TEXT NOT NULL,
			checked INTEGER NOT NULL,
			line INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS note_backlinks (
			note_id TEXT NOT NULL,
			target TEXT NOT NULL,
			PRIMARY KEY (note_id, target)
		);
		CREATE VIRTUAL TABLE IF NOT EXISTS note_fts USING fts5(
			path UNINDEXED,
			title,
			content
		);
	`);
	addColumnIfMissing(indexDb, "notes", "id", "id TEXT");
	addColumnIfMissing(
		indexDb,
		"notes",
		"sync_status",
		"sync_status TEXT NOT NULL DEFAULT 'local'",
	);
	addColumnIfMissing(
		indexDb,
		"notes",
		"sync_version",
		"sync_version INTEGER NOT NULL DEFAULT 0",
	);
	addColumnIfMissing(indexDb, "notes", "remote_id", "remote_id TEXT");
	addColumnIfMissing(
		indexDb,
		"notes",
		"last_synced_at",
		"last_synced_at INTEGER",
	);
	addColumnIfMissing(
		indexDb,
		"notes",
		"pinned",
		"pinned INTEGER NOT NULL DEFAULT 0",
	);
	indexDb.exec("CREATE UNIQUE INDEX IF NOT EXISTS notes_id_idx ON notes(id)");

	return indexDb;
};

const getIndexedNote = async (notePath, stats) => {
	const normalizedPath = currentNotePath(notePath);
	const db = await getIndexDb();
	const existing = db
		.prepare(
			"SELECT id, title, preview, mtime_ms AS mtimeMs, size, pinned FROM notes WHERE path = ?",
		)
		.get(normalizedPath);

	if (
		existing?.id &&
		existing.mtimeMs === stats.mtimeMs &&
		existing.size === stats.size
	) {
		return {
			title: existing.title,
			preview: existing.preview,
			updatedAt: existing.mtimeMs,
			pinned: existing.pinned === 1,
		};
	}

	const content = await readNoteContent(normalizedPath);
	const plainText = noteContentText(content);
	const id = existing?.id || createAvailableNoteId(db, normalizedPath);
	const title =
		readNoteTitle(content) || toNoteTitle(path.posix.basename(normalizedPath));
	const preview = toNotePreviewFromContent(content);
	const pinned = content.pinned === true;
	const metadata = extractNoteMetadata(content);

	db.prepare(`
		INSERT INTO notes (id, path, title, preview, mtime_ms, size, indexed_at, sync_status, sync_version, pinned)
		VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT sync_status FROM notes WHERE path = ?), 'local'), COALESCE((SELECT sync_version FROM notes WHERE path = ?), 0) + 1, ?)
		ON CONFLICT(path) DO UPDATE SET
			id = excluded.id,
			title = excluded.title,
			preview = excluded.preview,
			mtime_ms = excluded.mtime_ms,
			size = excluded.size,
			indexed_at = excluded.indexed_at,
			sync_status = excluded.sync_status,
			sync_version = excluded.sync_version,
			pinned = excluded.pinned
	`).run(
		id,
		normalizedPath,
		title,
		preview,
		stats.mtimeMs,
		stats.size,
		Date.now(),
		normalizedPath,
		normalizedPath,
		pinned ? 1 : 0,
	);
	db.prepare("DELETE FROM note_headings WHERE note_id = ?").run(id);
	db.prepare("DELETE FROM note_tags WHERE note_id = ?").run(id);
	db.prepare("DELETE FROM note_tasks WHERE note_id = ?").run(id);
	db.prepare("DELETE FROM note_backlinks WHERE note_id = ?").run(id);

	const insertHeading = db.prepare(
		"INSERT INTO note_headings (note_id, depth, text, line) VALUES (?, ?, ?, ?)",
	);
	const insertTag = db.prepare(
		"INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)",
	);
	const insertTask = db.prepare(
		"INSERT INTO note_tasks (note_id, text, checked, line) VALUES (?, ?, ?, ?)",
	);
	const insertBacklink = db.prepare(
		"INSERT OR IGNORE INTO note_backlinks (note_id, target) VALUES (?, ?)",
	);

	for (const heading of metadata.headings) {
		insertHeading.run(id, heading.depth, heading.text, heading.line);
	}

	for (const tag of metadata.tags) {
		insertTag.run(id, tag);
	}

	for (const task of metadata.tasks) {
		insertTask.run(id, task.text, task.checked ? 1 : 0, task.line);
	}

	for (const backlink of metadata.backlinks) {
		insertBacklink.run(id, backlink);
	}

	db.prepare("DELETE FROM note_fts WHERE path = ?").run(normalizedPath);
	db.prepare(
		"INSERT INTO note_fts (path, title, content) VALUES (?, ?, ?)",
	).run(normalizedPath, title, plainText);

	return {
		title,
		preview,
		updatedAt: stats.mtimeMs,
		pinned,
	};
};

const deleteIndexedPath = async (itemPath) => {
	if (!indexDb) return;

	const normalized = currentNotePath(itemPath);
	const rows = indexDb.prepare("SELECT id, path FROM notes").all();

	for (const row of rows) {
		if (!isDescendantPath(normalized, row.path)) continue;

		indexDb.prepare("DELETE FROM notes WHERE path = ?").run(row.path);
		indexDb.prepare("DELETE FROM note_headings WHERE note_id = ?").run(row.id);
		indexDb.prepare("DELETE FROM note_tags WHERE note_id = ?").run(row.id);
		indexDb.prepare("DELETE FROM note_tasks WHERE note_id = ?").run(row.id);
		indexDb.prepare("DELETE FROM note_backlinks WHERE note_id = ?").run(row.id);
		indexDb.prepare("DELETE FROM note_fts WHERE path = ?").run(row.path);
	}
};

const moveIndexedPath = async (fromPath, toPath) => {
	if (!indexDb) return;
	const normalizedFromPath = currentNotePath(fromPath);
	const normalizedToPath = toPosixRelativePath(toPath);

	const rows = indexDb
		.prepare(
			"SELECT id, path, title, preview, mtime_ms AS mtimeMs, size, indexed_at AS indexedAt, sync_status AS syncStatus, sync_version AS syncVersion, remote_id AS remoteId, last_synced_at AS lastSyncedAt FROM notes",
		)
		.all();

	for (const row of rows) {
		if (!isDescendantPath(normalizedFromPath, row.path)) continue;

		const nextPath =
			row.path === normalizedFromPath
				? normalizedToPath
				: `${normalizedToPath}/${row.path.slice(normalizedFromPath.length + 1)}`;
		let nextTitle;
		try {
			const content = await readNoteContent(nextPath);
			nextTitle =
				readNoteTitle(content) || toNoteTitle(path.posix.basename(nextPath));
		} catch {
			nextTitle = toNoteTitle(path.posix.basename(nextPath));
		}

		indexDb.prepare("DELETE FROM notes WHERE path = ?").run(row.path);
		indexDb
			.prepare(
				"INSERT INTO notes (id, path, title, preview, mtime_ms, size, indexed_at, sync_status, sync_version, remote_id, last_synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			)
			.run(
				row.id || createNoteId(nextPath),
				nextPath,
				nextTitle,
				row.preview,
				row.mtimeMs,
				row.size,
				row.indexedAt,
				row.syncStatus,
				row.syncVersion,
				row.remoteId,
				row.lastSyncedAt,
			);
		indexDb
			.prepare("UPDATE note_fts SET path = ?, title = ? WHERE path = ?")
			.run(nextPath, nextTitle, row.path);
	}
};

const pruneIndex = async (knownNotePaths) => {
	const db = await getIndexDb();
	const rows = db.prepare("SELECT id, path FROM notes").all();

	for (const row of rows) {
		if (knownNotePaths.has(row.path)) continue;

		db.prepare("DELETE FROM notes WHERE path = ?").run(row.path);
		db.prepare("DELETE FROM note_headings WHERE note_id = ?").run(row.id);
		db.prepare("DELETE FROM note_tags WHERE note_id = ?").run(row.id);
		db.prepare("DELETE FROM note_tasks WHERE note_id = ?").run(row.id);
		db.prepare("DELETE FROM note_backlinks WHERE note_id = ?").run(row.id);
		db.prepare("DELETE FROM note_fts WHERE path = ?").run(row.path);
	}
};

const migrateLegacyNoteFile = async (itemPath) => {
	const normalizedPath = toPosixRelativePath(itemPath);
	const parentDirectory = path.posix.dirname(normalizedPath);
	const parentPath = parentDirectory === "." ? "" : parentDirectory;
	const title = toNoteTitle(path.posix.basename(normalizedPath)) || "Untitled";
	const notePath = await uniquePath(parentPath, title);
	let content;

	if (isLegacyMarkdownPath(normalizedPath)) {
		const markdown = await fs.readFile(
			resolveWorkspacePath(normalizedPath),
			"utf8",
		);
		content = textToNoteContent(markdown);
	} else {
		content = await readNoteContent(normalizedPath, true);
	}

	const normalizedContent = normalizeNoteContent(content);
	if (!normalizedContent.id) normalizedContent.id = crypto.randomUUID();
	if (!readNoteTitle(normalizedContent)) normalizedContent.title = title;

	await ensureNoteDirectory(notePath);
	await writeFileAtomic(
		resolveNoteContentPath(notePath),
		serializeNoteContent(normalizedContent),
	);
	await writeLocalYNoteSnapshot(notePath, normalizedContent);
	await fs.rm(resolveWorkspacePath(normalizedPath), { force: true });
	await moveIndexedPath(normalizedPath, notePath);

	return notePath;
};

const migrateAppStateNotePaths = async (migrations) => {
	if (migrations.size === 0) return;

	let state;
	try {
		state = JSON.parse(await fs.readFile(statePath(), "utf8"));
	} catch {
		return;
	}

	const migratePath = (value) =>
		typeof value === "string" ? (migrations.get(value) ?? value) : value;
	const migrateDecorations = (record) => {
		if (!record || typeof record !== "object" || Array.isArray(record))
			return record;

		return Object.fromEntries(
			Object.entries(record).map(([key, value]) => [migratePath(key), value]),
		);
	};

	const nextState = {
		...state,
		activeNotePath: migratePath(state.activeNotePath),
		openTabs: Array.isArray(state.openTabs)
			? state.openTabs.map((tab) => ({
					...tab,
					path: migratePath(tab.path),
				}))
			: state.openTabs,
		readOnlyNotes: migrateDecorations(state.readOnlyNotes),
	};

	await writeFileAtomic(statePath(), JSON.stringify(nextState, null, 2));
};

const migrateLegacyNotesInDirectory = async (relativePath = "", migrations) => {
	const absolutePath = resolveWorkspacePath(relativePath);
	const entries = await fs.readdir(absolutePath, { withFileTypes: true });

	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;

		const itemPath = path.posix.join(
			toPosixRelativePath(relativePath),
			entry.name,
		);

		if (entry.isDirectory()) {
			if (await isNoteDirectory(itemPath)) continue;

			await migrateLegacyNotesInDirectory(itemPath, migrations);
			continue;
		}

		if (!entry.isFile() || !isMigratableNotePath(entry.name)) continue;

		const notePath = await migrateLegacyNoteFile(itemPath);
		migrations.set(itemPath, notePath);
		legacyPathMigrations.set(itemPath, notePath);
	}
};

const migrateLegacyNotes = async () => {
	if (legacyMigrationPromise) return legacyMigrationPromise;

	legacyMigrationPromise = (async () => {
		const migrations = new Map();
		await migrateLegacyNotesInDirectory("", migrations);
		await migrateAppStateNotePaths(migrations);
		return migrations;
	})().finally(() => {
		legacyMigrationPromise = undefined;
	});

	return legacyMigrationPromise;
};

const scanDirectory = async (relativePath = "", knownNotePaths = new Set()) => {
	const absolutePath = resolveWorkspacePath(relativePath);
	const entries = await fs.readdir(absolutePath, { withFileTypes: true });
	const visibleEntries = entries.filter((entry) => !entry.name.startsWith("."));
	const folders = [];
	const notes = [];

	for (const entry of visibleEntries
		.filter((entry) => entry.isDirectory())
		.sort((first, second) => first.name.localeCompare(second.name))) {
		const childPath = path.posix.join(
			toPosixRelativePath(relativePath),
			entry.name,
		);

		if (await isNoteDirectory(childPath)) {
			const stats = await fs.stat(resolveNoteContentPath(childPath));
			knownNotePaths.add(childPath);
			const indexedNote = await getIndexedNote(childPath, stats);

			notes.push({
				type: "note",
				title: indexedNote.title,
				path: childPath,
				preview: indexedNote.preview,
				updatedAt: indexedNote.updatedAt,
				pinned: indexedNote.pinned === true,
			});
			continue;
		}

		folders.push({
			type: "folder",
			title: entry.name,
			path: childPath,
			children: await scanDirectory(childPath, knownNotePaths),
		});
	}

	for (const entry of visibleEntries
		.filter((entry) => entry.isFile() && isMigratableNotePath(entry.name))
		.sort((first, second) => first.name.localeCompare(second.name))) {
		const notePath = path.posix.join(
			toPosixRelativePath(relativePath),
			entry.name,
		);
		const stats = await fs.stat(resolveWorkspacePath(notePath));
		knownNotePaths.add(notePath);
		const indexedNote = await getIndexedNote(notePath, stats);

		notes.push({
			type: "note",
			title: indexedNote.title,
			path: notePath,
			preview: indexedNote.preview,
			updatedAt: indexedNote.updatedAt,
			pinned: indexedNote.pinned === true,
		});
	}
	notes.sort((first, second) => second.updatedAt - first.updatedAt);

	return [...folders, ...notes];
};

const listWorkspace = async () => {
	const start = performance.now();
	await ensureWorkspace();
	await migrateLegacyNotes();
	const knownNotePaths = new Set();

	const rootEntries = await fs.readdir(workspaceRoot(), {
		withFileTypes: true,
	});
	const spaces = await Promise.all(
		rootEntries
			.filter(
				(entry) =>
					entry.isDirectory() &&
					!entry.name.startsWith(".") &&
					entry.name !== "Trash",
			)
			.sort((first, second) => {
				if (first.name === "Inbox") return -1;
				if (second.name === "Inbox") return 1;
				return first.name.localeCompare(second.name);
			})
			.map(async (entry) => ({
				title: entry.name,
				path: entry.name,
				children: await scanDirectory(entry.name, knownNotePaths),
			})),
	);
	await pruneIndex(knownNotePaths);
	const duration = performance.now() - start;

	if (duration > 50) {
		console.info(`[paperite perf] getWorkspace ${duration.toFixed(1)}ms`);
	}

	return {
		rootPath: workspaceRoot(),
		spaces,
	};
};

const searchNotes = async (query) => {
	const start = performance.now();
	await ensureWorkspace();
	await migrateLegacyNotes();
	const trimmed = typeof query === "string" ? query.trim() : "";

	if (!trimmed) return [];

	const db = await getIndexDb();
	const safeQuery = trimmed
		.split(/\s+/)
		.map((term) => `"${term.replaceAll('"', '""')}"*`)
		.join(" ");

	const results = db
		.prepare(`
			SELECT
				notes.path,
				notes.title,
				notes.preview,
				notes.mtime_ms AS updatedAt,
				bm25(note_fts) AS rank
			FROM note_fts
			JOIN notes ON notes.path = note_fts.path
			WHERE note_fts MATCH ?
			ORDER BY rank
			LIMIT 50
		`)
		.all(safeQuery);

	const duration = performance.now() - start;
	console.info(
		`[paperite perf] search ${duration.toFixed(1)}ms ${results.length} results`,
	);

	return results;
};

const scanWorkspaceDirectories = async (relativePath = "") => {
	const absolutePath = resolveWorkspacePath(relativePath);
	const entries = await fs.readdir(absolutePath, { withFileTypes: true });
	const directories = [relativePath];

	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

		const childPath = path.posix.join(
			toPosixRelativePath(relativePath),
			entry.name,
		);
		if (await isNoteDirectory(childPath)) {
			directories.push(childPath);
			continue;
		}

		directories.push(...(await scanWorkspaceDirectories(childPath)));
	}

	return directories;
};

const ensureNoteExtension = (name) => {
	const trimmed = name.trim() || "Untitled";
	const base = toNoteTitle(trimmed) || "Untitled";
	return `${base}${noteFileExtension}`;
};

const isDescendantPath = (parentPath, childPath) =>
	childPath === parentPath || childPath.startsWith(`${parentPath}/`);

const uniquePath = async (parentPath, filename) => {
	const parsed = path.parse(filename);
	let candidate = filename;
	let index = 1;

	while (true) {
		try {
			await fs.access(
				resolveWorkspacePath(path.posix.join(parentPath, candidate)),
			);
			candidate = `${parsed.name} ${index}${parsed.ext}`;
			index += 1;
		} catch {
			return path.posix.join(parentPath, candidate);
		}
	}
};

const writeNoteTitle = async (notePath, title) => {
	const normalizedPath = currentNotePath(notePath);
	const normalizedContent = normalizeNoteContent(
		await readNoteContent(normalizedPath, true),
	);

	if (!normalizedContent.id) normalizedContent.id = crypto.randomUUID();
	normalizedContent.title = title;

	await writeRevisionSnapshot(normalizedPath, normalizedContent);
	await writeFileAtomic(
		resolveNoteContentPath(normalizedPath),
		serializeNoteContent(normalizedContent),
	);
	await writeLocalYNoteSnapshot(normalizedPath, normalizedContent);
	const stats = await fs.stat(resolveNoteContentPath(normalizedPath));
	await getIndexedNote(normalizedPath, stats);
};

const isAppUrl = (url) => {
	if (url.startsWith("paperite://")) return true;
	if (attachedServeUrl && url.startsWith(attachedServeUrl)) return true;
	if (devServerUrl && url.startsWith(devServerUrl)) return true;
	if (
		rendererServerUrl &&
		(url.startsWith(rendererServerUrl) ||
			url.startsWith(rendererServerUrl.replace("127.0.0.1", "localhost")))
	)
		return true;
	return url.startsWith("file://");
};

const sendToFocusedWindow = (channel, payload) => {
	const window = BrowserWindow.getFocusedWindow() ?? mainWindow;
	window?.webContents.send(channel, payload);
};

// ---- renderer static server (production) ----
// Production serves dist/ over http://127.0.0.1:<fixed port> instead of
// file://. Clerk (and cookie/storage behavior in general) breaks on file://
// origins: the dev-browser handshake 400s and sessions can never be
// restored — not even by a plain reload. A fixed port keeps the origin, and
// therefore all renderer storage, stable across restarts. The
// single-instance lock guarantees no second Paperite fights for the port.
const rendererPortStart = 31275;
const rendererPortAttempts = 10;
let rendererServerUrl;
let rendererServerPromise;

const rendererMimeTypes = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".bmp": "image/bmp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
};

const createRendererServer = () => {
	const root = path.join(__dirname, "dist");

	const serveFile = async (filePath, response, cacheControl) => {
		try {
			const data = await fs.readFile(filePath);
			const ext = path.extname(filePath).toLowerCase();
			response.writeHead(200, {
				"content-type": rendererMimeTypes[ext] ?? "application/octet-stream",
				"content-length": data.length,
				"cache-control": cacheControl,
			});
			response.end(data);
			return true;
		} catch {
			return false;
		}
	};

	return http.createServer((request, response) => {
		void (async () => {
			const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
			// pathname stays percent-encoded here: each segment is decoded
			// exactly once below. (Decoding the whole path first would
			// corrupt names containing a literal %.)
			const rawPathname = requestUrl.pathname;
			const pathname = decodeURIComponent(rawPathname);

			// Workspace assets (note images). file:// img URLs are blocked
			// on http:// pages, so notes reference these http URLs instead.
			// Stored paths stay workspace-relative; the port prefix is added
			// at display time only.
			const noteAssetsPrefix = "/note-assets/";
			if (
				rawPathname === "/note-assets" ||
				rawPathname.startsWith(noteAssetsPrefix)
			) {
				let absolutePath;
				try {
					const segments = rawPathname
						.slice(noteAssetsPrefix.length)
						.split("/")
						.filter(Boolean)
						.map((segment) => decodeURIComponent(segment));
					if (segments.some((s) => s === "." || s === ".." || !s))
						throw new Error("bad asset path");
					absolutePath = resolveWorkspacePath(segments.join("/"));
				} catch {
					response.writeHead(403);
					response.end("Forbidden");
					return;
				}
				if (await serveFile(absolutePath, response, "no-store")) return;
				response.writeHead(404);
				response.end("Not found");
				return;
			}

			// Jail everything else inside dist/.
			const resolved = path.normalize(path.join(root, pathname));
			if (resolved !== root && !resolved.startsWith(root + path.sep)) {
				response.writeHead(403);
				response.end("Forbidden");
				return;
			}

			if (!path.basename(pathname).includes(".")) {
				// SPA fallback: the hash router lives in a single document,
				// and the OAuth callback replaceStates to a non-hash /login
				// path — a reload there must not land on a blank page.
				if (
					await serveFile(path.join(root, "index.html"), response, "no-store")
				)
					return;
				response.writeHead(404);
				response.end("Not found");
				return;
			}

			const cacheControl = pathname.startsWith("/assets/")
				? "public, max-age=31536000, immutable"
				: "no-store";
			if (await serveFile(resolved, response, cacheControl)) return;
			response.writeHead(404);
			response.end("Not found");
		})().catch(() => {
			try {
				response.writeHead(500);
				response.end("Internal error");
			} catch {
				// Socket already gone.
			}
		});
	});
};

const startRendererServer = async () => {
	let lastError;
	for (let i = 0; i < rendererPortAttempts; i += 1) {
		const port = rendererPortStart + i;
		const server = createRendererServer();
		try {
			await new Promise((resolve, reject) => {
				server.once("error", reject);
				server.listen(port, "127.0.0.1", resolve);
			});
			rendererServerUrl = `http://127.0.0.1:${port}`;
			console.log(`[paperite] renderer server on ${rendererServerUrl}`);
			return rendererServerUrl;
		} catch (error) {
			server.close();
			lastError = error;
		}
	}
	throw lastError ?? new Error("could not start renderer server");
};

const getRendererServerUrl = () => {
	rendererServerPromise ??= startRendererServer();
	return rendererServerPromise;
};

const createWindowOptions = ({ width, height, minWidth, minHeight }) => ({
	width,
	height,
	minWidth,
	minHeight,
	show: false,
	...(shouldUseMacChrome ? { titleBarStyle: "hiddenInset" } : { frame: false }),
	title: "Paperite",
	backgroundColor: "#171717",
	webPreferences: {
		// Explicit persistent partition: Clerk's session tokens live in
		// the renderer's localStorage/cookies, which must survive restarts.
		partition: "persist:paperite",
		// Same blank-after-lock family as the switches above: default true
		// throttles rAF/timers once the window is occluded (locked), and on
		// some compositors the page never gets un-throttled on unlock.
		backgroundThrottling: false,
		webSecurity: false,
		preload: require("node:path").join(__dirname, "preload.js"),
		additionalArguments: [
			`--paperite-macos-layout=${shouldUseMacLayout ? "1" : "0"}`,
		],
	},
});

const revealWindow = (window, timeoutMs = 4_000) => {
	let revealed = false;

	const reveal = () => {
		if (revealed || window.isDestroyed()) return;
		revealed = true;
		clearTimeout(timer);
		window.show();
	};

	const timer = setTimeout(reveal, timeoutMs);

	window.once("ready-to-show", reveal);
	window.webContents.once("did-finish-load", reveal);
	window.once("closed", () => clearTimeout(timer));
};

const createApplicationMenu = () => {
	const template = [
		...(shouldUseMacChrome
			? [
					{
						label: app.name,
						submenu: [
							{ role: "about" },
							{ type: "separator" },
							{ role: "services" },
							{ type: "separator" },
							{ role: "hide" },
							{ role: "hideOthers" },
							{ role: "unhide" },
							{ type: "separator" },
							{ role: "quit" },
						],
					},
				]
			: []),
		{
			label: "File",
			submenu: [
				{
					label: "New Note",
					accelerator: "CommandOrControl+N",
					click: () => sendToFocusedWindow("app-menu:action", "create-note"),
				},
				{
					label: "New Folder",
					accelerator: "CommandOrControl+Shift+N",
					click: () => sendToFocusedWindow("app-menu:action", "create-folder"),
				},
				{ type: "separator" },
				{
					label: "Note setup...",
					accelerator: "CommandOrControl+.",
					click: () => sendToFocusedWindow("app-menu:action", "note-setup"),
				},
				{ type: "separator" },
				shouldUseMacChrome ? { role: "close" } : { role: "quit" },
			],
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ type: "separator" },
				{ role: "selectAll" },
			],
		},
		{
			label: "View",
			submenu: [
				{
					label: "Toggle Zen Mode",
					accelerator: "CommandOrControl+Shift+Z",
					click: () =>
						sendToFocusedWindow("app-menu:action", "toggle-zen-mode"),
				},
				{ type: "separator" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "reload" },
				{ role: "forceReload" },
			],
		},
		{
			label: "Format",
			submenu: [
				...[
					"typography-heading-1",
					"typography-heading-2",
					"typography-heading-3",
					"typography-body",
				].map((command) => ({
					label: command.replace("typography-", "").replaceAll("-", " "),
					click: () => sendToFocusedWindow("app-menu:format", command),
				})),
				{ type: "separator" },
				{
					label: "Bold",
					accelerator: "CommandOrControl+B",
					click: () => sendToFocusedWindow("app-menu:format", "bold"),
				},
				{
					label: "Italic",
					accelerator: "CommandOrControl+I",
					click: () => sendToFocusedWindow("app-menu:format", "italic"),
				},
				{
					label: "Underline",
					accelerator: "CommandOrControl+U",
					click: () => sendToFocusedWindow("app-menu:format", "underline"),
				},
				{
					label: "Strikethrough",
					accelerator: "CommandOrControl+Shift+X",
					click: () => sendToFocusedWindow("app-menu:format", "strike"),
				},
				{ type: "separator" },
				...[
					"highlight",
					"quote",
					"code-block",
					"align-left",
					"align-center",
					"align-right",
					"align-justify",
					"bullet-list",
					"ordered-list",
					"task-list",
				].map((command) => ({
					label: command.replaceAll("-", " "),
					click: () => sendToFocusedWindow("app-menu:format", command),
				})),
			],
		},
		{ role: "windowMenu" },
	];

	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

// Safety net for the suspend path the switches can't cover (gpu process
// actually died, renderer crashed while locked): reload instead of sitting
// on a black window until the user hits ctrl+r manually.
const attachRendererRecovery = (window) => {
	window.webContents.on("render-process-gone", (_event, details) => {
		if (window.isDestroyed()) return;
		console.error(
			`[paperite] renderer gone (${details?.reason ?? "unknown"}), reloading`,
		);
		window.webContents.reload();
	});
	window.webContents.on("unresponsive", () => {
		if (window.isDestroyed()) return;
		console.warn("[paperite] renderer unresponsive, reloading");
		window.webContents.reload();
	});
};

const recoverWindowsAfterSuspend = (reason) => {
	for (const window of BrowserWindow.getAllWindows()) {
		if (window.isDestroyed()) continue;
		try {
			if (window.webContents.isCrashed()) {
				console.error(
					`[paperite] renderer crashed while suspended (${reason}), reloading`,
				);
				window.webContents.reload();
			} else {
				window.webContents.send("system:resumed", { reason });
			}
		} catch (error) {
			console.error("[paperite] suspend recovery failed:", error);
		}
	}
};

const createWindow = () => {
	mainWindow = new BrowserWindow(
		createWindowOptions({
			width: 800,
			height: 600,
			minWidth: 420,
			minHeight: 520,
		}),
	);

	attachRendererRecovery(mainWindow);
	revealWindow(mainWindow);

	mainWindow.webContents.on("will-navigate", (event, url) => {
		if (isAppUrl(url)) return;

		event.preventDefault();
		shell.openExternal(url);
	});

	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (isAppUrl(url)) return { action: "allow" };

		shell.openExternal(url);
		return { action: "deny" };
	});

	if (attachedServeUrl) {
		mainWindow.loadURL(attachedServeUrl);
	} else if (devServerUrl) {
		mainWindow.loadURL(devServerUrl);
	} else {
		getRendererServerUrl()
			.then((base) => mainWindow?.loadURL(`${base}/index.html`))
			.catch((error) => {
				console.error("[paperite] renderer server failed", error);
				dialog.showErrorBox(
					"Paperite failed to start",
					String(error?.message ?? error),
				);
				app.quit();
			});
	}
};

const notifyWorkspaceChanged = () => {
	if (workspaceWatchTimer) clearTimeout(workspaceWatchTimer);

	workspaceWatchTimer = setTimeout(() => {
		refreshWorkspaceWatchers().catch(() => undefined);
		mainWindow?.webContents.send("workspace:changed");
		if (workspaceOwnerWs) {
			const message = JSON.stringify({ event: "workspace:changed" });
			for (const client of workspaceOwnerWs.clients) {
				if (client.readyState === 1) client.send(message);
			}
		}
	}, 150);
};

const encodeOwnerValue = (value) => {
	if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
		return { __paperiteBinary: Buffer.from(value).toString("base64") };
	}
	if (Array.isArray(value)) return value.map(encodeOwnerValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, child]) => [
				key,
				encodeOwnerValue(child),
			]),
		);
	}
	return value;
};

const decodeOwnerValue = (value) => {
	if (value && typeof value === "object" && value.__paperiteBinary) {
		return Uint8Array.from(Buffer.from(value.__paperiteBinary, "base64"));
	}
	if (Array.isArray(value)) return value.map(decodeOwnerValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, child]) => [
				key,
				decodeOwnerValue(child),
			]),
		);
	}
	return value;
};

const readOwnerRequestBody = async (request) => {
	const chunks = [];
	for await (const chunk of request) chunks.push(chunk);
	return Buffer.concat(chunks);
};

// Auth bridge for the serve-first ordering: serve owns the workspace and
// the desktop attaches to it as a client, so serve has no owner to ask for
// the Clerk session. The desktop publishes a loopback bridge instead and
// serve pulls the session from it — same channels, same secret-gated
// transport as the owner bridge, but a separate file so the two orderings
// never fight over the workspace lock.
let authBridgeServer;

const startAuthBridge = async () => {
	const secret = nodeCrypto.randomBytes(32).toString("hex");
	const server = http.createServer(async (request, response) => {
		if (request.url !== "/__paperite_auth/rpc" || request.method !== "POST") {
			response.writeHead(404);
			response.end("Not found");
			return;
		}
		if (request.headers["x-paperite-auth-secret"] !== secret) {
			response.writeHead(403, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: "invalid auth bridge secret" }));
			return;
		}
		try {
			const payload = JSON.parse(
				(await readOwnerRequestBody(request)).toString("utf8"),
			);
			if (payload.protocolVersion !== 1)
				throw new Error("unsupported auth bridge protocol");
			if (!payload.channel?.startsWith("auth:"))
				throw new Error("auth bridge channel is not allowed");
			const handler = ownerRpcHandlers.get(payload.channel);
			if (!handler)
				throw new Error(`auth bridge channel not found: ${payload.channel}`);
			const result = await handler({}, ...decodeOwnerValue(payload.args || []));
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify({ result: encodeOwnerValue(result) }));
		} catch (error) {
			response.writeHead(500, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: error?.message ?? String(error) }));
		}
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("auth bridge did not bind");
	authBridgeServer = server;
	const { writeAuthBridge } = require("./server/lib/auth-bridge");
	await writeAuthBridge(workspaceRoot(), {
		protocolVersion: 1,
		port: address.port,
		secret,
		pid: process.pid,
	});
	console.log(`[paperite] auth bridge on 127.0.0.1:${address.port}`);
};

const startWorkspaceOwnerBridge = async () => {
	const { WebSocketServer } = require("ws");
	workspaceOwnerSecret = nodeCrypto.randomBytes(32).toString("hex");
	workspaceOwnerServer = http.createServer(async (request, response) => {
		if (request.url === "/__paperite_owner/health") {
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify({ ok: true, protocolVersion: 1 }));
			return;
		}
		if (request.url !== "/__paperite_owner/rpc" || request.method !== "POST") {
			response.writeHead(404);
			response.end("Not found");
			return;
		}
		if (request.headers["x-paperite-owner-secret"] !== workspaceOwnerSecret) {
			response.writeHead(403);
			response.end(JSON.stringify({ error: "invalid workspace owner secret" }));
			return;
		}
		try {
			const payload = JSON.parse(
				(await readOwnerRequestBody(request)).toString("utf8"),
			);
			if (payload.protocolVersion !== 1)
				throw new Error("unsupported owner protocol");
			if (
				!payload.channel?.startsWith("notes:") &&
				!payload.channel?.startsWith("auth:")
			)
				throw new Error("owner channel is not allowed");
			const handler = ownerRpcHandlers.get(payload.channel);
			if (!handler)
				throw new Error(`owner channel not found: ${payload.channel}`);
			const result = await handler({}, ...decodeOwnerValue(payload.args || []));
			response.setHeader("content-type", "application/json");
			response.end(JSON.stringify({ result: encodeOwnerValue(result) }));
		} catch (error) {
			response.writeHead(500, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: error?.message ?? String(error) }));
		}
	});
	workspaceOwnerWs = new WebSocketServer({
		server: workspaceOwnerServer,
		path: "/__paperite_owner/live",
		verifyClient: ({ req }) =>
			req.headers["x-paperite-owner-secret"] === workspaceOwnerSecret,
	});
	await new Promise((resolve, reject) => {
		workspaceOwnerServer.once("error", reject);
		workspaceOwnerServer.listen(0, "127.0.0.1", resolve);
	});
	const address = workspaceOwnerServer.address();
	if (!address || typeof address === "string")
		throw new Error("workspace owner bridge did not bind");
	const locks = require("./server/lib/locks");
	const lockPath = locks.workspaceLockPath(workspaceRoot());
	const lock = locks.readWorkspaceLock(workspaceRoot());
	if (!lock || lock.pid !== process.pid)
		throw new Error("workspace owner lock disappeared");
	const lockPayload = JSON.stringify({
		...lock,
		protocolVersion: 1,
		ownerPort: address.port,
		ownerSecret: workspaceOwnerSecret,
	});
	const lockTempPath = `${lockPath}.${process.pid}.tmp`;
	fsSync.writeFileSync(lockTempPath, lockPayload);
	fsSync.renameSync(lockTempPath, lockPath);
	console.log(`[paperite] workspace owner bridge on 127.0.0.1:${address.port}`);
};

const refreshWorkspaceWatchers = async () => {
	await ensureWorkspace();

	const directories = await scanWorkspaceDirectories();
	const nextDirectories = new Set(directories);

	for (const [directory, watcher] of workspaceWatchers) {
		if (nextDirectories.has(directory)) continue;

		watcher.close();
		workspaceWatchers.delete(directory);
	}

	for (const directory of directories) {
		if (workspaceWatchers.has(directory)) continue;

		const watcher = fsSync.watch(
			resolveWorkspacePath(directory),
			(_eventType, filename) => {
				if (filename?.toString().startsWith(".")) return;
				notifyWorkspaceChanged();
			},
		);
		watcher.on("error", () => {
			workspaceWatchers.delete(directory);
		});
		workspaceWatchers.set(directory, watcher);
	}
};

const getFocusedWindow = (event) =>
	BrowserWindow.fromWebContents(event.sender) ?? mainWindow;

const windowActions = {
	minimize: (window) => window?.minimize(),
	toggleMaximize: (window) => {
		if (!window) return;
		if (window.isMaximized()) {
			window.unmaximize();
			return;
		}
		window.maximize();
	},
	close: (window) => window?.close(),
	quit: () => app.quit(),
	reload: (window) => window?.webContents.reload(),
	forceReload: (window) => window?.webContents.reloadIgnoringCache(),
	toggleDevTools: (window) => window?.webContents.toggleDevTools(),
	undo: (window) => window?.webContents.undo(),
	redo: (window) => window?.webContents.redo(),
	cut: (window) => window?.webContents.cut(),
	copy: (window) => window?.webContents.copy(),
	paste: (window) => window?.webContents.paste(),
	selectAll: (window) => window?.webContents.selectAll(),
};

const registerProtocolClient = () => {
	if (process.defaultApp) {
		app.setAsDefaultProtocolClient("paperite", process.execPath, [
			app.getAppPath(),
		]);

		if (process.platform === "linux") {
			try {
				const applicationsDir = path.join(
					app.getPath("home"),
					".local",
					"share",
					"applications",
				);
				const desktopFile = path.join(applicationsDir, "paperite-dev.desktop");
				const quoteDesktopArg = (value) =>
					`"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

				fsSync.mkdirSync(applicationsDir, { recursive: true });
				fsSync.writeFileSync(
					desktopFile,
					[
						"[Desktop Entry]",
						"Name=Paperite (Development)",
						"Type=Application",
						"Terminal=false",
						`Exec=${quoteDesktopArg(process.execPath)} ${quoteDesktopArg(app.getAppPath())} %u`,
						"MimeType=x-scheme-handler/paperite;",
						"NoDisplay=true",
						"",
					].join("\n"),
				);
				execFileSync("xdg-mime", [
					"default",
					"paperite-dev.desktop",
					"x-scheme-handler/paperite",
				]);
			} catch {
				// Deep-link registration is best-effort in development.
			}
		}
		return;
	}

	app.setAsDefaultProtocolClient("paperite");
};

registerProtocolClient();

const isAuthCallbackUrl = (url) =>
	url.startsWith("paperite://auth/") || url.startsWith("paperite://callback");

const getProtocolCallbackArg = (argv) =>
	argv.find((url) => isAuthCallbackUrl(url));

const handleProtocolCallback = (url) => {
	if (isAuthCallbackUrl(url)) sendAuthCallback(url);
};

const focusMainWindow = () => {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	if (mainWindow.isMinimized()) mainWindow.restore();
	mainWindow.show();
	mainWindow.moveTop?.();
	mainWindow.focus();
};

const sendAuthCallback = (url) => {
	console.log("[paperite] auth callback received:", url);
	pendingAuthCallbackUrl = url;
	mainWindow?.webContents.send("auth-callback", url);
	focusMainWindow();
};

ipcMain.handle("open-external", async (_event, url) => {
	await shell.openExternal(url);
});

ipcMain.handle("auth:get-pending-callback", () => {
	const url = pendingAuthCallbackUrl ?? null;
	pendingAuthCallbackUrl = undefined;
	return url;
});

// Clerk's API only accepts http(s) redirect URLs ("invalid_url_scheme"
// rejects paperite:// outright), so a custom scheme can never be used as
// the OAuth redirect directly. Instead we run a throwaway loopback server
// (same RFC 8252 loopback pattern), use its URL as
// the redirect, and forward the callback into the renderer over IPC.
// No xdg/deep-link/OS-handler involved at all.
let clerkAuthServer;
let clerkAuthServerTimeout;

const stopClerkAuthServer = () => {
	if (clerkAuthServerTimeout) {
		clearTimeout(clerkAuthServerTimeout);
		clerkAuthServerTimeout = undefined;
	}
	if (clerkAuthServer) {
		const server = clerkAuthServer;
		clerkAuthServer = undefined;
		server.close();
	}
};

const getClerkAuthServer = async () => {
	// Reuse the live server: starting a second login while an older
	// browser tab is still mid-flow must NOT kill the first tab's
	// callback URL (that orphans the successful attempt server-side
	// while the app only ever sees the failed retry).
	if (clerkAuthServer) {
		const address = clerkAuthServer.address();
		if (address && typeof address !== "string") {
			refreshClerkAuthServerTimeout();
			return `http://localhost:${address.port}/callback`;
		}
		clerkAuthServer = undefined;
	}
	return startClerkAuthServer();
};

const refreshClerkAuthServerTimeout = () => {
	if (clerkAuthServerTimeout) clearTimeout(clerkAuthServerTimeout);
	clerkAuthServerTimeout = setTimeout(stopClerkAuthServer, 5 * 60_000);
};

const escapeHtml = (value) =>
	String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");

const successPage = (title, subtitle, check = "✓") => `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Paperite — ${title}</title>
<style>
:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0b0c0d; color: #f4f3ef; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; overflow: hidden; background: radial-gradient(circle at 50% 0%, rgba(233,76,8,0.16), transparent 34rem), linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px), #0b0c0d; background-size: auto, 72px 72px, 72px 72px, auto; }
main { width: min(100% - 2rem, 30rem); padding: 2.25rem; text-align: center; border: 1px solid rgba(255,255,255,0.12); border-radius: 1.5rem; background: rgba(22,23,24,0.88); box-shadow: 0 30px 100px rgba(0,0,0,0.38); backdrop-filter: blur(20px); }
.brand { display: inline-flex; align-items: center; gap: 0.65rem; margin-bottom: 2.5rem; color: rgba(255,255,255,0.48); font-size: 0.72rem; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; }
.mark { display: grid; width: 1.75rem; height: 1.75rem; place-items: center; border-radius: 0.5rem; background: #e94c08; color: white; font-size: 0.7rem; letter-spacing: 0; }
.check { display: grid; width: 3.5rem; height: 3.5rem; margin: 0 auto 1.5rem; place-items: center; border-radius: 999px; background: rgba(233,76,8,0.14); color: #ff6a2a; font-size: 1.5rem; }
h1 { margin: 0; font-size: clamp(2rem, 5vw, 3rem); letter-spacing: -0.055em; line-height: 0.95; }
p { margin: 1rem auto 0; max-width: 24rem; color: rgba(255,255,255,0.5); font-size: 0.95rem; line-height: 1.55; }
.hint { margin-top: 1.25rem; color: rgba(255,255,255,0.3); font-size: 0.75rem; }
</style>
</head>
<body>
<main>

<div class="check" aria-hidden="true">${check}</div>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(subtitle)}</p>
<p class="hint">You can close this tab and return to Paperite.</p>
</main>
</body>
</html>`;

const startClerkAuthServer = async () => {
	const server = http.createServer((request, response) => {
		const requestUrl = new URL(request.url ?? "/", "http://localhost");

		if (requestUrl.pathname !== "/callback") {
			response.writeHead(404);
			response.end("Not found");
			return;
		}

		sendAuthCallback(`paperite://auth/callback${requestUrl.search}`);
		// Do NOT stop the server here: a second tab from a double-click
		// may still land afterwards. Idle timeout below cleans up.
		refreshClerkAuthServerTimeout();

		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end(
			successPage(
				"You're all set.",
				"Signed in to Paperite. Your account is connected.",
			),
		);
	});

	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		server.close();
		throw new Error("could not start auth callback server");
	}

	clerkAuthServer = server;
	refreshClerkAuthServerTimeout();
	console.log(
		`[paperite] clerk auth callback server on http://localhost:${address.port}/callback`,
	);
	return `http://localhost:${address.port}/callback`;
};

ipcMain.handle("auth:start-callback-server", () => getClerkAuthServer());
registerOwnerIpcHandler("auth:get-session", (_event, options) =>
	requestRendererBridge("session", {
		includeToken: options?.includeToken === true,
	}),
);
registerOwnerIpcHandler("auth:sign-out", () =>
	requestRendererBridge("sign-out"),
);
// The browser holds no Clerk session, so it cannot list or revoke sessions
// or write user metadata itself. The desktop answers on its behalf.
registerOwnerIpcHandler("auth:list-sessions", () =>
	requestRendererBridge("sessions", { action: "list-sessions" }),
);
registerOwnerIpcHandler("auth:revoke-session", (_event, sessionId) =>
	requestRendererBridge("sessions", { action: "revoke-session", sessionId }),
);
registerOwnerIpcHandler("auth:revoke-other-sessions", () =>
	requestRendererBridge("sessions", { action: "revoke-others" }),
);
registerOwnerIpcHandler("auth:update-metadata", (_event, metadata) =>
	requestRendererBridge("sessions", { action: "update-metadata", metadata }),
);
ipcMain.handle("device-auth:status", () => deviceAuth.status());
ipcMain.handle("device-auth:claim", (_event, userId) =>
	deviceAuth.claim(userId),
);
ipcMain.handle("device-auth:clear", () => deviceAuth.clear());
ipcMain.handle("device-auth:enable-file", () => deviceAuth.enableFileStorage());

ipcMain.handle("sync:get-status", async () => ({
	convex: {
		configured: Boolean(process.env.VITE_CONVEX_URL),
	},
}));

ipcMain.handle("personal-server:get-credential", async (_event, connectionId) =>
	readPersonalServerCredential(connectionId),
);

ipcMain.handle(
	"personal-server:save-credential",
	async (_event, connectionId, credential) =>
		writePersonalServerCredential(connectionId, credential),
);

ipcMain.handle(
	"personal-server:delete-credential",
	async (_event, connectionId) => deletePersonalServerCredential(connectionId),
);

ipcMain.handle("app:set-title", (event, title) => {
	const window = getFocusedWindow(event);
	const nextTitle =
		typeof title === "string" && title.trim() ? title : "Paperite";
	window?.setTitle(nextTitle);
	return { ok: true };
});

ipcMain.handle("app:get-device-info", () => {
	try {
		return {
			hostname: os.hostname(),
			platform: process.platform,
			arch: process.arch,
		};
	} catch {
		return { hostname: "", platform: process.platform, arch: "" };
	}
});

ipcMain.handle("window:get-state", (event) => {
	const window = getFocusedWindow(event);
	return { isMaximized: window?.isMaximized() ?? false };
});

ipcMain.handle("window:action", (event, action) => {
	const handler = windowActions[action];
	if (!handler) return { ok: false };

	handler(getFocusedWindow(event));
	return { ok: true };
});

registerOwnerIpcHandler("notes:get-workspace", async () => listWorkspace());

registerOwnerIpcHandler("notes:search", async (_event, query) =>
	searchNotes(query),
);

registerOwnerIpcHandler("notes:read-note", async (_event, notePath) => {
	await ensureWorkspace();
	await migrateLegacyNotes();
	const normalizedPath = currentNotePath(notePath);
	const content = await readNoteContent(normalizedPath, true);
	await ensureLocalYNoteSnapshot(normalizedPath, content);
	return content;
});

registerOwnerIpcHandler("notes:read-y-note", async (_event, notePath) => {
	await ensureWorkspace();
	await migrateLegacyNotes();
	return readLocalYNoteState(notePath);
});

registerOwnerIpcHandler(
	"notes:write-y-update",
	async (_event, notePath, update) => {
		await ensureWorkspace();
		await migrateLegacyNotes();
		const result = await appendLocalYNoteUpdate(notePath, update);
		return result;
	},
);

registerOwnerIpcHandler(
	"notes:read-y-note-diff",
	async (_event, notePath, stateVector) => {
		await ensureWorkspace();
		await migrateLegacyNotes();
		return readLocalYNoteDiff(notePath, stateVector);
	},
);

registerOwnerIpcHandler(
	"notes:write-derived-note",
	async (_event, notePath, content) => {
		await ensureWorkspace();
		await migrateLegacyNotes();
		const result = await writeDerivedNoteContent(notePath, content);
		return result;
	},
);

registerOwnerIpcHandler(
	"notes:write-note",
	async (_event, notePath, content) => {
		await ensureWorkspace();
		await migrateLegacyNotes();
		const normalizedPath = currentNotePath(notePath);
		const normalizedContent = normalizeNoteContent(content);
		let existingContent;

		// Preserve persisted metadata stripped by the editor body payload.
		if (
			!normalizedContent.id ||
			!normalizedContent.title ||
			normalizedContent.pageFormat === undefined
		) {
			try {
				existingContent = await readNoteContent(normalizedPath, true);
				if (!normalizedContent.id && existingContent.id) {
					normalizedContent.id = existingContent.id;
				}
				if (!normalizedContent.title && existingContent.title) {
					normalizedContent.title = existingContent.title;
				}
				if (
					normalizedContent.pageFormat === undefined &&
					existingContent.pageFormat !== undefined
				) {
					normalizedContent.pageFormat = existingContent.pageFormat;
				}
			} catch {
				// new note or missing file — id already set by createEmptyNoteContent
			}
		}

		if (!normalizedContent.id) {
			normalizedContent.id = crypto.randomUUID();
		}

		// sync title from index for UUID-named files
		if (isUuidFilename(normalizedPath) && !normalizedContent.title && indexDb) {
			const row = indexDb
				.prepare("SELECT title FROM notes WHERE path = ?")
				.get(normalizedPath);
			if (row?.title) normalizedContent.title = row.title;
		}

		await ensureNoteDirectory(normalizedPath);
		await writeRevisionSnapshot(normalizedPath, normalizedContent);
		await writeFileAtomic(
			resolveNoteContentPath(normalizedPath),
			serializeNoteContent(normalizedContent),
		);
		await writeLocalYNoteSnapshot(normalizedPath, normalizedContent);
		const stats = await fs.stat(resolveNoteContentPath(normalizedPath));
		await getIndexedNote(normalizedPath, stats);
		return { ok: true };
	},
);

registerOwnerIpcHandler(
	"notes:set-pinned",
	async (_event, notePath, pinned) => {
		await ensureWorkspace();
		const normalizedPath = currentNotePath(notePath);
		const content = await readNoteContent(normalizedPath, true);
		content.pinned = pinned === true;
		await writeFileAtomic(
			resolveNoteContentPath(normalizedPath),
			serializeNoteContent(content),
		);
		const stats = await fs.stat(resolveNoteContentPath(normalizedPath));
		await getIndexedNote(normalizedPath, stats);
		return { pinned: content.pinned };
	},
);

registerOwnerIpcHandler(
	"notes:set-page-format",
	async (_event, notePath, format) => {
		await ensureWorkspace();
		const normalizedPath = currentNotePath(notePath);
		const content = await readNoteContent(normalizedPath, true);
		content.pageFormat = normalizePageFormat(format);
		await writeFileAtomic(
			resolveNoteContentPath(normalizedPath),
			serializeNoteContent(content),
		);
		const stats = await fs.stat(resolveNoteContentPath(normalizedPath));
		await getIndexedNote(normalizedPath, stats);
		return { ok: true, pageFormat: content.pageFormat };
	},
);

const collectReferencedAssetPaths = (node, out = new Set()) => {
	if (node?.type === "image" && typeof node.attrs?.src === "string") {
		const srcPath = node.attrs.src;
		if (
			srcPath.startsWith(noteAssetsDirectoryName + "/") ||
			srcPath.startsWith("assets/")
		) {
			out.add(srcPath.replace(/^\/+/, ""));
		} else if (srcPath.startsWith("file://")) {
			const assetsIdx = srcPath.indexOf("/assets/");
			if (assetsIdx !== -1) out.add(srcPath.slice(assetsIdx + 1));
		}
	}
	for (const child of node?.content ?? [])
		collectReferencedAssetPaths(child, out);
	return out;
};

const pruneNoteAssets = async (notePath) => {
	const normalizedPath = currentNotePath(notePath);
	if (popoutWindows.has(normalizedPath)) {
		return { ok: true, deleted: 0, skipped: "popout-open" };
	}

	const assetDir = resolveWorkspacePath(noteAssetsPath(normalizedPath));
	let entries;
	try {
		entries = await fs.readdir(assetDir, { withFileTypes: true });
	} catch (error) {
		if (error?.code === "ENOENT") return { ok: true, deleted: 0 };
		throw error;
	}

	let content;
	try {
		content = await readNoteContent(normalizedPath);
	} catch (error) {
		if (error?.code === "ENOENT") return { ok: true, deleted: 0 };
		throw error;
	}

	const referenced = collectReferencedAssetPaths(content);
	let deleted = 0;

	for (const entry of entries) {
		if (!entry.isFile() || entry.name.startsWith(".")) continue;
		const relative = noteAssetsDirectoryName + "/" + entry.name;
		if (referenced.has(relative)) continue;
		await fs
			.rm(path.join(assetDir, entry.name), { force: true })
			.catch(() => undefined);
		deleted += 1;
	}

	return { ok: true, deleted };
};
registerOwnerIpcHandler(
	"notes:save-image",
	async (_event, notePath, imageDataUrl, filename) => {
		if (attachedServeUrl) {
			return requestAttachedApi(
				`/api/notes/${encodeURIComponent(notePath)}/assets`,
				{
					method: "POST",
					body: JSON.stringify({ imageDataUrl, filename }),
				},
			);
		}
		await ensureWorkspace();
		const normalizedPath = currentNotePath(notePath);
		await ensureNoteDirectory(normalizedPath);

		const match = imageDataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
		if (!match) throw new Error("Invalid image data URL");

		const ext = match[1] === "jpeg" ? "jpg" : match[1];
		const base64Data = match[2];
		const buffer = Buffer.from(base64Data, "base64");

		const safeName = filename
			? filename.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.[^.]+$/, "")
			: "image";
		const assetFilename = `${safeName}-${crypto.randomUUID()}.${ext}`;
		const assetDir = resolveWorkspacePath(noteAssetsPath(normalizedPath));
		await fs.mkdir(assetDir, { recursive: true });
		const assetPath = path.join(assetDir, assetFilename);
		await fs.writeFile(assetPath, buffer);

		return { path: `${noteAssetsDirectoryName}/${assetFilename}` };
	},
);

registerOwnerIpcHandler(
	"notes:get-asset-url",
	async (_event, notePath, assetRelativePath) => {
		if (attachedServeUrl) {
			const encodeAssetPath = (value) =>
				toPosixRelativePath(value)
					.split("/")
					.filter(Boolean)
					.map(encodeURIComponent)
					.join("/");
			return `${attachedServeUrl}/note-assets/${encodeAssetPath(notePath)}/${encodeAssetPath(assetRelativePath)}`;
		}
		const normalizedPath = currentNotePath(notePath);
		// Served over http: file:// img URLs are blocked on http:// pages.
		// Stored note content keeps the workspace-relative path; only the
		// display URL carries the (stable) server origin.
		const encodeAssetPath = (posixPath) =>
			toPosixRelativePath(posixPath)
				.split("/")
				.filter(Boolean)
				.map(encodeURIComponent)
				.join("/");
		const base = await getRendererServerUrl();
		return `${base}/note-assets/${encodeAssetPath(normalizedPath)}/${encodeAssetPath(assetRelativePath)}`;
	},
);
registerOwnerIpcHandler(
	"notes:read-asset",
	async (_event, notePath, assetRelativePath) => {
		const assetPath = path.posix.join(
			noteAssetsPath(notePath),
			assetRelativePath,
		);
		return fs.readFile(resolveWorkspacePath(assetPath));
	},
);
registerOwnerIpcHandler("notes:prune-assets", async (_event, notePath) => {
	if (attachedServeUrl) {
		return { ok: true, deleted: 0, skipped: "workspace-owner" };
	}
	await ensureWorkspace();
	return pruneNoteAssets(notePath);
});

registerOwnerIpcHandler(
	"notes:create-note",
	async (_event, parentPath, title) => {
		await ensureWorkspace();
		const noteTitle = title?.trim() || "Untitled";
		const notePath = path.posix.join(
			toPosixRelativePath(parentPath),
			crypto.randomUUID(),
		);
		await ensureNoteDirectory(notePath);
		const content = createEmptyNoteContent(noteTitle);
		await writeFileAtomic(
			resolveNoteContentPath(notePath),
			serializeNoteContent(content),
		);
		await writeLocalYNoteSnapshot(notePath, content);
		return { path: notePath, title: noteTitle };
	},
);

registerOwnerIpcHandler(
	"notes:create-folder",
	async (_event, parentPath, title) => {
		await ensureWorkspace();
		const folderName = title.trim() || "Untitled";
		const folderPath = await uniquePath(parentPath, folderName);
		await fs.mkdir(resolveWorkspacePath(folderPath), { recursive: true });
		return { path: folderPath, title: path.basename(folderPath) };
	},
);

registerOwnerIpcHandler("notes:create-space", async (_event, title) => {
	await ensureWorkspace();
	const spaceName = title.trim() || "Untitled";
	if (spaceName === "Trash") throw new Error("'Trash' is a reserved name");
	const spacePath = await uniquePath("", spaceName);
	await fs.mkdir(resolveWorkspacePath(spacePath), { recursive: true });
	return { path: spacePath, title: path.basename(spacePath) };
});

registerOwnerIpcHandler(
	"notes:rename-item",
	async (_event, itemPath, nextName) => {
		await ensureWorkspace();
		await migrateLegacyNotes();
		const current = currentNotePath(itemPath);

		if (await isNoteDirectory(current)) {
			const nextTitle = nextName?.trim() || "Untitled";
			await writeNoteTitle(current, nextTitle);
			return { path: current };
		}

		const extension = isMigratableNotePath(current) ? noteFileExtension : "";
		const nextBase = extension
			? ensureNoteExtension(nextName)
			: nextName.trim();
		const nextPath = path.posix.join(
			path.posix.dirname(current),
			nextBase || "Untitled",
		);
		await fs.rename(
			resolveWorkspacePath(current),
			resolveWorkspacePath(nextPath),
		);
		await moveIndexedPath(current, nextPath);
		registerYNotePathRedirect(current, nextPath);
		if (popoutWindows.has(current)) {
			const win = popoutWindows.get(current);
			popoutWindows.delete(current);
			popoutWindows.set(nextPath, win);
			win.webContents.send("note:path-changed", {
				from: current,
				to: nextPath,
			});
		}
		return { path: nextPath };
	},
);

registerOwnerIpcHandler(
	"notes:move-item",
	async (_event, itemPath, nextParentPath) => {
		await ensureWorkspace();
		await migrateLegacyNotes();
		const current = currentNotePath(itemPath);
		const nextParent = toPosixRelativePath(nextParentPath);
		const basename = path.posix.basename(current);

		if (isDescendantPath(current, nextParent)) {
			throw new Error("cannot move an item into itself");
		}

		const nextPath = await uniquePath(nextParent, basename);
		await fs.rename(
			resolveWorkspacePath(current),
			resolveWorkspacePath(nextPath),
		);
		await moveIndexedPath(current, nextPath);
		registerYNotePathRedirect(current, nextPath);
		if (popoutWindows.has(current)) {
			const win = popoutWindows.get(current);
			popoutWindows.delete(current);
			popoutWindows.set(nextPath, win);
			win.webContents.send("note:path-changed", {
				from: current,
				to: nextPath,
			});
		}
		return { path: nextPath };
	},
);

registerOwnerIpcHandler("notes:delete-item", async (_event, itemPath) => {
	await ensureWorkspace();
	await migrateLegacyNotes();
	const current = currentNotePath(itemPath);

	// Prevent deleting the Trash directory itself
	if (current === "Trash" || current.startsWith("Trash/")) {
		return { ok: true };
	}

	const deletedNotes = await collectDeletedNotes(current);
	await appendTombstones(deletedNotes);

	// Move each note directory to Trash (flatten)
	const trashMeta = await readTrashMeta();

	for (const notePath of deletedNotes) {
		const sourceDir = resolveWorkspacePath(notePath);
		const noteName = path.basename(notePath);
		let destName = noteName;
		let suffix = 1;

		// Handle name collision in Trash
		while (
			trashMeta[destName] ||
			(await fs
				.access(path.join(trashRoot(), destName))
				.then(() => true)
				.catch(() => false))
		) {
			destName = `${noteName}-${suffix}`;
			suffix++;
		}

		const destPath = path.join(trashRoot(), destName);
		await fs.rename(sourceDir, destPath);
		trashMeta[destName] = {
			originalPath: notePath,
			deletedAt: Date.now(),
		};
	}

	await writeTrashMeta(trashMeta);

	// If it was a folder (not a note), remove the empty directory
	if (!(await isNoteDirectory(current))) {
		await fs
			.rm(resolveWorkspacePath(current), { recursive: true, force: true })
			.catch(() => {});
	}

	await deleteIndexedPath(current);
	return { ok: true };
});

registerOwnerIpcHandler("notes:get-trash-contents", async () => {
	await ensureWorkspace();
	return scanTrashDirectory();
});

registerOwnerIpcHandler("notes:restore-item", async (_event, trashNoteName) => {
	await ensureWorkspace();
	const trashMeta = await readTrashMeta();
	const metaEntry = trashMeta[trashNoteName];

	if (!metaEntry) throw new Error("note not found in trash");

	const sourcePath = path.join(trashRoot(), trashNoteName);
	const originalPath = metaEntry.originalPath;
	const originalAbsPath = resolveWorkspacePath(originalPath);

	// Ensure parent directory exists
	await fs.mkdir(path.dirname(originalAbsPath), { recursive: true });

	// Handle name collision at original location
	let destPath = originalAbsPath;
	let suffix = 1;
	while (
		await fs
			.access(destPath)
			.then(() => true)
			.catch(() => false)
	) {
		const parsed = path.parse(originalAbsPath);
		destPath = path.join(parsed.dir, `${parsed.name}-${suffix}${parsed.ext}`);
		suffix++;
	}

	await fs.rename(sourcePath, destPath);

	// Update metadata
	delete trashMeta[trashNoteName];
	await writeTrashMeta(trashMeta);

	// Re-index the restored note
	const restoredRelativePath = toPosixRelativePath(
		path.relative(workspaceRoot(), destPath),
	);
	try {
		const stats = await fs.stat(resolveNoteContentPath(restoredRelativePath));
		await getIndexedNote(restoredRelativePath, stats);
	} catch {
		// Note might not be indexable, that's ok
	}

	return { ok: true, path: restoredRelativePath };
});

registerOwnerIpcHandler(
	"notes:permanent-delete-item",
	async (_event, trashNoteName) => {
		await ensureWorkspace();
		const trashMeta = await readTrashMeta();

		const sourcePath = path.join(trashRoot(), trashNoteName);
		await fs.rm(sourcePath, { recursive: true, force: true });

		delete trashMeta[trashNoteName];
		await writeTrashMeta(trashMeta);

		return { ok: true };
	},
);

registerOwnerIpcHandler("notes:empty-trash", async () => {
	await ensureWorkspace();

	const entries = await fs.readdir(trashRoot(), { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		await fs
			.rm(path.join(trashRoot(), entry.name), { recursive: true, force: true })
			.catch(() => {});
	}

	await writeTrashMeta({});

	return { ok: true };
});

registerOwnerIpcHandler("notes:read-app-state", async () => {
	await ensureWorkspace();
	await migrateLegacyNotes();
	try {
		return JSON.parse(await fs.readFile(statePath(), "utf8"));
	} catch {
		return {};
	}
});

registerOwnerIpcHandler("notes:write-app-state", async (_event, state) => {
	await ensureWorkspace();
	await writeFileAtomic(statePath(), JSON.stringify(state, null, 2));
	return { ok: true };
});

ipcMain.handle(
	"notes:export-file",
	async (_event, { content, format, defaultFilename }) => {
		const ext = format === "markdown" ? "md" : "txt";
		const defaultName = defaultFilename
			? `${defaultFilename}.${ext}`
			: `note.${ext}`;

		const result = await dialog.showSaveDialog({
			defaultPath: path.join(app.getPath("documents"), defaultName),
			filters: [
				{
					name: format === "markdown" ? "Markdown" : "Text",
					extensions: [ext],
				},
				{ name: "All Files", extensions: ["*"] },
			],
		});

		if (result.canceled || !result.filePath) {
			return { canceled: true };
		}

		await fs.writeFile(result.filePath, content, "utf-8");

		return { canceled: false, filePath: result.filePath };
	},
);

ipcMain.handle("notes:get-default-export-dir", () => {
	return app.getPath("documents");
});

ipcMain.handle("notes:popout-note", async (_event, notePath) => {
	await ensureWorkspace();
	await migrateLegacyNotes();
	const normalizedPath = currentNotePath(notePath);

	if (popoutWindows.has(normalizedPath)) {
		const existing = popoutWindows.get(normalizedPath);
		if (!existing.isDestroyed()) {
			existing.focus();
			return { ok: true };
		}
	}

	const popout = new BrowserWindow(
		createWindowOptions({
			width: 600,
			height: 700,
			minWidth: 380,
			minHeight: 400,
		}),
	);

	popoutWindows.set(normalizedPath, popout);

	attachRendererRecovery(popout);
	revealWindow(popout);

	popout.on("closed", () => {
		popoutWindows.delete(normalizedPath);
		mainWindow?.webContents.send("popout:closed", normalizedPath);
	});

	popout.webContents.on("will-navigate", (event, url) => {
		if (isAppUrl(url)) return;
		event.preventDefault();
		shell.openExternal(url);
	});

	const encodedPath = encodeURIComponent(normalizedPath);

	if (attachedServeUrl) {
		await popout.loadURL(
			`${attachedServeUrl}/popout.html?popout=1&note=${encodeURIComponent(encodedPath)}`,
		);
	} else if (devServerUrl) {
		await popout.loadURL(
			`${devServerUrl}/popout.html?popout=1&note=${encodedPath}`,
		);
	} else {
		// Keep the historical double-encoding: popout-main runs
		// URLSearchParams.get() + decodeURIComponent on the value.
		const base = await getRendererServerUrl();
		await popout.loadURL(
			`${base}/popout.html?popout=1&note=${encodeURIComponent(encodedPath)}`,
		);
	}

	return { ok: true };
});

app.whenReady().then(async () => {
	// Serve mode: server/index.js owns the process lifecycle, no windows.
	if (isServeMode) return;
	// The first process owns the workspace. If serve owns it, this desktop
	// surface attaches to serve instead of opening a second SQLite/Yjs stack.
	try {
		const locks = require("./server/lib/locks");
		const root = workspaceRoot();
		let wsLock = locks.readWorkspaceLock(root);
		for (let attempt = 0; attempt < 30; attempt += 1) {
			if (
				!wsLock ||
				!locks.isPidAlive(wsLock.pid) ||
				wsLock.mode !== "serve" ||
				typeof wsLock.url === "string"
			)
				break;
			await new Promise((resolve) => setTimeout(resolve, 100));
			wsLock = locks.readWorkspaceLock(root);
		}
		if (wsLock && locks.isPidAlive(wsLock.pid)) {
			if (
				wsLock.mode === "serve" &&
				typeof wsLock.url === "string" &&
				wsLock.url.startsWith("http")
			) {
				attachedServeUrl = wsLock.url;
				if (!process.argv.includes("--paperite-attached-workspace")) {
					process.argv.push("--paperite-attached-workspace");
				}
				console.log(
					`[paperite] attaching desktop surface to ${attachedServeUrl} (pid ${wsLock.pid})`,
				);
			} else {
				const holder =
					wsLock.mode === "serve"
						? `paperite serve at ${wsLock.url ?? (wsLock.port ? `http://localhost:${wsLock.port}` : "unknown address")}`
						: "another Paperite process";
				const message = `Workspace is already open by ${holder} (pid ${wsLock.pid}).`;
				console.error(`[paperite] ${message}`);
				try {
					dialog.showErrorBox("Paperite workspace is busy", message);
				} catch {
					// headless / stub harness — console error is the signal
				}
				app.quit();
				return;
			}
		} else {
			locks.acquireWorkspaceLock(root, { mode: "electron" });
		}
	} catch (error) {
		// Lock refusal already exits inside acquireWorkspaceLock; any other
		// error here must not silently continue with a split sqlite.
		if (error?.code !== undefined) throw error;
		console.error(`[paperite] workspace lock failed: ${error.message}`);
		app.quit();
		return;
	}
	if (!attachedServeUrl) {
		await startWorkspaceOwnerBridge();
	}
	createApplicationMenu();
	if (!attachedServeUrl) {
		await purgeOldTrashItems();
		await purgeLegacyDriveToken();
		refreshWorkspaceWatchers().catch(() => undefined);
	}
	createWindow();
	if (attachedServeUrl) {
		// Serve-first ordering: serve owns the workspace, so it has no owner
		// bridge to ask for the Clerk session. Publish a dedicated auth
		// bridge instead and let serve pull the session from us. The browser
		// still never holds a Clerk session of its own.
		await startAuthBridge();
	}
	powerMonitor?.on("resume", () => recoverWindowsAfterSuspend("resume"));
	powerMonitor?.on("unlock-screen", () =>
		recoverWindowsAfterSuspend("unlock-screen"),
	);
	const startupAuthCallback = getProtocolCallbackArg(process.argv);
	if (startupAuthCallback) handleProtocolCallback(startupAuthCallback);
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

// linux: second-instance bukan open-url. Skipped in serve mode —
// serve owns its own global lockfile (tmp, pid-checked); Electron keeps
// the single-instance lock. Workspace-level coexistence attaches through
// the owner bridge instead of opening a second state stack.
const gotLock = isServeMode ? true : app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
} else {
	app.on("second-instance", (_event, argv) => {
		console.log("[paperite] second-instance argv:", JSON.stringify(argv));
		const url = getProtocolCallbackArg(argv);
		if (url) {
			handleProtocolCallback(url);
		} else {
			focusMainWindow();
		}
	});
}

// mac
app.on("open-url", (event, url) => {
	event.preventDefault();
	if (isAuthCallbackUrl(url)) {
		handleProtocolCallback(url);
	}
});

app.on("window-all-closed", () => {
	for (const watcher of workspaceWatchers.values()) watcher.close();
	workspaceWatchers.clear();
	indexDb?.close();
	indexDb = undefined;
	workspaceOwnerWs?.close();
	workspaceOwnerServer?.close();
	try {
		if (!isServeMode) {
			require("./server/lib/locks").releaseWorkspaceLock(workspaceRoot());
		}
	} catch {
		// best effort
	}
	if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
	try {
		if (!isServeMode) {
			require("./server/lib/locks").releaseWorkspaceLock(workspaceRoot());
		}
	} catch {
		// best effort
	}
	// Leave no stale auth-bridge record behind: a dead desktop must not
	// look like a live one to a serve instance.
	void require("./server/lib/auth-bridge")
		.clearAuthBridge(workspaceRoot())
		.catch(() => undefined);
	authBridgeServer?.close();
});
