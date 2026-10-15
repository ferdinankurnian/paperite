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
  --port <n>       Port to listen on (default 3000). On EADDRINUSE the boot
                   fails hard — no silent port-hopping (Clerk allowlist
                   needs a stable port).
  --host <addr>    Bind address (default 127.0.0.1). Non-loopback prints a
                   WARNING: serve has no auth yet.
  --workspace <dir> Notes root (default ~/Documents/Paperite)
  --open           Open the UI in the default browser (default: print URL only)
  --no-browser     Don't open a browser (default)
  --help, -h       Show this help

Only one serve at a time (any port): a pid-checked lockfile in tmp guards
serve-vs-serve, and a per-workspace lock refuses Electron+serve on the
same workspace instead of silently splitting index.sqlite.`;

const parseArgs = (argv) => {
	const args = {
		port: 3000,
		hostname: "127.0.0.1",
		workspace: undefined,
		open: false,
		help: false,
		dev: false,
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
		} else if (argv[i] === "--dev") {
			args.dev = true;
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

// Shared lock helpers (also required by main.js) — single source of truth.
const {
	acquireServeLock,
	releaseServeLock,
	acquireWorkspaceLock,
	releaseWorkspaceLock,
	readServeLock,
	readWorkspaceLock,
	isPidAlive,
} = require("./lib/locks");

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
		process.exit(0);
	}

	const express = require("express");
	const cors = require("cors");
	const { WebSocketServer } = require("ws");

	const workspace = require("./lib/workspace");
	const sqlite = require("./lib/sqlite");

	if (args.workspace) {
		workspace.configure(path.resolve(args.workspace));
	}
	const workspaceDir = workspace.workspaceRoot();

	// Lock order matters: the workspace check runs BEFORE the serve lock
	// is taken. acquireWorkspaceLock exits the process on conflict, so
	// taking the serve lock first would leave a stale serve lock pointing
	// at a dead pid. Fail fast on both with zero side effects, then take
	// both locks (workspace first, serve second).
	const existingServe = readServeLock();
	if (existingServe && isPidAlive(existingServe.pid)) {
		const where =
			existingServe.url ??
			(existingServe.port
				? `http://localhost:${existingServe.port}`
				: "unknown address");
		console.error(
			`[paperite] already serving at ${where} (pid ${existingServe.pid}, workspace ${existingServe.workspace ?? "?"}) — stop it first`,
		);
		process.exit(1);
	}
	const existingWs = readWorkspaceLock(workspaceDir);
	if (existingWs && isPidAlive(existingWs.pid)) {
		const holder =
			existingWs.mode === "serve"
				? `paperite serve at ${existingWs.url ?? (existingWs.port ? `http://localhost:${existingWs.port}` : "unknown address")}`
				: "Paperite desktop";
		console.error(
			`[paperite] workspace is already open by ${holder} (pid ${existingWs.pid}).`,
		);
		console.error(
			"[paperite] paperite serve refuses to open the same workspace twice — sharing index.sqlite splits state.",
		);
		console.error(
			"[paperite] stop the other process first, or use --workspace <dir> for a separate workspace.",
		);
		process.exit(1);
	}

	// Electron + serve on the same workspace would silently split
	// index.sqlite. Both acquires re-check liveness (race-safe); on
	// conflict they refuse loudly instead of splitting state.
	acquireWorkspaceLock(workspaceDir, { mode: "serve", port: args.port });

	// Single serve instance — any port. Refuses with the existing address
	// instead of splitting identity/data across two servers.
	acquireServeLock({ port: args.port, workspace: workspaceDir });

	await workspace.ensureWorkspace();
	await workspace.purgeOldTrashItems();
	try {
		await sqlite.openDb();
	} catch (error) {
		console.error(
			`[paperite] could not open index.sqlite — is Paperite desktop running on the same workspace? Stop it first or use --workspace <dir>. (${error.message})`,
		);
		releaseWorkspaceLock(workspaceDir);
		releaseServeLock();
		process.exit(1);
	}

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

	// Serve static files in production. Only dist-web/ (PAPERITE_WEB=1
	// build) is served — plain dist/ is the Electron build and sticks on
	// "Connecting..." (its engine bridge is missing), so it is refused
	// with a loud log instead of silently serving a broken UI.
	const distWebDir = path.join(__dirname, "..", "dist-web");
	const distElectronDir = path.join(__dirname, "..", "dist");
	const hasDistWeb = await fs
		.access(path.join(distWebDir, "index.html"))
		.then(() => true)
		.catch(() => false);
	const hasDistElectron = await fs
		.access(path.join(distElectronDir, "index.html"))
		.then(() => true)
		.catch(() => false);

	const readBuildStamp = async (dir) => {
		try {
			return JSON.parse(
				await fs.readFile(path.join(dir, ".paperite-build.json"), "utf8"),
			);
		} catch {
			return null;
		}
	};

	if (args.dev) {
		console.log("[paperite] dev mode — UI served by Vite, API only");
	} else if (hasDistWeb) {
		const stamp = await readBuildStamp(distWebDir);
		if (stamp) {
			console.log(
				`[paperite] serving UI from dist-web/ (mode=${stamp.mode ?? "web"}${stamp.version ? `, v${stamp.version}` : ""})`,
			);
		} else {
			console.log(
				"[paperite] serving UI from dist-web/ (unstamped build — assuming web; rebuild with build:web to stamp)",
			);
		}
		app.use(express.static(distWebDir));
		// Express 5: "*" is no longer a valid path — use the splat syntax.
		app.get("/{*any}", (_req, res) => {
			res.sendFile(path.join(distWebDir, "index.html"));
		});
	} else if (hasDistElectron) {
		console.log(
			"[paperite] found dist/ (Electron build) — refusing to serve it (would stick on Connecting...). Run `bun run build:web` for dist-web/. API-only mode.",
		);
	} else {
		console.log("[paperite] no UI build found — API-only mode (run build:web)");
	}

	const server = http.createServer(app);
	const wss = new WebSocketServer({ server });

	wss.on("connection", (ws) => {
		ws.send(JSON.stringify({ event: "connected" }));
	});

	const stopWatchers = require("./lib/watchers").startWatchers(wss);

	// EADDRINUSE fails hard — no silent port-hopping. A stable port is
	// required for the Clerk dashboard allowlist. Both the http server and
	// the ws server can emit the bind error — handle both, exit once.
	let bootFailed = false;
	const failBoot = (error) => {
		if (bootFailed) return;
		bootFailed = true;
		if (error?.code === "EADDRINUSE") {
			console.error(
				`[paperite] port ${args.port} is already in use — refusing to pick another port (Clerk allowlist needs a stable port). Stop the other process or pass --port <n>.`,
			);
		} else {
			console.error(`[paperite] server error: ${error?.message ?? error}`);
		}
		releaseWorkspaceLock(workspaceDir);
		releaseServeLock();
		process.exit(1);
	};
	server.on("error", failBoot);
	wss.on("error", failBoot);

	server.listen(args.port, args.hostname, () => {
		const displayHost = isLoopbackHost(args.hostname)
			? "localhost"
			: args.hostname;
		const url = `http://${displayHost}:${args.port}`;
		console.log(`[paperite] serving at ${url}`);
		console.log(`[paperite] workspace: ${workspace.workspaceRoot()}`);

		// Refresh the serve lock with the concrete URL so a second boot can
		// point at the running instance.
		try {
			const { readServeLock, serveLockPath } = require("./lib/locks");
			const current = readServeLock();
			if (current && current.pid === process.pid) {
				fsSync.writeFileSync(
					serveLockPath(),
					JSON.stringify({ ...current, url }),
				);
			}
		} catch {
			// best effort
		}
		try {
			const currentWs = require("./lib/locks").readWorkspaceLock(workspaceDir);
			if (currentWs && currentWs.pid === process.pid) {
				fsSync.writeFileSync(
					require("./lib/locks").workspaceLockPath(workspaceDir),
					JSON.stringify({ ...currentWs, url }),
				);
			}
		} catch {
			// best effort
		}

		if (!isLoopbackHost(args.hostname)) {
			console.warn(
				"[paperite] WARNING: listening on a non-loopback address with no auth — anyone on the network can read/write notes",
			);
		}

		if (args.open) openBrowser(url);
	});

	const shutdown = () => {
		console.log("\n[paperite] shutting down...");
		releaseWorkspaceLock(workspaceDir);
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
