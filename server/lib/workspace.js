const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const noteFileExtension = ".json";
const noteManifestFilename = "note.json";
const noteAssetsDirectoryName = "assets";
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

let root = path.join(os.homedir(), "Documents", "Paperite");

const configure = (workspacePath) => {
	root = workspacePath;
};

const workspaceRoot = () => root;
const trashRoot = () => path.join(root, "Trash");
const trashMetaPath = () => path.join(trashRoot(), ".trash-meta.json");
const statePath = () => path.join(root, ".paperite", "state.json");
const indexPath = () => path.join(root, ".paperite", "index.sqlite");
const revisionsRoot = () => path.join(root, ".paperite", "revisions");
const syncRoot = () => path.join(root, ".paperite", "sync");
const syncNotesRoot = () => path.join(syncRoot(), "notes");
const tombstonesPath = () => path.join(root, ".paperite", "tombstones.jsonl");

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
	const target = path.resolve(root, normalizeRelativePath(relativePath));
	if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
		throw new Error("path escapes workspace");
	}
	return target;
};

const toPosixRelativePath = (relativePath = "") =>
	normalizeRelativePath(relativePath).replaceAll(path.sep, "/");

const currentNotePath = (notePath) => toPosixRelativePath(notePath);

const isNoteManifestPath = (itemPath) =>
	path.posix.basename(itemPath) === noteManifestFilename;

const isNoteFilePath = (itemPath) =>
	/\.json$/i.test(itemPath) && !isNoteManifestPath(itemPath);

const isLegacyMarkdownPath = (itemPath) => /\.md$/i.test(itemPath);

const isMigratableNotePath = (itemPath) =>
	isNoteFilePath(itemPath) || isLegacyMarkdownPath(itemPath);

const noteContentPath = (notePath) =>
	path.posix.join(toPosixRelativePath(notePath), noteManifestFilename);

const resolveNoteContentPath = (notePath) =>
	resolveWorkspacePath(noteContentPath(notePath));

const noteAssetsPath = (notePath) =>
	path.posix.join(toPosixRelativePath(notePath), noteAssetsDirectoryName);

const isDescendantPath = (parentPath, childPath) =>
	childPath === parentPath || childPath.startsWith(`${parentPath}/`);

const isUuidFilename = (notePath) =>
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.json)?$/i.test(
		path.posix.basename(notePath),
	);

const isPlainObject = (value) =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const toNoteTitle = (filename) => filename.replace(/\.(?:json|md)$/i, "");

const ensureNoteExtension = (name) => {
	const trimmed = name.trim() || "Untitled";
	const base = toNoteTitle(trimmed) || "Untitled";
	return `${base}${noteFileExtension}`;
};

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

const createEmptyNoteContent = (title) => ({
	id: crypto.randomUUID(),
	type: "doc",
	...(title ? { title } : {}),
	content: [{ type: "paragraph" }],
});

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

const readNoteTitle = (content) => {
	const normalized = normalizeNoteContent(content);
	return typeof normalized.title === "string" ? normalized.title : "";
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

const ensureWorkspace = async () => {
	await fs.mkdir(path.join(root, "Inbox"), { recursive: true });
	await fs.mkdir(trashRoot(), { recursive: true });
	await fs.mkdir(path.dirname(statePath()), { recursive: true });
	await fs.mkdir(revisionsRoot(), { recursive: true });
	await fs.mkdir(syncNotesRoot(), { recursive: true });
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

const readNoteContent = async (notePath, ensureId) => {
	const normalizedPath = currentNotePath(notePath);
	const filePath = isMigratableNotePath(normalizedPath)
		? resolveWorkspacePath(normalizedPath)
		: resolveNoteContentPath(normalizedPath);
	const rawContent = await fs.readFile(filePath, "utf8");
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
			knownNotePaths.add(childPath);
			try {
				const content = await readNoteContent(childPath);
				const stats = await fs.stat(resolveNoteContentPath(childPath));
				const title =
					readNoteTitle(content) || toNoteTitle(path.posix.basename(childPath));
				const preview = toNotePreviewFromContent(content);

				notes.push({
					type: "note",
					title,
					path: childPath,
					preview,
					updatedAt: stats.mtimeMs,
				});
			} catch {
				notes.push({
					type: "note",
					title: toNoteTitle(path.posix.basename(childPath)),
					path: childPath,
					preview: "",
					updatedAt: 0,
				});
			}
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
		knownNotePaths.add(notePath);
		try {
			const content = await readNoteContent(notePath);
			const stats = await fs.stat(resolveWorkspacePath(notePath));
			const title =
				readNoteTitle(content) || toNoteTitle(path.posix.basename(notePath));
			const preview = toNotePreviewFromContent(content);

			notes.push({
				type: "note",
				title,
				path: notePath,
				preview,
				updatedAt: stats.mtimeMs,
			});
		} catch {
			notes.push({
				type: "note",
				title: toNoteTitle(path.posix.basename(notePath)),
				path: notePath,
				preview: "",
				updatedAt: 0,
			});
		}
	}

	notes.sort((first, second) => second.updatedAt - first.updatedAt);
	return [...folders, ...notes];
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

		const dirEntries = await fs.readdir(absolutePath, { withFileTypes: true });
		const deletedNotes = [];

		for (const entry of dirEntries) {
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

module.exports = {
	configure,
	workspaceRoot,
	trashRoot,
	trashMetaPath,
	statePath,
	indexPath,
	revisionsRoot,
	syncRoot,
	syncNotesRoot,
	noteFileExtension,
	noteManifestFilename,
	noteAssetsDirectoryName,
	normalizeRelativePath,
	resolveWorkspacePath,
	toPosixRelativePath,
	currentNotePath,
	isNoteManifestPath,
	isNoteFilePath,
	isLegacyMarkdownPath,
	isMigratableNotePath,
	noteContentPath,
	resolveNoteContentPath,
	noteAssetsPath,
	isDescendantPath,
	isUuidFilename,
	isPlainObject,
	toNoteTitle,
	ensureNoteExtension,
	uniquePath,
	textToNoteContent,
	normalizeNoteContent,
	serializeNoteContent,
	createEmptyNoteContent,
	collectNoteText,
	noteContentText,
	toNotePreviewFromContent,
	readNoteTitle,
	writeFileAtomic,
	ensureWorkspace,
	isNoteDirectory,
	ensureNoteDirectory,
	readNoteContent,
	revisionKey,
	writeRevisionSnapshot,
	scanDirectory,
	readTrashMeta,
	writeTrashMeta,
	scanTrashDirectory,
	purgeOldTrashItems,
	collectDeletedNotes,
	appendTombstones,
};
