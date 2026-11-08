# Plan projet — Overlay universel à plugins

Nov 8, 2026 · @Monnier kilian

## Vision & objectifs

Un overlay universel, activable par raccourci clavier par-dessus n'importe quelle application (jeu, navigateur, IDE, visio), dont le cœur ne fait presque rien : tout le contenu vient de plugins que n'importe quel utilisateur peut écrire et brancher sur l'app.

**Le concept.** Une coquille légère (fenêtre transparente, panneaux déplaçables, raccourci global) + un SDK public. Bloc-notes, musique, Discord, YouTube ou stats LoL ne sont pas « dans » l'app : ce sont des plugins comme les autres, livrés en exemples.

**Différenciation face à Overwolf et à la Xbox Game Bar.** Eux sont pensés pour le jeu ; ici, l'overlay sert autant au travail qu'en partie. Open source, sans pub, sans compte obligatoire, léger en RAM, et un SDK pensé pour qu'un dev crée un plugin en une soirée.

**Cas d'usage visés :**

- **Travail** : bloc-notes, to-do, minuteur Pomodoro, presse-papiers, musique, Discord ou Slack sans quitter son appli.
- **Jeu** : musique, vidéo, Discord, stats de partie, guides.
- **Étude / création** : notes rapides, références, lecteur vidéo pendant qu'on code ou qu'on dessine.

L'app ne connaît aucun de ces usages : chaque utilisateur compose son overlay avec ses plugins, et peut sauvegarder plusieurs dispositions (ex. « Taf » et « Jeu »).

**Objectifs, par ordre de priorité :**

1. Un repo GitHub vitrine : code propre, CI verte, docs claires, historique de PR lisible.
2. Un outil que tu utilises toi-même au quotidien, au taf comme en jeu.
3. Une version partageable à des potes, puis promouvable (installeur signé, mises à jour auto, catalogue de plugins).

**Hors périmètre au départ :** injection dans le rendu des jeux, macOS, monétisation.

## Choix techniques

Recommandation : **Tauri 2 (Rust + TypeScript/React)**, avec un overlay en fenêtre transparente toujours au premier plan, Linux d'abord (ta machine), Windows ensuite.

| Critère | Tauri 2 | Electron |
| --- | --- | --- |
| Mémoire au repos | Faible (WebView du système : WebKitGTK sous Linux, WebView2 sous Windows) | Élevée (Chromium embarqué) |
| Taille de l'installeur | Quelques Mo | Plus de 80 Mo |
| Sécurité / permissions | Système de capabilities fin, idéal pour isoler des plugins | À construire soi-même |
| Valeur sur un CV | Rust + web, stack moderne et recherchée | Très courante |
| Facilité | Courbe Rust, mais Claude code | Plus simple |

Les tailles et usages mémoire sont des ordres de grandeur, à mesurer sur le prototype.

**Technique d'overlay retenue : fenêtre transparente.**

- Fenêtre sans bordure, transparente, toujours au-dessus, qui laisse passer les clics quand l'overlay est masqué.
- Raccourci global (ex. `Alt+Shift+O`) pour afficher/masquer et capturer la souris.
- Fonctionne par-dessus toute application de bureau, et avec les jeux en plein écran fenêtré (mode par défaut de la plupart des jeux récents).
- Aucune injection de code dans le jeu : zéro risque côté anti-cheat.

**Spécificités Linux (cible n°1).** Sous X11, une fenêtre transparente toujours au-dessus fonctionne simplement. Sous Wayland, une app ne peut pas se mettre d'elle-même au premier plan : il faut passer par le protocole layer-shell, le même qu'utilisent les barres et widgets de bureau.

| Environnement | Overlay au-dessus de tout | Raccourci global |
| --- | --- | --- |
| X11 (tout bureau) | Oui | Oui |
| KDE Plasma (Wayland) | Oui, via layer-shell | Oui, via le portail de raccourcis ou un raccourci KDE |
| Hyprland, Sway, niri (Wayland) | Oui, via layer-shell | Raccourci défini dans la config du compositeur |
| GNOME (Wayland) | Incertain : layer-shell seulement expérimental dans les versions récentes | Raccourci GNOME personnalisé qui lance la commande de bascule |

Conséquences pour le code : le cœur détecte X11 ou Wayland au démarrage, expose une commande `overlay toggle` (CLI ou D-Bus) que n'importe quel raccourci du bureau peut appeler, et la phase 1 commence par un spike pour valider Tauri + layer-shell avant d'aller plus loin.

**Environnement de dev : Caelestia (Hyprland, Wayland).** C'est le cas le plus favorable : Hyprland gère layer-shell nativement. La bascule de l'overlay passera par un bind Hyprland qui appelle `overlay toggle`, à ajouter dans `~/.config/caelestia/hypr-user.conf` pour ne pas toucher aux dotfiles Caelestia. Les autres bureaux (KDE, GNOME, X11) seront testés en VM avant la v0.1.0.

