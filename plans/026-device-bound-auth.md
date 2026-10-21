# Plan 026: Bind Paperite installation to one Clerk account

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report instead of improvising.
>
> **Drift check (run first)**: `git diff --stat f17ead6..HEAD -- main.js
> preload.js server/index.js src/lib/clerk.ts src/lib/clerk-auth.ts
> src/hooks/use-global-auth-callback.ts src/components/login-view.tsx
> src/components/app-sidebar.tsx src/components/settings/account-sessions.tsx
> src/lib/credential-store.ts src/vite-env.d.ts package.json tests`
> If any in-scope file changed since this plan was written, compare the
> Current state below with live code before proceeding.

## Status

- **Implementation**: COMPLETE. Core keychain binding, Electron/serve
  bridges, Clerk gating, explicit account change, tests, and docs are in place.
  Repo-wide lint cleanup remains a separate follow-up because the current
  baseline includes a Biome schema mismatch plus generated-file and bundle
  diagnostics unrelated to this feature.
- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH (auth lifecycle, Electron keychain, browser bridge)
- **Depends on**: none
- **Category**: security / auth / architecture
- **Planned at**: commit `f17ead6`, 2026-10-20

## Why this matters

Electron and `paperite serve` currently maintain independent Clerk sessions in
different renderer/browser storage. That allows one installed Paperite device
to be logged into account A in Electron and account B in the browser, while
both can access the same local workspace. The product requirement is one
Paperite installation/device bound to exactly one Clerk account, consistently
across desktop and browser surfaces.

The OS keychain must become the device-account authority. Do not treat a raw
Clerk browser token as the durable device identity: Clerk owns token refresh
and expiry. Store a device binding/secret in the keychain, validate the
current Clerk identity against it, and fail closed on an account mismatch.

## Current state

- `main.js:24-180` loads optional `keytar`, defines the existing
  `dev.iydheko.paperite` keychain service, and stores personal-server
  credentials there. This is the existing keychain boundary to extend.
- `main.js:2070-2090` gives Electron a persistent Chromium partition
  (`persist:paperite`), so Electron Clerk storage survives restarts but is not
  shared with a normal browser.
- `src/lib/clerk.ts` creates a singleton `@clerk/clerk-js` client and calls
  `load()`. It currently has no device-binding gate.
- `src/lib/clerk-auth.ts:resolveAuthCallbackUrl` uses an Electron loopback
  callback and falls back to the current browser origin for `paperite serve`.
- `src/hooks/use-global-auth-callback.ts` completes callbacks and dispatches
  `paperite:auth-success`; it must not announce success before the device
  account check passes.
- `server/index.js:32-43,330-337` starts the headless browser server and
  explicitly documents that non-loopback `serve` has no auth. The normal
  default is loopback, but the server process is the only component that can
  read the OS keychain for browser mode.
- `src/lib/credential-store.ts` deliberately refuses browser persistence for
  personal-server credentials. Match that security posture: browser mode must
  use a narrow server bridge, never localStorage, for device credentials.
- `src/components/app-sidebar.tsx:3440-3528` mirrors Clerk user data for
  display and calls `clerk.signOut()`. Its display cache must never become the
  source of truth for the binding.
- `src/components/settings/account-sessions.tsx` lists/revokes Clerk active
  sessions. This remains useful for session management but is not the device
  binding store.
- `package.json` already depends on `keytar` and uses Bun. Do not edit
  `package.json` directly; use `bun add` only if a new dependency is truly
  needed.

## Product and security decisions

1. The binding is installation-wide, not per workspace. The default Paperite
   workspace and any `--workspace` path must use the same device account.
2. First successful Clerk login claims the device. Store a generated random
   device secret and the resulting Clerk user ID in one keychain record.
3. A later Clerk session for another user is rejected and signed out locally.
   It must never silently replace the binding.
4. "Sign out" clears the active Clerk session and the device binding. The next
   login may claim the device for the account the user chooses; there is no
   separate account-switching action in the current product.
5. Keychain-unavailable is an auth error by default for a configured Clerk
   build. Offer an explicit, clearly warned insecure file fallback; never
   select it silently. Local-only mode may still work when Clerk is not
   configured.
6. `paperite serve` must bind to loopback for this feature. If a user selects a
   non-loopback host, keep the existing warning and additionally explain that
   device binding is not a network access-control boundary; LAN exposure
   remains out of scope until server authentication exists.
