# Plan 001: Pin preview tab when user starts editing

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7ed7dfe..HEAD -- src/routes/_main/index.tsx`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it
> as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `7ed7dfe`, 2026-06-26

## Why this matters

When a note is opened from the sidebar via single-click, it gets a "preview" tab (italic + opacity). Currently, typing in the TipTap editor does not change the tab state — it stays italic forever until the user double-clicks the tab. This feels broken compared to VS Code, where preview tabs auto-promote on edit. The fix makes the tab state feel alive and intentional.

## Current state

- File: `src/routes/_main/index.tsx` — contains all tab state logic and the editor change handler
- The `pinTab` function (line 1749) already exists and sets `preview: false` on a tab by path:
  ```ts
  const pinTab = useCallback((notePath: string) => {
      setAppState((current) => ({
          ...current,
          openTabs: current.openTabs.map((tab) =>
              tab.path === notePath ? { ...tab, preview: false } : tab,
          ),
      }));
  }, []);
  ```
- The `updateNoteContent` callback (line 1612) fires on every TipTap `onUpdate` (every keystroke):
  ```ts
  const updateNoteContent = useCallback(
      (nextContent: NoteContent, sourceNotePath: string | null) => {
          if (!sourceNotePath) return;
          if (sourceNotePath !== activeNotePathRef.current) return;

          noteContentRef.current = nextContent;
          noteContentCache.current.set(sourceNotePath, nextContent);
          setNoteContent(nextContent);

          if (loadedYNote?.path === sourceNotePath) {
              scheduleYjsDerivedAutosave(sourceNotePath, nextContent);
              return;
          }

          scheduleNoteAutosave(sourceNotePath, nextContent);
      },
      [loadedYNote?.path, scheduleNoteAutosave, scheduleYjsDerivedAutosave],
  );
  ```

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|----------------------|---------------------|
| Lint      | `bun run lint`       | exit 0              |
| Typecheck | `bunx tsc -b`        | exit 0, no errors   |

## Scope

**In scope** (the only file you should modify):
- `src/routes/_main/index.tsx`

**Out of scope** (do NOT touch):
- `src/components/note-editor.tsx` — TipTap editor; no changes needed
- `src/components/app-sidebar.tsx` — sidebar open logic; no changes needed
- `src/lib/storage/types.ts` — `OpenNoteTab` type; no changes needed

## Steps

### Step 1: Add pin-on-edit logic to `updateNoteContent`

In `src/routes/_main/index.tsx`, at the top of the `updateNoteContent` callback (after the early returns on lines 1614-1615), add logic to pin the tab if it's currently in preview mode:

```ts
const updateNoteContent = useCallback(
    (nextContent: NoteContent, sourceNotePath: string | null) => {
        if (!sourceNotePath) return;
        if (sourceNotePath !== activeNotePathRef.current) return;

        // Pin the tab if it's in preview mode (VS Code-like behavior)
        setAppState((current) => {
            const tab = current.openTabs.find((t) => t.path === sourceNotePath);
            if (!tab?.preview) return current;
            return {
                ...current,
                openTabs: current.openTabs.map((t) =>
                    t.path === sourceNotePath ? { ...t, preview: false } : t,
                ),
            };
        });

        noteContentRef.current = nextContent;
        noteContentCache.current.set(sourceNotePath, nextContent);
        setNoteContent(nextContent);

        if (loadedYNote?.path === sourceNotePath) {
            scheduleYjsDerivedAutosave(sourceNotePath, nextContent);
            return;
        }

        scheduleNoteAutosave(sourceNotePath, nextContent);
    },
    [loadedYNote?.path, scheduleNoteAutosave, scheduleYjsDerivedAutosave],
);
```

The key change: before updating content, check if the tab for `sourceNotePath` has `preview: true`. If so, set it to `false`. This uses the same `setAppState` updater pattern already used throughout the file.

**Verify**: `bun run lint` → exit 0

### Step 2: Verify typecheck passes

**Verify**: `bunx tsc -b` → exit 0, no errors

## Test plan

No test suite exists in this project. Manual verification:

1. Open a note from the sidebar with single-click → tab should be italic (preview)
2. Start typing in the editor → tab should immediately become non-italic (pinned)
3. Open another note with single-click → new preview tab replaces old one, both italic
4. Type in the new note → it pins, previous tab stays as-is
5. Double-click a tab → still works as before (explicitly pins)

## Done criteria

ALL must hold:

- [ ] `bun run lint` exits 0
- [ ] `bunx tsc -b` exits 0
- [ ] Typing in a preview tab auto-pins it (non-italic)
- [ ] No files outside `src/routes/_main/index.tsx` are modified

## STOP conditions

Stop and report back if:

- The code at the locations in "Current state" doesn't match the excerpts (the codebase has drifted).
- A step's verification fails twice after a reasonable fix attempt.
- The fix appears to require touching an out-of-scope file.

## Maintenance notes

- The `setAppState` call in `updateNoteContent` adds one extra state update per keystroke when the tab is in preview mode. This is negligible — the state updater short-circuits (`return current`) once the tab is already pinned, so it only fires once (on the first keystroke).
- If a `dirty` / `modified` indicator (like a dot on the tab) is added later, this is the right place to also set that flag.
