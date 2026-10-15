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
	ensureLocalYNoteSnapshot,
	withNoteWriteLock,
} = require("../lib/yjs-persist");
const { getIndexedNote, deleteIndexedPath } = require("../lib/sqlite");

const router = express.Router();

// Never last-write-wins and never split state: a locked sqlite index is a
// hard, retryable 409 (the file write already landed, so the client must
// retry instead of believing "ok"), and a corrupt/incompatible Y update is
// an explicit 409 conflict — both are never silently swallowed.
const sendNoteError = (res, error, fallback = "note write failed") => {
	if (error?.code === "PAPERITE_LOCKED") {
		res
			.status(409)
			.json({ error: error.message, locked: true, retryable: true });
		return;
	}
	if (error?.code === "Y_CONFLICT") {
		res.status(409).json({ error: error.message, conflict: true });
		return;
	}
	console.error("[paperite] write-note error:", error);
	res.status(500).json({ error: error?.message ?? fallback });
};

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
		// Single per-note critical section (file + Y merge + index) using
		// the lock-aware variants — never nested locks, never LWW: the Y
		// merge converges concurrent updates instead of clobbering them,
		// and a locked index is a hard 409, not a silent split.
		const { writeLocalYNoteSnapshotLocked } = require("../lib/yjs-persist");
		const result = await withNoteWriteLock(
			normalizedPath,
			async () => {
				const normalizedContent = normalizeNoteContent(req.body);
				let existingContent;

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
				// CRDT merge (not overwrite): concurrent Y updates converge
				// instead of being clobbered by this PUT. Locked variant —
				// the outer withNoteWriteLock (path + id) is the single
				// critical section (nesting the same key would deadlock).
				const snapshot = await writeLocalYNoteSnapshotLocked(
					normalizedPath,
					normalizedContent,
				);
				const stats = await fs.stat(resolveNoteContentPath(normalizedPath));
				await getIndexedNote(normalizedPath, stats);
				return snapshot;
			},
		);
		res.json({
			ok: true,
			merged: result?.merged ?? true,
			noteId: result?.noteId,
		});
	} catch (error) {
		sendNoteError(res, error);
	}
});

router.put("/notes/:path/derived", async (req, res) => {
	try {
		await ensureWorkspace();
		const normalizedPath = currentNotePath(req.params.path);
		// Derived writes (Y-doc owners) must not clobber the Y snapshot:
		// same per-note lock, file + index only, snapshot untouched.
		await withNoteWriteLock(normalizedPath, async () => {
			const normalizedContent = normalizeNoteContent(req.body);

			if (
				!normalizedContent.id ||
				!normalizedContent.title ||
				normalizedContent.pageFormat === undefined
			) {
				try {
					const existingContent = await readNoteContent(normalizedPath, true);
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
		});
		res.json({ ok: true });
	} catch (error) {
		sendNoteError(res, error);
	}
});

router.get("/notes/:path/yjs", async (req, res) => {
	try {
		await ensureWorkspace();
		const result = await readLocalYNoteState(req.params.path);
		res.setHeader("Content-Type", "application/octet-stream");
		// Frame: noteId (utf8, no NUL bytes) + 0x00 + snapshot.
		// Matches WebNotesEngine.readYNote's parsing.
		res.send(
			Buffer.concat([
				Buffer.from(result.noteId, "utf8"),
				Buffer.from([0]),
				Buffer.from(result.snapshot),
			]),
		);
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
			if (!req.body || req.body.length === 0) {
				res.status(409).json({ error: "empty yjs update", conflict: true });
				return;
			}
			const { appendLocalYNoteUpdateLocked } = require("../lib/yjs-persist");
			const normalizedPath = currentNotePath(req.params.path);
			// Single critical section: snapshot merge + note.json projection
			// + index. Invalid bytes are an explicit 409 conflict; a locked
			// index is a hard 409 — never silent loss, never split state.
			const result = await withNoteWriteLock(
				normalizedPath,
				async () => {
					const appended = await appendLocalYNoteUpdateLocked(
						normalizedPath,
						req.body,
					);
					const stats = await fs.stat(resolveNoteContentPath(normalizedPath));
					await getIndexedNote(normalizedPath, stats);
					return appended;
				},
			);
			res.json(result);
		} catch (error) {
			sendNoteError(res, error);
		}
	},
);

// Live-watch primitive: bytes this client has not seen yet, diffed against
// its state vector (`sv` = base64url of Y.encodeStateVector(doc)). Empty
// diff = already converged. A corrupt/unknown vector is an explicit 409
// conflict — the client falls back to a full snapshot read.
router.get("/notes/:path/yjs/diff", async (req, res) => {
	try {
		await ensureWorkspace();
		const { readLocalYNoteDiff } = require("../lib/yjs-persist");
		const raw = typeof req.query.sv === "string" ? req.query.sv : "";
		if (!raw) {
			res.status(409).json({ error: "missing state vector", conflict: true });
			return;
		}
		let stateVector;
		try {
			stateVector = Buffer.from(raw, "base64url");
		} catch {
			res
				.status(409)
				.json({ error: "unreadable state vector", conflict: true });
			return;
		}
		const result = await readLocalYNoteDiff(req.params.path, stateVector);
		res.setHeader("Content-Type", "application/octet-stream");
		res.setHeader("X-Note-Id", result.noteId);
		res.send(Buffer.from(result.diff));
	} catch (error) {
		sendNoteError(res, error);
	}
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
});

router.put("/notes/:path/page-format", async (req, res) => {
	try {
		await ensureWorkspace();
		const normalizedPath = currentNotePath(req.params.path);
		const result = await withNoteWriteLock(
			normalizedPath,
			async () => {
				const content = await readNoteContent(normalizedPath, true);
				content.pageFormat = normalizePageFormat(req.body);
				await ensureNoteDirectory(normalizedPath);
				await writeRevisionSnapshot(normalizedPath, content);
				await writeFileAtomic(
					resolveNoteContentPath(normalizedPath),
					serializeNoteContent(content),
				);
				const stats = await fs.stat(resolveNoteContentPath(normalizedPath));
				await getIndexedNote(normalizedPath, stats);
				return content.pageFormat;
			},
		);
		res.json({ ok: true, pageFormat: result });
	} catch (error) {
		sendNoteError(res, error);
	}
});

router.post("/notes", async (req, res) => {
	try {
		await ensureWorkspace();
		const { parentPath, title } = req.body || {};
		const noteTitle = title?.trim() || "Untitled";
		const notePath = path.posix.join(
			toPosixRelativePath(parentPath || ""),
			crypto.randomUUID(),
		);
		const { writeLocalYNoteSnapshotLocked } = require("../lib/yjs-persist");
		await withNoteWriteLock(notePath, async () => {
			await ensureNoteDirectory(notePath);
			const content = createEmptyNoteContent(noteTitle);
			await writeFileAtomic(
				resolveNoteContentPath(notePath),
				serializeNoteContent(content),
			);
			await writeLocalYNoteSnapshotLocked(notePath, content);
		});
		res.status(201).json({ path: notePath, title: noteTitle });
	} catch (error) {
		sendNoteError(res, error);
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
