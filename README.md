# Pronostics Ligue 1 2026-2027 — Suivi Claude vs Réalité

Application web statique d'une seule page pour suivre et évaluer les pronostics d'un modèle (Claude) sur la saison de Ligue 1 2026-2027. Les pronostics sont figés avant chaque journée ; l'application permet de saisir les résultats réels, de mesurer l'écart, et de générer un récapitulatif structuré pour alimenter la conversation avec Claude.

---

## Fonctionnalités

- **Saisie des données réelles par match** : score, possession (%), xG, tirs et tirs cadrés (domicile et extérieur).
- **Navigation par journée** : onglets J1, J2… avec indicateur visuel lorsque tous les matchs d'une journée sont renseignés.
- **Analyse dépliable** : chaque match affiche un bloc d'analyse et les facteurs ayant guidé le pronostic, accessible via un bouton « Voir l'analyse ».
- **Comparaison prono / réel** : dès le score saisi, un panneau de verdict affiche le résultat du modèle (bon sens / score exact), les points obtenus, et le détail des statistiques saisies.
- **Tableau de bord** (en-tête) : pourcentage de bons résultats, nombre de scores exacts, total de points, erreur moyenne de différence de buts.
- **Bouton « Copier pour Claude »** : génère un récapitulatif texte structuré (toutes les journées, pronos vs réel, performance cumulée, calibration de confiance) et le copie dans le presse-papiers. Le texte inclut une demande explicite d'analyse et de pronostics pour la journée suivante.
- **Bouton de réinitialisation** (⟲) : efface toutes les données réelles saisies sans toucher aux pronostics.

---

## Système de notation

Chaque match est noté sur 5 points maximum :

| Critère | Points |
|---|---|
| Bon sens du résultat (victoire dom. / nul / victoire ext.) | +3 |
| Score exact (uniquement si le sens est aussi correct) | +2 |
| **Maximum par match** | **5** |

L'erreur de différence de buts (`|diff. pronos − diff. réelle|`) est également suivie en moyenne sur les matchs joués, ainsi que la calibration : confiance moyenne du modèle quand il a raison vs quand il se trompe. Ces deux indicateurs apparaissent dans le récapitulatif généré par « Copier pour Claude ».

---

## Utilisation

1. Après chaque journée, ouvrir la page et sélectionner la journée correspondante.
2. Renseigner les données réelles pour chaque match (le score suffit pour obtenir le verdict ; les autres statistiques sont optionnelles).
3. Cliquer sur **« Copier pour Claude »** : le texte structuré est copié dans le presse-papiers.
4. Coller ce texte dans la conversation Claude pour obtenir l'analyse des erreurs du modèle et les pronostics de la journée suivante.

---

## Stockage des données

Les données réelles saisies sont conservées dans le `localStorage` du navigateur (clé `l1-2627-real`). Elles sont donc propres à chaque appareil et navigateur : aucune synchronisation entre machines, aucun serveur impliqué. Les pronostics, eux, sont intégrés directement dans le code source de la page.

---

## Déploiement

Le site est hébergé via **GitHub Pages**, configuré en mode *Deploy from a branch* (branche `main`, dossier racine). Aucun outil de build, aucune dépendance npm : la page est un fichier HTML autonome.

---

> **Note.** Les pronostics sont volontairement immuables une fois une journée jouée. Ils ne doivent jamais être modifiés a posteriori afin de garantir une mesure objective et honnête de la performance du modèle sur la durée.
