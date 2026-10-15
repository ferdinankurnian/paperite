// Writes dist*/.paperite-build.json so `paperite serve` can tell a
// PAPERITE_WEB=1 build (dist-web/) from the Electron build (dist/).
// Usage: node scripts/stamp-build.js <dir> <web|electron>
const fs = require("node:fs");
const path = require("node:path");

const dir = process.argv[2];
const mode = process.argv[3] || "web";
if (!dir) {
	console.error("usage: stamp-build.js <dir> <web|electron>");
	process.exit(1);
}

const root = path.resolve(__dirname, "..");
const outDir = path.resolve(root, dir);
let version = "0.0.0";
try {
	version = require(path.join(root, "package.json")).version ?? version;
} catch {
	// keep default
}

const stamp = {
	mode,
	version,
	builtAt: new Date().toISOString(),
	paperiteWeb: mode === "web",
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
	path.join(outDir, ".paperite-build.json"),
	`${JSON.stringify(stamp, null, 2)}\n`,
);
console.log(`[paperite] stamped ${dir} as ${mode}`);
