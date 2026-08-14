import { useEffect, useRef } from "react";
import { useKeyboardShortcuts } from "@/components/keyboard-shortcuts-provider";
import { isShortcutEditableInput, shortcutMatchesEvent } from "@/lib/shortcuts";

type Options = {
	flushSaveAndSync: () => Promise<unknown>;
	createNote: () => void;
	createFolder: () => void;
	openSetup: () => void;
	openFind: () => void;
	openReplace: () => void;
	switchTab: (direction: 1 | -1) => void;
	closeTab: () => void;
	toggleZenMode: () => void;
	toggleSidebar: () => void;
};

export function useNoteKeyboard(options: Options) {
	const { getShortcut } = useKeyboardShortcuts();
	const optionsRef = useRef(options);
	optionsRef.current = options;

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.repeat) return;
			const current = optionsRef.current;
			const zen = getShortcut("view.toggleZen");
			const sidebar = getShortcut("view.toggleSidebar");
			const setup = getShortcut("note.setup");
			const save = getShortcut("note.saveAndSync");
			const globalView =
				shortcutMatchesEvent(zen, event) ||
				shortcutMatchesEvent(sidebar, event) ||
				shortcutMatchesEvent(setup, event);
			if (
				isShortcutEditableInput(event.target) &&
				!globalView &&
				!shortcutMatchesEvent(save, event)
			)
				return;
			if (shortcutMatchesEvent(save, event)) {
				event.preventDefault();
				void current.flushSaveAndSync();
				return;
			}
			if (shortcutMatchesEvent(getShortcut("note.create"), event)) {
				event.preventDefault();
				current.createNote();
				return;
			}
			if (shortcutMatchesEvent(getShortcut("folder.create"), event)) {
				event.preventDefault();
				current.createFolder();
				return;
			}
			if (shortcutMatchesEvent(setup, event)) {
				event.preventDefault();
				current.openSetup();
				return;
			}
			if (shortcutMatchesEvent(getShortcut("note.find"), event)) {
				event.preventDefault();
				current.openFind();
				return;
			}
			if (shortcutMatchesEvent(getShortcut("note.replace"), event)) {
				event.preventDefault();
				current.openReplace();
				return;
			}
			if (shortcutMatchesEvent(getShortcut("tab.next"), event)) {
				event.preventDefault();
				current.switchTab(1);
				return;
			}
			if (shortcutMatchesEvent(getShortcut("tab.previous"), event)) {
				event.preventDefault();
				current.switchTab(-1);
				return;
			}
			if (shortcutMatchesEvent(getShortcut("tab.close"), event)) {
				event.preventDefault();
				current.closeTab();
				return;
			}
			if (shortcutMatchesEvent(zen, event)) {
				event.preventDefault();
				current.toggleZenMode();
				return;
			}
			if (shortcutMatchesEvent(sidebar, event)) {
				event.preventDefault();
				current.toggleSidebar();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [getShortcut]);
}
