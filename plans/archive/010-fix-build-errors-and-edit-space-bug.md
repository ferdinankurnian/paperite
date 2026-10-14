# Plan 010: Fix build-breaking type errors, silent Edit Space bug, and add a `tsc` gate to CI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git -C paperite status --short` and
> `git -C paperite diff --stat 755483e -- src/vite-env.d.ts src/components/app-sidebar.tsx src/components/export-queue.tsx src/components/note-editor.tsx src/lib/storage/electron-storage.ts src/routes/_main/index.tsx src/lib/storage/web-storage.ts .github/workflows/ci.yml`
> As of writing this plan, `HEAD` is `755483e` and the working tree already
> has **uncommitted** changes implementing most of this plan (see
> "Already-applied fixes" below). If your `git status --short` is clean
> (no output) instead, someone already committed this work (check
> `git log --grep="010"` / `git log -- src/vite-env.d.ts`) or it was
> reverted — either way, re-verify against the live code before assuming
> anything below still needs doing. If the working tree has changes but
> they don't match the diffs described below, treat it as drift: compare
> "Current state" against the live code before proceeding.

## Status

- **Priority**: P0
- **Effort**: S (most of the fix is already written, uncommitted, in the
  working tree — see below)
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `755483e`, 2026-07-30

## Why this matters

The production build is broken (`bunx tsc -b` fails), but CI cannot catch
this because `.github/workflows/ci.yml` never runs `tsc` at all — it only
runs `bunx biome check ... || true` (the trailing `|| true` means even a
failing lint still exits 0) and `bun test`. `bun run build` *does* invoke
`tsc -b` locally (`"build": "tsc -b && vite build && electron-builder"` in
`package.json`), so the breakage is real and would fail a local production
build — it just isn't caught automatically on every push/PR.

Investigation (this session and the prior one) found two distinct root
causes behind the reported `tsc` errors, not one:

1. **`OpenNoteTab` type duplication.** `src/lib/storage/types.ts` is the
   real source of truth for the app's data-model types, but
   `src/vite-env.d.ts` had a second, hand-copied set of global type
   declarations for the *same* types (`OpenNoteTab`, `WorkspaceSnapshot`,
   `PaperiteAppState`, etc.), maintained by hand instead of importing from
   `storage/types.ts`. When plan 006/007 added `pinned` to `OpenNoteTab` in
   `storage/types.ts`, nobody updated the copy in `vite-env.d.ts`, so the
   global `OpenNoteTab` type silently kept the old shape without `pinned`.
   Every place in `src/routes/_main/index.tsx` that used `pinned` on an
   `OpenNoteTab` (SortableTab props, `openNote`, `togglePinTab`,
   `normalizeAppState`, the trash-notes mapping, etc.) then failed to
   type-check against the stale global type.
2. **A missing required prop, failing silently at runtime (not just a type
   error).** `NavMain` (`src/components/nav-main.tsx`) declares
   `onEditSpace` as a **required** prop and calls it
   (`onEditSpace(editSpacePath, editSpaceName, editSpaceColor,
   editSpaceIcon)`) when it receives the `paperite:open-edit-space`
   `CustomEvent` that `app-sidebar.tsx` dispatches from the folder/space
   context menu's "Edit" action. But the `<NavMain ... />` call site inside
   `AppSidebar` (~line 2123) never passed `onEditSpace` through, even
   though `AppSidebar` itself receives a correctly-wired `onEditSpace` prop
   from `src/routes/_main/index.tsx` (`onEditSpace={editSpace}`) and
   destructures it. The popover UI for editing a space opened normally;
   clicking "Save" called `undefined(...)` and failed with no visible
   error. This was reported earlier as "two mechanisms for Edit Space, one
   dead" — that framing was slightly off. There's one mechanism
   (dispatch → `NavMain` listener → `onEditSpace` callback), and it was
   simply broken by a missing prop at one hop in the chain.

## Current state

### Baseline (as documented in `plans/README.md` before this plan)

