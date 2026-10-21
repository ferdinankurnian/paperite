# Plan 028: One auth source — the browser mirrors the desktop

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report instead of improvising.
> When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f17ead6..HEAD -- main.js
> server/index.js server/lib/auth-bridge.js src/lib/auth-bridge.ts
> src/lib/clerk.ts src/lib/paperite-auth.ts src/lib/clerk-auth.ts
> src/hooks/use-global-auth-callback.ts src/components/auth-dialog.tsx
> src/components/login-view.tsx src/components/app-sidebar.tsx`. If any
> in-scope file changed since this plan was written, compare the Current
> state below with live code before proceeding.

## Status

- **Implementation**: COMPLETE. Browser mirrors the desktop session in both
  ownership orders; the browser has no Clerk login of its own.
- **Priority**: P0
- **Effort**: M
- **Risk**: HIGH (auth lifecycle, session handoff, token leakage)
- **Depends on**: 026 (device-bound auth), 027 (shared workspace ownership)
- **Category**: security / auth / architecture
- **Planned at**: commit `f17ead6`, 2026-10-20

## Why this matters

Paperite presents the desktop app and `paperite serve` as two surfaces of one
installation. Until now they could hold **two independent Clerk sessions** —
the Electron renderer in its persistent partition, and the browser in its own
storage — on two different accounts. Plan 026 stopped a *different account*
from taking over the device binding, but the browser could still carry its own
session for the *same* account, with its own refresh token, its own expiry, and
its own sign-out button. That is a second identity for one installation.

The product requirement is one installation, one account, one session. The
desktop app is the auth authority; the browser is a mirror.

## Product decisions

1. The desktop app is the single auth authority. The browser never runs a
   Clerk OAuth round-trip and never holds a Clerk session.
2. The browser shows **"Open Paperite on your desktop to sign in"** and waits.
   There is no browser sign-in button to fall back on.
3. The browser adopts the desktop's account automatically — it polls the
   bridge and picks up a sign-in without a reload.
4. Clerk refresh tokens never leave the Electron renderer. The browser only
   ever receives the current identity and short-lived Convex JWTs.
5. Signing out from a mirrored browser asks the desktop to clear the device
   binding and sign out the desktop session. The browser itself offers no
   Sign Out button — the session it shows belongs to the desktop app, so a
   stray tab must not be able to end it.
6. **Closing the desktop is not a sign-out.** The Clerk session outlives the
   process (it lives in Electron's persistent partition), so the server
   remembers the last identity it pulled and keeps serving it while the
   desktop is down. Only a real sign-out clears the remembered identity, and
   a cached token is only handed out while its own `exp` claim says it is
   still valid — a stale JWT would be rejected by Convex with a confusing
   error.
6. The OS keychain binding stays as the account-consistency guard on top of
   this. It is not a session store and never becomes one.
7. The browser must not be a hole in the wall. A local server with no auth
   of its own is reachable by any website the user visits, so the serve
   server rejects cross-site requests and never answers with a wildcard
   CORS header.
8. A browser blocks whenever no desktop is attached. The browser cannot
   sign in, sync, or manage devices without it, so it shows a
   non-dismissible dialog rather than degrading silently. That covers both
   the desktop never having started and the desktop having been closed —
   in the latter case the server still remembers the identity, so
   `signedIn` stays true and cannot be the signal; the signal is
   `attached`.
9. "Which bundle" is not "which surface". When the desktop attaches to
   `paperite serve` it renders serve's web bundle over `http://localhost`,
   so `import.meta.env.PAPERITE_WEB` is 1 inside Electron. Surface checks
   must ask the Electron preload bridge (`isDesktopRenderer()` /
   `isBrowserRenderer()`) — otherwise the desktop loses its frameless
   window's titlebar the moment it attaches to a server.

## Current state

- `src/lib/auth-bridge.ts` — the browser's session fetch. Returned `null` on a
  404, which the caller could not distinguish from "no bridge"; callers used
  that `null` to fall back to a browser-local Clerk session.
- `src/lib/paperite-auth.ts` — `getPaperiteSession()` fell through to
  `loadClerk()` whenever the bridge was absent, so a browser always had a
  private Clerk session path.
- `src/lib/clerk.ts` — `loadClerk()` initialized clerk-js unconditionally, so
  the browser could restore a second session from its own storage.
- `src/lib/clerk-auth.ts` — `continueWithGoogle()` and
  `ensureSignedInForCloud()` both opened a browser-side Clerk flow.
- `src/hooks/use-global-auth-callback.ts` — completed the pure-web
  `__clerk_` OAuth callback in the browser.
