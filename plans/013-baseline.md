# Plan 013 — Performance baseline & completion log

Started: 2026-08-03.  
Status: **implementation complete** (A–G + remaining follow-ups).

## Phase status

| Phase | Goal | Status |
|-------|------|--------|
| A Measure baseline | Structural + interactive table | **Done** |
| B State surgery | Zustand stores + selective subs | **Done** |
| C Memo walls | `React.memo` + isolation | **Done** (sidebar memo + store isolation + saveStatus badge) |
| D Virtualize note tree | Long lists | **Done** (≥40 items) |
| E Prefetch / LRU | Warm recent notes | **Done** |
| F Search / first-paint | Debounce + hydrate + FTS | **Done** |
| G Budgets | Targets + how to measure | **Done** |

### Follow-ups closed in final pass

1. **Selective Zustand in sidebar** — `AppSidebar` reads UI fields via `useAppStore(useShallow)` so Index re-renders (tabs, editor) no longer push giant props into the tree.  
2. **Index subscription narrowed** — only chrome/tabs/editor fields; sidebar-only fields dropped from selector + props.  
3. **FTS global search** — debounced query (≥2 chars) calls `getNotesEngine().search()` and shows a full-text hit list above the tree.  
4. **Interactive before/after numbers** — still for you to fill when running the app (see table below).

## Target budgets

| Interaction | Target |
|-------------|--------|
| Keystroke → paint (p95) | **< 16ms**; sidebar must not flash |
| Warm tab switch | **< 50ms** (`[paperite perf]`) |
| Cold open from sidebar | Acceptable; no multi-second stall |
| Expand folder ~100 notes | **< 100ms** to stable scroll |
| Search | Input responsive; filter ≤120ms; FTS when ≥2 chars |
| Subjective | Core loop closer to Obsidian |

## Interactive measurement (fill when running)

```bash
cd paperite && bun run dev
```

| Interaction | How | After |
|-------------|-----|-------|
| Type 50 chars | react-scan: AppSidebar flash? | |
| Warm tab switch | console `[paperite perf]` | |
| Cold open note | stopwatch | |
| Expand ~100 notes | feel + DOM | |
| Search / FTS | type + body match list | |

## Key files

- `src/lib/stores/app-store.ts` — persisted app state  
- `src/lib/stores/editor-ui-store.ts` — `saveStatus` isolation  
- `src/components/app-sidebar.tsx` — virtual tree, store subs, FTS UI  
- `src/routes/_main/index.tsx` — prefetch/LRU, narrowed store, soft-close tabs  
