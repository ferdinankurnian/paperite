# Plan 018: paperite-server as flexible open-source backend

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.

## Status

- **Priority**: P0
- **Effort**: L (raised 2026-10-15 — dual-backend scope)
- **Risk**: HIGH (raised 2026-10-15 — deliberate)
- **Depends on**: 016 (Paperite+ model, LOCKED + revised 2026-10-15)
- **Category**: architecture
- **Planned at**: 2026-09-30, revised 2026-10-15
- **Status**: TODO

## Why this matters (revised)

`convex/` currently lives inside the desktop repo (`paperite/convex/`).
That makes the backend look like it belongs to the desktop app, which
breaks the new positioning:

1. **Paperite is not "local-first only"** — it's powerful + flexible. Users choose GDrive, Paperite+ cloud, or BYO server.
2. **Paperite+ as hosted convenience** — default points to an Avalid Studio deployment so paying users never touch infra; BYO is an option, not a requirement.
3. **Enterprises / sovereignty** — some users can't put notes on Convex cloud in a region they don't control. They need BYO on their own Convex deployment (own region, e.g. us-east-1) OR on their own machine (VPS / old PC).
4. **Auth flexibility** — BYO operators choose: bring their own Clerk issuer, or swap to better-auth. Official Avalid deployment stays on Clerk (mandatory login, see plan 016).
5. **Mobile-only users** — must sync via cloud/server without any desktop on LAN.

The fix: extract the backend into its own repo, `paperite-server`, with a **sync provider interface** that supports **Convex cloud OR local Yjs server**. Base is always local (files + SQLite); the server is a Yjs sync + storage hub that clients (desktop / mobile / `paperite serve` web) talk to. Paperite takes the risk of maintaining both backends behind one contract.

Old stance ("Convex cloud only, VPS is a category error") is **rescinded**. The new contract is: Convex is one backend, local-machine Yjs is a first-class backend.

## Current state

- Backend code: `convex/schema.ts` (5 tables: `sharedSpaces`,
  `sharedSpaceMembers`, `sharedNotes`, `sharedNoteUpdates`,
  `sharedNoteSnapshots`), `convex/sharedSpaces.ts` (Clerk-guarded
  queries/mutations, 2-space free limit), `convex/auth.config.ts` (locked
  to `CLERK_JWT_ISSUER_DOMAIN`), `convex.json` (`"functions": "convex/"`).
- Desktop client: `src/lib/convex.ts` — `ConvexReactClient` + one
  `createSharedSpace` wrapper. Runtime-swappable URL already implemented
  (2026-09-30): `localStorage paperite.convex-url` > `VITE_CONVEX_URL`.
  Settings → Sync tab is live.
- Local server: `server/index.js` is Express for solo/`paperite serve` mode.
  Currently REST for files, no Yjs websocket collab yet. This is the seed
  for the local-machine backend.
- Mobile: `../paperite-mobile/` (Expo ~56, `@clerk/expo`, `expo-sqlite`).
  Has NO `convex/` folder. Plan 011 still points it at Express REST — stale,
  must point at the provider interface.
- Auth: Clerk mandatory on official deployment. No guest mode (see 016 revision).

## What we're building

Three repos, one provider contract, two backend kinds:

```
paperite (desktop) ──┐
                     ├──► sync provider interface ──┬──► Avalid hosted (Paperite+)
paperite-mobile ─────┘                              ├──► BYO Convex deployment
paperite serve (web) ──┘                            └──► BYO local machine (VPS / old PC, Yjs ws)
                                                         ▲
                                                         │ fork + deploy
                                                         │ (BYO, user-owned)
```

- **`paperite-server`** (new, public): Convex functions (`schema.ts`,
  `sharedSpaces.ts` + invite/presence/publish) AND local-machine server
  (Node + Yjs websocket + file/snapshot storage). Shared provider contract
  (`@paperite/server-api` types + `SyncProvider` interface: auth, spaces,
  members, notes, updates, snapshots, presence). Auth adapters: Clerk
  (default) or better-auth (BYO option). README covers all deploy paths.
- **`paperite`**: base stays local (files + SQLite + `server/` Express,
  extended with Yjs ws for local-backend mode). Cloud path = provider
  client with runtime-swappable URL + backend-kind flag (convex vs local).
- **`paperite-mobile`**: same provider client (`EXPO_PUBLIC_*` default,
  AsyncStorage override). Prod sync via provider, never LAN-only REST.

Default URL in both apps = Avalid deployment (the Paperite+ product).
Custom URL + backend kind in Settings = BYO. Mobile-only users log in
with Clerk and hit the default deployment — no desktop needed, ever.

