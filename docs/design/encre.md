# Direction artistique « Encre »

> Dérivée de « Verre d'encre » (Forge Studio), version sobre pour Overquid.
> On garde l'essence (verre translucide, liseré de lumière, un seul accent froid, formes souples),
> on retire tout l'imaginaire stellaire : pas de ciel, pas d'étoiles, pas de constellation, pas de ton « roman ».
> Ce document est autonome : il suffit pour reproduire la DA sans autre source.

## 1. L'idée en une phrase

Des **panneaux de verre fumé** posés sur une **encre sombre bleu-noir**, comme une goutte d'encre
sur une vitre : froid, calme, mat. Un outil qu'on oublie, pas une vitrine.

Contexte propre à Overquid : les panneaux flottent **par-dessus n'importe quelle application** (jeu, IDE, visio).
Le « fond » est souvent le bureau de l'utilisateur, pas un décor qu'on maîtrise. Le verre doit donc rester lisible
sur du blanc comme sur du noir, et rien ne doit attirer l'œil hors du contenu.

## 2. Principes non négociables

1. **Un seul thème, sombre.** Pas de thème clair.
2. **Un seul accent : bleu encre `#8fa4cc`.** Rouge, ambre et vert sont **réservés aux états**, jamais à la décoration.
3. **Aucun accent secondaire.** La lavande et le vert décoratifs de la version d'origine disparaissent ; le vert ne sert plus qu'au succès.
4. **Le verre = fond fumé + liseré clair en haut et à gauche** (lumière du haut-gauche). Bords bas/droite plus discrets.
5. **Formes souples** : grands rayons, boutons quasi-capsules, rien d'anguleux.
6. **Une seule lumière qui suit le curseur**, très faible, visible uniquement sur le verre survolé.
7. **Catégories plutôt que longue page** : contrôle segmenté pour découper un contenu dense.
8. **Immobile par défaut.** Aucun élément de fond animé. Le mouvement ne répond qu'à une action.

### Interdits

- Pas de glow ni d'ombre lumineuse colorée.
- Pas de dégradé décoratif sur boutons ou cartes.
- Pas de carte à bordure latérale colorée (exception : 3px de couleur d'état sur une statistique).
- Pas de petites capitales espacées (tracked caps), pas de letter-spacing.
- Pas d'emoji en guise d'icônes.
- Pas d'étoiles, de particules, de bruit animé ou de fond « ambiance ».

## 3. Couleurs (jetons)

Toutes les teintes claires translucides partent du **même blanc froid `rgb(230, 234, 242)`** à opacité variable ;
toutes les teintes sombres partent de **l'encre `rgb(11, 12, 17)`**. C'est ce qui fait la cohérence.

| Jeton              | Valeur                                     | Usage                                                                    |
| ------------------ | ------------------------------------------ | ------------------------------------------------------------------------ |
| `--ink`            | `#0b0c11`                                  | Encre de base (fenêtres opaques : réglages, installeur)                  |
| `--veil`           | `rgba(11, 12, 17, 0.38)`                   | Voile posé sur le bureau quand l'overlay est actif (optionnel, réglable) |
| `--glass`          | `rgba(20, 22, 30, 0.72)`                   | Verre léger : barres, en-têtes, segmenté                                 |
| `--surface`        | `rgba(16, 18, 25, 0.84)`                   | Verre plein : panneaux de plugin, cartes, sections                       |
| `--surface-raised` | `rgba(230, 234, 242, 0.06)`                | Boutons, éléments surélevés                                              |
| `--hover`          | `rgba(230, 234, 242, 0.05)`                | Survol des lignes                                                        |
| `--border`         | `rgba(230, 234, 242, 0.08)`                | Bordure par défaut                                                       |
| `--border-strong`  | `rgba(230, 234, 242, 0.15)`                | Bordure au survol, boutons                                               |
| `--rim`            | `rgba(230, 234, 242, 0.20)`                | Liseré de lumière (haut + gauche)                                        |
| `--input`          | `rgba(11, 12, 17, 0.70)` (focus `0.85`)    | Champs de saisie                                                         |
| `--canvas`         | `rgba(11, 12, 17, 0.80)`                   | Zones de travail (éditeur, lecteur vidéo, graphe)                        |
| `--text`           | `#e6eaf2`                                  | Texte principal                                                          |
| `--text-2`         | `#a2a6b4`                                  | Libellés, texte secondaire                                               |
| `--text-3`         | `#868a98`                                  | Aides, méta, placeholders                                                |
| `--accent`         | `#8fa4cc`                                  | Accent unique : focus, sélection, remplissage                            |
| `--accent-hover`   | `#a3b6da`                                  |                                                                          |
| `--accent-soft`    | `rgba(143, 164, 204, 0.14)`                | Fond d'élément sélectionné / actif                                       |
| `--accent-text`    | `#adbfe0`                                  | Texte accentué (lien, titre survolé)                                     |
| `--accent-tint`    | `rgba(143, 164, 204, 0.42)` (hover `0.55`) | Bouton principal (verre teinté)                                          |
| `--success`        | `#93b07e` / soft `rgba(147,176,126,0.13)`  | État OK                                                                  |
| `--warning`        | `#d9aa3a` / soft `rgba(217,170,58,0.12)`   | État alerte                                                              |
| `--danger`         | `#d9646c` / soft `rgba(217,100,108,0.13)`  | État erreur                                                              |

Différences avec la version d'origine : opacités du verre **remontées** (0.42→0.72, 0.62→0.84) parce que le verre
recouvre des contenus arbitraires ; accent **désaturé** (bleu étoile → bleu encre) ; lavande supprimée ;
états légèrement assourdis.

### Graphiques

Palette catégorielle sombre, ordre fixe, 8 séries max (au-delà → « Autres ») :
`#3987e5 #d95926 #199e70 #c98500 #d55181 #008300 #9085e9 #e66767`

- Neutre : `rgb(140, 140, 135)` · Grille `rgba(255,255,255,0.07)` · Axes `rgba(255,255,255,0.22)`
- Statuts (jamais pour des séries) : `#0ca30c`, `#fab219`, `#d03b3b`
- Fond de tracé `--canvas`, rayon 14, libellés d'axes en mono.

## 4. Typographie (licence OFL)

| Rôle           | Police                            | Usage                                                  |
| -------------- | --------------------------------- | ------------------------------------------------------ |
| Texte courant  | **Gothic A1** Regular 12px        | corps, libellés, champs, menus                         |
| Titres         | **Gothic A1** Bold                | titre de panneau 13px, titre de fiche 17px             |
| Grands nombres | **Barlow Condensed** SemiBold     | stats 26px (compact 18px), minuteurs                   |
| Données        | **IBM Plex Mono** Regular 10–12px | statuts, raccourcis clavier, valeurs alignées, chemins |

Tailles : 10 / 11 / 12 / 13 / 15 / 17px. Pas de capitales forcées.

Statuts et messages courts : mono, `--text-2`, **sans crochets** (`Raccourci enregistré`, `Alt+Shift+O`).
Les polices sont **embarquées dans l'app** (pas de Google Fonts au runtime : l'overlay doit marcher hors ligne).

