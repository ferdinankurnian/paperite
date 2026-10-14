# Plan 020: Live sync for cloud-linked spaces

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: MED-HIGH (data-loss-adjacent: every step must prove local data is never destroyed)
- **Depends on**: 019 (share/pull/unshare flows, `cloudSpaceLinks` mapping, Convex wrappers)
- **Category**: feature
- **Planned at**: 2026-10-02
- **Status**: DONE (code + tsc + unit tests; device drills owed — see note)
- **Implemented at**: 2026-10-02

> Note (2026-10-02, implementation): all seven steps landed.
> - Step 0: `createSharedSpace` moved INSIDE the try in `shareSpaceToCloud`
>   (`src/lib/cloud-space-sync.ts`) so limit/auth errors flow through
>   `humanizeShareError`; linked-but-idle copy changed off "synced" →
>   `linked` (sidebar pill, titlebar `CloudSpaceIndicator`).
> - Step 1: landed in `paperite-server` FIRST then copied to desktop
>   `convex/` per 018 step 1: `deletedAt?: v.optional(v.number())` on
>   `sharedNotes`, `listNotes` filters tombstones, member-guarded `removeNote`
>   mutation (tombstone, keeps updates/snapshots for history), `upsertNote`
>   clears `deletedAt` on re-create (resurrect). `bunx convex codegen`
>   uploaded functions to the dev deployment; `tsc --noEmit` clean in both
>   repos. Dashboard `deletedAt` column check owed (headless).
> - Step 2: new `src/lib/cloud-live-sync.ts` — memory-only outbox
>   (`Map<space, Map<path, {noteId, updates}>>`), `updateId` assigned AT
>   ENQUEUE (`${deviceId}:${noteId}:${counter}`, counter in localStorage),
>   tap point in `loadYNote` (`y-note-store.ts`, skips `loadOrigin` +
>   `cloudRemoteOrigin`), single choke point `wrapNotesEngineWithLiveSync`
>   installed in `getNotesEngine` (create→upsert, rename/move→upsert+moved
>   paths, delete→tombstone, space rename carries `cloudSpaceLinks`,
>   space delete tombstones children then drops the link). Flush: ~2s
>   debounce (+blur/hide/Ctrl+S/beforeunload best-effort), 50-update cap,
>   exponential backoff to 60s, snapshot every 50 flushes / 5 min.
>   `device-id.ts` extracted to break the notes-engine cycle. Trash restore
>   resurrects via `notifyNoteUpsert` (`use-workspace-commands.ts`).
> - Step 3: new `src/lib/cloud-pull-sync.ts` — `watchSharedNotes` /
>   `watchSharedUpdates` wrappers in `convex.ts` over
>   `client.watchQuery(...).onUpdate` (verified in installed convex@1.41;
>   no polling fallback). Tombstones → local Trash (recoverable). Seen-set
>   persisted in app state (`cloudSeenUpdates`, capped 500/note, 500 notes).
>   Live docs applied with `cloudRemoteOrigin` via `y-note-store` registry;
>   closed notes via `engine.writeYUpdate`. Update subs capped at 200/space
>   (open-time pull covers the rest). Teardown on unshare + logout.
> - Step 4: queue-derived pill `local · linking · live · pending (n) ·
>   error` in the space dialog (clickable pending → explains the outbox) +
>   titlebar indicator reads the same source (`useLiveSyncPending`).
> - Step 5: `backfillLinkedSpace` (full-state update + snapshot per local
>   note, once per space via localStorage flag, one console.info line);
>   fresh shares mark migrated immediately.
> - Step 6: same-account "link to existing cloud space" picker in the space
>   dialog (`listSharedSpaces`); attach runs the open-time pull merge via
>   the existing space-open effect. Restart persistence: EXPLICIT v1 gap —
>   the outbox is memory-only, so edits queued <2s before a kill may miss
>   the cloud (local sqlite truth intact; next open backfills only if never
>   migrated). Mitigated by blur/hide/Ctrl+S/unload flushes.
> - Verified headless: `bunx tsc -b` exits 0 (both repos), `bun test` 13/13
>   pass (7 new: wire contract, origin filters, batch caps, unlinked
>   zero-traffic, failed-flush-keeps-queue + stable ids, collision rule,
>   seen-set caps), `biome check` clean on all new modules (sidebar +
>   commands files carry only their pre-existing baseline hits, verified
>   identical count on stashed baseline).
> - Owed manual drills (need signed-in clients, can't run headless):
>   two-client convergence + offline-reconnect + delete→Trash, 3rd-space
>   limit message, kill-mid-flush, restart with queued edits.

## Why this matters

Plan 019 built the on-ramp: toggle ON snapshots a space to Convex once,
opening a linked space pulls once. After that, the link goes silent — notes
created or edited post-share never reach the cloud, and the UI still says
"synced" (which currently means "linked", not "up to date"). A user who
connects a space reasonably expects **sync**, not a one-time upload. Until
this plan lands, the Convex connector is a share button wearing a sync
costume. This plan makes linked spaces actually converge: local edits push,
remote edits arrive, the pill tells the truth.

## Current state

- Server (`paperite-server` repo is source of truth for `convex/`; desktop
  `convex/` is the working copy — **all function/schema changes land in
  `paperite-server` first, then copy over**, per 018 step 1):
  `sharedSpaces.create/list`, `upsertNote`, `appendUpdate` (idempotent on
  `updateId`), `writeSnapshot` (doc + stateVector), `listNotes`,
  `listUpdates`. Auth via Clerk JWT template `convex`. **Missing: any
  delete/tombstone propagation** (`deleteItem` has no cloud counterpart).
- Desktop push: happens ONLY inside `shareSpaceToCloud`
  (`src/lib/cloud-space-sync.ts:60`) — create → upsert all notes → snapshot
  + one `initial-${noteId}` update per note. Nothing else in the codebase
  calls `upsertSharedNote` / `appendSharedUpdate` / `writeSharedSnapshot`.
- Desktop pull: one-shot `pullCloudSpace` on space open
  (`app-sidebar.tsx:1862`). Conflict rule v1: same path + different noteId
  → cloud copy kept as "<title> (cloud)"; local-only notes never deleted.
- Local tap point already exists: `loadYNote` (`src/lib/y-note-store.ts:35`)
  hooks `doc.on("update")` → `writeYUpdate` (sqlite), skipping `loadOrigin`.
  Push can ride the same listener with its own origin filter.
- Device identity exists: `getDeviceId()` in `cloud-space-sync.ts`
  (localStorage `paperite.device-id`).
- Status plumbing: durable link in `cloudSpaceLinks`
  (`src/lib/stores/app-store.ts`); memory-only transient phases in
  `src/lib/cloud-sync-status.ts` (dialog writes, titlebar reads);
  `CloudSpaceIndicator` in `app-titlebar.tsx:528` (hidden when no link and
  no transient); per-space pill in the space settings dialog.

## What we're building

For every space WITH a `cloudSpaceLinks` mapping, a live loop:

```
local Yjs edit ──debounced──▶ outbox ──flush──▶ appendUpdate (+ upsert on
metadata change, snapshot periodically)
                                                          │
remote change ──Convex subscription──▶ apply to local YDoc / sqlite
                                                          │
status pill: local · linking · live ✓ · pending (n) · error (human msg)
```

Local-only spaces (no mapping) take zero overhead and make zero Convex
calls — 019's opt-in guarantee stays absolute.

## Scope

**In scope:**

- Push: content edits (debounced batches), note create/rename/move metadata,
  note delete propagation (tombstones — needs one small server addition).
- Pull: live subscriptions for linked spaces (note list) and notes (updates),
  merged with the existing 019 open-time rules (never silently drop local).
- Honest status: pill + titlebar reflect real queue state, not just "linked".
- Retry/offline: outbox survives failure with backoff; pending count visible.
- Step 0 honesty bugfix: `createSharedSpace` thrown OUTSIDE try/catch in
  `shareSpaceToCloud` (`cloud-space-sync.ts:65`) bypasses
  `humanizeShareError` — wrap it so limit/auth errors show human messages.

**Out of scope:**

- Cloud-side delete ("remove from cloud" button) — separate, dangerous, own plan.
- Invite flow / member management / presence (016 territory).
- Asset/image binary sync (still local-only; own future plan).
- Mobile live sync (same server calls; mobile client adopts later, document the contract).
- Multi-space "sync everything" — STOP condition, see below.

## Steps

### Step 0: Honesty bugfix (do first, ship alone if needed)

1. Move `createSharedSpace(spaceTitle)` inside the try/catch in
   `shareSpaceToCloud`, or wrap it with `humanizeShareError` at the
   `handleCloudToggle` call site (`app-sidebar.tsx:1900`). Either way the
   raw `[CONV M(sharedSpaces:create)] … Server Error` must never reach the
   hovercard again — limit/auth failures already have human strings.
2. Change the linked-but-idle pill/titlebar copy off the word "synced"
   (it means "linked" today). Interim copy: `linked` / "Space linked to
   cloud". Full live states arrive in Step 4; this step just stops lying.

**Verify**: force a failure (3rd space → limit; bad URL → offline) and
confirm the hovercard shows the human message. `bunx tsc -b` exits 0.

### Step 1: Server additions (paperite-server FIRST, then copy)

1. Add `deletedAt?: v.optional(v.number())` to `sharedNotes`; `listNotes`
   excludes rows with `deletedAt` set (existing rows unaffected — field is
   optional, no migration).
2. Add member-guarded `removeNote({ spaceId, noteId })` mutation: sets
   `deletedAt` (tombstone — keeps row so offline devices converge instead of
   resurrecting), leaves updates/snapshots for history (document this).
3. Copy `convex/` → desktop working copy per 018 step 1; regenerate types;
   redeploy to the dev deployment and confirm dashboard shows the new field.

**Verify**: dashboard Data tab shows `deletedAt` column; calling
`removeNote` then `listNotes` hides the note; non-members get
`not_space_member`. `bunx tsc -b` exits 0 in both repos.

### Step 2: Push engine (local → cloud)

New module `src/lib/cloud-live-sync.ts` (manager, not UI):

1. **Outbox**: per linked space, `Map<notePath, { noteId, updates: { updateId, data }[] }`.
   `updateId` assigned AT ENQUEUE (`${deviceId}:${noteId}:${counter}`,
   counter persisted alongside app state so retries reuse the same id →
   server idempotency actually works).
2. **Tap point**: extend the `doc.on("update")` listener pattern from
   `y-note-store.ts` — same skip for `loadOrigin`, PLUS skip a new
   `remoteOrigin` (Step 3's applies must not echo back). Only enqueue when
   the note's space has a mapping; local-only notes cost one map lookup.
3. **Metadata hooks**: single choke point wrapping the engine for linked
   spaces — `createNote` → `upsertSharedNote`; `renameItem`/`moveItem` →
   `upsertSharedNote` with new path (rows are keyed by `noteId`, so path
   moves are free); `deleteItem` → `removeNote` (Step 1). Implement as a
   thin wrapper around `NotesEngine` (proxy or explicit pass-through —
   executor's call, document it); constraint: zero behavior change for
   unlinked spaces.
4. **Flush**: debounce ~2s after last edit (and on window blur / Ctrl+S /
   tab close for the open note); cap batch size (e.g. 50 updates/flush);
   failure keeps payloads queued with exponential backoff; success clears.
5. **Snapshots**: `writeSnapshot` every N flushes per note (e.g. 50) or T
   minutes (e.g. 5) so new devices bootstrap from stateVector instead of
   replaying unbounded history.

**Verify**: type a paragraph in a linked space → dashboard `sharedNoteUpdates`
grows within ~seconds; `bunx tsc -b` exits 0; unlinked space typed for a
minute → zero Convex traffic (prove via dashboard request log / local
request counter in devtools).

### Step 3: Pull subscriptions (cloud → local)

1. For each linked space, subscribe `api.sharedSpaces.listNotes` via
   `client.onUpdate` (verify the installed `convex` package exposes it; if
   not, STOP and report — fallback polling design needs approval, do not
   silently poll). New/changed rows merge with the 019 open-time rules
   (same path + different noteId → "(cloud)" copy; local never deleted).
   Tombstoned notes (present in previous snapshot, now absent from
   `listNotes`) move the local copy to Trash (NOT permanent delete —
   recoverable, consistent with the app's trash engine).
2. For open + recently-touched notes in linked spaces, subscribe
   `api.sharedSpaces.listUpdates`; apply unseen `updateId`s to the live
   `Y.Doc` with `remoteOrigin` (persists to sqlite via the existing
   `persistUpdate` path, skips the Step-2 push queue). Closed notes: apply
   via `engine.writeYUpdate` directly (same as 019 pull).
3. Seen-set: persist capped `seenUpdateIds` per note (e.g. last 500) in app
   state; Yjs merging is idempotent so a re-apply after restart is
   harmless, the set is purely a perf optimization. Tear down all
   subscriptions on unshare + logout.

**Verify**: two clients (desktop A + desktop B, or two windows/profiles)
on the same deployment + same account: type on A → appears on B within
seconds; delete on A → lands in B's Trash, never vanishes; offline B for
5 min → on reconnect converges without dupes or loss. `bunx tsc -b` exits 0.

### Step 4: Honest status UI

Replace the binary linked pill with queue-derived states, reusing the
existing `cloud-sync-status.ts` transient store + titlebar indicator:

- `local` (no mapping) · `linking` (share flow in flight) ·
  `live` (linked, outbox empty, subscriptions healthy) ·
  `pending (n)` (n queued updates unsent) · `error` (human message from
  `humanizeShareError`, extended with new cases: offline, tombstone
  conflicts).
- Space settings dialog pill + `CloudSpaceIndicator` both read the same
  source. `pending` shows the count; clicking it explains what's unsent
  ("3 edits waiting — will send when you're back online").

**Verify**: manual walkthrough — go offline mid-typing → pill goes
`pending (n)` → reconnect → drains to `live`. Kill the deployment URL →
`error` with human text, never raw `[CONV …]`.

### Step 5: Backfill + migration for existing links

Existing links (like the user's HOMESICK share) keep working: on first run
with live sync, enqueue a full-state update per local note (same bytes as
share, new `updateId`s — idempotent server-side, harmless dupes) so pre-sync
edits converge; write a fresh snapshot. Log a one-line info per migrated
space. No mapping format change, no user action needed.

**Verify**: share a space with the OLD build, edit locally, upgrade, open →
edits push, dashboard shows them, no duplicate note rows.

### Step 6: Drills + hardening

- **Two-client drill** (dev deployment): A shares → B attaches to the SAME
  `spaceId` via a "link to existing cloud space" picker (backed by the
  existing `sharedSpaces.list` query — same-account join, no invite UI).
  Toggle-ON-creates-fresh-share stays for NEW shares only; attaching to an
  existing id runs the open-time pull merge. True cross-user invite/join UI
  is 016 — if same-account attach needs anything beyond the `list` picker,
  STOP and split the slice.
- **Limit drill**: 3rd share still shows the human free-limit message
  (regression for Step 0).
- **Kill drill**: revoke network mid-flush → no partial mapping, no lost
  local edits, queue drains on reconnect.
- **Restart drill**: queued updates survive app restart (or documented as
  memory-only v1 with flush-on-unload best-effort — executor must pick and
  document; default to persisted if cheap, else explicit).

**Verify**: all drills pass against the dev deployment with dashboard row
checks; `bun test` green; `biome check` clean on touched files.

## Test plan

- **Unit** (`bun test`): updateId stability across retry (same payload →
  same id); outbox batching caps; origin filters (load/remote never
  enqueued); "(cloud)" copy rule on path collision; tombstone hides note
  but keeps row.
- **Integration**: two-client convergence + offline-reconnect + delete→trash
  against dev deployment (manual drills in Step 6 until harness exists).
- **Static**: `bunx tsc -b` exits 0, `biome check` clean on touched files
  (repo-wide lint debt is pre-existing — compare against stashed baseline,
  don't boil the ocean).

## Done criteria

ALL must hold:

- [ ] Typing in a linked space reaches Convex within seconds (dashboard-provable)
- [ ] Edits from a second client arrive live; deletes arrive as Trash, never silent loss
- [ ] New notes / renames / moves / deletes in linked spaces propagate
- [ ] Unlinked spaces make zero Convex calls (opt-in absolute, instrumented proof)
- [ ] Pill + titlebar show live/pending(n)/error truthfully; no raw `[CONV …]` ever surfaces
- [ ] Existing 019 links migrate silently on upgrade
- [ ] `bunx tsc -b` exits 0, `bun test` green, touched-file lint clean

## Rejected alternatives

**Adopting `@convex-dev/prosemirror-sync` (the Convex ProseMirror component)
instead of syncing Yjs bytes — REJECTED (2026-10-02).** Evaluated against
the actual repo + component README (`get-convex/prosemirror-sync`):

1. **Wrong data model.** The component syncs ProseMirror *steps* (OT-based);
   its own README says "syncing Yjs documents … would be done by a different
   Yjs-specific component". Paperite's editor is Yjs-backed
   (`@tiptap/extension-collaboration`, live `Y.Doc` in `note-editor.tsx` /
   `y-note-store.ts`, Yjs snapshots in sqlite). Adopting it means migrating
   every note's doc model, rewriting both storage engines
   (`electron-storage.ts`, `web-storage.ts`), and a data migration for
   existing users — to gain a model strictly less capable than what we have.
2. **Kills local-first/offline.** The component's offline support is listed
   under *future features* ("could be added later"); unmount-flush is
   best-effort and offline steps can be lost. Paperite works fully offline
   with optional login — non-negotiable. Local save stays the source of
   truth, full stop.
3. **Redundant.** Our 5-table backend (`sharedNoteUpdates` + snapshots +
   stateVector) is already the same shape as the component's steps +
   debounced snapshots, minus the migration. Plan 020 builds the missing
   client loop on top of it.

If Convex ever ships the Yjs-specific component, re-evaluate then — the
contract surface (`updateId` scheme, tombstones) is designed to be portable.

## STOP conditions

- Installed `convex` package lacks `onUpdate`/subscription support — stop;
  polling fallback needs explicit approval (battery/traffic implications).
- Anyone proposes auto-linking ALL spaces ("sync everything") — stop; per-space
  opt-in is the whole product point (see 019 STOP conditions).
- Anyone proposes running sync infra on Workers/VPS — stop; category
  error, Convex is the backend (see 018).
- Server changes proposed directly in desktop `convex/` — stop; land in
  `paperite-server` first, then copy (018 step 1).
- Joining a space from device B needs real UX beyond toggle-hack — stop and
  split the slice; do not smuggle 016 invite UI into this plan.
- Conflict semantics need anything beyond Yjs merge + 019 path-collision rule
  — stop, split the follow-up; do not build custom OT.

## Maintenance notes

- `updateId` format `${deviceId}:${noteId}:${counter}` is the wire contract —
  mobile implements the same scheme (`paperite-mobile/plans/001-mobile-
  live-cloud-sync.md`). One protocol, two implementations — change both
  together, flag drift in both READMEs.
- Images/asset binaries stay local-only (unchanged from 019).
- Snapshot cadence (Step 2.5) bounds pull cost; revisit numbers once real
  usage data exists (Convex dashboard → request volume).
- `removeNote` keeps updates/snapshots for history — a future "erase from
  cloud" feature must delete those rows explicitly; unshare still keeps the
  cloud copy (019 rule, unchanged).
