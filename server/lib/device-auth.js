const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

let keytar;
try {
	keytar = require("keytar");
} catch {
	keytar = null;
}

const SERVICE = "dev.iydheko.paperite";
const ACCOUNT = "device-auth-binding:v1";
const FILE_VERSION = 1;
let mutation = Promise.resolve();

const fileRoot = () => {
	if (process.platform === "win32") {
		return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
	}
	if (process.platform === "darwin") {
		return path.join(os.homedir(), "Library", "Application Support");
	}
	return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
};

const filePath = () => path.join(fileRoot(), "Paperite", "device-auth.json");
const unavailable = () => ({
	status: "keychain-unavailable",
	storage: "keychain",
});

async function readFileRecord() {
	try {
		return JSON.parse(await fs.readFile(filePath(), "utf8"));
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		throw error;
	}
}

async function writeFileRecord(record) {
	const target = filePath();
	await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
	await fs.writeFile(target, `${JSON.stringify(record)}\n`, { mode: 0o600 });
	try {
		await fs.chmod(target, 0o600);
	} catch {
		// Windows does not use Unix file modes.
	}
}

async function fileStorageEnabled() {
	const value = await readFileRecord();
	return value?.version === FILE_VERSION && value?.storage === "file";
}

function parse(raw) {
	if (!raw) return { status: "unbound" };
	try {
		const value = JSON.parse(raw);
		if (
			value?.version !== 1 ||
			typeof value.deviceId !== "string" ||
			!value.deviceId ||
			typeof value.userId !== "string" ||
			!value.userId ||
			typeof value.secret !== "string" ||
			value.secret.length < 32 ||
			!Number.isFinite(value.createdAt)
		) {
			return { status: "invalid-record" };
		}
		return { status: "bound", userId: value.userId, deviceId: value.deviceId };
	} catch {
		return { status: "invalid-record" };
	}
}

async function readRaw() {
	if (!keytar) return null;
	return keytar.getPassword(SERVICE, ACCOUNT);
}

async function status() {
	if (keytar) {
		try {
			const result = parse(await readRaw());
			return result.status === "unbound"
				? { status: "unbound", storage: "keychain" }
				: { ...result, storage: "keychain" };
		} catch {
			// Fall through to the explicitly opted-in file backend.
		}
	}
	try {
		if (await fileStorageEnabled()) {
			const value = await readFileRecord();
			return value?.bound
				? { ...parse(JSON.stringify(value)), storage: "file" }
				: { status: "unbound", storage: "file" };
		}
	} catch {
		// Fall through to the explicit keychain-unavailable state.
	}
	return unavailable();
}

async function enableFileStorage() {
	const operation = mutation.then(async () => {
		try {
			const existing = await readFileRecord();
			if (existing?.bound)
				return {
					status: "bound",
					storage: "file",
					userId: existing.userId,
					deviceId: existing.deviceId,
				};
			await writeFileRecord({
				version: FILE_VERSION,
				storage: "file",
				bound: false,
				enabledAt: Date.now(),
			});
			return { status: "unbound", storage: "file" };
		} catch {
			return { status: "file-storage-unavailable" };
		}
	});
	mutation = operation.catch(() => undefined);
	return operation;
}

async function claim(userId) {
	if (typeof userId !== "string" || !userId.trim()) {
		return { status: "invalid-user" };
	}
	const operation = mutation.then(async () => {
		const current = await status();
		if (
			current.status === "keychain-unavailable" ||
			current.status === "file-storage-unavailable"
		)
			return current;
		try {
			if (current.status === "bound") {
				return current.userId === userId
					? current
					: { status: "account-mismatch", userId: current.userId };
			}
			if (current.status === "invalid-record") return current;
			const record = {
				version: 1,
				deviceId: crypto.randomUUID(),
				userId,
				secret: crypto.randomBytes(32).toString("hex"),
				createdAt: Date.now(),
				storage: current.storage === "file" ? "file" : "keychain",
			};
			if (current.storage === "file")
				await writeFileRecord({ ...record, bound: true });
			else await keytar.setPassword(SERVICE, ACCOUNT, JSON.stringify(record));
			return {
				status: "claimed",
				userId: record.userId,
				deviceId: record.deviceId,
				storage: record.storage,
			};
		} catch {
			return unavailable();
		}
	});
	mutation = operation.catch(() => undefined);
	return operation;
}

async function clear() {
	const operation = mutation.then(async () => {
		try {
			const current = await status();
			if (current.status === "keychain-unavailable") return current;
			if (current.storage === "file") {
				await fs.unlink(filePath()).catch(() => undefined);
				return { status: "unbound", storage: "file" };
			}
			await keytar.deletePassword(SERVICE, ACCOUNT);
			return { status: "unbound", storage: "keychain" };
		} catch {
			return keytar ? unavailable() : { status: "file-storage-unavailable" };
		}
	});
	mutation = operation.catch(() => undefined);
	return operation;
}

module.exports = {
	status,
	claim,
	clear,
	enableFileStorage,
	parse,
	filePath,
	SERVICE,
	ACCOUNT,
};