Sources Caelestia : [wiki NixOS, Caelestia Shell](https://wiki.nixos.org/wiki/Caelestia_Shell) · [fedora-caelestia, config utilisateur Hyprland](https://github.com/AnshulVThomas/fedora-caelestia)

Sources : [Conky Studio, compatibilité Wayland](https://github.com/bobbycomet/Conky-Studio/wiki/Compatibility/6811eff5766cb78520f965a68b1e115439b07113) · [awob, GNOME et layer-shell](https://jmylchreest.github.io/awob/getting-started/gnome) · [Tauri, always on top sous Wayland](https://github.com/tauri-apps/tauri/issues/3117)

**Stack complète :**

- **Cœur** : Rust (fenêtres, raccourcis, chargement des plugins, stockage)
- **Interface** : React + TypeScript + Vite
- **Plugins** : TypeScript, publiés comme paquets npm ou dossiers locaux
- **Qualité** : ESLint, Prettier, `cargo clippy`, `rustfmt`, Vitest, Playwright
- **Monorepo** : pnpm workspaces

## Architecture

Le cœur ne fait que quatre choses : afficher l'overlay, gérer les panneaux, charger les plugins et arbitrer leurs permissions. Tout le reste passe par le SDK.

&#91;embedded content: architecture · plugins, SDK, cœur\]

Un plugin ne voit que le SDK ; seul le cœur Rust parle au système, ce qui permet d'ouvrir l'app à des plugins tiers sans risque pour l'utilisateur.

**Un plugin = un dossier avec un manifeste :**

```json
{
  "id": "com.exemple.notes",
  "name": "Bloc-notes",
  "version": "1.0.0",
  "entry": "dist/index.html",
  "panel": { "defaultSize": [360, 480], "resizable": true },
  "permissions": ["storage", "hotkeys"],
  "network": []
}
```

**Isolation.** Chaque plugin tourne dans son propre cadre web isolé, sans accès direct au système. Il ne parle au cœur que via le SDK, et chaque appel est vérifié contre les permissions de son manifeste.

**Ce que le SDK expose (les « hooks ») :**

| Domaine | Exemples d'API | Permission requise |
| --- | --- | --- |
| Cycle de vie | `onShow`, `onHide`, `onFocus`, `onResize` | Aucune |
| Stockage | `storage.get/set`, données propres au plugin | `storage` |
| Raccourcis | `hotkeys.register('Ctrl+Shift+N')` | `hotkeys` |
| Réseau | `fetch` limité aux domaines listés | `network: ["api.exemple.com"]` |
| Notifications | `notify({ title, body })` | `notifications` |
| Contexte | `context.onActiveAppChange` (savoir si on est en jeu, dans VS Code…) | `context` |
| Inter-plugins | `events.emit / on` entre plugins | `events` |
| Réglages | Page de paramètres générée depuis un schéma | Aucune |

**Dispositions (profils).** L'utilisateur sauvegarde des agencements de panneaux (« Taf », « Jeu ») et peut les lier à l'app au premier plan : ouvrir VS Code charge « Taf », lancer un jeu charge « Jeu ».

**Outillage dev.** Un `create-overlay-plugin` génère un plugin prêt à l'emploi, et un mode dev recharge le plugin à chaud dans l'overlay.

## Organisation GitHub pro

Règle d'or : rien n'arrive sur `main` sans Pull Request, CI verte et relecture.

**Structure du monorepo :**

```
overlay/
├─ apps/desktop/          # app Tauri (Rust + React)
├─ packages/sdk/          # SDK public des plugins (npm)
├─ packages/ui/           # composants partagés
├─ plugins/youtube/       # plugins d'exemple
├─ plugins/spotify/
├─ plugins/lol-stats/
├─ docs/                  # site de doc + guide « créer un plugin »
└─ .github/               # workflows, templates, CODEOWNERS
```

**Branches (main / dev / features) :**

- `main` : versions publiées uniquement, toujours stable. Ne reçoit que des PR venant de `dev`, une par release.
- `dev` : branche d'intégration, où arrive tout le travail en cours. C'est la branche par défaut du repo.
- `feat/…`, `fix/…`, `docs/…`, `chore/…` : créées depuis `dev`, une par issue, courte durée, mergées dans `dev` par PR.
- `hotfix/…` : exception pour un bug critique en production, créée depuis `main` puis mergée dans `main` et `dev`.
- Tags `v0.1.0`, `v0.2.0`… posés sur `main` à chaque release (SemVer).

```
feat/notes ──┐
fix/hotkey ──┼──► dev ──(PR de release)──► main ──► tag v0.2.0
docs/sdk ────┘
```

**Protections sur dev et `main` (ruleset GitHub) :**

- [ ] `main` et `dev` : PR obligatoire, pas de push direct (même pour toi)
- [ ] `main` et `dev` : checks CI requis (lint, tests, build) et conversations résolues
- [ ] `main` et `dev` : suppression et force-push interdits, commits signés
- [ ] `dev` : squash merge, pour un historique d'une ligne par fonctionnalité
- [ ] `main` : merge commit depuis `dev` uniquement, pour garder les deux branches alignées
- [ ] `main` : au moins 1 approbation

**Conventions :**

- Commits au format Conventional Commits (`feat(sdk): add storage API`), vérifiés par commitlint.
- Changelog et versions générés automatiquement (release-please).
- Templates d'issue (bug, feature, nouveau plugin) et de PR avec checklist.

**CI/CD (GitHub Actions) :**

- Sur chaque PR : lint, tests unitaires, `cargo clippy`, build Linux (puis Windows).
- Sur tag : build des paquets Linux (AppImage, .deb, puis Flatpak) et plus tard de l'installeur Windows signé, publication dans GitHub Releases.
- Dependabot + CodeQL pour la sécurité.

**Fichiers vitrine :** README avec GIF de démo et badges, `LICENSE` (MIT), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, GitHub Projects pour le tableau de bord.

Point pratique : seul sur le repo, tu ne peux pas approuver ta propre PR. Soit Claude relit en commentaire et tu gardes l'approbation à 0 pour toi, soit tu ajoutes un pote comme reviewer.

## Roadmap

Six phases, chacune fermée par une « porte » : on ne passe à la suivante que quand le critère est rempli.

&#91;embedded content: roadmap · 6 phases, 5 portes\]

La v0.1.0 (fin de phase 4) est déjà montrable sur GitHub ; la phase 5 sert surtout à la diffusion large.

## Workflow avec Claude

Tu joues le rôle de chef de projet et de reviewer ; Claude code, une issue à la fois, toujours via une PR.

1. **Tu ouvres une issue** claire : objectif, critères d'acceptation, hors périmètre.
2. **Claude crée la branche depuis dev**, code, écrit les tests et ouvre la PR liée à l'issue.
3. **La CI tourne** ; si elle échoue, Claude corrige sur la même branche.
4. **Tu relis et testes** en local, tu commentes, Claude ajuste.
5. **Squash merge** dans dev : l'issue se ferme, le changelog se met à jour tout seul.

**Release** : quand `dev` contient assez de fonctionnalités testées, Claude ouvre une PR `dev` → `main` ; une fois mergée, release-please pose le tag et publie l'installeur.

**Bonnes pratiques :**

- Un fichier `CLAUDE.md` à la racine : conventions, commandes, architecture. Claude le lit à chaque session.
- Des PR petites (une fonctionnalité, quelques centaines de lignes max) : plus faciles à relire, plus belles sur le profil.
- Demande toujours à Claude d'expliquer ses choix dans la description de PR : c'est ta doc d'architecture au fil de l'eau, et ça te fait progresser.
- Les décisions importantes (choix de lib, format du manifeste) vont dans `docs/adr/` (Architecture Decision Records).

## Risques & points de vigilance

Le risque principal n'est pas technique : c'est un plugin tiers qui fait faire à tes utilisateurs quelque chose d'interdit par un jeu ou un service.

| Risque | Impact | Parade |
| --- | --- | --- |
| Plugin malveillant (vol de tokens, keylogger) | Élevé | Sandbox + permissions déclarées, pas d'accès système direct, avertissement pour les plugins non vérifiés |
| Wayland : pas de fenêtre « toujours au-dessus » standard | Élevé | layer-shell sur KDE et compositeurs wlroots, repli X11/XWayland, spike de validation en début de phase 1 |
| GNOME Wayland mal supporté | Moyen | Documenter les bureaux compatibles, mode dégradé en fenêtre classique |
| Anti-cheat (Vanguard, EAC) | Élevé | Aucune injection ni lecture mémoire des jeux, jamais, même par un plugin |
| Overlay visible en partage d'écran (visio pro) | Moyen | Windows : exclusion de la capture ; Linux : pas d'équivalent fiable, donc bascule rapide par raccourci |
| Discord : pas d'API officielle pour un client complet | Moyen | Plugin = l'app web officielle de Discord dans un panneau, jamais un client modifié ou un self-bot |
| League of Legends ne tourne pas sous Linux (Vanguard) | Moyen | Plugin Stats LoL testable via l'API Riot, mais son usage en jeu attend le portage Windows |
| Règles Riot sur les applis tierces | Moyen | Plugin LoL limité aux infos autorisées (stats pré-partie, profils), clé API de production demandée avant diffusion |
| CGU YouTube | Moyen | Lecteur intégré officiel uniquement, pas de blocage de pubs ni d'extraction audio |
| Spotify | Faible | Contrôle du lecteur existant via l'API Web ; la lecture intégrée exige un compte Premium |
| Perte de performances | Moyen | Overlay inactif quand masqué, plugins suspendus en arrière-plan, budget mémoire mesuré en CI |
| Faux positif antivirus (Windows) | Moyen | Installeur signé (certificat de signature de code) |
| Abandon du projet | Moyen | Livrer une v0.1 utilisable vite, puis itérer |
