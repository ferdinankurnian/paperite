const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const {
	indexPath,
	readNoteContent,
	normalizeNoteContent,
	collectNoteText,
	noteContentText,
	readNoteTitle,
	toNoteTitle,
	toNotePreviewFromContent,
	workspaceRoot,
	ensureWorkspace,
	currentNotePath,
	revisionKey,
	isDescendantPath,
} = require("./workspace");

let db;

const openDb = async () => {
	if (db) return db;

	await ensureWorkspace();
	db = new DatabaseSync(indexPath());
	db.exec(`
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
	addColumnIfMissing(db, "notes", "id", "id TEXT");
	addColumnIfMissing(
		db,
		"notes",
		"sync_status",
		"sync_status TEXT NOT NULL DEFAULT 'local'",
	);
	addColumnIfMissing(
		db,
		"notes",
		"sync_version",
		"sync_version INTEGER NOT NULL DEFAULT 0",
	);
	addColumnIfMissing(db, "notes", "remote_id", "remote_id TEXT");
	addColumnIfMissing(db, "notes", "last_synced_at", "last_synced_at INTEGER");
	db.exec("CREATE UNIQUE INDEX IF NOT EXISTS notes_id_idx ON notes(id)");

	return db;
};

const addColumnIfMissing = (database, table, column, definition) => {
	const columns = database.prepare(`PRAGMA table_info(${table})`).all();
	if (columns.some((existingColumn) => existingColumn.name === column)) return;
	database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
};

const createNoteId = (notePath) => revisionKey(notePath);

const createAvailableNoteId = (database, notePath) => {
	const baseId = createNoteId(notePath);
	let candidate = baseId;
	let suffix = 1;

	while (database.prepare("SELECT 1 FROM notes WHERE id = ?").get(candidate)) {
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

const getIndexedNote = async (notePath, stats) => {
	const normalizedPath = currentNotePath(notePath);
	const database = await openDb();
	const existing = database
		.prepare(
			"SELECT id, title, preview, mtime_ms AS mtimeMs, size FROM notes WHERE path = ?",
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
		};
	}

	const content = await readNoteContent(normalizedPath);
	const plainText = noteContentText(content);
	const id = existing?.id || createAvailableNoteId(database, normalizedPath);
	const title =
		readNoteTitle(content) || toNoteTitle(path.posix.basename(normalizedPath));
	const preview = toNotePreviewFromContent(content);
	const metadata = extractNoteMetadata(content);

	database
		.prepare(
			`INSERT INTO notes (id, path, title, preview, mtime_ms, size, indexed_at, sync_status, sync_version)
		VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT sync_status FROM notes WHERE path = ?), 'local'), COALESCE((SELECT sync_version FROM notes WHERE path = ?), 0) + 1)
		ON CONFLICT(path) DO UPDATE SET
			id = excluded.id,
			title = excluded.title,
			preview = excluded.preview,
			mtime_ms = excluded.mtime_ms,
			size = excluded.size,
			indexed_at = excluded.indexed_at,
			sync_status = excluded.sync_status,
			sync_version = excluded.sync_version`,
		)
		.run(
			id,
			normalizedPath,
			title,
			preview,
			stats.mtimeMs,
			stats.size,
			Date.now(),
			normalizedPath,
			normalizedPath,
		);
	database.prepare("DELETE FROM note_headings WHERE note_id = ?").run(id);
	database.prepare("DELETE FROM note_tags WHERE note_id = ?").run(id);
	database.prepare("DELETE FROM note_tasks WHERE note_id = ?").run(id);
	database.prepare("DELETE FROM note_backlinks WHERE note_id = ?").run(id);

	const insertHeading = database.prepare(
		"INSERT INTO note_headings (note_id, depth, text, line) VALUES (?, ?, ?, ?)",
	);
	const insertTag = database.prepare(
		"INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)",
	);
	const insertTask = database.prepare(
		"INSERT INTO note_tasks (note_id, text, checked, line) VALUES (?, ?, ?, ?)",
	);
	const insertBacklink = database.prepare(
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

	database.prepare("DELETE FROM note_fts WHERE path = ?").run(normalizedPath);
	database
		.prepare("INSERT INTO note_fts (path, title, content) VALUES (?, ?, ?)")
		.run(normalizedPath, title, plainText);

	return {
		title,
		preview,
		updatedAt: stats.mtimeMs,
	};
};

const searchNotes = async (query) => {
	const trimmed = typeof query === "string" ? query.trim() : "";
	if (!trimmed) return [];

	const database = await openDb();
	const safeQuery = trimmed
		.split(/\s+/)
		.map((term) => `"${term.replaceAll('"', '""')}"*`)
		.join(" ");

	return database
		.prepare(
			`SELECT
				notes.path,
				notes.title,
				notes.preview,
				notes.mtime_ms AS updatedAt,
				bm25(note_fts) AS rank
			FROM note_fts
			JOIN notes ON notes.path = note_fts.path
			WHERE note_fts MATCH ?
			ORDER BY rank
			LIMIT 50`,
		)
		.all(safeQuery);
};

const deleteIndexedPath = async (itemPath) => {
	if (!db) return;

	const normalized = currentNotePath(itemPath);
	const rows = db.prepare("SELECT id, path FROM notes").all();

	for (const row of rows) {
		if (!isDescendantPath(normalized, row.path)) continue;

		db.prepare("DELETE FROM notes WHERE path = ?").run(row.path);
		db.prepare("DELETE FROM note_headings WHERE note_id = ?").run(row.id);
		db.prepare("DELETE FROM note_tags WHERE note_id = ?").run(row.id);
		db.prepare("DELETE FROM note_tasks WHERE note_id = ?").run(row.id);
		db.prepare("DELETE FROM note_backlinks WHERE note_id = ?").run(row.id);
		db.prepare("DELETE FROM note_fts WHERE path = ?").run(row.path);
	}
};

const moveIndexedPath = async (fromPath, toPath) => {
	if (!db) return;

	const normalizedFromPath = currentNotePath(fromPath);
	const { toPosixRelativePath } = require("./workspace");
	const normalizedToPath = toPosixRelativePath(toPath);

	const rows = db
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

		db.prepare("DELETE FROM notes WHERE path = ?").run(row.path);
		db.prepare(
			"INSERT INTO notes (id, path, title, preview, mtime_ms, size, indexed_at, sync_status, sync_version, remote_id, last_synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		).run(
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
		db.prepare("UPDATE note_fts SET path = ?, title = ? WHERE path = ?").run(
			nextPath,
			nextTitle,
			row.path,
		);
	}
};

const pruneIndex = async (knownNotePaths) => {
	const database = await openDb();
	const rows = database.prepare("SELECT id, path FROM notes").all();

	for (const row of rows) {
		if (knownNotePaths.has(row.path)) continue;

		database.prepare("DELETE FROM notes WHERE path = ?").run(row.path);
		database.prepare("DELETE FROM note_headings WHERE note_id = ?").run(row.id);
		database.prepare("DELETE FROM note_tags WHERE note_id = ?").run(row.id);
		database.prepare("DELETE FROM note_tasks WHERE note_id = ?").run(row.id);
		database
			.prepare("DELETE FROM note_backlinks WHERE note_id = ?")
			.run(row.id);
		database.prepare("DELETE FROM note_fts WHERE path = ?").run(row.path);
	}
};

const close = () => {
	if (db) {
		db.close();
		db = undefined;
	}
};

module.exports = {
	openDb,
	getIndexedNote,
	searchNotes,
	deleteIndexedPath,
	moveIndexedPath,
	pruneIndex,
	close,
};
