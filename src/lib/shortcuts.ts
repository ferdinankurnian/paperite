import type { CommandDefinition, CommandId } from "@/lib/commands";

export type ShortcutOverrides = Partial<Record<CommandId, string | null>>;

const modifierOrder = ["Mod", "Ctrl", "Alt", "Shift"];

export function normalizeShortcut(event: KeyboardEvent): string | null {
	const key = normalizeKey(event.key);
	if (!key) return null;

	const modifiers = [];
	if (event.ctrlKey || event.metaKey) modifiers.push("Mod");
	if (event.altKey) modifiers.push("Alt");
	if (event.shiftKey) modifiers.push("Shift");

	return [...sortModifiers(modifiers), key].join("+");
}

export function normalizeShortcutString(
	shortcut: string | null,
): string | null {
	if (!shortcut) return null;
	const parts = shortcut.split("+").filter(Boolean);
	const key = parts.at(-1);
	if (!key) return null;

	const modifiers = parts.slice(0, -1).map(normalizeModifier).filter(Boolean);
	const normalizedKey = normalizeKey(key);
	if (!normalizedKey) return null;

	return [...sortModifiers(modifiers), normalizedKey].join("+");
}

export function formatShortcut(shortcut: string | null): string {
	if (!shortcut) return "Disabled";
	return shortcut
		.split("+")
		.map((part) => (part === "Mod" ? "Ctrl" : part))
		.join("+");
}

export function shortcutMatchesEvent(
	shortcut: string | null,
	event: KeyboardEvent,
): boolean {
	return normalizeShortcutString(shortcut) === normalizeShortcut(event);
}

export function isShortcutEditableInput(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	return Boolean(
		target.closest("input, textarea, select, [contenteditable='true']"),
	);
}

export function resolveShortcut(
	command: CommandDefinition,
	overrides: ShortcutOverrides,
): string | null {
	return Object.hasOwn(overrides, command.id)
		? (overrides[command.id] ?? null)
		: command.defaultShortcut;
}

export function findShortcutConflict(
	commandId: CommandId,
	nextShortcut: string | null,
	commands: CommandDefinition[],
	overrides: ShortcutOverrides,
): CommandDefinition | null {
	const normalized = normalizeShortcutString(nextShortcut);
	if (!normalized) return null;

	return (
		commands.find((command) => {
			if (command.id === commandId) return false;
			return (
				normalizeShortcutString(resolveShortcut(command, overrides)) ===
				normalized
			);
		}) ?? null
	);
}

function normalizeModifier(part: string) {
	const normalized = part.toLowerCase();
	if (normalized === "mod" || normalized === "cmd" || normalized === "meta") {
		return "Mod";
	}
	if (normalized === "ctrl" || normalized === "control") return "Ctrl";
	if (normalized === "alt" || normalized === "option") return "Alt";
	if (normalized === "shift") return "Shift";
	return null;
}

function sortModifiers(modifiers: Array<string | null>) {
	return [...new Set(modifiers.filter(Boolean) as string[])].sort(
		(first, second) =>
			modifierOrder.indexOf(first) - modifierOrder.indexOf(second),
	);
}

function normalizeKey(key: string): string | null {
	if (!key) return null;
	const lowered = key.toLowerCase();
	if (["control", "ctrl", "meta", "shift", "alt", "option"].includes(lowered)) {
		return null;
	}
	if (key === " ") return "Space";
	if (key.length === 1) return key.toUpperCase();
	return key;
}
