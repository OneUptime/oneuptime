# Observabilité des données

Observabilité des données surveille les tables sur lesquelles repose votre entreprise, dans PostgreSQL, MySQL, SQL Server, Oracle, MongoDB, Redshift, Snowflake, BigQuery, ClickHouse, Databricks et Athena, et vous prévient quand leurs données sont en retard, manquantes, fausses ou cassées, avant que les personnes qui les utilisent ne s'en aperçoivent. Elle apprend d'elle-même le rythme de chaque table, lit le catalogue de chaque base de données de sorte qu'aucune valeur ne la quitte, et relie chaque problème de données à l'exécution de pipeline, au déploiement ou à la table en amont qui en est la cause.

Elle répond à quatre questions :

:::cards
- [Les données sont-elles fraîches ?](/docs/data-observability/table-health): La dernière modification, les lignes, la taille et les colonnes de chaque table, lues toutes les cinq minutes, avec des alertes quand une table est en retard, rétrécit ou change de structure.
- [Les données sont-elles justes ?](/docs/data-observability/checks): Des contrôles sur ce que contient une table, des rapprochements entre une table et sa copie, et les tests de dbt, avec une alerte quand ils échouent.
- [D'où viennent-elles, et qu'alimentent-elles ?](/docs/data-observability/lineage-and-pipelines): Le lignage tiré de vos pipelines, de dbt, Fivetran, Airbyte, des vues et de l'historique des requêtes des bases de données elles-mêmes, pour qu'un problème ne donne lieu qu'à un seul signalement.
- [Les personnes qui les utilisent peuvent-elles s'y fier ?](/docs/data-observability/data-products): Des produits de données avec un SLA de fraîcheur, sur des pages de statut et suivis comme un SLO, avec un badge « data as of ».
:::

## Fonctionnement

```mermaid title="De vos bases de données à une alerte que quelqu'un traite"
flowchart TB
    db["Vos bases de données<br/>et entrepôts"] --> collect["Catalogue lu toutes les cinq minutes,<br/>par OneUptime ou une sonde"]
    pipes["Airflow, dbt, Spark,<br/>Fivetran, Airbyte"] --> runs["Exécutions de pipelines<br/>et lignage"]
    collect --> health["Santé des tables :<br/>fraîcheur, volume, schéma"]
    collect --> checks["Contrôles et<br/>rapprochements"]
    health --> alerts["Alertes, avec l'exécution<br/>ou le déploiement en cause"]
    checks --> alerts
    runs --> alerts
    alerts --> oncall["Astreinte, pages de statut,<br/>SLO et OneUptime AI"]
```

1. **Connectez une base de données** avec un compte en lecture seule. Une base de données que Sécurité des données connaît déjà est surveillée sans rien faire, tout comme chaque jeu de données BigQuery trouvé par votre connexion Google Cloud. Une base de données dans un réseau privé est lue par une sonde que vous y exécutez.
2. **Toutes les cinq minutes**, OneUptime lit le catalogue et les statistiques de chaque base de données : chaque table et chaque vue, ses colonnes, ses lignes et sa taille, et le moment de sa dernière modification. Aucune table n'est parcourue, et sur MongoDB seuls les noms de champs de ses documents les plus récents sont lus. Un chemin dans un bucket peut être surveillé de la même façon.
3. **Le rythme de chaque table est appris** : la fréquence à laquelle elle change d'habitude. Une table qui manque son rythme est en retard ; celle dont les lignes chutent, ou dont les colonnes changent, le signale.
4. **Les alertes recommandées** transforment chacun de ces cas en un moniteur que vous choisissez d'avoir, et les contrôles que vous ajoutez lisent ce que contient une table.
5. Le **Lignage** indique quelles tables alimentent lesquelles, de sorte qu'une alerte sur une table dont la source a cassé en premier est traitée comme une conséquence de cette source : un seul signalement, pas dix.

## Ce qui la distingue

- **Elle fait partie du reste de OneUptime.** Une alerte de données est une alerte ordinaire : elle prévient la personne d'astreinte, ouvre des incidents, s'affiche sur les pages de statut et compte dans les SLO. Les services qui, d'après vos traces, écrivent dans une table, et leurs déploiements, figurent à côté de chaque alerte de table.
- **Rien à configurer table par table.** Les rythmes, les planifications et les durées d'exécution habituelles sont appris à partir de ce que fait chaque table et chaque pipeline, et un moniteur recommandé pour une base de données couvre chacune de ses tables, y compris celles créées plus tard.
- **Un seul signalement par cause.** Une alerte dont la table, le pipeline ou la base de données en amont a déjà une alerte ouverte rejoint cette alerte comme sa conséquence, déjà prise en compte, de sorte qu'un chargement cassé ne prévient qu'une seule fois.
- **Chaque alerte s'explique.** Elle classe la cause probable, dit ce qui dépend de la table et à qui elle appartient, et apprend de ce que vous en dites : marquez-en une **Pas un problème** et la même chose reste silencieuse la prochaine fois.
- **OneUptime AI connaît vos données.** Les investigations des alertes de données partent de ceux qui écrivent dans la table, de ses exécutions et de ses tables en amont ; on peut demander si une table est fraîche dans Demander à l'IA, Slack ou Microsoft Teams, ou via des agents IA ; et un contrôle peut s'écrire à partir d'une phrase. Voir [OneUptime AI et l'API](/docs/data-observability/ai-and-api).

