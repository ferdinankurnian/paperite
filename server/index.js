const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");

const loadLocalEnv = () => {
	const loadEnvFile = (fileName, override = false) => {
		const envPath = path.join(__dirname, "..", fileName);
		try {
			const env = fsSync.readFileSync(envPath, "utf8");
			for (const line of env.split(/\r?\n/)) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith("#")) continue;
				const separatorIndex = trimmed.indexOf("=");
				if (separatorIndex === -1) continue;
				const key = trimmed.slice(0, separatorIndex).trim();
				const rawValue = trimmed.slice(separatorIndex + 1).trim();
				const value = rawValue.replace(/^(['"])(.*)\1$/, "$2");
				if (key && (override || process.env[key] === undefined)) {
					process.env[key] = value;
				}
			}
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}
	};

	loadEnvFile(".env");
	loadEnvFile(".env.local", true);
};

const SERVE_USAGE = `paperite serve — headless Paperite server (no Electron)

Usage:
  paperite serve [--port <n>] [--host <addr>] [--workspace <dir>] [--open]

Options:
  --port <n>       Port to listen on (default 3000)
  --host <addr>    Bind address (default 127.0.0.1)
  --workspace <dir> Notes root (default ~/Documents/Paperite)
  --open           Open the UI in the default browser (default: print URL only)
  --no-browser     Don't open a browser (default)
  --help, -h       Show this help`;

const parseArgs = (argv) => {
	const args = {
		port: 3000,
		hostname: "127.0.0.1",
		workspace: undefined,
		open: false,
		help: false,
	};
	for (let i = 2; i < argv.length; i++) {
		if (argv[i] === "--port" && argv[i + 1]) {
			args.port = Number(argv[++i]) || 3000;
		} else if (
			(argv[i] === "--hostname" || argv[i] === "--host") &&
			argv[i + 1]
		) {
			args.hostname = argv[++i];
		} else if (argv[i] === "--workspace" && argv[i + 1]) {
			args.workspace = argv[++i];
		} else if (argv[i] === "--open") {
			args.open = true;
		} else if (argv[i] === "--no-browser") {
			args.open = false;
		} else if (argv[i] === "--help" || argv[i] === "-h") {
			args.help = true;
		}
	}
	return args;
};

const isLoopbackHost = (host) =>
	!host ||
	host === "localhost" ||
	host === "127.0.0.1" ||
	host === "::1" ||
	host === "[::1]" ||
	host.startsWith("127.");

// Global single-serve guard: only one `paperite serve` at a time, any port.
// Stale locks (crash without cleanup) are detected via pid liveness.
const serveLockPath = () => {
	const os = require("node:os");
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
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const acquireServeLock = (info) => {
	const existing = readServeLock();
	if (existing && isPidAlive(existing.pid)) {
		const where = existing.port
			? `http://localhost:${existing.port}`
			: "unknown address";
		console.error(
			`[paperite] already serving at ${where} (pid ${existing.pid}, workspace ${existing.workspace ?? "?"}) — stop it first`,
		);
		process.exit(1);
	}
	fsSync.writeFileSync(
		serveLockPath(),
		JSON.stringify({ ...info, pid: process.pid }),
	);
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

const openBrowser = (url) => {
	const { spawn } = require("node:child_process");
	const opener =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "cmd"
				: "xdg-open";
	const openerArgs =
		process.platform === "win32" ? ["/c", "start", "", url] : [url];

	try {
		spawn(opener, openerArgs, {
			detached: true,
			stdio: "ignore",
			shell: process.platform === "win32",
		}).unref();
	} catch {
		console.log(`[paperite] could not open a browser — visit ${url}`);
	}
};

const main = async () => {
	loadLocalEnv();
	const args = parseArgs(process.argv);

	if (args.help) {
		console.log(SERVE_USAGE);
		return;
	}

	const express = require("express");
	const cors = require("cors");
	const { WebSocketServer } = require("ws");

	const workspace = require("./lib/workspace");
	const sqlite = require("./lib/sqlite");

	if (args.workspace) {
		workspace.configure(path.resolve(args.workspace));
	}

	// Single serve instance — any port. Refuses with the existing address
	// instead of splitting identity/data across two servers.
	acquireServeLock({ port: args.port, workspace: workspace.workspaceRoot() });

	await workspace.ensureWorkspace();
	await workspace.purgeOldTrashItems();
	await sqlite.openDb();

	const app = express();
	app.use(cors());
	app.use(express.json({ limit: "10mb" }));

	app.use("/api", require("./routes/notes"));
	app.use("/api", require("./routes/workspace"));
	app.use("/api", require("./routes/trash"));
	app.use("/api", require("./routes/state"));

	// Health check
	app.get("/api/health", (_req, res) => {
		res.json({ ok: true, workspace: workspace.workspaceRoot() });
	});

	// Serve static files in production. dist-web/ (PAPERITE_WEB=1 build) is
	// preferred — plain dist/ is the Electron build and sticks on
	// "Connecting..." (its engine bridge is missing).
	const staticCandidates = [
		path.join(__dirname, "..", "dist-web"),
		path.join(__dirname, "..", "dist"),
	];
	let staticPath;
	for (const candidate of staticCandidates) {
		try {
			await fs.access(path.join(candidate, "index.html"));
			staticPath = candidate;
			break;
		} catch {
			// try next
		}
	}

	if (staticPath) {
		console.log(`[paperite] serving UI from ${staticPath}`);
		app.use(express.static(staticPath));
		// Express 5: "*" is no longer a valid path — use the splat syntax.
		app.get("/{*any}", (_req, res) => {
			res.sendFile(path.join(staticPath, "index.html"));
		});
	} else {
		console.log("[paperite] no UI build found — API-only mode (run build:web)");
	}

	const server = http.createServer(app);
	const wss = new WebSocketServer({ server });

	wss.on("connection", (ws) => {
		ws.send(JSON.stringify({ event: "connected" }));
	});

	const stopWatchers = require("./lib/watchers").startWatchers(wss);

	server.listen(args.port, args.hostname, () => {
		const displayHost = isLoopbackHost(args.hostname)
			? "localhost"
			: args.hostname;
		const url = `http://${displayHost}:${args.port}`;
		console.log(`[paperite] serving at ${url}`);
		console.log(`[paperite] workspace: ${workspace.workspaceRoot()}`);

		if (!isLoopbackHost(args.hostname)) {
			console.warn(
				"[paperite] WARNING: listening on a non-loopback address with no auth — anyone on the network can read/write notes",
			);
		}

		if (args.open) openBrowser(url);
	});

	const shutdown = () => {
		console.log("\n[paperite] shutting down...");
		releaseServeLock();
		stopWatchers();
		sqlite.close();
		wss.close();
		server.close(() => process.exit(0));
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
};

main().catch((error) => {
	console.error("[paperite] fatal:", error);
	process.exit(1);
});
