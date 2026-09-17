import { useEffect } from "react";
import type { WorkspaceSnapshot } from "@/lib/storage/types";
import { useEditorUiStore } from "@/lib/stores/editor-ui-store";
import type { LoadedYNote } from "@/lib/y-note-store";

type Ref<T> = { current: T };

type Options = {
	workspaceRef: Ref<WorkspaceSnapshot | null>;
	loadedYNoteCache: Ref<Map<string, LoadedYNote>>;
	flushSaveAndSync: () => Promise<unknown>;
};

/** Owns window lifecycle coordination outside the route UI. */
export function useAppLifecycle({
	workspaceRef,
	loadedYNoteCache,
	flushSaveAndSync,
}: Options) {
	useEffect(() => {
		workspaceRef.current = useEditorUiStore.getState().workspace;
		return useEditorUiStore.subscribe((state, previous) => {
			if (state.workspace !== previous.workspace) {
				workspaceRef.current = state.workspace;
			}
		});
	}, [workspaceRef]);

	useEffect(() => {
		const cache = loadedYNoteCache.current;
		return () => {
			for (const note of cache.values()) note.destroy();
			cache.clear();
		};
	}, [loadedYNoteCache]);

	useEffect(() => {
		const flush = () => void flushSaveAndSync();
		const onVisibilityChange = () => {
			if (document.visibilityState === "hidden") flush();
		};

		window.addEventListener("blur", flush);
		document.addEventListener("visibilitychange", onVisibilityChange);
		window.addEventListener("beforeunload", flush);
		return () => {
			window.removeEventListener("blur", flush);
			document.removeEventListener("visibilitychange", onVisibilityChange);
			window.removeEventListener("beforeunload", flush);
		};
	}, [flushSaveAndSync]);
}
