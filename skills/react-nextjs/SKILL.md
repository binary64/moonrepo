---
name: react-nextjs
description: "React 19 + Next.js 16 App Router patterns for apps/app/. Use when building components, pages, or modifying frontend code."
---

# React 19 + Next.js 16

Use when working in `apps/app/`.

## Stack

- **Next.js 16** with App Router — React Compiler is ON (`reactCompiler: true` in next.config.ts)
- **React 19** — use Actions, `useActionState`, `useOptimistic`, `useTransition`, `use()`
- **TypeScript 5** strict mode — no `any`, use `unknown` + type guards
- **Biome 2.2** for linting and formatting — NOT ESLint or Prettier
- **Moon** task runner — `moon run :dev`, `moon run :build`, `moon run :lint`, `moon run :type-check`
- **Bun** package manager

## Rules

### Components
- Server Components by default. Add `'use client'` only when you need hooks, event handlers, or browser APIs.
- React Compiler handles memoization — do NOT manually add `React.memo`, `useMemo`, or `useCallback` unless profiling proves a bottleneck. The compiler does this better.
- Co-locate files: `Component.tsx`, `Component.test.tsx`, `Component.module.css` in the same directory.
- Export components as named exports, never default exports — except Next.js route files (`page.tsx`, `layout.tsx`, `route.tsx`, `loading.tsx`, `error.tsx`, etc.) which require default exports.
- Props get a TypeScript interface — `interface ButtonProps { ... }`, not inline types.

### Imports
- Import directly from source modules. **Never use barrel files** (index.ts re-exports) — they defeat tree shaking and bloat bundles.
- Use `next/dynamic` for heavy components (charts, editors, maps) — code split at the route level.

### Data Fetching
- Client-side fetching via Apollo Client (GraphQL). No SWR, no React Query.
- Use `cache-first` for static reference data, `cache-and-network` for user-specific data.
- Colocate GraphQL operations with the components that use them.
- Use `TypedDocumentNode` for end-to-end type safety.

### Patterns
- Prefer composition over prop drilling — use React context sparingly, pass components as children.
- Use `startTransition` for non-urgent updates (search, filtering).
- Functional `setState` for callbacks: `setCount(prev => prev + 1)`, not `setCount(count + 1)`.
- Ternary for conditional rendering (`condition ? <A /> : <B />`), not `&&` (avoids rendering `0` or `""`).
- Extract static JSX outside components — prevents unnecessary re-creation on re-render.

### Accessibility
- WCAG 2.1 AA minimum — semantic HTML, ARIA where needed, keyboard navigation.
- Every interactive element must be focusable and have an accessible label.
- Test with axe-core.
