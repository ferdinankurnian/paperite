# Image asset rendering fix

## Root cause
1. After paste/save, TipTap gets relative path `assets/xxx.png` which resolves against `http://localhost:5173/` → 404
2. `getAssetUrl` returns `file://...` which Chromium blocks when the page is served from `http://` (Vite dev)
3. Image node exists ("invisible element") but src fails to load

## Fix applied
See changes in main.js and note-editor.tsx
