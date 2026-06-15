import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { type CommandId, commandById } from "@/lib/commands";
import {
	normalizeShortcutString,
	resolveShortcut,
	type ShortcutOverrides,
} from "@/lib/shortcuts";

const storageKey = "paperite:shortcut-overrides";
const changedEvent = "paperite:shortcut-overrides-changed";

type KeyboardShortcutsContextValue = {
	shortcutOverrides: ShortcutOverrides;
	getShortcut: (commandId: CommandId) => string | null;
	setShortcutOverride: (commandId: CommandId, shortcut: string | null) => void;
	resetShortcut: (commandId: CommandId) => void;
	resetAllShortcuts: () => void;
};

const KeyboardShortcutsContext =
	createContext<KeyboardShortcutsContextValue | null>(null);

export function KeyboardShortcutsProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [shortcutOverrides, setShortcutOverrides] =
		useState<ShortcutOverrides>(readOverrides);

	const saveOverrides = useCallback((nextOverrides: ShortcutOverrides) => {
		localStorage.setItem(storageKey, JSON.stringify(nextOverrides));
		window.dispatchEvent(new Event(changedEvent));
		return nextOverrides;
	}, []);

	useEffect(() => {
		const syncOverrides = () => setShortcutOverrides(readOverrides());
		window.addEventListener(changedEvent, syncOverrides);
		window.addEventListener("storage", syncOverrides);
		return () => {
			window.removeEventListener(changedEvent, syncOverrides);
			window.removeEventListener("storage", syncOverrides);
		};
	}, []);

	const value = useMemo<KeyboardShortcutsContextValue>(
		() => ({
			shortcutOverrides,
			getShortcut: (commandId) => {
				const command = commandById.get(commandId);
				return command ? resolveShortcut(command, shortcutOverrides) : null;
			},
			setShortcutOverride: (commandId, shortcut) => {
				const command = commandById.get(commandId);
				if (!command) return;

				const normalized = normalizeShortcutString(shortcut);
				const nextShortcut = shortcut === null ? null : normalized;
				setShortcutOverrides((currentOverrides) => {
					const nextOverrides = { ...currentOverrides };

					if (nextShortcut === command.defaultShortcut) {
						delete nextOverrides[commandId];
					} else {
						nextOverrides[commandId] = nextShortcut;
					}

					return saveOverrides(nextOverrides);
				});
			},
			resetShortcut: (commandId) => {
				setShortcutOverrides((currentOverrides) => {
					const nextOverrides = { ...currentOverrides };
					delete nextOverrides[commandId];
					return saveOverrides(nextOverrides);
				});
			},
			resetAllShortcuts: () => setShortcutOverrides(saveOverrides({})),
		}),
		[saveOverrides, shortcutOverrides],
	);

	return (
		<KeyboardShortcutsContext.Provider value={value}>
			{children}
		</KeyboardShortcutsContext.Provider>
	);
}

export function useKeyboardShortcuts() {
	const context = useContext(KeyboardShortcutsContext);
	if (!context) {
		throw new Error(
			"useKeyboardShortcuts must be used within KeyboardShortcutsProvider",
		);
	}

	return context;
}

function readOverrides(): ShortcutOverrides {
	try {
		const raw = localStorage.getItem(storageKey);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return {};

		return Object.fromEntries(
			Object.entries(parsed).filter(
				([commandId, shortcut]) =>
					commandById.has(commandId as CommandId) &&
					(shortcut === null || typeof shortcut === "string"),
			),
		) as ShortcutOverrides;
	} catch {
		return {};
	}
}
