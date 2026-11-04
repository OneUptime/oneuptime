# Connecter une base de données

Observabilité des données lit chaque base de données avec un compte qui ne lit que son catalogue : les tables et les vues qu'elle contient, leurs colonnes, leurs lignes et leur taille, et le moment où elles ont changé. Cette page indique le minimum dont chaque moteur a besoin, et comment garder la chaîne de connexion dans votre réseau grâce à une sonde.

## Avant de commencer

- **Un rôle qui peut connecter des bases de données** : Propriétaire du projet, Administrateur du projet ou Administrateur de la télémétrie.
- **Un compte en lecture seule**, créé avec les instructions ci-dessous. Les contrôles que vous ajouterez plus tard lisent des lignes des tables qu'ils contrôlent : n'accordez donc au compte `SELECT` sur ces tables qu'au moment où vous en ajoutez un.

## Choisir qui se connecte

Dans **Observabilité des données > Bases de données**, choisissez **Connect a Database**, puis :

- **OneUptime connects** : collez une chaîne de connexion. Elle est stockée chiffrée, utilisée uniquement par les workers de OneUptime, et n'est plus jamais affichée.
- **A probe in my network connects** : choisissez l'une de vos sondes et indiquez la variable d'environnement de la sonde qui contient la chaîne de connexion, comme `ORDERS_DB_URL`. La chaîne de connexion ne quitte jamais votre réseau. Voir [Sondes personnalisées](/docs/probe/custom-probe).

Une base de données déjà connectée pour Sécurité des données est elle aussi surveillée, sans rien connecter, tout comme chaque jeu de données BigQuery trouvé par votre [connexion cloud](/docs/telemetry/cloud-accounts).

## Un compte en lecture seule, par moteur

:::tabs
@tab PostgreSQL
```sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
```

La chaîne de connexion : `postgres://oneuptime_reader:...@orders-db.internal:5432/orders?sslmode=require`. OneUptime lit `pg_class`, `pg_stat_user_tables` et `pg_attribute` : une table a changé quand ses compteurs d'insertions, de mises à jour ou de suppressions ont bougé, et a été lue quand ses compteurs de parcours ont bougé.
@tab MySQL and MariaDB
```sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
```

`performance_schema` permet à OneUptime de voir les écritures et les lectures entre deux collectes ; sans lui, `information_schema.TABLES` indique tout de même quand chaque table a changé pour la dernière fois.
@tab SQL Server
```sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
```

`VIEW DATABASE STATE` permet à OneUptime de lire les tailles, les dernières mises à jour et les dernières lectures.
@tab Amazon Redshift
```sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
```

Connectez-vous avec une chaîne de connexion PostgreSQL vers le point de terminaison du cluster ou du groupe de travail, comme `postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require`. `SYSLOG ACCESS UNRESTRICTED` permet à OneUptime de lire le nombre de lignes et les tailles, les dernières écritures et lectures de chaque utilisateur, et le lignage tiré du journal des requêtes. Sans lui, un changement du nombre de lignes d'une table indique tout de même quand elle a changé.
@tab Snowflake
```sql
CREATE ROLE ONEUPTIME_READER;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON ALL SCHEMAS IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT REFERENCES ON ALL TABLES IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON WAREHOUSE CHECKS_WH TO ROLE ONEUPTIME_READER;
CREATE USER ONEUPTIME_READER DEFAULT_ROLE = ONEUPTIME_READER RSA_PUBLIC_KEY = 'MIIBIjANBgkqh...';
GRANT ROLE ONEUPTIME_READER TO USER ONEUPTIME_READER;
```

Snowflake est lu via son API SQL avec une authentification par paire de clés. Connectez-vous avec du JSON :

```json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
```

Le catalogue est lu avec `SHOW`, qui n'a besoin d'aucun entrepôt : la collecte ne coûte donc aucun crédit. Seuls les contrôles s'exécutent sur l'entrepôt, selon la planification que vous leur donnez.
@tab Google BigQuery
Chaque jeu de données trouvé par votre connexion cloud est surveillé avec le compte de service de cette connexion. Accordez-lui **BigQuery Metadata Viewer** et **BigQuery Job User** sur le projet pour lire le catalogue, **BigQuery Data Viewer** sur les tables que lisent vos contrôles, et **BigQuery Resource Viewer** pour le lignage tiré de ses jobs.

