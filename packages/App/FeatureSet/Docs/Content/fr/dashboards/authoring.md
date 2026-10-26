# Créer un tableau de bord

Pour créer un tableau de bord, ouvrez **Produits → Tableaux de bord** et cliquez sur **Créer un tableau de bord**. La boîte de dialogue **Créer un tableau de bord** vous demande comment commencer, puis un nom. **Partir de zéro** vous donne un tableau de bord vide ; un modèle crée ses widgets, et souvent ses variables, pour vous, et remplit son nom (numéroté, comme « Kubernetes Dashboard 2 », quand le projet en a déjà un). Cliquez sur **Créer un tableau de bord** et le nouveau tableau de bord s'ouvre. Un tableau de bord vide s'ouvre sur son canevas, avec un bouton **Ajouter un widget** pour son premier widget.

:::cards
- [Créer le tableau de bord](#créer-le-tableau-de-bord): Partir de zéro ou d'un modèle.
- [Modifier et enregistrer](#modifier-et-enregistrer): Rien ne change pour personne avant que vous cliquiez sur Enregistrer les modifications.
- [Ajouter un widget](#ajouter-un-widget): Le choisir dans le catalogue, le configurer, le mettre en place.
- [Zoomer sur un pic](#zoomer-sur-un-pic): Faites glisser sur un graphique pour lire tout le tableau de bord à ce moment-là.
:::

## Avant de commencer

Les propriétaires et administrateurs du projet peuvent créer et modifier tous les tableaux de bord. Les autres ont besoin d'une autorisation d'équipe : `CreateDashboard` pour créer des tableaux de bord, et `EditDashboard` pour les modifier. Les membres et observateurs du projet peuvent lire les tableaux de bord sans l'une ni l'autre. Une personne qui ne peut pas modifier un tableau de bord ouvre quand même son menu **⋯**, où **Modifier le tableau de bord** est verrouillé et indique l'autorisation nécessaire.

## Créer le tableau de bord

:::steps
### Choisir comment commencer

Ouvrez **Produits → Tableaux de bord** et cliquez sur **Créer un tableau de bord**. La boîte de dialogue **Créer un tableau de bord** s'ouvre sur **Partir de zéro**, un tableau de bord vide pour vos propres widgets. En dessous, **Ou partir d'un modèle** affiche six modèles **Recommandés**.

### Choisir un modèle

Cliquez sur un modèle pour voir ce qu'il ajoute : ses widgets, nommés comme dans **Ajouter un widget**, et les variables avec lesquelles vous le restreignez dans sa barre d'outils. Pour les autres, choisissez une catégorie à côté du champ de recherche, ou **Tous les modèles**, ou tapez dans **Rechercher des modèles…** : chaque mot que vous tapez doit correspondre. Cliquez ensuite sur **Utiliser ce modèle**, ou double-cliquez sur le modèle. Dans le champ de recherche, les flèches choisissent un modèle et **Entrée** l'utilise.

### Nommer le tableau de bord

Le nom d'un modèle est rempli, numéroté au-delà des noms que le projet possède déjà. **Partir de zéro** le laisse vide : saisissez-en un. La description est facultative, repliée sous **Plus de champs**, et vous pouvez l'ajouter plus tard sur la page **Vue d'ensemble** du tableau de bord. **Retour** vous ramène aux modèles tels que vous les avez laissés.

### Le créer

Cliquez sur **Créer un tableau de bord**. Le nouveau tableau de bord s'ouvre : les widgets d'un modèle tout de suite, ou un canevas vide avec **Ajouter un widget** dessus.
:::

Les modèles, selon la catégorie sous laquelle le sélecteur les range :

| Catégorie | Modèles |
| --- | --- |
| Surveillance et APM | Monitor Dashboard, Metrics Dashboard, Real User Monitoring Dashboard, SLO Dashboard |
| Réponse aux incidents | Incident Dashboard, Alert Dashboard |
| Infrastructure | Kubernetes Dashboard, Kubernetes Cost Dashboard, Hosts Dashboard, Proxmox Dashboard, VMware Dashboard, Ceph Dashboard, Storage Array Dashboard, Docker Swarm Dashboard, Network Dashboard |

**Recommandés** contient Monitor Dashboard, Incident Dashboard, Alert Dashboard, Kubernetes Dashboard, Hosts Dashboard et Metrics Dashboard. Un modèle est un point de départ, pas un lien : une fois le tableau de bord créé, modifiez-le comme vous voulez. Le modèle ne le met plus à jour ensuite.

## Modifier et enregistrer

Un tableau de bord s'ouvre en mode lecture. Pour le modifier, ouvrez le menu **⋯** de sa barre d'outils et choisissez **Modifier le tableau de bord**. La barre d'outils affiche **Modification** à côté du nom et remplace la plage temporelle et ses autres contrôles par **Ajouter un widget**, **Variables**, **Annuler** et **Enregistrer les modifications**, avec en dessous une ligne pour la **Période par défaut** et l'**Actualisation automatique par défaut** du tableau de bord.

```mermaid title="De la lecture d'un tableau de bord à sa modification, et retour"
flowchart TB
    view["Lecture : le tableau<br/>de bord s'ouvre ici"] -->|"⋯ → Modifier le<br/>tableau de bord"| edit["Modification : ajouter,<br/>changer, déplacer et<br/>redimensionner"]
    edit -->|"Enregistrer les<br/>modifications"| saved["Tout le monde voit<br/>les modifications"]
    edit -->|"Annuler, puis Annuler<br/>les modifications"| dropped["Rien ne change"]
    saved --> back["Retour en lecture"]
    dropped --> back
```

Vos modifications ne concernent que vous tant que vous ne les enregistrez pas. Rien n'est enregistré pendant la modification, donc les autres continuent de voir le tableau de bord tel qu'il était.

- **Enregistrer les modifications** enregistre les widgets, leurs places et leurs tailles, les variables, ainsi que la période et l'actualisation automatique par défaut, tout à la fois, et revient en lecture. Si l'enregistrement est refusé, par exemple parce que vous avez perdu l'autorisation entre-temps, vous restez en modification avec vos changements, et la raison s'affiche au-dessus de la grille.
- **Annuler** demande d'abord, car cela jette vos modifications : **Annuler les modifications** revient au tableau de bord tel qu'il a été enregistré, et **Continuer la modification** vous ramène à votre travail.

Pendant la modification, l'actualisation automatique est en pause, et une plage temporelle zoomée revient à la plage que vous aviez choisie.

## Ajouter un widget

:::steps
### Ouvrir le catalogue des widgets

Cliquez sur **Ajouter un widget** : dans la barre d'outils pendant la modification, ou sur le canevas d'un tableau de bord vide. Le catalogue regroupe ses widgets selon ce qu'ils affichent. Tapez dans son champ de recherche pour en trouver un par son nom ou son usage ("error budget", "pods"), et appuyez sur Entrée pour ajouter le premier résultat.

### Choisir un widget

Cliquez dessus. Le widget se place au premier emplacement libre de la grille qui lui convient, et ses paramètres s'ouvrent.

### Définir ce qu'il affiche

La boîte de dialogue des paramètres affiche un **Aperçu en direct** du widget au-dessus de ses paramètres, et l'aperçu suit chacune de vos modifications. Choisissez ce que lit le widget (une requête de métriques, un filtre, un texte) et son apparence, puis cliquez sur **Terminé**.

### Le mettre en place

Faites glisser le widget pour le déplacer, et faites glisser ses bords ou ses coins pour le redimensionner. Voir [Les widgets sur la grille](#les-widgets-sur-la-grille).
:::

[Widgets de tableau de bord](/docs/dashboards/widgets) liste chaque widget et ses paramètres.

## Les widgets sur la grille

Le canevas est une grille de douze colonnes. Les widgets s'y alignent, et la page s'allonge vers le bas à mesure que vous ajoutez des lignes. Pendant que vous faites glisser un widget, un contour en pointillés montre où il va se poser, avec sa colonne et sa ligne ; pendant que vous en redimensionnez un, le contour montre sa taille en unités de grille. Les widgets gênants se décalent, si bien que deux widgets ne se chevauchent jamais.

Chaque type de widget a une taille minimale, pour que ce qu'il dessine reste lisible : un graphique fait au moins six colonnes de large et trois lignes de haut, tandis qu'un nombre seul tient dans une cellule.

Pour modifier un widget plus tard, cliquez dessus pendant la modification. Ses paramètres s'ouvrent à nouveau, avec deux boutons de plus en bas :

- **Dupliquer le widget** ajoute une copie, avec les mêmes paramètres, au premier emplacement libre.
- **Supprimer le widget** le retire, une fois que vous confirmez.

## Plage temporelle et actualisation automatique

En lecture, le sélecteur de plage temporelle de la barre d'outils fixe la fenêtre que lit chaque widget de graphique, de nombre, de journaux et de traces. Choisissez un préréglage, des 5 dernières minutes aux 3 derniers mois, ou un début et une fin personnalisés. Le tableau de bord s'ouvre sur sa période par défaut : la dernière heure, sauf si quelqu'un en choisit une autre en le modifiant.

Les listes d'incidents, d'alertes, de moniteurs et de ressources montrent leur état actuel, quelle que soit la plage temporelle.

À côté de la plage temporelle, le menu d'actualisation automatique relit chaque widget toutes les 5 secondes, 10 secondes, 30 secondes, 1 minute, 5 minutes ou 15 minutes, avec un compte à rebours jusqu'à la prochaine actualisation. Laissez-la désactivée pendant une enquête, pour que la vue reste immobile. Le tableau de bord s'ouvre avec son actualisation automatique par défaut : désactivée, sauf si quelqu'un en choisit une autre en le modifiant.

Le sélecteur de plage temporelle, les variables et l'actualisation automatique apparaissent dès que le tableau de bord a un widget.

### Les valeurs par défaut du tableau de bord

Pendant que vous modifiez le tableau de bord, la ligne sous les boutons de la barre d'outils fixe ce sur quoi tout le monde l'ouvre : **Période par défaut**, un préréglage des 5 dernières minutes aux 3 derniers mois, et **Actualisation automatique par défaut**. **Enregistrer les modifications** les enregistre avec le reste du tableau de bord, pour votre équipe comme pour les visiteurs de son lien public. Un début et une fin personnalisés ne peuvent pas servir de valeur par défaut : le tableau de bord resterait figé sur ce moment. La ligne apparaît dès que le tableau de bord a un widget.

Les tableaux de bord enregistrés avant ces réglages s'ouvrent sur la dernière heure, avec l'actualisation automatique qu'ils avaient. Par l'API et Terraform, les deux se trouvent dans le `dashboardViewConfig` du tableau de bord : `timeRange`, un préréglage écrit comme dans la référence de l'API, par exemple `Past 1 Day`, et `refreshInterval`, par exemple `1m`. Toute autre valeur est refusée.

### Vos propres choix

La plage temporelle et l'actualisation automatique que vous choisissez en lecture ne valent que pour vous, et votre navigateur s'en souvient pour chaque tableau de bord : un rechargement, un redémarrage du navigateur ou celui d'un écran mural rouvre le tableau de bord tel que vous l'avez laissé. Seul un préréglage est mémorisé. Une plage personnalisée ou un zoom dure jusqu'à ce que vous quittiez la page, pour que le tableau de bord ne reste jamais figé sur un moment passé.

Le premier choix de chaque sélecteur indique la valeur par défaut du tableau de bord, par exemple Par défaut (Past 1 Day). Choisissez-le pour revenir à la valeur par défaut : votre navigateur oublie votre choix, et le tableau de bord suit de nouveau sa valeur par défaut, même quand quelqu'un la change plus tard. Quand vous enregistrez vous-même de nouvelles valeurs par défaut, vous les voyez aussitôt.

### Zoomer sur un pic

Inutile de passer par le sélecteur de plage temporelle pour examiner un pic. Faites glisser sur le passage intéressant de n'importe quel graphique en lignes ou en aires, et **tout le tableau de bord** passe à cette fenêtre, exactement comme si vous l'aviez choisie dans le sélecteur de plage temporelle — chaque widget qui utilise la plage temporelle relance sa requête en même temps, si bien que vous lisez un même moment sur tout le tableau de bord plutôt qu'un graphique à une échelle différente de ses voisins. Les listes en direct continuent de montrer ce qui se passe maintenant, comme toujours.

**Double-cliquez sur n'importe quel graphique** pour annuler : le tableau de bord revient à la plage qu'il avait avant le zoom, quel que soit le nombre de fois où vous avez zoomé. Un bouton **Réinitialiser le zoom** apparaît à côté du sélecteur de plage temporelle tant qu'un zoom est actif, et un double-clic sur un tableau de bord non zoomé ne fait rien.

Une fenêtre zoomée est fixe : elle cesse donc d'avancer pendant l'actualisation automatique — c'est voulu, car une fenêtre qui se déroberait au milieu d'une enquête serait pire. Réinitialisez le zoom pour qu'elle avance de nouveau.

Le zoom ne fonctionne qu'en lecture ; en modification, faire glisser déplace et redimensionne les widgets. Les graphiques en barres zooment de la même façon — faites glisser sur les barres — et un double-clic sur l'un d'eux réinitialise le tableau de bord comme n'importe quel autre graphique. Seul un glissement zoome : un simple clic sur un graphique ne change jamais la plage du tableau de bord. Les mêmes gestes fonctionnent sur les graphiques de tout OneUptime ; voir [Zoomer sur une plage temporelle](/docs/telemetry/charts-and-time-ranges).

## Plein écran

**⋯ → Plein écran** affiche les widgets du tableau de bord sur tout l'écran, pour un affichage mural ou une réunion. Appuyez sur Échap pour en sortir.

## Conseils pour des tableaux de bord qui vieillissent bien

- **Un sujet par tableau de bord.** Quelques tableaux de bord ciblés valent mieux qu'une page de tout ce que vous surveillez.
- **Placez le widget le plus important en haut.** On lit de haut en bas : faites que la première chose vue réponde à « est-ce que tout va bien ? »
- **Nommez les sections avec des widgets Texte.** Un court titre toutes les quelques lignes (« Latence », « Erreurs », « Capacité ») rend la page facile à parcourir, même de l'autre bout de la pièce.
- **Des variables plutôt que des copies.** Si vous êtes sur le point de créer le même tableau de bord pour un deuxième service, ajoutez plutôt une variable `service`. Voir [Variables et filtres de tableau de bord](/docs/dashboards/variables).
- **Copiez avant un gros changement.** **Dupliquer : Tableau de bord**, sur la page **Paramètres** du tableau de bord, crée une copie sûre pour essayer vos idées.

## Prochaines étapes

:::cards
- [Widgets de tableau de bord](/docs/dashboards/widgets): Chaque widget, ses paramètres, et lequel choisir.
- [Variables et filtres de tableau de bord](/docs/dashboards/variables): Un tableau de bord pour chaque service, hôte ou client.
- [Partage et tableaux de bord publics](/docs/dashboards/sharing): Partager le tableau de bord hors de votre équipe.
- [Configuration et permissions des tableaux de bord](/docs/dashboards/configuration): Propriétaires, étiquettes, archivage et qui peut faire quoi.
:::
