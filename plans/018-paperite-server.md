# Plan 018: `paperite-server` — Convex-first sync backend

## Status

- **Status**: READY (Convex-first; explicit OpenTUI TUI shell; local Yjs backend deferred)
- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plan 016's Clerk/product decisions for the official hosted path
- **Category**: architecture / sync

## Decision log — 2026-10-18

The previous version tried to ship the provider contract, Convex, a local
Yjs server, better-auth, `paperite serve --sync`, mobile cutover, deployment,
and plugins in one pass. That is too broad and creates several coupled failure
modes.

The execution order is now:

```text
contract → Convex backend → CLI/TUI shell → desktop → mobile → official deploy
                                                   ↓
                                      local Yjs backend → serve --sync
                                                   ↓
                                          plugins / database views
```

Locked implementation decisions for this plan:

- **Convex first.** It is the first concrete backend implementation.
- **Clerk for the official hosted path.** The Clerk requirement comes from
  Plan 016; auth abstraction for BYO is deferred with the local backend.
- **Local files + SQLite remain the desktop base.** The server is for shared
  spaces and multi-device sync, not a replacement for local storage.
- **No better-auth, local Yjs WebSocket server, or `serve --sync` in the
  first milestone.** Those are explicit follow-up phases.
- **A personal local server does not need a general custom-auth framework in
  the MVP.** Use per-device pairing credentials for private personal-server
  access; defer better-auth, password auth, and arbitrary OAuth providers until
  multi-user hosting is a real requirement.
- **Plugins, database views, publish, and presence are not blockers** for the
  provider/Convex milestone. Plan 021 consumes the stable contract later.
- **The interactive entrypoint is explicit:** `paperite-server tui` opens the
  OpenTUI operator dashboard. A bare `paperite-server` invocation must not
  unexpectedly enter an interactive screen.
- **First-time configuration is explicit:** `paperite-server setup` runs the
  setup wizard. It may use OpenTUI when attached to a TTY and must support a
  non-interactive flags/config-file path for automation.
- **`paperite-server serve` stays headless.** It must work in systemd,
  containers, SSH sessions, and scripts without a TTY. `status` and `doctor`
  must also have a non-interactive/plain-output path; JSON output can be added
  where useful.
- **OpenTUI is an operator surface, not the server core or a note editor.** The
  TUI may guide first-time setup and expose status, diagnostics, and config,
  but note editing remains in the Paperite clients.

## Current state

- `../paperite-server/` exists and currently contains the Convex schema,
  `sharedSpaces.ts`, auth config, generated Convex types, and basic Bun
  scripts.
- Desktop has `src/lib/sync-provider.ts` as a Convex-facing choke point and
  runtime URL settings, but the public package contract does not exist yet.
- Mobile has local storage and editor/sync code, but it does not consume the
  shared `@paperite/server-api` contract.
- `paperite/server/` remains the standalone REST/web server for local use;
  this plan does not replace it during the Convex-first milestone.
- No production-ready `paperite-server setup` or `paperite-server tui` command
  exists yet; the command contract below is intentionally defined before
  implementation.

## Scope by milestone

### Milestone A — provider contract

Create `../paperite-server/packages/server-api/` as a small, transport-
agnostic TypeScript package. It is the only package clients may import for
shared-backend types.

The first contract must cover:

- `AuthSession` / authenticated user identity
- spaces and membership roles (`owner`, `editor`, `viewer`)
- note identity and metadata
- Yjs snapshot read/write
- append-only Yjs update batches
- a subscription shape for remote note updates

Use stable string IDs, ISO timestamps or epoch milliseconds consistently, and
an explicit binary wire representation (`Uint8Array` at the API boundary;
base64/ArrayBuffer only in transport adapters). Do not import Convex-generated
types into the contract.

**Gate:** the package typechecks and has a short contract README with one
example provider implementation and one example client call.

### Milestone B — Convex source of truth

In `../paperite-server/`:

1. Keep the existing Convex functions working while extracting them.
2. Add/adjust adapters so Convex data maps to `server-api` types.
3. Run Convex codegen and TypeScript checks.
4. Add focused tests for space creation, membership authorization, note
   snapshot/update persistence, and the free-space entitlement boundary.
5. Document required env vars without committing deployment URLs or secrets.

Do not delete `paperite/convex/` yet. The old client remains the compatibility
path until the desktop and mobile cutovers pass.

**Gate:** a clean server-repo typecheck/codegen/test run and an explicit
mapping from each provider method to its Convex query/mutation.

### Milestone C — CLI and OpenTUI operator shell

In `../paperite-server/`, add the smallest command layer around the server
use-cases without coupling the core to a terminal UI:

- `paperite-server serve` — headless server process; no interactive prompts.
- `paperite-server setup` — explicit first-time configuration wizard; use
  OpenTUI interactively and support non-interactive configuration.
- `paperite-server tui` — explicit OpenTUI operator dashboard after setup.
  It may show an unconfigured state and point to `setup`, but must not silently
  replace the setup command.
- `paperite-server status` — concise status output, with a non-interactive
  path suitable for scripts.
- `paperite-server doctor` — diagnostics for config, auth, storage, and
  connectivity; do not print secrets.

The first TUI screens should cover setup when configuration is missing, then a
small dashboard with server state, backend/auth configuration summary, and
diagnostic actions. Keep the TUI thin: it calls application services and does
not import Convex-generated types directly. Use `@opentui/react` unless the
server repository's runtime constraints make the core binding materially safer;
if that exception applies, document it in the server README. Ensure the
renderer is destroyed on every exit path and that non-TTY environments never
hang waiting for input.

