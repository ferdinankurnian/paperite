import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server";

const freeSharedSpaceLimit = 2;

type ServerCtx = QueryCtx | MutationCtx;

async function requireUserId(ctx: ServerCtx) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) throw new ConvexError("not_authenticated");
	return identity.subject;
}

async function requireSpaceMember(ctx: ServerCtx, spaceId: Id<"sharedSpaces">) {
	const userId = await requireUserId(ctx);
	const member = await ctx.db
		.query("sharedSpaceMembers")
		.withIndex("by_space_user", (q) =>
			q.eq("spaceId", spaceId).eq("userId", userId),
		)
		.unique();

	if (!member) throw new ConvexError("not_space_member");
	return { userId, member };
}

export const list = query({
	args: {},
	handler: async (ctx) => {
		const userId = await requireUserId(ctx);
		const memberships = await ctx.db
			.query("sharedSpaceMembers")
			.filter((q) => q.eq(q.field("userId"), userId))
			.collect();

		return Promise.all(
			memberships.map(async (membership) => ({
				membership,
				space: await ctx.db.get(membership.spaceId),
			})),
		);
	},
});

export const create = mutation({
	args: { name: v.string() },
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		const existingOwnedSpaces = await ctx.db
			.query("sharedSpaces")
			.withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
			.collect();

		if (existingOwnedSpaces.length >= freeSharedSpaceLimit) {
			throw new ConvexError("shared_space_limit_reached");
		}

		const now = Date.now();
		const spaceId = await ctx.db.insert("sharedSpaces", {
			name: args.name.trim() || "Untitled",
			ownerUserId: userId,
			createdAt: now,
			updatedAt: now,
		});
		await ctx.db.insert("sharedSpaceMembers", {
			spaceId,
			userId,
			role: "owner",
			createdAt: now,
		});

		return { spaceId };
	},
});

export const listNotes = query({
	args: { spaceId: v.id("sharedSpaces") },
	handler: async (ctx, args) => {
		await requireSpaceMember(ctx, args.spaceId);
		return ctx.db
			.query("sharedNotes")
			.withIndex("by_space", (q) => q.eq("spaceId", args.spaceId))
			.collect();
	},
});

export const upsertNote = mutation({
	args: {
		spaceId: v.id("sharedSpaces"),
		noteId: v.string(),
		path: v.string(),
		title: v.string(),
	},
	handler: async (ctx, args) => {
		await requireSpaceMember(ctx, args.spaceId);
		const existing = await ctx.db
			.query("sharedNotes")
			.withIndex("by_space_note", (q) =>
				q.eq("spaceId", args.spaceId).eq("noteId", args.noteId),
			)
			.unique();
		const now = Date.now();

		if (existing) {
			await ctx.db.patch(existing._id, {
				path: args.path,
				title: args.title,
				updatedAt: now,
			});
			return { noteRowId: existing._id };
		}

		const noteRowId = await ctx.db.insert("sharedNotes", {
			spaceId: args.spaceId,
			noteId: args.noteId,
			path: args.path,
			title: args.title,
			createdAt: now,
			updatedAt: now,
		});
		return { noteRowId };
	},
});

export const listUpdates = query({
	args: { spaceId: v.id("sharedSpaces"), noteId: v.string() },
	handler: async (ctx, args) => {
		await requireSpaceMember(ctx, args.spaceId);
		return ctx.db
			.query("sharedNoteUpdates")
			.withIndex("by_note", (q) =>
				q.eq("spaceId", args.spaceId).eq("noteId", args.noteId),
			)
			.collect();
	},
});

export const appendUpdate = mutation({
	args: {
		spaceId: v.id("sharedSpaces"),
		noteId: v.string(),
		updateId: v.string(),
		deviceId: v.string(),
		data: v.bytes(),
	},
	handler: async (ctx, args) => {
		await requireSpaceMember(ctx, args.spaceId);
		const existing = await ctx.db
			.query("sharedNoteUpdates")
			.withIndex("by_note_update", (q) =>
				q
					.eq("spaceId", args.spaceId)
					.eq("noteId", args.noteId)
					.eq("updateId", args.updateId),
			)
			.unique();

		if (existing) return { updateRowId: existing._id };

		const updateRowId = await ctx.db.insert("sharedNoteUpdates", {
			...args,
			createdAt: Date.now(),
		});
		return { updateRowId };
	},
});

export const writeSnapshot = mutation({
	args: {
		spaceId: v.id("sharedSpaces"),
		noteId: v.string(),
		data: v.bytes(),
		stateVector: v.bytes(),
	},
	handler: async (ctx, args) => {
		await requireSpaceMember(ctx, args.spaceId);
		const existing = await ctx.db
			.query("sharedNoteSnapshots")
			.withIndex("by_note", (q) =>
				q.eq("spaceId", args.spaceId).eq("noteId", args.noteId),
			)
			.unique();
		const patch = {
			data: args.data,
			stateVector: args.stateVector,
			updatedAt: Date.now(),
		};

		if (existing) {
			await ctx.db.patch(existing._id, patch);
			return { snapshotRowId: existing._id };
		}

		const snapshotRowId = await ctx.db.insert("sharedNoteSnapshots", {
			spaceId: args.spaceId,
			noteId: args.noteId,
			...patch,
		});
		return { snapshotRowId };
	},
});
