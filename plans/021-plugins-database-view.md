# Plan 021: Plugins + database views (compete with Notion)

Status: LOCKED (core vision, product decisions locked 2026-10-15)
Priority: P0
Depends on: 016 (revised), 018 (SyncProvider), 013 (perf budget)
Category: editor + platform

## Why

Paperite started as a note-taking app. The new direction is bigger:
turn notes into structured work — Notion-style databases, kanban, tldraw /
canvas, custom blocks — without losing Discord-feel speed or local-first base.

Decision 2026-10-15: plugins + database views are core, not phase-2.
Paperite will compete with Notion here. Deliberately high risk.

## What

1. **Block model upgrade** — notes carry TipTap JSON today. Extend to
   typed blocks: `prose`, `database`, `kanban`, `canvas`, `embed`,
   `plugin:<id>`. Unknown plugin blocks render as a safe fallback card
   (never crash the editor). Sync carries blocks as opaque JSON (see 018)
   — no sync rewrite per plugin.

2. **Database view** — "turn notes into notion style":
   - a note (or folder) can flip to table / board / gallery / calendar view
   - rows = linked notes or inline rows, columns = typed properties
     (text, select, date, checkbox, relation)
   - filters + sorts stored in the note JSON, shared via the same Yjs path
   - v1: table + board only. gallery / calendar later.

3. **Plugin system**
   - manifest: `id`, `version`, `permissions` (storage, network, ui slots),
     entry point. Install per-space (owner controls), sandboxed iframe /
     worker — no direct filesystem or sync internals access.
   - slots: block renderer, sidebar panel, command palette action,
     publish transform (how a block exports to public webpage).
   - bundled first-party plugins prove the API: kanban, tldraw canvas.
   - third-party docs live in `docs/plugins.md` (manifest spec, block
     schema, slot API, review + signing rules).

4. **Perf gate** — this only ships if it stays fast on the low-spec
   reference laptop (see plan 013). Budgets: cold open, note switch,
   board with 1k rows virtualized. If plugins regress typing, they stay
   behind a beta flag.

## Scope

In scope:
- block schema + fallback rendering + migration of existing notes
- table + board views (filter/sort), virtualized
- plugin manifest + sandbox + 3 slots (block, command, publish)
- bundled kanban + tldraw plugins as reference
- `docs/plugins.md` for third-party devs
- sync-compat proof: plugin blocks converge over both backends (convex + local Yjs)

Out of scope:
- marketplace / payments for plugins (later, after Paperite+ checkout)
- gallery / calendar views (follow-up plan)
- realtime multiplayer cursors inside plugin canvases (best-effort only in v1)

## Steps

1. Block schema RFC — typed blocks, fallback contract, migration path. Record in this file before coding.
2. Database core — properties, filter/sort model, table + board UI virtualized, stored in note JSON.
3. Plugin host — manifest loader, sandbox, permissions gate, per-space install.
4. Slots — block renderer, command palette, publish transform.
5. Reference plugins — kanban + tldraw built only on the public API (no privates). If they need a private, fix the API.
6. Docs — `docs/plugins.md` + example plugin repo.
7. Sync proof — same space with plugin blocks open on desktop + mobile + serve, both backends converge.

## Done criteria

- [ ] Existing notes migrate without loss; unknown blocks show fallback, never blank/crash
- [ ] Table + board handle 1k rows on reference laptop within perf budget
- [ ] Kanban + tldraw work with only public API, on desktop + mobile + serve
- [ ] Plugin blocks sync + converge on convex AND local Yjs backends
- [ ] `docs/plugins.md` lets a fresh dev build a hello-block without asking questions
- [ ] `bunx tsc -b` + `bun run lint` clean

## STOP conditions

- Plugin API needs sync-protocol changes per plugin — stop; blocks must stay opaque.
- Sandbox escape or unsandboxed filesystem/network access required — stop; security model needs its own plan.
- Perf budget blown on reference laptop with plugins enabled — stop; optimize before adding more views.
