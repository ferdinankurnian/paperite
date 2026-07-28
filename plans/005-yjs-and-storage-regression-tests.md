# Plan 005: Automate the two riskiest layers (Yjs sync, note file I/O)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 975b6a5..HEAD -- scripts/ src/lib/sync-core.ts src/lib/y-note.ts src/lib/y-note-store.ts main.js package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: infra
- **Planned at**: commit `975b6a5`, 2026-07-28

## Why this matters

Paperite has no test suite and no CI beyond a release-on-tag build
(confirmed: `AGENTS.md` states this explicitly, `package.json` has no test
script, `.github/workflows/` only contains `release.yml`). A broad test
suite isn't worth the effort for a small/solo project. But two layers are
the exception, because when they break silently the failure mode is "the
user's note content is wrong or gone," which is the one failure a
note-taking app can't recover trust from:

1. **Yjs sync/merge logic** (`sync-core.ts`, `y-note.ts`, `y-note-store.ts`)
   — this is exactly the kind of code that can look correct, pass a manual
   check once, and then silently mis-merge under a different sequence of
   edits.
2. **Note file I/O** in `main.js` (read/write/delete/rename of `note.json`
   and its `assets/` folder) — a bug here can corrupt or lose a note file
   directly on disk.

`scripts/verify-yjs-sync.cjs` and `scripts/verify-yjs-prosemirror-migration.ts`
already exist and already cover meaningful Yjs scenarios, but they're run
manually and easy to forget. This plan converts them into `bun test` files
that run automatically, and adds a small set of file I/O tests for the
notes engine.

## Current state

- `package.json` has `"verify:yjs": "bun scripts/verify-yjs-sync.cjs"` and
  `"verify:yjs:migration": "bun scripts/verify-yjs-prosemirror-migration.ts"`
  — both are ad-hoc scripts using `node:assert/strict`, not a test runner.
- No `test` script exists in `package.json`.
- `bun test` is available out of the box with Bun (no new dependency
  needed) and supports `node:assert` already, so existing assertion style
  can be kept largely as-is during the conversion.
- `main.js` contains the Electron IPC handlers for note I/O
  (`notes:read-note`, `notes:write-note`, `notes:save-image`, etc.) as
  plain functions reachable via `ipcMain.handle`, not currently exported in
  an easily-importable, test-friendly form.

## Scope

**In scope:**
- New: `tests/` directory (or `scripts/*.test.ts`, match whatever bun test's
  default discovery picks up with zero config — confirm with
  `bunx bun test --help` if unsure)
- Convert `scripts/verify-yjs-sync.cjs` → `tests/yjs-sync.test.ts`
- Convert `scripts/verify-yjs-prosemirror-migration.ts` → `tests/yjs-prosemirror-migration.test.ts`
- New: `tests/notes-file-io.test.ts` covering read/write/delete/rename of a
  note (against a temp directory, not the real `~/Documents/Paperite`)
- `package.json` — add a `"test": "bun test"` script
- `.github/workflows/` — new lightweight CI workflow that runs `bun run lint`,
  `bunx tsc -b`, and `bun test` on every push/PR (separate from the existing
  release-on-tag workflow, which should stay tag-triggered only)

**Out of scope:**
- Any UI/component tests (not worth it for this project per the discussion
  that produced this plan)
- Refactoring `main.js`'s IPC handlers into a separately importable module —
  if the file I/O logic isn't easily testable without spinning up Electron,
  see Step 3 for the fallback approach; do not do a large `main.js` refactor
  to make this plan easier.

## Steps

### Step 1: Convert the two existing verify scripts

Rewrite each script's assertions using `bun:test`'s `test`/`expect`:

```ts
import { expect, test } from "bun:test";
// ...existing setup code from the script, largely unchanged...

test("yjs updates from two devices merge without conflict", () => {
    // existing scenario logic
    expect(readBody(deviceA)).toEqual(readBody(deviceB));
});
```

Keep the actual scenario logic (the Yjs doc setup, the update
encode/apply/merge sequence) identical to what's already in the script —
this is a mechanical conversion of "assert + console.log + process.exit" to
`test()` + `expect()`, not a rewrite of the test logic itself. Delete the
original `.cjs`/`.ts` scripts and their `package.json` script entries once
the `bun test` versions pass.

### Step 2: Add `"test": "bun test"` to `package.json`

### Step 3: Add note file I/O tests

`main.js` isn't structured as an importable module today (it registers
`ipcMain.handle` callbacks inline). Before writing `tests/notes-file-io.test.ts`,
check whether the read/write/delete logic can be imported directly (e.g. if
helper functions like `readNoteContent`, `writeNoteContent`,
`ensureNoteDirectory` are already `module.exports`-able without pulling in
Electron). If they are, write tests against a temp directory
(`fs.mkdtempSync`) that exercise: write a note → read it back → contents
match; write an image via the asset path → file exists on disk at the
expected path; delete a note → directory and its `assets/` are gone.

If the I/O logic is too entangled with `ipcMain`/Electron globals to import
cleanly without a larger refactor, STOP and report this specifically — do
not do a large `main.js` restructure as part of this plan. In that case the
fallback is to test at the `notes-engine.ts` (renderer-side wrapper) level
against a mocked `window.electron`, which is a smaller and safer scope
change; note this fallback needs a paragraph in "Maintenance notes" of
whichever approach is actually used.

### Step 4: Add a lint+typecheck+test CI workflow

New `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [v0.2.0]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun run lint
      - run: bunx tsc -b
      - run: bun test
```

Adjust the `branches` trigger to match whatever the actual default branch
is (confirm with `git branch --show-current` — do not assume `main`).
Leave `.github/workflows/release.yml` untouched; it should remain
tag-triggered only.

### Step 5: Verify

**Verify**: `bun run lint` → exit 0, `bunx tsc -b` → exit 0, `bun test` →
all tests pass

## Test plan

This plan's own deliverable is the test suite. Verification is:

1. `bun test` runs and passes locally.
2. Push a throwaway commit to a branch/PR and confirm the new CI workflow
   triggers and passes.
3. Deliberately break something small in `sync-core.ts` locally, confirm
   `bun test` fails (sanity-checks that the tests actually assert something
   meaningful, not just that they run).

## Done criteria

ALL must hold:

- [ ] `bun run lint` exits 0
- [ ] `bunx tsc -b` exits 0
- [ ] `bun test` passes with the two converted Yjs tests plus new file I/O
      tests
- [ ] `scripts/verify-yjs-sync.cjs` and `scripts/verify-yjs-prosemirror-migration.ts`
      removed, along with their now-unused `package.json` script entries
- [ ] New CI workflow runs on push/PR (not just on release tags)
- [ ] A deliberately broken assertion causes `bun test` to fail (sanity
      check, revert after confirming)

## STOP conditions

- The code at the locations in "Current state" doesn't match (drift).
- File I/O logic in `main.js` can't be imported/tested without a large
  refactor — stop and report, propose the `notes-engine.ts` fallback
  instead of restructuring `main.js`.
- A converted test's assertions don't actually match the original script's
  intent — stop and report rather than guessing at what it should check.
