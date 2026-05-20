# Créer un tableau de bord

Créez un tableau de bord sous **Tableaux de bord → Create Dashboard**, donnez-lui un nom et ouvrez-le. Le canevas s'ouvre en mode **Edit**, prêt pour les widgets.

## Le canevas

Un tableau de bord est une grille. Le canevas par défaut fait **12 unités de tableau de bord de large** par **60 unités de haut** — vous pouvez augmenter la hauteur en ajoutant des rangées au-delà du bas. Chaque unité est un carré qui s'adapte à la fenêtre : sur un ordinateur de bureau, il est plus large que sur un téléphone, mais chaque widget garde ses proportions.

Les widgets occupent un rectangle d'unités. Vous décidez à la fois de la position (coin supérieur gauche, mesuré en unités depuis le coin supérieur gauche du canevas) et de la taille (largeur et hauteur en unités). Des dimensions minimales garantissent qu'un widget minuscule reste lisible.

## Edit vs. View

Le commutateur dans l'en-tête de la page bascule entre les deux modes :

- **Edit** — la palette de widgets est ouverte, les widgets sont déplaçables et redimensionnables, chaque widget a une roue dentée de paramètres. Utilisez-le pendant la construction.
- **View** — le tableau de bord se rend en lecture seule, exactement comme quelqu'un avec un accès en vue seule (ou un visiteur public) le voit. Utilisez-le pour vérifier le résultat avant de partager.

Le même tableau de bord est affiché dans les deux modes — il n'y a pas d'étape « publier » distincte. L'enregistrement d'une modification prend effet immédiatement pour chaque visualiseur.

## Ajouter un widget

1. Ouvrez la palette de widgets (le bouton **+** en mode Edit).
2. Choisissez le type de widget. Voir [Widgets](/docs/dashboards/widgets) pour le catalogue.
3. Le widget atterrit sur le canevas à la prochaine position libre avec une taille par défaut.
4. Cliquez sur la roue dentée du widget pour ouvrir son panneau de paramètres.
5. Configurez la source de données (requête de métrique, filtre de liste, corps texte, etc.) et toutes les options d'affichage (seuils, unités, axes, colonnes).
6. Glissez le widget pour le positionner. Glissez un coin pour le redimensionner.

Répétez. La grille aligne les widgets sur les limites d'unités entières.

## Configurer les sources de données

La plupart des widgets lisent depuis l'un des trois endroits :

- **Métriques** — une requête de métrique soutenue par ClickHouse. Le widget construit un `metricQueryConfig` (une seule série) ou des `metricQueryConfigs` (plusieurs séries empilées ou superposées). Un `transformAsRate` optionnel convertit un compteur cumulatif OpenTelemetry en taux de changement. Une `formula` optionnelle vous permet de combiner deux requêtes (par exemple, nombre d'erreurs / nombre total).
- **Listes de ressources en direct** — incidents, alertes, monitors, ressources Kubernetes, ressources Docker, hôtes. Chaque widget de liste prend un filtre (par exemple, étiquettes, statut, namespace) et affiche les rangées correspondantes en direct.
- **Contenu statique** — le widget **Text** prend un corps Markdown. Utilisez-le pour les en-têtes, séparateurs, liens vers les runbooks et annotations « qu'est-ce que ce tableau de bord ? ».

Pour les widgets de métrique, la configuration reflète le constructeur de requête en ligne que vous voyez ailleurs dans OneUptime — choisissez une métrique, choisissez une agrégation, ajoutez des filtres `WHERE`, choisissez un regroupement temporel. La requête s'exécute contre les données de télémétrie de votre projet.

## Seuils et formatage

Les widgets qui affichent un nombre unique (**Value**, **Gauge**) prennent des seuils optionnels :

- **Seuil d'avertissement** — affiche la valeur en jaune lorsqu'elle franchit ce seuil.
- **Seuil critique** — affiche la valeur en rouge lorsqu'elle franchit ce seuil.

Les graphiques vous laissent définir l'unité de l'axe Y, la position de la légende et s'il faut empiler les séries. Les tableaux vous laissent choisir les colonnes à afficher et la limite de rangées.

## Plage temporelle et rafraîchissement

L'en-tête du tableau de bord porte deux contrôles globaux qui affectent chaque widget de métrique :

- **Plage temporelle** — choisissez un préréglage (Dernière heure, 24 heures, 7 jours, 30 jours) ou une plage personnalisée. Chaque widget de métrique interroge contre cette fenêtre.
- **Intervalle de rafraîchissement** — Off, 5s, 10s, 30s, 1m, 5m, 15m. Re-exécute la requête de chaque widget à la cadence choisie. Les widgets de liste qui supportent nativement les websockets se mettent à jour à la diffusion indépendamment de l'intervalle choisi.

Pour les widgets qui ignorent la plage temporelle globale (par exemple, un bloc de texte), le contrôle est sans effet.

## Enregistrement

Le canevas s'enregistre automatiquement au fil de votre édition. Un petit indicateur dans l'en-tête vous dit quand la dernière modification est persistée. Il n'y a pas de « publier » — chaque modification est en direct au moment où elle s'enregistre. Si vous faites un changement risqué, dupliquez d'abord le tableau de bord.

## Motifs qui fonctionnent bien

- **Un sujet par tableau de bord.** Résistez à la tentation de mettre « tout ce que nous monitorons » sur une page. Trois tableaux de bord étiquetés `oncall-checkout`, `oncall-payments`, `oncall-search` vieillissent mieux qu'un méga-tableau de bord.
- **Ancrez le haut de la page avec le widget le plus important.** Les gens parcourent depuis le haut — assurez-vous que la première chose qu'ils voient est la réponse à « ce système est-il en bonne santé ? »
- **Utilisez des widgets Text pour étiqueter les sections.** Un court en-tête toutes les quelques rangées (« Latence » / « Erreurs » / « Capacité ») rend le tableau de bord parcourable depuis l'autre bout de la pièce.
- **Utilisez des variables au lieu de dupliquer.** Si vous vous retrouvez à construire le même tableau de bord deux fois pour deux services, vous voulez une variable `service`. Voir [Variables et filtres](/docs/dashboards/variables).

## Où lire ensuite

- [Widgets](/docs/dashboards/widgets) — le catalogue et la configuration par widget.
- [Variables et filtres](/docs/dashboards/variables) — templating avec variables, filtres d'attributs et plage temporelle.
- [Partage et tableaux de bord publics](/docs/dashboards/sharing) — rendre un tableau de bord accessible hors de l'équipe.
- [Configuration et permissions](/docs/dashboards/configuration) — propriété et contrôle d'accès.
