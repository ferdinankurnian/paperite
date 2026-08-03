# Plan 013: Optimize it 100x — make Paperite feel like Obsidian

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> ```bash
> git log --oneline -5
> wc -l src/routes/_main/index.tsx src/components/app-sidebar.tsx src/components/note-editor.tsx
> ```
> Confirm plans 008 + 009 are still applied (YDoc cache + isUserEdit path).
> If the giant `Index` component has been substantially rewritten since plan
> 010, re-read the current state section before touching anything.

## Status

- **Priority**: P0
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: 008 (rerender pass), 009 (YDoc cache) — both DONE
- **Category**: performance / architecture
- **Planned at**: 2026-08-03

## Why this matters

User feedback (2026-08-03):

> "holy shit this paperite is mess.. like it always lags and not optimized,
> i want it like obsidian that actually instant and fast"

Plans 008 + 009 fixed the worst typing lag and the "Loading note..." flash
on tab switch. That was necessary but not sufficient. The app still does not
feel *instant*. Obsidian opens notes, switches files, and searches in
sub-16ms with thousands of notes. Paperite still has a monolithic React tree,
a giant `appState` object in the root route, and no virtualization.

Goal: make the common path (open note, type, switch tab, search, expand
folder) feel as snappy as Obsidian. Not "better than before" — *instant*.

## Current architecture (bottlenecks)

| Area | Problem |
|------|--------|
| **Root state** | Almost everything lives in `appState` inside `src/routes/_main/index.tsx` (likely 2k–3k+ lines). Any `setAppState` can cascade. |
| **Sidebar** | Renders full note tree. No virtualization. Large spaces = expensive. `AppSidebar` itself is still not `React.memo`'d (STOP condition from 008). |
| **Editor isolation** | `MemoNoteEditor` exists, but props + surrounding tree still cause avoidable work. TipTap + Yjs is heavy; every extra React render around it costs. |
| **IPC / disk** | `loadYNote` / note reads go through Electron IPC. First open of a note still hits disk every time. No aggressive prefetch. |
| **Search** | SQLite FTS exists in main process, but UI path and result rendering are unknown-latency. |
| **No performance budget** | No FPS / interaction timing guards. No React Profiler baseline recorded in-repo. |

Obsidian wins because:
1. File open is pure local I/O + minimal DOM work.
2. Lists are virtualized.
3. Editor is isolated (CodeMirror) and does not re-render the whole shell.
4. Search index is always warm and results are cheap to paint.
5. Almost no global reactive state that invalidates the whole UI.

We cannot become CodeMirror overnight, but we *can* isolate TipTap, kill
global cascades, virtualize the tree, and make first-paint + switch paths
sub-frame.

## Scope

**In scope (this plan):**
1. Split root state out of `_main/index.tsx` into focused stores.
2. Finish what plan 008 deferred: stable props + `React.memo` on
   `AppSidebar` / `AppTitlebar` / tab bar.
3. Virtualize the note tree (and optionally the open-tabs strip if long).
4. Prefetch + keep-warm strategy for open tabs and recently used notes.
5. Measure: add a lightweight perf harness so we can prove "instant".

**Out of scope (future plans):**
- Replacing TipTap with CodeMirror / Lexical
- Rewriting storage to pure Markdown files
- Full offline SQLite in renderer
- Mobile (paperite-rn)
- Convex collab latency

## High-level phases

### Phase A — Measure & freeze baseline (do first, no behavior change)

1. Install / enable existing tools already in package.json:
   - `react-scan` (already a dep)
   - `react-doctor` script already exists (`bun run doctor`)
2. Record a short baseline of:
   - Typing 50 continuous characters in a medium note
   - Switching between 5 open tabs
   - Expanding a folder with 100+ notes
   - Opening a cold note from sidebar
3. Dump results into `plans/013-baseline.md` (commit it) so later steps
   have a before/after number.

**Verify**: baseline file exists; numbers are reproducible on the same machine.

### Phase B — State surgery (biggest win)

The root problem is the same one 008 identified: one big `appState` in
`Index` forces too many components to re-evaluate.

**Target shape:**

```
useAppStore      → openTabs, activeNotePath, activeSpacePath, expandedFolders, ...
useEditorStore   → loadedYNoteCache, saveStatus, readOnlyNotes, floatingPanelMode
useSidebarStore  → (or keep expandedFolders local to sidebar if possible)
```

Prefer a tiny store library already common in React 19 ecosystems:
- **Zustand** (simplest, no provider hell) — recommended
- or Jotai if atom-level granularity is preferred

Do **not** invent a custom context mega-provider.

**Steps:**
1. Add `zustand` dependency.
2. Extract `openTabs` / `activeNotePath` / `activeSpacePath` / `expandedFolders`
   into `src/lib/stores/app-store.ts` with selective subscriptions
   (`useAppStore(s => s.activeNotePath)`).
3. Move YDoc cache + save status into `src/lib/stores/editor-store.ts`.
4. Slim `src/routes/_main/index.tsx` to composition only: mount stores,
   wire effects, render layout. Goal: under ~800 lines of real logic.
5. Replace every `setAppState(prev => ...)` that only touches one field with
   a targeted store action.

**STOP if**: any sync / autosave / Yjs path breaks. Revert that slice and report.

**Verify**:
- `bunx tsc -b` clean
- Typing no longer causes sidebar re-renders (React Profiler / react-scan)
- Tab switch still instant (plan 009 cache still works)

