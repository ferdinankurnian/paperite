import { describe, expect, test } from "bun:test";
import {
	applyVerifiedMove,
	bindSpaceToTarget,
	disconnectConnection,
	getSpaceSyncTarget,
	normalizeSpaceSyncTargets,
	prepareDuplicateTarget,
} from "@/lib/space-sync-targets";

describe("space sync targets", () => {
	test("migrates legacy cloud links without writing them back", () => {
		const targets = normalizeSpaceSyncTargets(undefined, { Inbox: "cloud-1" });
		expect(targets).toEqual({
			Inbox: { kind: "paperite-cloud", remoteSpaceId: "cloud-1", updatedAt: 0 },
		});
		expect(
			getSpaceSyncTarget({ spaceSyncTargets: targets }, "Inbox").kind,
		).toBe("paperite-cloud");
	});

	test("replaces one active target atomically", () => {
		const state = { spaceSyncTargets: {} };
		const bound = bindSpaceToTarget(
			state,
			"Inbox",
			{
				kind: "paperite-server",
				connectionId: "server-1",
				remoteSpaceId: "space-1",
			},
			10,
		);
		const replaced = bindSpaceToTarget(
			{ spaceSyncTargets: bound },
			"Inbox",
			{
				kind: "local",
			},
			20,
		);
		expect(replaced.Inbox).toEqual({ kind: "local", updatedAt: 20 });
	});

	test("duplicate keeps the original binding and clears remote identity", () => {
		const source = bindSpaceToTarget(
			{ spaceSyncTargets: {} },
			"Inbox",
			{
				kind: "paperite-cloud",
				remoteSpaceId: "cloud-1",
			},
			10,
		);
		const duplicated = prepareDuplicateTarget(
			{ spaceSyncTargets: source },
			"Inbox",
			"Copy",
			20,
		);
		expect(duplicated.Inbox.remoteSpaceId).toBe("cloud-1");
		expect(duplicated.Copy).toEqual({ kind: "paperite-cloud", updatedAt: 20 });
	});

	test("failed move verification leaves the old target intact", () => {
		const old = bindSpaceToTarget(
			{ spaceSyncTargets: {} },
			"Inbox",
			{
				kind: "paperite-cloud",
				remoteSpaceId: "cloud-1",
			},
			10,
		);
		expect(() =>
			applyVerifiedMove(
				{ spaceSyncTargets: old },
				"Inbox",
				{
					kind: "paperite-server",
					connectionId: "server-1",
					remoteSpaceId: "space-1",
				},
				{
					verified: false,
					noteCount: 2,
					verifiedNoteCount: 1,
					identityCoverage: 0.5,
				},
			),
		).toThrow();
		expect(old.Inbox.remoteSpaceId).toBe("cloud-1");
	});

	test("disconnect reports affected spaces and keeps them local", () => {
		const targets = bindSpaceToTarget(
			{ spaceSyncTargets: {} },
			"Inbox",
			{
				kind: "paperite-server",
				connectionId: "server-1",
			},
			10,
		);
		const result = disconnectConnection(
			{ spaceSyncTargets: targets },
			"server-1",
		);
		expect(result.affectedSpaces).toEqual(["Inbox"]);
		expect(result.targets.Inbox.kind).toBe("local");
	});
});
