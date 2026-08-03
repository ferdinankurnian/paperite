# Plan 012: TenTap Advanced Setup + Text Align (paperite-rn)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.
>
> **Drift check (run first)**: `paperite-rn` already exists and uses TenTap
> **simple** mode in `screens/NoteEditorScreen.tsx`. Do not reinstall the
> whole app — only upgrade the editor to Advanced setup.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: paperite-rn existing (TenTap simple already wired)
- **Category**: feature parity (desktop TipTap → mobile)
- **Target project**: `paperite-rn`
- **Planned at**: 2026-08-01

## Why this matters

Desktop Paperite (`paperite/src/components/note-editor.tsx`) uses TipTap with
`@tiptap/extension-text-align` (left / center / right / **justify**).

Mobile `paperite-rn` currently uses TenTap **simple** mode. Built-in
`TenTapStartKit` does **not** include TextAlign. The Formatting example that
shows font family / size / align in the docs is a **Pro example** (docs only).

**Advanced setup is free (MIT)** and gives full control of the WebView TipTap
bundle, so we can add `@tiptap/extension-text-align` + a custom
`TextAlignBridge` without paying for Pro.

Goal: mobile editor schema closer to desktop, with align/justify in the
existing floating toolbar.

## Current state (paperite-rn)

| Item | Status |
|------|--------|
| `@10play/tentap-editor` ^1.0.1 | Installed |
| `react-native-webview` | Installed |
| `screens/NoteEditorScreen.tsx` | Custom FormatToolbar (Body, B/I/U/S, highlight, color, quote, code, lists) |
| Text align buttons | **Missing** |
| `editor-web/` Advanced bundle | **Not set up** |
| Vite / react-dom for editor-web | **Not installed** |

## Scope

**In scope**
- Advanced TenTap setup under `paperite-rn/editor-web/`
- Custom `TextAlignBridge` (left, center, right, justify)
- Wire `customSource: editorHtml` into `NoteEditorScreen`
- Add align icons to existing horizontal floating toolbar
- Build scripts (`editor:build`, Expo-friendly `editor:dev` watch)
- Keep existing toolbar design (gradient fade, rounded items, NativeWind)

**Out of scope**
- Font family / font size bridges (Pro example territory; defer)
- Full schema parity with desktop (Collaboration, Yjs, emoji suggestion)
- Image upload pipeline / server sync
- Changing desktop editor

## Key reference

- Advanced docs: https://10play.github.io/10tap-editor/docs/setup/advancedSetup
- Example repo: https://github.com/10play/10TapAdvancedExample
- Desktop TextAlign config:
  ```ts
  TextAlign.configure({ types: ["heading", "paragraph"] })
  ```
- Expo note: use **Alternative Setup** (vite watch → post-build) so Metro
  picks up `editorHtml` without needing vite dev server + adb reverse.

## Steps

### Step 0: Drift check

```bash
cd /home/iydheko/Projects/paperite-rn
ls screens/NoteEditorScreen.tsx package.json
grep -n "useEditorBridge\|TextAlign\|customSource" screens/NoteEditorScreen.tsx || true
test -d editor-web && echo HAS_EDITOR_WEB || echo NO_EDITOR_WEB
```

**Verify**: NoteEditorScreen exists; no `customSource` yet; no `editor-web/`.

### Step 1: Install dependencies

```bash
cd /home/iydheko/Projects/paperite-rn
bun add react-dom @tiptap/extension-text-align
bun add -D vite @vitejs/plugin-react vite-plugin-singlefile @types/react-dom
```

Note: `@tiptap/react`, starter-kit, etc. are already pulled transitively by
`@10play/tentap-editor`. Only add explicit packages we import ourselves.

**Verify**: `package.json` lists the new deps; `bun install` clean.

### Step 2: Create `editor-web/` skeleton

Create:

```
paperite-rn/
  editor-web/
    index.html
    index.tsx
    AdvancedEditor.tsx
    tsconfig.json
    vite.config.ts
  TextAlignBridge.ts   # at project root (or lib/) — shared native bridge
```

#### `editor-web/tsconfig.json`

Use official advanced setup tsconfig (paths pointing to
`@10play/tentap-editor` web types).

#### Root `tsconfig.json`

Add: `"exclude": ["./editor-web"]` (or merge if exclude already exists).

