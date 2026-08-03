# Plan 014: Notion-style drag handle (toggleable)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 288ea6b..HEAD -- src/components/note-editor.tsx src/routes/_main/index.tsx src/lib/storage/types.ts src/lib/stores/app-store.ts src/components/nav-user.tsx package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (desktop only; not RN/TenTap)
- **Category**: feature
- **Planned at**: commit `288ea6b`, 2026-08-03

## Why this matters

Paperite already has a solid TipTap editor (formatting, images, lists, Yjs).
The missing "Notion feel" is block-level interaction: a grip handle on the
left of each block so users can reorder paragraphs/headings/lists by drag.
TipTap ships a free official extension for this — no Pro/Start subscription
and no Notion-like paid template required.

Users should control the feature the same way as page format:

1. **Global default** in Settings → General ("Note defaults").
2. **Per-note override** in Note setup (`Ctrl+.`).

That matches the existing `PageFormat` / `defaultPageFormat` pattern.

## Desired behavior

- When drag handles are **on** for the active note:
  - Hovering a block shows a left-side grip (e.g. `⠿` / GripVertical).
  - Dragging the grip reorders that block among siblings.
  - Nested content (list items, etc.) works when `nested: true` is enabled.
  - Handles are hidden in read-only mode.
- When drag handles are **off**: no grip, no drag-to-reorder UI (editor
  still editable as today).
- **Settings → Note defaults**: toggle "Block drag handles" (default:
  **off** so existing users are not surprised).
- **Note setup panel**: same toggle, scoped to the active note only.
- New notes inherit the global default. Notes without a per-note override
  follow the global default. Per-note setup still wins when set.

## Out of scope

- TipTap paid "Notion-like Editor Template" / AI / collab product surface.
- Multi-block selection UI polish beyond what `@tiptap/extension-node-range`
  gives for free with Drag Handle.
- Mobile / TenTap / paperite-rn (separate stack; revisit later if needed).
- Persisting the entire per-note `pageFormats` map to disk (keep the same
  in-memory override lifetime as line height / spacing / indent unless a
  later plan persists them).

## Current state (as of `288ea6b`)

- Editor lives in `src/components/note-editor.tsx` (TipTap + Collaboration/Yjs).
- Page chrome options are typed as:

  ```ts
  // src/lib/storage/types.ts
  export type PageFormat = {
    firstLineIndent: boolean;
    lineHeight: "normal" | "1.5";
    paragraphSpacing: "default" | "compact";
  };
  ```

- Global defaults: `PaperiteAppState.defaultPageFormat` +
  `useAppStore.setDefaultPageFormat` (`src/lib/stores/app-store.ts`).
- Per-note overrides: `pageFormats: Record<string, PageFormat>` in
  `src/routes/_main/index.tsx` (in-memory). Fallback:
  `appState.defaultPageFormat ?? FALLBACK_PAGE_FORMAT`.
- Note setup UI is the floating `format` panel in `index.tsx`
  (line height / paragraph spacing / first-line indent).
- Settings "Note defaults" section is in `src/components/nav-user.tsx`.
- No `@tiptap/extension-drag-handle*` packages in `package.json` yet.

## Approach

Use official free packages only:

```bash
bun add @tiptap/extension-drag-handle-react @tiptap/extension-drag-handle @tiptap/extension-node-range
```

Wire `DragHandle` (React component) next to `EditorContent` in `NoteEditor`,
gated by a new `PageFormat` flag so note setup and settings stay one place.

**Recommended shape** (extend existing type):

```ts
export type PageFormat = {
  firstLineIndent: boolean;
  lineHeight: "normal" | "1.5";
  paragraphSpacing: "default" | "compact";
  /** Notion-style left grip for block reorder. Default false. */
  dragHandle: boolean;
};
```

Normalize missing/old saved state → `dragHandle: false`.

## Implementation steps

### Step 1 — Dependencies

1. Install the three packages above with `bun add`.
2. Confirm versions are compatible with the project's current `@tiptap/*`
   major (check `package.json` peer ranges). If peer conflicts appear,
   STOP and report versions rather than force-resolving.

