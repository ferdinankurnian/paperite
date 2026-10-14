# Paperite Web — Implementation Plan

## Goal

Add `paperite web` CLI command that starts a local HTTP server and serves the Paperite UI in the browser, similar to `opencode web`. Notes stay stored locally on the user's machine (local-first), but accessed via browser instead of Electron.

## Architecture Overview

```
┌─────────────────────┐     HTTP/WS      ┌──────────────────────┐
│   Browser Client    │ ◄──────────────► │   Node.js Server     │
│   (React/Vite)      │                  │   (Express + ws)     │
│                     │                  │                      │
│  - TipTap editor    │  REST API        │  - File system ops   │
│  - Sidebar/tabs     │  WebSocket       │  - SQLite FTS5       │
│  - Command palette  │  (real-time)     │  - Yjs persistence   │
│                     │                  │  - File watchers     │
└─────────────────────┘                  └──────────────────────┘
                                                │
                                        ~/Documents/Paperite/
```

## Phase 1: Storage Abstraction Layer

**Files to create:**
- `src/lib/storage/types.ts` — interface definition
- `src/lib/storage/electron-storage.ts` — wraps existing `window.electron.notes`
- `src/lib/storage/web-storage.ts` — HTTP client implementation

**Interface (matching existing IPC channels):**

```typescript
interface NotesStorage {
  getWorkspace(): Promise<WorkspaceSnapshot>
  search(query: string): Promise<SearchResult[]>
  readNote(path: string): Promise<NoteContent>
  writeNote(path: string, content: NoteContent): Promise<void>
  writeDerivedNote(path: string, content: NoteContent): Promise<void>
  readYNote(path: string): Promise<YNoteState>
  writeYUpdate(path: string, update: Uint8Array): Promise<void>
  createNote(parentPath: string, title: string): Promise<{path: string; title: string}>
  createFolder(parentPath: string, title: string): Promise<{path: string; title: string}>
  createSpace(title: string): Promise<{path: string; title: string}>
  renameItem(path: string, nextName: string): Promise<{path: string}>
  moveItem(path: string, nextParentPath: string): Promise<{path: string}>
  deleteItem(path: string): Promise<void>
  readAppState(): Promise<Partial<PaperiteAppState>>
  writeAppState(state: PaperiteAppState): Promise<void>
  getTrashContents(): Promise<TrashNote[]>
  restoreItem(name: string): Promise<void>
  permanentDeleteItem(name: string): Promise<void>
  emptyTrash(): Promise<void>
  onWorkspaceChanged(callback: () => void): () => void
}
```

**Key decision:** `getNotesEngine()` in `src/lib/notes-engine.ts` becomes a thin wrapper that returns `ElectronStorage` or `WebStorage` based on environment detection.

---

## Phase 2: Backend Server

**Files to create:**
- `server/index.js` — Express server entry point
- `server/routes/notes.js` — Note CRUD endpoints
- `server/routes/workspace.js` — Workspace tree + search
- `server/routes/trash.js` — Trash operations
- `server/routes/state.js` — App state read/write
- `server/lib/fs-ops.js` — File system operations (extracted from main.js)
- `server/lib/sqlite-index.js` — SQLite FTS5 index (extracted from main.js)
- `server/lib/yjs-persist.js` — Yjs snapshot/update persistence
- `server/lib/watchers.js` — File watcher → WebSocket push
- `server/lib/ws-handler.js` — WebSocket handler for real-time updates

**Port:** Default random available, configurable via `--port` flag.

**API Mapping (IPC → REST):**

| IPC Channel | HTTP Method | Endpoint |
|---|---|---|
| `notes:get-workspace` | GET | `/api/workspace` |
| `notes:search` | GET | `/api/search?q=` |
| `notes:read-note` | GET | `/api/notes/*` |
| `notes:write-note` | PUT | `/api/notes/*` |
| `notes:write-derived-note` | PUT | `/api/notes/*/derived` |
| `notes:read-y-note` | GET | `/api/notes/*/yjs` |
| `notes:write-y-update` | POST | `/api/notes/*/yjs/update` |
| `notes:create-note` | POST | `/api/notes` |
| `notes:create-folder` | POST | `/api/folders` |
| `notes:create-space` | POST | `/api/spaces` |
| `notes:rename-item` | PATCH | `/api/rename` |
| `notes:move-item` | POST | `/api/move` |
| `notes:delete-item` | DELETE | `/api/notes/*` |
| `notes:get-trash` | GET | `/api/trash` |
| `notes:restore-item` | POST | `/api/trash/restore` |
| `notes:permanent-delete` | DELETE | `/api/trash/*` |
| `notes:empty-trash` | DELETE | `/api/trash` |
| `notes:read-app-state` | GET | `/api/state` |
| `notes:write-app-state` | PUT | `/api/state` |

