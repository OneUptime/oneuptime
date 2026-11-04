# Lignage et pipelines

Le lignage indique à partir de quelles tables chaque table est construite, et quels pipelines y écrivent. Observabilité des données le rassemble depuis six sources à la fois - les événements OpenLineage, dbt, les synchronisations Fivetran et Airbyte, les jobs de vos traces, les vues et l'historique des requêtes de chaque base de données - et s'en sert pour relier chaque table en retard ou cassée à l'exécution qui en est la cause, pour qu'un problème ne donne lieu qu'à un seul signalement.

## D'où vient le lignage

| Source | Ce qu'elle apporte |
| --- | --- |
| **OpenLineage** | Chaque exécution d'un job Airflow, Dagster, Spark, dbt ou Flink, avec les tables qu'il a lues et écrites |
| **dbt** | Ce à partir de quoi chaque modèle est construit, chaque build comme une exécution, et le résultat de chaque test |
| **Fivetran et Airbyte** | Chaque synchronisation comme une exécution de son connecteur, et les tables brutes qu'elle charge |
| **Jobs de vos traces** | Un CronJob Kubernetes ou une fonction planifiée, ses exécutions, et les tables que ses appels de base de données ont lues et écrites |
| **Vues** | Une vue est construite à partir des tables sur lesquelles elle est définie (PostgreSQL, Redshift, MySQL 8, SQL Server, Oracle, Snowflake, vues matérialisées ClickHouse, Databricks, MongoDB) |
| **Historique des requêtes** | Une requête qui a lu une table et en a écrit une autre (l'historique d'accès de Snowflake, les jobs de BigQuery, le journal des requêtes de Redshift, le journal des requêtes de ClickHouse, la table de lignage de Databricks) |

L'onglet **Lignage** d'une table montre les tables à partir desquelles elle est construite, les pipelines qui y écrivent avec leur dernière exécution, et les tables construites à partir d'elle. Chaque lien indique où il a été observé.

Lorsque la source nomme des colonnes, l'onglet **Colonnes** d'une table indique d'où vient chaque colonne et ce qu'elle alimente : l'historique d'accès de Snowflake (édition Enterprise, qui demande `IMPORTED PRIVILEGES` sur la base de données `SNOWFLAKE`), et la facette `columnLineage` d'OpenLineage.

## OpenLineage

