#!/usr/bin/env node
/** Apply orphan asset prune: IPC + tab-close + note-open hooks */
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function patch(fileRel, transform) {
	const file = path.join(root, fileRel);
	const before = fs.readFileSync(file, "utf8");
	const after = transform(before);
	if (after === before) {
		console.log("· no change: " + fileRel);
		return false;
	}
	fs.writeFileSync(file, after);
	console.log("✓ patched: " + fileRel);
	return true;
}

const MAIN_HELPERS = [
	"",
	"const collectReferencedAssetPaths = (node, out = new Set()) => {",
	"\tif (node?.type === \"image\" && typeof node.attrs?.src === \"string\") {",
	"\t\tconst srcPath = node.attrs.src;",
	"\t\tif (",
	"\t\t\tsrcPath.startsWith(noteAssetsDirectoryName + \"/\") ||",
	"\t\t\tsrcPath.startsWith(\"assets/\")",
	"\t\t) {",
	"\t\t\tout.add(srcPath.replace(/^\\/+/, \"\"));",
	"\t\t} else if (srcPath.startsWith(\"file://\")) {",
	"\t\t\tconst assetsIdx = srcPath.indexOf(\"/assets/\");",
	"\t\t\tif (assetsIdx !== -1) out.add(srcPath.slice(assetsIdx + 1));",
	"\t\t}",
	"\t}",
	"\tfor (const child of node?.content ?? []) collectReferencedAssetPaths(child, out);",
	"\treturn out;",
	"};",
	"",
	"const pruneNoteAssets = async (notePath) => {",
	"\tconst normalizedPath = currentNotePath(notePath);",
	"\tif (popoutWindows.has(normalizedPath)) {",
	"\t\treturn { ok: true, deleted: 0, skipped: \"popout-open\" };",
	"\t}",
	"",
	"\tconst assetDir = resolveWorkspacePath(noteAssetsPath(normalizedPath));",
	"\tlet entries;",
	"\ttry {",
	"\t\tentries = await fs.readdir(assetDir, { withFileTypes: true });",
	"\t} catch (error) {",
	"\t\tif (error?.code === \"ENOENT\") return { ok: true, deleted: 0 };",
	"\t\tthrow error;",
	"\t}",
	"",
	"\tlet content;",
	"\ttry {",
	"\t\tcontent = await readNoteContent(normalizedPath);",
	"\t} catch (error) {",
	"\t\tif (error?.code === \"ENOENT\") return { ok: true, deleted: 0 };",
	"\t\tthrow error;",
	"\t}",
	"",
	"\tconst referenced = collectReferencedAssetPaths(content);",
	"\tlet deleted = 0;",
	"",
	"\tfor (const entry of entries) {",
	"\t\tif (!entry.isFile() || entry.name.startsWith(\".\")) continue;",
	"\t\tconst relative = noteAssetsDirectoryName + \"/\" + entry.name;",
	"\t\tif (referenced.has(relative)) continue;",
	"\t\tawait fs.rm(path.join(assetDir, entry.name), { force: true }).catch(() => undefined);",
	"\t\tdeleted += 1;",
	"\t}",
	"",
	"\treturn { ok: true, deleted };",
	"};",
	"",
].join("\n");

const PRUNE_IPC = [
	"",
	"ipcMain.handle(\"notes:prune-assets\", async (_event, notePath) => {",
	"\tawait ensureWorkspace();",
	"\treturn pruneNoteAssets(notePath);",
	"});",
	"",
].join("\n");

// --- main.js ---
patch("main.js", (src) => {
	if (src.includes("notes:prune-assets")) return src;

	const saveAnchor = "ipcMain.handle(\n\t\"notes:save-image\",";
	if (!src.includes(saveAnchor)) throw new Error("save-image anchor missing");
	src = src.replace(saveAnchor, MAIN_HELPERS + saveAnchor);

	const getAssetEnd = [
		"\t\treturn pathToFileURL(absolutePath).href;",
		"\t},",
		");",
	].join("\n");
	const getAssetEndAlt = [
		"\t\treturn `file://${absolutePath}`;",
		"\t},",
		");",
	].join("\n");

	if (src.includes(getAssetEnd)) {
		src = src.replace(getAssetEnd, getAssetEnd + PRUNE_IPC);
	} else if (src.includes(getAssetEndAlt)) {
		src = src.replace(getAssetEndAlt, getAssetEndAlt + PRUNE_IPC);
	} else {
		throw new Error("get-asset-url end not found");
	}

	return src;
});

