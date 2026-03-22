---
name: testing
description: "TDD workflow and testing patterns. Use when writing tests, implementing features, or reviewing test coverage."
---

# Testing

## Workflow: Red → Green → Refactor

1. **Write the test first.** Describe the expected behaviour.
2. **Run it — watch it fail** (red). If it passes, the test is wrong or the feature already exists.
3. **Write the minimum code** to make the test pass (green).
4. **Refactor** while keeping tests green. Commit.
5. Repeat for the next behaviour.

Never write implementation code before a failing test exists for it.

## Tools

- **React Testing Library** for component tests — test behaviour, not implementation details.
- **Biome** for static analysis (`moon run :lint`) — not ESLint.
- **TypeScript strict** for type checking (`moon run :type-check`).
- No snapshot tests unless explicitly requested — they're brittle and rarely catch real bugs.

## File Organisation

- Co-locate test files: `Button.tsx` → `Button.test.tsx` in the same directory.
- Test utilities and fixtures in `src/__tests__/helpers/`.
- Mock data factories in `src/__tests__/factories/`.

## What to Test

- **Components:** Renders correctly, responds to user interaction, displays correct state.
- **Hooks:** Return values, state transitions, side effects.
- **Data fetching:** Mock Apollo Client, test loading/error/success states.
- **Utilities:** Pure functions with edge cases.

## What NOT to Test

- Implementation details (internal state names, private methods).
- Third-party library internals (Apollo, Next.js routing).
- CSS styling (unless it's logic-dependent).
- Trivial components with no logic (a `<div>` wrapper).

## Patterns

- Query by accessible role first (`getByRole`), then `getByLabelText`, then `getByText`. Never `getByTestId` unless no semantic alternative exists.
- Use `userEvent` over `fireEvent` — it simulates real user interaction (focus, hover, click sequence).
- Mock Apollo queries with `MockedProvider` — define exact query + variables + response.
- Test error boundaries — verify fallback UI renders on query failure.
- Async assertions: `await screen.findByText(...)` for data that loads asynchronously.
