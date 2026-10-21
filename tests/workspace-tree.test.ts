import { expect, test } from "bun:test";
import type { WorkspaceSnapshot } from "../src/lib/storage/types";
import {
	areWorkspaceSpaceHeadersEqual,
	areWorkspaceSpacesEqual,
	diffWorkspaceNotes,
	isWorkspaceContentEqual,
	updateWorkspaceNote,
} from "../src/lib/workspace-tree";

const snapshot = (): WorkspaceSnapshot => ({
	rootPath: "/ws",
	spaces: [
		{
			title: "Inbox",
			path: "Inbox",
			children: [
				{
					type: "note",
					title: "catatan",
					path: "Inbox/catatan",
					preview: "halo",
					updatedAt: 1000,
					pinned: false,
				},
				{
					type: "folder",
					title: "f",
					path: "Inbox/f",
					children: [
						{
							type: "note",
							title: "dalam",
							path: "Inbox/f/dalam",
							preview: "x",
							updatedAt: 1000,
							pinned: false,
						},
					],
				},
			],
		},
	],
});

test("own autosave (updatedAt-only change) compares equal → sync skipped", () => {
	const before = snapshot();
	// updateWorkspaceNote is what the autosave preview patch does.
	const after = updateWorkspaceNote(before, "Inbox/catatan", {
		preview: "halo",
		updatedAt: 9999,
	});
	expect(isWorkspaceContentEqual(before, after)).toBe(true);
});

test("external rename / new note / preview change compares different", () => {
	const base = snapshot();

	const renamed = snapshot();
	renamed.spaces[0].children[0] = {
		...(renamed.spaces[0].children[0] as {
			type: "note";
			title: string;
			path: string;
			preview: string;
			updatedAt: number;
			pinned: boolean;
		}),
		title: "catatan baru",
	};
	expect(isWorkspaceContentEqual(base, renamed)).toBe(false);

	const added = snapshot();
	added.spaces[0].children.push({
		type: "note",
		title: "baru",
		path: "Inbox/baru",
		preview: "",
		updatedAt: 1,
		pinned: false,
	});
	expect(isWorkspaceContentEqual(base, added)).toBe(false);

	const previewChanged = snapshot();
	previewChanged.spaces[0].children[0] = {
		...(previewChanged.spaces[0].children[0] as {
			type: "note";
			title: string;
			path: string;
			preview: string;
			updatedAt: number;
			pinned: boolean;
		}),
		preview: "halo dunia",
	};
	expect(isWorkspaceContentEqual(base, previewChanged)).toBe(false);
});

test("null / identity cases", () => {
	const base = snapshot();
	expect(isWorkspaceContentEqual(base, base)).toBe(true);
	expect(isWorkspaceContentEqual(null, base)).toBe(false);
	expect(isWorkspaceContentEqual(base, null)).toBe(false);
	expect(isWorkspaceContentEqual(null, null)).toBe(true);
});

test("areWorkspaceSpacesEqual ignores updatedAt-only patches", () => {
	const before = snapshot().spaces;
	const after = updateWorkspaceNote(snapshot(), "Inbox/catatan", {
		preview: "halo",
		updatedAt: 9999,
	}).spaces;
	// Different array identity (fresh patch), same content.
	expect(after).not.toBe(before);
	expect(areWorkspaceSpacesEqual(before, after)).toBe(true);

	const renamed = snapshot().spaces;
	renamed[0] = { ...renamed[0], title: "Kotak" };
	expect(areWorkspaceSpacesEqual(before, renamed)).toBe(false);
});

test("updateWorkspaceNote preserves identity of untouched spaces/notes", () => {
	const before = snapshot();
	// Add a second space so we can prove it keeps its identity.
	const multi: WorkspaceSnapshot = {
		...before,
		spaces: [
			...before.spaces,
			{
				title: "Lain",
				path: "Lain",
				children: [
					{
						type: "note",
						title: "lain",
						path: "Lain/lain",
						preview: "z",
						updatedAt: 1000,
						pinned: false,
					},
				],
			},
		],
	};
	const after = updateWorkspaceNote(multi, "Inbox/catatan", {
		preview: "halo dunia",
		updatedAt: 9999,
	});
	// Untouched space keeps its object identity (rail/list memos bail out).
	expect(after.spaces[1]).toBe(multi.spaces[1]);
	// Untouched note inside the touched space keeps its identity too.
	expect(after.spaces[0].children[1]).toBe(multi.spaces[0].children[1]);
	// The edited note is a fresh object with the patch applied.
	const edited = after.spaces[0].children[0];
	expect(edited).not.toBe(multi.spaces[0].children[0]);
	expect(edited).toMatchObject({ preview: "halo dunia", updatedAt: 9999 });
});

test("updateWorkspaceNote returns same ref when path is missing", () => {
	const before = snapshot();
	expect(
		updateWorkspaceNote(before, "Inbox/tidak-ada", {
			preview: "x",
			updatedAt: 2,
		}),
	).toBe(before);
});

test("diffWorkspaceNotes separates preview-only diffs from structural ones", () => {
	const base = snapshot();

	const identical = snapshot();
	expect(diffWorkspaceNotes(base, identical)).toEqual({
		structural: false,
		changedNotePaths: [],
	});

	const previewOnly = snapshot();
	previewOnly.spaces[0].children[0] = {
		...(previewOnly.spaces[0].children[0] as {
			type: "note";
			title: string;
			path: string;
			preview: string;
			updatedAt: number;
			pinned: boolean;
		}),
		preview: "halo dunia",
		updatedAt: 5555,
	};
	// updatedAt is ignored, preview lands in changedNotePaths, not structural.
	expect(diffWorkspaceNotes(base, previewOnly)).toEqual({
		structural: false,
		changedNotePaths: ["Inbox/catatan"],
	});

	const renamed = snapshot();
	renamed.spaces[0].children[0] = {
		...(renamed.spaces[0].children[0] as {
			type: "note";
			title: string;
			path: string;
			preview: string;
			updatedAt: number;
			pinned: boolean;
		}),
		title: "catatan baru",
	};
	expect(diffWorkspaceNotes(base, renamed).structural).toBe(true);

	const added = snapshot();
	added.spaces[0].children.push({
		type: "note",
		title: "baru",
		path: "Inbox/baru",
		preview: "",
		updatedAt: 1,
		pinned: false,
	});
	expect(diffWorkspaceNotes(base, added).structural).toBe(true);
});

test("areWorkspaceSpaceHeadersEqual ignores preview/pin patches", () => {
	const before = snapshot().spaces;
	const patched = updateWorkspaceNote(snapshot(), "Inbox/f/dalam", {
		preview: "baru banget",
		updatedAt: 9999,
	}).spaces;
	expect(patched).not.toBe(before);
	expect(areWorkspaceSpaceHeadersEqual(before, patched)).toBe(true);

	const renamed = snapshot().spaces;
	renamed[0] = { ...renamed[0], title: "Kotak" };
	expect(areWorkspaceSpaceHeadersEqual(before, renamed)).toBe(false);
});
