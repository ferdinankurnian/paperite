const fsSync = require("node:fs");
const path = require("node:path");
const {
	workspaceRoot,
	ensureWorkspace,
	toPosixRelativePath,
	isNoteDirectory,
} = require("./workspace");

const scanWorkspaceDirectories = async (relativePath = "") => {
	const absolutePath = path.join(workspaceRoot(), relativePath);
	const entries = await require("node:fs/promises").readdir(absolutePath, {
		withFileTypes: true,
	});
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

const startWatchers = (wss) => {
	const watchers = new Map();
	let debounceTimer;

	const notifyChanged = () => {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			refreshWatchers().catch(() => undefined);
			for (const client of wss.clients) {
				if (client.readyState === 1) {
					client.send(JSON.stringify({ event: "workspace:changed" }));
				}
			}
		}, 200);
	};

	const refreshWatchers = async () => {
		await ensureWorkspace();
		const directories = await scanWorkspaceDirectories();
		const nextDirectories = new Set(directories);

		for (const [directory, watcher] of watchers) {
			if (nextDirectories.has(directory)) continue;
			watcher.close();
			watchers.delete(directory);
		}

		for (const directory of directories) {
			if (watchers.has(directory)) continue;

			const absolutePath = path.join(workspaceRoot(), directory);
			const watcher = fsSync.watch(absolutePath, (_eventType, filename) => {
				if (filename?.toString().startsWith(".")) return;
				notifyChanged();
			});
			watcher.on("error", () => {
				watchers.delete(directory);
			});
			watchers.set(directory, watcher);
		}
	};

	refreshWatchers().catch(() => undefined);

	return () => {
		if (debounceTimer) clearTimeout(debounceTimer);
		for (const watcher of watchers.values()) watcher.close();
		watchers.clear();
	};
};

module.exports = { startWatchers };
