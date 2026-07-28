# Plan 007: Pin notes to the top of their folder

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 975b6a5..HEAD -- main.js src/lib/storage/types.ts src/components/app-sidebar.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

> **Reconnaissance note**: unlike the other plans in this batch, this one
> was written without full visibility into the workspace-scanning function
> in `main.js` (the code that builds the `WorkspaceItem[]` tree from disk)
> or the exact sidebar sort/render logic in `app-sidebar.tsx`. Step 1 below
> is dedicated to locating those before making changes — do not skip it.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: feature
- **Planned at**: commit `975b6a5`, 2026-07-28

## Why this matters

There's no way to pin a note to the top of a folder or space today (confirmed:
no `favorite`/`starred`/`pinnote` references anywhere in `src`). Sorting is
controlled by `SidebarSortOrder` (`"newest" | "oldest" | "a-z" | "z-a" | "custom"`)
and `spaceSortOrders`/`customItemOrders` in `PaperiteAppState`, which sort a
whole folder uniformly — none of them support "this one note always floats
to the top regardless of the active sort."

## Desired behavior

- A note can be pinned via a right-click context menu item in the sidebar
  ("Pin Note" / "Unpin Note").
- A pinned note sorts to the top of whatever list it's currently in.
- Scope is per-folder, not global: a pinned note inside `Work/Projects`
  stays at the top of `Work/Projects`, not at the top of the entire
  workspace. If the active sort is later changed (newest/oldest/a-z/etc.),
  pinned notes still float to the top; the chosen sort order only applies
  among pinned notes and separately among unpinned notes.

## Current state (partial — confirm the rest during Step 1)

- `src/lib/storage/types.ts`:
  ```ts
  export type WorkspaceNote = {
      type: "note";
      title: string;
      path: string;
      preview: string;
      updatedAt: number;
  };
  ```
  No `pinned` field exists here yet.
- `main.js`'s `notes:write-note` handler (~line 2293) already preserves
  metadata fields that aren't part of the raw editor payload — it does this
  today for `id` and `title` ("Preserve persisted metadata stripped by the
  editor body payload"). `pinned` should follow the same pattern: read from
  `note.json`, not clobbered by an editor save that doesn't know about it.
- **Not yet located** (find these in Step 1):
  - The function in `main.js` that scans the workspace directory and builds
    the `WorkspaceItem[]` tree returned to the renderer (this is where
    `WorkspaceNote` objects get constructed from files on disk — `pinned`
    needs to be read from each note's `note.json` and included here).
  - The sidebar's sort/render logic in `app-sidebar.tsx` (where
    `SidebarSortOrder` is applied to produce the displayed list order — this
    is where the "pinned notes first, then apply the chosen sort within
    each group" logic needs to be inserted).

## Scope

**In scope:**
- `src/lib/storage/types.ts`
- `main.js` (note read/write metadata + workspace scan)
- `src/components/app-sidebar.tsx` (context menu item + sort logic)

**Out of scope:**
- Any change to `SidebarSortOrder` itself or the sort-order picker UI —
  pinning is orthogonal to the chosen sort, not a new sort mode.
- Convex/shared-space notes — this plan covers local personal notes only;
  don't touch `sharedNotes` schema.

## Steps

### Step 1: Locate the workspace-scan function and sidebar sort logic

In `main.js`, find the function that reads the notes directory tree and
returns `WorkspaceItem[]` (likely near `readNoteContent`/`ensureWorkspace`,
search for where `WorkspaceNote`-shaped objects with `preview`/`updatedAt`
are constructed). In `app-sidebar.tsx`, find where `SidebarSortOrder` is
applied to a list of `WorkspaceItem`s to produce the rendered order. Note
the exact function names and line numbers here before proceeding — if this
plan's assumptions about where these live turn out wrong, treat it as a
STOP condition and report rather than guessing.

### Step 2: Add `pinned` to note metadata

- Add `pinned?: boolean` to whatever type represents the on-disk
  `note.json` shape (check `note-content.ts` for the `NoteContent` type,
  which already carries `id`/`title` alongside the TipTap body — `pinned`
  belongs there, sibling to those fields, not inside the TipTap `content`).
- In `main.js`'s `notes:write-note` handler, extend the existing
  "preserve persisted metadata" block to also carry forward `pinned` when
  the incoming save payload doesn't include it (same treatment as `id`/`title`).
- Add `pinned: boolean` to `WorkspaceNote` in `types.ts`, and populate it
  in the workspace-scan function located in Step 1, defaulting to `false`
  for notes that don't have the field yet (no migration needed — `undefined`
  reads as falsy).

### Step 3: Add a `notes:set-pinned` IPC handler (or fold into an existing one)

Prefer a small, dedicated handler over overloading `notes:write-note`,
since pin/unpin shouldn't require sending the full note content:

```js
ipcMain.handle("notes:set-pinned", async (_event, notePath, pinned) => {
    await ensureWorkspace();
    const normalizedPath = currentNotePath(notePath);
    const content = await readNoteContent(normalizedPath, true);
    content.pinned = pinned;
    await writeFileAtomic(resolveNoteContentPath(normalizedPath), JSON.stringify(content));
    return { pinned };
});
```

Adjust to match the actual read/write helper names found in Step 1 — the
above is illustrative, not a literal patch. Expose it in `preload.js` and
`src/vite-env.d.ts` following the exact pattern already used for
`saveImage`/`getAssetUrl`.

### Step 4: Add the context menu item

In `app-sidebar.tsx`, wherever notes already have a right-click menu (if
one doesn't exist yet for note items, this needs its own small addition
using `@/components/ui/context-menu`, same primitive as plan 006), add
"Pin Note" / "Unpin Note" that calls the new IPC action and updates local
state optimistically so the UI reorders immediately rather than waiting on
a full workspace re-scan.

### Step 5: Apply pinned-first sorting, scoped per folder

At the point identified in Step 1 where `SidebarSortOrder` produces the
final render order for a folder's children, change it from a single sort
to: partition into `pinned` and `unpinned`, apply the existing sort
comparator to each group independently, then concatenate
`[...sortedPinned, ...sortedUnpinned]`. This must happen independently for
each folder's own children array (recursive, not flattened across the
whole tree), since `WorkspaceFolder.children` is already a per-folder list.