Chaque collecte lit la table `__TABLES__` du jeu de données (lignes, octets et dernière modification, sans frais) et sa vue `INFORMATION_SCHEMA.COLUMNS` (facturée au minimum de 10 Mo de BigQuery). Pour connecter un jeu de données sans connexion cloud, donnez du JSON avec une clé de compte de service :

```json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
```
@tab ClickHouse
```sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
```

ClickHouse est lu via son interface HTTP, sur le port 8443 avec TLS (ClickHouse Cloud) ou 8123 sans : `clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics`. Indiquez une base de données pour ne surveiller qu'elle, ou omettez-la pour surveiller toutes les bases de données sauf celles du serveur lui-même. `system.parts` permet à OneUptime de voir chaque insertion (une fusion ne compte pas), `system.part_log`, là où le serveur le tient, donne l'heure de chaque insertion, et `system.query_log` donne les dernières lectures et le lignage une fois par heure. Chaque instruction s'exécute en lecture seule, si bien que même un compte qui pourrait écrire ne le peut pas.
@tab Databricks
```sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO `oneuptime-reader`;
GRANT USE SCHEMA ON CATALOG main TO `oneuptime-reader`;
GRANT USE CATALOG ON CATALOG system TO `oneuptime-reader`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO `oneuptime-reader`;
```

Un catalogue Unity Catalog correspond à une base de données. Connectez-vous avec un principal de service, ou avec un jeton d'accès personnel passé comme `"token"` à la place de `clientId` et `clientSecret` :

```json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
```

Le catalogue, ses colonnes et le dernier commit de chaque table Delta viennent de l'API REST d'Unity Catalog, sans entrepôt SQL : la collecte ne coûte donc aucune ressource de calcul. Les contrôles, ainsi que le lignage et les dernières lectures tirés de `system.access.table_lineage` une fois par heure, s'exécutent sur l'entrepôt SQL que vous indiquez ; accordez-y **Can use** au principal de service.
:::

## Ce qui est lu, et à quelle fréquence

| Quoi | Quand |
| --- | --- |
| Tables, vues, colonnes, lignes, taille et dernière modification | Toutes les cinq minutes |
| Contrôles | Toutes les 15 minutes, toutes les heures, toutes les 6 heures ou tous les jours, selon chacun |
| Lignage et dernières lectures tirés de l'historique des requêtes | Une fois par heure, en remontant jusqu'à la dernière lecture |

Chaque instruction s'exécute en lecture seule, avec un délai d'expiration d'instruction et de verrou là où le moteur en dispose. La chaîne de connexion n'est jamais journalisée et elle est retirée de chaque message d'erreur. Une statistique que le compte n'a pas le droit de lire est omise, avec un avertissement sur la base de données, et ne fait jamais échouer la collecte.

## Dépannage

- **La base de données affiche le statut Échec.** Son message indique pourquoi : un hôte que OneUptime ne peut pas joindre, un compte refusé, un mode TLS que le serveur n'accepte pas. Pour une base de données à l'intérieur de votre réseau, connectez-la via une sonde.
- **Les tables n'affichent aucune dernière modification.** Le compte ne peut pas lire les statistiques du moteur : accordez ce que liste l'onglet de votre moteur, ou attendez que les lignes d'une table aient changé deux fois.
- **Une table manque.** Elle se trouve dans un schéma que le compte ne peut pas utiliser, ou elle est exclue sur la base de données. Accordez `USAGE` sur son schéma, ou supprimez l'exclusion.

## Prochaines étapes

:::cards
- [Santé des tables](/docs/data-observability/table-health): Ce que chaque collecte apprend sur chaque table, et les alertes qu'elle recommande.
- [Contrôles et rapprochements](/docs/data-observability/checks): Des règles sur ce que contient une table.
:::
