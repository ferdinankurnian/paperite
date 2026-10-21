import { describe, expect, test } from "bun:test";

/**
 * The desktop app draws its own chrome: a custom titlebar with the window
 * controls, over a frameless window. A plain browser has browser chrome
 * instead.
 *
 * The trap is `import.meta.env.PAPERITE_WEB`. That flag says *which bundle
 * was built*, not *which surface is running*: when the desktop app attaches
 * to `paperite serve` it renders serve's very same web bundle over
 * http://localhost, so the flag is 1 inside Electron. Gating the titlebar
 * on it makes the desktop lose its titlebar the moment it attaches to a
 * server — and with `frame: false` there is no native one to fall back to.
 *
 * The only honest signal is the Electron preload bridge, so these tests pin
 * that down.
 */

const AUTH_BRIDGE = new URL("../src/lib/auth-bridge.ts", import.meta.url)
	.pathname;
const ROOT_LAYOUT = new URL(
	"../src/components/root-layout.tsx",
	import.meta.url,
).pathname;

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

describe("desktop chrome by surface", () => {
	test("the attached desktop still counts as the desktop, web bundle and all", () => {
		const out = run(`
			globalThis.window = { electron: { workspaceMode: "attached" } };
			const { isDesktopRenderer, isBrowserRenderer } = await import(${JSON.stringify(AUTH_BRIDGE)});
			console.log(JSON.stringify({
				desktop: isDesktopRenderer(),
				browser: isBrowserRenderer(),
			}));
		`);
		expect(out).toEqual({ desktop: true, browser: false });
	});

	test("a plain browser is not the desktop", () => {
		const out = run(`
			globalThis.window = { };
			const { isDesktopRenderer, isBrowserRenderer } = await import(${JSON.stringify(AUTH_BRIDGE)});
			console.log(JSON.stringify({
				desktop: isDesktopRenderer(),
				browser: isBrowserRenderer(),
			}));
		`);
		expect(out).toEqual({ desktop: false, browser: true });
	});

	test("the titlebar is gated on the surface, not on the build flag", async () => {
		const source = await Bun.file(ROOT_LAYOUT).text();

		// The titlebar must follow the desktop, never the bundle.
		expect(source).toContain("isDesktopRenderer() && <AppTitlebar />");
		expect(source).not.toMatch(/PAPERITE_WEB\s*&&\s*<AppTitlebar/);
		expect(source).not.toMatch(
			/!\s*import\.meta\.env\.PAPERITE_WEB\s*&&\s*<AppTitlebar/,
		);

		// The "web" shell class means "no titlebar above the sidebar", so it
		// must follow the same surface check.
		expect(source).toContain(
			'isBrowserRenderer() ? " paperite-shell-web" : ""',
		);
	});
});
