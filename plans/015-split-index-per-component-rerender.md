# Plan 015: Split Index — per-component re-render (space switch / shell isolation)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> ```bash
> wc -l src/routes/_main/index.tsx src/components/app-sidebar.tsx
> rg -n "activeSpacePath" src/routes/_main/index.tsx | head -40
> rg -n "useStoreWithEqualityFn|useAppStore" src/routes/_main/index.tsx | head -20
> ```
> Confirm `src/lib/stores/app-store.ts` exists (plan 013 Phase B partial).
> Confirm `AppSidebar` already reads `activeSpacePath` via `useShallow` on
> `useAppStore` (so sidebar can update without parent props).

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: MED
- **Depends on**: 008, 009 (DONE); 013 Phase B partial (zustand `app-store` already landed)
- **Category**: performance / architecture
- **Planned at**: 2026-08-08
- **Progress (2026-08-08)**: Steps 0–5 **DONE** (shippable).
  - Index no longer subscribes to `activeSpacePath`
  - space effects via `useAppStore.subscribe`
  - `src/components/tab-bar.tsx` extracted (own store sub)
  - `src/components/note-workspace.tsx` shell (SidebarInset boundary)
  - AppSidebar already `React.memo`
  - `bunx tsc -b` clean
  Full `useNoteSession` move stays plan 013.

## Why this matters

User (2026-08-08) + React DevTools highlight:

> pindah space doang kok rerender satu halaman? padahal harusnya sidebar
> doang. kenapa engga potong-potong aja — sidebar, note editor, dipotong
> jadi file. purge di index semua = ricuh.

Root cause (verified in code):

1. `Index` in `src/routes/_main/index.tsx` subscribes to a **wide** slice of
   `useAppStore` via `useStoreWithEqualityFn`, including `activeSpacePath`.
2. Equality fn treats `activeSpacePath` as a re-render trigger.
3. `setActiveSpacePath` → Index re-renders → entire shell (sidebar + inset +
   tab bar + editor wrappers) re-renders even though the open note did not
   change.
4. `AppSidebar` already has its own store subscription for
   `activeSpacePath`, so parent re-render is pure waste for space switch.
5. Index is still a god component (~2k+ lines): workspace hydrate, autosave,
   ydoc cache, tabs, spaces, trash, export, keyboard, floating panels — all
   in one file. Hard to isolate, hard to memo, hard to reason about.

Goal: **space switch re-renders only sidebar (+ space chrome)**. Editor tree
stays cold. Index becomes thin composition, not a state dump.

## Current state (2026-08-08)

| Piece | Status |
|-------|--------|
| `useAppStore` (zustand) | EXISTS — `activeSpacePath`, openTabs, etc. |
| `AppSidebar` store read | EXISTS — `useShallow` includes `activeSpacePath` |
| `MemoNoteEditor` | EXISTS — tab switch hide/show path |
| `TabBar` memo + local store sub | EXISTS inside index.tsx |
| Index bulk selector | **STILL includes `activeSpacePath`** |
| Index as composition-only | **NO** — still owns all effects/handlers |
| `React.memo` on AppSidebar | **NO** (deferred in 008 STOP) |

This plan is a **focused slice** of 013 Phase B/C: do the high-ROI isolation
for space switch + start the file split. Full virtualization / 100x budgets
stay in 013.

## Scope

**In scope:**
1. Stop Index from subscribing to `activeSpacePath` (and any other field it
   does not need for editor/layout).
2. Move space-only effects out of Index (prefetch-on-space, active-space
   custom events, create-note-in-current-space wiring).
3. Extract components/files so ownership is clear:
   - shell layout
   - note workspace (tabs + editors)
   - keep AppSidebar as space owner
4. Stable callbacks / memo so parent re-renders (when they still happen)
   do not cascade into TipTap.

**Out of scope:**
- Virtualizing the note tree (013 Phase D)
- Full line-count goal of 013 ("Index < 800") if it requires rewriting autosave
- Replacing TipTap, storage format, mobile

## Target architecture

```
src/routes/_main/index.tsx          → route + hydrate + thin glue
src/components/app-shell.tsx        → SidebarProvider + layout slots
src/components/note-workspace.tsx   → TabBar + editor stack (subscribes:
                                       activeNotePath, openTabs, readOnly…)
src/components/app-sidebar.tsx      → already owns space UI + activeSpacePath
src/hooks/use-workspace.ts          → hydrate / refresh / external sync
src/hooks/use-note-session.ts       → content/ydoc caches, autosave, ready set
                                       (can stay in index first if risk high;
                                        extract when boundaries are clear)
