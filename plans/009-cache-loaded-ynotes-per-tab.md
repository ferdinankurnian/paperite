# Plan 009: Cache loaded YDocs per tab instead of reloading on every switch

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 928404b..HEAD -- src/routes/_main/index.tsx src/lib/y-note-store.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `928404b`, 2026-07-29

## Why this matters

Switching between two already-open tabs shows "Loading note..." every
single time, even the second time you go back to a note you were just on.
Tabs are supposed to make revisiting a note instant — right now they don't
behave differently from clicking a note in the sidebar, because the actual
editable document (the Yjs `Y.Doc`) is destroyed and rebuilt from a fresh
disk read on every tab switch, with no cache keyed by note path. The plain
`noteContent`/`noteContentCache` layer *is* cached correctly — that part
was never the bug — but the editor won't render until `activeYDoc` exists,
and `activeYDoc` is gated on a single `loadedYNote` slot that only ever
holds one note's doc at a time.

## Current state

- `src/lib/y-note-store.ts` (`loadYNote`, ~line 12): on every call, does
  `await notesApi.readYNote(notePath)` (IPC + disk round trip), constructs
  a brand new `Y.Doc()`, and `Y.applyUpdate`s the snapshot into it. There
  is no cache inside this module — every call is a fresh load.
- `src/routes/_main/index.tsx`:
  - `loadedYNote` state (~line 285): `{ path: string; note: LoadedYNote } | null`
    — a single slot, not a map. Only ever holds the doc for one note.
  - The YDoc-loading effect (~line 688-714): runs on every
    `appState.activeNotePath` change. It unconditionally calls
    `loadYNote(notePath)`, and on resolve does
    `setLoadedYNote((current) => { current?.note.destroy(); return { path: notePath, note }; })`
    — this destroys whatever doc was loaded before, even if that doc
    belongs to a tab that's still open. There's no check for "do I already
    have this note's doc cached."
  - `activeYDoc` (~line 1789): `loadedYNote?.path === appState.activeNotePath ? loadedYNote.note.doc : null`
    — derived from the single slot.
  - Render gate (~line 2470-2472): `MemoNoteEditor` only renders when
    `appState.activeNotePath && loadedNotePath === appState.activeNotePath && activeYDoc`.
    `loadedNotePath` (plain-content cache) can be instant on a cache hit,
    but `activeYDoc` never is — it's always waiting on the async
    `loadYNote` call from the effect above. This is why every switch shows
    "Loading note..." regardless of the plain-content cache.
  - `closeTab` (~line 1112-1130): removes the tab from `openTabs` and
    reassigns `activeNotePath` if needed. It does **not** touch
    `loadedYNote` or destroy any doc — destruction currently only happens
    implicitly, as a side effect of loading the *next* note's doc.

## Scope

**In scope:**
- `src/routes/_main/index.tsx`

**Out of scope:**
- `src/lib/y-note-store.ts` — `loadYNote` itself is fine as a "load one
  doc" primitive; the cache belongs at the call site, not inside it.
- `noteContentCache` / `notePersistedCache` / `loadedNotePath` — the plain
  content caching layer already works correctly and is not the bug.
- Sync engine, collab awareness, `readOnlyNotes` — untouched.

## Steps

### Step 1: Add a YDoc cache keyed by note path

Alongside the existing `noteContentCache` ref, add:

```ts
const loadedYNoteCache = useRef(new Map<string, LoadedYNote>());
```

This lives for as long as the app is open (or until entries are evicted in
Step 3) — it's the "open tabs keep their doc in memory" cache the plain
`noteContentCache` already models correctly for content.

### Step 2: Make the YDoc-loading effect cache-aware

Rewrite the effect at ~line 688-714 so it checks the cache before calling
`loadYNote`:

