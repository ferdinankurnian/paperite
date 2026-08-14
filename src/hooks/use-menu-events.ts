import { useCallback, useEffect } from "react";
import type { WorkspaceSnapshot } from "@/lib/storage/types";
import type { NoteInfoTarget } from "@/lib/stores/editor-ui-store";
import { useAppStore } from "@/lib/stores/app-store";
import { useEditorUiStore } from "@/lib/stores/editor-ui-store";
import { resolveSpacePath } from "@/lib/workspace-paths";

type Ref<T> = { current: T };

type WorkspaceCommands = {
	createNote: (parentPath: string) => void | Promise<void>;
	createFolder: (parentPath: string) => void | Promise<void>;
};

type Options = {
	workspaceRef: Ref<WorkspaceSnapshot | null>;
	workspaceCommands: WorkspaceCommands;
	refreshWorkspace: () => Promise<void>;
};

/** Menu / shell window events + Escape-to-exit-zen. */
export function useMenuEvents(options: Options) {
	const { workspaceRef, workspaceCommands, refreshWorkspace } = options;

	const openNoteInfo = useCallback((target: NoteInfoTarget) => {
		useEditorUiStore.getState().openNoteInfo(target);
	}, []);

	// Escape only dispatches; store update is owned by AppTitlebar.
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				window.dispatchEvent(
					new CustomEvent("paperite:toggle-zen-mode", {
						detail: { enabled: false },
					}),
				);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	useEffect(() => {
		if (!window.electron) return;
		return window.electron.onPopoutClosed((notePath) => {
			useEditorUiStore.getState().removeLockedNotePath(notePath);
		});
	}, []);

	useEffect(() => {
		const spaceAtEvent = () =>
			resolveSpacePath(
				useAppStore.getState().activeSpacePath,
				workspaceRef.current,
			);
		const createNoteFromMenu = () =>
			void workspaceCommands.createNote(spaceAtEvent());
		const createFolderFromMenu = () => {
			const space = spaceAtEvent();
			if (space !== "Inbox") void workspaceCommands.createFolder(space);
		};
		const openNoteSetup = () =>
			useEditorUiStore.getState().setFloatingPanelMode("format");
		const openNoteInfoFromEvent = (event: CustomEvent<NoteInfoTarget>) => {
			if (!event.detail?.path) return;
			openNoteInfo({
				path: event.detail.path,
				title: event.detail.title || "Untitled",
			});
		};
		const refreshFromEvent = () => {
			void refreshWorkspace();
		};

		window.addEventListener("paperite:create-note", createNoteFromMenu);
		window.addEventListener("paperite:create-folder", createFolderFromMenu);
		window.addEventListener("paperite:note-setup", openNoteSetup);
		window.addEventListener("paperite:refresh-workspace", refreshFromEvent);
		window.addEventListener(
			"paperite:note-info",
			openNoteInfoFromEvent as EventListener,
		);

		return () => {
			window.removeEventListener("paperite:create-note", createNoteFromMenu);
			window.removeEventListener(
				"paperite:refresh-workspace",
				refreshFromEvent,
			);
			window.removeEventListener(
				"paperite:create-folder",
				createFolderFromMenu,
			);
			window.removeEventListener("paperite:note-setup", openNoteSetup);
			window.removeEventListener(
				"paperite:note-info",
				openNoteInfoFromEvent as EventListener,
			);
		};
	}, [openNoteInfo, refreshWorkspace, workspaceCommands, workspaceRef]);

	return { openNoteInfo };
}
