# Moniteur de métriques

La surveillance des métriques vous permet de surveiller les métriques personnalisées d'application et d'infrastructure collectées via OpenTelemetry. OneUptime évalue les valeurs de métriques sur une fenêtre temporelle et déclenche des alertes basées sur vos critères configurés.

## Vue d'ensemble

Les moniteurs de métriques interrogent et évaluent les métriques numériques de vos services de télémétrie. Cela vous permet de :

- Surveiller les métriques d'application personnalisées (taux de requêtes, profondeurs de file d'attente, taux d'erreurs, etc.)
- Suivre les métriques d'infrastructure (CPU, mémoire, disque, réseau)
- Créer des requêtes de métriques complexes avec des filtres et des agrégations
- Combiner plusieurs métriques à l'aide de formules mathématiques
- Définir des alertes basées sur des seuils de métriques

## Création d'un moniteur de métriques

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **Métriques** comme type de moniteur
4. Configurez les requêtes de métriques et les formules optionnelles
5. Sélectionnez la stratégie d'agrégation
6. Configurez les critères de surveillance selon vos besoins

## Options de configuration

### Requêtes de métriques

Définissez une ou plusieurs requêtes de métriques. Chaque requête inclut :

| Champ              | Description                                                                  | Obligatoire |
| ------------------ | ---------------------------------------------------------------------------- | ----------- |
| Nom de la métrique | Le nom de la métrique à interroger                                           | Oui         |
| Type d'agrégation  | Comment agréger les valeurs brutes des métriques (sum, avg, min, max, count) | Oui         |
| Attributs          | Filtres clé-valeur pour affiner les données de métriques                     | Non         |
| Agréger par        | Dimensions par lesquelles regrouper la métrique                              | Non         |

Chaque requête se voit attribuer un alias (ex. : `a`, `b`, `c`) pour utilisation dans les formules.

### Formules

Combinez plusieurs requêtes de métriques à l'aide d'expressions mathématiques. Par exemple :

- `a / b * 100` — Calculer un pourcentage à partir de deux requêtes
- `a + b` — Additionner deux métriques
- `a - b` — Différence entre les métriques

### Fenêtre temporelle glissante

Sélectionnez la fenêtre temporelle pour l'évaluation des métriques :

- 1 dernière minute
- 5 dernières minutes
- 10 dernières minutes
- 15 dernières minutes
- 30 dernières minutes
- 60 dernières minutes

### Stratégie d'agrégation

Choisissez comment agréger les valeurs de métriques pour l'évaluation :

| Stratégie               | Description                                          |
| ----------------------- | ---------------------------------------------------- |
| Moyenne                 | Valeur moyenne sur la fenêtre temporelle             |
| Somme                   | Somme de toutes les valeurs                          |
| Valeur maximale         | Valeur la plus élevée dans la fenêtre temporelle     |
| Valeur minimale         | Valeur la plus basse dans la fenêtre temporelle      |
| Toutes les valeurs      | Toutes les valeurs doivent correspondre aux critères |
| N'importe quelle valeur | Au moins une valeur doit correspondre                |

## Critères de surveillance

### Types de vérifications disponibles

| Type de vérification | Description                                                       |
| -------------------- | ----------------------------------------------------------------- |
| Valeur de métrique   | La valeur agrégée de la requête de métrique ou formule configurée |

### Types de filtres

- **Supérieur à** — La valeur de la métrique dépasse un seuil
- **Inférieur à** — La valeur de la métrique est en dessous d'un seuil
- **Supérieur ou égal à** — La valeur de la métrique est au-dessus ou égale à un seuil
- **Inférieur ou égal à** — La valeur de la métrique est en dessous ou égale à un seuil
- **Égal à** — La valeur de la métrique correspond exactement
- **Différent de** — La valeur de la métrique ne correspond pas

### Exemples de critères

#### Alerter si le taux d'erreur dépasse 5%

- **Requête a** : `http_requests_total` filtré par `status=5xx`
- **Requête b** : `http_requests_total`
- **Formule** : `a / b * 100`
- **Vérifier sur** : Valeur de métrique
- **Type de filtre** : Supérieur à
- **Valeur** : 5

#### Alerter si la profondeur de la file de requêtes est élevée

- **Requête** : `request_queue_size`, agrégation : Valeur maximale
- **Vérifier sur** : Valeur de métrique
- **Type de filtre** : Supérieur à
- **Valeur** : 1000

## Prérequis d'installation

La surveillance des métriques nécessite que vos applications ou votre infrastructure envoient des métriques à OneUptime via OpenTelemetry. Consultez la documentation [OpenTelemetry](/docs/telemetry/open-telemetry) pour les instructions de configuration.
