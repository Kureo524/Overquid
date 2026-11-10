# ADR 0013 — Lancer des applications depuis un plugin

Date : 2026-11-10 · Statut : proposé

## Contexte

Le plugin OBS doit pouvoir proposer de démarrer OBS, en arrière-plan, puis s'y connecter. Une iframe isolée ne peut rien
lancer (ADR 0003), et un « exécuter une commande » générique donnerait à un plugin tout ce que peut l'utilisateur.

## Décision

Le manifeste déclare les applications qu'un plugin peut démarrer, comme il déclare son réseau :
`"apps": ["com.obsproject.Studio"]`. La liste est affichée avant l'installation (« starts: … »).

- **Une application est nommée par son entrée de bureau**, pas par une commande : le cœur lit `Exec` dans le fichier
  `.desktop` de l'utilisateur. Le même nom vaut pour un paquet de distribution et un Flatpak, et un plugin ne peut pas
  viser un binaire arbitraire.
- `apps.launch` ajoute des **arguments** (16 au plus, courts) à cette commande. Rien ne passe par un shell que le plugin
  contrôle ; pour Hyprland chaque mot est mis entre apostrophes.
- `workspace` (Hyprland seulement) démarre l'application sur un espace de travail sans y aller, y compris un espace
  spécial caché (`special:obs`). Ailleurs l'option est ignorée.
- `apps.installed` dit si l'entrée existe, pour ne proposer le bouton que s'il sert.

## Conséquences

- Un plugin autorisé peut démarrer l'application déclarée autant de fois qu'il veut et avec les arguments de son choix :
  l'utilisateur fait confiance à ce couple plugin/application à l'installation.
- Pas de suivi du processus ni d'arrêt : le plugin parle ensuite à l'application par ses moyens officiels (pour OBS,
  obs-websocket, ADR 0011).
