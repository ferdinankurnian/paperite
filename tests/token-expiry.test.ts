import { describe, expect, test } from "bun:test";

const { readTokenExpiry } = require("../server/lib/auth-bridge.js") as {
	readTokenExpiry: (token: string) => number | null;
};

/** Build a JWT-shaped token with the given claims. */
const makeToken = (claims: Record<string, unknown>) => {
	const b64 = (value: unknown) =>
		Buffer.from(JSON.stringify(value))
			.toString("base64")
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
	return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.signature`;
};

describe("token expiry reading", () => {
	test("reads the exp claim", () => {
		const exp = 1792536000;
		expect(readTokenExpiry(makeToken({ sub: "user_1", exp }))).toBe(exp);
	});

	test("returns null for a token with no exp claim", () => {
		expect(readTokenExpiry(makeToken({ sub: "user_1" }))).toBeNull();
	});

	test("returns null for a malformed token", () => {
		expect(readTokenExpiry("not-a-jwt")).toBeNull();
		expect(readTokenExpiry("")).toBeNull();
		expect(readTokenExpiry("a.b.c.d")).toBeNull();
	});

	test("returns null for a non-string", () => {
		expect(readTokenExpiry(undefined as unknown as string)).toBeNull();
		expect(readTokenExpiry(null as unknown as string)).toBeNull();
	});

	test("returns null when the payload is not JSON", () => {
		expect(readTokenExpiry("aaa.bm90LWpzb24.ccc")).toBeNull();
	});
});