```

Subscription rules:

| Component | May subscribe to |
|-----------|------------------|
| Index / AppShell | `sidebarOpen` only (layout chrome) |
| NoteWorkspace | `activeNotePath`, `openTabs`, `readOnlyNotes`, page format defaults |
| AppSidebar / NavMain | `activeSpacePath`, `expandedFolders`, space* maps, `openTabs` (highlight) |
| TabBar | `openTabs`, `activeNotePath`, space icons/colors (already) |
| MemoNoteEditor | props only — no store |

**Hard rule**: changing `activeSpacePath` must not re-render NoteWorkspace
or any TipTap instance.

## Steps

### Step 0 — Baseline (5 min)

1. Open React DevTools / react-scan.
2. Switch space with a note open. Confirm Index + SidebarInset + editors
   highlight (current broken behavior).
3. Note FPS / flash if any.

**Verify**: screenshot or short note of what currently re-renders.

### Step 1 — Narrow Index store selector (highest ROI, small diff)

In `src/routes/_main/index.tsx`:

1. Remove `activeSpacePath` from the `useStoreWithEqualityFn` selector and
   from the equality comparator.
2. Replace every `appState.activeSpacePath` usage in Index with either:
   - `useAppStore.getState().activeSpacePath` (event handlers / one-shots), or
   - a **local** narrow hook only where a child effect truly needs React
     reactivity — but prefer moving that effect out of Index (Step 2).
3. Keep `setActiveSpacePath` as a stable `useCallback` that calls
   `useAppStore.getState().update(...)` or `setActiveSpacePath` action — do
   **not** force Index to re-render.

**STOP if**: open note disappears on space switch, or active space chrome in
titlebar/sidebar desyncs.

**Verify**:
- `bunx tsc -b` clean
- Switch space → React Profiler: Index should **not** re-render; AppSidebar
  should. Editor DOM / MemoNoteEditor should stay cold.
- Active note content unchanged; tabs unchanged.

### Step 2 — Move space-only effects off Index

Identify effects / listeners in Index that depend on `activeSpacePath` /
`currentSpacePath`:

- idle prefetch of first N notes in active space
- `paperite:active-space-change` dispatch
- menu listeners that create note/folder in **current** space
- any keyboard path that only needs current space

Move them into:
- `AppSidebar` (best for UI-adjacent), or
- a small `useActiveSpaceEffects(workspace)` hook mounted **inside** the
  sidebar tree (not under NoteWorkspace).

Index may still call `createNote(parentPath)` etc., but the **subscription**
to which space is current must not live in Index.

**Verify**: create note from menu still lands in the visible space; prefetch
still runs after space switch (check network/IPC or logs).

### Step 3 — Extract `NoteWorkspace` (+ optional `AppShell`)

1. Create `src/components/note-workspace.tsx`:
   - owns TabBar, header actions that are note-scoped, editor stack,
     floating find/replace/info panels if they only care about active note
   - subscribes only to note-relevant store fields
2. Index renders:
   ```tsx
   <SidebarProvider ...>
     {!zenMode && <AppSidebar ...stable callbacks... />}
     <SidebarInset>
       <NoteWorkspace ... />
     </SidebarInset>
   </SidebarProvider>
   ```
3. Pass **stable** callbacks (`useCallback` / store actions). No inline
   object props that change every Index render.
4. Optional same PR: `app-shell.tsx` if it clarifies layout; not required
   for the re-render win.

**STOP if**: tab switch regresses to "Loading note..." (009 cache broken)
or autosave stops.

**Verify**:
- Space switch: only sidebar subtree
- Tab switch: NoteWorkspace + TabBar; sidebar idle
- Typing: still no sidebar (008 path intact)

### Step 4 — Memo walls for the split

1. `export const AppSidebar = memo(AppSidebarImpl)` once props from Index
   are stable (handlers from store or `useCallback` with `[]` / store deps).
2. Ensure `NoteWorkspace` is `memo`'d or only re-renders on its own store
   slice.
3. Do **not** memo TipTap away incorrectly — keep existing `MemoNoteEditor`
   compare fn.

**Verify**: Profiler — expand folder → sidebar only; switch space → sidebar
only; switch tab → note workspace only.

### Step 5 — Cleanup + docs

1. Delete dead `appState.activeSpacePath` references in Index.
2. Short comment at top of Index: what it owns vs what children own.
3. Update `plans/README.md` status for 015; add a one-line note under 013
   that space-switch isolation landed in 015 if 013 still TODO.

## STOP conditions

- Autosave / Yjs / derived write path breaks
- Tab warm cache broken (loading flash on warm tab)
- Space list empty after switch (mountedSpacePaths race — see comment in
  app-sidebar ~2102)
- `bunx tsc -b` fails for reasons introduced by this plan
- Any data loss on note content

If STOP: revert the last step, report which verify failed, do not push on.

## Done criteria

- [ ] Switching space does **not** re-render NoteWorkspace / MemoNoteEditor
      (Profiler or react-scan)
- [ ] Switching space **does** update sidebar active highlight + note list
- [ ] Tab switch and typing paths unchanged (no new lag)
- [ ] `bunx tsc -b` clean
- [ ] Index no longer lists `activeSpacePath` in its store equality selector
- [ ] At least `note-workspace.tsx` exists; Index is thinner composition
- [ ] README status updated

## Relation to plan 013

013 remains the umbrella for virtualization, budgets, and further store
splits (`useNoteSession` extraction). **015 is the concrete, shippable
slice** for the user-visible "space switch re-renders the whole page" bug
and the "don't dump everything in Index" structure fix. Prefer landing 015
before more 013 phases so isolation is real, not aspirational.
