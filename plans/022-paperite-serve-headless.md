# 018 — `paperite serve` (headless mode, t3-style)

## Goal

`paperite` (no args) launches the Electron desktop app. `paperite serve`
starts the same backend as a headless HTTP server and serves the Paperite UI
in any browser (Zen, etc.) — no Electron, no `npx`. Pattern is stolen
deliberately from t3code (`t3` / `t3 serve`).

Verified baseline (2026-09-29): `node server/index.js` boots and
`/api/health`, `/api/workspace`, `/api/state` all respond. The server is
real; the gaps are protocol drift, auth, CLI, and distribution.

## Non-goals (explicit)

- LAN token auth / pairing URLs — tracked as follow-up, but `--host 0.0.0.0`
  ships with a loud warning until it lands.
- Google Drive sync, popout windows, asset endpoints over serve.
- Background service (`t3 service install` analog) — future.
- `npx paperite` — user explicitly doesn't want npx distribution.

## Phase 0 — serve mode actually works (baseline fixes)

Small, mechanical, do first. Serve mode is untestable until these land.

1. **Yjs read format mismatch.** `server/routes/notes.js` `GET /notes/:path/yjs`
   sends the raw snapshot, but `src/lib/storage/web-storage.ts` `readYNote`
   expects `noteId\0snapshot` framing. Pick one side and align (recommendation:
   server prefixes `noteId + 0x00 + snapshot`, client stays as-is — one-line
   server change, no client rebuild subtleties).
2. **Rename payload mismatch.** Client sends `{ path, nextName }`
   (`web-storage.ts`), server reads `{ path, name }`
   (`server/routes/workspace.js` `PATCH /rename`) → every web rename becomes
   "Untitled". Align on `nextName`.
3. **Dev proxy.** `dev:server` runs Vite on 5173 and Express on 3000, but
   `BASE_URL` is `""` so `/api/*` hits Vite and 404s. Add
   `server.proxy: { "/api": "http://localhost:3000" }` to `vite.config.ts`
   (dev only, no prod impact).
4. **Baked web build.** `dist/` must be built with `PAPERITE_WEB=1`, otherwise
   `getNotesEngine()` returns null and the UI sticks on "Connecting...".
   Add `"build:web": "PAPERITE_WEB=1 vite build"` (plus `tsc -b` to match the
   existing `build` script) and document that `node server/index.js` serves
   whatever `dist/` contains.

Done when: `bun run dev:server` → open note, edit, rename, reload — no
console errors; `bun run build:web && node server/index.js` → same over
`http://localhost:3000`.

## Phase 1 — Clerk login works in serve mode

Clerk-js is a pure browser SDK (zero Electron dependency), so this is config
+ two small bugs, not architecture.

1. **Callback URL must be per-mode.** `.env` bakes
   `VITE_CLERK_AUTH_CALLBACK_URL=paperite://auth/callback` and
   `resolveAuthCallbackUrl` (`src/lib/clerk-auth.ts`) lets env win over
   everything → Clerk API rejects with `invalid_url_scheme` in a browser.
   Rule: `paperite://` only when `window.electron` exists; in web mode use
   `window.location.origin + pathname` (already the fallback — just stop the
   env var from shadowing it).
2. **Auth-callback hook is unreachable on web.**
   `use-global-auth-callback.ts:35` early-returns when `window.electron` is
   entirely absent, so the pure-web `__clerk_` fallback (line 62) never runs
   and the OAuth round-trip never completes. Gate on `PAPERITE_WEB` instead
   of bailing.
3. **Docs:** the serve origin (`http://localhost:<port>`) must be allowlisted
   in the Clerk dashboard (allowed origins + redirect URLs). Note the
   friction: changing `--port` means updating the dashboard. Guest mode
   (no key / skip login) keeps working regardless.

Done when: fresh `serve` on a clean port → Continue with Google → lands back
signed in, sidebar shows the real profile, reload keeps the session.

## Phase 2 — one backend (the t3 lesson)

Current state: `main.js` IS the backend; `server/lib/*` is a ~500-line
duplicated port. It has already drifted (Phase 0 bugs are the proof). t3's
core trick: **one server, desktop spawns it** (`--mode desktop
--bootstrap-fd 3`), Electron is a thin window around the local URL.

1. Extract `main.js` core (workspace fs ops, SQLite index, Yjs persistence,
   trash, revisions, app state) into shared CJS modules that both `main.js`
   and `server/` require. `server/lib/workspace.js` + friends are the
   natural canonical home — `main.js` consumes them, not the reverse.
2. One behavior change at a time; each extraction must keep
   `bun start` (Electron) pixel-identical. No new features in this phase.
3. Keep `node:sqlite` + `~/Documents/Paperite` layout untouched — data dir
   is shared between modes by design (same machine, same notes).

Done when: `main.js` contains only window/IPC/OAuth-loopback code; all
note/workspace/index logic lives in exactly one place; `tsc -b` + `bun run
lint` clean; Electron manual smoke passes.

> Status 2026-09-29: server side hardened instead of full rewire —
> per-note Yjs write locks, `pinned` column parity, path-redirect map, all
> curl-verified. Full `main.js` rewire deferred (needs Electron smoke tests
> to do safely) — see Phase 2b below.

## Phase 2b (deferred) — full main.js rewire

