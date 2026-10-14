# Plan 002: Fix direct clipboard paste bypassing asset storage

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 975b6a5..HEAD -- src/components/note-editor.tsx`
> If the file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `975b6a5`, 2026-07-28

## Why this matters

Plan 001 (store images as files) is already implemented — `insertImage` in
`FormatMenu` correctly calls `window.electron.notes.saveImage` and writes to
`assets/`. But that path is only reached from the toolbar upload button, the
drag-and-drop handler, and the manual "paste from clipboard" button. A user
who does a normal `Ctrl+V` directly into the editor body never goes through
`insertImage` — ProseMirror's default paste handling takes over, and because
`Image.configure({ allowBase64: true })` is set, the pasted image is inserted
as an inline base64 `data:` URL instead of a file. This silently reintroduces
the exact bloat problem plan 001 fixed, for the single most common way people
actually add images to a note.

## Current state

- File: `src/components/note-editor.tsx`
- `Image.configure` (around line 253) has `allowBase64: true`.
- The `useEditor` call's `editorProps` (inside `NoteEditor`) only defines
  `attributes` and `handleDOMEvents: { keydown, mouseover }` — there is no
  `handlePaste`.
- `insertImage` is defined inside `FormatMenu`, not `NoteEditor`, and closes
  over `notePath` from `FormatMenu`'s own scope — it is not directly callable
  from `editorProps.handlePaste`, which lives in `NoteEditor`.
- `NoteEditor` already receives `notePath: string | null` as a prop, so the
  same IPC call (`window.electron.notes.saveImage`) is reachable from there.

## Scope

**In scope:**
- `src/components/note-editor.tsx`

**Out of scope:**
- `main.js`, `preload.js` — the `notes:save-image` IPC handler already
  supports this use case unchanged.

## Steps

### Step 1: Extract a shared "save image to note" helper

In `note-editor.tsx`, factor the body of `insertImage` (the part after
`reader.addEventListener("load", ...)`, i.e. the "we have a data URL, call
saveImage, fall back to base64 on failure" logic) into a standalone async
function that takes `(notePath: string, dataUrl: string, filename: string)`
and returns the resolved `src` to insert. Both the existing `insertImage`
(toolbar/drag/drop) and the new paste handler should call this helper so
there is one code path for "turn a File into a stored asset."

### Step 2: Add `handlePaste` to `editorProps`

In `NoteEditor`'s `useEditor` config, add a `handlePaste` alongside the
existing `handleDOMEvents`:

```ts
handlePaste: (view, event) => {
    if (readOnlyRef.current || !notePath) return false;

    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (!imageItem) return false; // let ProseMirror/TipTap handle text/etc normally

    const file = imageItem.getAsFile();
    if (!file) return false;

    event.preventDefault();

    const reader = new FileReader();
    reader.addEventListener("load", async () => {
        if (typeof reader.result !== "string") return;
        const src = await saveImageToNote(notePath, reader.result, file.name || "image");
        editor?.chain().focus().setImage({ src, alt: file.name }).run();
    });
    reader.readAsDataURL(file);

    return true; // we handled it, don't let ProseMirror also insert it
},
```

Use the helper from Step 1 in place of `saveImageToNote` above. Note:
`editor` is not yet defined at the point `useEditor` is called — reference
it through a ref (the file already uses `notePathRef`/`readOnlyRef` for this
exact pattern) rather than the `editor` variable directly, or restructure so
the handler runs after `editor` exists. Follow whichever pattern the rest of
the file already uses for referencing the editor instance inside its own
`editorProps`.

### Step 3: Confirm normal paste still works

Non-image paste (text, rich text, links) must not be affected — the handler
returns `false` immediately when there's no image in the clipboard, which
hands control back to TipTap's default paste behavior.

**Verify**: `bun run lint` → exit 0, `bunx tsc -b` → exit 0

## Test plan

No test suite exists for editor interactions. Manual verification:

1. Copy an image (e.g. screenshot to clipboard), place cursor in a note,
   `Ctrl+V` — image should appear in the editor.
2. Check the note's `assets/` folder — a new file should exist there.
3. Check `note.json` — the image node's `src` should be a relative
   `assets/...` path, not a `data:` URL.
4. Paste plain text — should behave exactly as before.
5. Paste a link/URL — should behave exactly as before (autolink still works).
6. Existing toolbar upload / drag-and-drop image flows still work unchanged.

## Done criteria

ALL must hold:

- [ ] `bun run lint` exits 0
- [ ] `bunx tsc -b` exits 0
- [ ] Ctrl+V paste of an image writes a file to `assets/`, not base64
- [ ] Non-image paste behavior is unchanged
- [ ] Toolbar/drag-drop image insertion still works (regression check)

## STOP conditions

- The code at the locations in "Current state" doesn't match (drift).
- `editor` reference inside its own `editorProps` config causes a
  circular-reference issue that isn't resolvable with the existing ref
  pattern — stop and report rather than restructuring the component broadly.
