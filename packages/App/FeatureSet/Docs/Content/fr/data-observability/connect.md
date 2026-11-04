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

## Bases de données que vous pourriez connecter

**Bases de données que vous pourriez connecter**, sous **Bases de données**, liste ce que votre projet connaît déjà et que personne n'a connecté : les bases de données avec lesquelles vos traces communiquent, celles de vos comptes cloud, et celles que Database Monitoring surveille. **Connecter** démarre le formulaire à partir de ce que l'on sait de chacune, avec une chaîne de connexion à renseigner. **Masquer** l'empêche de revenir. Rien n'est lu tant que vous ne la connectez pas.

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
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
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
GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE TO ROLE ONEUPTIME_READER;
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
@tab Oracle
```sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
```

Oracle est lu par son propre protocole, sans client Oracle à installer : `oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1`. L'utilisateur voit les tables qu'il peut lire : accordez `READ` sur chaque table à surveiller, ce qui lui permet de les interroger sans jamais les verrouiller ni les modifier. `SELECT_CATALOG_ROLE` permet à OneUptime de lire la taille de chaque table, et `ALL_TAB_MODIFICATIONS` donne les inserts, updates et deletes de chaque table depuis ses dernières statistiques, et quand elle a changé pour la dernière fois.
@tab Amazon Athena
Une base de données Glue est une base de données. Ses tables et vues, leurs colonnes et statistiques, et le dernier commit de chaque table Iceberg viennent de l'API du Glue Data Catalog, qui ne lit aucune donnée et ne coûte rien. Les contrôles s'exécutent comme des requêtes Athena dans le workgroup que vous indiquez. Connectez-vous avec les clés d'un utilisateur ou d'un rôle IAM autorisé à appeler `glue:GetDatabase` et `glue:GetTables` et, pour les contrôles, à exécuter des requêtes Athena dans le workgroup avec un accès en lecture aux données des tables :

```json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
```
@tab MongoDB
```javascript
use admin
db.createUser({
  user: "oneuptime_reader",
  pwd: "...",
  roles: [{ role: "readAnyDatabase", db: "admin" }]
})
```

MongoDB est lu par son propre pilote : `mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/`, ou `mongodb://` avec les hôtes d'un replica set. Une base nommée dans le chemin est la seule surveillée ; sans elle, chaque base que l'utilisateur peut lire est surveillée, et `{ role: "read", db: "orders" }` à la place de `readAnyDatabase` le limite à une seule. Les documents, la taille et les écritures de chaque collection viennent de `$collStats`, et le moment où elle a reçu son dernier document, de son `_id` le plus récent. Ses champs viennent du schéma JSON de son validateur, ou sinon des noms et types des champs de ses 100 documents les plus récents, calculés dans la base pour qu'aucune valeur n'en sorte. Les documents sont lus sur un secondaire quand il y en a un, et un contrôle personnalisé est un pipeline d'agrégation, en JSON.
:::

## Ce qui est lu, et à quelle fréquence

| Quoi | Quand |
| --- | --- |
| Tables, vues, colonnes, lignes, taille et dernière modification | Toutes les cinq minutes |
| Contrôles | Toutes les 15 minutes, toutes les heures, toutes les 6 heures ou tous les jours, selon chacun |
| Lignage et dernières lectures tirés de l'historique des requêtes | Une fois par heure, en remontant jusqu'à la dernière lecture |

Chaque instruction s'exécute en lecture seule, avec un délai d'expiration d'instruction et de verrou là où le moteur en dispose. La chaîne de connexion n'est jamais journalisée et elle est retirée de chaque message d'erreur. Une statistique que le compte n'a pas le droit de lire est omise, avec un avertissement sur la base de données, et ne fait jamais échouer la collecte. Les connexions vers des adresses privées sont refusées sur OneUptime Cloud : utilisez une sonde.

## Réplicas en lecture

Un réplica en lecture PostgreSQL ou SQL Server ne fait pas avancer ses compteurs d'écriture, si bien qu'une table peut y sembler inchangée alors qu'elle change. OneUptime voit que c'est un réplica, écarte les compteurs, le signale sur la base de données, et se rabat sur la taille et les lignes de la table. Connectez le primaire quand vous le pouvez, ou nommez une [colonne de fraîcheur](/docs/data-observability/table-health) pour les tables qui comptent.

## Chemins de stockage

Tout ce sur quoi vous comptez n'est pas dans une base de données. Un export qui arrive chaque nuit dans un bucket est aussi en retard, ou aussi court, que n'importe quelle table. Sous **Chemins de stockage**, choisissez **Modifier les chemins** pour un bucket trouvé par votre [connexion cloud](/docs/telemetry/cloud-accounts), sur Amazon S3, Google Cloud Storage ou un compte de stockage Azure, et nommez les chemins qui comptent, un par ligne. Sur Azure, commencez chacun par le nom de son conteneur.

Chaque chemin apparaît alors sous **Tables** : son objet le plus récent est sa dernière modification, ses objets sont ses lignes, et leur taille est sa taille, et les mêmes alertes s'appliquent. Seuls les noms, tailles et heures sont lus, jamais un objet. Un chemin qui contient plus de 10000 objets n'a ni nombre exact, ni taille exacte, ni objet le plus récent exact, et le signale : nommez-en un plus étroit.

## Dépannage

- **La base de données affiche le statut Échec.** Son message indique pourquoi : un hôte que OneUptime ne peut pas joindre, un compte refusé, un mode TLS que le serveur n'accepte pas. Pour une base de données à l'intérieur de votre réseau, connectez-la via une sonde.
- **Les tables n'affichent aucune dernière modification.** Le compte ne peut pas lire les statistiques du moteur : accordez ce que liste l'onglet de votre moteur, ou attendez que les lignes d'une table aient changé deux fois.
- **Une table manque.** Elle se trouve dans un schéma que le compte ne peut pas utiliser, ou elle est exclue sur la base de données. Accordez `USAGE` sur son schéma, ou supprimez l'exclusion.
- **Une table MySQL n'a aucune colonne.** Le compte a besoin de `REFERENCES`, comme ci-dessus : il montre les colonnes d'une table sans donner aucune lecture de ses lignes.

## Prochaines étapes

:::cards
- [Santé des tables](/docs/data-observability/table-health): Ce que chaque collecte apprend sur chaque table, et les alertes qu'elle recommande.
- [Contrôles et rapprochements](/docs/data-observability/checks): Des règles sur ce que contient une table.
:::
