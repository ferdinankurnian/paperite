// Deprecated shim — the contract moved to `./sync-provider` (plan 018).
// This module re-exports the full public surface so out-of-scope call sites
// (e.g. app-sidebar join picker) keep working untouched. New code must
// import from `@/lib/sync-provider` directly. Nothing in `src/` may import
// `convex/_generated` except `sync-provider.ts`.
export * from "./sync-provider";
