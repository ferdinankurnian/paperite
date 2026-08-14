# Plan 017: Refactor Index into selective-render boundaries

## Status

- **Priority:** P0
- **Effort:** XL
- **Risk:** HIGH
- **Depends on:** 008, 009, 013 Phase B, 015
- **Category:** performance / architecture
- **Planned at:** 2026-08-14
- **Status:** IN PROGRESS

## Progress update — 2026-08-14

The refactor is being implemented incrementally because `Index` currently
couples UI composition, IPC coordination, autosave, workspace reconciliation,
and sidebar commands in the same closure. Each extraction is kept behavior-
preserving and validated before the next boundary is removed.

Completed so far:

- `src/lib/note-session-engine.ts` owns note content/YDoc caches, read dedupe,
  YDoc-load dedupe, and the serialized write queue.
- `src/hooks/use-note-session.ts` is a thin React adapter over that engine.
- `src/hooks/use-note-autosave.ts` owns autosave timers, Yjs-derived autosave,
  force-save/sync, save verification, live content snapshots, and runtime cache
  moves.
- `src/hooks/use-workspace-session.ts` owns workspace hydration, trash refresh,
  external workspace refresh, and debounced app-state persistence. Its callback
  identities are kept stable through a ref so note typing does not rehydrate
  the workspace.
- `src/hooks/use-note-commands.ts` owns basic space/tab commands: selecting and
  reordering spaces/items, opening/closing tabs, and switching tabs.
- `src/components/app-shell.tsx` owns the persisted sidebar provider and layout
  slots.
- `src/components/active-note-pane.tsx` owns active/inactive editor selection,
  loading fallback, hidden inactive editors, and editor props.
- `src/components/note-header.tsx` owns tabs, save status, read-only toggle,
  note actions, copy/export actions, and header menus.
- `src/components/floating-note-panel.tsx` owns find/replace, note info, and
  note setup UI.
- `AppTitlebar` now splits title and window-control subscriptions: title changes
  update `WindowTitle`, while `WindowControls` reads only `closeButtonOnly`.

Current measured state:

- `Index`: 2,361 lines after the command-boundary extraction.
- `bunx tsc -b --pretty false`: passing.
- `bun test`: 6 passing, 0 failing.
- `git diff --check`: passing.
- React Doctor changed scan improved from score 45/100 with 22 diagnostics to
  47/100 with 17 diagnostics. Remaining diagnostics are primarily existing
  dependency issues in `Index`/`note-editor`; no new React Doctor error was
  introduced by the latest extraction.

Remaining work:

- Move the remaining note/folder/space CRUD, rename/move/delete, trash actions,
  title/content commands, and keyboard orchestration out of `Index`.
- Split title/window-control ownership so window controls subscribe only to
  `closeButtonOnly` and title updates do not evaluate the whole titlebar.
- Remove remaining broad `appState` subscriptions and reduce `Index` to route,
  composition, and stable cross-boundary wiring.
- Capture and record the manual render-contract evidence required by Phase 0.

Latest implementation update — 2026-08-14:

- Isolated `WindowTitle` and `WindowControls` from the `AppTitlebar` parent so
  note title changes do not evaluate window controls, and removed the
  `closeButtonOnly` subscription from `Index`.
- Moved global note keyboard orchestration to
  `src/hooks/use-note-keyboard.ts`; the listener is mounted once and invokes
  current callbacks through a ref.
- Added `src/hooks/use-workspace-commands.ts` and routed sidebar CRUD/trash
  callbacks through it. The old local closures are still present temporarily
  and must be deleted before this plan can be marked complete.
- Menu events and keyboard shortcuts now also call the stable workspace-command
  callbacks; the hook return value is memoized so those subscriptions do not
  churn on ordinary note renders.
- Removed the duplicate local `createNote`, `createFolder`, and
  `toggleFolder` implementations from `Index`; their behavior is now solely
  owned by `useWorkspaceCommands`.
