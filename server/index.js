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

const parseArgs = (argv) => {
	const args = { port: 3000, hostname: "0.0.0.0", workspace: undefined };
	for (let i = 2; i < argv.length; i++) {
		if (argv[i] === "--port" && argv[i + 1]) {
			args.port = Number(argv[++i]) || 3000;
		} else if (argv[i] === "--hostname" && argv[i + 1]) {
			args.hostname = argv[++i];
		} else if (argv[i] === "--workspace" && argv[i + 1]) {
			args.workspace = argv[++i];
		}
	}
	return args;
};

const main = async () => {
	loadLocalEnv();
	const args = parseArgs(process.argv);

	const express = require("express");
	const cors = require("cors");
	const { WebSocketServer } = require("ws");

	const workspace = require("./lib/workspace");
	const sqlite = require("./lib/sqlite");

	if (args.workspace) {
		workspace.configure(path.resolve(args.workspace));
	}

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

	// Serve static files in production
	const distPath = path.join(__dirname, "..", "dist");
	try {
		await fs.access(distPath);
		app.use(express.static(distPath));
		app.get("*", (_req, res) => {
			res.sendFile(path.join(distPath, "index.html"));
		});
	} catch {
		// No dist directory — API-only mode
	}

	const server = http.createServer(app);
	const wss = new WebSocketServer({ server });

	wss.on("connection", (ws) => {
		ws.send(JSON.stringify({ event: "connected" }));
	});

	const stopWatchers = require("./lib/watchers").startWatchers(wss);

	server.listen(args.port, args.hostname, () => {
		console.log(
			`[paperite] server listening on http://${args.hostname}:${args.port}`,
		);
		console.log(`[paperite] workspace: ${workspace.workspaceRoot()}`);
	});

	const shutdown = () => {
		console.log("\n[paperite] shutting down...");
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
