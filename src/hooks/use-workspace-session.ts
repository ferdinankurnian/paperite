import { useCallback, useEffect, useRef } from "react";
import type { NotesEngine } from "@/lib/notes-engine";
import type { NoteContent, PaperiteAppState, TrashNote, WorkspaceSnapshot } from "@/lib/storage/types";
import { defaultAppState, getAppStateSnapshot, useAppStore } from "@/lib/stores/app-store";
import { serializeNoteContentBody } from "@/lib/note-content";
import type { SaveStatus } from "@/lib/stores/editor-ui-store";

type Ref<T> = { current: T };
type Options = {
  notesApi: NotesEngine | null;
  noteContentRef: Ref<NoteContent>;
  lastPersistedContent: Ref<string>;
  activeNotePathRef: Ref<string | null>;
  noteContentCache: Ref<Map<string, NoteContent>>;
  notePersistedCache: Ref<Map<string, NoteContent>>;
  setWorkspace: React.Dispatch<React.SetStateAction<WorkspaceSnapshot | null>>;
  setNotePreviews: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setNoteTitleDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /** Programmatic content commit (external sync) — bumps editor without Index noteContent state. */
  commitNoteContent: (path: string, content: NoteContent) => void;
  setTrashNotes: React.Dispatch<React.SetStateAction<TrashNote[]>>;
  setSaveStatus: (status: SaveStatus) => void;
  setAppState: (state: PaperiteAppState | ((state: PaperiteAppState) => PaperiteAppState)) => void;
  didHydrate: Ref<boolean>;
  normalizeAppState: (state: PaperiteAppState) => PaperiteAppState;
  reconcileAppState: (state: PaperiteAppState, workspace: WorkspaceSnapshot) => PaperiteAppState;
  collectNotePaths: (spaces: WorkspaceSnapshot["spaces"]) => Set<string>;
};

export function useWorkspaceSession(options: Options) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const workspaceRef = useRef<WorkspaceSnapshot | null>(null);
  const refreshTrash = useCallback(async () => {
    const current = optionsRef.current;
    const api = (await import("@/lib/trash-engine")).getTrashEngine();
    if (!api) return;
    try { current.setTrashNotes(await api.getContents()); } catch { /* non-critical */ }
  }, []);
  const refreshWorkspace = useCallback(async () => {
    const current = optionsRef.current;
    if (!current.notesApi) return;
    const workspace = await current.notesApi.getWorkspace();
    workspaceRef.current = workspace;
    current.setWorkspace(workspace);
    await refreshTrash();
  }, [refreshTrash]);
  const syncExternalWorkspace = useCallback(async () => {
    const current = optionsRef.current;
    if (!current.notesApi) return;
    const workspace = await current.notesApi.getWorkspace();
    const paths = current.collectNotePaths(workspace.spaces);
    workspaceRef.current = workspace;
    current.setWorkspace(workspace);
    current.setNotePreviews((value) => Object.fromEntries(Object.entries(value).filter(([path]) => paths.has(path))));
    current.setNoteTitleDrafts((value) => Object.fromEntries(Object.entries(value).filter(([path]) => paths.has(path))));
    current.setAppState((value) => current.reconcileAppState(value, workspace));
    const activePath = useAppStore.getState().activeNotePath;
    if (!activePath || !paths.has(activePath) || serializeNoteContentBody(current.noteContentRef.current) !== current.lastPersistedContent.current) return;
    try {
      const content = await current.notesApi.readNote(activePath);
      if (current.activeNotePathRef.current !== activePath || serializeNoteContentBody(current.noteContentRef.current) !== current.lastPersistedContent.current) return;
      current.lastPersistedContent.current = serializeNoteContentBody(content);
      current.notePersistedCache.current.set(activePath, content);
      current.commitNoteContent(activePath, content);
      current.setSaveStatus("saved");
    } catch { current.setSaveStatus("error"); }
  }, []);
  useEffect(() => {
    const current = optionsRef.current;
    if (!current.notesApi) return;
    let cancelled = false;
    Promise.all([current.notesApi.getWorkspace(), current.notesApi.readAppState()]).then(([workspace, saved]) => {
      if (cancelled) return;
      workspaceRef.current = workspace;
      current.setWorkspace(workspace);
      current.setAppState(current.reconcileAppState(current.normalizeAppState({ ...defaultAppState, ...saved }), workspace));
      current.didHydrate.current = true;
      void refreshTrash();
    }).catch((error) => { console.error("[paperite] failed to hydrate workspace", error); current.setSaveStatus("error"); });
    return () => { cancelled = true; };
  }, [refreshTrash]);
  useEffect(() => {
    if (!optionsRef.current.notesApi) return;
    return window.electron?.onWorkspaceChanged(() => { void syncExternalWorkspace(); });
  }, [syncExternalWorkspace]);
  useEffect(() => {
    const current = optionsRef.current;
    if (!current.notesApi) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = useAppStore.subscribe(() => {
      if (!current.didHydrate.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void current.notesApi?.writeAppState(getAppStateSnapshot()); }, 300);
    });
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, []);
  return { workspaceRef, refreshTrash, refreshWorkspace, syncExternalWorkspace };
}
