# Plan 025: Purge Google Drive sync from Paperite

> **Status**: DONE. Updates Plan 023 (remove `gdrive` from
> `SyncTargetKind`). Multi-account GDrive plan cancelled.
>
> **Executor instructions**: Follow step by step. Run every verification command.
> If anything in "STOP conditions" occurs, stop and report.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MEDIUM (touches Electron main process, preload, types, UI)
- **Depends on**: Plan 023's connection registry must be stable enough that
  removing one target kind doesn't break the others. If 023 is still in flux,
  do Step 0 (docs/plan cleanup) first and defer code purge.
- **Category**: sync / product
- **Planned at**: 2026-10-20
- **Why**: GDrive sync uses a single shared GCP project quota. One heavy user
  or bug can rate-limit every Paperite user, and overage is billed to Paperite.
  It also can't collaborate. Paperite+ (Convex) and personal servers already
  cover sync; GDrive is redundant + liability.

## Goal

Remove all Google Drive sync code and surface area. After this plan, Paperite
syncs via Paperite+ (Convex), personal servers, or local-only. No GDrive
option anywhere in UI, types, IPC, or main process.

## Current state (touchpoints)

- `main.js`: token storage (`read/write/deleteGoogleDriveToken`), OAuth flow
  (`start/completeGoogleDriveConnection`), access token, file CRUD, `syncGoogleDrive`,
  `runGoogleDriveSync`, auto-sync scheduler, IPC handlers
  (`sync:set-google-drive-enabled`, `sync:connect-google-drive`,
  `sync:run-google-drive`, `sync:disconnect-google-drive`), `googleDrive` in status.
- `preload.js`: `setGoogleDriveEnabled`, `connectGoogleDrive`, `runGoogleDrive`,
  `disconnectGoogleDrive`.
- `src/vite-env.d.ts`: sync type defs.
- `src/lib/storage/types.ts`: `SyncEngine` GDrive methods, `SyncStatus.googleDrive`.
- `src/lib/storage/electron-storage.ts`: `ElectronSyncEngine` GDrive methods.
- `src/lib/space-sync-targets.ts`: `"gdrive"` in `SyncTargetKind` + `isSyncTargetKind`.
- `src/lib/onboarding.ts`: `"gdrive"` in `isTarget`.
- `src/components/settings/sync-settings.tsx`: GDrive card + handlers.
- `src/components/app-sidebar.tsx`: `kind === "gdrive"` branch + `<SelectItem value="gdrive">`.
- `src/components/login-view.tsx`: gdrive target handling.
- `src/hooks/use-note-autosave.ts`: `syncEngine.runGoogleDrive()`.
- `docs/sync.md`: GDrive IPC docs.
- `plans/023-...md`, `plans/024-...md`: GDrive references.

## Steps

### Step 0: Cancel Plan 024 + scrub Plan 023

- Mark `plans/024-multi-google-drive-accounts.md` as CANCELLED (add status line;
  do not delete — keep for history).
