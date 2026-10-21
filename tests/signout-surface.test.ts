import { describe, expect, test } from "bun:test";

/**
 * The Sign Out button must not exist on a browser mirror. A browser holds
 * no Clerk session — signing out from a tab would kill the *desktop's*
 * session, which the desktop app owns. The desktop itself keeps the button.
 *
 * `isBrowserRenderer()` is the only thing that decides this, so the check
 * below exercises that predicate directly rather than rendering the tree.
 *
 * `import.meta.env.PAPERITE_WEB` is read when the module is imported, so
 * each surface runs in its own subprocess with the right build flag.
 */

const run = (surface: "browser" | "desktop") => {
	const script = `
		${
			surface === "browser"
				? "globalThis.window = { };"
				: "globalThis.window = { electron: { workspaceMode: 'local' } };"
		}
		const { isDesktopRenderer, isBrowserRenderer } = await import(
			"${new URL("../src/lib/auth-bridge.ts", import.meta.url).pathname}"
		);
		console.log(JSON.stringify({
			desktop: isDesktopRenderer(),
			browser: isBrowserRenderer(),
		}));
	`;
	const result = Bun.spawnSync({
		cmd: ["bun", "-e", script],
		env: {
			...process.env,
			// The web build sets this; the desktop build does not.
			...(surface === "browser" ? { PAPERITE_WEB: "1" } : {}),
		},
	});
	if (result.exitCode !== 0) {
		throw new Error(result.stderr.toString());
	}
	return JSON.parse(result.stdout.toString().trim()) as {
		desktop: boolean;
		browser: boolean;
	};
};

describe("sign-out availability by surface", () => {
	test("a plain browser cannot sign out (it would kill the desktop session)", () => {
		const surface = run("browser");
		expect(surface.desktop).toBe(false);
		expect(surface.browser).toBe(true);
	});

	test("the desktop keeps sign-out", () => {
		const surface = run("desktop");
		expect(surface.desktop).toBe(true);
		expect(surface.browser).toBe(false);
	});
});
