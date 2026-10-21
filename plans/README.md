# Plans

Live plans only. Finished work lives in [`archive/`](./archive/) — don't trust
old status notes there, spot-check against code if you need history.

## Status

| # | Plan | Status | Priority |
|---|------|--------|----------|
| 011 | [Paperite Mobile (TenTap + Expo)](./011-paperite-mobile-tentap.md) | DONE | P1 |
| 012 | [TenTap Advanced + Text Align (RN)](./012-tentap-advanced-text-align.md) | DONE (functional equivalent) | P1 |
| 013 | [Optimize it 100x — Obsidian-level speed](./013-optimize-100x.md) | DONE | P0 |
| 014 | [Notion-style drag handle](./014-notion-style-drag-handle.md) | DONE | P2 |
| 016 | [Paperite+ Model](./016-paperite-plus-model.md) | LOCKED (revised 2026-10-15: Clerk mandatory, Simple vs Advanced onboarding) | P0 |
| 017 | [Refactor Index state boundaries](./017-refactor-index-state-boundaries.md) | DONE | P0 |
| 018 | [paperite-server as flexible open-source backend](./018-paperite-server.md) | READY (Convex-first; explicit `setup`/`tui`; local Yjs deferred) | P0 |
| 021 | [Plugins + database views (compete with Notion)](./021-plugins-database-view.md) | LOCKED (core vision, product decisions locked 2026-10-15) | P0 |
| 022 | [paperite serve (headless, t3-style)](./022-paperite-serve-headless.md) | DONE | P1 |
| 023 | [Per-space sync targets + personal-server pairing](./023-space-sync-targets-and-device-pairing.md) | READY (auth-policy gate) | P0 |
| 025 | [Purge Google Drive sync from Paperite](./025-purge-google-drive-sync.md) | DONE | P1 |
| 026 | [Bind Paperite installation to one Clerk account](./026-device-bound-auth.md) | DONE (lint baseline follow-up) | P0 |
| 027 | [Allow desktop and `paperite serve` to share one workspace safely](./027-shared-workspace-concurrency.md) | IN PROGRESS (owner bridge + attached serve) | P0 |
| 028 | [One auth source — the browser mirrors the desktop](./028-one-auth-source.md) | DONE | P0 |

## Execution Order

- **017** (Index state boundaries) — DONE, P0. It unblocks render isolation for everything else.
- **013** (Optimize 100x) — DONE, P0 desktop. The owner-machine profiler worksheet remains in the archived completion log.
- **014** (Notion-style drag handle) — DONE, P2 desktop. Pure editor UX, independent.
- **011** (Mobile TenTap) + **012** (TenTap advanced) — DONE, P1, separate Expo project. Prod sync still goes through the plan 018 provider contract, not LAN REST.
- **016** (Paperite+ model) — LOCKED decisions. Implementation order inside: forced Clerk login → onboarding wizard → invite flow → entitlements → migration → publish.
- **018** (paperite-server) — READY, P0 architecture. Execute Convex-first: contract → Convex source → explicit CLI/TUI shell (`paperite-server setup` + `paperite-server tui`) → desktop → mobile → official deploy. Local Yjs and `serve --sync` follow after the first milestone.
- **021** (Plugins + database views) — LOCKED, P0 core vision. Needs 018's opaque-block sync + 013's perf budget. Steps: block schema → table + board → plugin host + slots → reference plugins → docs → sync proof.
- **022** (`paperite serve`) — DONE, P1. Headless web path is shipped; `--sync` hub mode and the full backend rewire remain follow-ups under 018/Phase 2b.
- **023** (sync targets + pairing) — READY, P0. One account may connect to Paperite+ and personal servers; each space has one active target. Depends on 018's server foundation and requires the local-only vs mandatory-Clerk policy to be resolved before onboarding implementation.
- **025** (purge Google Drive sync) — DONE, P1. GDrive sync code/UI/types/main-process handlers have been removed; legacy bindings migrate to local.
- **026** (device-bound auth) — DONE, P0. Core binding and account gate are implemented and verified; repo-wide Biome/config/generated-file diagnostics remain as separate lint-baseline cleanup.
- **027** (shared workspace concurrency) — IN PROGRESS, P0. Desktop-first and serve-first owner attachment is implemented; integration smoke across restarted Electron/AppImage/Flatpak surfaces and crash/retry semantics remain before marking it DONE.
- **028** (one auth source) — DONE, P0. The desktop app is the single Clerk authority; the browser mirrors its session over a secret-gated loopback bridge in both ownership orders and never signs in itself.
