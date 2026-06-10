const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { app, BrowserWindow, ipcMain, shell } = require("electron");

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
let mainWindow; // hoist ke luar
const popoutWindows = new Map(); // key: notePath, value: BrowserWindow
let pendingAuthCallbackUrl;
let workspaceWatchTimer;
const workspaceWatchers = new Map();
let indexDb;

const workspaceRoot = () => path.join(app.getPath("documents"), "Paperite");
const statePath = () => path.join(workspaceRoot(), ".paperite", "state.json");
const indexPath = () => path.join(workspaceRoot(), ".paperite", "index.sqlite");
const revisionsRoot = () =>
	path.join(workspaceRoot(), ".paperite", "revisions");
const tombstonesPath = () =>
	path.join(workspaceRoot(), ".paperite", "tombstones.jsonl");

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
	await fs.mkdir(path.dirname(statePath()), { recursive: true });
	await fs.mkdir(revisionsRoot(), { recursive: true });
};

const writeFileAtomic = async (targetPath, content) => {
	const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;

	try {
		await fs.writeFile(temporaryPath, content, "utf8");
		await fs.rename(temporaryPath, targetPath);
	} catch (error) {
		await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
		throw error;
	}
};

const noteFileExtension = ".json";
const isNoteFilePath = (itemPath) => /\.json$/i.test(itemPath);
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

const isUuidFilename = (notePath) =>
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i.test(
		path.posix.basename(notePath),
	);

