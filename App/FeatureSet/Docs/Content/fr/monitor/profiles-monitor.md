# Moniteur de profils

La surveillance des profils vous permet de surveiller les données de profilage continu de vos applications et de déclencher des alertes basées sur les comptages et les modèles de profils. OneUptime évalue les données de profil de vos services de télémétrie sur une fenêtre temporelle.

## Vue d'ensemble

Les moniteurs de profils comptent et filtrent les données de profilage correspondant à des critères spécifiques. Cela vous permet de :

- Surveiller les données de profilage continu de vos applications
- Filtrer les profils par type (CPU, mémoire, goroutines, etc.)
- Suivre le volume et les modèles de profils
- Alerter sur les anomalies de profilage
- Filtrer par attributs de profils personnalisés

## Création d'un moniteur de profils

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **Profils** comme type de moniteur
4. Sélectionnez les services de télémétrie à surveiller
5. Configurez les filtres de profils et les critères selon vos besoins

## Options de configuration

### Services de télémétrie

Sélectionnez un ou plusieurs services depuis lesquels surveiller les profils. Les services doivent envoyer des données de profilage continu à OneUptime via OpenTelemetry.

### Filtres de profils

| Filtre             | Description                                                               | Obligatoire |
| ------------------ | ------------------------------------------------------------------------- | ----------- |
| Types de profils   | Filtrer par noms de types de profils (ex. : CPU, mémoire, goroutines)     | Non         |
| Attributs          | Paires clé-valeur pour filtrer sur des attributs de profils personnalisés | Non         |
| Fenêtre temporelle | Jusqu'où chercher les profils (en secondes, par défaut : 60)              | Non         |

## Critères de surveillance

### Types de vérifications disponibles

| Type de vérification | Description                                                                 |
| -------------------- | --------------------------------------------------------------------------- |
| Nombre de profils    | Le nombre de profils correspondant à vos filtres dans la fenêtre temporelle |

### Types de filtres

- **Supérieur à** — Le nombre de profils dépasse un seuil
- **Inférieur à** — Le nombre de profils est en dessous d'un seuil
- **Supérieur ou égal à** — Le nombre de profils est au-dessus ou égal à un seuil
- **Inférieur ou égal à** — Le nombre de profils est en dessous ou égal à un seuil
- **Égal à** — Le nombre de profils correspond exactement
- **Différent de** — Le nombre de profils ne correspond pas

### Exemples de critères

#### Alerter si aucun profil reçu en 5 minutes

- **Fenêtre temporelle** : 300 secondes
- **Vérifier sur** : Nombre de profils
- **Type de filtre** : Égal à
- **Valeur** : 0

## Prérequis d'installation

La surveillance des profils nécessite que vos applications envoient des données de profilage continu à OneUptime via OpenTelemetry. Consultez la documentation [OpenTelemetry](/docs/telemetry/open-telemetry) pour les instructions de configuration.
