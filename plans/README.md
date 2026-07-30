# Plans

## Status

| # | Plan | Status | Priority |
|---|------|--------|----------|
| 001 | [Store images as files](./001-store-images-as-files.md) | DONE | High |
| 001 | [Customizable keyboard shortcuts](./001-customizable-keyboard-shortcuts.md) | DONE | — |
| 001 | [Pin preview tab on edit](./001-pin-preview-tab-on-edit.md) | DONE | P1 |
| 002 | [Fix image paste bypass](./002-fix-image-paste-bypass.md) | DONE | P1 |
| 003 | [Hide collab space creation](./003-hide-collab-space-creation.md) | DONE | P1 |
| 004 | [Add error boundary](./004-add-error-boundary.md) | DONE | P0 |
| 005 | [Yjs + storage regression tests](./005-yjs-and-storage-regression-tests.md) | DONE | P1 |
| 006 | [Tab fixed vs pinned rework](./006-tab-fixed-vs-pinned-rework.md) | DONE | P2 |
| 007 | [Pin note to top](./007-pin-note-to-top.md) | DONE | P2 |
| 008 | [Finish re-render/performance pass](./008-finish-rerender-optimization.md) | DONE | P0 |
| 009 | [Cache loaded YDocs per tab](./009-cache-loaded-ynotes-per-tab.md) | DONE | P1 |
| 010 | [Fix build errors and Edit Space bug](./010-fix-build-errors-and-edit-space-bug.md) | DONE | P0 |

> Note (2026-07-28): the three `001-*` plans were marked TODO/missing from
> this table despite being fully implemented in the codebase — verified by
> reading the actual source, not just this file. If you're an agent reading
> this table to decide what to work on, don't trust the Status column alone
> for old entries; spot-check against the code when a plan looks stale.

> Note (2026-07-28): `bunx tsc -b` currently fails on `main` due to
> pre-existing issues unrelated to any plan here — strict-null-check errors
> in `src/lib/storage/electron-storage.ts` / `web-storage.ts` /
> `src/components/export-queue.tsx`, plus a missing `onEditSpace` prop on
> `NavMain` usage in `src/components/app-sidebar.tsx` (~line 1882, looks
> like unfinished space-editing work). None of these are addressed by any
> plan in this file yet — the build is currently broken independent of
> everything else tracked here. **Resolved by plan 010 (2026-07-30).**

> Note (2026-07-29, plan 008): core typing lag fixed (`isUserEdit` skips
> `setNoteContent`; toolbar uses `useEditorState` scoped to FormatMenu;
> list markers restored; save-status / workspace-preview updates are
> same-value no-ops or `startTransition`; folder expand uses local store +
> deferred parent update). Full `React.memo` on `AppSidebar`/`AppTitlebar`
> deferred — would need deep prop-stability refactor (STOP condition).

> Note (2026-07-29, plan 009): done. Added `loadedYNoteCache` (Map ref) in
> `src/routes/_main/index.tsx`, made the YDoc-loading effect check it before
> calling `loadYNote`, evict+destroy on `closeTab`, and destroy all on
> unmount. Tab switching between already-open notes no longer shows
> "Loading note...". Also fixed pre-existing lint debt in the same file
> (unsorted lucide-react import, two unformatted blocks, one
> `useOptionalChain` warning) to satisfy this plan's lint done-criteria —
> unrelated to the cache change itself.
>
> While verifying `tsc -b` against the pre-existing baseline noted above,
> found it's incomplete: `OpenNoteTab.pinned` is used throughout
> `src/routes/_main/index.tsx` (SortableTab props, `openNote`, `togglePinTab`,
> `normalizeAppState`, etc.) but `OpenNoteTab` in `src/lib/storage/types.ts`
> has no `pinned` field, producing ~9 more `tsc` errors than this file
> previously documented. Confirmed via before/after diff that plan 009
> didn't introduce these — they predate it (likely missed when plan
> 006/007 landed the pin-tab feature). Not fixed here (out of scope for
> 009) — worth its own plan since it's a real type-safety gap, not just
> lint noise. **Resolved by plan 010 (2026-07-30).**

> Note (2026-07-30, plan 010): done. Both build-breaking root causes were a
> type-duplication bug (`src/vite-env.d.ts` hand-copied the data-model
> types instead of importing `src/lib/storage/types.ts`, so `OpenNoteTab.pinned`
> silently drifted out of sync) and a real, user-visible bug in "Edit
> Space" (the popover opened fine but Save silently no-op'd because
> `AppSidebar` never passed its `onEditSpace` prop down to `NavMain`, which
> requires it). Fixed both, plus the related strict-null errors in
> `electron-storage.ts` (new `requireElectron()` helper instead of silent
> `undefined`), `export-queue.tsx` (optional chaining on `window.electron`),
> and a dead-code removal in `note-editor.tsx`. The one remaining `tsc`
> error — `web-storage.ts`'s `writeYUpdate` passing a `Uint8Array` as
> `fetch`'s `body` — turned out to need a cast rather than the originally
> planned `Blob` wrap: wrapping in `new Blob([update])` hit the exact same
> underlying issue one level down (`Uint8Array`'s generic buffer type
> includes `SharedArrayBuffer`, which `BlobPart`/`ArrayBufferView<ArrayBuffer>`
> don't accept either) — a real TS 5.7+ typed-array-generics/DOM-lib gap,
> not a logic bug, since a plain `Uint8Array` has always been a valid
> `fetch` body at runtime. Went with `update as BodyInit` plus an inline
> comment instead. `bunx tsc -b` is now clean (zero errors) for the first
> time. Added `bunx tsc -b` as a real (non-`|| true`) step in
> `.github/workflows/ci.yml`, ahead of the `biome` step.
>
> Checked the `biome`-step hardening this plan flagged as optional
> (Step 3): scoped to CI's own paths (`src main.js preload.js`), current
> lint debt is **56 errors / 13 warnings** — pre-existing, not introduced
> by this plan's changes (verified by running `biome check` against just
> the touched files). Left `|| true` in place as planned; flipping it
> would need its own cleanup pass first.
>
> Commits: `f30c7f9` (type dedupe + onEditSpace + strict-null fixes),
> `304b844` (web-storage.ts cast), `37bd65c` (CI gate). Not yet pushed to
> `origin/v0.2.0`.

> Also flagged during the plan-010 investigation, **not** covered by that
> plan and with no plan written yet: thin test coverage (only 3 test files
> — file I/O and Yjs; no coverage for the sidebar, export queue, Google
> Drive sync, or Convex collab spaces), the disabled "Change icon" folder
> context-menu item (unimplemented placeholder), `electron-builder`
> packaging only targeting `linux` despite a `dev:macos` script implying
> intended macOS support, the 56/13 pre-existing lint errors/warnings
> noted above, and 11 stray `_fix_*.py` files (~1659 lines) at the repo
> root that look like uncommitted-cleanup debugging scripts. Any of these
> would need their own plan before being worked on.

## Execution Order

- **004** (error boundary) — standalone, P0, zero dependencies.
- **002** and **003** — both standalone, small, independent of each other.
- **005** (tests) — standalone. Do after 002/003 so the new paste-handler
  code isn't immediately untested-but-untested-anyway; no hard dependency.
- **006** (tab fixed vs pinned) and **007** (pin note) — both standalone
  and independent of each other, but both touch the sidebar/tab area.
- **010** (build errors + Edit Space bug) — standalone, P0, zero
  dependencies. Do this before starting any new sidebar/tab work, since a
  broken build makes it hard to tell whether a new regression is yours.
