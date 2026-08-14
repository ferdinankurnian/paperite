# Plan 016: Paperite+ Model

Status: **LOCKED** (product decisions)
Priority: P0

Philosophy: this is *my* note-taking app that works for me. Collab is a layer on top of solid local-first, not the other way around. Privacy first — accounts are not discoverable.

---

## What is Paperite+

Two core value props:

1. **Realtime multiplayer collab** for spaces (Google Docs / Figma style)
2. **Publish notes as public webpages** (blog / article style)

Powered by Clerk (auth) + Convex (sync / presence / data) + optional CF Workers (public pages).

Sharing spaces, inviting members, and publishing notes all require Paperite+.

---

## Free vs Paperite+

| Capability              | Free                         | Paperite+                          |
|-------------------------|------------------------------|------------------------------------|
| Local notes             | Yes                          | Yes                                |
| GDrive backup/sync      | Yes (user-managed)           | Optional                           |
| Realtime collab         | No                           | Yes                                |
| Share space / invite    | No                           | Yes                                |
| Clone space as template | Yes                          | Yes                                |
| Cloud inbox / spaces    | No (local / GDrive only)     | Yes (synced via Convex)            |
| Publish note as webpage | No                           | Yes                                |

**Rule of thumb**
- Free = solo + offline-first
- Paperite+ = multiplayer + cloud sync + public publish

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

- Free → local / GDrive only
- Paperite+ → also synced to Convex (multi-device realtime)

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
- Served via CF Workers / Pages (or similar) — no full Convex client needed on the reader side
- SEO-friendly, easy to share outside the app
- Owner controls publish / unpublish

This is separate from space collab: collab = multiplayer editing; publish = one-way public reading.

---

## Architecture note

- **Convex** = source of truth + API (authz, membership, notes, realtime)
- Clients (Electron + RN) are thin — they only hit endpoints / Convex client
- **CF Workers** = optional layer for public published pages (fast, cheap, edge)
- No business logic embedded in Electron or React Native

---

## Upgrade / migration

When user subscribes to Paperite+:

- Existing local spaces + notes (including inbox) sync up to Convex
- Local remains available; cloud becomes source of truth for shared & multi-device use
- Migration must be clean: no data loss, no silent duplicates

---

## Still open

- [ ] Pricing (monthly / yearly / lifetime) — rough target $6–8/mo or $60–70/yr
- [ ] Public page URL structure / custom domain later?

GDrive: no Paperite-imposed limits. Only Google's own quotas apply.

---

## Next implementation plans

1. Convex schema — spaces, membership, roles, visibility, invite links, publish state
2. Invite flow UI + email
3. Presence + realtime editing on top of existing Yjs notes
4. Clerk entitlement checks (has Paperite+?)
5. Upgrade migration job (local → Convex)
6. Publish pipeline (note → public webpage via Workers/Pages)