- In `plans/023-...md`, remove `gdrive` from `SyncTargetKind` list and any
  GDrive-specific onboarding steps. Adjust done-criteria ("Paperite+, GDrive,
  and multiple personal-server" → "Paperite+ and multiple personal-server").
- Update `plans/README.md` row for 024 to CANCELLED.

**Verify**: grep for "gdrive" in plans/ returns only 025 + cancelled 024.

### Step 1: Main process purge (`main.js`)

Remove all GDrive functions, state, IPC handlers, and `googleDrive` from
`getStatus()`. Remove `googleDriveClientId`/`googleDriveClientSecret` helpers
if unused. Remove `scheduleGoogleDriveAutoSync` calls. Keep `keytar` pattern
for personal servers (untouched).

Migration: on startup, if a legacy `"google-drive-token"` keychain entry
exists, delete it (best-effort, no error). If persisted app state contains
`spaceSyncTargets` with `kind: "gdrive"`, convert those entries to
`{ kind: "local" }` in `app-state-reconcile.ts`.

**Verify**: `node --check main.js` → exit 0; grep "googleDrive\|GoogleDrive\|gdrive" main.js → none.

### Step 2: Preload + types

- `preload.js`: remove the four GDrive methods.
- `src/vite-env.d.ts`: remove GDrive from sync type.
- `src/lib/storage/types.ts`: remove `SyncEngine` GDrive methods; remove
  `googleDrive` from `SyncStatus`.

**Verify**: `bunx tsc -b` → exit 0.

### Step 3: Electron storage adapter

- `src/lib/storage/electron-storage.ts`: remove `ElectronSyncEngine` GDrive
  methods.

**Verify**: `bunx tsc -b` → exit 0.

### Step 4: Space-sync-targets model

- `src/lib/space-sync-targets.ts`: remove `"gdrive"` from `SyncTargetKind` and
  `isSyncTargetKind`.
- `src/lib/onboarding.ts`: remove `"gdrive"` from `isTarget`.
- `src/lib/app-state-reconcile.ts`: on load, convert any `kind: "gdrive"`
  binding to `{ kind: "local" }` (migration). Remove gdrive from any switch.

**Verify**: `bun test` → exit 0; `bunx tsc -b` → exit 0.

### Step 5: UI purge

- `src/components/settings/sync-settings.tsx`: remove entire GDrive card,
  handlers (`handleConnectGoogleDrive`, etc.), `googleDrive*` state, status
  usage. Remove `driveSvg` import if unused.
- `src/components/app-sidebar.tsx`: remove `kind === "gdrive"` branch and the
  `<SelectItem value="gdrive">Google Drive</SelectItem>`.
- `src/components/login-view.tsx`: remove gdrive target handling.
- `src/hooks/use-note-autosave.ts`: remove `syncEngine.runGoogleDrive()` call.

**Verify**: `bun run lint` → exit 0; `bunx tsc -b` → exit 0.

### Step 6: Docs

- `docs/sync.md`: remove GDrive IPC entries and any GDrive section.

**Verify**: grep "gdrive\|Google Drive" docs/ → none (except maybe unrelated).

### Step 7: Final sweep

- grep whole repo (excluding node_modules, dist, plans archive) for
  `gdrive`, `googleDrive`, `GoogleDrive`, `google-drive`. Expected hits: none
  in src/, main.js, preload.js; plans only in 024 (cancelled) and 025.
- Remove any now-unused imports/assets (drive.svg if unused).

**Verify**: `bun test`, `bunx tsc -b`, `bun run lint` → all exit 0.

## Test plan

- `tests/space-sync-targets.test.ts`: ensure `isSyncTargetKind("gdrive")` is
  false (if tested) and migration converts gdrive → local.
- `tests/app-state-reconcile.test.ts` (if exists): legacy gdrive binding
  loads as local.
- No real Google account in tests.

## Done criteria

- [ ] No GDrive code in `main.js`, `preload.js`, `src/`.
- [ ] No GDrive option in settings UI or space target picker.
- [ ] Legacy gdrive bindings migrate to local without data loss.
- [ ] Legacy keychain token slot cleaned up best-effort.
- [ ] Plan 024 cancelled; Plan 023 no longer references gdrive.
- [ ] `bun test`, `bunx tsc -b`, `bun run lint` → exit 0.

## STOP conditions

- Plan 023 connection registry is unstable (purging a target kind mid-refactor
  could break personal-server binding). Defer code purge, do Step 0 only.
- Removing GDrive breaks an unrelated feature (e.g., auth callback routing).
  Stop and report the coupling.
- A user-facing migration would delete note data. Migration must only change
  binding metadata, never notes.

## Maintenance notes

- If a future contributor wants Google-based sync, prefer a fresh design with
  BYO credentials or a server-side proxy, not re-adding the shared-quota model.
- Keep `drive.svg` only if still used elsewhere; otherwise delete.
