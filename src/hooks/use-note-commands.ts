import { useCallback, useRef } from "react";
import type {
	OpenNoteTab,
	PaperiteAppState,
	WorkspaceNote,
} from "@/lib/storage/types";
import { useAppStore } from "@/lib/stores/app-store";
import { useEditorUiStore } from "@/lib/stores/editor-ui-store";
import { topLevelPath, unique } from "@/lib/workspace-paths";

type Options = {
	setAppState: (
		updater: PaperiteAppState | ((state: PaperiteAppState) => PaperiteAppState),
	) => void;
	touchWarm: (path: string) => void;
	pruneWarmCaches: (paths: Set<string>) => void;
	pendingSwitchBenchmark: React.MutableRefObject<{
		direction: 1 | -1;
		notePath: string;
		source: "benchmark" | "tabs";
		start: number;
	} | null>;
	onPruneAssets?: (path: string) => Promise<unknown>;
};

export function useNoteCommands(options: Options) {
	const optionsRef = useRef(options);
	optionsRef.current = options;

	const setActiveSpacePath = useCallback((path: string) => {
		optionsRef.current.setAppState((current) =>
			current.activeSpacePath === path
				? current
				: { ...current, activeSpacePath: path },
		);
	}, []);

	const reorderSpaces = useCallback((spaceOrder: string[]) => {
		optionsRef.current.setAppState((current) => ({
			...current,
			spaceOrder,
		}));
	}, []);

	const reorderItems = useCallback((parentPath: string, itemOrder: string[]) => {
		if (topLevelPath(parentPath) === "Inbox") return;
		optionsRef.current.setAppState((current) => ({
			...current,
			customItemOrders: {
				...current.customItemOrders,
				[parentPath]: unique(itemOrder),
			},
		}));
	}, []);

	const openNote = useCallback(
		(note: WorkspaceNote, mode: "preview" | "fixed") => {
			optionsRef.current.setAppState((current) => {
				const existing = current.openTabs.find((tab) => tab.path === note.path);
				const previewIndex = current.openTabs.findIndex((tab) => tab.preview);
				const nextTab: OpenNoteTab = {
					path: note.path,
					title: note.title,
					preview: mode === "preview" && !existing,
					pinned: false,
				};
				if (
					existing &&
					current.activeNotePath === note.path &&
					(mode !== "fixed" || !existing.preview)
				) {
					return current;
				}
				const openTabs = existing
					? mode === "fixed" && existing.preview
						? current.openTabs.map((tab) =>
								tab.path === note.path ? { ...tab, preview: false } : tab,
							)
						: current.openTabs
					: replaceOrAppendPreviewTab(
							current.openTabs,
							nextTab,
							previewIndex,
						);
				return {
					...current,
					activeNotePath: note.path,
					activeSpacePath: current.syncSidebarWithActiveTab
						? topLevelPath(note.path)
						: current.activeSpacePath,
					openTabs,
				};
			});
		},
		[],
	);

	const closeTab = useCallback(
		(path: string, _options: { flush?: boolean } = {}) => {
			const current = optionsRef.current;
			current.touchWarm(path);
			useEditorUiStore.getState().unmarkEditorReady(path);
			current.setAppState((state) => {
				const index = state.openTabs.findIndex((tab) => tab.path === path);
				const openTabs = state.openTabs.filter((tab) => tab.path !== path);
				const fallback = openTabs[Math.max(0, index - 1)] ?? openTabs[0];
				return {
					...state,
					activeNotePath:
						state.activeNotePath === path
							? (fallback?.path ?? null)
							: state.activeNotePath,
					openTabs,
				};
			});
			const paths = new Set(
				useAppStore.getState().openTabs.map((tab) => tab.path),
			);
			paths.delete(path);
			current.pruneWarmCaches(paths);
			void current.onPruneAssets?.(path);
		},
		[],
	);

	const switchTab = useCallback(
		(direction: 1 | -1, source: "benchmark" | "tabs" = "tabs") => {
			const current = optionsRef.current;
			current.setAppState((state) => {
				if (state.openTabs.length < 2) return state;
				const activeIndex = state.openTabs.findIndex(
					(tab) => tab.path === state.activeNotePath,
				);
				const index = activeIndex === -1 ? 0 : activeIndex;
				const next =
					state.openTabs[
						(index + direction + state.openTabs.length) % state.openTabs.length
					];
				current.pendingSwitchBenchmark.current = {
					direction,
					notePath: next.path,
					source,
					start: performance.now(),
				};
				return {
					...state,
					activeNotePath: next.path,
					activeSpacePath: topLevelPath(next.path),
				};
			});
		},
		[],
	);

	return {
		setActiveSpacePath,
		reorderSpaces,
		reorderItems,
		openNote,
		closeTab,
		switchTab,
	};
}

function replaceOrAppendPreviewTab(
	tabs: OpenNoteTab[],
	next: OpenNoteTab,
	index: number,
) {
	return index === -1 || !next.preview
		? [...tabs, next]
		: tabs.map((tab, i) => (i === index ? next : tab));
}
