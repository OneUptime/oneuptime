# Moniteur de traces

La surveillance des traces vous permet de surveiller les traces distribuées de vos applications et de déclencher des alertes basées sur les modèles de spans, les comptages et les statuts. OneUptime évalue les données de traces de vos services de télémétrie sur une fenêtre temporelle.

## Vue d'ensemble

Les moniteurs de traces recherchent et comptent les spans correspondant à des filtres spécifiques. Cela vous permet de :

- Alerter sur les pics de spans en erreur dans vos services
- Surveiller des opérations et des points d'accès spécifiques
- Suivre le volume et les modèles de spans
- Filtrer par statut de span, nom et attributs personnalisés
- Détecter les problèmes de performances et de fiabilité à partir des données de traces

## Création d'un moniteur de traces

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **Traces** comme type de moniteur
4. Sélectionnez les services de télémétrie à surveiller
5. Configurez les filtres de spans et les critères selon vos besoins

## Options de configuration

### Services de télémétrie

Sélectionnez un ou plusieurs services depuis lesquels surveiller les traces. Les services doivent envoyer des traces à OneUptime via OpenTelemetry.

### Filtres de spans

| Filtre | Description | Obligatoire |
|--------|-------------|-------------|
| Statuts de span | Filtrer par code de statut de span (OK, ERROR, UNSET) | Non |
| Nom de span | Recherche textuelle pour des noms de spans spécifiques (ex. : noms d'opération ou de point d'accès) | Non |
| Attributs | Paires clé-valeur pour filtrer sur des attributs de spans personnalisés | Non |
| Fenêtre temporelle | Jusqu'où chercher les spans (en secondes, par défaut : 60) | Non |

### Codes de statut de span

- **OK** — L'opération s'est terminée avec succès
- **ERROR** — L'opération a rencontré une erreur
- **UNSET** — Le statut n'a pas été explicitement défini

## Critères de surveillance

### Types de vérifications disponibles

| Type de vérification | Description |
|----------------------|-------------|
| Nombre de spans | Le nombre de spans correspondant à vos filtres dans la fenêtre temporelle |

### Types de filtres

- **Supérieur à** — Le nombre de spans dépasse un seuil
- **Inférieur à** — Le nombre de spans est en dessous d'un seuil
- **Supérieur ou égal à** — Le nombre de spans est au-dessus ou égal à un seuil
- **Inférieur ou égal à** — Le nombre de spans est en dessous ou égal à un seuil
- **Égal à** — Le nombre de spans correspond exactement
- **Différent de** — Le nombre de spans ne correspond pas

### Exemples de critères

#### Alerter si plus de 50 spans en erreur en 60 secondes

- **Statuts de span** : ERROR
- **Fenêtre temporelle** : 60 secondes
- **Vérifier sur** : Nombre de spans
- **Type de filtre** : Supérieur à
- **Valeur** : 50

#### Alerter sur les erreurs dans un point d'accès spécifique

- **Nom de span** : `POST /api/checkout`
- **Statuts de span** : ERROR
- **Fenêtre temporelle** : 120 secondes
- **Vérifier sur** : Nombre de spans
- **Type de filtre** : Supérieur à
- **Valeur** : 0

## Prérequis d'installation

La surveillance des traces nécessite que vos applications envoient des traces distribuées à OneUptime via OpenTelemetry. Consultez la documentation [OpenTelemetry](/docs/telemetry/open-telemetry) pour les instructions de configuration.
