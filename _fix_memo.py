from pathlib import Path

p = Path("paperite/src/routes/_main/index.tsx")
t = p.read_text()

# 1) updateNoteContent — use cache, stable callback (no loadedYNote?.path dep)
old = '''\t\t\tif (loadedYNote?.path === sourceNotePath) {
\t\t\t\tscheduleYjsDerivedAutosave(sourceNotePath, nextContent);
\t\t\t\treturn;
\t\t\t}

\t\t\tscheduleNoteAutosave(sourceNotePath, nextContent);
\t\t},
\t\t[loadedYNote?.path, scheduleNoteAutosave, scheduleYjsDerivedAutosave],
\t);'''

new = '''\t\t\t// Prefer yjs-derived write when this note has a live yDoc.
\t\t\tif (loadedYNoteCache.current.has(sourceNotePath)) {
\t\t\t\tscheduleYjsDerivedAutosave(sourceNotePath, nextContent);
\t\t\t\treturn;
\t\t\t}

\t\t\tscheduleNoteAutosave(sourceNotePath, nextContent);
\t\t},
\t\t[scheduleNoteAutosave, scheduleYjsDerivedAutosave],
\t);'''

assert old in t, "updateNoteContent yjs branch not found"
t = t.replace(old, new, 1)
print("1 updateNoteContent stable")

# 2) flushSaveAndSync — same
old = '''\t\t\ttry {
\t\t\t\tif (loadedYNote?.path === notePath) {
\t\t\t\t\tawait notesApi?.writeDerivedNote(notePath, latestContent);
\t\t\t\t} else {
\t\t\t\t\tawait enqueueNoteWrite(notePath, latestContent);
\t\t\t\t}'''

new = '''\t\t\ttry {
\t\t\t\tif (loadedYNoteCache.current.has(notePath)) {
\t\t\t\t\tawait notesApi?.writeDerivedNote(notePath, latestContent);
\t\t\t\t} else {
\t\t\t\t\tawait enqueueNoteWrite(notePath, latestContent);
\t\t\t\t}'''

assert old in t, "flushSave yjs branch not found"
t = t.replace(old, new, 1)
print("2 flushSave cache")

# Remove loadedYNote?.path from flushSave deps if present
old = '''\t\tclearNoteAutosaveTimer,
\t\tenqueueNoteWrite,
\t\tloadedYNote?.path,
\t\tnotesApi,
\t]);'''

new = '''\t\tclearNoteAutosaveTimer,
\t\tenqueueNoteWrite,
\t\tnotesApi,
\t]);'''

if old in t:
    t = t.replace(old, new, 1)
    print("3 flushSave deps")
else:
    print("3 flushSave deps — pattern not found, skip")

# 4) Skip path — zero setState when editor already live
old = '''\t\t// Editor already mounted for this tab — just point refs at the cache.
\t\t// No setState storm, no IPC, no TipTap churn.
\t\tif (
\t\t\treadyEditorPaths.has(notePath) &&
\t\t\tnoteContentCache.current.has(notePath)
\t\t) {
\t\t\tconst cached = noteContentCache.current.get(notePath)!;
\t\t\tconst persisted = notePersistedCache.current.get(notePath);
\t\t\tlastLoadedNote.current = notePath;
\t\t\tnoteContentRef.current = cached;
\t\t\tlastPersistedContent.current = persisted
\t\t\t\t? serializeNoteContentBody(persisted)
\t\t\t\t: serializeNoteContentBody(cached);
\t\t\t// Keep loadedYNote in sync for save/flush without extra renders when possible.
\t\t\tconst yCached = loadedYNoteCache.current.get(notePath);
\t\t\tif (yCached) {
\t\t\t\tsetLoadedYNote((prev) =>
\t\t\t\t\tprev?.path === notePath ? prev : { path: notePath, note: yCached },
\t\t\t\t);
\t\t\t}
\t\t\tsetLoadedNotePath((prev) => (prev === notePath ? prev : notePath));
\t\t\treturn;
\t\t}'''

new = '''\t\t// Editor already mounted for this tab — just point refs at the cache.
\t\t// Zero setState: switching tabs must not re-render TipTap instances.
\t\tif (
\t\t\treadyEditorPaths.has(notePath) &&
\t\t\tnoteContentCache.current.has(notePath)
\t\t) {
\t\t\tconst cached = noteContentCache.current.get(notePath)!;
\t\t\tconst persisted = notePersistedCache.current.get(notePath);
\t\t\tlastLoadedNote.current = notePath;
\t\t\tnoteContentRef.current = cached;
\t\t\tlastPersistedContent.current = persisted
\t\t\t\t? serializeNoteContentBody(persisted)
\t\t\t\t: serializeNoteContentBody(cached);
\t\t\treturn;
\t\t}'''

assert old in t, "skip path not found"
t = t.replace(old, new, 1)
print("4 skip path zero setState")

# 5) Custom memo for NoteEditor — only care about path-relevant props
old = '''const MemoNoteEditor = memo(NoteEditor);'''

new = '''const MemoNoteEditor = memo(NoteEditor, (prev, next) => {
\t// Tab switch only toggles visibility in the parent — keep TipTap mounted
\t// and skip re-render unless something the editor actually uses changed.
\treturn (
\t\tprev.content === next.content &&
\t\tprev.noteTitle === next.noteTitle &&
\t\tprev.notePath === next.notePath &&
\t\tprev.pageFormat === next.pageFormat &&
\t\tprev.readOnly === next.readOnly &&
\t\tprev.yDoc === next.yDoc &&
\t\tprev.searchQuery === next.searchQuery &&
\t\tprev.zenMode === next.zenMode &&
\t\tprev.onChange === next.onChange &&
\t\tprev.onContentRendered === next.onContentRendered &&
\t\tprev.onRename === next.onRename &&
\t\tprev.onTitleChange === next.onTitleChange
\t);
});'''

assert old in t, "MemoNoteEditor not found"
t = t.replace(old, new, 1)
print("5 custom memo")

p.write_text(t)
print("OK")