### Phase C — Memo walls & stable props (finish 008's STOP)

Plan 008 explicitly stopped before memoizing `AppSidebar` / `AppTitlebar`
because props were unstable. With stores, most callbacks become stable.

1. Wrap `AppSidebar`, `AppTitlebar`, tab strip, and any remaining heavy
   children in `React.memo`.
2. Audit every prop: no inline `{}` / `[]` / `() =>` that change identity
   every render. Use `useCallback` / `useMemo` or store actions.
3. Confirm with Profiler: expanding a folder re-renders *only* the sidebar
   subtree, once.

**Verify**: same interaction list from plan 008 test plan — all green.

### Phase D — Virtualize the note tree

Large spaces are the silent killer. Even with memoization, mounting 500+
note rows is slow.

1. Use `@tanstack/react-virtual` (or `react-window` if preferred; TanStack
   matches existing TanStack Router usage).
2. Virtualize folder children in `app-sidebar.tsx` / `nav-main.tsx`.
3. Keep expand/collapse state; only mount visible rows + overscan (~8–12).
4. Preserve DnD if present (`@dnd-kit` is already a dependency) — virtual
   lists + DnD is non-trivial; if conflict is severe, virtualize first without
   DnD, then restore DnD in a follow-up plan.

**Verify**:
- Space with 300+ notes expands without jank
- Scroll stays 60fps on target machine
- Click-to-open note still works and focuses editor

### Phase E — Prefetch & keep-warm

Obsidian feels instant partly because the next file is often already in RAM.

1. On tab open / hover (debounced), prefetch plain content + YDoc into the
   existing caches (`noteContentCache`, `loadedYNoteCache`).
2. LRU-evict closed tabs and notes not in openTabs (cap e.g. 15–25 warm
   docs) so memory does not grow forever.
3. Sidebar "recent" or last-active space: warm the first N notes on space
   switch (idle callback / `requestIdleCallback`).

**Verify**:
- Second open of a recently viewed note has zero "Loading note..."
- Memory stays bounded after opening/closing 50 notes

### Phase F — Search & first paint polish

1. Confirm FTS path is IPC-only and results are not re-parsed heavily in
   renderer. If result list is long, virtualize it too.
2. Ensure cold start path (app launch → first note visible) avoids serial
   waterfalls: load app state + last active note in parallel where safe.
3. Defer non-critical UI (export queue, collab indicators, Clerk profile)
   with `startTransition` / lazy mounts so the editor paints first.

### Phase G — Guardrails

1. Add a simple `PERF.md` or extend this plan's baseline file with target
   budgets:
   - Keystroke → paint: < 16ms p95
   - Tab switch (warm): < 50ms to interactive
   - Folder expand (100 items): < 100ms to stable
2. Keep `react-scan` / doctor available in dev so regressions are obvious.
3. Optional: CI smoke that just boots and loads one note (no full e2e yet).

## Suggested execution order

1. Phase A (baseline) — 1 session
2. Phase B (stores) — largest risk/reward; do carefully
3. Phase C (memo walls) — natural follow-on to B
4. Phase D (virtualization)
5. Phase E (prefetch)
6. Phase F + G (polish + budgets)

Do not skip A. Without numbers we will argue about "feels faster".

## Test plan (manual + tools)

After each phase:

1. Type continuously for 30s — no visible lag, no sidebar flash
2. Open 8 tabs, switch randomly — always instant when warm
3. Expand folder with many notes — smooth
4. Search for a common word — results appear quickly, list scrolls smoothly
5. Close all tabs, reopen last note — still acceptable cold path
6. `bunx tsc -b` clean
7. `bunx biome check src main.js preload.js` — no new errors introduced
8. react-scan / Profiler: confirm expected component isolation

## Done criteria

ALL must hold:

- [ ] Baseline numbers recorded before major changes
- [ ] Root `appState` god-object eliminated or reduced to thin shell
- [ ] Selective store subscriptions; typing does not re-render sidebar/titlebar
- [ ] `AppSidebar` + `AppTitlebar` memoized with stable props
- [ ] Note tree virtualized for large folders
- [ ] Warm tab switch remains zero-loading (plan 009 preserved)
- [ ] Prefetch keeps recent notes warm; memory bounded
- [ ] Subjective: "feels like Obsidian" on the author's machine for the
      core loop (open / type / switch / search)
- [ ] `tsc -b` clean; no new lint debt in touched files

## STOP conditions

- Yjs sync, autosave, or collab awareness regresses — stop, revert the
  store slice that caused it, report.
- Virtualization breaks DnD or folder expand semantics in a way that needs
  a multi-day redesign — stop and split DnD into its own plan.
- Zustand (or chosen store) introduction requires rewriting > half of
  `_main/index.tsx` with unclear ownership — pause and re-scope rather than
  a big-bang rewrite in one PR.
- Any step fails verification twice after a reasonable fix — stop and report.

## Maintenance notes

- This plan is intentionally architectural. Prefer small, reviewable commits
  per phase (A → G) rather than one mega-diff.
- Keep plan 009's `loadedYNoteCache` semantics intact; only move ownership
  into the editor store.
- If TipTap itself becomes the next bottleneck after this work (ProseMirror
  transaction cost), that is a *separate* plan (editor engine evaluation),
  not an excuse to expand this one.
- Update `plans/README.md` status table when this lands (or when a phase is
  intentionally deferred).
