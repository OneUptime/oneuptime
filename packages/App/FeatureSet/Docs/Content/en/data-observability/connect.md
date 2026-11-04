# Connect a Database

Data Observability reads each database with a login that only reads its catalog: which tables and views it holds, their columns, rows and size, and when they changed. This page gives the least each engine needs, and how to keep the connection string inside your network with a probe.

## Before you begin

- **A role that can connect databases**: Project Owner, Project Admin or Telemetry Admin.
- **A read-only login**, made with the statements below. Checks you add later read rows of the tables they check, so give the login `SELECT` on those tables only when you add one.

## Choose who connects

On **Data Observability > Databases**, choose **Connect a Database**, then:

- **OneUptime connects**: paste a connection string. It is stored encrypted, used only by OneUptime's workers, and never shown again.
- **A probe in my network connects**: pick one of your probes and name the environment variable on the probe that holds the connection string, such as `ORDERS_DB_URL`. The connection string never leaves your network. See [Custom Probes](/docs/probe/custom-probe).

A database already connected for Data Security is watched too, with nothing to connect, and so is every BigQuery dataset your [cloud connection](/docs/telemetry/cloud-accounts) found.

## A read-only login, per engine

:::tabs
@tab PostgreSQL
```sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
```

The connection string: `postgres://oneuptime_reader:...@orders-db.internal:5432/orders?sslmode=require`. OneUptime reads `pg_class`, `pg_stat_user_tables` and `pg_attribute`: a table changed when its insert, update or delete counters moved, and was read when its scan counters did.
@tab MySQL and MariaDB
```sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
```

`performance_schema` lets OneUptime see writes and reads between collections; without it, `information_schema.TABLES` still says when each table last changed.
@tab SQL Server
```sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
```

`VIEW DATABASE STATE` lets OneUptime read sizes, last updates and last reads.
@tab Amazon Redshift
```sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
```

Connect with a PostgreSQL connection string to the cluster or workgroup endpoint, such as `postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require`. `SYSLOG ACCESS UNRESTRICTED` lets OneUptime read row counts and sizes, every user's last writes and reads, and lineage from the query log. Without it, a table's rows changing still says when it changed.
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

Snowflake is read over its SQL API with key-pair authentication. Connect with JSON:

```json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
```

The catalog is read with `SHOW`, which needs no warehouse, so collection costs no credits. Only checks run on the warehouse, on the schedule you give them.
@tab Google BigQuery
Every dataset your cloud connection found is watched with that connection's service account. Give it **BigQuery Metadata Viewer** and **BigQuery Job User** on the project to read the catalog, **BigQuery Data Viewer** on the tables your checks read, and **BigQuery Resource Viewer** for lineage from its jobs.

Each collection reads the dataset's `__TABLES__` (rows, bytes and last change, at no cost) and its `INFORMATION_SCHEMA.COLUMNS` (billed at BigQuery's 10 MB minimum). To connect a dataset without a cloud connection, give JSON with a service account key:

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

ClickHouse is read over its HTTP interface, port 8443 with TLS (ClickHouse Cloud) or 8123 without: `clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics`. Name a database to watch only it, or leave it out to watch every database but the server's own. `system.parts` lets OneUptime see each insert (a merge does not count), `system.part_log`, where the server keeps it, gives each insert's time, and `system.query_log` gives last reads and lineage once an hour. Every statement runs read-only, so even a login that could write cannot.
@tab Databricks
```sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO `oneuptime-reader`;
GRANT USE SCHEMA ON CATALOG main TO `oneuptime-reader`;
GRANT USE CATALOG ON CATALOG system TO `oneuptime-reader`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO `oneuptime-reader`;
```

One Unity Catalog catalog is one database. Connect with a service principal, or with a personal access token as `"token"` in place of `clientId` and `clientSecret`:

```json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
```

The catalog, its columns and each Delta table's last commit come from Unity Catalog's REST API with no SQL warehouse, so collection costs no compute. Checks, and lineage and last reads from `system.access.table_lineage` once an hour, run on the SQL warehouse you name; give the service principal **Can use** on it.
@tab Oracle
```sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
```

Oracle is read over its own protocol, with no Oracle client to install: `oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1`. The login sees the tables it may read: grant `READ` on each one to watch, which lets it query them and never lock or change them. `SELECT_CATALOG_ROLE` lets OneUptime read every table's size, and `ALL_TAB_MODIFICATIONS` gives each table's inserts, updates and deletes since its last statistics, and when it last changed.
@tab Amazon Athena
One Glue database is one database. Its tables and views, their columns and statistics, and each Iceberg table's last commit come from the Glue Data Catalog's API, which reads no data and costs nothing. Checks run as Athena queries in the workgroup you name. Connect with the keys of an IAM user or role that may call `glue:GetDatabase` and `glue:GetTables`, and for checks run Athena queries in the workgroup with read access to the tables' data:

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

MongoDB is read over its own driver: `mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/`, or `mongodb://` with a replica set's hosts. A database in the path is the only one watched; without one, every database the login may read is watched, and `{ role: "read", db: "orders" }` in place of `readAnyDatabase` limits it to one. Each collection's documents, size and writes come from `$collStats`, and when it last took a document from its newest `_id`. Its fields come from its validator's JSON schema, or else from the names and types of the fields of its 100 newest documents, worked out in the database so no value leaves it. Documents are read on a secondary where there is one, and a custom check is an aggregation pipeline, as JSON.
:::

## What is read, and how often

| What | When |
| --- | --- |
| Tables, views, columns, rows, size and last change | Every five minutes |
| Checks | Every 15 minutes, hour, 6 hours or day, as each says |
| Lineage and last reads from query history | Once an hour, back to the last read |

Every statement runs read-only, with a statement and lock timeout where the engine has them. The connection string is never logged and is taken out of every error. A statistic the login may not read is left out with a warning on the database, never a failed collection.

## Troubleshooting

- **The database shows Failed.** Its message says why: a host OneUptime cannot reach, a login refused, a TLS mode the server does not accept. For a database inside your network, connect it through a probe.
- **Tables show no last change.** The login cannot read the engine's statistics: grant what your engine's tab lists, or wait for a table's rows to change twice.
- **A table is missing.** It is in a schema the login cannot use, or it is excluded on the database. Grant `USAGE` on its schema, or remove the exclusion.

## Next steps

:::cards
- [Table Health](/docs/data-observability/table-health): What each collection learns about every table, and the alerts it recommends.
- [Checks and Reconciliations](/docs/data-observability/checks): Rules on what a table holds.
:::
