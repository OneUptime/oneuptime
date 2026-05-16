# Moniteur de journaux

La surveillance des journaux vous permet de surveiller les journaux de vos applications et de déclencher des alertes basées sur des modèles de journaux, des comptages et des niveaux de gravité. OneUptime évalue les journaux de vos services de télémétrie et les vérifie en fonction de vos critères configurés.

## Vue d'ensemble

Les moniteurs de journaux recherchent et comptent les journaux correspondant à des filtres spécifiques sur une fenêtre temporelle. Cela vous permet de :

- Alerter sur les pics de journaux d'erreurs
- Surveiller des modèles ou messages de journaux spécifiques
- Suivre le volume des journaux par niveau de gravité
- Filtrer les journaux par service, attributs et contenu
- Détecter les problèmes d'application à partir des modèles de journaux

## Création d'un moniteur de journaux

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **Journaux** comme type de moniteur
4. Sélectionnez les services de télémétrie à surveiller
5. Configurez les filtres de journaux et les critères selon vos besoins

## Options de configuration

### Services de télémétrie

Sélectionnez un ou plusieurs services depuis lesquels surveiller les journaux. Les services doivent envoyer des journaux à OneUptime via OpenTelemetry.

### Filtres de journaux

| Filtre | Description | Obligatoire |
|--------|-------------|-------------|
| Niveaux de gravité | Filtrer par gravité du journal (ERROR, WARN, INFO, DEBUG, etc.) | Non |
| Corps | Recherche textuelle dans le corps du message de journal | Non |
| Attributs | Paires clé-valeur pour filtrer sur des attributs de journaux personnalisés | Non |
| Fenêtre temporelle | Jusqu'où chercher les journaux (en secondes, par défaut : 60) | Non |

### Niveaux de gravité

Filtrez les journaux par un ou plusieurs niveaux de gravité :

- **FATAL** / **EMERGENCY** / **CRITICAL**
- **ERROR**
- **WARN** / **WARNING**
- **INFO** / **INFORMATIONAL**
- **DEBUG**
- **TRACE**
- **UNSPECIFIED**

## Critères de surveillance

### Types de vérifications disponibles

| Type de vérification | Description |
|----------------------|-------------|
| Nombre de journaux | Le nombre de journaux correspondant à vos filtres dans la fenêtre temporelle |

### Types de filtres

- **Supérieur à** — Le nombre de journaux dépasse un seuil
- **Inférieur à** — Le nombre de journaux est en dessous d'un seuil
- **Supérieur ou égal à** — Le nombre de journaux est au-dessus ou égal à un seuil
- **Inférieur ou égal à** — Le nombre de journaux est en dessous ou égal à un seuil
- **Égal à** — Le nombre de journaux correspond exactement
- **Différent de** — Le nombre de journaux ne correspond pas

### Exemples de critères

#### Alerter si plus de 100 journaux d'erreurs en 60 secondes

- **Niveaux de gravité** : ERROR
- **Fenêtre temporelle** : 60 secondes
- **Vérifier sur** : Nombre de journaux
- **Type de filtre** : Supérieur à
- **Valeur** : 100

#### Alerter si des journaux fatals apparaissent

- **Niveaux de gravité** : FATAL
- **Fenêtre temporelle** : 60 secondes
- **Vérifier sur** : Nombre de journaux
- **Type de filtre** : Supérieur à
- **Valeur** : 0

#### Surveiller les journaux contenant un message d'erreur spécifique

- **Corps** : `database connection timeout`
- **Fenêtre temporelle** : 300 secondes
- **Vérifier sur** : Nombre de journaux
- **Type de filtre** : Supérieur à
- **Valeur** : 5

## Prérequis d'installation

La surveillance des journaux nécessite que vos applications envoient des journaux à OneUptime via OpenTelemetry. Consultez la documentation [OpenTelemetry](/docs/telemetry/open-telemetry) pour les instructions de configuration.
