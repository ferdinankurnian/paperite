const express = require("express");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
	ensureWorkspace,
	readNoteContent,
	normalizeNoteContent,
	serializeNoteContent,
	ensureNoteDirectory,
	writeRevisionSnapshot,
	writeFileAtomic,
	resolveNoteContentPath,
	createEmptyNoteContent,
	currentNotePath,
	toPosixRelativePath,
	isUuidFilename,
	isNoteDirectory,
	collectDeletedNotes,
	appendTombstones,
	readTrashMeta,
	writeTrashMeta,
	trashRoot,
	resolveWorkspacePath,
	isDescendantPath,
	uniquePath,
	noteContentPath,
} = require("../lib/workspace");
const {
	readLocalYNoteState,
	appendLocalYNoteUpdate,
	ensureLocalYNoteSnapshot,
	writeLocalYNoteSnapshot,
} = require("../lib/yjs-persist");
const { getIndexedNote, deleteIndexedPath } = require("../lib/sqlite");

const router = express.Router();

router.get("/notes/:path", async (req, res) => {
	try {
		await ensureWorkspace();
		const normalizedPath = currentNotePath(req.params.path);
		const content = await readNoteContent(normalizedPath, true);
		await ensureLocalYNoteSnapshot(normalizedPath, content);
		res.json(content);
	} catch (error) {
		if (error?.code === "ENOENT") {
			res.status(404).json({ error: "note not found" });
			return;
		}
		console.error("[paperite] read-note error:", error);
		res.status(500).json({ error: error.message });
	}
});

router.put("/notes/:path", async (req, res) => {
	try {
		await ensureWorkspace();
		const normalizedPath = currentNotePath(req.params.path);
		const normalizedContent = normalizeNoteContent(req.body);
		let existingContent;

		if (!normalizedContent.id || !normalizedContent.title) {
			try {
				existingContent = await readNoteContent(normalizedPath, true);
				if (!normalizedContent.id && existingContent.id) {
					normalizedContent.id = existingContent.id;
				}
				if (!normalizedContent.title && existingContent.title) {
					normalizedContent.title = existingContent.title;
				}
			} catch {
				// new note or missing file
			}
		}

		if (!normalizedContent.id) {
			normalizedContent.id = crypto.randomUUID();
		}

		if (isUuidFilename(normalizedPath) && !normalizedContent.title) {
			try {
				const db = await require("../lib/sqlite").openDb();
				const row = db
					.prepare("SELECT title FROM notes WHERE path = ?")
					.get(normalizedPath);
				if (row?.title) normalizedContent.title = row.title;
			} catch {
				// index may not exist yet
			}
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
		res.json({ ok: true });
	} catch (error) {
		console.error("[paperite] write-note error:", error);
		res.status(500).json({ error: error.message });
	}
});

router.put("/notes/:path/derived", async (req, res) => {
	try {
		await ensureWorkspace();
		const normalizedPath = currentNotePath(req.params.path);
		const normalizedContent = normalizeNoteContent(req.body);

		if (!normalizedContent.id || !normalizedContent.title) {
			try {
				const existingContent = await readNoteContent(normalizedPath, true);
				if (!normalizedContent.id && existingContent.id) {
					normalizedContent.id = existingContent.id;
				}
				if (!normalizedContent.title && existingContent.title) {
					normalizedContent.title = existingContent.title;
				}
			} catch {
				// manifest missing
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
		res.json({ ok: true });
	} catch (error) {
		console.error("[paperite] write-derived error:", error);
		res.status(500).json({ error: error.message });
	}
});

router.get("/notes/:path/yjs", async (req, res) => {
	try {
		await ensureWorkspace();
		const result = await readLocalYNoteState(req.params.path);
		res.setHeader("Content-Type", "application/octet-stream");
		res.send(Buffer.from(result.snapshot));
	} catch (error) {
		console.error("[paperite] read-y-note error:", error);
		res.status(500).json({ error: error.message });
	}
});

router.post(
	"/notes/:path/yjs/update",
	express.raw({ type: "application/octet-stream", limit: "10mb" }),
	async (req, res) => {
		try {
			await ensureWorkspace();
			const result = await appendLocalYNoteUpdate(req.params.path, req.body);
			res.json(result);
		} catch (error) {
			console.error("[paperite] write-y-update error:", error);
			res.status(500).json({ error: error.message });
		}
	},
);

router.post("/notes", async (req, res) => {
	try {
		await ensureWorkspace();
		const { parentPath, title } = req.body || {};
		const noteTitle = title?.trim() || "Untitled";
		const notePath = path.posix.join(
			toPosixRelativePath(parentPath || ""),
			crypto.randomUUID(),
		);
		await ensureNoteDirectory(notePath);
		const content = createEmptyNoteContent(noteTitle);
		await writeFileAtomic(
			resolveNoteContentPath(notePath),
			serializeNoteContent(content),
		);
		await writeLocalYNoteSnapshot(notePath, content);
		res.status(201).json({ path: notePath, title: noteTitle });
	} catch (error) {
		console.error("[paperite] create-note error:", error);
		res.status(500).json({ error: error.message });
	}
});

router.delete("/notes/:path", async (req, res) => {
	try {
		await ensureWorkspace();
		const current = currentNotePath(req.params.path);

		if (current === "Trash" || current.startsWith("Trash/")) {
			res.json({ ok: true });
			return;
		}

		const deletedNotes = await collectDeletedNotes(current);
		await appendTombstones(deletedNotes);

		const trashMeta = await readTrashMeta();
		for (const notePath of deletedNotes) {
			const sourceDir = resolveWorkspacePath(notePath);
			const noteName = path.basename(notePath);
			let destName = noteName;
			let suffix = 1;

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

		if (!(await isNoteDirectory(current))) {
			await fs
				.rm(resolveWorkspacePath(current), { recursive: true, force: true })
				.catch(() => {});
		}

		await deleteIndexedPath(current);
		res.json({ ok: true });
	} catch (error) {
		console.error("[paperite] delete-note error:", error);
		res.status(500).json({ error: error.message });
	}
});

module.exports = router;
