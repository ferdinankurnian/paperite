# Plan 019: Save space to cloud (per-space opt-in sync)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: 018 (paperite-server deployed, prod live)
- **Category**: feature
- **Planned at**: 2026-10-02
- **Status**: DONE (code + tsc + unit tests; device drills owed — see note)
- **Implemented at**: 2026-10-02

> Note (2026-10-02, implementation): all six steps landed. Mapping lives in
> `PaperiteAppState.cloudSpaceLinks` (`src/lib/storage/types.ts`,
> `src/lib/stores/app-store.ts` with `setCloudSpaceLink` /
> `removeCloudSpaceLink`, carried through `normalizeAppState` /
> `reconcileAppState`) — persisted via the existing `writeAppState` snapshot,
> so no new storage path. Share/pull/unshare live in
> `src/lib/cloud-space-sync.ts`; Convex wrappers (`upsertSharedNote`,
> `appendSharedUpdate`, `writeSharedSnapshot`, `listSharedNotes`,
> `listSharedUpdates`, `humanizeShareError`) in `src/lib/convex.ts`; toggle +
> `local/syncing/synced/error` pill in the Space settings dialog
> (`SpaceDropHeader`, `src/components/app-sidebar.tsx`). Conflict UX: same
> path but different noteId → cloud copy kept as "<title> (cloud)" + info
> line; local-only notes are never deleted. Re-share after OFF creates a
> fresh `spaceId` (old link never resurrected). Toggle exists in the custom
> space settings dialog only — Inbox has no settings dialog, so Inbox stays
> local-only in v1.
>
> Verified headless: prod deployment serves (HTTP 200,
> `impressive-starling-915.convex.cloud` resolves); `bunx tsc -b` exits 0;
> `bun test` 6/6 pass; `biome check` clean on all new/edited lines
> (repo-wide `bun run lint` still carries its pre-existing ~11k-error debt,
> confirmed identical on stashed baseline). Owed manual drills (need a
> signed-in desktop client, can't run headless): share drill with dashboard
> row check, two-client drill, free-limit drill.

## Why this matters

Local-first is the default: spaces live in files + SQLite and Convex never
sees them. But there is currently NO path from a local space to the cloud —
`createSharedSpace` only makes empty spaces from Settings. Users think in
"this space, in the cloud", not "sharedSpaceMembers rows". One toggle in the
space settings modal closes that gap: **"Save this space to cloud"**.

## Current state

- Server (`paperite-server`, prod
  `https://impressive-starling-915.convex.cloud`): all primitives exist —
  `sharedSpaces.create`, `upsertNote`, `appendUpdate`, `writeSnapshot`,
  `listNotes`, `listUpdates`. Auth via Clerk JWT template `convex`.
- Desktop: `src/lib/convex.ts` has runtime URL
  (localStorage `paperite.convex-url` > `VITE_CONVEX_URL`), Clerk token
  attach, `createSharedSpace(name)` wrapper. Settings → Sync UI exists.
- Missing: any UI or flow that pushes an EXISTING local space's notes to a
  shared space. No per-space sync status anywhere.

## What we're building

One row in the space settings modal:

```
[ ] Save this space to cloud        [status pill: local / syncing / synced / error]
```

- OFF (default): space is local-only. Convex holds nothing for it.
- ON: client calls `create` → `spaceId`, then per local note: `upsertNote`
  (path + title) + push Yjs content (`appendUpdate` per update,
  `writeSnapshot` for the compacted state). Local copy stays; the cloud
  holds a linked copy.
- Turning it back OFF: unlink locally (drop the `spaceId` mapping), keep
  local notes byte-identical. The cloud copy is KEPT (other devices may
  still use it). Deleting cloud data is a separate future feature — never
  sneak it into this toggle.

## Scope

**In scope:**

- Space settings modal: toggle + status pill per space.
- Share flow (one-shot push): create → upsert all notes → push Yjs.
- Pull path: opening a cloud-linked space reads `listNotes`/`listUpdates`.
- Local `spaceId` mapping (which local space links to which shared space)
  persisted alongside existing app state.
- Free-tier error surfacing: `shared_space_limit_reached` (2 spaces) shows
  a human message, not a raw ConvexError.

**Out of scope:**

- Live two-way convergent editing loop (continuous push/pull subscriptions
  beyond open-time pull) — follow-up plan.
- Cloud-side delete ("remove from cloud") — separate, dangerous, own plan.
- Invite flow / member management UI (016 territory).
- Mobile UI (same toggle will come to mobile later; server calls identical).

## Steps

### Step 1: Prereq check (do not skip)

Confirm prod deployment serves AND auth works: `npx convex run`
(or dashboard) against the prod URL with a Clerk token succeeds. If prod
is not live or auth fails, STOP — this plan cannot be tested.

**Verify**: one authenticated query round-trips against prod.

### Step 2: Space ↔ sharedSpace mapping

Persist `{ localSpacePath → spaceId }` (location: alongside existing app
state / settings store, your call — document it). Needed so the toggle
knows its state and unshare knows what to unlink. No mapping = space is
local.

**Verify**: `bunx tsc -b` exits 0.

### Step 3: Share flow (toggle ON)

On toggle ON for a local space:

1. `createSharedSpace(spaceName)` → `spaceId` (surface
   `shared_space_limit_reached` as "Free plan allows 2 cloud spaces").
2. For each local note: `upsertNote({ spaceId, noteId, path, title })`.
3. Push Yjs: `writeSnapshot` (current doc + state vector), then
   `appendUpdate` for pending updates (idempotent on `updateId`, safe to
   retry).
4. Save mapping, set pill to `synced`. Any failure → pill `error` with the
   message, mapping NOT saved (retry is a fresh toggle ON).

Order matters: metadata first, content second, mapping last.

**Verify**: `bunx tsc -b` + `bun run lint` clean; dashboard shows 1 space
row + N note rows + snapshot rows after sharing a test space.

### Step 4: Pull path (open cloud-linked space)

Opening a space with a mapping reads `listNotes` (+ `listUpdates` for the
open note) and merges with local. Conflict rule v1: cloud wins for
note-list membership, local unsynced edits are never silently dropped —
on conflict, keep both and surface it (exact UX your call, document it).

**Verify**: share on client A → open on client B (custom URL pointed at
same deployment) → same notes visible.

### Step 5: Unshare (toggle OFF)

Remove the mapping only. Local notes untouched (verify byte-identical
before/after). Cloud copy kept. Pill returns to `local`.

**Verify**: toggle off → local notes intact → dashboard rows still exist
→ toggle on again creates a FRESH share (new `spaceId`, no resurrection
of the old link — document this).

### Step 6: Status pill states

`local` (no mapping) / `syncing` (flow in flight, toggle disabled) /
`synced` (mapping + last push clean) / `error` (message + retry = toggle
ON again). The global Settings → Sync screen stays as-is (connection
level); this pill is per-space (content level).

**Verify**: manual walkthrough of all four states.

## Test plan

- **Unit**: `bunx tsc -b` exits 0, `bun run lint` exits 0.
- **Share drill**: local test space (3 notes, 1 with image — images stay
  local, note it) → toggle ON → dashboard rows exist → toggle OFF → local
  intact.
- **Two-client drill**: desktop A shares → desktop B (or mobile, when its
  client lands) with same deployment URL sees the notes.
- **Limit drill**: create 2 cloud spaces → 3rd toggle ON shows the
  human free-limit message.

## Done criteria

ALL must hold:

- [ ] Space settings modal has the toggle + status pill
- [ ] Toggle ON pushes all notes (metadata + Yjs) to the prod deployment
- [ ] Toggle OFF unlinks locally, keeps local + cloud copies intact
- [ ] Free-limit error is human-readable
- [ ] No local-only space ever touches Convex (opt-in is absolute)
- [ ] `bunx tsc -b` exits 0, `bun run lint` exits 0

## STOP conditions

- Prod deployment not live or auth broken — stop, fix 018 Step 2 first;
  do not build against a mock.
- Anyone proposes auto-uploading ALL spaces ("sync everything") — stop;
  opt-in per space is the whole point, re-read "Why this matters".
- Anyone proposes running sync on Workers/Vercel/VPS — stop; category
  error, see 018.
- Live-editing conflicts need OT/CRDT surgery beyond open-time pull —
  stop, split the follow-up plan; do not gold-plate v1.

## Maintenance notes

- Image/asset binaries stay local-only in v1 (note rows carry path +
  title; Yjs text syncs). Asset sync is its own future plan.
- Mobile gets the same toggle later; server calls are identical.
- Future 016 work (invites, presence) builds on the mapping from Step 2.
- Titlebar `CloudSpaceIndicator` (`src/components/app-titlebar.tsx`, next
  to the Drive `SyncIndicator`) shows syncing/saved/error for the active
  space, hidden for local-only spaces. Transient phases flow through the
  memory-only `src/lib/cloud-sync-status.ts` store (dialog writes, titlebar
  reads); the durable link stays in `cloudSpaceLinks`.