```ts
useEffect(() => {
    if (!appState.activeNotePath) {
        setLoadedYNote(null);
        return;
    }

    const notePath = appState.activeNotePath;
    const cached = loadedYNoteCache.current.get(notePath);
    if (cached) {
        setLoadedYNote({ path: notePath, note: cached });
        return;
    }

    let cancelled = false;
    loadYNote(notePath)
        .then((note) => {
            if (!note) return;
            if (cancelled) {
                note.destroy();
                return;
            }
            loadedYNoteCache.current.set(notePath, note);
            setLoadedYNote({ path: notePath, note });
        })
        .catch(() => setSaveStatus("error"));

    return () => {
        cancelled = true;
    };
}, [appState.activeNotePath]);
```

Key differences from today: no `current?.note.destroy()` on switch — a doc
that's still in the cache (i.e. still belongs to an open tab) is never
destroyed just because it stopped being the active one. The `!appState.activeNotePath`
branch no longer destroys either, for the same reason — it's not this
effect's job to decide a doc's lifetime anymore, that's Step 3.

### Step 3: Evict and destroy on actual tab close

In `closeTab` (~line 1112-1130), after computing the new `openTabs` (tab
removed), destroy and evict that path's cached doc:

```ts
const cached = loadedYNoteCache.current.get(path);
if (cached) {
    cached.destroy();
    loadedYNoteCache.current.delete(path);
}
```

This is the one place a doc's lifetime should actually end — a tab being
closed, not a tab being merely unfocused. Place it before or after the
`setAppState` call (order doesn't matter, they're independent).

### Step 4: Destroy all cached docs on unmount

Add a dedicated cleanup effect (next to the existing autosave-timer cleanup
effect a few lines below the loading effect):

```ts
useEffect(
    () => () => {
        for (const note of loadedYNoteCache.current.values()) {
            note.destroy();
        }
        loadedYNoteCache.current.clear();
    },
    [],
);
```

Without this, closing the whole note-editor route (not just a tab) would
leak every still-cached `Y.Doc` and its `"update"` listener.

### Step 5: Verify

**Verify**: `bun run lint` → exit 0, `bunx tsc -b` → exit 0 (note: per
`plans/README.md`, `bunx tsc -b` is already failing on `main` for unrelated
pre-existing reasons — confirm your change doesn't add *new* errors beyond
that known baseline, not that the command exits 0 outright).

## Test plan

No test suite covers tab UI. Manual verification:

1. Open note A (single-click) → brief "Loading note..." then content, as
   before (first load of a note is expected to hit disk).
2. Open note B → same, brief loading.
3. Switch back to tab A → **instant**, no "Loading note..." flash.
4. Switch back to tab B → also instant.
5. Type in note A, switch to B, switch back to A → your edit is still
   there (proves the cached doc, not a stale snapshot, is what's shown).
6. Close tab A, then reopen note A from the sidebar → loading happens
   again (expected — the doc was actually destroyed when the tab closed).
7. Restart the app → first open of any note is a fresh load again
   (expected — the cache is in-memory only, doesn't persist across
   restarts, same as `noteContentCache` already behaves).
8. Open several tabs, close one via its tab close button (not by
   switching away) → confirm no console errors from a doc being used
   after `destroy()`.

## Done criteria

ALL must hold:

- [ ] `bun run lint` exits 0
- [ ] `bunx tsc -b` introduces no new errors vs the pre-existing baseline
      noted in `plans/README.md`
- [ ] Switching to a previously-visited open tab shows no loading state
- [ ] Edits made in one tab are preserved when switching away and back
- [ ] Closing a tab destroys its cached doc (no leaked `Y.Doc`/listener)
- [ ] Unmounting the route destroys all remaining cached docs

## STOP conditions

- The code at the locations in "Current state" doesn't match (drift).
- Reusing a cached doc across switches causes stale/duplicate content to
  appear (would indicate the sync engine or awareness layer assumes a
  fresh doc per activation — if so, stop and report rather than guessing
  at a workaround).
- A step's verification fails twice after a reasonable fix attempt.
