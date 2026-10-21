import { describe, expect, test } from "bun:test";

const { summarizeActivity } = require("../src/lib/auth-sessions.ts") as {
	summarizeActivity: (
		activity: Record<string, unknown> | null | undefined,
	) => Record<string, unknown> | null;
};

describe("session activity wire shape", () => {
	test("normalizes a Clerk activity object", () => {
		expect(
			summarizeActivity({
				browserName: "Zen",
				browserVersion: "1.2.3",
				deviceType: "desktop",
				isMobile: false,
				city: "Bandung",
				country: "ID",
				ipAddress: "127.0.0.1",
				// Extra fields must not leak into the wire shape.
				deviceId: "should-not-travel",
			}),
		).toEqual({
			browserName: "Zen",
			browserVersion: "1.2.3",
			deviceType: "desktop",
			isMobile: false,
			city: "Bandung",
			country: "ID",
			ipAddress: "127.0.0.1",
		});
	});

	test("keeps missing fields null instead of dropping them", () => {
		expect(summarizeActivity({ deviceType: "mobile" })).toEqual({
			browserName: null,
			browserVersion: null,
			deviceType: "mobile",
			isMobile: null,
			city: null,
			country: null,
			ipAddress: null,
		});
	});

	test("returns null for a missing activity", () => {
		expect(summarizeActivity(null)).toBeNull();
		expect(summarizeActivity(undefined)).toBeNull();
	});

	test("rejects non-string values rather than coercing them", () => {
		expect(summarizeActivity({ browserName: 42, city: {} })).toEqual({
			browserName: null,
			browserVersion: null,
			deviceType: null,
			isMobile: null,
			city: null,
			country: null,
			ipAddress: null,
		});
	});
});
