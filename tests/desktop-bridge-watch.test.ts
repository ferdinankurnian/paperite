import { describe, expect, test } from "bun:test";

/**
 * The desktop bridge watcher decides when a browser surface must block
 * because the desktop app is gone. It is the gate for the blocking dialog,
 * so its state machine is worth pinning down.
 *
 * `import.meta.env.PAPERITE_WEB` is inlined at build time, and the module
 * reads `window` at call time — so each surface runs in its own subprocess
 * with the right build flag and a stubbed window/fetch.
 */
const run = (script: string, env: Record<string, string> = {}) => {
	const result = Bun.spawnSync({
		cmd: ["bun", "-e", script],
		env: { ...process.env, PAPERITE_WEB: "1", ...env },
	});
	if (result.exitCode !== 0) {
		throw new Error(result.stderr.toString());
	}
	return JSON.parse(result.stdout.toString().trim()) as unknown;
};

const MODULE = new URL("../src/lib/desktop-bridge-watch.ts", import.meta.url)
	.pathname;

describe("desktop bridge watcher", () => {
	test("reports a live desktop as attached and signed in", () => {
		const out = run(`
			globalThis.window = { };
			globalThis.fetch = async () => ({
				ok: true,
				json: async () => ({
					attached: true,
					signedIn: true,
					user: { id: "u1", email: "a@b.c" },
					desktopOffline: false,
				}),
			});
			const { ensureDesktopBridgeReady, getDesktopBridgeSnapshot } = await import(${JSON.stringify(MODULE)});
			const state = await ensureDesktopBridgeReady();
			console.log(JSON.stringify(state));
		`);
		expect(out).toMatchObject({
			attached: true,
			signedIn: true,
			desktopOffline: false,
			offline: false,
			ready: true,
		});
	});

	test("reports the desktop as offline once it goes away", () => {
		const out = run(`
			globalThis.window = { };
			globalThis.fetch = async () => ({
				ok: true,
				json: async () => ({
					attached: false,
					signedIn: true,
					user: { id: "u1", email: "a@b.c" },
					desktopOffline: true,
				}),
			});
			const { ensureDesktopBridgeReady } = await import(${JSON.stringify(MODULE)});
			console.log(JSON.stringify(await ensureDesktopBridgeReady()));
		`);
		expect(out).toMatchObject({
			attached: false,
			signedIn: true,
			desktopOffline: true,
			offline: true,
		});
	});

	test("a desktop that was never attached reports no session", () => {
		const out = run(`
			globalThis.window = { };
			globalThis.fetch = async () => ({
				ok: true,
				json: async () => ({ attached: false, signedIn: false, user: null }),
			});
			const { ensureDesktopBridgeReady } = await import(${JSON.stringify(MODULE)});
			console.log(JSON.stringify(await ensureDesktopBridgeReady()));
		`);
		expect(out).toMatchObject({
			attached: false,
			signedIn: false,
			desktopOffline: false,
			offline: false,
			ready: true,
		});
	});

	test("the desktop build never polls the bridge", () => {
		const out = run(
			`
			globalThis.window = { electron: { workspaceMode: "local" } };
			let called = 0;
			globalThis.fetch = async () => { called += 1; return { ok: true, json: async () => ({}) }; };
			const { ensureDesktopBridgeReady, getDesktopBridgeSnapshot } = await import(${JSON.stringify(MODULE)});
			await ensureDesktopBridgeReady();
			console.log(JSON.stringify({ called, state: getDesktopBridgeSnapshot() }));
		`,
			{ PAPERITE_WEB: "0" },
		);
		expect(out).toMatchObject({
			called: 0,
			state: { ready: false },
		});
	});
});

describe("blank browser", () => {
	/**
	 * A browser with no desktop and no session must not load the workspace
	 * behind the blocking dialog — an empty page is honest, a half-built
	 * shell with no account is not.
	 */
	const blank = (state: Record<string, unknown>) =>
		run(`
			const { shouldBlankBrowser } = await import(${JSON.stringify(MODULE)});
			console.log(JSON.stringify(shouldBlankBrowser({
				attached: false,
				signedIn: false,
				user: null,
				desktopOffline: false,
				offline: false,
				ready: true,
				...${JSON.stringify(state)},
			})));
		`);

	test("blanks when there is no desktop at all", () => {
		expect(blank({})).toBe(true);
	});

	test("keeps the app when a desktop is attached but signed out", () => {
		// The desktop is there, so the user can sign in on it right now. A
		// blank page with nothing to act on would be worse than a guest
		// shell that offers the sign-in.
		expect(blank({ attached: true, signedIn: false })).toBe(false);
	});

	test("keeps the app when the desktop is closed but the session survives", () => {
		expect(
			blank({
				attached: false,
				signedIn: true,
				desktopOffline: true,
				offline: true,
			}),
		).toBe(false);
	});

	test("keeps the app when the desktop is attached and signed in", () => {
		expect(blank({ attached: true, signedIn: true })).toBe(false);
	});

	test("does not blank before the first answer arrives", () => {
		expect(blank({ ready: false })).toBe(false);
	});
});
