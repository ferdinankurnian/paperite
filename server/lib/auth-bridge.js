// Desktop auth bridge — how `paperite serve` reaches the desktop's Clerk
// session.
//
// The desktop app is the single auth authority for a Paperite installation.
// A browser attached to `paperite serve` mirrors that session; it never holds
// a Clerk session of its own. Two ownership orders exist, and the browser
// must work in both:
//
//   - desktop-first: the desktop owns the workspace and publishes its owner
//     bridge in the workspace lock. serve proxies auth through it
//     (`server/lib/owner-proxy.js`).
//   - serve-first: serve owns the workspace and the desktop attaches to it
//     as a client. The desktop publishes a dedicated auth bridge in
//     <workspace>/.paperite/auth-bridge.json so serve can pull the session
//     the same way.
//
// Both bridges are loopback-only and authenticated with a per-process random
// secret. The browser never learns the secret — it only talks to serve,
// which is the broker. Clerk refresh tokens never leave the Electron
// renderer; the browser only ever receives the current identity and
// short-lived Convex JWTs.

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { isPidAlive } = require("./locks");

const PROTOCOL_VERSION = 1;

const authBridgePath = (workspaceDir) =>
	path.join(workspaceDir, ".paperite", "auth-bridge.json");

/** Publish this process' auth bridge so a serve owner can pull from it. */
const writeAuthBridge = async (workspaceDir, info) => {
	const target = authBridgePath(workspaceDir);
	await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
	const temp = `${target}.${process.pid}.tmp`;
	await fs.writeFile(temp, JSON.stringify(info), { mode: 0o600 });
	await fs.rename(temp, target);
};

/**
 * Read the published auth bridge. Returns null when nothing is published,
 * the record is malformed, or the publishing process is gone.
 */
const readAuthBridge = async (workspaceDir) => {
	try {
		const raw = await fs.readFile(authBridgePath(workspaceDir), "utf8");
		const value = JSON.parse(raw);
		if (
			value?.protocolVersion !== PROTOCOL_VERSION ||
			!Number.isInteger(value.port) ||
			value.port <= 0 ||
			value.port > 65535 ||
			typeof value.secret !== "string" ||
			value.secret.length < 32 ||
			!Number.isInteger(value.pid)
		) {
			return null;
		}
		if (!isPidAlive(value.pid)) return null;
		return { port: value.port, secret: value.secret, pid: value.pid };
	} catch {
		return null;
	}
};

/** Remove the published auth bridge (owner shutdown / desktop quit). */
const clearAuthBridge = async (workspaceDir) => {
	try {
		await fs.unlink(authBridgePath(workspaceDir));
	} catch {
		// best effort
	}
};

/**
 * Call an `auth:` channel on the published auth bridge. Mirrors the owner
 * bridge RPC shape so the desktop can serve both from one handler map.
 */
const requestAuthBridge = (bridge, channel, args = []) => {
	const body = Buffer.from(
		JSON.stringify({
			protocolVersion: PROTOCOL_VERSION,
			channel,
			args,
		}),
	);
	return new Promise((resolve, reject) => {
		const request = http.request(
			{
				host: "127.0.0.1",
				port: bridge.port,
				path: "/__paperite_auth/rpc",
				method: "POST",
				headers: {
					"content-type": "application/json",
					"content-length": body.length,
					"x-paperite-auth-secret": bridge.secret,
				},
				timeout: 5000,
			},
			(response) => {
				const chunks = [];
				response.on("data", (chunk) => chunks.push(chunk));
				response.on("end", () => {
					const raw = Buffer.concat(chunks).toString("utf8");
					let payload;
					try {
						payload = JSON.parse(raw || "{}");
					} catch {
						reject(new Error("auth bridge returned invalid data"));
						return;
					}
					if (response.statusCode !== 200 || payload.error) {
						reject(
							new Error(
								payload.error || `auth bridge error ${response.statusCode}`,
							),
						);
						return;
					}
					resolve(payload.result);
				});
			},
		);
		request.on("timeout", () =>
			request.destroy(new Error("auth bridge timeout")),
		);
		request.on("error", reject);
		request.end(body);
	});
};

/**
 * Read the expiry (seconds since epoch) of a JWT, without verifying it.
 *
 * Used only to decide whether a cached token is still worth handing out.
 * The signature is verified by whoever consumes it (Convex), not here — this
 * is a freshness check, not a trust decision.
 *
 * Returns null when the token is absent or unparseable.
 */
const readTokenExpiry = (token) => {
	if (typeof token !== "string" || token === "") return null;
	const parts = token.split(".");
	if (parts.length !== 3) return null;
	try {
		const payload = Buffer.from(
			parts[1].replace(/-/g, "+").replace(/_/g, "/"),
			"base64",
		).toString("utf8");
		const claims = JSON.parse(payload);
		return typeof claims.exp === "number" ? claims.exp : null;
	} catch {
		return null;
	}
};

/**
 * Read the published auth bridge synchronously.
 *
 * The serve process needs this during startup, before the event loop is
 * necessarily free, and while printing its banner. Returns the same shape as
 * `readAuthBridge`, or null when nothing usable is published.
 */
const readAuthBridgeSync = (workspaceDir) => {
	try {
		const raw = fsSync.readFileSync(authBridgePath(workspaceDir), "utf8");
		const value = JSON.parse(raw);
		if (
			value?.protocolVersion !== PROTOCOL_VERSION ||
			!Number.isInteger(value.port) ||
			value.port <= 0 ||
			value.port > 65535 ||
			typeof value.secret !== "string" ||
			value.secret.length < 32 ||
			!Number.isInteger(value.pid)
		) {
			return null;
		}
		if (!isPidAlive(value.pid)) return null;
		return { port: value.port, secret: value.secret, pid: value.pid };
	} catch {
		return null;
	}
};

module.exports = {
	PROTOCOL_VERSION,
	authBridgePath,
	writeAuthBridge,
	readAuthBridge,
	readAuthBridgeSync,
	clearAuthBridge,
	requestAuthBridge,
	readTokenExpiry,
};
