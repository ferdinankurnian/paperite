# Plan 001: Add Customizable Keyboard Shortcuts Settings

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**: `git diff --stat acc76b5..HEAD -- src/components/app-titlebar.tsx src/components/sidebar-hotkeys.tsx src/components/ui/sidebar.tsx src/routes/_main/index.tsx src/vite-env.d.ts src/components/root-layout.tsx src/components/theme-provider.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `acc76b5`, 2026-06-14

## Why this matters

Paperite is already close to feeling finished, so the best next feature is not a large new product surface. Customizable keyboard shortcuts make the desktop app feel owned, fast, and serious without changing the note model. The code already has shortcuts scattered across titlebar menu events, sidebar handlers, and the main route. This plan consolidates app-level shortcuts into a command registry, adds a Settings keyboard page, and lets users change or disable shortcuts safely with conflict detection.

## Current state

- `src/components/root-layout.tsx` renders global providers, the titlebar, and the route outlet.
- `src/components/app-titlebar.tsx` owns the app menu and dispatches `paperite:*` browser events for app actions.
- `src/routes/_main/index.tsx` owns most note/workspace state and has local `keydown` handlers for zen mode and tab switching.
- `src/components/sidebar-hotkeys.tsx` separately handles `Alt+B` to toggle the sidebar and blocks `Ctrl/Cmd+B` propagation.
- `src/components/ui/sidebar.tsx` still has the shadcn default `Ctrl/Cmd+B` sidebar shortcut.
- `src/vite-env.d.ts` contains shared global types, including `PaperiteAppState`; shortcut persistence may require extending it if stored in app state.
- There is no test suite. The repo's current verification gates are `bun run lint` and `bun run build`.

Relevant excerpts as of `acc76b5`:

```tsx
// src/components/root-layout.tsx:6-18
export function RootLayout() {
	return (
		<ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
			<TooltipProvider>
				<div className="paperite-shell flex h-svh flex-col overflow-hidden bg-background">
					<AppTitlebar />
					<div className="min-h-0 flex-1 overflow-hidden">
						<Outlet />
					</div>
				</div>
			</TooltipProvider>
		</ThemeProvider>
	);
}
```

```tsx
// src/components/app-titlebar.tsx:118-131
const runPaperiteAction = (action: string) => {
	window.dispatchEvent(new Event(`paperite:${action}`));
};

const runFormat = (command: EditorFormatCommand) => {
	window.dispatchEvent(
		new CustomEvent("paperite:editor-format", {
			detail: { command },
		}),
	);
};

const toggleZenMode = () => {
	window.dispatchEvent(new Event("paperite:toggle-zen-mode"));
};
```

```tsx
// src/components/app-titlebar.tsx:141-164
<MenubarItem onSelect={() => runPaperiteAction("create-note")}>
	New Note
</MenubarItem>
<MenubarItem
	disabled={isInbox}
	onSelect={() => runPaperiteAction("create-folder")}
>
	New Folder
</MenubarItem>
...
<MenubarItem
	variant="destructive"
	onSelect={() => runAction("quit")}
>
	Quit
	<MenubarShortcut>Ctrl+Q</MenubarShortcut>
