# Plan 006: Split "fixed" (double-click) from real "pinned" tabs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 975b6a5..HEAD -- src/routes/_main/index.tsx src/components/app-sidebar.tsx src/lib/storage/types.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: feature
- **Planned at**: commit `975b6a5`, 2026-07-28

## Why this matters

Today, `OpenNoteTab` has a single `preview: boolean` field: single-click
opens a note as an italic "preview" tab, double-click (or typing in it, per
plan `001-pin-preview-tab-on-edit.md`) sets `preview: false`, which the code
calls "pinned." That behavior itself is correct and should be kept exactly
as-is — it's just misnamed. Real tab pinning is a distinct, separate
feature that doesn't exist yet: right-click a tab → "Pin Tab" → the tab's
close button becomes a pin icon → clicking that icon unpins it. Keeping both
concepts under the name "pinned" will make the real pin feature and the
existing preview/fixed behavior impossible to reason about together.

## Current state

- `src/lib/storage/types.ts`: `OpenNoteTab = { path: string; title: string; preview: boolean }`
- `src/routes/_main/index.tsx`:
  - `SortableTab` (line 136) renders each tab; `data-preview={note.preview}`
    drives the italic/opacity styling; a single `XIcon` close button (line
    195) is always the close action.
  - `pinTab` (~line 1832) sets `preview: false` for a tab by path — this is
    the "double-click to fix" action, wired to `onDoubleClick={() => pinTab(note.path)}`
    at the tab list render site (~line 1963).
  - Tabs are rendered via `dnd-kit`'s `SortableContext`/`useSortable`
    (already imported) inside a `DndContext` — no `ContextMenu` currently
    wraps a tab.
- `src/components/app-sidebar.tsx`: `onOpenNote(note, mode: "preview" | "pinned")`
  is the prop type used when opening a note from the sidebar; `"pinned"` here
  means "open as a fixed tab," matching the same overloaded terminology.
- `src/components/ui/context-menu.tsx` already exists (shadcn primitive) —
  no new dependency needed for the right-click menu.

## Scope

**In scope:**
- `src/lib/storage/types.ts`
- `src/routes/_main/index.tsx`
- `src/components/app-sidebar.tsx` (rename only, see Step 1)

**Out of scope:**
- Any change to tab drag-reorder behavior. Pinned tabs are not required to
  be reorder-restricted or grouped to the left in this plan — if that's
  wanted later, it's a separate follow-up. Leave `dnd-kit` config untouched.
- Persisting `pinned` across app restarts is in scope (it should survive a
  restart, same as `openTabs` already does) — but do not add any new
  cross-device sync for it; it's local UI state like the rest of `PaperiteAppState`.

## Steps

### Step 1: Rename "pinned" → "fixed" everywhere it currently means "not preview"

This is a pure rename, no behavior change:
- `app-sidebar.tsx`: `mode: "preview" | "pinned"` → `mode: "preview" | "fixed"`,
  update the call sites that pass `"pinned"` to pass `"fixed"`.
- `_main/index.tsx`: rename the `pinTab` function to `fixTab` (or similar),
  update its call site (`onDoubleClick={() => fixTab(note.path)}`) and the
  plan-001 auto-fix-on-edit logic in `updateNoteContent` that also flips
  `preview: false`.
- Do not rename the `OpenNoteTab.preview` field itself — it's accurate as
  named (a tab is either in preview mode or not).

**Verify**: `bun run lint` && `bunx tsc -b` → both exit 0. No behavior
should differ yet.

### Step 2: Add a real `pinned` field

In `src/lib/storage/types.ts`:

```ts
export type OpenNoteTab = {
    path: string;
    title: string;
    preview: boolean;
    pinned: boolean;
};
```

Update `defaultAppState`/tab-creation call sites in `_main/index.tsx` to
initialize `pinned: false` wherever a new `OpenNoteTab` is constructed.

### Step 3: Add pin/unpin actions

In `_main/index.tsx`, add a `togglePinTab(notePath: string)` callback
following the exact pattern of the existing `fixTab`/`pinTab` function —
`setAppState` mapping over `openTabs`, flipping `pinned` for the matching
tab by path.

### Step 4: Wire the right-click context menu

Wrap each `SortableTab`'s root `<div>` (or the tab button specifically —
whichever keeps the drag handle working) in a `ContextMenu`/`ContextMenuTrigger`/`ContextMenuContent`
from `@/components/ui/context-menu`, with a single item:

```tsx
<ContextMenuItem onSelect={() => togglePinTab(note.path)}>
    {note.pinned ? "Unpin Tab" : "Pin Tab"}
</ContextMenuItem>
```

Pass `pinned` down through `SortableTabProps` (currently `note`, `isActive`,
`displayTitle`, `onSelect`, `onDoubleClick`, `onClose` — add `onTogglePin`
following the same prop-callback pattern rather than passing `setAppState`
down directly).

### Step 5: Swap the close button for a pin icon when pinned

In `SortableTab`, the close `<button>` (line ~185-197 today) currently
always renders `<XIcon />`. Change it to:

```tsx
<button
    type="button"
    aria-label={note.pinned ? `Unpin ${displayTitle(note.title)}` : `Close ${displayTitle(note.title)}`}
    className={/* existing classes */}
    onClick={(event) => {
        event.stopPropagation();
        if (note.pinned) {
            onTogglePin();
        } else {
            onClose();
        }
    }}
>
    {note.pinned ? <PinIcon className="size-3.5" /> : <XIcon className="size-3.5" />}
</button>
```

`PinIcon` is already imported elsewhere in the codebase from `lucide-react`
(confirmed in `app-sidebar.tsx`) — import it in `_main/index.tsx` as well.
Consider whether the pin icon should stay visible at all times for pinned
tabs (unlike the close button, which only shows on hover/active via the
existing `opacity-0 group-hover:opacity-65` classes) — a pinned tab is
arguably meant to be a persistent visual signal, not something you have to
hover to notice. Default to keeping it always visible when `pinned` is
true; flag this as a judgment call in the PR description rather than a hard
requirement.

### Step 6: Verify

**Verify**: `bun run lint` → exit 0, `bunx tsc -b` → exit 0

## Test plan

No test suite covers tab UI. Manual verification:

1. Open a note, single-click from sidebar → preview (italic) tab, as before.
2. Double-click a tab (or start typing in a preview tab) → becomes fixed
   (non-italic), as before — confirms Step 1 didn't change behavior.
3. Right-click a tab → context menu shows "Pin Tab". Click it.
4. Pinned tab's close button becomes a pin icon, stays visible (not just on
   hover).
5. Click the pin icon → tab unpins, close button reverts to `X`.
6. Restart the app → pinned state persists (same persistence mechanism as
   `openTabs` already uses).
7. Drag-reorder still works for both pinned and unpinned tabs.

## Done criteria

ALL must hold:

- [ ] `bun run lint` exits 0
- [ ] `bunx tsc -b` exits 0
- [ ] "Fixed" (double-click) behavior unchanged after the rename
- [ ] Right-click → Pin Tab works; pin icon replaces close button
- [ ] Clicking the pin icon unpins and restores the close button
- [ ] Pinned state survives an app restart

## STOP conditions

- The code at the locations in "Current state" doesn't match (drift).
- Wrapping `SortableTab` in `ContextMenu` breaks `dnd-kit`'s drag handle
  (`{...attributes} {...listeners}`) — if so, stop and report rather than
  restructuring the drag implementation; this needs a decision on whether
  the context menu trigger area should exclude the drag handle region.