`bunx tsc -b` on a clean `755483e` checkout fails with dozens of errors:
missing `OpenNoteTab.pinned` (root cause 1 above, ~9 errors per the
plan-009 note), the missing `onEditSpace` prop (root cause 2 above, its own
`tsc` error since it's a required prop), plus unrelated strict-null-check
errors in `src/lib/storage/electron-storage.ts`, `web-storage.ts`, and
`src/components/export-queue.tsx`.

### Already-applied fixes (uncommitted in the working tree as of this plan)

The working tree at commit `755483e` currently has **uncommitted** changes
in 6 files that fix root causes 1 and 2 and clean up the related
strict-null noise:

- **`src/vite-env.d.ts`** — rewritten to `import type { ... } from
  "@/lib/storage/types"` and re-export those as the global type aliases,
  instead of hand-copying their shapes. This is the permanent fix for root
  cause 1: there is now exactly one place (`storage/types.ts`) that defines
  these shapes.
- **`src/components/app-sidebar.tsx`** — `onEditSpace={onEditSpace}` added
  to the `<NavMain ... />` call site (fixes root cause 2); a trash-notes
  mapping into `OpenNoteTab`-shaped objects now includes `pinned: false`
  (needed once `pinned` became a real required field again after the
  vite-env.d.ts fix).
- **`src/routes/_main/index.tsx`** — one `OpenNoteTab`-shaped object
  literal now includes `pinned: false`; the unused `loadedNotePath` read
  (only `setLoadedNotePath` is used) is now `const [, setLoadedNotePath] =
  useState(...)` instead of declaring an unused binding.
- **`src/components/export-queue.tsx`** — `window.electron.openExternal(...)`
  changed to `window.electron?.openExternal(...)` (matches the optional
  `Window["electron"]` type; this was a real strict-null error, not just a
  style nit).
- **`src/components/note-editor.tsx`** — removed the dead
  `isFormatActive` function (unused, ~24 lines).
- **`src/lib/storage/electron-storage.ts`** — every method changed from
  `return window.electron?.foo(...)` (which type-checks as returning
  `T | undefined` against a `Promise<T>` return type — the strict-null
  errors) to `return requireElectron().foo(...)`, where `requireElectron()`
  is a new helper that throws a clear error if `window.electron` is
  missing instead of silently resolving to `undefined`. This is safe
  because `ElectronNotesEngine`/`ElectronTrashEngine`/`ElectronSyncEngine`
  are only ever constructed after confirming `window.electron` exists
  (verified this session by reading `notes-engine.ts`, `trash-engine.ts`,
  `sync-engine.ts`).

Confirmed by running `bunx tsc -b` against the working tree (uncommitted
changes included) this session: **one error remains**, in a file the
prior session hadn't gotten to yet:

```
src/lib/storage/web-storage.ts(73,4): error TS2322: Type 'Uint8Array<ArrayBufferLike>' is not assignable to type 'BodyInit | null | undefined'.
  Type 'Uint8Array<ArrayBufferLike>' is missing the following properties from type 'URLSearchParams': size, append, delete, get, and 2 more.
```

This is inside `WebNotesEngine.writeYUpdate`, passing a `Uint8Array` as
`fetch`'s `body` (via the shared `api()` helper's `options?.body`) — a real
mismatch between the DOM lib's `BodyInit` type and a generic-parameterized
`Uint8Array<ArrayBufferLike>`, not a false positive.

Also still true: `.github/workflows/ci.yml` has no `tsc` step at all (only
`biome check ... || true` and `bun test`).

## Scope

**In scope:**
- `src/lib/storage/web-storage.ts` (the one remaining `tsc` error)
- `.github/workflows/ci.yml` (add the missing `tsc -b` gate)
- Committing the 6 already-modified files listed above as-is (review them,
  don't re-derive them — they're done and were individually verified
  against their call sites this session and the prior one)

**Out of scope (do not touch in this plan):**
- `bunx biome check`'s `|| true` (lint failures currently don't fail CI
  either — this is a related but separate policy decision; see Step 3,
  which is intentionally optional/deferred, not part of this plan's Done
  criteria)
- Test coverage gaps (sidebar, export queue, Google Drive sync, Convex
  collab spaces have no tests) — real, but a separate, larger effort
- The disabled "Change icon" folder context-menu item — unimplemented
  placeholder, unrelated to build breakage
- macOS/Windows `electron-builder` packaging targets — `package.json`'s
  `build.linux` only; unrelated to build breakage
- The 11 `_fix_*.py` files at the repo root — cleanup, unrelated to build
  breakage
- Anything in `src/lib/y-note-store.ts`, sync engines, or Convex —
  untouched by any of the above fixes and not implicated in any remaining
  error

## Steps

### Step 1: Review and commit the already-applied fixes

Run `git -C paperite diff -- src/vite-env.d.ts src/components/app-sidebar.tsx src/components/export-queue.tsx src/components/note-editor.tsx src/lib/storage/electron-storage.ts src/routes/_main/index.tsx` and
confirm it matches the "Already-applied fixes" description above. If it
does, commit these 6 files as a single commit (e.g. `fix: dedupe
OpenNoteTab type, wire missing onEditSpace prop, fix strict-null errors
(plan 010)`) before moving on — this gives a clean checkpoint to build the
remaining fix on top of, and means Step 2 below is the only remaining
`tsc` error to solve.