- Removed the duplicate local space creation, item movement, and trash action
  implementations; sidebar behavior remains covered by the workspace-command
  hook and verification still passes.
- Removed the remaining duplicate local `editSpace`, `renameItem`, and
  `deleteItem` implementations. `Index` no longer owns workspace CRUD/trash
  callbacks; those are provided by `useWorkspaceCommands`.
- Final changed scan after this batch: React Doctor 50/100, 18 diagnostics;
  the count is unchanged, while the score improved from 49 to 50.
- `bunx tsc -b --pretty false`, `bun test`, and `git diff --check` pass.
- Changed React Doctor scan reports score 49/100 with 18 issues (down from 19);
  no new error was introduced by the keyboard boundary. The remaining error is
  the existing `Index` effect cleanup diagnostic.

The plan is deliberately not marked done until those remaining boundaries and
the render evidence are complete.

### Progress update — 2026-08-14 (Index subscription trim)

- Dropped dead `spaceColors` / `spaceIcons` subscriptions from Index
  (`useStoreWithEqualityFn`). Those belong to TabBar + AppSidebar only;
  changing a space icon no longer re-renders Index.
- `ActiveNotePane` now subscribes to `openTabs` + `activeNotePath` itself and
  is wrapped in `memo`. Index no longer passes those props down.
- Stabilized NoteHeader / keyboard action callbacks (`openSetupPanel`,
  `openFindPanel`, `deleteActiveNote`, copy/export/popout handlers) so they
  do not get new identities every Index render; prefer `getState()` /
  `activeNotePathRef` over render-scoped `appState.activeNotePath` inside
  handlers.
- Remaining Index store slice (after this batch): `openTabs`, `activeNotePath`,
  `defaultPageFormat`.

### Progress update — 2026-08-14 (spaceOrder + NoteHeader boundaries)

- `spaceOrder` applied inside `AppSidebar` (`ordered` via store shallow select).
  Index only passes decoration-only `visibleSpaces`; space drag no longer
  re-renders Index / editors.
- Removed unused `orderSpaces` helper from Index.
- `NoteHeader` self-subscribes to `activeNotePath`, is `memo`'d; dropped unused
  `activeNoteTitle` / `activeNotePath` props from Index.
- `ActiveNotePane` also reads `defaultPageFormat` from the store (no prop).
- Next: narrow Index further — load/title effects via `subscribe` so
  `activeNotePath` can leave the render selector when header is fully local;
  move FloatingNotePanel default format ownership; record React Scan evidence.

### Progress update — 2026-08-14 (narrow Index store selectors)

- Replaced broad `useStoreWithEqualityFn(appState)` with two atomic selectors:
  - `activeNotePath` (load effect + header gate)
  - `openTabPathsSignature` (sorted path set only — title/pin/reorder no longer
    re-render Index)
- Removed `openTabsEqualIgnoringOrder` helper and `zustand/traditional` import.
- `FloatingNotePanel` resolves `pageFormat` from store default + `pageFormats`
  prop; Index no longer owns `defaultPageFormat` / `activePageFormat`.
- Warm-tab content effect reads `openTabs` via `getState()` keyed by path
  signature only.
- Remaining Index store renders: `activeNotePath` + `openTabPathsSignature`.
  Note switch still re-renders Index (load effect), but TabBar title updates
  and space chrome no longer cascade through it.

### Progress update — 2026-08-14 (activeNotePath out of Index render)

- `useActiveNoteLoader` is the sole owner of the active-note load pipeline and
  document/window title updates. The duplicate load effect in Index was removed.
- `NoteHeaderHost` (memo) owns visibility (`zenMode` / missing path) and
  `locked` resolution from `lockedNotePaths`; Index no longer reads
  `activeNotePath` in render.