</MenubarItem>
```

```tsx
// src/routes/_main/index.tsx:564-607
useEffect(() => {
	const handleToggleZenMode = (event: CustomEvent<{ enabled?: boolean }>) => {
		if (event.detail?.enabled !== undefined) {
			setZenMode(event.detail.enabled);
		} else {
			setZenMode((current) => !current);
		}
	};

	const handleKeyDown = (event: KeyboardEvent) => {
		if (
			event.key.toLowerCase() === "f" &&
			event.ctrlKey &&
			event.shiftKey &&
			!event.metaKey &&
			!event.altKey
		) {
			event.preventDefault();
			window.dispatchEvent(new CustomEvent("paperite:toggle-zen-mode"));
			return;
		}

		if (event.key === "Escape") {
			window.dispatchEvent(
				new CustomEvent("paperite:toggle-zen-mode", {
					detail: { enabled: false },
				}),
			);
		}
	};

	window.addEventListener(
		"paperite:toggle-zen-mode",
		handleToggleZenMode as EventListener,
	);
	window.addEventListener("keydown", handleKeyDown);
	return () => {
		window.removeEventListener(
			"paperite:toggle-zen-mode",
			handleToggleZenMode as EventListener,
		);
		window.removeEventListener("keydown", handleKeyDown);
	};
}, []);
```

```tsx
// src/routes/_main/index.tsx:865-894
useEffect(() => {
	const handleTabSwitch = (event: KeyboardEvent) => {
		if (!event.ctrlKey || event.metaKey) return;

		if (
			event.altKey &&
			(event.key === "ArrowRight" || event.key === "ArrowLeft")
		) {
			event.preventDefault();
			switchTab(event.key === "ArrowRight" ? 1 : -1, "benchmark");
			return;
		}

		if (event.altKey) return;

		if (event.key === "Tab") {
			event.preventDefault();
			switchTab(event.shiftKey ? -1 : 1);
			return;
		}

		if (event.key.toLowerCase() === "w" && appState.activeNotePath) {
			event.preventDefault();
			closeTab(appState.activeNotePath);
		}
	};

	window.addEventListener("keydown", handleTabSwitch);
	return () => window.removeEventListener("keydown", handleTabSwitch);
}, [appState.activeNotePath, closeTab, switchTab]);
```

```tsx
// src/components/sidebar-hotkeys.tsx:7-31
useEffect(() => {
	const handleAltKeyDown = (event: KeyboardEvent) => {
		if (event.key.toLowerCase() !== "b" || !event.altKey) return;
		if (event.ctrlKey || event.metaKey || event.shiftKey) return;

		event.preventDefault();
		toggleSidebar();
	};

	const stopBoldShortcutFromTogglingSidebar = (event: KeyboardEvent) => {
		if (event.key.toLowerCase() !== "b") return;
		if (!event.ctrlKey && !event.metaKey) return;

		event.stopPropagation();
	};

	document.addEventListener("keydown", stopBoldShortcutFromTogglingSidebar);
	window.addEventListener("keydown", handleAltKeyDown);
	return () => {
		document.removeEventListener(
			"keydown",
			stopBoldShortcutFromTogglingSidebar,
		);
		window.removeEventListener("keydown", handleAltKeyDown);
	};
}, [toggleSidebar]);
```

```tsx
// src/components/ui/sidebar.tsx:94-108
React.useEffect(() => {
	const handleKeyDown = (event: KeyboardEvent) => {
		if (
			event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
			(event.metaKey || event.ctrlKey)
		) {
			event.preventDefault();
			toggleSidebar();
		}
	};

	window.addEventListener("keydown", handleKeyDown);
	return () => window.removeEventListener("keydown", handleKeyDown);
}, [toggleSidebar]);
```

Conventions to match:

- Package manager is Bun. Use `bun run lint` and `bun run build`; do not introduce npm scripts.
- TypeScript is strict; avoid `any`, unused locals, and unused parameters.
- UI uses shadcn components under `src/components/ui/`, Tailwind utility classes, and `@/` path aliases.
- Existing app events use `paperite:*` names. Keep that pattern where it avoids invasive prop threading.
- Do not manually edit `src/routeTree.gen.ts`; TanStack Router generates it.
- Do not run `bun start`, `bun run dev`, or any dev server command. The operator runs the dev server.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Lint | `bun run lint` | exit 0, Biome reports no errors |
| Build/typecheck | `bun run build` | exit 0; runs `tsc -b`, `vite build`, and `electron-builder` |
| Search old handlers | `rg 'Ctrl\+Shift\+F|Ctrl\+Tab|Alt\+B|SIDEBAR_KEYBOARD_SHORTCUT|window.addEventListener\("keydown"' src` | only intentional remaining matches; no duplicate app-level shortcut handlers for commands migrated in this plan |

## Scope

**In scope** (the only files you should modify, unless you hit a STOP condition):

- `src/lib/commands.ts` (create)
- `src/lib/shortcuts.ts` (create)
- `src/components/keyboard-shortcuts-provider.tsx` (create)
- `src/components/settings-dialog.tsx` or equivalent settings component if one already exists when you start (create if absent)
- `src/components/root-layout.tsx`
- `src/components/app-titlebar.tsx`
- `src/components/sidebar-hotkeys.tsx`
- `src/components/ui/sidebar.tsx`
- `src/routes/_main/index.tsx`
- `src/vite-env.d.ts`

**Out of scope** (do NOT touch, even though they look related):

- Workspace location moving, export/import, Google Drive sync, or Clerk account behavior.
- Note storage format in `main.js`.
- Electron IPC in `preload.js` unless the app already has a settings IPC by the time you start. Prefer renderer `localStorage` for shortcut overrides in this plan.
- TipTap's built-in text editing shortcuts for bold/italic/undo/redo/copy/paste. Display them if useful, but do not override them in the first pass.
- `src/routeTree.gen.ts`.

## Git workflow

- Branch suggestion: `advisor/001-customizable-keyboard-shortcuts`.
- Commit message style: conventional commits, matching recent history such as `feat: inbox view improvements` and `fix: force opacity 1 on dragged tab`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create command and shortcut primitives

Create `src/lib/commands.ts` with stable command IDs and metadata. Keep this file declarative; it should not import React or mutate state.

Use this shape:

```ts
export type CommandCategory = "General" | "Notes" | "Tabs" | "View" | "Window";

