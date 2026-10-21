# Plan 023: Make sync targets explicit and pair personal Paperite servers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.
>
> **Drift check (run first)**: `git diff --stat f17ead6..HEAD -- src plans
> main.js preload.js package.json` and compare the Current state below with
> the live files. The working tree already contains user-owned changes; do not
> reset, discard, or reformat unrelated edits.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plan 018 Milestone A; the personal local-server transport
  and pairing foundation must land before end-to-end server binding.
- **Category**: architecture / product / sync
- **Planned at**: commit `f17ead6`, 2026-10-18

## Why this matters

One Paperite account may use hosted Paperite+ and also connect to one or more
personal `paperite-server` instances. Each space needs an explicit sync target
so an account can keep, for example, Inbox on Paperite+ and a private project
on a laptop server reachable over Tailscale. The first version must avoid
multi-master replication: one space has one active canonical target, and
moving or duplicating a space is an explicit user action.

General-purpose custom auth is not part of this MVP. Paperite+ keeps Clerk;
personal servers use per-device pairing credentials, while Tailscale is only
the private network transport. Multi-user invitations and arbitrary auth
providers remain follow-up work.

## Current state

- `src/lib/onboarding.ts:1-13` stores one global
  `paperite:onboarding-complete` localStorage flag.
- `src/components/login-view.tsx:75-77` marks onboarding complete for
  local-only mode; lines `180-188` offer local continuation alongside Google
  OAuth, but there is no server connection step.
- `src/lib/storage/types.ts:105-117` has
  `cloudSpaceLinks: Record<string, string>` and seen-update state. The link is
  Convex-specific and cannot represent Paperite+ or a personal server
  connection cleanly.
- `src/lib/sync-provider.ts:30-148` stores one global backend kind and URL,
  while lines `323-344` explicitly state that the local hub is not implemented.
- `src/components/settings/sync-settings.tsx:24-70` has a cosmetic Simple /
  Advanced mode switch, and lines `283-309` save one custom URL after a Clerk
  gate. It does not manage multiple connections or per-space targets.
- `main.js:24-30` loads `keytar`; lines `1028-1113` use the OS keychain for
  connection credentials. Reuse that pattern for paired server tokens; do
  not put server tokens in localStorage or JSON app state.
- `paperite-server/packages/server-api/src/index.ts:27-32` defines a neutral
  `AuthSession`, but there is no pairing or server-capabilities contract yet.
- `paperite-server/convex/auth.config.ts:3-11` is Clerk-only. This plan does
  not turn the Convex backend into a general custom-auth provider.
- The existing desktop URL validator accepts non-loopback `https:`/`wss:` but
  only accepts `http:`/`ws:` for loopback hosts at
  `src/lib/sync-provider.ts:160-189`. Tailscale should use HTTPS/WSS through
  Tailscale Serve by default; do not weaken this validation for arbitrary
  network HTTP.

### Target domain model

The implementation must distinguish account-level connections from
space-level bindings:

```text
Account/device connections
  Paperite+ (Clerk/default)
  personal-server: laptop via Tailscale
  personal-server: home machine via Tailscale

Space bindings
  Inbox      -> Paperite+
  HOMESICK   -> personal-server:laptop
  Journal    -> local-only
```

Use a stable connection ID and a stable local space path. A binding should
record the target kind, optional connection ID, optional remote space ID, and
binding status. Keep the old `cloudSpaceLinks` readable during migration, but
new code must write the generalized binding shape.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Server API typecheck | `bun run check` in `paperite-server/packages/server-api` | exit 0 |
| Server API smoke | `bun run smoke` in `paperite-server/packages/server-api` | prints `server-api smoke check passed` |
| Convex typecheck | `bunx tsc --noEmit -p convex/tsconfig.json` in `paperite-server` | exit 0 |
| Desktop tests | `bun test` in `paperite` | existing tests pass |
| Desktop typecheck | `bunx tsc -b` in `paperite` | exit 0 |
| Desktop lint | `bun run lint` in `paperite` | Biome exits 0 |

Do not run `bun dev`, `bun start`, a Convex dev server, or a Tailscale
configuration command as part of an automated implementation turn.

## Scope

### In scope

- A transport-neutral server pairing/capabilities contract.
- Personal-server setup semantics: one-time pairing, per-device credentials,
  device labels, and revocation.
- Desktop connection registry and secure token storage through the existing
  Electron/keytar boundary.
- Per-space sync-target bindings for local-only, Paperite+, and
  personal `paperite-server`.
- Onboarding that chooses a mode and then configures the selected target.
- Settings UI for adding, testing, selecting, and disconnecting connections.
- Tailscale endpoint support as an HTTPS/WSS URL, with documentation that
  Tailscale Serve is private-to-tailnet and Funnel is not the default.
- Explicit move and duplicate flows with verification before switching a
  binding.

### Out of scope

- A general custom-auth framework, better-auth, password accounts, or an
  arbitrary OAuth provider registry.
- Using Tailscale as the application's user identity or bypassing app-level
  pairing because a device is on a tailnet.