- Index store selector is now only `openTabPathsSignature` (open-tab path set
  for warm yDoc/content). Warm tab switch should not re-render Index for path
  identity alone.
- Export title resolved via `getState()` + `noteTitleDrafts` (no `activeNoteTitle`
  render binding).
- Verification: `bunx tsc -b --pretty false` pass; `bun test` 6/0; `git diff --check`
  clean.
- Next: record React Scan / DevTools evidence for warm tab switch + cold open;
  continue thinning remaining Index local state that still forces shell renders
  (e.g. `noteContent` setState on cold path still cascades through Index).

### Progress update — 2026-08-14 (noteContent demoted to ref/cache)

- Removed Index `useState` for `noteContent` and write-only `loadedNotePath`.
- `useActiveNoteLoader` commits content via refs/caches only (`commitActiveContent`);
  UI readiness still goes through `markEditorReady` / save-status / notePreviews.
- Added `commitNoteContent` + `contentEpoch` so programmatic updates (replace,
  external workspace sync, rename title) refresh `ActiveNotePane` without a
  broad noteContent state object on Index.
- `useWorkspaceSession` no longer takes `noteContent` React state; uses
  `noteContentRef` + `commitNoteContent`.
- Cold load Index setState surface: `readyEditorPaths` (necessary for leaving
  loading fallback), optional `notePreviews` omit, editor-ui save status store.
- Verification: `bunx tsc -b --pretty false` pass; `bun test` 6/0; `git diff --check`
  clean. Index ~1.8k lines.
- Next: evidence React Scan; consider isolating `readyEditorPaths` ownership so
  cold-open setState does not re-render sidebar composition.

### Progress update — 2026-08-14 (prefetch + menu events extracted)

- Added  (warm/LRU, open-tab yDoc/content warm,
  idle space prefetch, active-space event).
- Added  (create-note/folder, note-setup/info,
  refresh-workspace, Escape zen, popout-closed).
- Index is now primarily route + hook wiring + shell composition.
- Index ~832 → ~494 lines (from original ~1675).
- Verification: bun test v1.3.13 (bf2e2cec) 6/0.
- Remaining for formal plan close: Phase 0 manual render-contract evidence.

### Progress update — 2026-08-14 (active-note actions → hook)

- Added  owning rename/delete/find-replace,
  title/format/content updates, tab select/fix/pin, export/copy/popout/info.
- Index wires the hook and keeps keyboard + composition only.
- Index ~1104 → ~832 lines.
- Verification: bun test v1.3.13 (bf2e2cec) 6/0.

### Progress update — 2026-08-14 (extract pure helpers + SaveStatusBadge)

- Extracted pure helpers out of Index:
  - 
  - 
  - 
-  /  import path helpers directly
  (no longer injected from Index).
-  → .
- Fixed  to read workspace from store (visibleSpaces was removed).
- Index ~1675 → ~1104 lines.
- Still remaining in Index: active-note commands (rename/delete/export/find-replace),
  prefetch/warm, menu wiring, composition.
- Verification: bun test v1.3.13 (bf2e2cec) 6/0.

### Progress update — 2026-08-14 (workspace → editor-ui store)

-  /  moved into .
- Index no longer holds workspace React state; hooks use .
-  reads  from the store (prop optional).
-  kept in sync via store subscription; idle prefetch re-runs on
  store workspace changes without Index re-render.
- Index route local React state is now essentially gone (only badge internals).
- Verification: bun test v1.3.13 (bf2e2cec) 6/0.

### Progress update — 2026-08-14 (contentEpoch / trash / folder-focus → store)

-  +  in editor-ui-store; ActiveNotePane subscribes.
-  +  in store; AppSidebar self-subscribes.
- Index local React state for note UI is now essentially only 
  (plus SaveStatusBadge internal state).
- Adapters: , ,
  .
- Verification: bun test v1.3.13 (bf2e2cec) 6/0.

