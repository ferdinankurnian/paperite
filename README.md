# Paperite

A local-first desktop note-taking app built with Electron and React.

Notes are stored as JSON files in `~/Documents/Paperite` with a local SQLite index for full-text search.

## Features

- Rich text editor (TipTap) with formatting, lists, code blocks, and more
- Local-first: notes are plain JSON files on your filesystem
- Full-text search via SQLite FTS5
- Spaces and folder organization
- Pop-out note windows
- Zen mode
- Clerk authentication (Google OAuth)

## Development

```bash
bun install
bun start
```

## Build

```bash
bun run build
```

Produces `AppImage`, `deb`, and `tar.gz` in `dist/`.

## Authentication

Set your Clerk publishable key in `.env`:

```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

Get a key at [clerk.com](https://clerk.com).
