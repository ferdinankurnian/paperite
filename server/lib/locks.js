const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Shared lock helpers for `paperite serve` and Electron.
// Both shells require this file (CJS, no Electron dependency) so the
// protocol can't drift — the t3 lesson from plan 022 Phase 2.

const serveLockPath = () => {
	let who = "user";
	try {
		who = os.userInfo().username.replace(/[^a-zA-Z0-9_-]/g, "_");
	} catch {
		// keep default
	}
	return path.join(os.tmpdir(), `paperite-serve-${who}.lock`);
};

const readServeLock = () => {
	try {
		return JSON.parse(fsSync.readFileSync(serveLockPath(), "utf8"));
	} catch {
		return null;
	}
};

const isPidAlive = (pid) => {
	if (!pid || typeof pid !== "number") return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const serveLockAddress = (lock) => {
	if (!lock) return "unknown address";
	if (lock.url) return lock.url;
	if (lock.port) return `http://localhost:${lock.port}`;
	return "unknown address";
};

// Global single-serve guard: only one `paperite serve` at a time, any port.
// Stale locks (crash without cleanup) are detected via pid liveness.
// Exits the process on conflict — callers must not continue.
const acquireServeLock = (info) => {
	const lock = serveLockPath();
	const payload = JSON.stringify({ ...info, pid: process.pid, startedAt: Date.now() });
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const fd = fsSync.openSync(lock, "wx");
			try {
				fsSync.writeFileSync(fd, payload);
			} finally {
				fsSync.closeSync(fd);
			}
			return;
		} catch (error) {
			if (error?.code !== "EEXIST") throw error;
			const existing = readServeLock();
			if (existing && isPidAlive(existing.pid)) {
				const where = serveLockAddress(existing);
				console.error(
					`[paperite] already serving at ${where} (pid ${existing.pid}, workspace ${existing.workspace ?? "?"}) — stop it first`,
				);
				process.exit(1);
			}
			try {
				fsSync.unlinkSync(lock);
			} catch {
				// Another contender may be replacing the stale lock; retry the
				// exclusive create and let the winner be authoritative.
			}
		}
	}
	throw new Error("could not acquire serve lock");
};

const releaseServeLock = () => {
	try {
		const existing = readServeLock();
		if (existing && existing.pid === process.pid) {
			fsSync.unlinkSync(serveLockPath());
		}
	} catch {
		// best effort
	}
};

// Workspace-level guard: Electron and serve share ~/Documents/Paperite
// (or --workspace) including index.sqlite. WAL tolerates light overlap,
// but heavy concurrent writes busy-error and identity splits silently.
// Refuse same-workspace coexistence with a loud message instead.
const workspaceLockPath = (workspaceDir) =>
	path.join(workspaceDir, ".paperite", "active.lock");

const readWorkspaceLock = (workspaceDir) => {
	try {
		return JSON.parse(
			fsSync.readFileSync(workspaceLockPath(workspaceDir), "utf8"),
		);
	} catch {
		return null;
	}
};

const acquireWorkspaceLock = (workspaceDir, info) => {
	const lock = workspaceLockPath(workspaceDir);
	const reportConflict = (existing) => {
		const holder =
			existing.mode === "serve"
				? `paperite serve at ${existing.url ?? (existing.port ? `http://localhost:${existing.port}` : "unknown address")}`
				: "Paperite desktop";
		const me =
			info.mode === "serve" ? "paperite serve" : "Paperite desktop app";
		console.error(
			`[paperite] workspace is already open by ${holder} (pid ${existing.pid}).`,
		);
		console.error(
			`[paperite] ${me} refuses to open the same workspace twice — sharing index.sqlite splits state.`,
		);
		console.error(
			`[paperite] stop the other process first, or use --workspace <dir> for a separate workspace.`,
		);
		process.exit(1);
	};
	try {
		fsSync.mkdirSync(path.join(workspaceDir, ".paperite"), {
			recursive: true,
		});
		const payload = JSON.stringify({ ...info, pid: process.pid, startedAt: Date.now() });
		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				const fd = fsSync.openSync(lock, "wx");
				try {
					fsSync.writeFileSync(fd, payload);
				} finally {
					fsSync.closeSync(fd);
				}
				return;
			} catch (error) {
				if (error?.code !== "EEXIST") throw error;
				const existing = readWorkspaceLock(workspaceDir);
				if (existing && isPidAlive(existing.pid)) reportConflict(existing);
				try {
					fsSync.unlinkSync(lock);
				} catch {
					// Retry the exclusive create; a concurrent winner will be
					// reported deterministically on the next iteration.
				}
			}
		}
		throw new Error("could not acquire workspace lock");
	} catch (error) {
		console.error(`[paperite] could not lock workspace: ${error.message}`);
		process.exit(1);
	}
};

const releaseWorkspaceLock = (workspaceDir) => {
	try {
		const existing = readWorkspaceLock(workspaceDir);
		if (existing && existing.pid === process.pid) {
			fsSync.unlinkSync(workspaceLockPath(workspaceDir));
		}
	} catch {
		// best effort
	}
};

module.exports = {
	serveLockPath,
	readServeLock,
	isPidAlive,
	acquireServeLock,
	releaseServeLock,
	workspaceLockPath,
	readWorkspaceLock,
	acquireWorkspaceLock,
	releaseWorkspaceLock,
};