### Progress update — 2026-08-14 (zenMode / pageFormats / lockedNotePaths → store)

- , ,  moved into .
-  also clears floating panel mode (side effect in store).
-  gate so Index does not subscribe to zenMode for sidebar hide.
- , , ,  self-subscribe.
- Single zen event listener kept on AppTitlebar (Index Escape only dispatches).
- Verification: bun test v1.3.13 (bf2e2cec) 6/0.

### Progress update — 2026-08-14 (notePreviews + titleDrafts → editor-ui store)

-  moved into  with functional .
- Unified Index  with store  via 
  bulk updater; live typing already used .
- Index no longer holds React state for previews/title drafts; hooks receive
   /  adapters.
-  is undecorated workspace tree only — title/preview overlays
  consumed per-row in AppSidebar (and title drafts in ActiveNotePane).
- Removed dead  /  helpers.
- Verification: bun test v1.3.13 (bf2e2cec) 6/0.

### Progress update — 2026-08-14 (floating panel → editor-ui store)

- Floating panel state (mode, visible, lastMode, findText, replaceText, noteInfoTarget)
  moved into . Opening find/replace/format/info no longer
  re-renders Index / shell / sidebar.
-  self-subscribes to the store; Index only passes
   + format/replace action callbacks.
-  reads  +  from the store
  (searchQuery/searchEnabled props removed).
- Open-panel keyboard/menu callbacks use  /
   so they stay identity-stable.
- Verification: bun test v1.3.13 (bf2e2cec) 6/0. Biome check clean on changed store/panel files.
- Remaining Index local state that still forces shell renders: workspace,
  notePreviews/titleDrafts/pageFormats, zenMode, lockedNotePaths, contentEpoch.

### Progress update — 2026-08-14 (readyEditorPaths → editor-ui store)

- `readyEditorPaths` moved into `useEditorUiStore` with `markEditorReady`,
  `unmarkEditorReady`, `retainReadyEditorPaths`.
- `ActiveNotePane` subscribes to `readyEditorPaths` itself; Index no longer
  holds this as React state or passes it as a prop.
- Cold open / prefetch / tab-warm mark-ready updates the store only → pane
  re-renders; Index/shell/sidebar stay cold unless open-tab path set or other
  Index-local state changes.
- `useNoteCommands.closeTab` calls `unmarkEditorReady` via getState.
- Verification: `tsc` pass; `bun test` 6/0; `git diff --check` clean.
- Remaining Index store selector: only `openTabPathsSignature`. Local state
  that still re-renders Index: workspace, notePreviews/titleDrafts/pageFormats,
  floating panel, zenMode, lockedNotePaths, contentEpoch (programmatic only).
- Next: React Scan evidence; optionally move floating-panel / notePreviews
  ownership further out of Index.

## Problem

`src/routes/_main/index.tsx` is still a ~3,500-line god component. It owns
workspace hydration, sidebar data, tab state, active-note loading, YDoc
caches, autosave, keyboard actions, titlebar actions, floating panels, and
the complete editor layout.

Changing `activeNotePath` can therefore make a large visual tree re-evaluate.
React Scan shows unrelated elements such as window controls in the render path
even though changing notes has no effect on minimize, maximize, or close.

The goal is selective rendering by ownership, not zero renders:

```text
sidebar note click
  ├─ active sidebar row + previous active row
  ├─ tab strip / active tab
  ├─ active note pane
  ├─ document title text
  └─ save status

must stay cold
  ├─ whole sidebar container
  ├─ unrelated note rows and tabs
  ├─ inactive TipTap editors
  ├─ app menu
  ├─ window controls
  ├─ export queue
  └─ sync indicator
```

## Non-negotiable render contract

