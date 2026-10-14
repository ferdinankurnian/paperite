# Plan 008: Finish the re-render / performance pass (picking up from Grok)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat -- src/components/note-editor.tsx src/routes/_main/index.tsx src/components/app-sidebar.tsx src/components/app-titlebar.tsx`
> This plan was written against the current uncommitted working tree (not a
> specific commit), because the previous session (a different agent) left
> real, uncommitted, half-finished changes in these exact files. Read the
> "Current state" section carefully — it describes what's already been
> changed, not the original codebase.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: MED
- **Depends on**: none (but do this before 006/007 — they touch the same
  files this plan is mid-editing)
- **Category**: bug
- **Planned at**: 2026-07-28, against uncommitted working tree

## Why this matters

User-reported, screenshot-documented complaints, all pointing at the same
root cause:

- Typing in a note is laggy — "it did rerender the whole page to just type"
- Bullet/numbered list markers don't show up
- Clicking into the editor area rerenders
- Switching spaces rerenders the whole app
- Opening/closing a sidebar folder rerenders the sidebar, then the whole
  app — twice
- Switching tabs rerenders the whole app
- Toggling read-only/edit view rerenders the whole app
- Toggling the sidebar rerenders the whole app
- Opening note info/setup rerenders the whole app

A previous agent session (Grok, via its CLI) was asked to investigate this
and correctly diagnosed the core problem: **note content lives in the root
`Index` component's state, so every keystroke (and most other interactions)
triggers a re-render starting from the top of the tree**, cascading through
components that have no reason to re-render on every keystroke. That
session started fixing it but hit a rate limit mid-way — some of the fix
landed, some didn't, and it left one likely regression. This plan finishes
the job.

## Current state — what's already been done (uncommitted, on disk right now)

1. **List markers fixed.** `src/index.css` — the previous session added
   explicit `list-disc`/`list-decimal`/`pl-6` rules for
   `.paperite-tiptap .paperite-prosemirror ul/ol/li`, since Tailwind's
   preflight resets `list-style: none` globally and nothing was restoring
   it for editor content. This looks correct and complete — verify visually
   (Step 1) but likely no further work needed here.

2. **`updateNoteContent` now takes an `isUserEdit` flag.**
   `src/routes/_main/index.tsx`, `updateNoteContent` (~line 1701) was
   changed from `(nextContent, sourceNotePath)` to
   `(nextContent, sourceNotePath, isUserEdit: boolean)`, with different
   handling at ~line 1716 depending on the flag. **Before continuing, find
   every call site of `updateNoteContent` and confirm each one passes the
   correct `isUserEdit` value** — this is exactly the kind of thing that
   breaks silently in a half-finished refactor. `bunx tsc -b` currently
   passes with no error in this file, which means all call sites at least
   pass *a* boolean, but confirm the *values* are semantically correct
   (local typing = `true`, incoming sync/external update = `false`).

3. **`scheduleNoteAutosave`, `selectTab`, `setActiveSpacePath`,
   `toggleReadOnly`, and the `SidebarProvider` `onOpenChange` handler** in
   `src/routes/_main/index.tsx` were also touched. Read the current version
   of each (not the original) before touching this file further — the
   previous session's intent was to stop these from forcing a full
   top-of-tree re-render on every call, but confirm what actually landed
   vs. what was only read/explored.

4. **`FormatMenu` in `src/components/note-editor.tsx` was refactored** to
   receive `notePath` as a prop (needed for the image-paste work in plan
   002) and the old `toolbarVersion` state + its
   `onSelectionUpdate: () => setToolbarVersion((v) => v + 1)` re-render
   trigger were **removed entirely**.

## ⚠️ Regression introduced by the previous session — fix this first

`FormatMenu` still computes button active-states via `editor.isActive(...)`
(bold/italic/underline/heading/list/etc. — confirmed present, ~line
1269-1291), but the mechanism that used to make `FormatMenu` re-render when
the cursor moves or the selection's formatting changes (`onSelectionUpdate`
→ `setToolbarVersion`) was deleted **without a replacement**. There is no
`useEditorState` call anywhere in the file either. Net effect: toolbar
button highlighting (bold/italic/etc. showing as "active") will likely now
only update when something *else* happens to re-render `FormatMenu` (e.g.
typing), not when the user just clicks/arrows into differently-formatted
text without typing. This needs to be fixed properly, not by re-adding the
old `toolbarVersion` pattern (that was the over-broad mechanism causing the
lag in the first place).