export type CommandId =
	| "settings.open"
	| "note.create"
	| "folder.create"
	| "note.setup"
	| "note.find"
	| "note.replace"
	| "tab.next"
	| "tab.previous"
	| "tab.close"
	| "view.toggleZen"
	| "view.toggleSidebar"
	| "window.quit";

export type CommandDefinition = {
	id: CommandId;
	label: string;
	category: CommandCategory;
	defaultShortcut: string | null;
	editable: boolean;
	description?: string;
};
```

Seed the registry with these defaults unless the live app already uses an equivalent shortcut:

| Command | Default shortcut | Notes |
|---|---|---|
| `settings.open` | `Mod+,` | standard desktop settings shortcut |
| `note.create` | `Mod+N` | creates in current open space, preserving existing behavior |
| `folder.create` | `Mod+Shift+N` | disabled/no-op in Inbox because folders are disabled there today |
| `note.setup` | `Mod+Shift+,` | opens existing note setup panel |
| `note.find` | `Mod+F` | opens existing find panel |
| `note.replace` | `Mod+Alt+F` | opens existing replace panel |
| `tab.next` | `Mod+Tab` | matches current tab switch behavior |
| `tab.previous` | `Mod+Shift+Tab` | matches current reverse tab switch behavior |
| `tab.close` | `Mod+W` | matches current close tab behavior |
| `view.toggleZen` | `Mod+Shift+F` | matches current zen shortcut |
| `view.toggleSidebar` | `Alt+B` | matches current `SidebarHotkeys` shortcut; do not use `Mod+B` because it conflicts with bold |
| `window.quit` | `Mod+Q` | menu currently displays `Ctrl+Q`; normalize to `Mod+Q` |

Create `src/lib/shortcuts.ts` for pure helper functions:

- `normalizeShortcut(event: KeyboardEvent): string | null`
- `formatShortcut(shortcut: string | null): string`
- `shortcutMatchesEvent(shortcut: string | null, event: KeyboardEvent): boolean`
- `isShortcutEditableInput(target: EventTarget | null): boolean`
- `resolveShortcut(command, overrides): string | null`
- `findShortcutConflict(commandId, nextShortcut, commands, overrides): CommandDefinition | null`

Normalization requirements:

- Normalize `Ctrl` on Linux/Windows and `Meta` on macOS-capable events to `Mod` for storage.
- Store modifiers in this order: `Mod`, `Ctrl`, `Alt`, `Shift`.
- Store key names as uppercase for letters (`K`), readable names for arrows (`ArrowLeft`), and symbols for punctuation where practical (`,`).
- Return `null` if the event only contains modifiers.
- Do not treat repeated keydown events as separate shortcuts; callers should ignore `event.repeat`.

Do not install `@tanstack/hotkeys` in this step. It is currently alpha/v0 and is not needed for this first, small registry.

**Verify**: `bun run lint` -> exit 0. If lint fails because files are incomplete, finish only the missing pieces in this step and rerun before continuing.

### Step 2: Add shortcut persistence and provider

Create `src/components/keyboard-shortcuts-provider.tsx`.

Responsibilities:

- Store overrides in `localStorage` under `paperite:shortcut-overrides`.
- Expose `shortcutOverrides`, `setShortcutOverride(commandId, shortcutOrNull)`, `resetShortcut(commandId)`, `resetAllShortcuts()`, and `getShortcut(commandId)` via React context.
- Listen for a `paperite:shortcut-overrides-changed` browser event so multiple windows/popouts can refresh if one changes settings.
- Keep provider renderer-only. Do not add IPC for this plan.

Update `src/components/root-layout.tsx` so `KeyboardShortcutsProvider` wraps the shell inside `TooltipProvider` or wraps `TooltipProvider`; either is fine as long as all app components can call the hook.

The provider must be resilient to invalid JSON in localStorage: catch parse errors and fall back to `{}`.

**Verify**: `bun run lint` -> exit 0.

### Step 3: Register app-level shortcut execution in the main route

In `src/routes/_main/index.tsx`, replace the local shortcut-specific `keydown` effects with one effect that uses command IDs and the shortcut context.

Keep the `paperite:toggle-zen-mode` event listener because the titlebar/menu still needs to update zen state and can dispatch that event. But remove direct hardcoded keyboard matching for `Ctrl+Shift+F`, `Ctrl+Tab`, `Ctrl+Shift+Tab`, `Ctrl+W`, and `Ctrl+Alt+ArrowLeft/Right` if those commands are now handled by the registry.

Create a local command runner in `Index` that maps command IDs to existing functions/state transitions:

- `note.create` -> `createNote(currentSpacePath)`
- `folder.create` -> `if (currentSpacePath !== "Inbox") createFolder(currentSpacePath)`
- `note.setup` -> `setFloatingPanelMode("format")`
- `note.find` -> `setFloatingPanelMode("find")`
- `note.replace` -> `setFloatingPanelMode("replace")`
- `tab.next` -> `switchTab(1)`
- `tab.previous` -> `switchTab(-1)`
- `tab.close` -> `if (appState.activeNotePath) closeTab(appState.activeNotePath)`
- `view.toggleZen` -> dispatch or directly run the existing zen toggle behavior
- `view.toggleSidebar` -> dispatch an event consumed by sidebar hotkey integration, or call `toggleSidebar` through `SidebarHotkeys` if the context is available there

Important keyboard rules:

- Ignore `event.repeat`.
- Do not run global shortcuts when the user is typing in an input, textarea, select, or contenteditable field, except commands that are intentionally editor-native. For this plan, app-level shortcuts should not hijack text fields.
- `Escape` may keep the current behavior of closing zen mode and floating panels; it does not need to be user-customizable in this plan.

If `note.find` using `Mod+F` conflicts with browser/Electron find behavior in the renderer, keep it because Paperite's note find panel is the intended app behavior.

**Verify**: `bun run lint` -> exit 0.

### Step 4: Remove duplicate sidebar shortcut handling

Update `src/components/ui/sidebar.tsx` to remove or disable the built-in `Ctrl/Cmd+B` shadcn sidebar shortcut effect. This app uses `Alt+B` for the sidebar because `Mod+B` belongs to bold text in the editor.

Update `src/components/sidebar-hotkeys.tsx` so it no longer owns hardcoded `Alt+B` matching if `view.toggleSidebar` is handled centrally. If the central effect cannot call `toggleSidebar` directly due provider placement, keep `SidebarHotkeys` as a bridge but make it read the configured `view.toggleSidebar` shortcut from the shortcut context instead of hardcoding `Alt+B`.

Keep the guard that prevents `Mod+B` from toggling the sidebar only if it is still necessary after removing the shadcn `Ctrl/Cmd+B` effect. If no sidebar code listens for `Mod+B`, remove the guard too.

**Verify**: `rg 'SIDEBAR_KEYBOARD_SHORTCUT|Alt\+B|ctrlKey \|\| event.metaKey' src/components/ui/sidebar.tsx src/components/sidebar-hotkeys.tsx` -> no stale built-in sidebar shortcut logic remains, except intentional display text or generic helper code.

### Step 5: Add Settings dialog with Keyboard Shortcuts page

Create `src/components/settings-dialog.tsx` unless a settings dialog already exists in the live code. Match the visual style shown in the current app: dark dialog, left rail sections, content panel, shadcn buttons/inputs where available.

Minimum settings sections for this plan:

- `General` containing the existing theme selector if you can reuse `useTheme` from `src/components/theme-provider.tsx`. If adding theme here becomes messy, keep General minimal and do not break theme behavior.
- `Keyboard Shortcuts` containing the customizable shortcut table.

Keyboard page requirements:

- Search input filters by command label, category, and shortcut text.
- Group commands by category.
- Each row shows command label, current shortcut pill, reset button, and disabled state when shortcut is `null`.
- Clicking a shortcut pill enters capture mode with text like `Press shortcut...`.
- Pressing `Escape` cancels capture.
- Pressing `Backspace` or `Delete` disables that command's shortcut by storing `null`.
- Pressing a valid shortcut stores it immediately.
- If another command already uses the shortcut, show a conflict message naming that command and offer `Replace` and `Cancel`.
- `Reset all` restores defaults by clearing overrides.
- Non-editable commands, if any are added, should display but not allow capture.

Persist only user overrides. Do not rewrite defaults into localStorage.

Expose opening settings with a browser event, for example `paperite:open-settings`, so menus and shortcuts can open it without prop drilling.

**Verify**: `bun run lint` -> exit 0.

### Step 6: Wire Settings into titlebar menu and shortcuts

Update `src/components/app-titlebar.tsx`:

- Add a Settings item to an appropriate menu, preferably `File` near app-level actions or a new app/menu section if the UI already has one.
- Settings item dispatches `paperite:open-settings`.
- Display shortcut text using `formatShortcut(getShortcut("settings.open"))` instead of hardcoded text.
- Replace hardcoded menu shortcut labels for migrated commands with resolved shortcut text. At minimum update Settings, New Note, New Folder, Note setup, Toggle Zen Mode, and Quit.
- Keep menu click behavior working even if the user disables the shortcut.

Mount the Settings dialog somewhere global, likely in `RootLayout`, so it can open regardless of route.

Ensure the central shortcut runner handles `settings.open` by opening this dialog.

**Verify**: `bun run lint` -> exit 0.

### Step 7: Extend types only as needed

If shortcut overrides are stored only in localStorage/context, `src/vite-env.d.ts` may not need changes. If you choose to store them in `PaperiteAppState`, add:

```ts
shortcutOverrides: Record<string, string | null>;
```

Then update `defaultAppState`, `normalizeAppState`, and `reconcileAppState` in `src/routes/_main/index.tsx` to preserve the field.

Preferred approach for this plan: localStorage/context, because shortcut preferences are app preferences and should not touch note workspace state yet.

**Verify**: `bun run lint` -> exit 0.

### Step 8: Final verification and manual QA handoff

Run the full verification gates:

```bash
bun run lint
bun run build
rg 'Ctrl\+Shift\+F|Ctrl\+Tab|Alt\+B|SIDEBAR_KEYBOARD_SHORTCUT|window.addEventListener\("keydown"' src
```

Expected results:

- `bun run lint` exits 0.
- `bun run build` exits 0.
- `rg` shows only intentional remaining keydown listeners: generic shortcut provider/runner code, input-specific Escape handling, and browser event listeners. It should not show duplicated hardcoded app-level shortcuts for commands migrated here.

Do not run `bun start`, `bun run dev`, or any dev server command. Ask the operator to manually test in the running app:

- Open Settings with menu and default `Mod+,`.
- Change `Create note` to a new shortcut and confirm the new shortcut creates a note in the current space.
- Disable `Toggle Zen Mode` and confirm the old shortcut no longer toggles zen mode.
- Assign a shortcut already used by another command and confirm conflict UI appears.
- Replace the conflict and confirm the old command loses the shortcut or receives `null` as designed.
- Confirm `Mod+B` still bolds text in the editor and does not toggle sidebar.

## Test plan

There is no existing test suite. Add focused unit tests only if the repo already has a test runner by the time this plan is executed. Do not introduce a new test framework just for this plan.

If a test runner exists, add tests for `src/lib/shortcuts.ts` covering:

- `Ctrl+N`/`Meta+N` normalize to `Mod+N`.
- Modifiers are sorted as `Mod+Alt+Shift+F`.
- Modifier-only events return `null`.
- `shortcutMatchesEvent("Mod+N", event)` works for Ctrl/Meta platform inputs.
- Conflict detection ignores the command currently being edited.
- `null` shortcuts never match events.

Verification without tests:

- `bun run lint` exits 0.
- `bun run build` exits 0.
- Manual QA checklist in Step 8 is passed by the operator.

## Done criteria

All must hold:

- [ ] `src/lib/commands.ts` contains a stable command registry with app-level commands and default shortcuts.
- [ ] `src/lib/shortcuts.ts` contains pure normalization/matching/conflict helpers.
- [ ] Shortcut overrides persist in localStorage and only store deviations from defaults.
- [ ] Settings has a Keyboard Shortcuts page with search, capture, disable, reset, reset-all, and conflict handling.
- [ ] Migrated shortcuts no longer have duplicate hardcoded `keydown` handlers.
- [ ] `Mod+B` remains available for editor bold and does not toggle the sidebar.
- [ ] `bun run lint` exits 0.
- [ ] `bun run build` exits 0.
- [ ] No files outside the in-scope list are modified, except generated files if the build creates ignored artifacts.
- [ ] `plans/README.md` status row for Plan 001 is updated.

## STOP conditions

Stop and report back instead of improvising if:

- The code at the locations in "Current state" does not match the excerpts and the correct integration point is unclear.
- A settings dialog already exists and has a conflicting architecture that would require rewriting it.
- Implementing shortcuts requires changing Electron IPC, `main.js`, or note storage.
- You cannot prevent shortcuts from firing while typing in editor/contenteditable fields.
- `Mod+B` cannot be preserved for editor bold without invasive TipTap changes.
- `bun run build` fails because of unrelated pre-existing packaging/signing problems after TypeScript and Vite succeed; report the exact failing phase instead of broadening the scope.

## Maintenance notes

- Future workspace settings, export/import, and Google Drive sync should use the Settings dialog added here, but they are deliberately out of scope for this plan.
- If Paperite later adds per-workspace preferences, decide whether shortcuts remain device-local or become workspace-synced. For now, localStorage is the safer desktop-app behavior.
- Reviewers should scrutinize duplicate shortcut execution, input/contenteditable guards, and conflict replacement behavior.
- Do not add `@tanstack/hotkeys` until there is a clear need for scoped/customizable behavior the small local registry cannot handle. It was alpha/v0 during planning.