| Interaction | Allowed to render | Must not render |
|---|---|---|
| Open cold note from sidebar | two affected sidebar rows, tab list, active-note pane, title text, save status | full sidebar, window controls, inactive editors, app menu |
| Switch between existing tabs | previous/next tab state, active-note pane, title text, save status | note I/O loader, YDoc loader, sidebar tree, window controls |
| Switch space | sidebar space/tree and active highlight | note pane, TipTap editors, tab strip, window controls |
| Type in note | TipTap internals and save status when it changes | sidebar tree, tab container, titlebar, window controls |
| Toggle sidebar | sidebar provider/sidebar layout only | note content/editor, titlebar state |
| Toggle read-only | one mounted note editor + read-only button | Index-wide shell, sidebar, window controls |

## Target architecture

```text
src/routes/_main/index.tsx
  ├─ route guard + thin composition
  ├─ session/actions wiring
  └─ AppShell
       ├─ SidebarRegion
       │    └─ AppSidebar (owns activeSpacePath and sidebar-only state)
       └─ WorkspaceRegion
            ├─ NoteHeader (tabs, save status, read-only, note actions)
            ├─ FloatingNotePanel
            └─ ActiveNotePane (active editor selection)
                 └─ mounted MemoNoteEditor instances
```

Recommended files:

- `src/components/app-shell.tsx` — layout slots and sidebar provider only.
- `src/components/note-header.tsx` — tabs, save status, read-only button,
  note actions, and note-scoped menus.
- `src/components/active-note-pane.tsx` — active note selection, loading
  fallback, editor visibility, and editor-specific props.
- `src/components/floating-note-panel.tsx` — find/replace/info/setup UI.
- `src/hooks/use-note-session.ts` — content/YDoc caches, deduped reads,
  warm-up, autosave, and ready-editor bookkeeping.
- `src/hooks/use-workspace-session.ts` — workspace hydration, external
  workspace changes, trash refresh, and workspace decorations.

`Index` should become route/auth, session composition, and stable command glue;
target under 500 lines of orchestration. Do not replace one god component with
a context whose value contains every state object and callback.

## State ownership rules

| State / behavior | Owner | Subscription rule |
|---|---|---|
| `activeSpacePath`, expanded folders, space ordering | sidebar store/components | sidebar rows and space chrome only |
| `openTabs`, active tab highlight | `TabBar` | tab strip only |
| active note path | `ActiveNotePane` + narrow header selectors | never consumed by window controls |
| note content/YDocs/in-flight reads | `useNoteSession` | refs/maps; expose narrow actions/results |
| save status | editor UI store | `SaveStatusBadge` only, plus required actions |
| read-only state | per-note editor controller | active editor + read-only toggle |
| find/replace/setup/info mode | `FloatingNotePanel` | panel only; editor gets search query |
| title string | title leaf | title leaf only |
| `closeButtonOnly` | titlebar/window-control state | `WindowControls` only |
| workspace snapshot/decorations | workspace/sidebar session | sidebar only after extraction |

## Implementation phases

### Phase 0 — Capture baseline and map dependencies

1. Record React Scan/DevTools behavior for cold sidebar open, warm tab switch,
   space switch, typing one character, and sidebar toggle.
2. Map every `Index` state variable, effect, callback, and rendered branch to
   sidebar, workspace, note session, header, panel, or global ownership.
3. Keep the existing React Doctor baseline and scanner version.

**Exit criteria:** baseline evidence exists and no behavior changes are made.

### Phase 1 — Extract the note session without changing visuals

1. Move content/YDoc caches and in-flight promise dedupe into
   `use-note-session.ts`.
2. Move active-note loading, warm-tab loading, prefetch, LRU cleanup, and
   ready-editor tracking with it.
3. Preserve stable actions such as `prefetchNote`, `markEditorReady`, save
   actions, and live-content snapshot registration.
4. Preserve the one-request-per-path guarantee for `readNote` and `readYNote`.

**Verify:** typecheck, tests, cold open, warm tab switch, autosave, and Yjs.

### Phase 2 — Extract `ActiveNotePane`

