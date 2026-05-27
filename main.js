const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, shell } = require("electron");

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const authCallbackPort = 51732;
let mainWindow; // hoist ke luar
let authCallbackServer;
let workspaceWatchTimer;
const workspaceWatchers = new Map();
const notePreviewCache = new Map();

const workspaceRoot = () => path.join(app.getPath("documents"), "Paperite");
const statePath = () => path.join(workspaceRoot(), ".paperite", "state.json");

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

const toNoteTitle = (filename) => filename.replace(/\.md$/i, "");

const toNotePreview = async (notePath, stats) => {
	const cacheKey = `${stats.mtimeMs}:${stats.size}`;
	const cached = notePreviewCache.get(notePath);

	if (cached?.key === cacheKey) {
		return cached.preview;
	}

	try {
		const markdown = await fs.readFile(resolveWorkspacePath(notePath), "utf8");
		const preview =
			markdown
				.replace(/^#{1,6}\s+/gm, "")
				.replace(/[`*_~>#-]/g, "")
				.split(/\r?\n/)
				.map((line) => line.trim())
				.find(Boolean) ?? "";

		notePreviewCache.set(notePath, { key: cacheKey, preview });
		return preview;
	} catch {
		return "";
	}
};

const scanDirectory = async (relativePath = "") => {
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
					children: await scanDirectory(childPath),
				};
			}),
	);

	const notes = await Promise.all(
		visibleEntries
			.filter(
				(entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"),
			)
			.sort((first, second) => first.name.localeCompare(second.name))
			.map(async (entry) => {
				const notePath = path.posix.join(
					relativePath.replaceAll(path.sep, "/"),
					entry.name,
				);

				const stats = await fs.stat(resolveWorkspacePath(notePath));

				return {
					type: "note",
					title: toNoteTitle(entry.name),
					path: notePath,
					preview: await toNotePreview(notePath, stats),
					updatedAt: stats.mtimeMs,
				};
			}),
	);
	notes.sort((first, second) => second.updatedAt - first.updatedAt);

	return [...folders, ...notes];
};

const listWorkspace = async () => {
	await ensureWorkspace();

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
				children: await scanDirectory(entry.name),
			})),
	);

	return {
		rootPath: workspaceRoot(),
		spaces,
	};
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

const ensureMarkdownExtension = (name) => {
	const trimmed = name.trim() || "Untitled";
	return trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`;
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
		minWidth: 760,
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

const sendAuthCallback = (url) => {
	mainWindow?.webContents.send("auth-callback", url);
	mainWindow?.focus();
};

const startAuthCallbackServer = () => {
	if (authCallbackServer) return;

	authCallbackServer = http.createServer((request, response) => {
		if (!request.url?.startsWith("/auth/callback")) {
			response.writeHead(404);
			response.end("Not found");
			return;
		}

		const callbackUrl = `http://127.0.0.1:${authCallbackPort}${request.url}`;
		sendAuthCallback(callbackUrl);

		response.writeHead(200, { "content-type": "text/html" });
		response.end(
			"<title>Paperite</title><p>You're signed in. You can close this tab now.</p>",
		);
	});

	authCallbackServer.listen(authCallbackPort, "127.0.0.1");
};

ipcMain.handle("open-external", async (_event, url) => {
	await shell.openExternal(url);
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

ipcMain.handle("notes:read-note", async (_event, notePath) => {
	await ensureWorkspace();
	return fs.readFile(resolveWorkspacePath(notePath), "utf8");
});

ipcMain.handle("notes:write-note", async (_event, notePath, markdown) => {
	await ensureWorkspace();
	await writeFileAtomic(resolveWorkspacePath(notePath), markdown);
	notePreviewCache.delete(notePath);
	return { ok: true };
});

ipcMain.handle("notes:create-note", async (_event, parentPath, title) => {
	await ensureWorkspace();
	const notePath = await uniquePath(parentPath, ensureMarkdownExtension(title));
	await fs.writeFile(resolveWorkspacePath(notePath), "", "utf8");
	return { path: notePath, title: toNoteTitle(path.basename(notePath)) };
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
	const extension = current.toLowerCase().endsWith(".md") ? ".md" : "";
	const nextBase = extension
		? ensureMarkdownExtension(nextName)
		: nextName.trim();
	const nextPath = path.posix.join(
		path.posix.dirname(current),
		nextBase || "Untitled",
	);
	await fs.rename(
		resolveWorkspacePath(current),
		resolveWorkspacePath(nextPath),
	);
	if (notePreviewCache.has(current)) {
		notePreviewCache.set(nextPath, notePreviewCache.get(current));
		notePreviewCache.delete(current);
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
	for (const cachePath of [...notePreviewCache.keys()]) {
		if (!isDescendantPath(current, cachePath)) continue;

		const cached = notePreviewCache.get(cachePath);
		const movedCachePath =
			cachePath === current
				? nextPath
				: `${nextPath}/${cachePath.slice(current.length + 1)}`;
		notePreviewCache.delete(cachePath);
		notePreviewCache.set(movedCachePath, cached);
	}
	return { path: nextPath };
});

ipcMain.handle("notes:delete-item", async (_event, itemPath) => {
	await ensureWorkspace();
	await fs.rm(resolveWorkspacePath(itemPath), { recursive: true, force: true });
	const normalized = normalizeRelativePath(itemPath).replaceAll(path.sep, "/");
	for (const cachePath of [...notePreviewCache.keys()]) {
		if (isDescendantPath(normalized, cachePath)) {
			notePreviewCache.delete(cachePath);
		}
	}
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

app.whenReady().then(() => {
	startAuthCallbackServer();
	refreshWorkspaceWatchers().catch(() => undefined);
	createWindow();
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
		const url = argv.find((arg) => arg.startsWith("paperite://"));
		if (url) sendAuthCallback(url);
	});
}

// mac
app.on("open-url", (_event, url) => {
	sendAuthCallback(url);
});

app.on("window-all-closed", () => {
	for (const watcher of workspaceWatchers.values()) watcher.close();
	workspaceWatchers.clear();
	if (process.platform !== "darwin") app.quit();
});
