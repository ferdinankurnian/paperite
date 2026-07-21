const express = require("express");
const fs = require("node:fs/promises");
const {
	ensureWorkspace,
	statePath,
	writeFileAtomic,
} = require("../lib/workspace");

const router = express.Router();

router.get("/state", async (_req, res) => {
	try {
		await ensureWorkspace();
		try {
			const data = JSON.parse(await fs.readFile(statePath(), "utf8"));
			res.json(data);
		} catch {
			res.json({});
		}
	} catch (error) {
		console.error("[paperite] read-state error:", error);
		res.status(500).json({ error: error.message });
	}
});

router.put("/state", async (req, res) => {
	try {
		await ensureWorkspace();
		await writeFileAtomic(statePath(), JSON.stringify(req.body, null, 2));
		res.json({ ok: true });
	} catch (error) {
		console.error("[paperite] write-state error:", error);
		res.status(500).json({ error: error.message });
	}
});

module.exports = router;