1. Move the editor stack and loading fallback to
   `src/components/active-note-pane.tsx`.
2. Subscribe there only to fields needed to choose the active note.
3. Keep inactive editors mounted only where required for tab persistence, but
   keep them out of layout/paint with the existing hidden strategy.
4. Keep `MemoNoteEditor` comparison focused on editor inputs and stable props.

**Verify:** switching tabs updates only the old/new active editor boundary;
inactive TipTap instances do not remount or rebuild.

### Phase 3 — Extract `NoteHeader` and `FloatingNotePanel`

1. Move the large header JSX out of `Index`.
2. Make `NoteHeader` subscribe to active tab/title/save/read-only state itself.
3. Move floating panel state and JSX into `FloatingNotePanel`; search changes
   must not invalidate the sidebar or window controls.
4. Keep note actions stable through store actions or stable callbacks.

**Verify:** note switch updates tab/header/editor only; panel interactions stay
local to the panel/editor paths that need them.

### Phase 4 — Extract shell and isolate titlebar/window controls

1. Create `AppShell` with sidebar and workspace as sibling slots.
2. Keep `AppTitlebar` outside the note workspace subtree.
3. Keep `WindowControls` fed only `closeButtonOnly` and memoized.
4. Do not dispatch a window-control state event on every note switch; dispatch
   only when `closeButtonOnly` changes.
5. If title updates still evaluate the whole titlebar, split `WindowTitle` into
   its own leaf and keep controls/menu as independent siblings.

**Verify:** title changes update `WindowTitle`; window controls do not render
for sidebar open or tab switch.

### Phase 5 — Thin `Index` and remove prop plumbing

1. Remove obsolete `appState` reads from `Index` after each owner has its own
   selector.
2. Replace broad `setAppState` updates with targeted store actions where safe.
3. Move workspace/trash/external-sync effects into the workspace session hook.
4. Keep only route auth, composition, and stable cross-boundary commands in
   `Index`.

**Exit criteria:** `Index` is composition/glue, not the owner of every visual
state transition.

## Verification matrix

Run after every phase:

```bash
bunx tsc -b --pretty false
bun test
git diff --check
```

After each React change:

```bash
bunx react-doctor --json --blocking none --yes --scope changed --base HEAD
```

Manual/DevTools checks:

- cold sidebar open: two row transitions, one tab insertion, one active pane
  load; no window-control render;
- warm tab switch: no read/load request, no loading fallback, no inactive
  editor remount;
- space switch: sidebar only;
- typing: no sidebar/header/window-control render per keystroke;
- read-only toggle: active editor and toggle only;
- close/minimize/maximize, autosave, Yjs, title rename, preview/fixed tabs,
  keyboard shortcuts, and DnD remain functional.

## STOP conditions

- Note content or Yjs updates are lost.
- Warm tab switch regresses to disk/IPC loading.
- Cold note open makes duplicate reads for one path.
- Sidebar DnD, preview/fixed tabs, or keyboard shortcuts regress.
- A context/provider value recreates broad subscriptions.
- Typecheck fails because of the extraction and cannot be isolated.
- The only way to pass is suppressing a real rerender or correctness issue.

## Done criteria

- [ ] `Index` is reduced to route/session composition and stable command glue.
- [ ] `ActiveNotePane`, `NoteHeader`, and `AppShell` are separate boundaries.
- [ ] Cold sidebar open renders only the allowed components in the contract.
- [ ] Warm tab switch does not render sidebar, window controls, or inactive
      editors.
- [ ] Space switch does not render the workspace/editor tree.
- [ ] Window controls do not render when only the note title changes.
- [ ] No duplicate `readNote`/`readYNote` request for one path in flight.
- [ ] `bunx tsc -b` passes and existing tests pass.
- [ ] React Doctor changed scan has no new error diagnostics.
- [ ] Manual render evidence is recorded in this plan or a linked baseline.
