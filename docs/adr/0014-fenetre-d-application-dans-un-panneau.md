# ADR 0014 — Montrer la fenêtre d'une application dans un panneau

Date : 2026-11-10 · Statut : proposé

## Contexte

Le plugin OBS doit rendre OBS utilisable depuis son panneau. OBS est une application native : pas de version web à
afficher (ADR 0004), et Wayland ne permet pas d'intégrer la fenêtre d'un autre programme dans la nôtre. Une image de la
scène (obs-websocket) se regarde mais ne se manipule pas.

## Décision

La fenêtre reste celle de l'application ; on la **place sous l'overlay**, à l'endroit du panneau, et l'overlay s'ouvre à
cet endroit.

- `apps.dock(app, rect)` : un plugin donne une zone de sa page, qu'il laisse vide. Limité aux applications de son
  manifeste (ADR 0013).
- **Le cœur demande au compositeur** (Hyprland) de rendre la fenêtre flottante, de l'amener sur l'espace de travail
  courant, à la taille et à la position de la zone, sans lui donner le focus. `rect = null`, panneau masqué ou overlay
  fermé : elle repart sur son espace de travail caché.
- **L'interface découpe** (`clip-path`) tout ce que l'overlay dessine derrière la zone : voile, panneaux plus bas, verre
  du panneau lui-même. Les panneaux devant ne sont pas découpés : ils recouvrent la fenêtre comme n'importe quel panneau.
- **La zone est retirée de la région de saisie** de l'overlay, moins les panneaux devant : les clics vont à la fenêtre.
- Tant qu'une fenêtre est montrée, l'overlay ne garde plus le clavier en exclusivité : il va à ce qu'on clique.

## Conséquences

- **Hyprland seulement.** Ailleurs `apps.dock` échoue et le plugin garde ses contrôles.
- La fenêtre garde sa taille minimale : dans un panneau trop petit elle dépasse, visible à travers le voile.
- Pendant qu'une fenêtre est montrée, Échap et les raccourcis de l'overlay ne répondent que si l'overlay a le clavier ;
  le raccourci global, lui, marche toujours.
- La fenêtre est choisie par sa classe, égale au nom de l'entrée de bureau : une application à plusieurs fenêtres
  n'est pas gérée.
