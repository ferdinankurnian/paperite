const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
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
                   WARNING: serve note endpoints have no authentication.
  --workspace <dir> Notes root (default ~/Documents/Paperite)
  --open           Open the UI in the default browser (default: print URL only)
  --no-browser     Don't open a browser (default)
  --help, -h       Show this help

Only one serve at a time (any port): a pid-checked lockfile in tmp guards
serve-vs-serve. When desktop already owns the workspace, serve attaches to
its authenticated loopback owner bridge instead of opening index.sqlite.

The browser surface has no account of its own — it mirrors the desktop's
Clerk session. If no desktop app is running, serve still serves your notes
but prints a warning: sign-in, cloud sync and device management need the
desktop app.`;

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
const deviceAuth = require("./lib/device-auth");
const {
	readAuthBridge,
	readAuthBridgeSync,
	requestAuthBridge,
	readTokenExpiry,
} = require("./lib/auth-bridge");
const { createCorsOptions, isSameSiteRequest } = require("./lib/origin-guard");
const {
	createOwnerProxyMiddleware,
	requestOwner,
} = require("./lib/owner-proxy");

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

const writeLockAtomically = (lockPath, value) => {
	const tempPath = `${lockPath}.${process.pid}.tmp`;
	fsSync.writeFileSync(tempPath, JSON.stringify(value));
	fsSync.renameSync(tempPath, lockPath);
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
	const { WebSocket, WebSocketServer } = require("ws");

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
	let existingWs = readWorkspaceLock(workspaceDir);
	// Electron writes the lock before binding its owner bridge. Give that
	// bridge a short window to publish its port/secret so a simultaneous
	// `serve` launch attaches instead of racing the startup sequence.
	for (let attempt = 0; attempt < 30; attempt += 1) {
		if (
			!existingWs ||
			!isPidAlive(existingWs.pid) ||
			existingWs.mode !== "electron" ||
			(Number.isInteger(existingWs.ownerPort) &&
				typeof existingWs.ownerSecret === "string")
		)
			break;
		await new Promise((resolve) => setTimeout(resolve, 100));
		existingWs = readWorkspaceLock(workspaceDir);
	}
	const attachedOwner =
		existingWs?.mode === "electron" &&
		isPidAlive(existingWs.pid) &&
		Number.isInteger(existingWs.ownerPort) &&
		typeof existingWs.ownerSecret === "string";
	if (existingWs && isPidAlive(existingWs.pid) && !attachedOwner) {
		const holder =
			existingWs.mode === "serve"
				? `paperite serve at ${existingWs.url ?? (existingWs.port ? `http://localhost:${existingWs.port}` : "unknown address")}`
				: "Paperite desktop";
		console.error(
			`[paperite] workspace is already open by ${holder} (pid ${existingWs.pid}).`,
		);
		console.error(
			existingWs.mode === "electron"
				? "[paperite] desktop owner is starting without an attach bridge yet — restart Paperite once, then serve can attach safely."
				: "[paperite] paperite serve refuses to open the same workspace twice — sharing index.sqlite splits state.",
		);
		console.error(
			"[paperite] stop the other process first, or use --workspace <dir> for a separate workspace.",
		);
		process.exit(1);
	}

	// When Electron owns the workspace, serve becomes a browser-facing proxy.
	// It never opens SQLite, starts file watchers, or mutates workspace files.
	if (attachedOwner) {
		console.log(
			`[paperite] attaching to desktop workspace owner (pid ${existingWs.pid})`,
		);
	} else {
		// A standalone serve still becomes the workspace owner. A second serve
		// remains rejected by the global serve lock above.
		acquireWorkspaceLock(workspaceDir, { mode: "serve", port: args.port });
	}

	// Single serve instance — any port. Refuses with the existing address
	// instead of splitting identity/data across two servers.
	acquireServeLock({ port: args.port, workspace: workspaceDir });

	// The browser surface has no account of its own — it mirrors the
	// desktop's Clerk session. So the desktop app has to be running for
	// sign-in, cloud sync and device management to work. A desktop that is
	// already attached (as owner above, or as a client that published an
	// auth bridge) means we are good; otherwise say so loudly, because a
	// silent guest-mode browser is a confusing place to land.
	//
	// This is a warning, not a hard block: serve can legitimately start
	// first and have the desktop attach a moment later. Blocking here
	// would deadlock that ordering (the desktop needs serve's URL, which is
	// only published once serve is listening).
	const desktopAttached = () =>
		attachedOwner || Boolean(readAuthBridgeSync(workspaceDir));
	let warnedAboutDesktop = false;
	const warnAboutMissingDesktop = () => {
		if (warnedAboutDesktop || desktopAttached()) return;
		warnedAboutDesktop = true;
		console.warn(
			"[paperite] no Paperite desktop app detected — open it to sign in.",
		);
		console.warn(
			"[paperite] the browser follows the desktop's session, so sign-in, cloud sync",
		);
		console.warn(
			"[paperite] and device management need the desktop app running.",
		);
		console.warn(
			"[paperite] notes work either way; the desktop app will be picked up automatically.",
		);
	};

	if (!attachedOwner) {
		await workspace.ensureWorkspace();
		await workspace.purgeOldTrashItems();
	}
	try {
		if (!attachedOwner) await sqlite.openDb();
	} catch (error) {
		console.error(
			`[paperite] could not open index.sqlite — is Paperite desktop running on the same workspace? Stop it first or use --workspace <dir>. (${error.message})`,
		);
		releaseWorkspaceLock(workspaceDir);
		releaseServeLock();
		process.exit(1);
	}

	const app = express();
	// A local server with no authentication of its own must not be readable
	// by any website the user visits. "Loopback only" does not help against
	// a browser — a page on evil.example.com can reach 127.0.0.1 and the
	// browser is the one deciding whether the response may be read. So CORS
	// is restricted to an explicit allowlist (never `*`), and every API
	// request must look same-site to the browser.
	const allowedOrigins = (process.env.PAPERITE_ALLOWED_ORIGINS || "")
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
	app.use(cors(createCorsOptions(allowedOrigins)));
	// Guard every data-bearing surface, not just /api: note assets live
	// outside /api and would otherwise stay readable cross-site.
	app.use((req, res, next) => {
		const path = req.path || "";
		if (path.startsWith("/api") || path.startsWith("/note-assets")) {
			if (!isSameSiteRequest(req.headers, allowedOrigins)) {
				res.status(403).json({ error: "cross-site request rejected" });
				return;
			}
		}
		next();
	});
	app.use(express.raw({ type: "application/octet-stream", limit: "10mb" }));
	app.use(express.json({ limit: "10mb" }));
	if (attachedOwner) {
		app.use(
			"/api",
			createOwnerProxyMiddleware({
				ownerPort: existingWs.ownerPort,
				ownerSecret: existingWs.ownerSecret,
			}),
		);
	}

	const requireLoopback = (req, res, next) => {
		const address = req.socket.remoteAddress;
		if (
			isLoopbackHost(args.hostname) &&
			(address === "127.0.0.1" ||
				address === "::1" ||
				address === "::ffff:127.0.0.1")
		) {
			return next();
		}
		return res.status(403).json({ error: "device auth is loopback-only" });
	};
	app.get("/api/device-auth/status", requireLoopback, async (_req, res) =>
		res.json(await deviceAuth.status()),
	);
	app.post("/api/device-auth/claim", requireLoopback, async (req, res) =>
		res.json(await deviceAuth.claim(req.body?.userId)),
	);
	app.post("/api/device-auth/clear", requireLoopback, async (_req, res) =>
		res.json(await deviceAuth.clear()),
	);
	app.post("/api/device-auth/enable-file", requireLoopback, async (_req, res) =>
		res.json(await deviceAuth.enableFileStorage()),
	);

	// A browser surface attached to the server uses the desktop's Clerk
	// session. The browser never receives a refresh token; it only gets the
	// current identity and, when Convex asks for one, a short-lived JWT.
	//
	// Two orderings, both ending at the desktop renderer:
	//  - desktop-first: serve attached to the Electron workspace owner, so
	//    the owner bridge already answers `auth:*` channels.
	//  - serve-first: serve owns the workspace and the desktop attached to
	//    it, so the desktop published a separate auth bridge for us to pull.
	const callDesktop = async (channel, args = []) => {
		if (attachedOwner) {
			return requestOwner(existingWs, channel, args);
		}
		const bridge = await readAuthBridge(workspaceDir);
		if (!bridge) throw new Error("no desktop session attached");
		return requestAuthBridge(bridge, channel, args);
	};

	// The desktop's Clerk session outlives the desktop process — it lives in
	// Electron's persistent partition. So when the desktop is closed we are
	// not "signed out", we are merely unable to *reach* the session. Remember
	// the last identity we pulled so a browser surface keeps showing the
	// right account instead of pretending the user signed out.
	let lastKnownSession = null;

	// The cached identity, for when the desktop is unreachable. The token is
	// only handed out while it is genuinely still valid — a stale JWT is
	// worse than none, because Convex would reject it with a confusing
	// error. The token's own `exp` claim is the authority on that.
	const cachedDesktopSession = () => {
		if (!lastKnownSession) return null;
		let token = null;
		if (lastKnownSession.token) {
			const expiry = readTokenExpiry(lastKnownSession.token);
			// Treat an unknown expiry as expired: without proof of validity
			// we do not hand the token out.
			if (expiry !== null && expiry * 1000 > Date.now() + 5_000) {
				token = lastKnownSession.token;
			}
		}
		return {
			signedIn: true,
			user: lastKnownSession.user,
			token,
			// The desktop is gone. Say so, so the UI can explain why cloud
			// features are unavailable while local notes keep working.
			desktopOffline: true,
		};
	};

	const pullDesktopSession = async (includeToken) => {
		try {
			const result = await callDesktop("auth:get-session", [{ includeToken }]);
			if (result?.signedIn && result.user) {
				lastKnownSession = {
					signedIn: true,
					user: result.user,
					// A Convex JWT is short-lived; only reuse it briefly.
					token: result.token ?? null,
					tokenAt: result.token ? Date.now() : 0,
				};
			} else {
				// The desktop answered, and it has no session. That is a real
				// sign-out — drop the cache.
				lastKnownSession = null;
			}
			// The desktop turned up after we started without it — say so, so
			// the warning above is visibly resolved.
			if (warnedAboutDesktop) {
				warnedAboutDesktop = false;
				console.log("[paperite] Paperite desktop app detected.");
			}
			return { attached: true, ...result };
		} catch (error) {
			if (error.message === "no desktop session attached") {
				// The desktop is closed (or has not attached yet). Fall back to
				// the remembered identity so the browser does not flash to
				// "signed out" every time the desktop app is closed.
				const cached = cachedDesktopSession();
				return cached
					? { attached: false, ...cached }
					: { attached: false, signedIn: false, user: null };
			}
			throw error;
		}
	};

	app.get("/api/auth/session", requireLoopback, async (req, res) => {
		const includeToken = req.query.token === "1";
		try {
			res.json(await pullDesktopSession(includeToken));
		} catch (error) {
			// The desktop vanished mid-request. Fall back to the cached
			// identity so the browser does not flash to "signed out".
			const cached = cachedDesktopSession();
			if (cached) {
				res.json({ attached: false, ...cached });
				return;
			}
			res.status(503).json({
				attached: false,
				signedIn: false,
				user: null,
				error: error.message,
			});
		}
	});
	app.post("/api/auth/sign-out", requireLoopback, async (_req, res) => {
		try {
			res.json(await callDesktop("auth:sign-out"));
		} catch (error) {
			res.status(503).json({ error: error.message });
		}
	});

	// The browser holds no Clerk session, so it cannot list or revoke
	// sessions or write user metadata itself. Route those through the
	// desktop, which does hold the session.
	app.get("/api/auth/sessions", requireLoopback, async (_req, res) => {
		try {
			res.json(await callDesktop("auth:list-sessions"));
		} catch (error) {
			res.status(503).json({ error: error.message });
		}
	});
	app.post("/api/auth/sessions/revoke", requireLoopback, async (req, res) => {
		const sessionId = req.body?.sessionId;
		if (typeof sessionId !== "string" || !sessionId) {
			res.status(400).json({ error: "sessionId is required" });
			return;
		}
		try {
			res.json(await callDesktop("auth:revoke-session", [sessionId]));
		} catch (error) {
			res.status(503).json({ error: error.message });
		}
	});
	app.post(
		"/api/auth/sessions/revoke-others",
		requireLoopback,
		async (_req, res) => {
			try {
				res.json(await callDesktop("auth:revoke-other-sessions"));
			} catch (error) {
				res.status(503).json({ error: error.message });
			}
		},
	);
	app.post("/api/auth/metadata", requireLoopback, async (req, res) => {
		const metadata = req.body?.metadata;
		if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
			res.status(400).json({ error: "metadata is required" });
			return;
		}
		try {
			res.json(await callDesktop("auth:update-metadata", [metadata]));
		} catch (error) {
			res.status(503).json({ error: error.message });
		}
	});

	if (!attachedOwner) {
		app.use("/api", require("./routes/notes"));
		app.use("/api", require("./routes/workspace"));
		app.use("/api", require("./routes/trash"));
		app.use("/api", require("./routes/state"));
	}
	app.get("/note-assets/{*assetPath}", async (req, res) => {
		try {
			const raw = Array.isArray(req.params.assetPath)
				? req.params.assetPath.join("/")
				: req.params.assetPath || "";
			const segments = raw.split("/").filter(Boolean).map(decodeURIComponent);
			if (
				segments.length < 3 ||
				segments.includes("..") ||
				segments.includes(".") ||
				segments[segments.length - 2] !== "assets"
			) {
				res.status(403).end("Forbidden");
				return;
			}
			if (attachedOwner) {
				const assetsIndex = segments.lastIndexOf("assets");
				const result = await requestOwner(existingWs, "notes:read-asset", [
					segments.slice(0, assetsIndex).join("/"),
					segments.slice(assetsIndex + 1).join("/"),
				]);
				res.type("application/octet-stream").send(Buffer.from(result));
				return;
			}
			res.sendFile(workspace.resolveWorkspacePath(segments.join("/")));
		} catch {
			res.status(404).end("Not found");
		}
	});

	// Health check
	app.get("/api/health", (_req, res) => {
		res.json({ ok: true, workspace: workspace.workspaceRoot() });
	});
	app.get("/api/device-info", (_req, res) => {
		res.json({
			hostname: os.hostname(),
			platform: process.platform,
			arch: process.arch,
		});
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
	// The WebSocket upgrade bypasses Express middleware, so the same-site
	// check has to be applied here too. A cross-site socket would let a
	// hostile page observe when the workspace changes.
	const wss = new WebSocketServer({
		server,
		verifyClient: ({ req }) => isSameSiteRequest(req.headers, allowedOrigins),
	});
	let ownerEvents;

	wss.on("connection", (ws) => {
		ws.send(JSON.stringify({ event: "connected" }));
	});
	if (attachedOwner) {
		ownerEvents = new WebSocket(
			`ws://127.0.0.1:${existingWs.ownerPort}/__paperite_owner/live`,
			{ headers: { "x-paperite-owner-secret": existingWs.ownerSecret } },
		);
		ownerEvents.on("message", (message) => {
			for (const client of wss.clients) {
				if (client.readyState === 1) client.send(message);
			}
		});
		ownerEvents.on("error", (error) => {
			console.error(
				`[paperite] workspace owner event bridge: ${error.message}`,
			);
		});
	}

	let stopWatchers = () => undefined;
	if (!attachedOwner) {
		stopWatchers = require("./lib/watchers").startWatchers(wss);
	}

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
		if (!attachedOwner) releaseWorkspaceLock(workspaceDir);
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
		warnAboutMissingDesktop();

		// Refresh the serve lock with the concrete URL so a second boot can
		// point at the running instance.
		try {
			const { readServeLock, serveLockPath } = require("./lib/locks");
			const current = readServeLock();
			if (current && current.pid === process.pid) {
				writeLockAtomically(serveLockPath(), { ...current, url });
			}
		} catch {
			// best effort
		}
		try {
			const currentWs = require("./lib/locks").readWorkspaceLock(workspaceDir);
			if (currentWs && currentWs.pid === process.pid) {
				writeLockAtomically(
					require("./lib/locks").workspaceLockPath(workspaceDir),
					{ ...currentWs, url },
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
		ownerEvents?.close();
		if (!attachedOwner) sqlite.close();
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
