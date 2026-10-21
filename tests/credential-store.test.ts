import { beforeEach, describe, expect, test } from "bun:test";
import {
	browserCredentialLimitation,
	readPersonalServerCredential,
	savePersonalServerCredential,
} from "@/lib/credential-store";

describe("personal-server credential boundary", () => {
	beforeEach(() => {
		(globalThis as typeof globalThis & { window: Window }).window =
			{} as Window;
	});

	test("browser mode never falls back to localStorage", async () => {
		const result = await savePersonalServerCredential("server-1", "secret");
		expect(result).toEqual({ ok: false, error: browserCredentialLimitation });
		expect(await readPersonalServerCredential("server-1")).toBeNull();
		expect(JSON.stringify(globalThis.window)).not.toContain("secret");
	});
});
