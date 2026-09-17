# Moniteur d'exceptions

La surveillance des exceptions vous permet de surveiller les exceptions et les erreurs d'application, en déclenchant des alertes lorsque le nombre d'exceptions dépasse vos seuils configurés. OneUptime évalue les données d'exception de vos services de télémétrie sur une fenêtre temporelle.

## Vue d'ensemble

Les moniteurs d'exceptions comptent et filtrent les exceptions correspondant à des critères spécifiques. Cela vous permet de :

- Alerter sur les pics d'exceptions dans vos applications
- Surveiller des types d'exceptions spécifiques
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
| Message               | Recherche textuelle dans les messages d'exception                                  | Non         |
| Inclure les résolues  | Inclure les exceptions marquées comme résolues (par défaut : false)                | Non         |
| Inclure les archivées | Inclure les exceptions archivées (par défaut : false)                              | Non         |
| Fenêtre temporelle    | Jusqu'où chercher les exceptions (en secondes, par défaut : 60)                    | Non         |

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

#### Surveiller les exceptions contenant un message spécifique

- **Message** : `out of memory`
- **Fenêtre temporelle** : 300 secondes
- **Vérifier sur** : Nombre d'exceptions
- **Type de filtre** : Supérieur à
- **Valeur** : 0

## Prérequis d'installation

La surveillance des exceptions nécessite que vos applications envoient des données d'exception à OneUptime via OpenTelemetry. Consultez la documentation [OpenTelemetry](/docs/telemetry/open-telemetry) pour les instructions de configuration.
