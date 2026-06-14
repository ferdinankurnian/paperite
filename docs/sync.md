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

### Google Drive Setup

Paperite uses OAuth PKCE with the Drive `appDataFolder` scope and a loopback localhost callback.

Required environment variable for desktop sync:

```txt
PAPERITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id
PAPERITE_GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
```

Use a Google OAuth **Desktop app** client. Google still exposes a client secret for desktop clients; it is not private in an installed app, but Google's token endpoint can require it.

The OAuth callback uses a random localhost port:

```txt
http://127.0.0.1:{randomPort}/callback
```

The app exposes these Electron sync actions:

```txt
sync:get-status
sync:connect-google-drive
sync:run-google-drive
sync:disconnect-google-drive
```

Google Drive files are stored in the user's hidden app data folder, not their visible My Drive.

## Collaborative Spaces

Shared spaces should use Convex with Clerk auth.

```txt
Paperite device
-> Convex realtime sync
-> shared space permissions
```

Free accounts can be limited to two collaborative spaces. Personal Google Drive sync should remain separate from this limit.

### Convex Setup

Required environment variables:

```txt
VITE_CONVEX_URL=your-convex-deployment-url
CLERK_JWT_ISSUER_DOMAIN=https://your-clerk-issuer
```

Run Convex locally/development from another terminal when needed:

```txt
bun run convex:dev
```

The backend schema currently includes shared spaces, members, notes, Yjs updates, and snapshots. Free users are limited to two owned shared spaces in the `sharedSpaces.create` mutation.

## Sync Rule

Never use last-write-wins for note content. Notes are synchronized through CRDT updates or preserved as explicit conflicts.