- Simultaneously syncing one space to multiple backends.
- Public internet exposure, Tailscale Funnel, or unauthenticated non-loopback
  HTTP.
- Multi-user invite flows and owner/editor/viewer membership on personal
  servers; pairing is personal-device access in this MVP.
- Mobile implementation, plugin/database-view work, or publish flows.
- Deleting old remote data automatically during a move.

## Steps

### Step 0: Enforce the documented space roles

Before adding pairing, fix the existing Convex authorization mismatch in
`paperite-server/convex/sharedSpaces.ts`. `requireSpaceMember` currently
checks membership only, while the public contract documents `viewer` as
read-only. Add a separate writable-membership guard and use it for
`upsertNote`, `removeNote`, `appendUpdate`, and `writeSnapshot`; keep
`listNotes` and `listUpdates` readable for viewers. Add focused coverage for
owner/editor success, viewer rejection, and non-member rejection.

Do not solve this by removing the `viewer` role or by moving authorization into
the desktop client. The server must enforce it. If the repository has no
Convex integration-test harness, extract the smallest pure role-policy helper
needed to test the owner/editor/viewer decision with Bun; do not add a real
deployment dependency just to get coverage.

**Verify**: the focused role tests fail before the guard and pass after it;
`bunx tsc --noEmit -p convex/tsconfig.json` → exit 0. Report separately that
the pure policy test is not a full Convex integration test if no Convex test
harness exists.

### Step 1: Define the server connection and pairing contract

In `paperite-server/packages/server-api/`, add transport-neutral types for:

- `SyncTargetKind`: `local`, `paperite-cloud`, `paperite-server`.
- `ServerConnection`: stable connection ID, display label, endpoint, transport
  hint (`localhost`, `tailscale`, or `custom`), server ID, and timestamps.
- `ServerCapabilities`: protocol version, server ID, supported operations,
  and `authMode: "device-pairing"` for the personal-server MVP.
- A one-time pairing challenge and pairing result containing an ephemeral
  device credential. Persist only a hash of the credential server-side; never
  include raw secrets in durable contract objects, logs, or README examples.
- Device listing and revoke semantics keyed by stable `deviceId`.

Keep `AuthSession` usable for a future authenticated provider, but do not add
credential exchange for Clerk or better-auth to this package. Document that
pairing authenticates a device to a personal server; it does not establish a
multi-user account.

**Verify**: `bun run check` and `bun run smoke` in the server-api package →
both exit 0; README names every new public type and says which values are
ephemeral.

### Step 2: Implement personal-server pairing foundations

In `paperite-server/`, implement only the server-side foundation needed by the
future local sync transport:

1. `paperite-server setup` creates or loads a stable server ID and generates a
   one-time pairing secret/challenge without printing it to persistent logs.
2. Pairing accepts a one-time challenge over the configured local/Tailscale
   endpoint and returns a device credential exactly once.
3. Store only credential hashes and device metadata; support explicit revoke.
4. Expose a capabilities response so the desktop can discover protocol,
   server ID, and auth mode before selecting a space target.
5. Keep `paperite-server serve` headless. The TUI may call the same service
   layer later, but must not own pairing logic.

Do not implement arbitrary custom auth, password login, public sharing, or
Tailscale embedding. The server may document that operators can put it behind
Tailscale Serve at an HTTPS tailnet URL; the server itself should not invoke
`tailscale serve` automatically.

**Verify**: focused server unit/smoke checks cover first pairing, challenge
expiry/replay rejection, token hash-at-rest, per-device revoke, and capability
discovery. `bunx tsc --noEmit -p convex/tsconfig.json` → exit 0. If the current
server has no runtime suitable for these checks, stop and report the missing
transport boundary instead of inventing an HTTP protocol silently.

### Step 3: Add secure desktop connection storage

In `paperite/`:

- Add a connection registry that stores non-secret metadata in the existing
  app/workspace state format.
- Add Electron IPC/preload methods for paired server credentials, following the
  `keytar` pattern in `main.js:1028-1113`.
- Keep tokens out of localStorage, Zustand persisted state, note files, logs,
  crash messages, and URLs rendered in the UI.
- Provide a web-mode fallback that keeps the feature disabled or uses an
  explicitly documented browser storage limitation; do not silently claim
  keychain-level security in browser mode.
- Generalize `cloudSpaceLinks` into a binding model while reading old Convex
  links as `paperite-cloud` bindings.

**Verify**: `bunx tsc -b` and `bun test` in `paperite` → exit 0; tests prove
legacy `cloudSpaceLinks` loads into the new model and no token is emitted by
the persisted app-state serializer.

### Step 4: Build the onboarding state machine

Replace the single boolean gate with versioned onboarding state that can
represent incomplete setup without losing local notes. The first-run flow is:

1. Welcome.
2. Choose `Local only`, `Paperite+`, or `Connect a personal
   server`.
3. For a personal server, choose or enter a localhost/Tailscale/custom HTTPS
   endpoint, run capabilities discovery, then pair the device.
4. Select or create the first space and bind it to exactly one target.
5. Confirm and enter the workspace.

