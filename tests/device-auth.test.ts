import { describe, expect, test } from "bun:test";

const { parse } = require("../server/lib/device-auth.js") as {
	parse: (raw: string | null) => Record<string, string>;
};

describe("device auth record validation", () => {
	test("recognizes a valid bound record without exposing its secret", () => {
		const result = parse(
			JSON.stringify({
				version: 1,
				deviceId: "device-1",
				userId: "user_123",
				secret: "a".repeat(64),
				createdAt: Date.now(),
			}),
		);
		expect(result).toEqual({
			status: "bound",
			userId: "user_123",
			deviceId: "device-1",
		});
		expect(JSON.stringify(result)).not.toContain("secret");
	});

	test("returns unbound for an empty keychain slot", () => {
		expect(parse(null)).toEqual({ status: "unbound" });
	});

	test("rejects malformed or incomplete records", () => {
		expect(parse("not-json")).toEqual({ status: "invalid-record" });
		expect(
		parse(JSON.stringify({ version: 1, userId: "user_123" })),
	).toEqual({ status: "invalid-record" });
	});
});