- `server/index.js` — `GET /api/auth/session` only knew the desktop-first
  ordering (serve attached to the Electron workspace owner). It 404'd in the
  serve-first ordering, and the browser treated that as "no bridge, use my own
  Clerk session".
- `main.js` — published only the workspace owner bridge, and only when the
  desktop owned the workspace. It had no way to answer a session request in
  the serve-first ordering.

## Scope

**In scope**

- A browser/desktop surface discriminator that survives both orderings.
- A browser that mirrors the desktop session and never authenticates itself.
- Session pull over the loopback bridge in both ownership orders.
- The "sign in on the desktop" UI and the automatic hand-off.
- A secret-authenticated auth bridge for the serve-first ordering.
- Tests and documentation.

**Out of scope**

- Sharing raw Clerk cookies or refresh tokens with the browser.
- Making `paperite serve` a standalone identity provider.
- Multi-user LAN access, remote browser SSO, LAN authentication.
- Changing the device binding format or its keychain semantics.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Syntax | `node --check main.js && node --check server/index.js && node --check server/lib/auth-bridge.js` | exit 0 |
| Typecheck | `bunx tsc -b --pretty false` | exit 0, no errors |
| Tests | `bun test` | all tests pass |
| Lint | `bunx biome check <changed files>` | exit 0 (repo baseline has pre-existing findings) |
| Build | `bun run build:web` | exit 0 and stamped `dist-web/` |

## Steps

### Step 1: Distinguish a browser mirror from a desktop surface

`import.meta.env.PAPERITE_WEB` is true for the whole web bundle, and the
desktop app loads that same bundle when it attaches to a serve instance. So
the build flag cannot tell them apart. The Electron preload bridge can.

Add `isDesktopRenderer()` (presence of `window.electron`) and
`isBrowserRenderer()` (web build **and** no Electron bridge) to
`src/lib/auth-bridge.ts`. Every auth decision keys off these, not off
`PAPERITE_WEB`.

**Verify**: `bunx tsc -b` passes; a plain browser and the attached Electron
window land on different sides of the predicate.

### Step 2: Stop the browser from authenticating itself

- `src/lib/clerk.ts`: `loadClerk()` resolves without initializing clerk-js in
  a browser, and `clerk.*` returns an inert stub there.
- `src/hooks/use-global-auth-callback.ts`: skip the whole callback path in a
  browser — there is no browser OAuth round-trip to complete.
- `src/lib/clerk-auth.ts`: `continueWithGoogle()` refuses in a browser;
  `ensureSignedInForCloud()` resolves against the desktop session.
- `src/lib/sync-provider.ts`: the Convex JWT comes from the bridge in a
  browser, never from a local Clerk session.

**Verify**: `bunx tsc -b` passes; `bunx biome check` on the changed files is
clean; no browser code path calls `loadClerk()`.

### Step 3: Pull the desktop session in both ownership orders

- Desktop-first (desktop owns the workspace): serve already proxies through
  the owner bridge. Keep that path.
- Serve-first (serve owns the workspace, desktop attached): the desktop
  publishes a separate auth bridge; serve pulls from it.

Add `server/lib/auth-bridge.js` — a small module that publishes, reads and
clears a secret-authenticated bridge record under `<workspace>/.paperite/`,
plus a `requestAuthBridge()` client. In `main.js`, start that bridge when the
desktop attached to a serve instance. In `server/index.js`, resolve
`GET /api/auth/session` through whichever bridge applies.

The bridge record lives in the workspace, carries a per-process random secret,
and is validated for liveness — a dead desktop must not look like a live one.

**Verify**: `bun test tests/auth-bridge.test.ts` passes (publish, read,
malformed record, dead pid, clear, wrong secret refused). `GET
/api/auth/session` returns `{attached:false,...}` with no desktop attached and
the desktop's identity once one is.

### Step 4: Mirror the session and hand off automatically

- `src/lib/paperite-auth.ts`: a browser reports the desktop's session and
  whether it is still waiting for a desktop.
- `src/components/app-sidebar.tsx`: poll the bridge in a browser and announce
  the desktop sign-in globally so open dialogs close themselves.
- `src/components/desktop-signin-prompt.tsx`: the "sign in on the desktop"
  prompt, used by both the auth dialog and the login view.
- `src/components/auth-dialog.tsx` / `login-view.tsx`: no Google button in a
  browser — the desktop prompt instead.
- `src/routes/_auth/login.tsx`: skip the Clerk check in a browser.