`main.js` untouched. When Electron can be smoke-tested: delete main.js's
duplicate primitives (paths, content helpers, Yjs, index, revision/trash
helpers) and require `server/lib/*`; keep Drive sync, legacy migration
(adapted to `setPathRedirect`), windows/menus, watchers, asset GC, and IPC
handlers as composition. Smart `scanDirectory`/`listWorkspace` (indexed +
pinned + sorted) should move to a new cycle-free `server/lib/workspace-view.js`
(required by both shells) so serve listing gains pinned/sort too. Fixes a
latent Electron bug for free: main.js `moveIndexedPath` drops `pinned`.

## Phase 3 — the `paperite` CLI (no install.sh, AppImage-first)

No install script, no npm bin. The Electron binary itself IS the CLI —
`main.js` already reads `process.argv` (protocol callback) and owns a
single-instance lock, so `serve` becomes an argv dispatch:

- `paperite` (no args) → normal Electron boot, unchanged.
- `paperite serve [--port 3000] [--host 127.0.0.1] [--workspace <path>]
  [--open|--no-browser]` → skip `BrowserWindow` entirely, boot the Phase-2
  shared backend + static `dist/` server, print the URL and block.
  - Serve mode must skip `requestSingleInstanceLock` (or handle "already
    running" gracefully) — otherwise `serve` while the desktop app is open
    just forwards argv and exits. Also mind the `index.sqlite` race (see
    Risks): one-at-a-time, loud error if the db is locked.
  - Default presentation is t3-`serve`-style headless: print URL, don't open.
    `--open` launches `xdg-open` / `open` / `start` (best-effort, log the URL
    regardless).
  - `--port` default 3000 (existing server default, keep compat); on
    `EADDRINUSE` fail loudly, don't silently pick another port (predictable
    ports matter for the Clerk allowlist).
  - `--host` anything non-loopback prints a WARNING that serve has no auth
    yet (see Non-goals).
- Only one `paperite serve` at a time, any port: global lockfile in tmp
  (pid-checked, stale-safe, released on shutdown). A second boot refuses
  with the existing address + workspace instead of splitting identity/data
  across two servers. Desktop + serve coexistence stays one-at-a-time by
  convention (sqlite WAL tolerates light overlap; heavy concurrent writes
  may busy-error).
- `server/index.js` stays as the dev/standalone server (`bun run
  dev:server`, `node server/index.js`); the packaged CLI path goes through
  `main.js` so both modes share the Phase-2 backend with zero drift.

Done when: `./Paperite*.AppImage serve --port 3789` boots headless, prints
the URL, `curl /api/health` ok, full UI in Zen; `--help` documents
everything; `bun run lint` clean.

## Phase 4 — distribution via AppImage / tar.gz (no install.sh)

The binary arrives with the desktop app, not a registry or script:

1. **AppImage is already the CLI.** Args pass straight through, so
   `./Paperite-*.AppImage serve --port 3000` just works once Phase 3 lands —
   zero extra files. Bare `paperite` on PATH = user alias/symlink (one
   line, documented) or AUR (next point).
2. **tar.gz ships a `paperite` wrapper.** Tiny shell script at the archive
   top level that `exec`s the bundled Electron binary with `"$@"`, so
   `./paperite serve ...` works from the extracted dir.
3. **AUR PKGBUILD** installs the wrapper (or a symlink to the AppImage /
   extracted binary) as `/usr/bin/paperite`. `.desktop` `Exec=` stays
   Electron (no `serve` arg). Arch is the primary target.
4. electron-builder `files` must include `server/**/*` plus the web-built
   `dist-web/` (separate `PAPERITE_WEB=1` build — one `dist/` can't serve
   both shells). `build` now runs both Vite builds; server prefers
   `dist-web/`, ignores plain `dist/`, else API-only with a log line.
5. README + `.env.example` docs: `paperite` vs `paperite serve` vs guest
   vs Clerk dashboard allowlist.

Done when: clean Arch VM → install package → `paperite serve --open` works
with zero manual `PATH` surgery.

## Order & estimates

0 → 1 → server hardening → 3 → 4 done 2026-09-29 (single session).
Remaining: 2b (full rewire, needs Electron smoke), LAN auth, Drive/assets
over serve, background service.

## Session notes (2026-09-29)

- Express 5: `app.get("*")` throws PathError at registration — the old
  static-serving block was dead code whenever `dist/` existed. Fixed with
  `/{*any}`.
- Server boot needs ~4-5s before accepting connections (don't `sleep 2`).
- Backgrounded servers die between tool calls — boot+test+kill must happen
  in a single shell invocation.
- `pkill -f <pattern>` matches the invoking shell's own cmdline — kill by
  PID instead.
- Phase 0–1 curl-verified against the real workspace (test notes cleaned
  up); serve-via-main.js verified with a stub-electron harness against a
  scratch `--workspace` (real workspace untouched).

## Risks

| Risk | Mitigation |
|---|---|
| Backend extraction breaks Electron (only client, no suite) | Extract in tiny slices; manual smoke checklist per slice; `tsc -b` + `lint` gates |
| Clerk ports/allowlist friction | Document; keep default port stable; guest mode always works |
| `dist/` built without `PAPERITE_WEB=1` served silently broken | `build:web` script + server startup log line stating which mode `dist/` was built for (read a build stamp file) |
| Two servers (Electron + serve) racing on `index.sqlite` | Serve-vs-serve closed by global lockfile; desktop coexistence is one-at-a-time by convention (WAL tolerates light overlap); long-term: single-instance lock (future) |