// --- preload.js ---
patch("preload.js", (src) => {
	if (src.includes("pruneAssets")) return src;
	const needle =
		"getAssetUrl: (notePath, assetPath) =>\n\t\t\tipcRenderer.invoke(\"notes:get-asset-url\", notePath, assetPath),";
	const insert =
		needle +
		"\n\t\tpruneAssets: (notePath) =>\n\t\t\tipcRenderer.invoke(\"notes:prune-assets\", notePath),";
	if (!src.includes(needle)) throw new Error("preload getAssetUrl missing");
	return src.replace(needle, insert);
});

// --- vite-env.d.ts ---
patch("src/vite-env.d.ts", (src) => {
	if (src.includes("pruneAssets")) return src;
	const needle =
		"getAssetUrl: (notePath: string, assetPath: string) => Promise<string>;";
	const insert =
		needle +
		"\n\t\t\t\tpruneAssets: (\n\t\t\t\t\tnotePath: string,\n\t\t\t\t) => Promise<{ ok: true; deleted: number; skipped?: string }>;";
	if (!src.includes(needle)) throw new Error("vite-env getAssetUrl missing");
	return src.replace(needle, insert);
});

// --- storage types ---
patch("src/lib/storage/types.ts", (src) => {
	if (src.includes("pruneAssets")) return src;
	const needle =
		"writeNote(path: string, content: NoteContent): Promise<{ ok: true }>;";
	const insert =
		needle +
		"\n\tpruneAssets?(path: string): Promise<{ ok: true; deleted: number; skipped?: string }>;";
	if (!src.includes(needle)) throw new Error("types writeNote missing");
	return src.replace(needle, insert);
});

// --- electron-storage ---
patch("src/lib/storage/electron-storage.ts", (src) => {
	if (src.includes("pruneAssets")) return src;
	const needle = [
		"async writeNote(path: string, content: NoteContent): Promise<{ ok: true }> {",
		"\t\treturn requireElectron().notes.writeNote(path, content);",
		"\t}",
	].join("\n");
	const insert =
		needle +
		"\n\n\tasync pruneAssets(path: string): Promise<{ ok: true; deleted: number; skipped?: string }> {\n\t\treturn requireElectron().notes.pruneAssets(path);\n\t}";
	if (!src.includes(needle)) throw new Error("electron-storage writeNote missing");
	return src.replace(needle, insert);
});

// --- web-storage noop ---
patch("src/lib/storage/web-storage.ts", (src) => {
	if (src.includes("pruneAssets")) return src;
	const needle =
		"async writeNote(path: string, content: NoteContent): Promise<{ ok: true }> {";
	const insert =
		"async pruneAssets(_path: string): Promise<{ ok: true; deleted: number; skipped?: string }> {\n\t\treturn { ok: true, deleted: 0 };\n\t}\n\n\t" +
		needle;
	if (!src.includes(needle)) throw new Error("web-storage writeNote missing");
	return src.replace(needle, insert);
});

// --- index.tsx ---
patch("src/routes/_main/index.tsx", (src) => {
	if (src.includes("pruneAssets")) return src;

	const closeOld = [
		"\t\t\tconst openPaths = new Set(",
		"\t\t\t\tuseAppStore.getState().openTabs.map((tab) => tab.path),",
		"\t\t\t);",
		"\t\t\topenPaths.delete(path);",
		"\t\t\tpruneWarmCaches(openPaths);",
		"\t\t},",
		"\t\t[pruneWarmCaches, touchWarm],",
		"\t);",
	].join("\n");

	const closeNew = [
		"\t\t\tconst openPaths = new Set(",
		"\t\t\t\tuseAppStore.getState().openTabs.map((tab) => tab.path),",
		"\t\t\t);",
		"\t\t\topenPaths.delete(path);",
		"\t\t\tpruneWarmCaches(openPaths);",
		"\t\t\t// Drop orphan assets once the tab session ends (undo stack is gone).",
		"\t\t\tvoid notesApi?.pruneAssets?.(path).catch(() => undefined);",
		"\t\t},",
		"\t\t[notesApi, pruneWarmCaches, touchWarm],",
		"\t);",
	].join("\n");

	if (!src.includes(closeOld)) throw new Error("closeTab anchor missing");
	src = src.replace(closeOld, closeNew);

	const loadMarker =
		"markEditorReady(notePath);\n\n\t\t\tif (readDuration > 16) {";
	if (!src.includes(loadMarker)) throw new Error("loadNote anchor missing");
	src = src.replace(
		loadMarker,
		[
			"markEditorReady(notePath);",
			"\t\t\t// Safety net: drop assets not referenced on disk (crash / force-quit orphans).",
			"\t\t\tvoid notesApi.pruneAssets?.(notePath).catch(() => undefined);",
			"",
			"\t\t\tif (readDuration > 16) {",
		].join("\n"),
	);

	return src;
});

console.log("\nDone. Restart Electron to pick up main/preload changes.");
