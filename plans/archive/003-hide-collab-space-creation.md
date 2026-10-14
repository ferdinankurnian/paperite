# Plan 003: Close the last Paperite+ leak in Sync settings

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 975b6a5..HEAD -- src/components/nav-user.tsx`
> If the file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `975b6a5`, 2026-07-28

## Why this matters

Paperite+ (Clerk auth + Convex collaborative spaces) is meant to stay hidden
until it ships as a real paid feature. Most of this is already correctly
gated: `vite.config.ts` defines `import.meta.env.BETA_PAPERITE` as
`process.env.BETA_PAPERITE === "1"`, which is `false` on a normal `bun start`
/ `bun run build`. Both route guards (`src/routes/_main/index.tsx` and
`src/routes/_auth/login.tsx`) already `return` early when the flag is off,
so there is no forced login today. The "Account" settings tab in
`nav-user.tsx` is also already conditionally rendered on `betaEnabled`.

The one place this isn't consistent: `SyncSettings` (inside `nav-user.tsx`)
renders under the always-visible "Sync" tab, and it contains a "create
shared space" flow (name input, `create-shared-space` action, calls
`createSharedSpace` from `@/lib/convex`) with no `betaEnabled` check. So
today, even in a default build, a user can open Settings → Sync and see an
option to create a collaborative space — a Paperite+ feature leaking into
the free product.

## Current state

- File: `src/components/nav-user.tsx`
- `const betaEnabled = import.meta.env.BETA_PAPERITE;` (line 104) — already
  used elsewhere in this same file (lines 191, 243, 332) to gate the
  Log out menu item and the Account tab.
- `SyncSettings` (defined ~line 650) renders unconditionally under
  `{activeTab === "sync" && <SyncSettings />}` (line 406).
- Inside `SyncSettings`, the shared-space creation UI uses
  `sharedSpaceName` state, a `"create-shared-space"` action in `runAction`,
  and calls `createSharedSpace(sharedSpaceName.trim())` around line 887.
- Google Drive connect/sync UI lives in the same component and must stay
  visible — it is the personal, local-first sync path and is not part of
  Paperite+.

## Scope

**In scope:**
- `src/components/nav-user.tsx`

**Out of scope:**
- `convex/`, `src/lib/convex.ts` — leave the backend and client code as-is,
  dormant. Do not delete it; it will be reused when Paperite+ ships.
- Google Drive sync UI/logic in the same file — must remain fully visible
  and functional regardless of `betaEnabled`.

## Steps

### Step 1: Locate the shared-space section boundaries

Inside `SyncSettings`, find the JSX block that renders the "create shared
space" UI (name input, create button, any list of existing shared spaces if
present). Confirm it's visually/structurally separable from the Google
Drive connect/sync/disconnect UI in the same tab.

### Step 2: Gate it behind `betaEnabled`

`SyncSettings` doesn't currently receive `betaEnabled` — either pass it in
as a prop from the parent (`<SyncSettings betaEnabled={betaEnabled} />`) or
read `import.meta.env.BETA_PAPERITE` directly inside `SyncSettings`, matching
whichever pattern is more consistent with the rest of the file. Wrap the
shared-space section:

```tsx
{betaEnabled && (
    <section>
        {/* existing shared-space creation UI */}
    </section>
)}
```

Do not touch the `runAction`/`busyAction` state machine — it's shared with
Google Drive actions and should stay as-is; only the JSX visibility changes.

### Step 3: Verify

**Verify**: `bun run lint` → exit 0, `bunx tsc -b` → exit 0

## Test plan

No test suite covers this UI. Manual verification:

1. Run the app normally (`bun start`, no `BETA_PAPERITE` env var set).
2. Open Settings → Sync. Google Drive connect/sync UI should be visible.
   Shared-space creation UI should NOT be visible.
3. Run with `BETA_PAPERITE=1 bun start`. Settings → Sync should show the
   shared-space creation UI again, and Settings should also show the
   Account tab (existing behavior, unchanged).

## Done criteria

ALL must hold:

- [ ] `bun run lint` exits 0
- [ ] `bunx tsc -b` exits 0
- [ ] Default build (`BETA_PAPERITE` unset): no shared-space UI anywhere in
      Settings, Google Drive sync UI unaffected
- [ ] `BETA_PAPERITE=1` build: shared-space UI reappears exactly as before

## STOP conditions

- The code at the locations in "Current state" doesn't match (drift).
- The shared-space JSX is interleaved with Google Drive JSX in a way that
  can't be cleanly wrapped without restructuring `SyncSettings` — stop and
  report rather than doing a large refactor.