const readNoteTitle = (content) => {
	const normalized = normalizeNoteContent(content);
	return typeof normalized.title === "string" ? normalized.title : "";
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
	const rawContent = await fs.readFile(resolveWorkspacePath(notePath), "utf8");
	const trimmedContent = rawContent.trim();

	if (!trimmedContent) return createEmptyNoteContent();

	if (isLegacyMarkdownPath(notePath)) {
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

const revisionKey = (notePath) => Buffer.from(notePath).toString("base64url");

const writeRevisionSnapshot = async (notePath, nextContent) => {
	try {
		const currentContent = await readNoteContent(notePath);
		const currentSerialized = serializeNoteContent(currentContent);
		const nextSerialized = serializeNoteContent(nextContent);
		if (currentSerialized === nextSerialized) return;

		const revisionDirectory = path.join(revisionsRoot(), revisionKey(notePath));
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
	const absolutePath = resolveWorkspacePath(itemPath);

	try {
		const stats = await fs.stat(absolutePath);

		if (stats.isFile()) {
			return isMigratableNotePath(itemPath) ? [itemPath] : [];
		}

		if (!stats.isDirectory()) return [];

		const entries = await fs.readdir(absolutePath, { withFileTypes: true });
		const deletedNotes = [];

		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;

			deletedNotes.push(
				...(await collectDeletedNotes(path.posix.join(itemPath, entry.name))),
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
	indexDb.exec("CREATE UNIQUE INDEX IF NOT EXISTS notes_id_idx ON notes(id)");

	return indexDb;
};

const getIndexedNote = async (notePath, stats) => {
	const db = await getIndexDb();
	const existing = db
		.prepare(
			"SELECT id, title, preview, mtime_ms AS mtimeMs, size FROM notes WHERE path = ?",
		)
		.get(notePath);

	if (
		existing?.id &&
		existing.mtimeMs === stats.mtimeMs &&
		existing.size === stats.size
	) {
		return {
			title: existing.title,
			preview: existing.preview,
			updatedAt: existing.mtimeMs,
		};
	}

	const content = await readNoteContent(notePath);
	const plainText = noteContentText(content);
	const id = existing?.id || createAvailableNoteId(db, notePath);
	const title = readNoteTitle(content) || toNoteTitle(path.posix.basename(notePath));
	const preview = toNotePreviewFromContent(content);
	const metadata = extractNoteMetadata(content);

	db.prepare(`
		INSERT INTO notes (id, path, title, preview, mtime_ms, size, indexed_at, sync_status, sync_version)
		VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT sync_status FROM notes WHERE path = ?), 'local'), COALESCE((SELECT sync_version FROM notes WHERE path = ?), 0) + 1)
		ON CONFLICT(path) DO UPDATE SET
			id = excluded.id,
			title = excluded.title,
			preview = excluded.preview,
			mtime_ms = excluded.mtime_ms,
			size = excluded.size,
			indexed_at = excluded.indexed_at,
			sync_status = excluded.sync_status,
			sync_version = excluded.sync_version
	`).run(
		id,
		notePath,
		title,
		preview,
		stats.mtimeMs,
		stats.size,
		Date.now(),
		notePath,
		notePath,
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

	db.prepare("DELETE FROM note_fts WHERE path = ?").run(notePath);
	db.prepare(
		"INSERT INTO note_fts (path, title, content) VALUES (?, ?, ?)",
	).run(notePath, title, plainText);

	return {
		title,
		preview,
		updatedAt: stats.mtimeMs,
	};
};

const deleteIndexedPath = async (itemPath) => {
	if (!indexDb) return;

	const normalized = normalizeRelativePath(itemPath).replaceAll(path.sep, "/");
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

	const rows = indexDb
		.prepare(
			"SELECT id, path, title, preview, mtime_ms AS mtimeMs, size, indexed_at AS indexedAt, sync_status AS syncStatus, sync_version AS syncVersion, remote_id AS remoteId, last_synced_at AS lastSyncedAt FROM notes",
		)
		.all();

	for (const row of rows) {
		if (!isDescendantPath(fromPath, row.path)) continue;

		const nextPath =
			row.path === fromPath
				? toPath
				: `${toPath}/${row.path.slice(fromPath.length + 1)}`;
		let nextTitle;
		if (isUuidFilename(nextPath)) {
			try {
				const content = await readNoteContent(nextPath);
				nextTitle = readNoteTitle(content) || "Untitled";
			} catch {
				nextTitle = "Untitled";
			}
		} else {
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

const migrateMarkdownNotes = async (relativePath = "") => {
	const absolutePath = resolveWorkspacePath(relativePath);
	const entries = await fs.readdir(absolutePath, { withFileTypes: true });

	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;

		const itemPath = path.posix.join(
			relativePath.replaceAll(path.sep, "/"),
			entry.name,
		);

		if (entry.isDirectory()) {
			await migrateMarkdownNotes(itemPath);
			continue;
		}

		if (!entry.isFile() || !isLegacyMarkdownPath(entry.name)) continue;

		const markdown = await fs.readFile(resolveWorkspacePath(itemPath), "utf8");
		const title = toNoteTitle(entry.name);
		const filename = `${crypto.randomUUID()}${noteFileExtension}`;
		const nextPath = path.posix.join(relativePath, filename);
		const content = textToNoteContent(markdown);
		content.title = title;

		await writeFileAtomic(
			resolveWorkspacePath(nextPath),
			serializeNoteContent(content),
		);
		await fs.rm(resolveWorkspacePath(itemPath), { force: true });
	}
};

const scanDirectory = async (relativePath = "", knownNotePaths = new Set()) => {
	const absolutePath = resolveWorkspacePath(relativePath);
	const entries = await fs.readdir(absolutePath, { withFileTypes: true });
	const visibleEntries = entries.filter((entry) => !entry.name.startsWith("."));

	const folders = await Promise.all(
		visibleEntries
			.filter((entry) => entry.isDirectory())
			.sort((first, second) => first.name.localeCompare(second.name))
			.map(async (entry) => {
				const childPath = path.posix.join(
					relativePath.replaceAll(path.sep, "/"),
					entry.name,
				);
				return {
					type: "folder",
					title: entry.name,
					path: childPath,
					children: await scanDirectory(childPath, knownNotePaths),
				};
			}),
	);

	const notes = await Promise.all(
		visibleEntries
			.filter((entry) => entry.isFile() && isNoteFilePath(entry.name))
			.sort((first, second) => first.name.localeCompare(second.name))
			.map(async (entry) => {
				const notePath = path.posix.join(
					relativePath.replaceAll(path.sep, "/"),
					entry.name,
				);

				const stats = await fs.stat(resolveWorkspacePath(notePath));
				knownNotePaths.add(notePath);
				const indexedNote = await getIndexedNote(notePath, stats);

				return {
					type: "note",
					title: indexedNote.title,
					path: notePath,
					preview: indexedNote.preview,
					updatedAt: indexedNote.updatedAt,
				};
			}),
	);
	notes.sort((first, second) => second.updatedAt - first.updatedAt);

	return [...folders, ...notes];
};

const listWorkspace = async () => {
	const start = performance.now();
	await ensureWorkspace();
	await migrateMarkdownNotes();
	const knownNotePaths = new Set();

	const rootEntries = await fs.readdir(workspaceRoot(), {
		withFileTypes: true,
	});
	const spaces = await Promise.all(
		rootEntries
			.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
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
			relativePath.replaceAll(path.sep, "/"),
			entry.name,
		);
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

const isAppUrl = (url) => {
	if (url.startsWith("paperite://")) return true;
	if (devServerUrl && url.startsWith(devServerUrl)) return true;
	return url.startsWith("file://");
};

const createWindow = () => {
	mainWindow = new BrowserWindow({
		width: 800,
		height: 600,
		minWidth: 420,
		minHeight: 520,
		frame: false,
		title: "Paperite",
		backgroundColor: "#171717",
		webPreferences: {
			preload: require("node:path").join(__dirname, "preload.js"),
		},
	});

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

	if (devServerUrl) {
		mainWindow.loadURL(devServerUrl);
	} else {
		mainWindow.loadFile("dist/index.html");
	}
};

const notifyWorkspaceChanged = () => {
	if (workspaceWatchTimer) clearTimeout(workspaceWatchTimer);

	workspaceWatchTimer = setTimeout(() => {
		refreshWorkspaceWatchers().catch(() => undefined);
		mainWindow?.webContents.send("workspace:changed");
	}, 150);
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

app.setAsDefaultProtocolClient("paperite");

const isAuthCallbackUrl = (url) => url.startsWith("paperite://auth/");

const getAuthCallbackArg = (argv) => argv.find(isAuthCallbackUrl);

const sendAuthCallback = (url) => {
	pendingAuthCallbackUrl = url;
	mainWindow?.webContents.send("auth-callback", url);
	mainWindow?.focus();
};

ipcMain.handle("open-external", async (_event, url) => {
	await shell.openExternal(url);
});

ipcMain.handle("auth:get-pending-callback", () => {
	const url = pendingAuthCallbackUrl ?? null;
	pendingAuthCallbackUrl = undefined;
	return url;
});

ipcMain.handle("app:set-title", (event, title) => {
	const window = getFocusedWindow(event);
	const nextTitle =
		typeof title === "string" && title.trim() ? title : "Paperite";
	window?.setTitle(nextTitle);
	return { ok: true };
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

ipcMain.handle("notes:get-workspace", async () => listWorkspace());

ipcMain.handle("notes:search", async (_event, query) => searchNotes(query));

ipcMain.handle("notes:read-note", async (_event, notePath) => {
	await ensureWorkspace();
	return readNoteContent(notePath, true);
});

ipcMain.handle("notes:write-note", async (_event, notePath, content) => {
	await ensureWorkspace();
	const normalizedContent = normalizeNoteContent(content);

	// preserve existing id from disk if the incoming content doesn't have one
	if (!normalizedContent.id) {
		try {
			const existing = await readNoteContent(notePath, true);
			if (existing.id) normalizedContent.id = existing.id;
		} catch {
			// new note or missing file — id already set by createEmptyNoteContent
		}
	}

	if (!normalizedContent.id) {
		normalizedContent.id = crypto.randomUUID();
	}

	// sync title from index for UUID-named files
	if (isUuidFilename(notePath) && !normalizedContent.title && indexDb) {
		const row = indexDb
			.prepare("SELECT title FROM notes WHERE path = ?")
			.get(notePath);
		if (row?.title) normalizedContent.title = row.title;
	}

	await writeRevisionSnapshot(notePath, normalizedContent);
	await writeFileAtomic(
		resolveWorkspacePath(notePath),
		serializeNoteContent(normalizedContent),
	);
	const stats = await fs.stat(resolveWorkspacePath(notePath));
	await getIndexedNote(notePath, stats);
	return { ok: true };
});

ipcMain.handle("notes:create-note", async (_event, parentPath, title) => {
	await ensureWorkspace();
	const noteTitle = title?.trim() || "Untitled";
	const filename = `${crypto.randomUUID()}${noteFileExtension}`;
	const notePath = path.posix.join(parentPath, filename);
	await fs.writeFile(
		resolveWorkspacePath(notePath),
		serializeNoteContent(createEmptyNoteContent(noteTitle)),
		"utf8",
	);
	return { path: notePath, title: noteTitle };
});

ipcMain.handle("notes:create-folder", async (_event, parentPath, title) => {
	await ensureWorkspace();
	const folderName = title.trim() || "Untitled";
	const folderPath = await uniquePath(parentPath, folderName);
	await fs.mkdir(resolveWorkspacePath(folderPath), { recursive: true });
	return { path: folderPath, title: path.basename(folderPath) };
});

ipcMain.handle("notes:create-space", async (_event, title) => {
	await ensureWorkspace();
	const spaceName = title.trim() || "Untitled";
	const spacePath = await uniquePath("", spaceName);
	await fs.mkdir(resolveWorkspacePath(spacePath), { recursive: true });
	return { path: spacePath, title: path.basename(spacePath) };
});

ipcMain.handle("notes:rename-item", async (_event, itemPath, nextName) => {
	await ensureWorkspace();
	const current = normalizeRelativePath(itemPath);

	if (isMigratableNotePath(current) && isUuidFilename(current)) {
		const nextTitle = nextName?.trim() || "Untitled";
		if (indexDb) {
			indexDb
				.prepare("UPDATE notes SET title = ? WHERE path = ?")
				.run(nextTitle, current);
			indexDb
				.prepare("UPDATE note_fts SET title = ? WHERE path = ?")
				.run(nextTitle, current);
		}
		return { path: current };
	}

	const extension = isMigratableNotePath(current) ? noteFileExtension : "";
	const nextBase = extension ? ensureNoteExtension(nextName) : nextName.trim();
	const nextPath = path.posix.join(
		path.posix.dirname(current),
		nextBase || "Untitled",
	);
	await fs.rename(
		resolveWorkspacePath(current),
		resolveWorkspacePath(nextPath),
	);
	await moveIndexedPath(current, nextPath);
	if (popoutWindows.has(current)) {
		const win = popoutWindows.get(current);
		popoutWindows.delete(current);
		popoutWindows.set(nextPath, win);
		win.webContents.send("note:path-changed", { from: current, to: nextPath });
	}
	return { path: nextPath };
});

ipcMain.handle("notes:move-item", async (_event, itemPath, nextParentPath) => {
	await ensureWorkspace();
	const current = normalizeRelativePath(itemPath).replaceAll(path.sep, "/");
	const nextParent = normalizeRelativePath(nextParentPath).replaceAll(
		path.sep,
		"/",
	);
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
	if (popoutWindows.has(current)) {
		const win = popoutWindows.get(current);
		popoutWindows.delete(current);
		popoutWindows.set(nextPath, win);
		win.webContents.send("note:path-changed", { from: current, to: nextPath });
	}
	return { path: nextPath };
});

ipcMain.handle("notes:delete-item", async (_event, itemPath) => {
	await ensureWorkspace();
	const deletedNotes = await collectDeletedNotes(itemPath);
	await appendTombstones(deletedNotes);
	await fs.rm(resolveWorkspacePath(itemPath), { recursive: true, force: true });
	await deleteIndexedPath(itemPath);
	return { ok: true };
});

ipcMain.handle("notes:read-app-state", async () => {
	await ensureWorkspace();
	try {
		return JSON.parse(await fs.readFile(statePath(), "utf8"));
	} catch {
		return {};
	}
});

ipcMain.handle("notes:write-app-state", async (_event, state) => {
	await ensureWorkspace();
	await writeFileAtomic(statePath(), JSON.stringify(state, null, 2));
	return { ok: true };
});

ipcMain.handle("notes:popout-note", async (_event, notePath) => {
	if (popoutWindows.has(notePath)) {
		const existing = popoutWindows.get(notePath);
		if (!existing.isDestroyed()) {
			existing.focus();
			return { ok: true };
		}
	}

	const popout = new BrowserWindow({
		width: 600,
		height: 700,
		minWidth: 380,
		minHeight: 400,
		frame: false,
		title: "Paperite",
		backgroundColor: "#171717",
		webPreferences: {
			preload: require("node:path").join(__dirname, "preload.js"),
		},
	});

	popoutWindows.set(notePath, popout);

	popout.on("closed", () => {
		popoutWindows.delete(notePath);
		mainWindow?.webContents.send("popout:closed", notePath);
	});

	popout.webContents.on("will-navigate", (event, url) => {
		if (isAppUrl(url)) return;
		event.preventDefault();
		shell.openExternal(url);
	});

	const encodedPath = encodeURIComponent(notePath);

	if (devServerUrl) {
		await popout.loadURL(
			`${devServerUrl}/popout.html?popout=1&note=${encodedPath}`,
		);
	} else {
		await popout.loadFile("dist/popout.html", {
			query: { popout: "1", note: encodedPath },
		});
	}

	return { ok: true };
});

app.whenReady().then(() => {
	refreshWorkspaceWatchers().catch(() => undefined);
	createWindow();
	const startupAuthCallback = getAuthCallbackArg(process.argv);
	if (startupAuthCallback) sendAuthCallback(startupAuthCallback);
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

// linux: second-instance bukan open-url
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
} else {
	app.on("second-instance", (_event, argv) => {
		const url = getAuthCallbackArg(argv);
		if (url) sendAuthCallback(url);
	});
}

// mac
app.on("open-url", (event, url) => {
	event.preventDefault();
	if (isAuthCallbackUrl(url)) sendAuthCallback(url);
});

app.on("window-all-closed", () => {
	for (const watcher of workspaceWatchers.values()) watcher.close();
	workspaceWatchers.clear();
	indexDb?.close();
	indexDb = undefined;
	if (process.platform !== "darwin") app.quit();
});
