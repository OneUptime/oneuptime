# Santé des tables

Toutes les cinq minutes, le catalogue de chaque base de données connectée indique comment se porte chaque table : quand elle a changé pour la dernière fois, combien de lignes elle contient, quelle est sa taille et quelles sont ses colonnes. Observabilité des données en déduit le rythme de chaque table, et signale quand une table est en retard, rétrécit ou change de structure, sans aucun seuil à définir.

## Ce qui est lu

Pour chaque table et chaque vue :

- **Le nombre de lignes et la taille**, tirés des propres statistiques du moteur.
- **Le moment de sa dernière modification** : l'horodatage du moteur lui-même là où il en tient un, ou le moment où ses compteurs d'écriture, ses lignes ou ses octets ont bougé entre deux collectes.
- **Ses colonnes**, avec leurs types et le fait qu'elles puissent ou non être vides.
- **Le moment de sa dernière lecture**, là où le moteur compte les lectures.

Seul le catalogue est lu. Aucune ligne n'est lue, et aucune valeur ne quitte la base de données.

## Fraîcheur

Le **rythme** d'une table est la fréquence à laquelle elle change d'habitude, appris à partir du temps écoulé entre ses modifications. Une table qui dépasse nettement son rythme apparaît comme **Late**, sur sa page et dans **Tables**, et indique de combien elle le dépasse. Sa fraîcheur est connue dès qu'elle a changé deux fois : une table chargée toutes les heures est apprise en quelques heures, une table chargée chaque nuit en quelques jours.

Une vue ne contient aucune ligne propre : sa fraîcheur est donc celle de ses sources. Voir [Lignage et pipelines](/docs/data-observability/lineage-and-pipelines).

## Changements de volume et de schéma

- Les **Lignes** sont comparées d'une collecte à l'autre : une table qui perd la moitié de ses lignes, ou qui en contient bien moins que d'habitude pour cette heure de la semaine, le signale.
- Les **Colonnes** sont comparées elles aussi. Une colonne ajoutée, supprimée, renommée, changée de type ou rendue nullable apparaît dans la **Chronologie** de la table et dans **Modifications de schéma**, qui liste chaque modification de chaque base de données, la plus récente en premier.
- Les **Tables supprimées** sont conservées sous **Tables supprimées**, avec le moment où elles ont été vues pour la dernière fois, et reviennent avec leur historique si la table réapparaît.

## Alertes recommandées

Dans **Bases de données**, choisissez **Recommended Alerts** pour une base de données. Chaque recommandation est un seul moniteur de métrique pour toute la base de données, qui alerte une fois par table, si bien qu'une table créée plus tard est surveillée elle aussi :

| Alerte | Se déclenche quand |
| --- | --- |
| **Table Is Late** | Une table dépasse pendant quinze minutes le moment où elle change d'habitude |
| **Row Count Fell Sharply** | Une table perd la moitié de ses lignes ou plus entre deux collectes |
| **Row Count Unusually Low** | Une table contient bien moins de lignes que d'habitude pour cette heure de la semaine (appris sur deux semaines) |
| **Schema Changed** | Des colonnes d'une table sont ajoutées, supprimées, renommées ou changées de type |
| **Table Health Stopped Reporting** | Aucune table de la base de données n'a été lue depuis quinze minutes |

Choisissez les gravités, les politiques d'astreinte, les propriétaires et les étiquettes au moment de les créer. Ce sont ensuite des moniteurs ordinaires : modifiez-les, mettez-les en sourdine ou placez-les sur une page de statut comme n'importe quel autre.

## Métriques écrites par chaque table

Chaque collecte écrit ces métriques pour chaque table, afin que vous puissiez les tracer, les placer sur des tableaux de bord et déclencher des alertes dessus comme pour n'importe quelle autre métrique :

| Métrique | Ce que c'est |
| --- | --- |
| `oneuptime.data.table.row_count` | Lignes de la table |
| `oneuptime.data.table.size` | Octets occupés par la table et ses index |
| `oneuptime.data.table.seconds_since_change` | Secondes écoulées depuis la dernière modification de la table |
| `oneuptime.data.table.overdue_seconds` | Secondes de dépassement par rapport au moment où la table change d'habitude ; 0 tant qu'elle est à l'heure |
| `oneuptime.data.table.row_count_change_percent` | Variation du nombre de lignes depuis la collecte précédente, en pourcentage |
| `oneuptime.data.table.schema_changes` | Colonnes modifiées depuis la collecte précédente |

Chaque ligne porte `oneuptime.data.store.id`, `oneuptime.data.store.name`, `oneuptime.data.table.id`, `oneuptime.data.table.schema`, `oneuptime.data.table.name` et `oneuptime.data.table.key` (`schema.table`). Un [moniteur de métrique](/docs/monitor/metrics-monitor) groupé par `oneuptime.data.table.key` alerte une fois par table, et ses filtres **Anomalously High** et **Anomalously Low** comparent chaque table à sa propre valeur habituelle pour cette heure de la semaine. Ces métriques sont des données opérationnelles propres à OneUptime et ne sont pas facturées comme de la télémétrie.

## Tables inutilisées

Chaque moteur qui compte les lectures indique quand chaque table a été lue pour la dernière fois : les parcours de PostgreSQL, le performance_schema de MySQL, les recherches, parcours et lookups de SQL Server, et l'historique des requêtes de Redshift, ClickHouse et Databricks. Une lecture vue dans les spans de base de données de vos services compte aussi.

**Tables inutilisées** liste les tables que personne n'a lues depuis 90 jours, les plus volumineuses en premier, avec le moment où chacune a été écrite pour la dernière fois : une table toujours écrite mais jamais lue coûte ses écritures et son stockage. Un compteur à 0 lors de la première collecte d'une table signifie qu'elle n'a pas été lue depuis le démarrage des statistiques du moteur : une table inutilisée apparaît donc comme inutilisée dès le départ.

## Services qui utilisent chaque table

L'onglet **Services** d'une table liste les services vus en train de l'écrire et de la lire, avec les instructions que chacun a exécutées, ses appels et ses échecs de la dernière heure, et le moment où il a été vu pour la dernière fois. Il s'appuie sur les spans de base de données que vos services envoient déjà avec OpenTelemetry : un span client avec `db.system.name`, `db.namespace` et `db.collection.name`. Rien de plus à installer.

Un span n'est rattaché à une table que si sa base de données est l'une de celles qu'une collecte a lues et, quand deux bases de données portent le même nom, seulement si son `server.address` est celle de l'une d'elles.

## Prochaines étapes

:::cards
- [Contrôles et rapprochements](/docs/data-observability/checks): Des règles sur ce que contient une table, au-delà de savoir si elle change.
- [Lignage et pipelines](/docs/data-observability/lineage-and-pipelines): D'où viennent les données d'une table en retard, et l'exécution qui aurait dû la charger.
:::
