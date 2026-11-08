# CLAUDE.md

Guide for Claude Code sessions on this repo. Read it before any change.

## Project

Overquid is a universal desktop overlay toggled by a global hotkey, on top of any app. The core does
almost nothing; every feature (notes, music, Discord, stats…) is a plugin built on a public SDK.
Full plan and roadmap: `docs/PLAN.md`. Visual direction: `docs/design/encre.md`.

Current phase: **0 — repo foundations**. There is no app code yet; do not start phase 1 work unless an issue asks for it.

## Stack

- Core: Rust + Tauri 2 (`apps/desktop`, from phase 1). Linux first (Hyprland/Wayland via layer-shell), Windows later.
- UI: React + TypeScript + Vite.
- SDK: TypeScript (`packages/sdk`), published to npm as `@overquid/sdk`.
- Monorepo: pnpm workspaces (`apps/*`, `packages/*`, `plugins/*`).
- Quality: ESLint (flat config, typescript-eslint strict), Prettier, Vitest, `cargo clippy`, `rustfmt`.
- TypeScript is pinned to 5.x: typescript-eslint does not support TS 7 yet.

## Commands

```sh
pnpm install        # also installs the commitlint git hook (husky)
pnpm lint           # eslint + prettier --check
pnpm format         # prettier --write
pnpm typecheck      # tsc --noEmit in every package
pnpm test           # vitest in every package
pnpm build          # build every package
```

Run `pnpm lint && pnpm typecheck && pnpm test` before pushing.

## Workflow

1. One issue = one branch, created from `dev`: `feat/…`, `fix/…`, `docs/…`, `chore/…`, `ci/…`.
2. Commits and PR titles follow Conventional Commits (`feat(sdk): add storage API`), checked by commitlint.
   Scopes: `core`, `desktop`, `sdk`, `ui`, `plugins`, `docs`, `ci`, `deps`, `repo`, `release`.
3. Open the PR against `dev`, link the issue (`Closes #N`), and explain the design choices in the description.
4. Fix CI failures on the same branch. PRs are squash-merged into `dev`, so the PR title is the final commit message.
5. Releases: a PR `dev` → `main` (merge commit). `hotfix/…` branches start from `main` and merge into `main` and `dev`.

Never push directly to `main` or `dev` (rulesets block it), never force-push them.
Keep PRs small (a few hundred lines). Structural decisions get an ADR in `docs/adr/`.

## Architecture rules

- Plugins only see the SDK. Only the Rust core talks to the OS; every SDK call is checked against the plugin manifest's permissions.
- Each plugin runs in its own isolated web frame.
- Never inject into, or read the memory of, a game or any other process — not in the core, not in an example plugin.
- Third-party services through official means only (Discord web app in a panel, official YouTube embed, Riot API, Spotify Web API).

## Repo map

```
apps/desktop/      Tauri app (phase 1)
packages/sdk/      public plugin SDK
packages/ui/       shared components (later)
plugins/           example plugins (later)
docs/              plan, design direction, ADRs
.github/           CI, CodeQL, Dependabot, issue/PR templates, CODEOWNERS
```