## Scope

**In scope:**

- New `paperite-server` repo with dual backends:
  - `convex/` (cloud backend, as today + invite/presence/publish next)
  - `local/` (Node Yjs server: websocket sync, snapshot store, auth middleware, file layout compatible with desktop `~/Documents/Paperite`)
  - `packages/server-api/` (`SyncProvider` interface + generated Convex types, published as `@paperite/server-api`)
  - `auth/` adapters (Clerk verifier + better-auth option, selected by env)
- Provider contract decision (record in this file): `SyncProvider` TS interface all clients code against; Convex impl + local-ws impl.
- Desktop: generalize `src/lib/convex.ts` into `src/lib/sync-provider.ts` (convex client OR y-websocket client, runtime setting first). Settings → Sync shows backend kind (Avalid / Convex BYO / Local server) + URL + auth kind.
- Mobile: install `convex` + `yjs`/`y-websocket`, `ConvexProvider` or Yjs provider behind the same switch, same Settings screen.
- `paperite serve` gains `--sync` / local-backend mode so an old PC / VPS can be a real sync hub, not just a single-user web view.
- Docs: official deploy (Avalid), BYO Convex fork flow (own region supported), BYO local-machine flow (systemd/docker example), `CLERK_JWT_ISSUER_DOMAIN` vs better-auth env, mobile-only onboarding proof.
- Plan 011 correction note (mobile → provider interface for prod, Express REST stays LAN/dev only).

**Out of scope:**

- Invite flow UI, presence UI, publish pipeline (separate plans under 016).
- CF Workers public-pages layer (separate plan).
- Pricing/checkout for Paperite+.
- Plugin system (plan 021) — but provider must carry opaque block JSON so plugins don't need a sync rewrite later.

## Steps

### Step 1: Define the `SyncProvider` contract

In `../paperite-server/packages/server-api/`:

```ts
// spaces, members, notes, updates, snapshots, presence, auth verify
interface SyncProvider { kind: "convex" | "local"; /* ... */ }
```

Record the exact method list in this plan before coding clients. No client imports `convex/_generated` directly after cutover — only via `@paperite/server-api`.

**Verify**: contract doc committed; `bunx tsc -b` clean in server repo.

### Step 2: Extract `paperite-server` (Convex side, as-is)

Create sibling repo `../paperite-server/` with:

```
convex/schema.ts            # moved as-is
convex/sharedSpaces.ts      # moved as-is
convex/auth.config.ts       # moved as-is
convex.json                 # { "functions": "convex/" }
packages/server-api/        # new contract (Step 1)
package.json
.env.example                # CONVEX_DEPLOYMENT, CLERK_JWT_ISSUER_DOMAIN, AUTH_KIND=clerk|better-auth, SERVER_KIND=convex|local
README.md                   # deploy + BYO + Clerk/better-auth setup (see Step 7)
```

Copy, don't move yet — keep desktop's `convex/` working until Step 6
flips the import source. Verify codegen exits 0.

**Verify**: `ls ../paperite-server/convex/schema.ts` exists; codegen exits 0.

### Step 3: Build the local-machine backend (new, the big risk)

In `../paperite-server/local/`:

- Node server (extend `paperite/server/index.js` design): Express REST (files/snapshots) + Yjs websocket (`y-websocket` style) for realtime collab.
- Auth middleware: Clerk token verify (default, same issuer env) OR better-auth session (when `AUTH_KIND=better-auth`).
- Storage layout mirrors desktop workspace so a VPS / old PC is a drop-in hub.
- `paperite serve --sync` flag runs this mode (vs plain single-user web view).

**Verify**: two laptops pointed at one old-PC server converge on the same note over LAN (Yjs updates merge, no last-write-wins); restart server → state reloads from disk.

### Step 4: Deploy the Avalid (official) deployment

From `../paperite-server/`: `npx convex deploy` under Avalid's Convex
account. Record the URL as `https://<avaid>.convex.cloud`. Set
`CLERK_JWT_ISSUER_DOMAIN` in the Convex dashboard to the production
Clerk issuer. Do NOT commit the real URL to the open repo README —
ship it as the default env value in the apps.

**Verify**: dashboard shows 5 tables; authed query with a Clerk token works.

### Step 5: Desktop + mobile provider switch

- Rewrite `src/lib/convex.ts` → `src/lib/sync-provider.ts`: priority runtime setting > env; per-URL cached client; backend-kind flag; Clerk session token via `convex` JWT template (convex kind) or Authorization header / better-auth session (local kind).
- Settings → Sync: effective URL + backend-kind pill (Avalid / Convex BYO / Local) + auth-kind note + Save/Reset. Renderer is source of truth.
- Mobile: same switch in `_layout.tsx` + Settings screen (AsyncStorage-backed) + one smoke query behind beta flag against each backend kind.

