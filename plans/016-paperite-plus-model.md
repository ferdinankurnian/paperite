# Plan 016: Paperite+ Model

Status: **LOCKED** (product decisions, revised 2026-10-15)
Priority: P0

Philosophy: Paperite is a powerful, flexible notes app — not just "local-first". Local is the base because servers aren't free. Sync is a choice: GDrive, Paperite+ cloud, or BYO paperite-server. Privacy first — accounts are not discoverable.

**Locked decisions (2026-10-15):**
- Clerk login (Avalid account) is **mandatory**. No guest mode. Identity binds GDrive + devices + entitlements.
- Onboarding asks first: **Simple (Paperite+)** vs **Advanced (GDrive / BYO server)**. Default path is Simple.
- Paperite takes the big risk: sync abstraction supports Convex OR local Yjs server, plugins + database views are core vision (compete with Notion), not phase-2 nice-to-haves.

---

## What is Paperite+

Three value props:

1. **Zero-config cloud** — login, sync everywhere, no infra thinking
2. **Realtime multiplayer collab** for spaces (Google Docs / Figma style)
3. **Publish notes as public webpages** (blog / article style)

Powered by Clerk (auth, mandatory) + sync layer (Convex cloud OR local Yjs server behind the same provider interface) + optional CF Workers (public pages).

Sharing spaces, inviting members, and publishing notes all require Paperite+.

---

## Auth requirement

- Every user logs in with Clerk (Avalid). No anonymous / guest mode.
- Clerk identity is the anchor for:
  - GDrive bind (OAuth token stored per Clerk user, see plan 019)
  - Device management (list / revoke devices per account)
  - Paperite+ entitlements (`has Paperite+?`)
  - Shared-space membership + invite acceptance
- Rationale: without identity, multi-device mapping, conflict attribution, and abuse prevention are blind. Forced login is a safety decision.

---

## Onboarding (Simple vs Advanced)

First-run wizard, before the workspace shows:

- **Simple (Recommended)** → Paperite+ cloud. Login → inbox syncs → done.
- **Advanced** → choose storage:
  - GDrive mode (bind your Google Drive to this Clerk account)
  - BYO paperite-server (paste Convex URL or local server URL, see plan 018)

Users can switch modes later in Settings → Sync. Never ask backend questions on the Simple path.

---

## Modes

| Mode | Storage / sync | Auth | Multi-device | Best for |
|------|---------------|------|--------------|----------|
| GDrive | User's Drive `appDataFolder`, dumb storage, Yjs merge local | Clerk (mandatory) + Google OAuth bind | Yes, via Clerk-bound Drive + device list | Solo, bring-your-own-storage |
| Paperite+ | Avalid hosted sync (Convex cloud or Avalid Yjs infra) | Clerk | Yes, realtime | Most users, collab, publish |
| BYO server | Own Convex deployment OR own machine (VPS / old PC) Yjs server | BYO Clerk issuer or better-auth | Yes, if server reachable | Nerds, enterprises, data-sovereignty |

---

## Free vs Paperite+

| Capability              | Free (GDrive / local)        | Paperite+                          |
|-------------------------|------------------------------|------------------------------------|
| Local notes             | Yes                          | Yes                                |
| GDrive sync (Clerk-bound) | Yes (user-managed)         | Optional                           |
| Device management       | Yes (per Clerk account)      | Yes                                |
| Realtime collab         | No                           | Yes                                |
| Share space / invite    | No                           | Yes                                |
| Clone space as template | Yes                          | Yes                                |
| Cloud inbox / spaces    | No (local / GDrive only)     | Yes (realtime sync)                |
| Publish note as webpage | No                           | Yes                                |

**Rule of thumb**
- Free = solo + Clerk identity + GDrive/local
- Paperite+ = multiplayer + hosted cloud sync + public publish

---

## Host vs Member

- **Host** (space owner) **must** have Paperite+ to create a shared space and invite people.
- **Members** can join and collab in realtime **without** needing Paperite+.
- Members only need Paperite+ if they want to host their own shared spaces or publish notes.

---

## Roles

| Role   | Permissions                                                    |
|--------|----------------------------------------------------------------|
| owner  | full control, invite/remove, change visibility, delete space, publish |
| editor | create / edit / delete notes inside the space                  |
| viewer | read-only                                                      |

Role can be changed by the owner at any time after join.

---

## Inbox

Inbox = default personal space.

- Free → local / GDrive (Clerk-bound) only
- Paperite+ → also synced to hosted cloud (multi-device realtime)

---

## Space visibility

- **Private** — only owner + invited members
- **Public** — view-only link. Anyone with the link can view.  
  Clone as template is allowed **only if the owner enables it**.

No open-join public spaces.

---

## Invite flow

Privacy-first. Accounts are **not discoverable**.

- Invite via **email** and/or **link**
- Link types (host chooses): permanent / expiring / one-time use
- Host sets the role at invite time (editor or viewer)
- Role can be changed later

---

## Publish note as webpage

Paperite+ only.

- Turn any note into a public, shareable webpage (blog/article style)
- Clean public URL, view-only for readers
- Served via CF Workers / Pages (or similar) — no full sync client needed on the reader side
- SEO-friendly, easy to share outside the app
- Owner controls publish / unpublish

This is separate from space collab: collab = multiplayer editing; publish = one-way public reading.

---

## Architecture note

- **Sync provider interface** = source of truth contract (authz, membership, notes, realtime). Backends: Convex cloud OR local Yjs server (VPS / old PC / `paperite serve`). Clients never hardcode one backend.
- Clients (Electron + RN + web via serve) are thin — they talk to the provider interface.
- **CF Workers** = optional layer for public published pages (fast, cheap, edge).
- **Plugins + database views** are core (see plan 021), not an afterthought — the sync layer must support structured blocks, not just prose.
- No business logic embedded in Electron or React Native beyond local cache.

---

## Upgrade / migration

When user subscribes to Paperite+:

- Existing local spaces + notes (including inbox, including GDrive-bound) sync up to hosted cloud
- Local remains available; cloud becomes source of truth for shared & multi-device use
- Migration must be clean: no data loss, no silent duplicates

---

## Still open

- [ ] Pricing (monthly / yearly / lifetime) — rough target $6–8/mo or $60–70/yr
- [ ] Public page URL structure / custom domain later?
- [ ] Device limit per account (free vs plus)?

GDrive: no Paperite-imposed limits. Only Google's own quotas apply.

---

## Next implementation plans

1. Forced Clerk login + remove guest mode (auth gate on boot + serve)
2. Onboarding wizard (Simple vs Advanced) + GDrive bind + device management UI
3. Sync provider abstraction (Convex OR local Yjs) — joint with plan 018
4. Convex schema — spaces, membership, roles, visibility, invite links, publish state
5. Invite flow UI + email
6. Presence + realtime editing on top of existing Yjs notes
7. Clerk entitlement checks (has Paperite+?)
8. Upgrade migration job (local/GDrive → hosted cloud)
9. Publish pipeline (note → public webpage via Workers/Pages)
10. Plugins + database views (plan 021) — sync must carry structured blocks
