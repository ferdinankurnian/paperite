# Store Images as Files Instead of Base64

## Problem

Images pasted/inserted into notes are encoded as base64 data URLs and embedded directly in `note.json`. A single screenshot can bloat the JSON by 1-5MB. The `assets/` directory is already created for every note (`main.js:267-269`) but is completely unused.

## Goal

Store images as actual files (e.g. `assets/<uuid>.png`) inside each note's folder. The note JSON references images by relative path (`assets/image-xxx.png`) instead of inline base64.

## Files to Modify

| File | Change |
|------|--------|
| `main.js` | Add `notes:save-image` IPC handler |
| `preload.js` | Expose `saveImage` on `window.electron.notes` |
| `src/vite-env.d.ts` | Add `saveImage` type to `Window.electron.notes` |
| `src/components/note-editor.tsx` | `insertImage()` calls IPC, uses file path as src |
| `src/lib/note-content.ts` | Markdown export handles file paths (no change needed — already outputs src as-is) |

## Implementation

### Step 1: `main.js` — Add `notes:save-image` IPC handler

Add after the existing `notes:write-note` handler (~line 2329):

```js
ipcMain.handle("notes:save-image", async (_event, notePath, imageDataUrl, filename) => {
    await ensureWorkspace();
    const normalizedPath = currentNotePath(notePath);
    await ensureNoteDirectory(normalizedPath);

    // Parse data URL: "data:image/png;base64,iVBOR..."
    const match = imageDataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) throw new Error("Invalid image data URL");

    const ext = match[1] === "jpeg" ? "jpg" : match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, "base64");

    // Generate unique filename, use original name if provided
    const safeName = filename
        ? filename.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.[^.]+$/, '')
        : "image";
    const assetFilename = `${safeName}-${crypto.randomUUID()}.${ext}`;
    const assetPath = path.join(
        resolveWorkspacePath(noteAssetsPath(normalizedPath)),
        assetFilename,
    );

    await fs.writeFile(assetPath, buffer);

    // Return relative path for use in note JSON
    return { path: `${noteAssetsDirectoryName}/${assetFilename}` };
});
```

### Step 2: `preload.js` — Expose `saveImage`

Add inside the `notes:` object (after `writeNote`):

```js
saveImage: (notePath, imageDataUrl, filename) =>
    ipcRenderer.invoke("notes:save-image", notePath, imageDataUrl, filename),
```

### Step 3: `src/vite-env.d.ts` — Add type

Add inside `notes:` interface:

```ts
saveImage: (notePath: string, imageDataUrl: string, filename: string) => Promise<{ path: string }>;
```

### Step 4: `src/components/note-editor.tsx` — Update `insertImage()`

Replace the current `insertImage` function (lines 596-608):

```ts
const insertImage = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (!notePath) return;

    const reader = new FileReader();
    reader.addEventListener("load", async () => {
        if (typeof reader.result !== "string") return;
        try {
            const result = await window.electron?.notes.saveImage(
                notePath,
                reader.result,
                file.name || "image",
            );
            if (result?.path) {
                editor
                    .chain()
                    .focus()
                    .setImage({ src: result.path, alt: file.name })
                    .run();
            }
        } catch {
            // fallback: insert as base64 if save fails
            editor
                .chain()
                .focus()
                .setImage({ src: reader.result, alt: file.name })
                .run();
        }
        setImagePopoverOpen(false);
    });
    reader.readAsDataURL(file);
};
```

### Step 5: Handle image src resolution on read (optional but recommended)

When `readNoteContent` loads a note, image `src` values like `assets/image-xxx.png` are relative paths. The renderer needs to resolve them to absolute `file://` URLs for TipTap to display them.

Add a new IPC handler in `main.js`:

```js
ipcMain.handle("notes:get-asset-url", async (_event, notePath, assetRelativePath) => {
    const normalizedPath = currentNotePath(notePath);
    const absolutePath = path.join(
        resolveWorkspacePath(toPosixRelativePath(normalizedPath)),
        assetRelativePath,
    );
    return `file://${absolutePath}`;
});
```

Expose in `preload.js`:

```js
getAssetUrl: (notePath, assetPath) =>
    ipcRenderer.invoke("notes:get-asset-url", notePath, assetPath),
```

Add type in `vite-env.d.ts`:

```ts
getAssetUrl: (notePath: string, assetPath: string) => Promise<string>;
```

Then in `note-editor.tsx`, when loading note content, walk the document and resolve any `image` nodes with relative `src` to absolute URLs before setting editor content. Add a helper:

```ts
function resolveImageSrc(notePath: string, src: string): string {
    if (src.startsWith("data:") || src.startsWith("http") || src.startsWith("file://")) {
        return src;
    }
    // Relative path like "assets/image-xxx.png" — resolve via IPC
    return src; // Will be resolved async in loadContent
```

In the content loading effect (around line 380), before setting `editorContent`, resolve image paths:

```ts
// In the effect that loads content, after readNote:
const resolved = await resolveImagePaths(notePath, content);
setEditorContent(resolved);
```

With:

```ts
async function resolveImagePaths(notePath: string, content: NoteContent): Promise<NoteContent> {
    if (content.type === "image" && typeof content.attrs?.src === "string") {
        const src = content.attrs.src as string;
        if (!src.startsWith("data:") && !src.startsWith("http") && !src.startsWith("file://")) {
            const url = await window.electron?.notes.getAssetUrl(notePath, src);
            if (url) {
                return { ...content, attrs: { ...content.attrs, src: url } };
            }
        }
    }
    if (content.content) {
        const resolvedChildren = await Promise.all(
            content.content.map(child => resolveImagePaths(notePath, child))
        );
        return { ...content, content: resolvedChildren };
    }
    return content;
}
```

### Step 6: Handle note deletion — clean up assets

In `main.js`, find the `notes:delete-item` handler and ensure the `assets/` directory is removed with the note folder. Since `fs.rm` with `recursive: true` on the note directory already handles this (the assets dir is inside the note dir), no additional work should be needed. Verify this is the case.

### Step 7: Handle note move/rename — move assets too

Same logic — since `assets/` is inside the note directory, moving/renaming the note directory moves assets too. Verify the existing move/rename handlers use recursive directory operations.

## Verification

1. `bun run lint` — passes
2. Manual test: create a note, paste/insert an image, verify:
   - Image appears in the editor
   - `note.json` contains `"src": "assets/image-xxx.png"` (NOT base64)
   - An actual PNG file exists in `<note>/assets/`
   - Re-opening the note shows the image
3. Manual test: export to markdown — verify image path is relative, not base64
4. Manual test: delete the note — verify assets folder is cleaned up

## Migration (Future)

Existing notes with base64 images can be migrated separately — scan all `note.json` files, find image nodes with `data:` src, decode and save as files, update the JSON. This is optional and can be a follow-up task.
