# Sync Architecture

Paperite is powerful and flexible — local is the base, sync is your choice.
Local-first: notes always work without login. Clerk sign-in is required
only for Paperite+ and custom server sync — never for
local notes.

## Modes

Onboarding asks: Simple (Paperite+) vs Advanced (BYO server).
Switch anytime in Settings → Sync.

### Paperite+ cloud (Simple, default)

Hosted convenience. Login and sync everywhere, realtime multiplayer
collab, publish notes as public webpages. See `plans/016-paperite-plus-model.md`.

```txt
Paperite device
-> Avalid hosted sync (Convex cloud or Avalid Yjs infra)
-> shared space permissions + presence
```

- Host pays, members join free. Roles: owner / editor / viewer.
- Inbox syncs multi-device realtime.
- Publish path (CF Workers / Pages) is separate from collab sync.

### BYO paperite-server (Advanced, nerds + enterprise)

Self-host the open-source backend. Two backend kinds behind one
`SyncProvider` contract — see `plans/018-paperite-server.md`:

- BYO Convex deployment (pick your own region, e.g. us-east-1) + BYO Clerk issuer
- Own machine (VPS / old PC) as Yjs websocket sync hub (`paperite serve`)

```txt
paperite (desktop) ──┐
                     ├──► SyncProvider ──┬──► Avalid hosted (Paperite+)
paperite-mobile ─────┘                   ├──► BYO Convex deployment
paperite serve (web) ─┘                  └──► BYO local machine (Yjs ws)
```

Auth adapters: Clerk (default, official path) or better-auth (BYO local
option, selected by `AUTH_KIND` env).

Required env (convex kind):

```txt
VITE_CONVEX_URL=your-convex-deployment-url
CLERK_JWT_ISSUER_DOMAIN=https://your-clerk-issuer
```

Local kind instead uses server URL + kind flag (`Settings → Sync` shows
Avalid / Convex BYO / Local pill). Mobile uses `EXPO_PUBLIC_*` default
with AsyncStorage override.

Backend schema currently covers shared spaces, members, notes, Yjs
updates, and snapshots. Free users are limited to two owned shared spaces
in the `sharedSpaces.create` mutation (hosting shared spaces beyond that
needs Paperite+; BYO operators set their own policy).

## Clerk redirect allowlist (serve / web)

Sign-in uses Clerk OAuth with a **per-mode** redirect URL — never an env
override:

- Electron: a throwaway loopback server
  (`http://127.0.0.1:{randomPort}/callback`), forwarded into the renderer
  over IPC. `paperite://` is only the internal IPC payload shape; Clerk
  rejects non-http(s) schemes, so it is never handed to Clerk.
- Browser / `paperite serve`: the redirect lands back in the same window —
  `window.location.origin + pathname`.

That means **every serve origin must be allowlisted in the Clerk
dashboard**, otherwise the OAuth round-trip is rejected. When you change
ports, update the allowlist too:

1. Clerk Dashboard → your app → **Allowed origins / Redirect URLs**.
2. Add the exact serve origin, e.g. `http://localhost:4173` — and again
   for every custom port you serve on (`http://localhost:5180`, …).
3. Keep `window.location.origin + pathname` reachable: serve the built app
   from that origin, then "Continue with Google" returns signed in and a
   reload keeps the session.

This allowlist only matters for the **desktop** surface. The browser half of
`paperite serve` never runs this OAuth flow — it follows the desktop session
(see below), so a serve origin that is not allowlisted still works in the
browser as long as the desktop is signed in.

### Loopback is not a security boundary

`paperite serve` binds to loopback and has no authentication of its own.
That stops other *machines*, but it does **not** stop a **browser**: a page
on `https://evil.example.com` can issue requests to `http://127.0.0.1:3000`,
and those requests arrive from `127.0.0.1`. Whether the attacker may read
the response is decided by the browser, via CORS.

So the server applies two browser-level protections:

- **CORS is an allowlist, never `*`.** Only origins listed in
  `PAPERITE_ALLOWED_ORIGINS` (comma-separated) are echoed back. A wildcard
  would let any site read an authenticated response.
- **Every data-bearing request must look same-site.** A request is rejected
  unless `Sec-Fetch-Site` says same-origin/same-site, any `Origin` header is
  a loopback origin (or explicitly allowlisted), and the `Host` header is a
  loopback name. The `Host` check is what stops DNS rebinding, where an
  attacker's domain resolves to `127.0.0.1` — and it applies even to an
  allowlisted origin, so the allowlist can never opt out of it.

This covers `/api/*`, `/note-assets/*`, and the live-sync WebSocket. A
hostile page therefore cannot read your notes, write notes, or lift the
desktop's Clerk identity and Convex JWT out of your browser. Non-browser
clients (the Electron main process, the mobile app, `curl`) send no
`Origin` header and are unaffected.