## 5. Le verre

```css
.glass {
  overflow: hidden;
  border: 1px solid var(--border);
  border-top-color: var(--rim);
  border-left-color: var(--rim);
  background: var(--surface);
  border-radius: 18px;
  backdrop-filter: blur(20px) saturate(1.1);
}
```

- Deux épaisseurs : **verre léger** (`--glass`) pour la structure, **verre plein** (`--surface`) pour le contenu.
- Le flou d'arrière-plan est souhaitable (il rend le verre lisible sur un jeu chargé) mais le rendu doit **tenir sans** :
  WebKitGTK peut le désactiver ou le rendre coûteux. D'où les opacités élevées.
- Menus et tooltips : verre quasi opaque `rgba(16,18,25,0.96)`, bordure `--border-strong` + liseré.
- Panneaux espacés de 12px.
- Une ombre portée **neutre et douce** est autorisée sur les panneaux flottants pour les détacher du bureau :
  `0 8px 32px rgba(0,0,0,0.35)`. Jamais colorée.

### Reflet du curseur

- Un **unique** halo blanc 320×320px : `radial-gradient(circle, rgba(255,255,255,.06) 0%, transparent 70%)`.
- Inséré dans le verre le plus imbriqué sous le curseur, derrière le contenu, découpé par `overflow: hidden`.
- Opacité 0 → 1 en 0.25s, disparaît quand le curseur quitte le verre, `pointer-events: none`.

## 6. Le fond : l'encre

Plus de ciel. Deux cas :

- **Overlay actif** : la fenêtre est transparente ; on peut poser `--veil` sur tout l'écran pour assombrir le bureau
  et faire ressortir les panneaux. Uniforme, sans dégradé ni motif. Désactivable dans les réglages.
- **Fenêtres opaques** (réglages, catalogue de plugins) : fond `--ink` uni. Option unique d'ambiance :
  **une seule tache d'encre diffuse**, statique, en haut à gauche — `radial-gradient(ellipse at 15% 10%, rgba(143,164,204,0.06), transparent 55%)`.
  Elle doit être à peine perceptible ; si on la remarque, elle est trop forte.

## 7. Rayons

| Rayon | Éléments                                     |
| ----- | -------------------------------------------- |
| 3     | poignée de défilement                        |
| 6–8   | badges, items de menu                        |
| 10    | boutons, champs, éléments de segmenté        |
| 12    | lignes de liste, navigation, messages d'état |
| 14    | groupe segmenté, tooltip, graphe             |
| 16    | barre d'actions flottante                    |
| 18    | panneaux de plugin, cartes, sections         |
| 22    | grandes fenêtres (réglages, catalogue)       |

## 8. Composants

**Panneau de plugin** — verre plein rayon 18. Barre de titre en verre léger (hauteur 32) : icône 16px, nom 12px bold,
actions à droite (épingler, réduire, fermer) en boutons fantômes 24px. La barre sert de poignée de déplacement.

