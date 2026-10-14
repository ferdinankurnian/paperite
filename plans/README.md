# Plans

Live plans only. Finished work lives in [`archive/`](./archive/) — don't trust
old status notes there, spot-check against code if you need history.

## Status

| # | Plan | Status | Priority |
|---|------|--------|----------|
| 011 | [Paperite Mobile (TenTap + Expo)](./011-paperite-mobile-tentap.md) | TODO | P1 |
| 012 | [TenTap Advanced + Text Align (RN)](./012-tentap-advanced-text-align.md) | TODO | P1 |
| 013 | [Optimize it 100x — Obsidian-level speed](./013-optimize-100x.md) | TODO | P0 |
| 014 | [Notion-style drag handle](./014-notion-style-drag-handle.md) | TODO | P2 |
| 016 | [Paperite+ Model](./016-paperite-plus-model.md) | LOCKED (revised 2026-10-15: Clerk mandatory, Simple vs Advanced onboarding) | P0 |
| 017 | [Refactor Index state boundaries](./017-refactor-index-state-boundaries.md) | IN PROGRESS | P0 |
| 018 | [paperite-server as flexible open-source backend](./018-paperite-server.md) | TODO (revised 2026-10-15: Convex OR local Yjs, Clerk/better-auth) | P0 |
| 021 | [Plugins + database views (compete with Notion)](./021-plugins-database-view.md) | TODO (core vision, locked 2026-10-15) | P0 |
| 022 | [paperite serve (headless, t3-style)](./022-paperite-serve-headless.md) | TODO | P1 |

## Execution Order

- **017** (Index state boundaries) — IN PROGRESS, P0. Finish first, it unblocks render isolation for everything else.
- **013** (Optimize 100x) — P0 desktop. Depends on 017 landing. Then virtualize, budgets, deeper extracts.
- **014** (Notion-style drag handle) — P2 desktop. Pure editor UX, independent; land after 017 if both in flight.
- **011** (Mobile TenTap) + **012** (TenTap advanced) — P1, separate Expo project. Can run in parallel with desktop work. Prod sync goes through the plan 018 provider contract, not LAN REST.
- **016** (Paperite+ model) — LOCKED decisions. Implementation order inside: forced Clerk login → onboarding wizard → invite flow → entitlements → migration → publish.
- **018** (paperite-server) — P0 architecture. Defines the `SyncProvider` contract both clients code against. Steps: contract → extract repo → local Yjs backend → Avalid deploy → client switch → docs → cutover.
- **021** (Plugins + database views) — P0 core vision. Needs 018's opaque-block sync + 013's perf budget. Steps: block schema → table + board → plugin host + slots → reference plugins → docs → sync proof.
- **022** (`paperite serve`) — P1. Headless web path + `--sync` hub mode for old-PC/VPS (see 018 Step for server semantics).
