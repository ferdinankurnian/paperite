# Sync Architecture

Paperite uses separate sync paths for personal notes and shared spaces.

## Personal Space

Personal notes stay local-first. Google Drive should be treated as dumb storage for encrypted Yjs snapshots and append-only updates.

```txt
Paperite device
-> local filesystem
-> Google Drive app folder
```

Google Drive must never be the merge authority. Paperite applies Yjs updates locally and uploads/downloads update files.

## Collaborative Spaces

Shared spaces should use Convex with Clerk auth.

```txt
Paperite device
-> Convex realtime sync
-> shared space permissions
```

Free accounts can be limited to two collaborative spaces. Personal Google Drive sync should remain separate from this limit.

## Sync Rule

Never use last-write-wins for note content. Notes are synchronized through CRDT updates or preserved as explicit conflicts.
