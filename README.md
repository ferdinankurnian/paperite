# Paperite

A powerful and flexible notes app with a Discord-like feel, built with Electron and React.

Spaces work like servers, notes work like channels, folders work like nestable categories. Notes are stored as JSON + Yjs updates in `~/Documents/Paperite` with a local SQLite index for full-text search. Local is the base — sync is your choice.

## Positioning

Paperite is NOT just a "local-first desktop note-taking app". Local-first is the default because servers cost money, not because it's the identity.

Paperite is fast, flexible, and extensible:

- **Simple by default** → Paperite+ cloud, login and sync everywhere
- **Advanced when you want it** → bring your own storage / server
- **Fast on low-spec machines** → if it runs flawless on weak hardware, it's good enough

Clerk login (Avalid account) is required. It binds your identity, your GDrive, and your devices together. No anonymous guest mode — this is for safety, device management, and conflict tracking.

## Sync modes

Pick one in onboarding. Change anytime in Settings → Sync.

1. **GDrive mode** — your own Google Drive `appDataFolder` as dumb storage. Encrypted Yjs snapshots + append-only updates. Drive is never the merge authority, Yjs merge stays local. Bound to your Clerk account so multi-device just works. Manage / revoke devices per account.
2. **Paperite+ cloud** — hosted convenience. Realtime multiplayer collab + multi-device sync + publish notes as public webpages. Host pays, members join free. No infra to touch.
3. **BYO paperite-server** — self-host the open-source backend. Run on Convex cloud (BYO deployment + BYO Clerk issuer) or on your own machine (VPS / old PC) as a Yjs sync server. Bring your own auth: Clerk or better-auth. For nerds and enterprises that can't put data on someone else's cloud.

Rule: never last-write-wins. Note content always syncs via CRDT updates or explicit conflicts.

## Features

- Rich text editor (TipTap + Yjs) with formatting, lists, code blocks, and more
- Spaces / nested folders / pin note to top, Discord-style sidebar
- Tabs like a browser (fixed vs pinned, preview tab, per-tab YDoc cache)
- Full-text search via SQLite FTS5
- Pop-out note windows, Zen mode, customizable shortcuts
- Notion-style views + Plugins (kanban, tldraw, custom blocks — see `plans/021-plugins-database-view.md`)
- `paperite serve` — run without Electron, use in any browser

## `paperite serve` (headless)

The packaged binary doubles as a CLI — no Electron window, UI opens in any
browser (same notes, same `~/Documents/Paperite`):

```bash
./Paperite-*.AppImage serve --port 3000 --open
./scripts/paperite.sh serve --workspace ~/Notes   # tarball
```

`paperite` with no args boots the Electron desktop app. `paperite serve`
boots headless: prints the URL and blocks.

Options: `--port` (default 3000), `--host` (default 127.0.0.1),
`--workspace <dir>`, `--open`, `--no-browser`, `--help`.
On `EADDRINUSE` the boot fails hard — it never silently hops ports,
because the Clerk dashboard allowlist needs a stable port.

Only one serve instance at a time (any port, any workspace): a pid-checked
lockfile in tmp guards serve-vs-serve, and a per-workspace
`.paperite/active.lock` refuses Electron+serve on the same workspace
instead of silently splitting `index.sqlite`. A second serve boot points
you at the running address + workspace instead of starting a second
backend — there is no isolated-second-serve via `--workspace`.
`--workspace <dir>` only selects which workspace this single serve opens
(e.g. to dodge a workspace held by the Electron desktop).
Non-loopback `--host` prints a warning: serve has no auth yet, so don't
expose it to a network you don't trust.

Dev equivalent (Vite on 5173 proxies `/api` to the server on 3000):

```bash
bun run dev:server
```

The web UI needs its own build (`bun run build:web` → `dist-web/` with a
`.paperite-build.json` stamp); serve prefers `dist-web/`, refuses plain
`dist/` (Electron shell stuck on "Connecting..."), else runs API-only
with a log line.

Login is required even in serve mode. Google Drive bind additionally needs
the serve origin allowlisted in the Clerk dashboard.

## Development

```bash
bun install
bun start
```

## Build

```bash
bun run build
```

Produces `AppImage`, `deb`, and `tar.gz` in `dist/`.

## Authentication

Clerk login is mandatory (no guest mode).

Set your Clerk publishable key in `.env`:

```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

Get a key at [clerk.com](https://clerk.com).

BYO server operators may use their own Clerk app or swap to better-auth
(see `plans/018-paperite-server.md`). The official Avalid deployment uses
the Avalid Clerk issuer.
