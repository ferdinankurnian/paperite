#!/usr/bin/env node
/**
 * One-shot patch: allow TipTap to render images from assets/ via file://
 * Run from repo root: node scripts/apply-image-fix.js
 */
const fs = require("node:fs");
const path = require("node:path");

const file = path.join(__dirname, "..", "main.js");
let src = fs.readFileSync(file, "utf8");
let changed = 0;

// 1. import pathToFileURL
if (!src.includes("pathToFileURL")) {
	src = src.replace(
		'const path = require("node:path");',
		'const path = require("node:path");\nconst { pathToFileURL } = require("node:url");',
	);
	changed += 1;
	console.log("✓ added pathToFileURL import");
} else {
	console.log("· pathToFileURL already present");
}

// 2. webSecurity: false in createWindowOptions
if (!src.includes("webSecurity: false")) {
	const before = src;
	src = src.replace(
		/webPreferences:\s*\{\s*\n(\s*)preload:/,
		(match, indent) =>
			`webPreferences: {\n${indent}preload:`.replace(
				"preload:",
				`webSecurity: false,\n${indent}preload:`,
			),
	);
	if (src === before) {
		// fallback: simpler string match
		src = src.replace(
			`webPreferences: {\n\t\tpreload: require("node:path").join(__dirname, "preload.js"),\n\t\tadditionalArguments: [`,
			`webPreferences: {\n\t\tpreload: require("node:path").join(__dirname, "preload.js"),\n\t\twebSecurity: false,\n\t\tadditionalArguments: [`,
		);
	}
	if (src.includes("webSecurity: false")) {
		changed += 1;
		console.log("✓ added webSecurity: false");
	} else {
		console.error("✗ failed to add webSecurity: false — edit main.js manually");
		process.exit(1);
	}
} else {
	console.log("· webSecurity: false already present");
}

// 3. use pathToFileURL in notes:get-asset-url
if (src.includes("`file://${absolutePath}`")) {
	src = src.replace(
		"return `file://${absolutePath}`;",
		"return pathToFileURL(absolutePath).href;",
	);
	changed += 1;
	console.log("✓ get-asset-url uses pathToFileURL");
} else if (src.includes("pathToFileURL(absolutePath).href")) {
	console.log("· get-asset-url already uses pathToFileURL");
} else {
	console.error("✗ could not find get-asset-url return — edit main.js manually");
	process.exit(1);
}

fs.writeFileSync(file, src);
console.log(changed ? `\nDone. ${changed} change(s). Restart Electron.` : "\nAlready patched.");
