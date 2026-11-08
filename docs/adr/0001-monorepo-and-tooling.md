# ADR 0001 — Monorepo pnpm et outillage qualité

Date : 2026-11-08 · Statut : accepté

## Contexte

Le projet réunit une app Tauri, un SDK publié sur npm, des composants partagés et des plugins d'exemple qui
dépendent du SDK. Il faut pouvoir les faire évoluer ensemble, dans une seule PR, avec une CI unique.

## Décision

- **pnpm workspaces** (`apps/*`, `packages/*`, `plugins/*`) : liens locaux entre paquets, installation stricte, lockfile unique.
- **ESLint 10 (flat config) + typescript-eslint strict + Prettier** ; Prettier gère la forme, ESLint le fond.
- **TypeScript 5.x**, épinglé : typescript-eslint ne supporte pas encore TypeScript 7.
- **Vitest** pour les tests unitaires.
- **commitlint (config conventionnelle)** sur les messages de commit (hook husky) et sur le titre des PR en CI,
  puisque les PR sont squash-mergées et que leur titre devient le commit sur `dev`.
- Job CI **Rust** présent dès la phase 0 mais inactif tant qu'il n'y a pas de `Cargo.toml`, pour que la liste des
  checks requis par les rulesets reste stable.

## Conséquences

- Pas d'outil d'orchestration (Turborepo, Nx) pour l'instant : `pnpm -r` suffit à cette taille. À revoir si la CI dépasse quelques minutes.
- Passage à TypeScript 7 conditionné au support de typescript-eslint.