The **Devices** panel needs the same treatment: it used to call
`clerk.user.getSessions()` directly, which a browser can no longer do. The
desktop lists, revokes, and renames on the browser's behalf over the same
bridge (`auth:list-sessions`, `auth:revoke-session`,
`auth:revoke-other-sessions`, `auth:update-metadata`), and the browser
renders the result. Shared user metadata (device names) is written the same
way, so renaming a device from the browser still syncs to every device.

**Verify**: `bunx tsc -b` passes; `bun run build:web` produces a bundle
containing the desktop prompt; the new endpoints answer on a live serve
instance with a desktop attached.

### Step 5: Close the cross-site hole the mirror would otherwise open

A local server with no auth of its own is reachable by any website the
user visits. The identity bridge makes that worse, because it hands out a
Clerk identity and a Convex JWT. So:

- CORS becomes an allowlist (`PAPERITE_ALLOWED_ORIGINS`), never `*`.
- Every data-bearing request (`/api/*`, `/note-assets/*`, and the
  live-sync WebSocket) must look same-site to the browser: `Sec-Fetch-Site`
  same-origin/same-site, a loopback `Origin` (or an allowlisted one), and a
  loopback `Host` (which is what stops DNS rebinding, and which an
  allowlisted origin cannot opt out of).

**Verify**: `bun test tests/origin-guard.test.ts` passes; a request with a
foreign `Origin` is rejected with 403 and no `Access-Control-Allow-Origin`
header; a same-origin request still works; the WebSocket refuses a
cross-site upgrade with 401; an allowlisted origin is echoed by CORS and
passes the check, but still cannot use a rebound `Host`.

### Step 6: Document and verify

Document the model in `docs/sync.md` — one auth authority, what crosses the
bridge, what never does, and the new "sign in on the desktop" behavior.

**Verify**: `bun test`, `bunx tsc -b`, `bun run build:web` all pass; `git
diff --check` reports no whitespace errors.

## Test plan

- `tests/auth-bridge.test.ts`: publish/read/clear round-trip, malformed
  record refused, dead pid ignored, wrong secret refused by the far side,
  and the record's location inside the workspace.
- Manual: with a desktop running and signed in, a browser against
  `paperite serve` shows the same account without a second login, and no
  Clerk refresh token appears in the browser's storage.
- Manual: with no desktop running, the browser shows "Open Paperite on your
  desktop to sign in" and picks the account up once the desktop starts.

## Done criteria

- [x] The browser never runs a Clerk OAuth flow and never holds a Clerk
      session.
- [x] The browser shows the desktop's identity and adopts it automatically
      when the desktop signs in.
- [x] Both ownership orders resolve the desktop's session over the loopback
      bridge.
- [x] The Devices panel works in a browser: the desktop lists and revokes
      sessions and writes device names on the browser's behalf.
- [x] Clerk refresh tokens never leave the Electron renderer; the browser
      only gets the identity and short-lived Convex JWTs.
- [x] Signing out from a mirrored browser signs out the desktop session and
      clears the device binding.
- [x] A browser offers no Sign Out button — the session belongs to the
      desktop app, so a stray tab cannot end it.
- [x] Closing the desktop keeps the account visible in the browser: the
      server remembers the last identity it pulled, and a real sign-out
      still clears it.
- [x] A browser shows a non-dismissible dialog when no desktop is attached
      (never started *or* closed), and closes it again once the desktop
      returns.
- [x] A browser with no desktop and no session never loads the workspace:
      the page stays blank behind the dialog until a desktop shows up.
- [x] The desktop keeps its titlebar and window controls when it attaches
      to `paperite serve` — the chrome follows the surface, not the build
      flag.
- [x] Cross-site requests to the serve server are rejected and CORS never
      answers with `*`, so a hostile page cannot read notes or lift the
      desktop's identity and Convex JWT.
- [x] `bun test`, `bunx tsc -b`, and `bun run build:web` pass.

## STOP conditions

- The browser cannot be prevented from restoring a second Clerk session from
  its own storage.
- A refresh token or long-lived credential would have to cross the bridge.
- The auth bridge would have to bind to a non-loopback interface or expose
  its secret to renderer JavaScript.
- Supporting the mirror would weaken the device binding or the keychain
  fallback policy.
- Any verification command fails twice after a scoped fix attempt.

## Maintenance notes

- Keep the surface discriminator (`isDesktopRenderer`) separate from the
  build flag (`PAPERITE_WEB`). The desktop app runs the web bundle when it
  attaches to a serve instance, so the flag alone is wrong.
- New auth surfaces must mirror the desktop, not authenticate themselves. The
  invariant: no Clerk session exists outside the desktop renderer.
- The device binding is a consistency guard, not a session store. Keep it
  that way.
- LAN authentication, remote browser SSO, and true multi-device session
  sharing remain follow-up work.