### Step 2: Fix the `Uint8Array` → `BodyInit` mismatch in `web-storage.ts`

In `src/lib/storage/web-storage.ts`, `writeYUpdate` (~line 66-73) passes a
raw `Uint8Array` as `body` through the shared `api()` helper, whose
`options?: RequestInit` type expects `BodyInit`. The underlying data is
fine for `fetch` at runtime (a `Uint8Array` is a valid `BodyInit` per the
Fetch spec) — this is a `lib.dom.d.ts` generic-parameter mismatch, not a
logic bug. Fix by constructing an explicit `Blob` instead, which
`fetch`/`RequestInit.body` accept without the generic-parameter mismatch:

```ts
async writeYUpdate(
    path: string,
    update: Uint8Array,
): Promise<{ ok: true; noteId: string; updatedAt: number }> {
    return api(`/api/notes/${encodeURIComponent(path)}/yjs/update`, {
        method: "POST",
        body: new Blob([update]),
        headers: { "Content-Type": "application/octet-stream" },
    });
}
```

**Verify**: `env -C paperite bunx tsc -b` → exit 0 with no errors at all
(this is the first time this command should be clean).

### Step 3 (optional, not required for Done criteria): Consider hardening the `biome` CI step

`.github/workflows/ci.yml` currently runs
`bunx biome check src main.js preload.js --max-diagnostics=50 || true` —
the `|| true` means a failing lint never fails CI either, the same class
of problem as the missing `tsc` gate. This plan intentionally does **not**
require removing it, because doing so safely requires first checking how
many real lint errors currently exist repo-wide (removing `|| true` could
immediately turn CI red on the next push if there's existing lint debt).
If picking this up: run `env -C paperite bun run lint` first, fix or
explicitly accept what it reports, *then* drop `|| true`. Treat this as a
candidate for its own follow-up plan if the lint debt turns out to be
non-trivial — don't fold an unbounded lint-fixing effort into this plan.

### Step 4: Add a `tsc -b` gate to CI

In `.github/workflows/ci.yml`, add a build/typecheck step after
`bun install` and before (or alongside) the existing `biome`/`bun test`
steps:

```yaml
      - run: bun install --frozen-lockfile
      - run: bunx tsc -b
      - run: bunx biome check src main.js preload.js --max-diagnostics=50 || true
      - run: bun test
```

Unlike the `biome` step, this one must **not** have `|| true` — the whole
point is that a broken build should fail CI.

**Verify**: push to a branch (or open a draft PR) and confirm the new step
shows up and passes in the Actions run, given Step 2 is already applied.

## Test plan

1. `env -C paperite bunx tsc -b` → exit 0, zero errors.
2. `env -C paperite bun run lint` → note the exit code and diagnostic count
   for the record (informational only, not a Done-criteria blocker per
   Step 3).
3. `env -C paperite bun test` → still passes (this fix set shouldn't touch
   anything the existing 3 test files cover).
4. Manual: open the app, right-click a Space in the sidebar → "Edit
   Space" → change its name/color/icon → Save. Confirm the change actually
   persists (reload the app / switch spaces and back) — this is the
   concrete symptom of root cause 2 and the one that should now visibly
   work.
5. Manual: open several notes as tabs, confirm no console errors related
   to `pinned` or tab rendering (regression check for root cause 1's fix).

## Done criteria

ALL must hold:

- [ ] The 6 already-modified files are committed
- [ ] `src/lib/storage/web-storage.ts`'s `writeYUpdate` no longer causes a
      `tsc` error
- [ ] `bunx tsc -b` exits 0 with zero errors
- [ ] `.github/workflows/ci.yml` runs `bunx tsc -b` as a non-suppressed
      (no `|| true`) step
- [ ] A CI run on a branch/PR shows the new step passing
- [ ] Editing a Space's name/color/icon via the sidebar "Edit Space" flow
      actually persists the change

## STOP conditions

- The code at the locations described in "Already-applied fixes" or
  "Current state" doesn't match what's live (drift — see the note at the
  top about the working tree possibly having already been committed or
  reverted).
- `bunx tsc -b` still reports errors beyond the single documented
  `web-storage.ts` one after Step 1 is confirmed — that would mean this
  plan's account of the baseline is incomplete; stop and report the actual
  error list rather than continuing to patch blind.
- Adding the `tsc -b` CI step surfaces a failure that doesn't reproduce
  locally (e.g. an environment/lockfile difference) — stop and report
  rather than loosening the step back to non-blocking.
