import { describe, expect, test } from "bun:test";

const { isLoopbackHost, hostnameOf, isSameSiteRequest, createCorsOptions } =
	require("../server/lib/origin-guard.js") as {
		isLoopbackHost: (hostname: string) => boolean;
		hostnameOf: (value: string) => string;
		isSameSiteRequest: (
			headers: Record<string, string | undefined>,
			allowedOrigins?: string[],
		) => boolean;
		createCorsOptions: (allowedOrigins: string[]) => {
			origin: (
				origin: string | undefined,
				cb: (err: null, opts: boolean | string) => void,
			) => void;
		};
	};

describe("loopback host detection", () => {
	test("accepts loopback names and addresses", () => {
		expect(isLoopbackHost("localhost")).toBe(true);
		expect(isLoopbackHost("127.0.0.1")).toBe(true);
		expect(isLoopbackHost("127.0.0.53")).toBe(true);
		expect(isLoopbackHost("[::1]")).toBe(true);
	});

	test("rejects everything else", () => {
		expect(isLoopbackHost("evil.example.com")).toBe(false);
		expect(isLoopbackHost("192.168.1.5")).toBe(false);
		expect(isLoopbackHost("10.0.0.1")).toBe(false);
		expect(isLoopbackHost("")).toBe(false);
	});
});

describe("origin hostname parsing", () => {
	test("strips scheme, port and path", () => {
		expect(hostnameOf("http://localhost:3000")).toBe("localhost");
		expect(hostnameOf("https://evil.example.com")).toBe("evil.example.com");
		expect(hostnameOf("127.0.0.1:3000")).toBe("127.0.0.1");
	});

	test("keeps IPv6 brackets intact", () => {
		expect(hostnameOf("http://[::1]:3000")).toBe("[::1]");
	});
});

describe("cross-site request rejection", () => {
	test("rejects a foreign origin (the token-theft case)", () => {
		expect(
			isSameSiteRequest({
				origin: "https://evil.example.com",
				host: "127.0.0.1:3000",
			}),
		).toBe(false);
	});

	test("rejects a cross-site Sec-Fetch-Site even with a loopback origin", () => {
		expect(
			isSameSiteRequest({
				origin: "http://localhost:3000",
				host: "127.0.0.1:3000",
				"sec-fetch-site": "cross-site",
			}),
		).toBe(false);
	});

	test("rejects a rebound host (DNS rebinding)", () => {
		expect(
			isSameSiteRequest({
				host: "evil.example.com",
			}),
		).toBe(false);
	});

	test("accepts a same-origin browser request", () => {
		expect(
			isSameSiteRequest({
				origin: "http://localhost:3000",
				host: "localhost:3000",
				"sec-fetch-site": "same-origin",
			}),
		).toBe(true);
	});

	test("accepts a same-site request (dev UI on another loopback port)", () => {
		expect(
			isSameSiteRequest({
				origin: "http://localhost:5173",
				host: "localhost:3000",
				"sec-fetch-site": "same-site",
			}),
		).toBe(true);
	});

	test("accepts a request with no origin (non-browser client)", () => {
		expect(isSameSiteRequest({ host: "127.0.0.1:3000" })).toBe(true);
		expect(isSameSiteRequest({})).toBe(true);
	});

	test("rejects a null origin (sandboxed iframe / opaque origin)", () => {
		expect(
			isSameSiteRequest({
				origin: "null",
				host: "127.0.0.1:3000",
			}),
		).toBe(false);
	});

	test("an allowlisted origin passes the same-site check too", () => {
		// The CORS allowlist and this check must agree, otherwise
		// PAPERITE_ALLOWED_ORIGINS would be useless.
		expect(
			isSameSiteRequest(
				{
					origin: "https://paperite.app",
					host: "localhost:3000",
					"sec-fetch-site": "cross-site",
				},
				["https://paperite.app"],
			),
		).toBe(true);
	});

	test("a non-allowlisted origin is still rejected", () => {
		expect(
			isSameSiteRequest(
				{
					origin: "https://evil.example.com",
					host: "localhost:3000",
				},
				["https://paperite.app"],
			),
		).toBe(false);
	});

	test("an allowlisted origin still cannot use a rebound host", () => {
		expect(
			isSameSiteRequest(
				{
					origin: "https://paperite.app",
					host: "evil.example.com",
				},
				["https://paperite.app"],
			),
		).toBe(false);
	});
});

describe("CORS policy", () => {
	test("never allows a wildcard", () => {
		const options = createCorsOptions([]);
		let emitted: unknown = null;
		options.origin("https://evil.example.com", (_err, opts) => {
			emitted = opts;
		});
		expect(emitted).toBe(false);
	});

	test("echoes only an explicitly allowed origin", () => {
		const options = createCorsOptions(["http://localhost:5173"]);
		let emitted: unknown = null;
		options.origin("http://localhost:5173", (_err, opts) => {
			emitted = opts;
		});
		expect(emitted).toBe("http://localhost:5173");
	});

	test("emits no header when there is no origin", () => {
		const options = createCorsOptions([]);
		let emitted: unknown = null;
		options.origin(undefined, (_err, opts) => {
			emitted = opts;
		});
		expect(emitted).toBe(false);
	});

	test("the callback value must be a boolean, not an options object", () => {
		// `cors` treats any truthy callback value as "allowed" and then
		// reflects the request origin. An options object would therefore
		// re-open the hole this module exists to close.
		const options = createCorsOptions([]);
		let emitted: unknown = "unset";
		options.origin("https://evil.example.com", (_err, opts) => {
			emitted = opts;
		});
		expect(typeof emitted).toBe("boolean");
	});
});
