import { useCallback, useEffect, useRef } from "react";
import type { NoteContent, WorkspaceItem, WorkspaceSnapshot } from "@/lib/storage/types";
import type { NotesEngine } from "@/lib/notes-engine";
import { useAppStore } from "@/lib/stores/app-store";
import { useEditorUiStore } from "@/lib/stores/editor-ui-store";
import { resolveSpacePath } from "@/lib/workspace-paths";

type Ref<T> = { current: T };
type YNote = { destroy: () => void };

type Options = {
	notesApi: NotesEngine | null;
	activeNotePathRef: Ref<string | null>;
	noteContentCache: Ref<Map<string, NoteContent>>;
	notePersistedCache: Ref<Map<string, NoteContent>>;
	loadedYNoteCache: Ref<Map<string, YNote>>;
	workspaceRef: Ref<WorkspaceSnapshot | null>;
	readNoteOnce: (path: string) => Promise<NoteContent>;
	loadYNoteOnce: (path: string) => Promise<YNote | null>;
};

const MAX_WARM_EXTRA = 16;

export function useNotePrefetch(options: Options) {
	const {
		notesApi,
		activeNotePathRef,
		noteContentCache,
		notePersistedCache,
		loadedYNoteCache,
		workspaceRef,
		readNoteOnce,
		loadYNoteOnce,
	} = options;

	const warmOrderRef = useRef<string[]>([]);
	const prefetchInFlightRef = useRef(new Set<string>());

	const syncOpenTabTitle = useCallback(
		(notePath: string, content: NoteContent) => {
			const contentTitle =
				typeof content.title === "string" ? content.title.trim() : "";
			if (!contentTitle) return;

			useAppStore.getState().update((current) => {
				let changed = false;
				const openTabs = current.openTabs.map((tab) => {
					if (tab.path !== notePath || tab.title === contentTitle) return tab;
					changed = true;
					return { ...tab, title: contentTitle };
				});
				return changed ? { ...current, openTabs } : current;
			});
		},
		[],
	);

	const tryMarkEditorReady = useCallback(
		(notePath: string) => {
			if (!noteContentCache.current.has(notePath)) return;
			if (!loadedYNoteCache.current.has(notePath)) return;
			useEditorUiStore.getState().markEditorReady(notePath);
		},
		[noteContentCache, loadedYNoteCache],
	);

	const touchWarm = useCallback((notePath: string) => {
		const order = warmOrderRef.current.filter((p) => p !== notePath);
		order.push(notePath);
		warmOrderRef.current = order;
	}, []);

	const pruneWarmCaches = useCallback(
		(openPaths: Set<string>) => {
			const order = warmOrderRef.current.filter(
				(p) =>
					loadedYNoteCache.current.has(p) || noteContentCache.current.has(p),
			);
			const extras = order.filter((p) => !openPaths.has(p));
			const drop = extras.slice(
				0,
				Math.max(0, extras.length - MAX_WARM_EXTRA),
			);
			for (const path of drop) {
				const y = loadedYNoteCache.current.get(path);
				if (y) {
					y.destroy();
					loadedYNoteCache.current.delete(path);
				}
			}
			warmOrderRef.current = order.filter((p) => !drop.includes(p));
		},
		[loadedYNoteCache, noteContentCache],
	);

	const prefetchNote = useCallback(
		(notePath: string) => {
			if (!notePath || !notesApi) return;
			touchWarm(notePath);

			const needContent = !noteContentCache.current.has(notePath);
			const needY = !loadedYNoteCache.current.has(notePath);
			if (!needContent && !needY) {
				const openPaths = new Set(
					useAppStore.getState().openTabs.map((tab) => tab.path),
				);
				pruneWarmCaches(openPaths);
				return;
			}
			if (prefetchInFlightRef.current.has(notePath)) return;
			prefetchInFlightRef.current.add(notePath);

			void (async () => {
				try {
					if (needContent) {
						const content = await readNoteOnce(notePath);
						syncOpenTabTitle(notePath, content);
						if (!noteContentCache.current.has(notePath)) {
							noteContentCache.current.set(notePath, content);
						}
						if (!notePersistedCache.current.has(notePath)) {
							notePersistedCache.current.set(notePath, content);
						}
					}
					if (needY) {
						const note = await loadYNoteOnce(notePath);
						if (note && !loadedYNoteCache.current.has(notePath)) {
							loadedYNoteCache.current.set(notePath, note);
						} else if (note) {
							note.destroy();
						}
					}
					touchWarm(notePath);
					const openPaths = new Set(
						useAppStore.getState().openTabs.map((tab) => tab.path),
					);
					if (openPaths.has(notePath)) tryMarkEditorReady(notePath);
					pruneWarmCaches(openPaths);
				} catch {
					// Prefetch is best-effort.
				} finally {
					prefetchInFlightRef.current.delete(notePath);
				}
			})();
		},
		[
			loadYNoteOnce,
			tryMarkEditorReady,
			notesApi,
			pruneWarmCaches,
			readNoteOnce,
			syncOpenTabTitle,
			touchWarm,
			noteContentCache,
			notePersistedCache,
			loadedYNoteCache,
		],
	);

	// Warm open-tab yDocs + content without subscribing Index to openTabs.
	useEffect(() => {
		let cancelled = false;
		let lastSig = "";

		const tabSig = (tabs: { path: string }[]) =>
			tabs
				.map((tab) => tab.path)
				.slice()
				.sort()
				.join("|");

		const warmOpenTabs = () => {
			const openTabs = useAppStore.getState().openTabs;
			const openPaths = new Set(openTabs.map((tab) => tab.path));
			useEditorUiStore.getState().retainReadyEditorPaths(openPaths);

			for (const notePath of openPaths) {
				const cached = loadedYNoteCache.current.get(notePath);
				if (cached) {
					tryMarkEditorReady(notePath);
				} else {
					loadYNoteOnce(notePath)
						.then((note) => {
							if (!note || cancelled) {
								note?.destroy();
								return;
							}
							loadedYNoteCache.current.set(notePath, note);
							touchWarm(notePath);
							tryMarkEditorReady(notePath);
						})
						.catch(() => {
							if (notePath === activeNotePathRef.current) {
								useEditorUiStore.getState().setSaveStatus("error");
							}
						});
				}

				if (!notesApi) continue;
				if (noteContentCache.current.has(notePath)) {
					tryMarkEditorReady(notePath);
					continue;
				}
				readNoteOnce(notePath)
					.then((content) => {
						if (cancelled) return;
						syncOpenTabTitle(notePath, content);
						if (!noteContentCache.current.has(notePath)) {
							noteContentCache.current.set(notePath, content);
						}
						if (!notePersistedCache.current.has(notePath)) {
							notePersistedCache.current.set(notePath, content);
						}
						tryMarkEditorReady(notePath);
					})
					.catch(() => undefined);
			}
		};

		lastSig = tabSig(useAppStore.getState().openTabs);
		warmOpenTabs();

		const unsub = useAppStore.subscribe((state) => {
			const next = tabSig(state.openTabs);
			if (next === lastSig) return;
			lastSig = next;
			warmOpenTabs();
		});

		return () => {
			cancelled = true;
			unsub();
		};
	}, [
		loadYNoteOnce,
		readNoteOnce,
		tryMarkEditorReady,
		touchWarm,
		syncOpenTabTitle,
		notesApi,
		loadedYNoteCache,
		noteContentCache,
		notePersistedCache,
		activeNotePathRef,
	]);

	// Idle-prefetch + active-space event without Index subscribing to activeSpacePath.
	useEffect(() => {
		let idleId: number | undefined;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		let cancelled = false;
		let lastSpacePath: string | null = null;

		const clearScheduled = () => {
			if (idleId !== undefined && typeof cancelIdleCallback === "function") {
				cancelIdleCallback(idleId);
				idleId = undefined;
			}
			if (timeoutId !== undefined) {
				clearTimeout(timeoutId);
				timeoutId = undefined;
			}
		};

		const runForSpace = (activeSpacePath: string) => {
			clearScheduled();
			cancelled = false;

			const resolved = resolveSpacePath(activeSpacePath, workspaceRef.current);
			window.dispatchEvent(
				new CustomEvent("paperite:active-space-change", {
					detail: { path: resolved },
				}),
			);

			if (resolved === "Trash") return;
			const snap = workspaceRef.current;
			if (!snap) return;
			const space = snap.spaces.find((entry) => entry.path === resolved);
			if (!space) return;

			const paths: string[] = [];
			const walk = (items: WorkspaceItem[]) => {
				for (const item of items) {
					if (paths.length >= 8) return;
					if (item.type === "note") paths.push(item.path);
					else walk(item.children);
				}
			};
			walk(space.children);

			let index = 0;
			const schedule = (fn: () => void) => {
				if (typeof requestIdleCallback === "function") {
					idleId = requestIdleCallback(fn, { timeout: 800 });
				} else {
					timeoutId = setTimeout(fn, 32);
				}
			};
			const tick = () => {
				if (cancelled) return;
				while (index < paths.length) {
					const path = paths[index++];
					if (!path) continue;
					if (
						loadedYNoteCache.current.has(path) &&
						noteContentCache.current.has(path)
					) {
						continue;
					}
					prefetchNote(path);
					break;
				}
				if (index < paths.length) schedule(tick);
			};
			schedule(tick);
		};

		lastSpacePath = useAppStore.getState().activeSpacePath;
		runForSpace(lastSpacePath);

		const unsub = useAppStore.subscribe((state) => {
			if (state.activeSpacePath === lastSpacePath) return;
			lastSpacePath = state.activeSpacePath;
			runForSpace(state.activeSpacePath);
		});

		const unsubWs = useEditorUiStore.subscribe((state, prev) => {
			if (state.workspace === prev.workspace) return;
			runForSpace(useAppStore.getState().activeSpacePath);
		});

		return () => {
			cancelled = true;
			clearScheduled();
			unsub();
			unsubWs();
		};
	}, [prefetchNote, workspaceRef, loadedYNoteCache, noteContentCache]);

	return {
		syncOpenTabTitle,
		tryMarkEditorReady,
		touchWarm,
		pruneWarmCaches,
		prefetchNote,
	};
}