## Avant de commencer

- **Un rôle qui peut la configurer.** Les rôles Propriétaire du projet, Administrateur du projet et Administrateur de la télémétrie connectent les bases de données. Toute personne autorisée à modifier les actifs de données ajoute des contrôles, des rapprochements et des produits de données ; les Lecteurs consultent ce qu'elle a trouvé. Voir [Référence des autorisations](/docs/permissions/reference).
- **Un compte en lecture seule sur chaque base de données.** [Connecter une base de données](/docs/data-observability/connect) indique le minimum dont chaque moteur a besoin. OneUptime suggère les bases de données que vos traces, vos comptes cloud et Database Monitoring connaissent déjà.

## Démarrage rapide

:::steps
### Connecter une base de données

Ouvrez **Observabilité des données**, allez dans **Bases de données** et choisissez **Connect a Database**. Choisissez le moteur, puis donnez une chaîne de connexion en lecture seule, ou le nom de la variable d'environnement dans laquelle votre sonde la lit. [Connecter une base de données](/docs/data-observability/connect) montre le compte à créer pour chaque moteur.

### Voir ses tables

En moins de cinq minutes, ses tables apparaissent sous **Tables**, chacune avec ses lignes, sa taille et le moment de sa dernière modification. La fraîcheur d'une table est connue dès qu'elle a changé deux fois : **Fresh** tant qu'elle garde son rythme, **Late** dès qu'elle le manque.

### Ajouter les alertes recommandées

Dans **Bases de données**, choisissez **Recommended Alerts** pour la base de données, et ajoutez celles que vous voulez : une table en retard, une table dont les lignes chutent fortement ou sont anormalement peu nombreuses, une table dont les colonnes changent, et une base de données qui cesse de remonter des données. Chacune est un moniteur ordinaire : l'astreinte, les propriétaires, les fenêtres de maintenance et les pages de statut fonctionnent comme pour n'importe quel autre.
:::

## Prochaines étapes

:::cards
- [Connecter une base de données](/docs/data-observability/connect): Le compte au moindre privilège de chaque moteur, et les sondes pour les réseaux privés.
- [Santé des tables](/docs/data-observability/table-health): Fraîcheur, volume, modifications de schéma, tables inutilisées et les métriques que chaque table écrit.
- [Contrôles et rapprochements](/docs/data-observability/checks): Des règles sur les valeurs d'une table, la comparaison d'une table avec sa copie, et les tests de dbt.
- [Lignage et pipelines](/docs/data-observability/lineage-and-pipelines): OpenLineage, dbt, Fivetran et Airbyte, et un seul signalement par cause.
- [Produits de données](/docs/data-observability/data-products): Des SLA de fraîcheur pour les personnes qui utilisent les données, sur des pages de statut et comme SLO.
- [OneUptime AI et l'API](/docs/data-observability/ai-and-api): Les investigations, un contrôle à partir d'une phrase, la fraîcheur pour les agents IA, et chaque point de terminaison.
:::