Envoyez les événements OpenLineage à OneUptime, tels quels, avec une [clé d'ingestion](/docs/telemetry/ingestion-keys) de télémétrie :

- **URL :** `https://oneuptime.com/telemetry/openlineage` (sur un OneUptime auto-hébergé, votre propre adresse)
- **Point de terminaison :** `api/v1/lineage`, la valeur par défaut d'OpenLineage
- **Clé API :** la clé d'ingestion, envoyée comme `Authorization: Bearer`, ou définissez `x-oneuptime-token`

Pour le fournisseur OpenLineage d'Airflow :

```bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
```

Pour tout autre client OpenLineage, définissez `OPENLINEAGE_URL` et `OPENLINEAGE_API_KEY`. Les jeux de données sont associés aux tables selon la convention de nommage d'OpenLineage, comme `postgres://host:5432` avec `database.schema.table`, `snowflake://account` avec `database.schema.table`, `clickhouse://host:8443` avec `database.table`, et `databricks://workspace-host` avec `catalog.schema.table`.

## dbt

Après `dbt build` (ou run, test, seed ou snapshot), envoyez les artefacts du projet avec la [CLI OneUptime](/docs/cli/index) :

```bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
```

En CI, exécutez `oneuptime dbt upload` comme étape suivant le build, même quand le build échoue, pour que les tests en échec soient enregistrés. Chaque table que dbt construit reçoit une carte **dbt** sur sa vue d'ensemble, le lignage de ses modèles, et ses tests dans son onglet **Vérifications** ; chaque build est une exécution du pipeline du projet.

## Fivetran et Airbyte

Leurs webhooks indiquent quand chaque synchronisation commence et se termine. **Pipelines > Connecter Fivetran ou Airbyte** remplit les URL avec l'une de vos clés d'ingestion :

- **Fivetran :** un webhook créé avec l'API REST de Fivetran, pour les événements `sync_start` et `sync_end`, vers `https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>`, avec la clé d'ingestion comme secret. Fivetran signe chaque envoi avec elle, si bien que la clé ne circule jamais dans l'URL.
- **Airbyte :** le webhook de l'espace de travail réglé sur `https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>`, activé pour les synchronisations en échec et réussies. Donnez à Airbyte une clé qui lui est propre.

Une synchronisation Fivetran reprogrammée à cause de la limite de débit d'une API se termine en **Reprogrammée** : ce n'est pas un échec, donc elle ne prévient personne.

## Jobs de vos traces

Beaucoup de pipelines sont un CronJob Kubernetes, ou une fonction sur minuteur, sans planificateur pour envoyer du lignage. Leurs traces disent tout de même tout, sans rien à installer. Toutes les quinze minutes, les spans dont l'attribut de ressource est `k8s.cronjob.name` ou `k8s.job.name`, ou `faas.name` avec un `faas.trigger` valant `timer` ou `datasource`, deviennent un pipeline sous **Pipelines** :

- Une exécution de CronJob est son Job Kubernetes, et une exécution de fonction est son `faas.invocation_id`.
- Une exécution a échoué quand le span au sommet de sa trace a échoué. Un appel qui a échoué puis a été retenté à l'intérieur ne la fait pas échouer.
- Les tables qu'il a écrites et lues viennent de ses spans de base de données.

Chaque exécution renvoie vers sa trace, avec ses journaux. Les trois mêmes moniteurs s'appliquent, si bien qu'un CronJob qui cesse de s'exécuter est vu comme en retard.

## Tableaux de bord des outils BI

Le véritable impact de données erronées, c'est le tableau de bord que quelqu'un ouvre. Dans **Tableaux de bord BI**, ajoutez vos outils BI avec des identifiants autorisés à lire leurs tableaux de bord. Toutes les heures, l'Observabilité des données lit chaque tableau de bord et les tables qui le sous-tendent, associe chaque table à une table surveillée et affiche les tableaux de bord construits sur une table, et sur les tables construites à partir d'elle, dans son onglet **Lignage**, sur ses alertes et dans Production Review.

| Outil | Identifiants |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, un principal de service autorisé à utiliser les API d'administration de Power BI |
| **Hightouch** | `{ "apiKey": "..." }` |
| **Census** | `{ "apiKey": "...", "region": "us" }` (ou `eu`) |

Hightouch et Census sont des outils d'ETL inversé : une synchronisation qui copie une table dans un CRM dépend de cette table comme un tableau de bord, elle est donc lue de la même façon et nommée sur les alertes de la table.

Seuls les noms et liens des tableaux de bord et les tables qu'ils interrogent sont lus : jamais leurs données.

## Pipelines

Chaque job, projet dbt et synchronisation apparaît sous **Pipelines**, avec ses exécutions : quand chacune a commencé et s'est terminée, combien de temps elle a duré, quelle tentative c'était là où le planificateur l'indique (le numéro d'essai d'Airflow), et l'erreur d'une exécution en échec. Après cinq exécutions, chaque pipeline apprend de ses propres exécutions combien de temps dure habituellement une exécution et combien de temps s'écoule entre deux exécutions selon sa planification. La page d'un pipeline recommande trois moniteurs :

- **Pipeline Run Failed** : une exécution a échoué ou a été interrompue.
- **Pipeline Run Unusually Long** : une exécution a pris deux fois sa durée habituelle ou plus, vérifié toutes les cinq minutes pendant qu'elle tourne, si bien qu'une exécution bloquée est repérée avant qu'elle ne se termine.
- **Pipeline Is Late** : aucune exécution n'a démarré depuis plus longtemps que sa planification ne le permet.

## Un seul signalement par cause

Quand une table devient obsolète, chaque table construite à partir d'elle le devient aussi. Avant qu'une alerte de données ne s'ouvre, OneUptime cherche dans le lignage une alerte déjà ouverte sur ce à partir de quoi sa table ou son pipeline est construit : les tables en amont, les pipelines qui y écrivent, et les bases de données où elles se trouvent, jusqu'à cinq niveaux plus haut. S'il en trouve une, la nouvelle alerte est une conséquence de cette alerte :

- Elle démarre à l'état **Pris en compte**, pour que personne ne soit prévenu deux fois pour un même problème, et se rétablit d'elle-même dès que ses données se rétablissent.
- Son fil d'activité et sa carte **Données** indiquent quelle alerte l'a causée, et elle rejoint l'épisode de la cause.

La carte **Données** de la cause liste son **Downstream Impact** : chaque alerte qu'elle a causée. La carte d'une alerte de table montre aussi les services qui écrivent dans la table, avec leurs écritures en échec, ainsi que leurs déploiements et autres changements dans la journée précédant l'alerte.

## Avant qu'un changement ne soit fusionné

Quand une pull request modifie une table surveillée, [Production Review](/docs/ai/ai-agent) indique sur la pull request ce qui en dépend : les services qui la lisent, les tables construites à partir d'elle, les tableaux de bord qui s'appuient sur elle, et ses produits de données. Une table dont une copie se trouve sur une base de données marquée Préproduction indique aussi en quoi la copie diffère : ses lignes, ses colonnes, et ce que les contrôles de la table y lisent, exécutés sur le champ. Sur une base de données que seule une sonde peut atteindre, les contrôles sont omis, et il le dit.

## Prochaines étapes

:::cards
- [Produits de données](/docs/data-observability/data-products): Des SLA de fraîcheur sur les tables qu'utilisent les gens.
- [OneUptime AI et l'API](/docs/data-observability/ai-and-api): Des investigations qui partent de ceux qui écrivent dans une table et de ses exécutions.
:::