### Step 1: Fix toolbar reactivity with `useEditorState`, scoped to `FormatMenu` only

Use TipTap's `useEditorState` hook (already available — `@tiptap/react` is
a direct dependency) inside `FormatMenu` to subscribe only to the specific
active-mark/node booleans the toolbar buttons need:

```ts
const toolbarState = useEditorState({
    editor,
    selector: (ctx) => ({
        bold: ctx.editor.isActive("bold"),
        italic: ctx.editor.isActive("italic"),
        underline: ctx.editor.isActive("underline"),
        strike: ctx.editor.isActive("strike"),
        highlight: ctx.editor.isActive("highlight"),
        blockquote: ctx.editor.isActive("blockquote"),
        codeBlock: ctx.editor.isActive("codeBlock"),
        heading1: ctx.editor.isActive("heading", { level: 1 }),
        heading2: ctx.editor.isActive("heading", { level: 2 }),
        heading3: ctx.editor.isActive("heading", { level: 3 }),
        paragraph: ctx.editor.isActive("paragraph"),
        bulletList: ctx.editor.isActive("bulletList"),
        orderedList: ctx.editor.isActive("orderedList"),
        taskList: ctx.editor.isActive("taskList"),
        // ...match whatever the existing `commandIsActive`-style switch
        // in this file currently checks, one boolean per branch.
    }),
});
```

Replace the direct `editor.isActive(...)` calls used for button styling
with reads from `toolbarState`. This makes only `FormatMenu` re-render on
selection/formatting changes — not the editor content tree, not `Index`,
not the sidebar. This is the correct fix the previous session was likely
heading toward but didn't reach.

**Verify**: click into bold text, italic text, a heading, a list item (each
without typing) — toolbar buttons should immediately reflect the correct
active state.

### Step 2: Confirm `updateNoteContent`'s `isUserEdit` call sites are correct

Grep every call site of `updateNoteContent` in `_main/index.tsx` and
confirm the boolean passed matches "did the user just type this" vs. "this
is an incoming sync/external update." Fix any that look inverted or
hardcoded to the wrong value.

**Verify**: `bunx tsc -b` → exit 0 (should already pass; this step is a
semantic check, not a type check).

### Step 3: Stop the top-level cascade for the remaining interactions

For each of these, confirm whether the fix already landed or still needs
work — check the *current* code, don't assume from the transcript:

- **Space switch** (`setActiveSpacePath`) — should only affect the active
  space indicator + sidebar content, not remount/rerender `NoteEditor` or
  `AppTitlebar`.
- **Folder expand/collapse** (`toggleFolder`/`expandedFolders`) — sidebar
  already has internal memoization (`MemoizedNoteTree`,
  `MemoizedFolderChildren`, `MemoizedNoteFolderItem`, `MemoizedNoteCard` in
  `app-sidebar.tsx`), but `AppSidebar` itself and `AppTitlebar` are **not**
  wrapped in `React.memo` — only `NoteEditor` is (`MemoNoteEditor`, line 44
  of `_main/index.tsx`). Since `expandedFolders` lives in the same
  top-level `appState` as everything else, any change to it still
  re-executes `Index`, which re-executes `AppSidebar` and `AppTitlebar` as
  plain function calls regardless of their own memoization — memoizing
  their *children* doesn't stop *them* from re-running. Consider wrapping
  `AppSidebar` and `AppTitlebar` in `React.memo` too, but first confirm
  their props are actually stable (inline object/array/function literals
  passed as props will defeat `memo()` even if you add it — check for
  props like `spaceColorsByPath`, `spaceIconsByPath`, callback props, etc.
  being recomputed inline on every `Index` render instead of via
  `useMemo`/`useCallback`).
