# Moniteur d'exceptions

La surveillance des exceptions vous permet de surveiller les exceptions et les erreurs d'application, en déclenchant des alertes lorsque le nombre d'exceptions dépasse vos seuils configurés. OneUptime évalue les données d'exception de vos services de télémétrie sur une fenêtre temporelle.

## Vue d'ensemble

Les moniteurs d'exceptions comptent et filtrent les exceptions correspondant à des critères spécifiques. Cela vous permet de :

- Alerter sur les pics d'exceptions dans vos applications
- Surveiller des types d'exceptions spécifiques
- Limiter les alertes à un environnement de déploiement tel que `production`
- Rechercher des exceptions par message d'erreur
- Suivre séparément les exceptions résolues et actives
- Détecter les problèmes de stabilité des applications à partir des modèles d'erreurs

## Création d'un moniteur d'exceptions

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **Exceptions** comme type de moniteur
4. Sélectionnez les services de télémétrie à surveiller
5. Configurez les filtres d'exceptions et les critères selon vos besoins

## Options de configuration

### Services de télémétrie

Sélectionnez un ou plusieurs services depuis lesquels surveiller les exceptions. Les services doivent envoyer des données d'exception à OneUptime via OpenTelemetry.

### Filtres d'exceptions

| Filtre                | Description                                                                        | Obligatoire |
| --------------------- | ---------------------------------------------------------------------------------- | ----------- |
| Types d'exceptions    | Filtrer par noms de types d'exceptions (ex. : `NullPointerException`, `TypeError`) | Non         |
| Environnements        | Filtrer par environnement de déploiement (ex. : `production`, `staging`)           | Non         |
| Message               | Recherche textuelle dans les messages d'exception                                  | Non         |
| Inclure les résolues  | Inclure les exceptions marquées comme résolues (par défaut : false)                | Non         |
| Inclure les archivées | Inclure les exceptions archivées (par défaut : false)                              | Non         |
| Fenêtre temporelle    | Jusqu'où chercher les exceptions (en secondes, par défaut : 60)                    | Non         |

### Environnements

Les environnements proviennent de l'attribut de ressource OpenTelemetry `deployment.environment` de chaque exception, la même valeur que celle utilisée par l'explorateur d'exceptions pour filtrer avec `env:production`. Saisissez un environnement, ou plusieurs séparés par des virgules ; une exception est comptée lorsque son environnement correspond à l'un d'entre eux.

La correspondance est exacte et sensible à la casse : `production` ne correspond ni à `Production` ni à `prod`. Les exceptions sans environnement ne sont pas comptées lorsque ce filtre est défini. Laissez-le vide pour compter les exceptions de tous les environnements, y compris celles sans environnement.

Le filtre d'environnement est combiné avec tous les autres filtres : un moniteur limité à un service de télémétrie et à `production` ne compte donc que les exceptions de production de ce service.

Lors de la création du moniteur via l'API, définissez `environments` dans le `exceptionMonitor` de l'étape sur une liste de noms d'environnements :

```json
{
  "exceptionMonitor": {
    "telemetryServiceIds": [],
    "environments": ["production"],
    "exceptionTypes": [],
    "message": "",
    "includeResolved": false,
    "includeArchived": false,
    "lastXSecondsOfExceptions": 300
  }
}
```

## Critères de surveillance

### Types de vérifications disponibles

| Type de vérification | Description                                                                   |
| -------------------- | ----------------------------------------------------------------------------- |
| Nombre d'exceptions  | Le nombre d'exceptions correspondant à vos filtres dans la fenêtre temporelle |

### Types de filtres

- **Supérieur à** — Le nombre d'exceptions dépasse un seuil
- **Inférieur à** — Le nombre d'exceptions est en dessous d'un seuil
- **Supérieur ou égal à** — Le nombre d'exceptions est au-dessus ou égal à un seuil
- **Inférieur ou égal à** — Le nombre d'exceptions est en dessous ou égal à un seuil
- **Égal à** — Le nombre d'exceptions correspond exactement
- **Différent de** — Le nombre d'exceptions ne correspond pas

### Exemples de critères

#### Alerter si plus de 10 exceptions en 60 secondes

- **Fenêtre temporelle** : 60 secondes
- **Vérifier sur** : Nombre d'exceptions
- **Type de filtre** : Supérieur à
- **Valeur** : 10

#### Alerter sur toute NullPointerException

- **Types d'exceptions** : `NullPointerException`
- **Fenêtre temporelle** : 60 secondes
- **Vérifier sur** : Nombre d'exceptions
- **Type de filtre** : Supérieur à
- **Valeur** : 0

#### Alerter uniquement sur les exceptions de production

- **Environnements** : `production`
- **Fenêtre temporelle** : 300 secondes
- **Vérifier sur** : Nombre d'exceptions
- **Type de filtre** : Supérieur à
- **Valeur** : 5

#### Surveiller les exceptions contenant un message spécifique

- **Message** : `out of memory`
- **Fenêtre temporelle** : 300 secondes
- **Vérifier sur** : Nombre d'exceptions
- **Type de filtre** : Supérieur à
- **Valeur** : 0

## Prérequis d'installation

La surveillance des exceptions nécessite que vos applications envoient des données d'exception à OneUptime via OpenTelemetry. Consultez la documentation [OpenTelemetry](/docs/telemetry/open-telemetry) pour les instructions de configuration.
