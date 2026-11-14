# Santé des tables

Toutes les cinq minutes, le catalogue de chaque base de données connectée indique comment se porte chaque table : quand elle a changé pour la dernière fois, combien de lignes elle contient, quelle est sa taille et quelles sont ses colonnes. Observabilité des données en déduit le rythme de chaque table, et signale quand une table est en retard, rétrécit ou change de structure, sans aucun seuil à définir.

## Ce qui est lu

Pour chaque table et chaque vue :

- **Le nombre de lignes et la taille**, tirés des propres statistiques du moteur.
- **Le moment de sa dernière modification** : l'horodatage du moteur lui-même là où il en tient un, ou le moment où ses compteurs d'écriture, ses lignes ou ses octets ont bougé entre deux collectes.
- **Ses colonnes**, avec leurs types et le fait qu'elles puissent ou non être vides.
- **Le moment de sa dernière lecture**, là où le moteur compte les lectures.

Seul le catalogue est lu, et sur MongoDB les noms de champs des documents les plus récents d'une collection. Aucune valeur ne quitte la base de données.

## Fraîcheur

Le **rythme** d'une table est la fréquence à laquelle elle change d'habitude, appris à partir du temps écoulé entre ses modifications. Une table qui dépasse nettement son rythme apparaît comme **En retard**, sur sa page et dans **Tables**, et indique de combien elle le dépasse. Sa fraîcheur est connue dès qu'elle a changé deux fois : une table chargée toutes les heures est apprise en quelques heures, une table chargée chaque nuit en quelques jours.

Une vue ne contient aucune ligne propre : sa fraîcheur est donc celle de ses sources. Voir [Lignage et pipelines](/docs/data-observability/lineage-and-pipelines).

Un catalogue peut dire qu'une table a changé alors que seule son entretien interne a changé, ou ne rien dire du tout. Dans les **Paramètres** d'une table, nommez une **Colonne Freshness** comme `updated_at`, et sa dernière modification devient la valeur la plus récente de cette colonne. Le compte doit pouvoir lire la colonne, et elle est lue à chaque collecte, elle doit donc être indexée ; sur BigQuery et Athena, qui facturent selon ce qu'une requête lit, elle est lue une fois par heure. Les heures sans fuseau sont considérées comme UTC.

## Changements de volume et de schéma

- Les **Lignes** sont comparées d'une collecte à l'autre : une table qui perd la moitié de ses lignes, ou qui en contient bien moins que d'habitude pour cette heure de la semaine, le signale.
- Les **Colonnes** sont comparées elles aussi. Une colonne ajoutée, supprimée, renommée, changée de type ou rendue nullable apparaît dans la **Chronologie** de la table et dans **Modifications de schéma**, qui liste chaque modification de chaque base de données, la plus récente en premier. Une colonne supprimée, renommée ou changée de type casse ce qui la lit, et peut déclencher une alerte. Une colonne ajoutée ne casse rien, et reste dans la chronologie.
- Les **Tables supprimées** sont conservées sous **Tables supprimées**, avec le moment où elles ont été vues pour la dernière fois, et reviennent avec leur historique si la table réapparaît.

## Alertes recommandées

Dans **Bases de données**, choisissez **Alertes recommandées** pour une base de données. Chaque recommandation est un seul moniteur de métrique pour toute la base de données, qui alerte une fois par table, si bien qu'une table créée plus tard est surveillée elle aussi :

| Alerte | Se déclenche quand |
| --- | --- |
| **Table Is Late** | Une table dépasse pendant quinze minutes le moment où elle change d'habitude |
| **Row Count Fell Sharply** | Une table perd la moitié de ses lignes ou plus entre deux collectes |
| **Row Count Unusually Low** | Une table contient bien moins de lignes que d'habitude pour cette heure de la semaine (appris sur deux semaines) |
| **Schema Changed** | Des colonnes d'une table sont supprimées, renommées ou changées de type |
| **Table Health Stopped Reporting** | Aucune table de la base de données n'a été lue depuis quinze minutes |

Choisissez les gravités, les politiques d'astreinte, les propriétaires et les étiquettes au moment de les créer. Ce sont ensuite des moniteurs ordinaires : modifiez-les, mettez-les en sourdine ou placez-les sur une page de statut comme n'importe quel autre.

Un rattrapage ou une migration ne devrait réveiller personne. Nommez la base de données sous **Bases de données Data Observability** dans un [événement de maintenance](/docs/scheduled-maintenance/index), ou placez-y son serveur de base de données, et ses alertes de données restent silencieuses tant que l'événement est en cours.

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
| `oneuptime.data.table.breaking_schema_changes` | Colonnes supprimées, renommées ou changées de type depuis la collecte précédente |

Chaque ligne porte `oneuptime.data.store.id`, `oneuptime.data.store.name`, `oneuptime.data.table.id`, `oneuptime.data.table.schema`, `oneuptime.data.table.name` et `oneuptime.data.table.key` (`schema.table`). Un [moniteur de métrique](/docs/monitor/metrics-monitor) groupé par `oneuptime.data.table.key` alerte une fois par table, et ses filtres **Anormalement élevé** et **Anormalement bas** comparent chaque table à sa propre valeur habituelle pour cette heure de la semaine. Ces métriques sont des données opérationnelles propres à OneUptime et ne sont pas facturées comme de la télémétrie.