Keep `paperite serve` on its default loopback host; non-loopback mode still
has no authentication for local note endpoints.

### One account per Paperite installation

The desktop app is the **single auth authority** for an installation. A
browser opened against `paperite serve` is a *mirror* of the desktop
session — it never signs in with Clerk on its own, so the same installation
can never end up with two sessions on two accounts.

How the mirror works:

- The browser asks the serve server for the desktop's session
  (`GET /api/auth/session`).
- The serve server pulls that session from the desktop over a
  loopback-only, secret-authenticated bridge and hands the browser the
  current identity plus, when Convex asks for one, a short-lived Convex
  JWT. **Clerk refresh tokens never leave the desktop renderer.**
- Two ownership orders are supported, and both end at the desktop
  renderer: when the desktop owns the workspace, serve proxies through the
  desktop's owner bridge; when serve owns the workspace and the desktop
  attached to it, the desktop publishes a separate auth bridge that serve
  pulls from.
- **"Which bundle" is not "which surface".** In the second order the
  desktop renders serve's *web bundle* over `http://localhost`, so
  `import.meta.env.PAPERITE_WEB` is 1 inside Electron. Anything that has
  to know whether it is the desktop (the custom titlebar, the Clerk
  session, the auth bridge) must ask the Electron preload bridge instead —
  `isDesktopRenderer()` / `isBrowserRenderer()`. The desktop keeps its
  titlebar and window controls when it attaches to a server, because its
  window is frameless.
- The browser polls the bridge and adopts the desktop's account as soon as
  the desktop signs in — no reload, no second login.
- **Closing the desktop does not log you out.** The Clerk session lives in
  Electron's persistent partition and outlives the app, so the server
  remembers the last identity it pulled and keeps serving it when the
  desktop is not running. The account stays visible, notes keep working,
  and the UI says the desktop app is not running (cloud sync needs it for a
  fresh token). Reopening the desktop restores live behaviour immediately.
  A real sign-out on the desktop does clear the remembered identity.
- **A browser blocks when no desktop is attached.** Sign-in, cloud sync, and
  device management all need the desktop, so a browser that has no desktop
  session to follow shows a non-dismissible dialog instead of quietly
  degrading. That covers both cases — the desktop was never started, and
  the desktop was running and has since been closed (the server still
  remembers the session, so the account stays visible behind the dialog).
  The dialog closes by itself as soon as the desktop is running again; the
  button in it launches the desktop through the `paperite://` protocol.
- **A browser with no desktop and no session does not load the workspace
  at all.** There is no account, no cloud, and no devices to show, so the
  page stays blank behind the dialog instead of putting a broken shell on
  screen. The workspace mounts the moment a desktop shows up. A browser
  that still has a session — the desktop was closed but the server
  remembers it — keeps rendering the app behind the dialog, so the notes
  stay reachable.
- `paperite serve` says the same thing at startup: with no desktop
  attached it prints a warning that the browser follows the desktop's
  session, so sign-in, cloud sync and device management need the desktop
  app running. It is a warning, not a block — serve may legitimately start
  first and have the desktop attach a moment later, and serve prints
  "Paperite desktop app detected." when that happens.
- Account management follows the same rule. The **Devices** panel cannot
  call Clerk's session API from a browser, so the desktop lists and revokes
  sessions and writes shared device names on the browser's behalf. Renaming
  a device from the browser still syncs to every device.

If the desktop is not running (or is running but signed out), the browser
shows **"Open Paperite on your desktop to sign in"** and waits. There is no
browser sign-in button to fall back on.

Logging out from a mirrored browser asks the desktop renderer to clear the
device binding and sign out the desktop session. Keep `paperite serve` on
its default loopback host; non-loopback mode still has no authentication
for local note endpoints.

A browser does not offer a **Sign Out** button. The session it shows
belongs to the desktop app, so ending it is the desktop's decision to make
— a stray tab should not be able to sign the desktop out. The account panel
says "Signed in via the desktop app" instead.

The OS keychain binding is an account-consistency guard on top of that: it
stores the bound Clerk user/device identity and a device secret, not a
reusable Clerk refresh token.

If the OS keychain is unavailable, Paperite offers two choices: set up a
Secret Service provider/keyring and retry, or explicitly opt into a less-secure
local file fallback. The fallback uses restrictive file permissions where the
OS supports them, but it is not equivalent to Keychain, Credential Vault, or
Secret Service and remains marked as insecure. Paperite never falls back to
this mode silently.

## Sync Rule

Never use last-write-wins for note content. Notes synchronize through CRDT
(Yjs) updates or preserved as explicit conflicts. This holds across all
three modes and both server kinds. Plugins / database blocks (plan 021)
sync as opaque block JSON through the same path — no separate sync engine.
