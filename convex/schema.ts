import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
	sharedSpaces: defineTable({
		name: v.string(),
		ownerUserId: v.string(),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_owner", ["ownerUserId"]),
	sharedSpaceMembers: defineTable({
		spaceId: v.id("sharedSpaces"),
		userId: v.string(),
		role: v.union(v.literal("owner"), v.literal("editor"), v.literal("viewer")),
		createdAt: v.number(),
	}).index("by_space_user", ["spaceId", "userId"]),
	sharedNotes: defineTable({
		spaceId: v.id("sharedSpaces"),
		noteId: v.string(),
		path: v.string(),
		title: v.string(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_space", ["spaceId"])
		.index("by_space_note", ["spaceId", "noteId"]),
	sharedNoteUpdates: defineTable({
		spaceId: v.id("sharedSpaces"),
		noteId: v.string(),
		updateId: v.string(),
		deviceId: v.string(),
		data: v.bytes(),
		createdAt: v.number(),
	})
		.index("by_note", ["spaceId", "noteId"])
		.index("by_note_update", ["spaceId", "noteId", "updateId"]),
	sharedNoteSnapshots: defineTable({
		spaceId: v.id("sharedSpaces"),
		noteId: v.string(),
		data: v.bytes(),
		stateVector: v.bytes(),
		updatedAt: v.number(),
	}).index("by_note", ["spaceId", "noteId"]),
});