## Tables inutilisées

Chaque moteur qui compte les lectures indique quand chaque table a été lue pour la dernière fois : les parcours de PostgreSQL, le performance_schema de MySQL, les recherches, parcours et lookups de SQL Server, et l'historique des requêtes de Redshift, ClickHouse et Databricks. Une lecture vue dans les spans de base de données de vos services compte aussi.

**Tables inutilisées** liste les tables que personne n'a lues depuis 90 jours, les plus volumineuses en premier, avec le moment où chacune a été écrite pour la dernière fois : une table toujours écrite mais jamais lue coûte ses écritures et son stockage. Un compteur à 0 lors de la première collecte d'une table signifie qu'elle n'a pas été lue depuis le démarrage des statistiques du moteur : une table inutilisée apparaît donc comme inutilisée dès le départ.

## Dépenses d'entrepôt

Toutes les heures, l'Observabilité des données lit ce que chaque entrepôt Snowflake et BigQuery a dépensé le dernier jour, tâche par tâche : les crédits de calcul de Snowflake, depuis `QUERY_ATTRIBUTION_HISTORY`, et les octets facturés de BigQuery, depuis sa vue des tâches, qui demande **BigQuery Resource Viewer**. Une tâche est une requête exécutée encore et encore, nommée par son tag de requête ou son label, ou par ce qu'elle fait et la table qu'elle écrit : jamais par le texte de sa requête.

**Dépenses d'entrepôt** montre les totaux par équipe (le `team` du tag ou du label d'une tâche, sinon qui l'exécute), les tables dont les écritures coûtent le plus, les tâches en échec et ce qui va aux tâches qui n'écrivent que des tables que personne n'a lues depuis 90 jours.

## Services qui utilisent chaque table

L'onglet **Services** d'une table liste les services vus en train de l'écrire et de la lire, avec les instructions que chacun a exécutées, ses appels et ses échecs de la dernière heure, et le moment où il a été vu pour la dernière fois. Il s'appuie sur les spans de base de données que vos services envoient déjà avec OpenTelemetry : un span client avec `db.system.name`, `db.namespace` et `db.collection.name`. Rien de plus à installer.

Un span n'est rattaché à une table que si sa base de données est l'une de celles qu'une collecte a lues et, quand deux bases de données portent le même nom, seulement si son `server.address` est celle de l'une d'elles.

Chaque service montre aussi les points de terminaison qui font ses appels, d'après le span serveur de la même trace, et est marqué **Application IA** quand il appelle aussi un modèle. **Erreurs citant cette table** liste les exceptions ouvertes et les journaux d'erreurs du dernier jour des services qui écrivent dans la table, quand ils la mentionnent par son nom.

## Propriétaires et étiquettes

L'onglet **Propriétaires** d'une table nomme les personnes et les équipes auxquelles elle appartient, et l'alerte d'une table leur est envoyée ; à défaut, aux propriétaires de sa base de données. Dans les **Paramètres** d'une table, donnez-lui vos propres **Étiquettes**.

Vous ne devriez pas avoir à le faire des centaines de fois. Les **Règles de propriétaire** et les **Règles d'étiquettes** s'appliquent à chaque table dès son apparition, selon ses étiquettes, ou selon une expression régulière sur son nom, son schéma ou sa base de données : tout ce qui est dans `finance` va à l'équipe finance, et tout ce qui s'appelle `*_pii` reçoit une étiquette.

Une autorisation limitée à `Owned` n'atteint que les tables dont son titulaire ou ses équipes sont propriétaires, ainsi que leurs contrôles, leur activité et les problèmes signalés. Être propriétaire d'une base de données ne rend pas propriétaire de ses tables : utilisez une règle de propriétaires pour confier toute une base de données à une équipe.

## Quand une alerte s'ouvre

L'alerte d'une table a une carte **Données** qui dit pourquoi elle s'est le plus probablement produite, classée : une alerte en amont, une exécution en échec, un déploiement d'un service qui y écrit, ses écritures en échec, une colonne qui a changé, la base de données elle-même ou le serveur sur lequel elle tourne. En dessous se trouve ce qui en dépend : les tables en aval dans son lignage, les tableaux de bord, les services et les personnes qui en sont propriétaires.

Dites ce que vous en avez conclu :

- **Useful** : elle avait raison.
- **Expected** : un événement planifié. Rien ne change, et la suivante est signalée aussi.
- **Pas un problème** : la table reçoit plus de marge, de sorte que la même chose reste silencieuse la prochaine fois. L'intervalle habituel d'une table en retard s'allonge, et la tolérance d'un nombre de lignes s'élargit.

Si une personne trouve un problème en premier, **Signaler un problème** sur la table l'enregistre. **Vue d'ensemble** montre alors comment se porte Observabilité des données pour votre projet : les problèmes utiles par semaine, combien n'étaient pas du bruit, combien de tables sont lues, à quelle fréquence il a signalé un problème avant qu'une personne ne le signale, à quelle vitesse, et à quelle fréquence sa cause probable était la bonne.

## Prochaines étapes

:::cards
- [Contrôles et rapprochements](/docs/data-observability/checks): Des règles sur ce que contient une table, au-delà de savoir si elle change.
- [Lignage et pipelines](/docs/data-observability/lineage-and-pipelines): D'où viennent les données d'une table en retard, et l'exécution qui aurait dû la charger.
:::