**Verify**: packages listed by `bun pm ls`; project still builds.

### Step 2 — Extend `PageFormat` + persistence defaults

1. Add `dragHandle: boolean` to `PageFormat` in `src/lib/storage/types.ts`.
2. Default `false` in:
   - `defaultAppState.defaultPageFormat` (`app-store.ts`)
   - `FALLBACK_PAGE_FORMAT` / local defaults in `index.tsx` and `note-editor.tsx`
   - `normalizePageFormat()` in `index.tsx`
3. Ensure `reconcileAppState` / `normalizeAppState` keep the field.

**Verify**: Old app-state JSON without the field still yields `false`.

### Step 3 — Editor: mount DragHandle when enabled

In `src/components/note-editor.tsx`:

1. Import React DragHandle + NodeRange per TipTap docs for the installed version.
2. Register `NodeRange` in `useEditor({ extensions: [...] })` (always is fine
   if cheap). Mount visible handle UI only when
   `pageFormat.dragHandle && !readOnly`.
3. Render `<DragHandle editor={editor}>…</DragHandle>` with a small custom
   grip (lucide `GripVertical` or similar). Style: low-contrast by default,
   stronger on hover; left gutter without stealing typing focus.
4. Prefer TipTap `nested: true` so list items can be dragged.
5. When off or read-only, do not render the handle (no invisible hit targets).

**Verify (manual)**:

- Toggle on → hover block → grip → drag reorders → content saves.
- Toggle off → no grip; typing unchanged.
- Read-only note → no grip.
- Undo/redo works after a drag.
- Yjs-backed notes: drag produces a normal document update (no crash).

### Step 4 — Note setup (per-note toggle)

In the floating Note setup panel (`index.tsx`, mode `"format"`):

1. Add switch: **"Block drag handles"** bound to
   `activePageFormat.dragHandle` via `updateActivePageFormat`.
2. Match density of the existing first-line indent control.

**Verify**: Note A enabled; note B (no override) follows global; return to A still enabled.

### Step 5 — Settings dialog (global default)

In `src/components/nav-user.tsx` under **Note defaults**:

1. Switch: **"Block drag handles"** →
   `setDefaultPageFormat({ dragHandle: checked })`.
2. Description: e.g. "Show Notion-style grips to reorder blocks. Applied to
   new notes; per-note setup can override."

**Verify**: Global on → new note has handles; global off → new note does not;
per-note override unchanged.

### Step 6 — CSS polish

Minimal CSS for handle opacity/hover, optional left padding when enabled,
dark theme contrast. Avoid large scroll jumps when toggling on an open note.

**Verify**: Toggle on/off does not jump scroll more than about one line.

### Step 7 — Lint / typecheck / smoke

1. `bunx tsc -b` clean (or no new errors vs baseline).
2. Lint touched files.
3. Manual smoke: create note, reorder 3 paragraphs, reload, confirm order persisted.

## STOP conditions

- TipTap package major requires a paid feature or unsatisfiable peer without
  upgrading the whole TipTap stack mid-plan.
- Drag handle breaks Collaboration/Yjs updates or corrupts documents.
- Handle cannot be confined to blocks without forking the extension — stop
  and report instead of shipping a broken partial.
- Full disk persistence of `pageFormats` becomes required — that is a
  separate plan; do not expand scope beyond the existing in-memory pattern.

## Done criteria

- [ ] Packages installed; editor builds.
- [ ] `PageFormat.dragHandle` exists; normalized default `false`.
- [ ] Settings global toggle works and applies to new notes.
- [ ] Note setup per-note toggle works and overrides global.
- [ ] Grip visible only when enabled and not read-only; drag reorders blocks.
- [ ] No paid TipTap template dependency.
- [ ] `plans/README.md` status row updated to DONE when complete.

## Notes for the executor

- Do **not** use the commercial Notion-like template; only free Drag Handle
  + Node Range extensions.
- Mirror page-format UX ("defaults" vs "this note").
- If TipTap docs for the installed version differ slightly (prop names),
  follow those docs — behavior goals above are authoritative.
