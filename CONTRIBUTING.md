# Contributing

Thanks for your interest in Overquid.

## Branches

- `dev` is the default branch: all work lands here.
- `main` only receives releases, through a PR from `dev`.
- Create your branch from `dev`: `feat/…`, `fix/…`, `docs/…`, `chore/…`, `ci/…`. Critical production fixes use `hotfix/…` from `main`.

## Commits and PR titles

[Conventional Commits](https://www.conventionalcommits.org): `type(scope): subject`, e.g. `fix(desktop): release mouse on hide`.
`pnpm install` sets up a git hook that checks your commit messages. PRs are squash-merged, so the **PR title** becomes
the commit on `dev` and is checked by CI too.

## Pull requests

1. Open an issue first (or pick an existing one).
2. Keep the PR small and focused; link the issue with `Closes #N`.
3. Explain what you changed and why. Fill in the checklist.
4. CI must pass (lint, typecheck, tests, build) and every conversation must be resolved before merging.

## Local checks

```sh
pnpm lint
pnpm typecheck
pnpm test
```

## Plugins

Plugins must never inject into or read the memory of another process, and must respect the terms of service of the
services they use.