### Step 6: Add a pinned indicator in the note list

A small filled pin icon (or similar) next to pinned notes in the sidebar so
users can tell at a glance which notes are pinned — check if a similar
indicator pattern already exists for something else in `app-sidebar.tsx`
(e.g. how read-only notes are marked) and follow that convention.

### Step 7: Verify

**Verify**: `bun run lint` → exit 0, `bunx tsc -b` → exit 0

## Test plan

No test suite covers sidebar/file I/O UI at this level (plan 005 covers
lower-level file I/O separately). Manual verification:

1. Pin a note inside a folder with several other notes — it should jump to
   the top of that folder's list, other notes keep their relative order.
2. Pin a note in a different, nested folder — confirm it only affects that
   folder's top, not the parent folder's or workspace root's order.
3. Change the active sort order (e.g. newest → a-z) — pinned notes stay on
   top; only the ordering within the pinned group and within the unpinned
   group should change.
4. Unpin the note — it returns to its normal sorted position.
5. Restart the app — pin state persists (it's read from `note.json` on
   disk, not local UI state, so this should hold naturally).
6. Rename/move the pinned note to a different folder — pin state should
   travel with the note (it's stored in the note's own file).

## Done criteria

ALL must hold:

- [ ] `bun run lint` exits 0
- [ ] `bunx tsc -b` exits 0
- [ ] Pinning floats a note to the top of its own folder only
- [ ] Pin state persists across restart and across move/rename
- [ ] Changing sort order doesn't disturb the pinned/unpinned grouping
- [ ] A visual indicator distinguishes pinned notes in the list

## STOP conditions

- The code at the locations in "Current state" doesn't match (drift).
- The workspace-scan function or sidebar sort logic located in Step 1
  don't match this plan's assumptions about their structure — stop and
  report the actual structure rather than forcing this plan's approach
  onto a different architecture.
- Implementing per-folder pin scoping would require a broad rewrite of how
  `WorkspaceItem` trees are built or rendered — stop and report; this
  suggests the feature needs its own smaller design pass rather than being
  bolted on.
