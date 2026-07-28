import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Contract tests for the on-disk note layout Paperite uses.
 * main.js I/O is entangled with Electron ipcMain — testing the directory/
 * note.json/assets convention here avoids a main.js restructure.
 */

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "paperite-notes-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function noteDir(space: string, name: string) {
	return join(root, space, name);
}

function writeNote(space: string, name: string, content: object) {
	const dir = noteDir(space, name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "note.json"), JSON.stringify(content, null, 2));
	return dir;
}

test("write then read note.json round-trips content", () => {
	const body = {
		type: "doc",
		content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
	};
	const dir = writeNote("Inbox", "My Note", body);
	const loaded = JSON.parse(readFileSync(join(dir, "note.json"), "utf8"));
	expect(loaded).toEqual(body);
});

test("assets folder can store an image next to note.json", () => {
	const dir = writeNote("Inbox", "With Image", {
		type: "doc",
		content: [],
	});
	const assets = join(dir, "assets");
	mkdirSync(assets, { recursive: true });
	const imagePath = join(assets, "shot.png");
	writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
	expect(existsSync(imagePath)).toBe(true);
	expect(existsSync(join(dir, "note.json"))).toBe(true);
});

test("deleting a note directory removes note.json and assets", () => {
	const dir = writeNote("Inbox", "Temp", { type: "doc", content: [] });
	const assets = join(dir, "assets");
	mkdirSync(assets, { recursive: true });
	writeFileSync(join(assets, "a.png"), "x");
	rmSync(dir, { recursive: true, force: true });
	expect(existsSync(dir)).toBe(false);
});

test("rename is move of the whole note directory", () => {
	const from = writeNote("Inbox", "Old Name", {
		type: "doc",
		content: [{ type: "paragraph", content: [{ type: "text", text: "keep" }] }],
	});
	const to = noteDir("Inbox", "New Name");
	const { renameSync } = require("node:fs") as typeof import("node:fs");
	renameSync(from, to);
	expect(existsSync(from)).toBe(false);
	expect(existsSync(join(to, "note.json"))).toBe(true);
	const loaded = JSON.parse(readFileSync(join(to, "note.json"), "utf8"));
	expect(loaded.content[0].content[0].text).toBe("keep");
});