**WebSocket channels:**
- `/ws` — Multiplexed: `workspace:changed`, `sync:changed`

---

## Phase 3: Frontend Adapter

**Files to modify:**
- `src/lib/notes-engine.ts` — detect environment, return appropriate storage
- `src/lib/sync-engine.ts` — same pattern
- `src/lib/y-note-store.ts` — already uses `getNotesEngine()`, no changes needed

**Environment detection:**
```typescript
export function getNotesEngine(): NotesStorage | null {
  if (window.electron?.notes) return new ElectronStorage()
  if (import.meta.env.PAPERITE_WEB) return new WebStorage()
  return null
}
```

**WebStorage implementation:**
- Uses `fetch()` for REST calls
- Uses `WebSocket` for real-time updates
- Handles binary data (Yjs updates) via `ArrayBuffer`

---

## Phase 4: CLI Command

**File to modify:** `package.json` scripts

```json
{
  "scripts": {
    "web": "node server/index.js",
    "dev:web": "vite",
    "dev:server": "node server/index.js --dev"
  }
}
```

**CLI flags:**
- `--port <number>` — Server port (default: random)
- `--hostname <string>` — Bind address (default: `127.0.0.1`)
- `--open` — Auto-open browser (default: true)
- `--workspace <path>` — Custom workspace root (default: `~/Documents/Paperite`)

**Usage:**
```bash
paperite web                    # Start server, open browser
paperite web --port 3000        # Custom port
paperite web --hostname 0.0.0.0 # LAN accessible
```

---

## Phase 5: UI Adjustments for Web Mode

**Files to modify:**
- `src/components/app-titlebar.tsx` — Hide Electron window controls, show server status
- `src/routes/_main/index.tsx` — Replace "needs Electron shell" message with web UI
- `vite.config.ts` — Add `PAPERITE_WEB` env variable for conditional builds

**Changes:**
1. Remove custom titlebar in web mode (use browser chrome)
2. Hide minimize/maximize/close buttons
3. Show connection status indicator
4. Disable popout feature (no `BrowserWindow` in web)
5. Disable Google Drive sync UI (server-side only, not exposed via API yet)

---

## Phase 6: Packaging & Distribution

**For development:**
```bash
bun run dev:server  # Start Vite + server concurrently
```

**For production (npm install -g):**
- Bundle server code with the npm package
- `paperite web` runs the bundled server
- Serve pre-built static assets from `dist/`

**Dependencies to add:**
- `express` — HTTP server
- `ws` — WebSocket server
- `cors` — CORS middleware (for development)

---

## Implementation Order

1. **Phase 1** — Storage abstraction (foundation, no behavior change)
2. **Phase 2** — Backend server (core logic, extracted from main.js)
3. **Phase 3** — Frontend adapter (connects UI to server)
4. **Phase 4** — CLI command (user-facing entry point)
5. **Phase 5** — UI adjustments (polish for web mode)
6. **Phase 6** — Packaging (distribution)

## Complexity Estimate

- **Phase 1:** 1-2 days — Mostly type definitions + thin wrappers
- **Phase 2:** 5-7 days — Extracting and refactoring main.js logic
- **Phase 3:** 2-3 days — WebStorage + WebSocket client
- **Phase 4:** 1 day — CLI setup
- **Phase 5:** 1-2 days — UI tweaks
- **Phase 6:** 1-2 days — Build/packaging config

**Total: ~2-3 weeks**

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| FTS5 not available in browser | Server-side SQLite, WASM fallback |
| File watchers not real-time | WebSocket push with debounce |
| Yjs binary over HTTP | Use proper Content-Type + ArrayBuffer |
| CORS in development | Express middleware |
| Race conditions (multi-tab) | Server-side file locking |
