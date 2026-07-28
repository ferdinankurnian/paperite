# Plan 004: Add a top-level error boundary

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 975b6a5..HEAD -- src/components/root-layout.tsx src/main.tsx`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P0
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `975b6a5`, 2026-07-28

## Why this matters

There is currently no `ErrorBoundary`/`componentDidCatch` anywhere in `src`
(confirmed via grep — zero matches). Paperite is a local-first app: the
user's notes live safely on disk regardless of what the renderer does, but
the renderer doesn't know that. If any component throws during render — a
malformed TipTap doc from a corrupted or hand-edited `note.json`, a bad Yjs
merge, an unexpected paste payload — React unmounts the tree and the whole
window goes blank. A user staring at a blank Electron window has no way to
know their note is fine; the natural conclusion is "I lost my notes," which
is the worst possible failure mode for a note-taking app's trust.

## Current state

- File: `src/components/root-layout.tsx` — renders `<AppTitlebar />` and
  `<Outlet />` (the routed page, i.e. the note list + editor) inside
  `ThemeProvider` → `KeyboardShortcutsProvider` → `TooltipProvider`.
- No error boundary exists anywhere in the render tree today.

## Scope

**In scope:**
- New file: `src/components/error-boundary.tsx`
- `src/components/root-layout.tsx` — wrap `<Outlet />` (not the whole shell)

**Out of scope:**
- Crash reporting / telemetry integration — out of scope for this plan.
  Just stop the blank-screen failure mode; logging service can be a
  follow-up.

## Steps

### Step 1: Create `ErrorBoundary`

New file `src/components/error-boundary.tsx`:

```tsx
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = {
    children: ReactNode;
};

type State = {
    error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("Paperite renderer crash:", error, info.componentStack);
    }

    handleReload = () => {
        this.setState({ error: null });
        window.location.reload();
    };

    render() {
        if (!this.state.error) return this.props.children;

        return (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                <h1 className="text-lg font-semibold">
                    Something went wrong rendering this note
                </h1>
                <p className="max-w-md text-sm text-muted-foreground">
                    Your notes are safe on disk — this is just a display
                    problem. Try reloading. If it keeps happening, check the
                    note file in your file manager for unusual content.
                </p>
                <Button type="button" onClick={this.handleReload}>
                    Reload Paperite
                </Button>
            </div>
        );
    }
}
```

Adjust the `Button` import path/props to match whatever the existing
shadcn `Button` component actually exports (check `src/components/ui/button.tsx`
for the correct prop names before finalizing).

### Step 2: Wrap the routed content in `root-layout.tsx`

```tsx
import { ErrorBoundary } from "@/components/error-boundary";
// ...
<div className="min-h-0 flex-1 overflow-hidden">
    <ErrorBoundary>
        <Outlet />
    </ErrorBoundary>
</div>
```

Deliberately wrap `<Outlet />` only, not `<AppTitlebar />` or the providers —
if the crash is inside note content, the titlebar (with its window controls,
close button, etc.) should stay usable so the user isn't stuck.

### Step 3: Verify

**Verify**: `bun run lint` → exit 0, `bunx tsc -b` → exit 0

## Test plan

No test suite exists. Manual verification:

1. Temporarily throw an error inside a component under `<Outlet />` (e.g.
   `if (true) throw new Error("test")` in `Index`), confirm the fallback UI
   renders instead of a blank window, and the titlebar is still visible and
   functional (window can still be closed/minimized).
2. Click "Reload Paperite" — app should reload cleanly.
3. Remove the temporary throw before finishing.

## Done criteria

ALL must hold:

- [ ] `bun run lint` exits 0
- [ ] `bunx tsc -b` exits 0
- [ ] A forced render error under `<Outlet />` shows the fallback UI, not a
      blank window
- [ ] Titlebar remains visible/functional when the boundary is triggered
- [ ] Temporary test throw removed before marking done

## STOP conditions

- The code at the locations in "Current state" doesn't match (drift).
- `Button` component's actual API doesn't match what's used above — adjust
  to match, don't add a new button primitive.

## Maintenance notes

- This is intentionally minimal (no telemetry). If/when Paperite ships
  crash reporting, `componentDidCatch` is the place to wire it in.
