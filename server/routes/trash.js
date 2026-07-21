const express = require("express");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
	ensureWorkspace,
	scanTrashDirectory,
	readTrashMeta,
	writeTrashMeta,
	trashRoot,
	resolveWorkspacePath,
	workspaceRoot,
	readNoteContent,
	normalizeNoteContent,
	serializeNoteContent,
	resolveNoteContentPath,
	writeFileAtomic,
} = require("../lib/workspace");
const { getIndexedNote } = require("../lib/sqlite");

const router = express.Router();

router.get("/trash", async (_req, res) => {
	try {
		await ensureWorkspace();
		const items = await scanTrashDirectory();
		res.json(items);
	} catch (error) {
		console.error("[paperite] get-trash error:", error);
		res.status(500).json({ error: error.message });
	}
});

router.post("/trash/restore", async (req, res) => {
	try {
		await ensureWorkspace();
		const { name } = req.body || {};
		const trashMeta = await readTrashMeta();
		const metaEntry = trashMeta[name];

		if (!metaEntry) {
			res.status(404).json({ error: "note not found in trash" });
			return;
		}

		const sourcePath = path.join(trashRoot(), name);
		const originalPath = metaEntry.originalPath;
		const originalAbsPath = resolveWorkspacePath(originalPath);

		await fs.mkdir(path.dirname(originalAbsPath), { recursive: true });

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

		delete trashMeta[name];
		await writeTrashMeta(trashMeta);

		const restoredRelativePath = path
			.relative(workspaceRoot(), destPath)
			.replaceAll(path.sep, "/");
		try {
			const stats = await fs.stat(resolveNoteContentPath(restoredRelativePath));
			await getIndexedNote(restoredRelativePath, stats);
		} catch {
			// Note might not be indexable
		}

		res.json({ ok: true, path: restoredRelativePath });
	} catch (error) {
		console.error("[paperite] restore-item error:", error);
		res.status(500).json({ error: error.message });
	}
});

router.delete("/trash/:name", async (req, res) => {
	try {
		await ensureWorkspace();
		const trashMeta = await readTrashMeta();
		const sourcePath = path.join(trashRoot(), req.params.name);
		await fs.rm(sourcePath, { recursive: true, force: true });

		delete trashMeta[req.params.name];
		await writeTrashMeta(trashMeta);

		res.json({ ok: true });
	} catch (error) {
		console.error("[paperite] permanent-delete error:", error);
		res.status(500).json({ error: error.message });
	}
});

router.delete("/trash", async (_req, res) => {
	try {
		await ensureWorkspace();
		const entries = await fs.readdir(trashRoot(), { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			await fs
				.rm(path.join(trashRoot(), entry.name), {
					recursive: true,
					force: true,
				})
				.catch(() => {});
		}

		await writeTrashMeta({});
		res.json({ ok: true });
	} catch (error) {
		console.error("[paperite] empty-trash error:", error);
		res.status(500).json({ error: error.message });
	}
});

module.exports = router;
