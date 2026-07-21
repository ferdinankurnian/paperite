const express = require("express");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
	workspaceRoot,
	ensureWorkspace,
	scanDirectory,
	uniquePath,
	resolveWorkspacePath,
	isNoteDirectory,
	currentNotePath,
	toPosixRelativePath,
	isDescendantPath,
	writeRevisionSnapshot,
	noteFileExtension,
	isMigratableNotePath,
	ensureNoteExtension,
	normalizeNoteContent,
	readNoteContent,
	writeFileAtomic,
	resolveNoteContentPath,
	serializeNoteContent,
} = require("../lib/workspace");
const {
	getIndexedNote,
	searchNotes,
	moveIndexedPath,
	pruneIndex,
} = require("../lib/sqlite");
const { writeLocalYNoteSnapshot } = require("../lib/yjs-persist");

const router = express.Router();

const listWorkspace = async () => {
	const start = performance.now();
	await ensureWorkspace();
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

	for (const notePath of knownNotePaths) {
		try {
			const stats = await fs.stat(resolveNoteContentPath(notePath));
			await getIndexedNote(notePath, stats);
		} catch {
			// skip unindexable notes
		}
	}

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

router.get("/workspace", async (_req, res) => {
	try {
		const workspace = await listWorkspace();
		res.json(workspace);
	} catch (error) {
		console.error("[paperite] get-workspace error:", error);
		res.status(500).json({ error: error.message });
	}
});

router.get("/search", async (req, res) => {
	try {
		const start = performance.now();
		await ensureWorkspace();
		const query = req.query.q;
		const results = await searchNotes(query);
		const duration = performance.now() - start;
		console.info(
			`[paperite perf] search ${duration.toFixed(1)}ms ${results.length} results`,
		);
		res.json(results);
	} catch (error) {
		console.error("[paperite] search error:", error);
		res.status(500).json({ error: error.message });
	}
});

router.post("/folders", async (req, res) => {
	try {
		await ensureWorkspace();
		const { parentPath, title } = req.body || {};
		const folderName = title?.trim() || "Untitled";
		const folderPath = await uniquePath(parentPath || "", folderName);
		await fs.mkdir(resolveWorkspacePath(folderPath), { recursive: true });
		res
			.status(201)
			.json({ path: folderPath, title: path.basename(folderPath) });
	} catch (error) {
		console.error("[paperite] create-folder error:", error);
		res.status(500).json({ error: error.message });
	}
});

router.post("/spaces", async (req, res) => {
	try {
		await ensureWorkspace();
		const { title } = req.body || {};
		const spaceName = title?.trim() || "Untitled";
		if (spaceName === "Trash") {
			res.status(400).json({ error: "'Trash' is a reserved name" });
			return;
		}
		const spacePath = await uniquePath("", spaceName);
		await fs.mkdir(resolveWorkspacePath(spacePath), { recursive: true });
		res.status(201).json({ path: spacePath, title: path.basename(spacePath) });
	} catch (error) {
		console.error("[paperite] create-space error:", error);
		res.status(500).json({ error: error.message });
	}
});

router.patch("/rename", async (req, res) => {
	try {
		await ensureWorkspace();
		const { path: itemPath, name: nextName } = req.body || {};
		const current = currentNotePath(itemPath);

		if (await isNoteDirectory(current)) {
			const nextTitle = nextName?.trim() || "Untitled";
			const normalizedContent = normalizeNoteContent(
				await readNoteContent(current, true),
			);
			if (!normalizedContent.id) normalizedContent.id = crypto.randomUUID();
			normalizedContent.title = nextTitle;
			await writeRevisionSnapshot(current, normalizedContent);
			await writeFileAtomic(
				resolveNoteContentPath(current),
				serializeNoteContent(normalizedContent),
			);
			await writeLocalYNoteSnapshot(current, normalizedContent);
			const stats = await fs.stat(resolveNoteContentPath(current));
			await getIndexedNote(current, stats);
			res.json({ path: current });
			return;
		}

		const extension = isMigratableNotePath(current) ? noteFileExtension : "";
		const nextBase = extension
			? ensureNoteExtension(nextName)
			: nextName?.trim();
		const nextPath = path.posix.join(
			path.posix.dirname(current),
			nextBase || "Untitled",
		);
		await fs.rename(
			resolveWorkspacePath(current),
			resolveWorkspacePath(nextPath),
		);
		await moveIndexedPath(current, nextPath);
		res.json({ path: nextPath });
	} catch (error) {
		console.error("[paperite] rename-item error:", error);
		res.status(500).json({ error: error.message });
	}
});

router.post("/move", async (req, res) => {
	try {
		await ensureWorkspace();
		const { path: itemPath, parentPath: nextParentPath } = req.body || {};
		const current = currentNotePath(itemPath);
		const nextParent = toPosixRelativePath(nextParentPath || "");
		const basename = path.posix.basename(current);

		if (isDescendantPath(current, nextParent)) {
			res.status(400).json({ error: "cannot move an item into itself" });
			return;
		}

		const nextPath = await uniquePath(nextParent, basename);
		await fs.rename(
			resolveWorkspacePath(current),
			resolveWorkspacePath(nextPath),
		);
		await moveIndexedPath(current, nextPath);
		res.json({ path: nextPath });
	} catch (error) {
		console.error("[paperite] move-item error:", error);
		res.status(500).json({ error: error.message });
	}
});

module.exports = router;