#### `editor-web/index.html`

Copy from official docs (ProseMirror height styles + `#root`).

#### `editor-web/index.tsx`

Copy content-injection interval pattern from docs (Android WebView race).

#### `editor-web/AdvancedEditor.tsx`

```tsx
import React from "react";
import { EditorContent } from "@tiptap/react";
import { useTenTap, TenTapStartKit } from "@10play/tentap-editor";
import TextAlign from "@tiptap/extension-text-align";
import { TextAlignBridge } from "../TextAlignBridge";

export const AdvancedEditor = () => {
  const editor = useTenTap({
    bridges: [...TenTapStartKit, TextAlignBridge],
    tiptapOptions: {
      // TenTapStartKit already registers core nodes/marks via bridges.
      // TextAlign is applied through TextAlignBridge.tiptapExtension.
      // Keep tiptapOptions minimal unless we need extra web-only extensions.
      extensions: [],
    },
  });

  return (
    <EditorContent
      editor={editor}
      className={window.dynamicHeight ? "dynamic-height" : undefined}
    />
  );
};
```

**Important**: Follow TenTap advanced example pattern — bridges own their
`tiptapExtension`. Do not double-register Document/Paragraph/Text in a way that
conflicts with `TenTapStartKit`.

**Verify**: files exist; no TS path errors in editor-web when opening in IDE.

### Step 3: Implement `TextAlignBridge.ts`

Create at `paperite-rn/TextAlignBridge.ts` (or `lib/TextAlignBridge.ts`).

Pattern (aligned with TenTap `BridgeExtension` API):

```ts
import { BridgeExtension } from "@10play/tentap-editor";
import TextAlign from "@tiptap/extension-text-align";

export type TextAlignEditorState = {
  activeTextAlign: "left" | "center" | "right" | "justify" | undefined;
  canSetTextAlign: boolean;
};

export type TextAlignEditorInstance = {
  setTextAlign: (align: "left" | "center" | "right" | "justify") => void;
  unsetTextAlign: () => void;
};

type TextAlignMessage =
  | { type: "set-text-align"; payload: "left" | "center" | "right" | "justify" }
  | { type: "unset-text-align" };

declare module "@10play/tentap-editor" {
  interface BridgeState extends TextAlignEditorState {}
  interface EditorBridge extends TextAlignEditorInstance {}
}

export const TextAlignBridge = new BridgeExtension<
  TextAlignEditorState,
  TextAlignEditorInstance,
  TextAlignMessage
>({
  tiptapExtension: TextAlign.configure({
    types: ["heading", "paragraph"],
    alignments: ["left", "center", "right", "justify"],
  }),
  onBridgeMessage: (editor, message) => {
    if (message.type === "set-text-align") {
      editor.chain().focus().setTextAlign(message.payload).run();
    }
    if (message.type === "unset-text-align") {
      editor.chain().focus().unsetTextAlign().run();
    }
    return false;
  },
  extendEditorInstance: (sendBridgeMessage) => ({
    setTextAlign: (align) =>
      sendBridgeMessage({ type: "set-text-align", payload: align }),
    unsetTextAlign: () => sendBridgeMessage({ type: "unset-text-align" }),
  }),
  extendEditorState: (editor) => ({
    activeTextAlign: (editor.getAttributes("paragraph").textAlign ||
      editor.getAttributes("heading").textAlign) as
      | "left"
      | "center"
      | "right"
      | "justify"
      | undefined,
    canSetTextAlign: editor.can().setTextAlign("left"),
  }),
});
```

**Adjust** `extendEditorState` if needed to use `editor.isActive({ textAlign: "left" })` style (same as desktop). Prefer:

```ts
activeTextAlign: ("left" | "center" | "right" | "justify" | undefined) =
  (["left", "center", "right", "justify"] as const).find((a) =>
    editor.isActive({ textAlign: a }),
  );
```

**Verify**: module augmentation types compile; bridge exports cleanly.

### Step 4: Vite config (Expo alternative / watch-friendly)

`editor-web/vite.config.ts` — based on official advanced setup + Expo alternative:

