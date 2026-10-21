# Plan 027: Allow desktop and `paperite serve` to share one workspace safely

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in the STOP conditions occurs, stop and report instead of
> improvising. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f17ead6..HEAD -- main.js
> server/index.js server/lib/locks.js server/lib/sqlite.js server/routes
> src/lib/notes-engine.ts src/lib/storage`.
> If any in-scope file changed since this plan was written, compare the
> Current state below with live code before proceeding.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH (SQLite/Yjs ownership, cross-process lifecycle, data loss)
- **Depends on**: none
- **Category**: tech-debt / architecture / correctness
- **Planned at**: commit `f17ead6`, 2026-10-20
- **Implementation status**: IN PROGRESS — authenticated desktop owner bridge,
  attached `paperite serve` proxying, serve-first desktop attachment, and
  browser workspace WebSocket refresh are now wired; restart/crash/retry
  integration coverage is still pending.

## Why this matters

Paperite presents desktop and `paperite serve` as two surfaces of the same
local-first application. Today they cannot open the default workspace together:
both processes directly access the workspace files, SQLite index, watchers, and
Yjs persistence, so `server/lib/locks.js` deliberately rejects the second
process. That protects data from unsynchronised writers but blocks the intended
desktop-plus-browser workflow. This plan replaces the refusal with one local
workspace owner and explicit client routing, preserving a single source of
truth while allowing the surfaces to coexist.

## Current state

- `server/lib/locks.js` — creates `~/Documents/Paperite/.paperite/active.lock`
  and refuses any second Electron/serve process for the same workspace. It
  also creates a global `/tmp/paperite-serve-<user>.lock` so only one serve
  process runs.
- `server/index.js:145-190` — checks the global serve lock and workspace lock
  before opening SQLite, then starts Express/WebSocket and directly serves the
  workspace.
- `main.js:3230-3250` — Electron checks the same workspace lock before opening
  its own index and workspace watchers. `app.requestSingleInstanceLock()` also
  prevents duplicate Electron instances where the OS/user-data scope matches.
- `server/lib/sqlite.js` — opens the workspace `index.sqlite`; SQLite WAL is
  enabled, but this does not coordinate the application-level in-memory caches,
  file watchers, or Yjs projection lifecycle.
- `main.js` IPC handlers — desktop renderer operations are handled in the
  Electron main process and currently read/write workspace state directly.
- `server/routes/` and `server/lib/yjs-persist.js` — serve routes and Yjs
  persistence independently perform workspace operations. They must not become
  a second writer after the lock is relaxed.
- `src/lib/notes-engine.ts` and `src/lib/storage/` — renderer-side adapters
  select Electron IPC in desktop mode and HTTP in web mode. Preserve this
  boundary; do not add filesystem access to renderer code.

The intended product model is: one Paperite installation/account, one
workspace owner, multiple local surfaces. `paperite serve` is a browser
surface, not a second independent Paperite product. This plan does not change
Clerk, OS-keychain binding, logout propagation, or account policy.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `./node_modules/.bin/tsc -b --pretty false` | exit 0 |
| Tests | `bun test` | all tests pass |
| Syntax | `node --check main.js && node --check server/index.js` | exit 0 |
| Build | `bun run build:web` | exit 0 and stamped `dist-web/` |
| Diff hygiene | `git diff --check` | no output |

## Scope

**In scope**

- A single-owner protocol for one local workspace.
- Desktop/serve discovery, attach, disconnect, and owner crash recovery.
- Routing workspace reads/writes, SQLite access, file projection, and Yjs
  persistence through the owner.
- Explicit user-facing errors when the owner is unavailable or the workspace
  belongs to a different owner.
- Cross-process integration tests using temporary workspaces and real local
  IPC/HTTP boundaries.
- Updating `server/lib/locks.js` so it coordinates ownership instead of
  unconditionally rejecting the second supported surface.

**Out of scope**

- Clerk auth, OS keychain storage, device binding, or logout semantics.
- Running two independent `paperite serve` instances for the same user.
- Multi-user network access, LAN authentication, or remote workspace sharing.
- Removing Electron's single-instance behavior for duplicate desktop launches.
- Editing `src/routeTree.gen.ts`.

## Recommended architecture

Use one local workspace owner process. The owner is whichever supported process
acquires the workspace first; the other supported surface attaches to it over a
loopback-only, authenticated local channel. The owner alone may open
`index.sqlite`, run Yjs persistence, watch note files, and mutate workspace
files.

The owner protocol must provide:

1. discovery and health (`owner pid`, protocol version, workspace identity,
   transport address);
2. attach/detach with a per-client session id;
3. request/response forwarding for the existing workspace operations;
4. event forwarding for workspace and sync changes;
5. owner shutdown and crash detection;
6. a per-installation random local transport secret, stored with the owner
   lock metadata and never exposed to a network interface.

Prefer an existing local IPC primitive available to Electron/Node on each
target. If a loopback HTTP/WebSocket bridge is used for portability, bind only
to loopback, require the random secret on every request, and never reuse the
unauthenticated LAN serve endpoints. Do not accept a design that lets both
processes continue direct file access after the lock is relaxed.

## Steps

### Step 1: Characterize current workspace operations

Inventory every Electron IPC handler and serve route that reads/writes the
workspace, SQLite, Yjs fragments, app state, trash, or assets. Group them into
read requests, mutations, long-running subscriptions, and server-pushed
events. Add temporary-workspace characterization tests before moving ownership.

**Verify**: `bun test tests/workspace-tree.test.ts tests/yjs-persist-merge.test.ts`
passes, and the inventory names every operation in `main.js`, `server/routes/`,
and `server/lib/yjs-persist.js` that touches workspace state.

### Step 2: Implement owner discovery and authenticated local transport

Extend `server/lib/locks.js` with an owner record that contains workspace
identity, pid, protocol version, transport address, and a random local secret.
Make acquisition atomic and pid-checked. Add owner health checks, stale-owner
cleanup, and deterministic attach errors. Keep the existing global guard that
prevents two independent `paperite serve` processes; this plan only permits
desktop and serve to share one owner.

**Verify**: add lock/transport tests covering owner acquisition, attach,
wrong-secret refusal, stale pid recovery, and two simultaneous acquisition
attempts. Run `bun test` and expect all tests to pass.

### Step 3: Move workspace ownership behind one request/event boundary

Extract the shared workspace operations used by Electron and serve into a
single owner-side module. Route both existing Electron IPC and serve requests
through that module when the process is the owner. When it is a client, route
requests through the owner transport instead. Preserve the renderer adapters
and existing response shapes wherever possible.

Do not remove the workspace lock until both owner and client paths are wired;
otherwise a partially migrated process can corrupt the workspace.

**Verify**: run the existing test suite plus new owner/client integration tests
for note CRUD, rename/move, trash, app state, assets, SQLite search, and Yjs
updates. `./node_modules/.bin/tsc -b --pretty false` must exit 0.

### Step 4: Forward live events and handle lifecycle

Forward workspace changes, sync status, and Yjs/editor updates from the owner
to attached surfaces. On owner shutdown, clients must show a reconnecting state
and retry discovery without writing locally. On owner crash, a new process may
take ownership only after pid/stale-lock validation; pending writes must either
be acknowledged by the owner or remain retryable with stable ids.

**Verify**: integration tests cover owner restart during an edit, owner
shutdown, reconnect, duplicate mutation retry, and convergence from desktop
and browser clients. No test may pass by allowing both processes to open the
same SQLite file directly.

### Step 5: Enable the supported desktop-plus-serve workflow

Update startup behavior and user-facing errors so the first desktop or serve
process becomes owner and the other surface attaches. Keep duplicate desktop
launches single-instance and keep a second independent serve process refused.
Document the supported combinations: one owner plus attached surfaces, not
multiple independent workspace owners.

**Verify**: in an isolated temporary workspace, launch desktop-owner and
serve-client in both orders, then exercise create/edit/rename/delete/search
from both surfaces. Run `bun run build:web` before browser QA and verify the
stamped web artifact is served by `bun run serve`.

## Test plan

- Add unit tests for owner metadata validation, atomic acquisition, stale pid
  cleanup, protocol versions, and local-secret rejection.
- Add integration tests using a temporary workspace and two child processes:
  owner-first desktop/serve, serve-first desktop/serve, owner restart, and
  concurrent edits.
- Cover every current mutation family: notes, folders, spaces, trash, app
  state, assets, SQLite index/search, and Yjs updates.
- Assert that only the owner opens SQLite and runs file/Yjs watchers.
- Model tests after existing workspace/Yjs tests in `tests/workspace-tree.test.ts`
  and `tests/yjs-persist-merge.test.ts`.

## Done criteria

- [ ] Desktop and one `paperite serve` can use the default workspace together.
- [ ] Exactly one process owns SQLite, file watchers, and Yjs persistence.
- [ ] The second surface attaches through an authenticated loopback/local IPC
      boundary and never opens the workspace database directly.
- [ ] A second independent `paperite serve` remains rejected.
- [ ] Duplicate desktop launches remain single-instance.
- [ ] Owner crash/restart does not lose acknowledged writes or duplicate stable
      mutation ids.
- [ ] Cross-surface note CRUD, search, trash, assets, app state, and Yjs edits
      converge in both launch orders.
- [ ] `bun test`, typecheck, syntax checks, `bun run build:web`, and
      `git diff --check` pass.

## STOP conditions

- The proposed implementation requires both processes to open the same
  `index.sqlite` or run independent Yjs persistence.
- The transport would bind to a non-loopback interface or expose its secret to
  renderer JavaScript/network clients.
- The current response/event contracts cannot be preserved without a broad
  product/API migration; stop and propose that migration explicitly.
- Flatpak sandbox permissions prevent the chosen owner discovery/transport from
  working on supported Linux installations.
- Owner crash recovery cannot distinguish acknowledged from unacknowledged
  mutations.
- Any verification command fails twice after a scoped fix attempt.

## Maintenance notes

- Auth remains installation-wide and shared through OS keychain; this plan must
  not create a second account store or change logout propagation.
- Any new workspace mutation must be added to the owner protocol, never wired
  as a direct client-side filesystem operation.
- Review shutdown, crash recovery, and duplicate-request behavior more closely
  than UI changes; these are the data-loss boundaries.
- LAN/remote multi-user access is a separate backend/auth project and remains
  out of scope.