7. The durable keychain value is a device-binding credential, not a long-lived
   Clerk access token. Clerk session tokens remain short-lived and are managed
   by Clerk.

## Scope

**In scope**

- A shared device-auth contract and keychain implementation in the Electron
  main process and headless server process.
- Electron IPC/preload methods for reading status, claiming the device, and
  explicitly changing the bound account.
- A loopback-only `paperite serve` bridge exposing the minimum status/claim/
  change operations needed by the browser renderer.
- Clerk load/callback gating, account-mismatch UI, and explicit account-change
  UX.
- Tests for keychain record validation, first claim, same-user reuse, mismatch,
  keychain failure, and browser-vs-Electron adapter behavior.
- Documentation and this plan's status update.

**Out of scope**

- Sharing raw Clerk cookies or refresh tokens between Electron and browsers.
- Making `paperite serve --host 0.0.0.0` safe for LAN use.
- Multi-user local workspaces, per-workspace account bindings, or account
  switching without explicit confirmation.
- Changing Convex authorization rules; Convex already authorizes by Clerk JWT
  identity in `convex/sharedSpaces.ts`.
- Editing `src/routeTree.gen.ts` or running a route-tree generator.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check main.js && node --check server/index.js` | exit 0 |
| Typecheck | `bunx tsc -b` | exit 0, no errors |
| Tests | `bun test` | all tests pass |
| Lint | `bun run lint` | exit 0 |
| Build | `bun run build:web` | exit 0; do not start a dev server |

## Steps

### Step 1: Define the device-auth contract and pure validation

Create a small shared TypeScript contract/module for the renderer-facing
result types and a pure validation layer. The record must include a version,
random device identifier, bound Clerk user ID, creation timestamp, and a
random binding secret or equivalent opaque credential. Never expose the secret
to renderer JavaScript or persist it outside keychain storage.

Define explicit outcomes: `unbound`, `bound`, `claimed`, `account-mismatch`,
`keychain-unavailable`, and `invalid-record`. Keep account IDs and status
metadata non-secret; keep the binding secret in keychain-only storage.

**Verify**: add unit tests for valid records, malformed JSON, wrong version,
empty IDs, and expired/invalid timestamps; `bun test tests/device-auth.test.ts`
passes.

### Step 2: Implement the keychain-backed main/server store

Extract or add a narrow keychain adapter around the existing `keytar` service
`dev.iydheko.paperite`. Use a dedicated account name such as
`device-auth-binding:v1`; do not reuse personal-server credential accounts.

Implement read/status, first claim with compare-and-set semantics, and
explicit clear. Claim must be race-safe within the process and must refuse a
different Clerk user. On `keytar` absence or failure, return the explicit
keychain-unavailable outcome rather than using a file/localStorage fallback.

The same adapter must be callable by Electron `main.js` and `server/index.js`.
Avoid importing Electron-only modules into the headless server.

**Verify**: unit tests cover first claim, repeated same-user claim, mismatch,
clear, malformed stored record, and simulated keytar failure; `bun test
tests/device-auth.test.ts` passes and `node --check main.js && node --check
server/index.js` exits 0.

### Step 3: Add Electron IPC and headless loopback bridge

Add preload typings and IPC handlers for status/claim/clear. The Electron
renderer may receive status and bound user ID, but never the keychain secret.

Add narrow `/api/device-auth/*` endpoints to `paperite serve` for the browser
renderer. Require loopback requests for these endpoints and reject or disable
them on non-loopback binds. Do not create a generic endpoint that returns the
keychain record or accepts arbitrary account IDs without the renderer's
validated Clerk identity.

The bridge must support the browser's current Clerk identity check. If the
implementation needs server-side JWT verification to trust the identity,
stop and report the missing Clerk server-verification dependency/configuration
instead of accepting an unverified user ID as a security boundary. For the
minimum accidental-account-mixup requirement, the browser may compare its
loaded `clerk.user.id` with the bound ID, but document that loopback-only
bridge as a local-device consistency mechanism, not LAN security.

**Verify**: add route/IPC tests for status, claim, mismatch, clear, and
non-loopback rejection; `bun test` passes and no endpoint response includes
the binding secret.

### Step 4: Gate Clerk session restoration and OAuth completion

Update `src/lib/clerk.ts` and `src/hooks/use-global-auth-callback.ts` so every
loaded session goes through the device-auth gate:

- no Clerk config: preserve local-only behavior;
- no device binding: allow the first successful signed-in user to claim it;
- same `clerk.user.id`: continue normally;
- different user: do not dispatch auth success, show a clear mismatch error,
  and sign out the current Clerk session;
- keychain/bridge failure: show an actionable auth error and do not enter the
  app as the wrong account.

Ensure callback completion claims/checks the account before onboarding or cloud
intent resumption. Avoid a race where the sidebar briefly caches a mismatched
user as signed in.

**Verify**: add integration-level tests with mocked Clerk and device-auth
adapters for cold start, OAuth callback, same-account reload, mismatch, and
keychain unavailable; `bun test` and `bunx tsc -b` pass.

### Step 5: Clear the device binding on sign-out

Ordinary sign-out must clear the active Clerk session and the device binding
through the main/server bridge, clear display-only cached user data, and return
to login. If clearing fails, keep the session intact and report the error. A
later login can claim the unbound device for a different account.

**Verify**: component tests cover sign-out clearing the binding and clear
failure; `bun run lint` and `bunx tsc -b` pass.

### Step 6: Document behavior and perform full verification

Document in the auth/serve documentation that one installation maps to one
Clerk account, that browser login may need to be established once per browser
profile, and that changing accounts is explicit. Document that non-loopback
`serve` remains unauthenticated for local notes.

Run the full verification matrix:

```text
bun test
bunx tsc -b
bun run lint
bun run build:web
```

**Verify**: all commands exit 0; `git diff --check` reports no whitespace
errors; no new code uses localStorage or a plaintext file for the device
binding.

## Test plan

- `tests/device-auth.test.ts`: pure record validation and state transitions.
- Keychain adapter tests with an in-memory fake keytar: first claim, same-user
  idempotence, mismatch refusal, clear, malformed data, unavailable keychain.
- `server/index` route tests: loopback bridge behavior and non-loopback refusal.
- Clerk gate tests: same user, different user, no binding, callback failure,
  and no false `paperite:auth-success` event.
- UI tests: ordinary sign-out vs explicit account change and failure handling.
- No real Clerk credentials, OAuth accounts, or real keychain entries in tests.

## Done criteria

- [ ] Electron and `paperite serve` consult the same OS-keychain device binding.
- [ ] First successful Clerk login claims the device; a different account is
      rejected everywhere while the binding exists.
- [ ] Ordinary sign-out clears the binding before ending the Clerk session.
- [ ] No raw Clerk refresh/access token is stored as the durable binding.
- [ ] No device binding fallback exists in localStorage; insecure file fallback
      is opt-in, clearly warned, and never silently selected.
- [ ] Non-loopback `paperite serve` remains clearly warned/restricted and is
      not presented as authenticated LAN access.
- [ ] `bun test`, `bunx tsc -b`, `bun run lint`, and `bun run build:web` pass.
- [ ] Only in-scope files are modified, plus the required `plans/README.md`
      status row.

## STOP conditions

- The keychain adapter cannot be used by both Electron and `paperite serve`
  without exposing a secret to browser JavaScript.
- The implementation requires trusting an arbitrary browser-supplied Clerk user
  ID for anything beyond loopback accidental-account consistency; stop and
  propose server-side Clerk JWT verification.
- Existing `keytar` behavior differs from the current personal-server pattern
  in a way that could delete or overwrite personal-server credentials.
- Clerk callback success can be dispatched before the device gate completes.
- A fix requires changing `routeTree.gen.ts`, broadening non-loopback server
  access, or weakening the existing credential-store no-fallback policy.
- Any verification command fails twice after a reasonable, scoped fix.

## Maintenance notes

- Keep the device binding separate from Clerk session expiration and from
  personal-server credentials. Clerk may rotate sessions; the device binding
  should remain stable until the user explicitly changes account.
- Review every new auth surface for the invariant: no alternate Clerk user can
  become active on the installation without an explicit account-change flow.
- If Paperite later supports multiple independent installations under one OS
  user, add an explicit installation profile ID; do not silently change this
  binding to per-workspace storage.
- LAN authentication, remote browser access, and true browser SSO are follow-up
  work. This plan guarantees account consistency, not network authorization.
