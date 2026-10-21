import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
	authBridgePath,
	writeAuthBridge,
	readAuthBridge,
	clearAuthBridge,
	requestAuthBridge,
	PROTOCOL_VERSION,
} = require("../server/lib/auth-bridge.js") as {
	authBridgePath: (workspaceDir: string) => string;
	writeAuthBridge: (
		workspaceDir: string,
		info: {
			protocolVersion: number;
			port: number;
			secret: string;
			pid: number;
		},
	) => Promise<void>;
	readAuthBridge: (
		workspaceDir: string,
	) => Promise<{ port: number; secret: string; pid: number } | null>;
	clearAuthBridge: (workspaceDir: string) => Promise<void>;
	requestAuthBridge: (
		bridge: { port: number; secret: string },
		channel: string,
		args?: unknown[],
	) => Promise<unknown>;
	PROTOCOL_VERSION: number;
};

const makeWorkspace = async () =>
	mkdtemp(join(tmpdir(), "paperite-auth-bridge-"));

describe("desktop auth bridge", () => {
	test("publishes and reads back a bridge record", async () => {
		const workspace = await makeWorkspace();
		try {
			const secret = "a".repeat(64);
			await writeAuthBridge(workspace, {
				protocolVersion: PROTOCOL_VERSION,
				port: 4321,
				secret,
				pid: process.pid,
			});

			const bridge = await readAuthBridge(workspace);
			expect(bridge).toEqual({ port: 4321, secret, pid: process.pid });
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});

	test("returns null when nothing is published", async () => {
		const workspace = await makeWorkspace();
		try {
			expect(await readAuthBridge(workspace)).toBeNull();
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});

	test("rejects a malformed record instead of trusting it", async () => {
		const workspace = await makeWorkspace();
		try {
			await writeAuthBridge(workspace, {
				protocolVersion: PROTOCOL_VERSION,
				port: 4321,
				secret: "short",
				pid: process.pid,
			});
			expect(await readAuthBridge(workspace)).toBeNull();
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});

	test("ignores a bridge published by a dead process", async () => {
		const workspace = await makeWorkspace();
		try {
			await writeAuthBridge(workspace, {
				protocolVersion: PROTOCOL_VERSION,
				port: 4321,
				secret: "b".repeat(64),
				// A pid that cannot be alive.
				pid: 2 ** 30,
			});
			expect(await readAuthBridge(workspace)).toBeNull();
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});

	test("clears the published record", async () => {
		const workspace = await makeWorkspace();
		try {
			await writeAuthBridge(workspace, {
				protocolVersion: PROTOCOL_VERSION,
				port: 4321,
				secret: "c".repeat(64),
				pid: process.pid,
			});
			await clearAuthBridge(workspace);
			expect(await readAuthBridge(workspace)).toBeNull();
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});

	test("lives inside the workspace so it never leaves the machine", async () => {
		const workspace = await makeWorkspace();
		try {
			expect(authBridgePath(workspace)).toBe(
				join(workspace, ".paperite", "auth-bridge.json"),
			);
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});
});

describe("auth bridge transport", () => {
	test("sends the bridge secret and rejects a mismatch", async () => {
		const { createServer } = await import("node:http");
		const secret = "d".repeat(64);
		const seenSecrets: (string | undefined)[] = [];
		const server = createServer((request, response) => {
			const provided = request.headers["x-paperite-auth-secret"];
			seenSecrets.push(provided);
			if (provided !== secret) {
				response.writeHead(403, { "content-type": "application/json" });
				response.end(JSON.stringify({ error: "invalid auth bridge secret" }));
				return;
			}
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ result: { signedIn: true } }));
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("no port");
		try {
			const result = await requestAuthBridge(
				{ port: address.port, secret },
				"auth:get-session",
			);
			expect(result).toEqual({ signedIn: true });
			expect(seenSecrets).toEqual([secret]);

			// A wrong secret must be refused by the far side.
			await expect(
				requestAuthBridge(
					{ port: address.port, secret: "wrong" },
					"auth:get-session",
				),
			).rejects.toThrow("invalid auth bridge secret");
		} finally {
			server.close();
		}
	});
});
