# Création d'un tableau de bord

Pour créer un tableau de bord, ouvrez **Dashboards → Create Dashboard**, donnez-lui un nom et ouvrez-le. Le canevas s'ouvre en mode **Edit**, prêt à recevoir vos premiers widgets.

## Le canevas

Un tableau de bord est une grille. Les widgets s'y placent — vous décidez où chacun se trouve et quelle taille il occupe. Vous pouvez agrandir la page vers le bas à mesure que vous ajoutez des lignes. Chaque widget conserve ses proportions sur les grands comme sur les petits écrans.

## Edit et View

L'interrupteur dans l'en-tête bascule entre deux modes :

- **Edit** — la palette des widgets est ouverte, vous pouvez glisser les widgets, les redimensionner et cliquer sur n'importe quel widget pour modifier ses paramètres.
- **View** — le tableau de bord est en lecture seule, exactement tel que le voient les visiteurs et les autres membres de l'équipe. Utilisez ce mode pour vérifier le résultat avant de partager.

C'est le même tableau de bord dans les deux modes. Il n'y a pas d'étape « publier » distincte — chaque modification est en ligne dès qu'elle est enregistrée.

## Ajouter un widget

1. Cliquez sur le bouton **+** pour ouvrir la palette des widgets.
2. Choisissez le type de widget. Voir [Widgets](/docs/dashboards/widgets) pour le catalogue.
3. Le widget apparaît sur le canevas.
4. Cliquez sur l'icône d'engrenage du widget pour ouvrir ses paramètres.
5. Choisissez la source de données (une métrique, un filtre de liste, un paragraphe de texte, etc.) et toutes les options d'affichage.
6. Glissez le widget pour le déplacer. Glissez un coin pour le redimensionner.

## D'où viennent les données

La plupart des widgets lisent à partir de l'une de trois sources :

- **Métriques** — choisissez une métrique et une agrégation (moyenne, max, comptage, percentile). Ajoutez des filtres. Choisissez comment regrouper le résultat. C'est le même constructeur de requêtes que vous retrouvez ailleurs dans OneUptime.
- **Listes en direct** — incidents, alertes, monitors, pods Kubernetes, conteneurs Docker, hôtes. Chaque widget de liste prend un filtre et affiche les éléments correspondants, mis à jour en direct.
- **Contenu statique** — le widget **Text** accepte un bloc de Markdown. Utilisez-le pour des titres, du contexte, des liens vers des runbooks ou des notes temporaires lors d'un incident.

## Seuils et mise en forme

Les widgets à valeur unique (**Value**, **Gauge**) vous permettent de définir :

- Un **seuil d'avertissement** — la couleur passe au jaune quand la valeur le franchit.
- Un **seuil critique** — la couleur passe au rouge quand la valeur le franchit.

Les graphiques vous permettent de définir l'unité de l'axe Y, de choisir l'emplacement de la légende et de décider si les séries s'empilent les unes sur les autres ou se superposent. Les tableaux vous permettent de choisir les colonnes à afficher et le nombre de lignes.

## Plage temporelle et actualisation

En haut du tableau de bord, deux contrôles affectent chaque widget de métrique :

- **Plage temporelle** — un préréglage (dernière heure, 24 heures, 7 jours, 30 jours) ou une plage personnalisée. Chaque graphique et chaque nombre utilise cette fenêtre.
- **Actualisation** — la fréquence à laquelle les widgets relancent leur requête. Désactivée, 5 s, 10 s, 30 s, 1 min, 5 min, 15 min. Les listes en direct se mettent à jour d'elles-mêmes indépendamment de ce paramètre.

Les widgets qui n'utilisent pas la plage temporelle (comme un widget Text) ignorent les deux contrôles.

## Enregistrement

Le canevas s'enregistre tout seul au fil de votre travail. Un petit indicateur dans l'en-tête vous indique quand la dernière modification est sauvegardée. Si vous prévoyez un changement important, dupliquez d'abord le tableau de bord pour disposer d'une copie de sauvegarde.

## Conseils pour des tableaux de bord qui vieillissent bien

- **Un sujet par tableau de bord.** Résistez à la tentation de mettre « tout ce qu'on monitore » sur une seule page. Quelques tableaux de bord ciblés valent mieux qu'une page géante.
- **Placez le widget le plus important en haut.** Les gens parcourent du haut vers le bas — faites en sorte que la première chose qu'ils voient réponde à la question « est-ce que ce système est en bonne santé ? ».
- **Étiquetez les sections avec des widgets Text.** Un court titre toutes les quelques lignes (« Latence », « Erreurs », « Capacité ») rend la page lisible depuis l'autre bout de la pièce.
- **Utilisez des variables plutôt que de dupliquer.** Si vous êtes sur le point de construire le même tableau de bord pour un second service, construisez plutôt un tableau de bord avec une variable `service`. Voir [Variables et filtres](/docs/dashboards/variables).

## Pour aller plus loin

- [Widgets](/docs/dashboards/widgets) — le catalogue.
- [Variables et filtres](/docs/dashboards/variables) — variables, filtres et plage temporelle.
- [Partage et tableaux de bord publics](/docs/dashboards/sharing) — partager au-delà de votre équipe.
- [Configuration et permissions](/docs/dashboards/configuration) — propriétaires et contrôle d'accès.