**Boutons** — hauteur 28, padding 0 14px, rayon 10.

- Normal : `--surface-raised`, bordure `--border-strong` + liseré ; survol `rgba(230,234,242,0.10)`.
- Principal : verre teinté `--accent-tint`, bordure `rgba(255,255,255,0.28)`, texte `#fff`. Jamais d'aplat saturé.
- Fantôme : sans fond ni bordure, `--text-2`, survol `--hover`.

**Champs** — hauteur 26, rayon 10, `--input`, bordure `--border` ; focus : bordure `--accent`, pas d'anneau lumineux.

**Segmenté** — groupe verre léger rayon 14, padding 3 ; item actif `--accent-soft` + texte `--text`.

**Raccourci clavier** — touches en mono 11px, pastille `--surface-raised` rayon 6, bordure `--border`.

**Badges** — fond `*-soft`, point 6px de couleur d'état, texte neutre 10px bold, rayon 8.

**Messages d'état** — rayon 12, fond `*-soft`, bordure couleur d'état à 30 %.

**Statistiques** — titre 11px `--text-2`, valeur Barlow Condensed 26px.

## 9. Mouvement

- Survols : 0.12s sur bordure/fond.
- Ouverture de l'overlay : fondu 0.14s + `scale(0.985 → 1)` ; fermeture 0.10s. Rapide : on bascule souvent.
- Segmenté : 0.28s `ease-out`.
- Barres et jauges : grandissent à l'ouverture, 0.4s `ease-out-cubic`.
- `prefers-reduced-motion` : tout passe en fondu simple.

## 10. Démarrage rapide (CSS)

```css
:root {
  color-scheme: dark;
  --ink: #0b0c11;
  --veil: rgba(11, 12, 17, 0.38);
  --glass: rgba(20, 22, 30, 0.72);
  --surface: rgba(16, 18, 25, 0.84);
  --surface-raised: rgba(230, 234, 242, 0.06);
  --hover: rgba(230, 234, 242, 0.05);
  --border: rgba(230, 234, 242, 0.08);
  --border-strong: rgba(230, 234, 242, 0.15);
  --rim: rgba(230, 234, 242, 0.2);
  --input: rgba(11, 12, 17, 0.7);
  --canvas: rgba(11, 12, 17, 0.8);
  --text: #e6eaf2;
  --text-2: #a2a6b4;
  --text-3: #868a98;
  --accent: #8fa4cc;
  --accent-hover: #a3b6da;
  --accent-soft: rgba(143, 164, 204, 0.14);
  --accent-text: #adbfe0;
  --accent-tint: rgba(143, 164, 204, 0.42);
  --success: #93b07e;
  --warning: #d9aa3a;
  --danger: #d9646c;
  --font: 'Gothic A1', sans-serif;
  --font-num: 'Barlow Condensed', sans-serif;
  --font-mono: 'IBM Plex Mono', monospace;
}
body {
  margin: 0;
  background: transparent;
  color: var(--text);
  font: 12px/1.5 var(--font);
}
.glass {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border);
  border-top-color: var(--rim);
  border-left-color: var(--rim);
  background: var(--surface);
  border-radius: 18px;
  backdrop-filter: blur(20px) saturate(1.1);
}
.glass--light {
  background: var(--glass);
}
.btn {
  height: 28px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid var(--border-strong);
  border-top-color: var(--rim);
  border-left-color: var(--rim);
  background: var(--surface-raised);
  color: var(--text);
  transition:
    background-color 0.12s,
    border-color 0.12s;
}
.btn:hover {
  background: rgba(230, 234, 242, 0.1);
}
.btn--primary {
  background: var(--accent-tint);
  border-color: rgba(255, 255, 255, 0.28);
  color: #fff;
}
.btn--primary:hover {
  background: rgba(143, 164, 204, 0.55);
}
.input {
  height: 26px;
  padding: 2px 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--input);
  color: var(--text);
  transition: border-color 0.12s;
}
.input:focus {
  outline: none;
  border-color: var(--accent);
  background: rgba(11, 12, 17, 0.85);
}
.mono {
  font-family: var(--font-mono);
  color: var(--text-2);
}
```

## 11. Checklist avant de livrer une UI

- [ ] Lisible posé sur un fond blanc **et** sur un fond noir (tester sur un navigateur clair et sur un jeu sombre).
- [ ] Chaque panneau a son liseré haut/gauche.
- [ ] Une seule couleur d'accent ; rouge/ambre/vert uniquement pour des états.
- [ ] Aucun élément décoratif animé ; aucune étoile, particule ou motif de fond.
- [ ] Rayons pris dans l'échelle (3/6/8/10/12/14/16/18/22).
- [ ] Trois polices aux bons rôles, embarquées.
- [ ] Aucun glow, dégradé décoratif, bordure latérale décorative ni tracked caps.
- [ ] Contenu dense découpé en catégories.
- [ ] `prefers-reduced-motion` respecté.
