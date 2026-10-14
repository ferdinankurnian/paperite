# Sync Architecture

Paperite is powerful and flexible — local is the base, sync is your choice.
Clerk login (Avalid account) is mandatory. No guest mode.

## Modes

Onboarding asks: Simple (Paperite+) vs Advanced (GDrive / BYO server).
Switch anytime in Settings → Sync.

### GDrive mode (Advanced, solo)

Your own Google Drive `appDataFolder` as dumb storage.
Encrypted Yjs snapshots + append-only updates. Drive is never the merge
authority — Yjs merge stays local.

```txt
Paperite device
-> local filesystem (~/Documents/Paperite + SQLite)
-> Google Drive app folder (bound to Clerk user)
```

- GDrive OAuth token is bound to your Clerk account, so multi-device just works: login on a new device → same Drive → same notes.
- Manage / revoke devices per Clerk account in Settings → Sync → Devices.
- No Paperite-imposed limits. Only Google's quotas apply.

Setup uses OAuth PKCE with the Drive `appDataFolder` scope and a loopback
localhost callback:

```txt
PAPERITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id
PAPERITE_GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
http://127.0.0.1:{randomPort}/callback
```

Electron sync actions:

```txt
sync:get-status
sync:connect-google-drive
sync:run-google-drive
sync:disconnect-google-drive
```

Files live in the hidden app data folder, not visible My Drive.

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
- Own machine (VPS / old PC) as Yjs websocket sync hub (`paperite serve --sync`)

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

## Sync Rule

Never use last-write-wins for note content. Notes synchronize through CRDT
(Yjs) updates or preserved as explicit conflicts. This holds across all
three modes and both server kinds. Plugins / database blocks (plan 021)
sync as opaque block JSON through the same path — no separate sync engine.
