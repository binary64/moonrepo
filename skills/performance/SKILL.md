---
name: performance
description: "Frontend performance rules adapted from Vercel's guide. Use when writing components, reviewing for performance, or optimising bundle size."
---

# Performance Rules

Prioritised by impact. These apply to client-side React with static export — no server runtime rules.

## CRITICAL — Eliminate Waterfalls

- **Defer await:** Move `await` into the branch where the result is actually used, not at the top of the function.
- **Parallel fetches:** Use `Promise.all()` for independent Apollo queries. Never chain sequential awaits for unrelated data.
- **Partial dependencies:** When query B depends on part of query A's result, start both early and await only where needed.

## CRITICAL — Bundle Size

- **No barrel files:** Import directly from source modules (`import { Button } from './Button'`), never from `index.ts` re-exports.
- **Dynamic imports:** Use `next/dynamic` for heavy components (charts, maps, editors, modals). Split at route boundaries.
- **Conditional loading:** Load feature modules only when the feature is activated, not at page load.
- **Preload on intent:** Use `<Link prefetch>` or preload on hover/focus for perceived speed.

## HIGH — Re-render Prevention

- **Don't subscribe to unused state:** If state is only used inside a callback, read it there via ref, don't subscribe the component.
- **Isolate expensive children:** Extract expensive subtrees into separate components first — React can skip re-rendering them when parent state changes. Use manual memoisation (`React.memo`) only when profiling confirms a bottleneck.
- **Primitive dependencies:** Use primitive values (not objects) as `useEffect` dependencies. Derive a boolean or string from complex state.
- **Derived state:** Subscribe to a derived boolean (`const isActive = status === 'active'`), not the raw object.
- **Functional setState:** `setItems(prev => [...prev, item])` — creates a stable callback identity, prevents child re-renders.
- **Lazy state init:** `useState(() => expensiveComputation())` — function form runs only on mount.
- **Transitions:** Wrap non-urgent updates in `startTransition` (search input, filters, tab switches).

## MEDIUM — Rendering

- **content-visibility:** Add `content-visibility: auto` on off-screen sections and long lists.
- **Hoist static JSX:** Extract JSX that doesn't depend on props/state outside the component function.
- **Conditional render:** Use ternary (`condition ? <A /> : <B />`), not `&&` — avoids rendering falsy values like `0`.
- **SVG precision:** Reduce SVG coordinate decimal places (2 is enough). Smaller DOM, faster paint.
- **Animate wrappers:** Animate a `<div>` wrapper around SVGs, not the SVG element itself.

## LOW — JavaScript Micro-optimizations

- Batch DOM/CSS changes via class toggles or `cssText`, not individual style mutations.
- Use `Map`/`Set` for repeated lookups (O(1) vs O(n) array scanning).
- Cache property access in loops — `const len = arr.length` before the loop.
- Combine `filter().map()` into a single `reduce()` or loop.
- Check `array.length` before expensive comparisons.
- Early return from functions — avoid deep nesting.
- Hoist `RegExp` creation outside loops.
- Use `toSorted()` for immutable sorting.