**Verify**: `bunx tsc -b` exits 0; `bun run lint` exits 0; manual: default build shows Avalid, paste custom Convex URL works, paste local `ws://old-pc:3000` works, both persist across restart.

### Step 6: Docs in `paperite-server/README.md`

Must contain: 1-command official deploy, 1-command BYO Convex fork deploy (note: pick your Convex region, e.g. us-east-1, at deploy time), 1-command local-machine deploy (VPS / old PC, systemd + docker examples), Clerk vs better-auth setup, where to paste URL + kind in each app, mobile-only onboarding flow, and the one-liner: "clients talk to the provider contract; backends are Convex cloud or your own machine."

**Verify**: fresh checkout follows README to a working BYO deployment (either kind) without asking questions.

### Step 7: Cut over and delete the old `convex/`

Only after Steps 2–5 verified: delete `paperite/convex/` + `convex.json`, point all imports at `@paperite/server-api`, append correction note to plan 011.

**Verify**: `git grep -l "from.*convex/_generated" -- src` returns only the new contract path; `bunx tsc -b` + `bun run lint` clean.

## Test plan

- **Unit**: codegen + `tsc` clean in all three repos.
- **BYO Convex drill**: fresh Convex account (own region) → fork → deploy → paste URL in desktop + mobile → create space on desktop → appears on mobile.
- **BYO local drill**: old PC runs `paperite-server local` (or `paperite serve --sync`) → desktop + mobile point at `http(s)://old-pc` → create/edit note → converges; kill server, restart → no loss.
- **Mobile-only drill**: ignore desktop; on mobile: Clerk login → inbox syncs, create note → visible after reinstall.
- **Offline**: airplane mode → local edits work; reconnect → Yjs updates converge (single note, two devices, each backend kind).
- **Auth swap**: `AUTH_KIND=better-auth` local server → login + sync works without Clerk.

## Done criteria

ALL must hold:

- [ ] `../paperite-server/` exists, open-source, deploys both kinds with documented commands
- [ ] `SyncProvider` contract published (`@paperite/server-api`), both clients use it, no direct `convex/_generated` imports
- [ ] Desktop + mobile default to Avalid with zero setup; custom URL + kind persist
- [ ] Local-machine backend converges over LAN + survives restart
- [ ] Clerk mandatory on official path; better-auth works on BYO local path
- [ ] No `convex/` remains in `paperite/`; single shared-types source
- [ ] Plan 011 has correction note pointing prod mobile at provider
- [ ] `bunx tsc -b` exits 0, `bun run lint` exits 0 (desktop)

## STOP conditions

- Yjs local backend can't converge with the same semantics as Convex (lost updates / split brain that the contract can't hide) — stop, fix the protocol before adding features.
- Auth swap requires forking identity semantics (membership / invites mean different things per auth) — stop; auth model needs its own plan first.
- Anyone proposes Workers/Vercel as the sync authority (instead of edge publish only) — stop; that's a category error.
- Scope tries to include plugin runtime or database engine in this plan — stop; that's plan 021, this plan only carries opaque blocks.

## Maintenance notes

- `server/` (Express) stays in `paperite/` — extended with Yjs ws, it's both the `paperite serve` web path and the reference local backend.
- Future 016 work (invite links, presence, publish) lands in `paperite-server/` first (both backends), then thin client calls.
- Pin `convex`, `yjs`, `y-websocket` majors across all three repos; bump together.

## Client-side progress (paperite repo, 2026-09-30)

Step for runtime URL is implemented (convex kind only); generalization to provider switch + local kind is TODO under Steps 1/5 above.

- **Shared-types decision: Option A.** `paperite-server` publishes `@paperite/server-api`; desktop + mobile `bun add` it. `src/lib/convex.ts` is the single choke point for `convex/_generated` imports — cutover swaps one import (now: generalize to `sync-provider.ts`).
- **`src/lib/convex.ts` (current)**: runtime setting (`localStorage paperite.convex-url`) > `VITE_CONVEX_URL`; per-URL cached client; Clerk JWT template; `normalizeConvexUrl`; `useConvexUrl` hooks.
- **Settings → Sync tab is live** (convex section). Must gain backend-kind + auth-kind rows (Step 5).
- `main.js` `sync:get-status` untouched (env-based); renderer is source of truth.
- Verify state: `bunx tsc -b` exits 0; `biome check` clean on touched files. Manual multi-backend checks owed (need real deployments, blocked on Steps 2–4).
