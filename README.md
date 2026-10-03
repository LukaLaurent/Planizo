# Planizo

Plans de site industriels, calque par calque, 100 % dans le navigateur.
Les plans sont des fichiers `.json` stockés sur le poste de l'utilisateur : ils ne sont jamais envoyés à un serveur
(la Content-Security-Policy de `index.html` bloque toute connexion réseau).

## Modes
- **Nouveau plan / Modifier un plan** : édition (outils, calques, informations des éléments).
- **Consulter un plan** : lecture seule, calques à cocher, informations au survol des éléments. Quand le panneau est
  fermé, les calques restent accessibles par des boutons en bas à droite (option « Épingler les calques »).

Un fichier peut aussi être glissé directement sur « Consulter » ou « Modifier » depuis l'accueil.

## Liens vers un plan
En consultation, « Copier le lien » produit une adresse du type :
```
https://…/#mode=view&plan=<id>&file=Usine%20RDC.json&name=Usine%20RDC&layers=Antennes%20Wi-Fi|Imprimantes
```
- `layers` : calques masquables à cocher, séparés par `|` (absent = état enregistré dans le fichier).
- Un navigateur ne peut pas lire un chemin local (`C:\…`) depuis une page web : c'est une protection de sécurité.
  Le lien identifie donc le plan, et le fichier est retrouvé ainsi :
  - Chrome / Edge : Planizo mémorise l'accès aux fichiers déjà ouverts ou enregistrés (seulement l'autorisation, dans
    IndexedDB, jamais le contenu). Le lien rouvre le fichier directement ou après une confirmation.
  - Première ouverture, ou autre navigateur : le fichier est demandé une fois.
- Les paramètres sont après le `#` : ils ne sont jamais envoyés au serveur.

## Thème
Interrupteur soleil / lune dans la barre du haut. La feuille du plan reste blanche en mode sombre.

## Navigation
Molette : zoom · clic molette : déplacer la vue (les deux modes) · clic gauche : déplacer la vue en consultation,
ou dans une zone vide en édition · Espace + glisser : déplacer la vue avec n'importe quel outil · Ctrl+0 : ajuster à l'écran.

## Calques
- L'œil masque le calque dans l'éditeur.
- La case / l'épingle règle son comportement en consultation : masquable (case à cocher dans la liste) ou toujours affiché
  (absent de la liste, utile pour le fond de plan).
- Clic droit sur un calque : renommer, verrouiller, déplacer, supprimer.

## Enregistrement
Nouveau plan : le nom est demandé au premier enregistrement. Plan ouvert depuis un fichier : Chrome et Edge réécrivent
directement ce fichier (le navigateur demande l'autorisation la première fois) ; les autres navigateurs le retéléchargent
sous le même nom.

## Structure
```
index.html      page unique
favicon.svg     icône de l'onglet
css/style.css   styles
js/i18n.js      traductions FR / EN
js/app.js       logique
```

## Tester en local
Depuis le dossier : `python -m http.server 8000` puis ouvrir http://localhost:8000

## Publier sur GitHub Pages
Pousser le dossier à la racine du dépôt, puis Settings → Pages → Deploy from a branch → `main` / `root`.

## Format de fichier (v1)
```json
{
  "format": "site-plan",
  "version": 1,
  "sheet": { "width": 1600, "height": 1000 },
  "grid": true,
  "activeLayerId": "l...",
  "layers": [
    { "id": "l...", "name": "Calque 1", "visible": true, "locked": false, "objects": [ ... ] }
  ]
}
```
`layers[0]` est le calque du dessus. Types d'objets : `path` (crayon), `rect`, `ellipse`, `line`, `text`, `image`
(image embarquée en data URL base64). Champs optionnels : `id` et `name` (plan), `group` (objets groupés), `toggleable: false` sur un calque, `rotation` (degrés), `name` et `note` sur un objet.
Toutes les valeurs sont revérifiées à l'ouverture.

## Raccourcis (édition)
| Touche | Action |
|---|---|
| V P T R E L | Sélection, crayon, texte, rectangle, ellipse, ligne |
| Ctrl+clic | Ajouter / retirer un élément de la sélection |
| Ctrl+A | Tout sélectionner dans le calque actif |
| Ctrl+G / Ctrl+Maj+G | Grouper / dégrouper |
| Ctrl+C / Ctrl+X / Ctrl+V | Copier / couper / coller (clic droit dans le vide : coller ici) |
| Clic droit | Menu de l'élément (informations, calque, rotation, ordre, dupliquer, supprimer) |
| Double-clic | Modifier un texte, ou les informations d'un autre élément |
| I | Informations de l'élément sélectionné |
| [ / ] | Pivoter de 90° |
| Ctrl+D | Dupliquer |
| Suppr | Supprimer |
| Flèches (Maj ×10) | Déplacer |
| Ctrl+Z / Ctrl+Y | Annuler / rétablir |
| Ctrl+S | Enregistrer |
| Maj pendant un tracé | Carré, cercle, angle bloqué à 45°, rotation par pas de 15° |
