import { beforeEach, expect, test } from "bun:test";
import { normalizeCloudSeenUpdates } from "@/lib/app-state-reconcile";
import {
	enqueueLocalYUpdate,
	flushSpace,
	getPendingCount,
	getQueuedUpdateIds,
	isPushableOrigin,
	makeUpdateId,
	stopLiveSync,
	takeBatch,
} from "@/lib/cloud-live-sync";
import { resolveCloudNoteMerge } from "@/lib/cloud-pull-sync";
import { useAppStore } from "@/lib/stores/app-store";

const SPACE = "TestSpace";

beforeEach(() => {
	stopLiveSync(SPACE);
	useAppStore.getState().removeCloudSpaceLink(SPACE);
});

test("updateId follows the device:note:counter wire contract", () => {
	expect(makeUpdateId("dev-1", "note-9", 42)).toBe("dev-1:note-9:42");
});

test("load + remote origins never enter the push queue", () => {
	expect(isPushableOrigin("paperite:y-note-load")).toBe(false);
	expect(isPushableOrigin("paperite:cloud-remote")).toBe(false);
	expect(isPushableOrigin("paperite:local-remote")).toBe(false);
	expect(isPushableOrigin("user-typing")).toBe(true);
	expect(isPushableOrigin(undefined)).toBe(true);
});

test("flush batches are capped", () => {
	const items = Array.from({ length: 120 }, (_, i) => i);
	expect(takeBatch(items, 50)).toHaveLength(50);
	expect(takeBatch(items, 0)).toHaveLength(0);
	expect(takeBatch([1, 2], 50)).toEqual([1, 2]);
});

test("unlinked spaces enqueue nothing and touch nothing", () => {
	const queued = enqueueLocalYUpdate(
		`${SPACE}/note.json`,
		"note-1",
		new Uint8Array([1, 2, 3]),
		"user-typing",
	);
	expect(queued).toBe(false);
	expect(getPendingCount(SPACE)).toBe(0);
});

test("linked spaces queue edits; failed flush keeps payloads with stable ids", async () => {
	useAppStore.getState().setCloudSpaceLink(SPACE, "space-test-id");
	const queued = enqueueLocalYUpdate(
		`${SPACE}/note.json`,
		"note-1",
		new Uint8Array([9, 9, 9]),
		"user-typing",
	);
	expect(queued).toBe(true);
	expect(getPendingCount(SPACE)).toBe(1);

	const before = getQueuedUpdateIds(SPACE);
	expect(before).toHaveLength(1);
	// Wire contract: ${deviceId}:${noteId}:${counter} — the noteId segment
	// must survive; the exact device/counter values are environment-specific.
	expect(before[0]).toContain("note-1");

	// No Convex deployment is configured in tests, so the flush must fail —
	// and the payload must stay queued with the SAME updateId (server
	// idempotency relies on retry reusing the id assigned at enqueue).
	await flushSpace(SPACE);
	expect(getPendingCount(SPACE)).toBe(1);
	expect(getQueuedUpdateIds(SPACE)).toEqual(before);

	stopLiveSync(SPACE);
	useAppStore.getState().removeCloudSpaceLink(SPACE);
	expect(getPendingCount(SPACE)).toBe(0);
});

test("path collision rule: same path + different noteId keeps both copies", () => {
	expect(resolveCloudNoteMerge(null, "cloud-1")).toBe("merge");
	expect(resolveCloudNoteMerge("note-1", "note-1")).toBe("merge");
	expect(resolveCloudNoteMerge("local-note-7", "cloud-note-9")).toBe("copy");
});

test("seen-update lists are capped and sanitized", () => {
	expect(normalizeCloudSeenUpdates(undefined)).toEqual({});
	const big = Array.from({ length: 600 }, (_, i) => `u-${i}`);
	const normalized = normalizeCloudSeenUpdates({
		"space::note": big,
		"": ["x"],
		bad: "not-an-array" as unknown as string[],
	});
	expect(normalized["space::note"]).toHaveLength(500);
	expect(normalized["space::note"]?.[0]).toBe("u-100");
	expect(" " in normalized || "" in normalized).toBe(false);
	expect("bad" in normalized).toBe(false);
});