- **Tab switch** (`selectTab`) — only `activeNotePath` should need to
  change; confirm `MemoNoteEditor`'s props don't include anything that
  changes identity on every render (a fresh object/array/function literal
  passed inline breaks `memo()` silently — this is the most likely reason
  "whole app rerenders" persists even where memoization already exists).
- **Read-only toggle** (`toggleReadOnly`) — should only affect the editor
  and the toolbar's read-only-dependent bits.
- **Sidebar toggle** (`SidebarProvider`'s `onOpenChange`) — should only
  affect sidebar layout, not the editor or titlebar.
- **Note info/setup panel** (`floatingPanelMode`) — should only affect
  whichever panel component renders, not the editor content itself.

For each, the general technique is the same: identify what state actually
needs to change, confirm it's not forcing a re-render of unrelated
memoized children by passing them new object/array/function identities on
every render, and wrap the relevant read/write path in `useMemo`/
`useCallback` with correct dependency arrays where it currently isn't.

**Do not do a large speculative rewrite.** For each interaction, verify
with React DevTools' Profiler (record a interaction, check which
components actually re-rendered and why) before changing code — this repo
now has the `react-doctor` skill available
(`skills/react-doctor/SKILL.md`, installed by the previous session), which
can run `npx react-doctor@latest --verbose --scope changed` after each
step to catch regressions; use it as a checkpoint, not a replacement for
actually profiling the specific interactions listed above.

### Step 4: Verify

**Verify**: `bun run lint` (scoped to `src`, see note below), `bunx tsc -b`
→ both exit 0.

> Note: `bun run lint` as currently configured also lints `bun.lock` and
> reports thousands of unrelated Tailwind-CSS-directive false positives
> across the whole `src/index.css` file (a pre-existing `biome.json`
> config gap — `css.parser.tailwindDirectives` isn't enabled). This isn't
> new and isn't blocking, but if it makes it hard to see real issues from
> this plan's changes, run `bunx biome check src main.js preload.js
> --max-diagnostics=200` instead to scope it down.

## Test plan

No test suite exists for render behavior. Manual verification using React
DevTools Profiler (or `react-doctor`'s scoped scan) for each item:

1. Type continuously in a note — no visible lag, editor content area
   doesn't cause sidebar/titlebar re-renders.
2. Bullet and numbered lists render their markers.
3. Click into the editor without typing — no unnecessary re-render.
4. Switch spaces — sidebar updates, editor/titlebar don't re-render.
5. Expand/collapse a folder — only sidebar re-renders, once (not twice).
6. Switch tabs — only the editor's content and active-tab indicator
   update.
7. Toggle read-only/edit — only the editor and toolbar update.
8. Toggle the sidebar open/closed — only layout updates.
9. Open note info/setup — only that panel mounts.
10. Toolbar button active-states (bold/italic/heading/list/etc.) update
    correctly when clicking into differently-formatted text, without
    typing (this is the regression check for Step 1).

## Done criteria

ALL must hold:

- [ ] `bunx tsc -b` exits 0
- [ ] Toolbar active-states update on click/cursor-move without typing
      (Step 1 regression fixed)
- [ ] All 9 symptoms from the original screenshot re-tested individually
      and confirmed fixed or explicitly noted as still-open with a reason
- [ ] `isUserEdit` call sites semantically correct, not just type-correct

## STOP conditions

- Any call site of `updateNoteContent` where it's unclear whether
  `isUserEdit` should be `true` or `false` — stop and report rather than
  guessing; getting this wrong risks autosave/sync misbehavior, which is
  worse than the lag this plan is fixing.
- Memoizing `AppSidebar`/`AppTitlebar` requires restructuring a large
  number of props to be stable (deep prop-drilling refactor) — stop and
  report the scope rather than doing a sweeping rewrite of
  `_main/index.tsx`'s state shape in this plan.

## Maintenance notes

- This plan intentionally does not touch `src/components/app-sidebar.tsx`
  beyond reading it — that file currently has an unrelated pre-existing
  TypeScript error (`onEditSpace` prop missing on `NavMain` usage, line
  ~1882) that predates this session and isn't caused by anything in this
  plan. It's out of scope here; see the separate note raised outside this
  plan file about the build currently failing `tsc -b` for reasons
  unrelated to performance work.