- `root`: editor-web dir
- alias `@10play/tentap-editor` → `@10play/tentap-editor/web`
- alias `@tiptap/pm/view` and `@tiptap/pm/state` → tentap web (avoid dual PM)
- `vite-plugin-singlefile`
- `build.outDir: "build"`, `emptyOutDir: false` (Expo alternative)
- optional `closeBundle` hook running post-build script

### Step 5: package.json scripts

```json
"editor:dev": "vite --config ./editor-web/vite.config.ts -w build",
"editor:build": "vite --config ./editor-web/vite.config.ts build && bun run editor:post-build",
"editor:post-build": "node ./node_modules/@10play/tentap-editor/scripts/buildEditor.js ./editor-web/build/index.html"
```

**Verify**:

```bash
cd /home/iydheko/Projects/paperite-rn
bun run editor:build
ls editor-web/build/editorHtml.ts   # or whatever path post-build emits
```

Expected: `editorHtml` string export generated (path per tentap script output).

### Step 6: Wire NoteEditorScreen to Advanced source

In `screens/NoteEditorScreen.tsx`:

```ts
import { editorHtml } from "../editor-web/build/editorHtml"; // confirm path
import { TextAlignBridge } from "../TextAlignBridge";
import { TenTapStartKit, useEditorBridge, ... } from "@10play/tentap-editor";

const editor = useEditorBridge({
  customSource: editorHtml,
  bridgeExtensions: [...TenTapStartKit, TextAlignBridge],
  autofocus: !isReadOnly && !title,
  avoidIosKeyboard: true,
  initialContent,
  editable: !isReadOnly,
});
```

**Verify**: app boots; existing formatting still works (bold, lists, etc.).

### Step 7: Add align controls to FormatToolbar

In the horizontal `ScrollView` toolbar (after color / before lists or after
quote/code — match desktop order roughly):

Desktop order (simplified): Body | B I U S | Highlight Color | Quote Code | **Align** | Lists

Add icons from `lucide-react-native`:
- `AlignLeft`, `AlignCenter`, `AlignRight`, `AlignJustify`

```tsx
<FormatIcon
  active={state.activeTextAlign === "left"}
  onPress={() => editor.setTextAlign("left")}
>
  <AlignLeft size={22} color="#000" strokeWidth={2} />
</FormatIcon>
// center, right, justify same pattern
```

**Verify**: tapping align changes paragraph alignment in the WebView;
active state highlights the correct icon.

### Step 8: Manual QA checklist

1. Open note (new + existing)
2. Bold / italic / lists still work (regression)
3. Align left / center / right / justify apply
4. Switch between heading + body, align still works on both
5. Reload content that already has `text-align` style from desktop HTML/JSON
   path (if notes are HTML string today, ensure align survives round-trip)
6. Keyboard + toolbar still visible (KeyboardAvoidingView)

## Test plan

- `bun run editor:build` succeeds
- Expo / Metro starts without redbox
- FormatToolbar shows 4 align buttons
- `editor.setTextAlign('justify')` produces justified text in WebView
- No duplicate TipTap extension errors in WebView console

## Done criteria

- [ ] `editor-web/` exists with build pipeline
- [ ] `TextAlignBridge` implemented and module-augmented
- [ ] `NoteEditorScreen` uses `customSource` + `TextAlignBridge`
- [ ] Toolbar has left/center/right/justify with active state
- [ ] `bun run editor:build` exits 0
- [ ] Existing toolbar features still work

## STOP conditions

Stop and report if:

- `buildEditor.js` output path differs from docs (find actual export path)
- Advanced WebView fails to load on Expo Go (may need **dev client** — advanced
  is not fully supported on Expo Go for all cases; document and switch to
  `npx expo run:android` / `run:ios` if needed)
- Bridge message types don't match installed tentap version API (check
  node_modules types for `BridgeExtension` constructor)
- Double-registration of StarterKit extensions breaks editor (empty content /
  crash) — fix by following official advanced example bridges list exactly

## Maintenance notes

- Re-run `bun run editor:build` after any change under `editor-web/` or
  `TextAlignBridge` web-related config.
- For local iteration: `bun run editor:dev` (watch) + Metro reload.
- Later: share more desktop extensions (Link options, Image) via the same
  advanced bundle for stricter schema parity.
- Content format today in RN is HTML string via TenTap; desktop uses TipTap
  JSON. Align styles in HTML use `style="text-align: ..."` — keep converters
  in mind when syncing to server.