Paperite+ remains Clerk-backed. Personal-server pairing is not presented as a
new account system. Preserve a clear local-only path unless the owner first
resolves the conflict with Plan 016's older "no guest mode" decision.

Keep the existing callback/resume behavior for Clerk actions, but make the
pending intent include the selected target rather than only a raw URL. Do not
mark onboarding complete merely because a login callback returned; mark the
selected setup step complete only after the target is validated or the user
explicitly chose local-only.

**Verify**: add focused tests for fresh install, local-only completion, Clerk
completion, failed pairing retry, cancelled setup, restart during setup, and
switching accounts without losing local notes. `bun test` and `bunx tsc -b` →
exit 0.

### Step 5: Add per-space target UI and safe move/duplicate flows

Add a space-level control in Settings/space settings showing the active target:
local-only, Paperite+, or a named personal server connection. Adding a
connection must not automatically rebind existing spaces.

Implement:

- bind an unbound space to a target;
- duplicate a space to another target while retaining the original binding;
- move a space by uploading, verifying note count/content/update coverage, then
  switching the local binding; leave the old remote data untouched by default;
- disconnect a connection only after listing affected spaces and requiring an
  explicit choice to keep them local or rebind them.

Never silently merge two remote spaces with different IDs. Preserve Yjs
updates and use the existing conflict/identity safeguards in
`src/lib/cloud-space-sync.ts` as the pattern for verification.

**Verify**: tests cover one-target enforcement, duplicate isolation, failed
upload rollback, old binding compatibility, and disconnect warnings. `bun test`
and `bun run lint` → exit 0.

### Step 6: Document the Tailscale path

Document the supported personal-server path:

```text
paperite-server local service
  -> Tailscale Serve (private tailnet HTTPS/WSS endpoint)
  -> Paperite desktop/mobile on the same tailnet
```

Keep localhost as the same-machine default. Tailscale Serve is preferred over
direct non-TLS tailnet HTTP; Funnel is explicitly out of scope for private
sync. The client stores the resulting HTTPS/WSS endpoint as a normal server
connection and still uses the paired device credential.

**Verify**: docs mention endpoint format, pairing, required Tailscale
installation on each participating device, and the fact that Tailscale is
network access rather than Paperite account auth. No secret or real endpoint
is committed.

## Test plan

- `paperite-server/packages/server-api/checks/` — compile/runtime contract
  checks for capabilities, pairing challenge expiry, one-time use, and device
  revoke semantics.
- `paperite-server/` — focused service tests for hash-at-rest and no raw token
  logging.
- `paperite/tests/` — onboarding state transitions, legacy binding migration,
  secure credential boundary, one-target enforcement, and move/duplicate
  failure recovery.
- Model client-side tests after the existing sync/Yjs tests; do not use a real
  Convex deployment or a real Tailscale network in unit tests.

## Done criteria

- [ ] One account can have Paperite+ and multiple personal-server
  connection records without sharing credentials between them.
- [ ] Viewer membership cannot mutate note metadata, snapshots, or update
  batches; owner/editor behavior remains intact.
- [ ] Each space has exactly one active sync target.
- [ ] `paperite-server setup` can create a server identity and pair a device;
  credentials are hashed at rest and individually revocable.
- [ ] `paperite-server tui`/`serve` are not required for the contract tests;
  `serve` remains headless.
- [ ] Desktop tokens never enter localStorage, app-state JSON, note files, or
  logs.
- [ ] Existing Convex `cloudSpaceLinks` migrate to the generalized binding
  model without data loss.
- [ ] Onboarding supports local-only, Paperite+, and personal-server
  choices with retry/cancel/restart-safe states.
- [ ] Tailscale endpoint documentation uses private Serve semantics and does
  not imply that Tailscale replaces application pairing.
- [ ] `bun run check` and `bun run smoke` pass in server-api.
- [ ] Desktop `bun test`, `bunx tsc -b`, and `bun run lint` pass.

## STOP conditions

- The implementation requires password auth, better-auth, or a general OAuth
  registry to complete personal-server pairing.
- A raw pairing token would be persisted in localStorage, app state, notes,
  logs, or a committed file.
- The server runtime is absent and the executor would need to invent an
  unreviewed HTTP/WebSocket protocol. A small pure authorization helper and
  Bun test are allowed; a network/deployment test harness is not.
- The code would silently sync one space to two backends.
- The current Plan 016 auth policy is still treated as mandatory Clerk for
  local-only mode and no owner decision has resolved that conflict.
- Tailscale Funnel or unauthenticated non-loopback HTTP is proposed as the
  default private-server path.
- Existing local notes or old Convex bindings would be deleted during a move.

## Maintenance notes

- Future multi-user collaboration may add a real server-side identity/auth
  adapter, but it must remain separate from personal-device pairing.
- If browser mode gains secure credential storage, replace its documented
  limitation without changing the connection/binding domain model.
- Any new backend must implement the same one-target binding and explicit
  migration semantics; do not add a second global URL singleton.
- Reviewers should inspect token lifetime, replay prevention, revoke behavior,
  and whether failed migrations leave the old binding intact.
