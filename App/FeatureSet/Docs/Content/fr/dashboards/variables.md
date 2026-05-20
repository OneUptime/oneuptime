# Variables et filtres

Une variable transforme un tableau de bord unique en template. Définissez une variable `service` et le même graphique se rerend pour `checkout`, `payments` et `search` — choisissez dans une liste déroulante en haut au lieu de construire trois tableaux de bord presque identiques.

Cette page couvre les quatre types de variables, comment leurs valeurs sont injectées dans les requêtes de widgets, et les contrôles globaux de plage temporelle et de rafraîchissement qui se trouvent à côté d'eux.

## Types de variables

Ajoutez des variables sous **Tableau de bord → Settings → Variables**. Chacune a un nom (référencée comme `{{name}}` dans les requêtes de widgets), une étiquette optionnelle et un type.

### Liste personnalisée

Une liste déroulante statique. Vous fournissez une liste de valeurs séparées par des virgules ; le visualiseur en choisit une.

À utiliser quand : l'ensemble de choix est petit, fixe et significatif uniquement pour votre équipe. `environment` avec les valeurs `prod, staging, dev`. `region` avec les valeurs `us-east-1, eu-west-1, ap-south-1`.

### Requête

Les options de la liste déroulante sont calculées par une requête ClickHouse au moment du rendu.

À utiliser quand : les choix sont dynamiques et vivent dans votre télémétrie. « Chaque ID client qui s'est connecté dans les dernières 24 heures » via `SELECT DISTINCT customer_id FROM ...`. La requête s'exécute contre les données de votre projet ; traitez le résultat comme une entrée non fiable même si ce sont vos propres données.

### Saisie de texte

Un champ de texte libre. Ce que le visualiseur tape est injecté.

À utiliser quand : vous voulez que le tableau de bord agisse comme un outil de recherche. Un tableau de bord « filtrer par IP » ou « filtrer par ID de requête ».

### Attribut de télémétrie

Les options sont les valeurs distinctes d'une clé d'attribut OpenTelemetry à travers la télémétrie de votre projet, sur la plage temporelle du tableau de bord.

Configurez la **clé d'attribut** (par exemple, `k8s.cluster.name`, `service.name`, `host.name`). Le widget récupère les valeurs distinctes depuis les journaux / métriques / traces et les offre en liste déroulante.

À utiliser quand : les choix sont exactement les entités avec lesquelles vous avez déjà étiqueté votre télémétrie. Nom de cluster, nom de service, région, ID client, environnement de déploiement — tout ce que vous envoyez déjà comme attribut de ressource ou de span OpenTelemetry.

C'est le type de variable le plus courant pour les tableaux de bord orientés services parce qu'il se met à jour automatiquement : lorsque vous déployez un nouveau service étiqueté `service.name = inventory`, cette valeur apparaît dans la liste déroulante sans que personne ne modifie le tableau de bord.

## Sélection multiple

Chaque variable peut être configurée en **sélection multiple**. Quand activée, le visualiseur choisit une ou plusieurs valeurs ; le tableau de bord filtre vers `value IN (...)` au lieu de `value = ...`.

Utilisez la sélection multiple quand : vous voulez regarder « checkout + payments ensemble » sans quitter le tableau de bord. Évitez-la quand les mathématiques du graphique ne s'additionnent pas à travers les valeurs sélectionnées — par exemple, la moyenne des moyennes.

## Valeurs par défaut

Chaque variable prend une valeur par défaut optionnelle. Le tableau de bord se rend avec la valeur par défaut jusqu'à ce que le visualiseur change la liste déroulante. Pour les tableaux de bord publics, la valeur par défaut est ce sur quoi les visiteurs atterrissent.

## Comment fonctionne l'interpolation

Partout où une requête de widget prend un filtre de chaîne — la clause `WHERE` d'une requête de métrique, le filtre d'un widget de liste, la correspondance d'attribut d'un flux de journaux — vous pouvez référencer `{{variable_name}}`.

Par exemple, la requête de métrique d'un Chart pourrait être :

```
SELECT avg(latency_ms) FROM spans WHERE service.name = '{{service}}'
```

Quand `service` est défini à `checkout`, la requête s'exécute avec `service.name = 'checkout'`. Quand le visualiseur bascule vers `payments`, la requête se ré-exécute avec `service.name = 'payments'`.

Pour les variables **Attribut de télémétrie** spécifiquement, OneUptime connaît la clé d'attribut et injecte le filtre dans chaque widget qui mentionne le même attribut — vous n'avez pas à modifier à la main la requête de chaque widget quand la variable change. C'est la magie qui fait que les tableaux de bord templatés par service fonctionnent dès l'installation.

## Plage temporelle

L'en-tête du tableau de bord a un sélecteur global de **plage temporelle**. Chaque widget de métrique interroge contre cette fenêtre. Choix :

- **Préréglages** — Dernière heure, 24 heures, 7 jours, 30 jours, 90 jours (selon votre rétention).
- **Plage personnalisée** — choisissez les horodatages de début et de fin.

La plage temporelle fait partie de l'URL du tableau de bord — partager l'URL partage la fenêtre. C'est pratique pendant un incident : épinglez la plage temporelle à « 10:00–10:30 UTC aujourd'hui » et partagez le lien dans le canal de l'incident.

## Intervalle de rafraîchissement

À côté de la plage temporelle, choisissez à quelle fréquence les widgets re-interrogent :

- **Off** — les widgets interrogent une fois au chargement.
- **5s / 10s / 30s / 1m / 5m / 15m** — rafraîchissement automatique.

Le rafraîchissement automatique est pratique pour un écran mural et une vue d'incident actuel. Pour une enquête ad hoc, laissez-le désactivé afin que la vue reste stable pendant que vous faites défiler.

## Tout mettre ensemble

Un tableau de bord templaté par service a typiquement :

1. Une variable `service` de type **Attribut de télémétrie** liée à `service.name`. Par défaut : votre service le plus surveillé. Sélection multiple : désactivée (pour que les graphiques montrent toujours un service à la fois).
2. Une variable `environment` de type **Liste personnalisée**. Par défaut : `prod`.
3. Une variable `cluster` de type **Attribut de télémétrie** liée à `k8s.cluster.name`. Sélection multiple : activée (pour que vous puissiez consolider à travers les clusters).
4. Les widgets du tableau de bord référencent ces variables dans leurs filtres.

Le résultat : un tableau de bord, la couverture de toute la flotte, quelques listes déroulantes en haut.

## Où lire ensuite

- [Widgets](/docs/dashboards/widgets) — comment chaque widget consomme un filtre.
- [Partage et tableaux de bord publics](/docs/dashboards/sharing) — variables dans les URL, y compris leurs valeurs pour les liens partagés.
- [Créer un tableau de bord](/docs/dashboards/authoring) — la mécanique du canevas.
