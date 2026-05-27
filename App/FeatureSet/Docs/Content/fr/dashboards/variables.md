# Variables et filtres

Une variable transforme un tableau de bord unique en modèle. Ajoutez une variable `service` à votre tableau de bord et les mêmes graphiques se réaffichent pour `checkout`, `payments` ou `search` — les visiteurs choisissent depuis une liste déroulante en haut au lieu que vous construisiez trois tableaux de bord presque identiques.

## Types de variables

Ajoutez des variables sous **Dashboard → Settings → Variables**. Chaque variable a un nom (utilisé sous la forme `{{name}}` dans vos widgets), une étiquette optionnelle et un type.

### Custom List

Une liste déroulante statique. Vous saisissez les options vous-même.

À utiliser quand : les choix sont peu nombreux et fixes. `environment` avec les valeurs `prod, staging, dev`. `region` avec les valeurs `us-east-1, eu-west-1, ap-south-1`.

### Query

Les options proviennent d'une requête sur vos données.

À utiliser quand : les choix évoluent dans le temps et vous voulez que la liste déroulante reste à jour. « Tous les identifiants de clients vus dans les dernières 24 heures. » La requête s'exécute sur les données de votre projet et les résultats deviennent la liste déroulante.

### Text Input

Un champ de texte libre. Ce que tape le visiteur est utilisé tel quel.

À utiliser quand : vous voulez que le tableau de bord se comporte comme un outil de recherche. Filtrer par adresse IP, identifiant de requête ou toute autre valeur libre.

### Telemetry Attribute

Les options sont les valeurs distinctes d'un attribut dans votre télémétrie sur la plage temporelle du tableau de bord.

Configurez la **clé d'attribut** (par exemple, `service.name`, `host.name`, `k8s.cluster.name`). La liste déroulante se remplit avec chaque valeur distincte observée dans vos journaux, métriques et traces.

À utiliser quand : les choix correspondent aux étiquettes que vous envoyez déjà avec votre télémétrie. C'est le type le plus courant car il se met à jour automatiquement — lorsque vous déployez un nouveau service étiqueté `service.name = inventory`, ce nom apparaît dans la liste déroulante sans que vous ayez à modifier le tableau de bord.

## Multi-sélection

Chaque variable peut autoriser plusieurs sélections. Lorsque cette option est activée, le visiteur peut choisir une ou plusieurs valeurs ; le tableau de bord filtre sur n'importe laquelle d'entre elles.

Utilisez la multi-sélection quand : vous voulez comparer « checkout et payments ensemble » sans quitter le tableau de bord. Évitez-la quand les calculs ne fonctionnent pas entre les valeurs sélectionnées (par exemple, faire une moyenne de moyennes).

## Valeurs par défaut

Chaque variable peut avoir une valeur par défaut. Le tableau de bord s'affiche avec cette valeur tant que le visiteur ne la modifie pas. Pour les tableaux de bord publics, la valeur par défaut est ce que voient les visiteurs en premier.

## Comment utiliser une variable dans un widget

Partout où un widget accepte un filtre — un `WHERE` de métrique, le filtre d'une liste, la correspondance d'attribut d'un log stream — vous pouvez utiliser `{{variable_name}}`.

Par exemple, un graphique filtré par service :

```
service.name = '{{service}}'
```

Lorsque la liste déroulante est réglée sur `checkout`, le graphique est filtré sur le service checkout. Quand le visiteur passe à `payments`, le graphique se réaffiche pour payments.

Pour les variables **Telemetry Attribute**, OneUptime sait quel attribut la variable cible et applique le filtre à chaque widget qui utilise le même attribut — vous n'avez pas à modifier chaque widget à la main.

## Plage temporelle

L'en-tête du tableau de bord comporte une plage temporelle globale. Chaque widget de métrique interroge sur cette fenêtre. Options :

- **Préréglages** — dernière heure, 24 heures, 7 jours, 30 jours, 90 jours (selon votre rétention de données).
- **Personnalisé** — choisissez un début et une fin.

La plage temporelle fait partie de l'URL du tableau de bord — partager l'URL partage la fenêtre. Pratique pendant un incident : fixez la plage temporelle à « 10 h 00–10 h 30 UTC aujourd'hui » et collez le lien dans le canal d'incident.

## Intervalle d'actualisation

À côté de la plage temporelle, choisissez la fréquence à laquelle les widgets relancent leur requête :

- **Off** — les widgets interrogent une fois au chargement de la page.
- **5s / 10s / 30s / 1m / 5m / 15m** — actualisation automatique.

L'actualisation automatique est utile pour un écran mural ou une vue d'incident en direct. Laissez-la désactivée pendant que vous investiguez pour que la vue reste stable pendant que vous l'examinez.

## Tout assembler

Un tableau de bord modélisé par service possède généralement :

1. Une variable `service` de type **Telemetry Attribute** pour `service.name`. Valeur par défaut : votre service le plus surveillé. Multi-sélection désactivée (afin que les graphiques affichent toujours un service à la fois).
2. Une variable `environment` de type **Custom List**. Valeur par défaut : `prod`.
3. Une variable `cluster` de type **Telemetry Attribute** pour `k8s.cluster.name`. Multi-sélection activée (afin de pouvoir comparer plusieurs clusters).
4. Des widgets qui font référence à ces variables dans leurs filtres.

Le résultat : un seul tableau de bord, tous les services couverts, trois listes déroulantes en haut.

## Pour aller plus loin

- [Widgets](/docs/dashboards/widgets) — comment chaque widget utilise un filtre.
- [Partage et tableaux de bord publics](/docs/dashboards/sharing) — variables et liens partagés.
- [Création d'un tableau de bord](/docs/dashboards/authoring) — la mécanique du canevas.