Do not add an `init` command in this milestone. `paperite-server setup` is the
canonical first-time configuration command; automation uses its flags/config
file path and the non-interactive commands.

**Gate:** command parsing, service boundaries, and TUI rendering have focused
tests or deterministic smoke checks; `serve` remains usable without a TTY;
`tui` exits cleanly on quit/error; no secret values are rendered or logged.

### Milestone D — desktop cutover

In `paperite/`:

- make `src/lib/sync-provider.ts` implement the public contract;
- keep runtime URL precedence: user setting > environment default;
- keep Convex client caching per normalized URL;
- remove direct `convex/_generated` imports from desktop call sites;
- preserve local-only behavior and existing cloud behavior;
- keep the Sync settings UI truthful about the active backend.

**Gate:** desktop typecheck/tests pass; existing Convex flows have a manual
smoke path; no local note path starts making Convex calls
implicitly.

### Milestone E — mobile cutover

In `../paperite-mobile/`:

- consume `@paperite/server-api` rather than duplicating backend types;
- add the same effective-URL setting precedence with an AsyncStorage override;
- keep local SQLite/filesystem notes working offline;
- make hosted sync opt-in to an authenticated provider, not LAN REST;
- add one provider smoke path behind a small feature flag before broad UI
  migration.

**Gate:** mobile typecheck/editor build pass and the local-only path still
works with no server configured.

### Milestone F — official Convex deployment

Only after B–E pass:

- deploy the official Convex functions under the Avalid/Paperite+ account;
- configure the production Clerk issuer and JWT template;
- set the default URL through environment/config, never in source docs;
- test desktop → mobile space/note visibility with an authenticated account;
- record rollback steps and deployment ownership in the server README.

Deployment requires the owner's credentials and cannot be claimed from local
typechecks alone.

### Milestone G — local Yjs backend (follow-up)

After the Convex-first milestone is stable, add `local/` to
`paperite-server/`:

- Yjs WebSocket sync plus snapshot/update persistence;
- storage layout compatible with the local workspace contract;
- per-device pairing credentials for personal-server access, stored as hashes
  and individually revocable; a general auth adapter is a later follow-up;
- restart/convergence tests with two clients;
- no last-write-wins replacement for Yjs merging.

This milestone must not block A–F.

### Milestone H — `paperite serve --sync` (follow-up)

Only after Milestone G:

- add an explicit `--sync` mode to the serve CLI;
- keep plain `paperite serve` as the single-user browser view;
- document LAN binding/auth warnings and workspace locking;
- test two clients editing one note, restart, and rejoin.

### Milestone I — Plan 021 consumers (follow-up)

Only after the provider contract is stable:

- opaque structured blocks can be carried without a provider rewrite;
- database views and plugin blocks stay in Plan 021;
- plugin/publish/presence work must not leak into the initial provider API.

## Verification order

Run the smallest relevant gate after each milestone:

1. `bun install` / `bunx tsc -b` in `paperite-server`.
2. CLI/TUI typecheck and focused command/service tests; no dev server.
3. Convex codegen and focused server tests.
4. Desktop `tsc -b` and unit tests.
5. Mobile `bunx tsc --noEmit` and `bun run build:editor`.
6. Authenticated integration smoke only when a real deployment exists.

Do not run dev servers as part of an automated agent turn. Ask the owner for
the manual server/device smoke when required.

## Done criteria

### Convex-first milestone (the actionable target now)

- [ ] `packages/server-api` exists with the contract and README.
- [ ] `paperite-server setup` is the explicit first-time configuration command
  and `paperite-server tui` is the explicit OpenTUI dashboard command;
  `serve` remains headless and there is no `init` command.
- [ ] Convex functions map to the contract and codegen/typecheck pass.
- [ ] Desktop uses the contract through `sync-provider.ts`.
- [ ] Mobile uses the same contract without breaking local-only mode.
- [ ] No client call site imports `convex/_generated` directly.
- [ ] Focused tests cover authz, spaces, snapshots, and update batches.
- [ ] Official deployment smoke is documented and run once credentials exist.

### Full backend vision (later)

- [ ] Local Yjs backend converges and survives restart.
- [ ] `paperite serve --sync` works with two clients.
- [ ] Optional multi-user auth adapter works for a BYO local deployment.
- [ ] Plan 021 structured blocks sync through both backends.

## STOP conditions

- Do not begin the local backend before the Convex contract is stable.
- Do not delete the old desktop `convex/` until both clients pass cutover.
- Do not commit real Convex/Clerk URLs, tokens, or deployment credentials.
- Do not make plugins, presence, or publish fields required by the base
  provider contract.
- Do not make OpenTUI a runtime dependency of headless `serve`, and do not
  make the TUI the only way to configure or operate the server.
- Stop if a proposed change silently turns local-only editing into a network
  dependency.

## Handoff notes

The first implementation task is **Milestone A only**: create and validate
`packages/server-api`. The `paperite-server setup` and `paperite-server tui`
decisions are part of the command contract, but the CLI/OpenTUI implementation
belongs to Milestone C. The agent must not attempt deployment, local Yjs,
`serve --sync`, plugin work, CLI/TUI implementation, or a broad client rewrite
in that first round.
