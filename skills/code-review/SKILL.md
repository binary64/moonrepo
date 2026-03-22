---
name: code-review
description: "Pre-merge checklist and PR standards. Use when reviewing code, preparing commits, or before marking a task as done."
---

# Code Review Checklist

Run through this before every commit and PR.

## TypeScript

- [ ] No `any` types — use `unknown` with type guards or proper generics.
- [ ] All components have a named `Props` interface (e.g. `interface ButtonProps`).
- [ ] No type assertions (`as`) unless justified with a comment explaining why.
- [ ] Strict mode passes: `moon run :type-check`

## Code Quality

- [ ] No `console.log` in production code — use structured logging or remove.
- [ ] No barrel file re-exports (`index.ts` that just re-exports) — import from source.
- [ ] No hardcoded URLs, API endpoints, or secrets — use environment variables.
- [ ] No commented-out code — delete it, git has history.
- [ ] Biome passes: `moon run :lint`

## React / Next.js

- [ ] No manual `React.memo`, `useMemo`, `useCallback` unless profiling justifies it (React Compiler handles this).
- [ ] Server Components by default — `'use client'` only where required.
- [ ] Named exports, not default exports — except Next.js route files (`page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `template.tsx`, `not-found.tsx`, `default.tsx`) which require default exports.
- [ ] Dynamic imports for heavy components (`next/dynamic`).
- [ ] Accessible: semantic HTML, ARIA labels on interactive elements, keyboard navigable.

## Kubernetes / Infrastructure

- [ ] Resource `requests` and `limits` set on all containers.
- [ ] `namespace` explicitly specified in manifests.
- [ ] ArgoCD Application has `sync-wave` annotation.
- [ ] HTTPRoute has correct `parentRefs` (gateway in `istio-system`); include `sectionName` only when targeting a specific listener.
- [ ] No plaintext secrets — SealedSecrets only.
- [ ] Container images pinned to specific tag or digest, never `latest`.

## Git

- [ ] Conventional commit message: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`
- [ ] One logical change per commit — don't bundle unrelated changes.
- [ ] PR description explains what and why, not just what changed.
- [ ] CI passes before requesting review.
