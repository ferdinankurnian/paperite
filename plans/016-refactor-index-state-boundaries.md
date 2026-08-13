# Plan 016: Refactor Index into selective-render boundaries

## Status

- **Priority:** P0
- **Effort:** XL
- **Risk:** HIGH
- **Depends on:** 008, 009, 013 Phase B, 015
- **Category:** performance / architecture
- **Planned at:** 2026-08-14
- **Status:** TODO

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
