import PageComponentProps from "../PageComponentProps";
import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * How Data Observability works and how to connect a database, on one page:
 * what is read (the catalog, so no value leaves the database), the read-only login each engine
 * needs, how a probe collects a database only the customer's network can
 * reach, and the metrics every table writes - which is how alerts, charts
 * and dashboards are made from table health.
 */
const DOCUMENTATION: string = `
## What Data Observability watches

Every table and view of each connected database, every five minutes:

- **Row count and size**, from the engine's own statistics.
- **When it last changed**: MySQL and SQL Server report it; for PostgreSQL, OneUptime watches the insert, update and delete counters and notes when they move.
- **Its columns**: a column added, removed, renamed, retyped or made nullable goes on the table's timeline and on Schema Changes.
- **Its usual rhythm**: how often it usually changes. A table that goes well past its rhythm shows as **Late**.

Only the database's catalog is read, and on MongoDB the field names of a collection's newest documents. No value leaves the database.

A catalog can say a table changed when only its housekeeping did, or say nothing at all. On a table's **Settings**, name a **Freshness Column** such as \`updated_at\`, and its last change becomes that column's newest value. The login needs to read the column, and it should be indexed.

A PostgreSQL or SQL Server read replica does not move its write counters, so OneUptime leaves them out there and says so on the database.

## The Overview

The **Overview** says how your data stands now. Until the project is set up, it lists the steps left: alerts on every database, owners for the tables, a check, and your pipeline runs. **Needs Attention** lists what needs someone, worst first: a database that could not be read, a pipeline run that failed or is late, a check that is failing or could not run, a reconciliation that drifted, and a late data product or table. Each says who owns it and whether its alert is open, or that nobody is told because its database has no alert on, and opens the page where it is put right. **Databases** shows how each database's last read went and whether its alerts are on.

## Connect a database

Use a **read-only login**. On the Overview or on Databases, choose **Connect a Database**, then either:

- **OneUptime connects**: paste a connection string. It is stored encrypted and never shown again.
- **A probe in my network connects**: pick one of this project's probes and name the probe's environment variable that holds the connection string (for example \`ORDERS_DB_URL\`). The connection string never leaves your network. Update the probe to the latest version first.

A database already connected for Data Security is watched too.

**Databases You Could Connect**, on the same page, lists what your project already knows of and nobody has connected: databases your traces talk to, ones in your cloud accounts, and ones Database Monitoring watches. **Connect** starts the form from what is known of each. Nothing is read until you connect it.

## Storage paths

An export that lands in a bucket every night is as late, or as short, as any table. Under **Storage Paths**, choose **Edit Paths** for a bucket your cloud connection found, on Amazon S3, Google Cloud Storage or an Azure storage account, and name the paths that matter, one per line. Each shows under **Tables**: its newest object is when it last changed, its objects are its rows, and the same alerts apply. Only names, sizes and times are read, never an object.

### A read-only login, per engine

PostgreSQL:

\`\`\`sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
\`\`\`

MySQL and MariaDB (\`performance_schema\` lets OneUptime see writes between collections):

\`\`\`sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
\`\`\`

SQL Server (\`VIEW DATABASE STATE\` lets OneUptime read sizes and last updates):

\`\`\`sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
\`\`\`

Amazon Redshift: connect with a PostgreSQL connection string to the cluster or workgroup endpoint, for example \`postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require\`. \`SYSLOG ACCESS UNRESTRICTED\` lets OneUptime read row counts and sizes (\`svv_table_info\`), the last writes and reads of every user's queries (\`stl_insert\`, \`stl_delete\`, \`stl_scan\`, kept a few days), and the lineage of every user's queries. Without it, a table's rows changing still says when it changed.

\`\`\`sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
\`\`\`

Snowflake: create a user with a key pair (no password), and connect with JSON naming the account identifier, user, private key (unencrypted PKCS#8), database, and a warehouse for checks:

\`\`\`json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
\`\`\`

Collection reads the catalog with SHOW, which needs no warehouse, so it costs no credits. Only data checks run on the warehouse, at the schedule you give them. Snowflake says no table's last change, so a table changed when its rows or bytes moved.

\`\`\`sql
CREATE ROLE ONEUPTIME_READER;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON ALL SCHEMAS IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT REFERENCES ON ALL TABLES IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON WAREHOUSE CHECKS_WH TO ROLE ONEUPTIME_READER;
-- Warehouse spend reads SNOWFLAKE.ACCOUNT_USAGE.
GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE TO ROLE ONEUPTIME_READER;
-- Checks read rows: SELECT on the tables they check.
CREATE USER ONEUPTIME_READER DEFAULT_ROLE = ONEUPTIME_READER RSA_PUBLIC_KEY = 'MIIBIjANBgkqh...';
GRANT ROLE ONEUPTIME_READER TO USER ONEUPTIME_READER;
\`\`\`

Google BigQuery: every dataset your Google Cloud connection found is watched already, with that connection's service account, nothing to connect. Give the service account **BigQuery Metadata Viewer** and **BigQuery Job User** on the project, and **BigQuery Data Viewer** on the tables your checks read. Each collection reads the dataset's \`__TABLES__\` (rows, bytes and last change, at no cost) and its \`INFORMATION_SCHEMA.COLUMNS\` (billed at BigQuery's 10 MB minimum). Add **BigQuery Resource Viewer** on the project for lineage from its jobs, read once an hour (see Lineage the databases say). To connect a dataset without a Google Cloud connection, choose **Google BigQuery** and give JSON with a service account key:

\`\`\`json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
\`\`\`

ClickHouse: connect over its HTTP interface, port 8443 with TLS (ClickHouse Cloud) or 8123 without, for example \`clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics\`. Name a database to watch only it; leave it out to watch every database but the server's own. \`system.parts\` lets OneUptime see each insert between collections (a merge does not count), \`system.part_log\`, where the server keeps it, gives each insert's time, and \`system.query_log\` gives each table's last read and lineage from \`INSERT ... SELECT\`, once an hour. Every statement runs with \`readonly\` set, so even a login that could write cannot.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
-- Checks read rows: SELECT on the tables they check.
\`\`\`

Databricks: one Unity Catalog catalog is a database. Its schemas, tables, views and columns, and each Delta table's last commit, are read from Unity Catalog's REST API with no SQL warehouse, so collection costs no compute. Data checks, and lineage, last writes and last reads from the \`system.access.table_lineage\` system table (once an hour), run on the SQL warehouse you name. Connect with a service principal (or a personal access token in place of \`clientId\` and \`clientSecret\`: \`"token": "dapi..."\`):

\`\`\`json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
\`\`\`

\`\`\`sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO \`oneuptime-reader\`;
GRANT USE SCHEMA ON CATALOG main TO \`oneuptime-reader\`;
GRANT USE CATALOG ON CATALOG system TO \`oneuptime-reader\`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO \`oneuptime-reader\`;
-- Checks read rows: SELECT on the tables they check. And CAN USE on the SQL warehouse.
\`\`\`

Oracle: connect with \`oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1\`, or JSON \`{ "user", "password", "connectString" }\`. It is read over Oracle's own protocol, with no Oracle client to install. The login sees the tables it may read: grant \`READ\` on each one to watch (it can query them, never lock or change them). \`SELECT_CATALOG_ROLE\` lets OneUptime read every table's size; without it, only the login's own tables have one. \`ALL_TAB_MODIFICATIONS\` says each table's inserts, updates and deletes since its last statistics, and when it last changed.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
\`\`\`

Amazon Athena: one Glue database is a database. Its tables and views, their columns and statistics, and each Iceberg table's last commit come from the Glue Data Catalog's API, which reads no data and costs nothing; checks run as Athena queries in the workgroup you name. Connect with the keys of an IAM user or role that may read the Glue database and run Athena queries:

\`\`\`json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
\`\`\`

It needs \`glue:GetDatabase\` and \`glue:GetTables\` on the database and its tables, and for checks \`athena:StartQueryExecution\`, \`athena:GetQueryExecution\`, \`athena:GetQueryResults\` and \`athena:StopQueryExecution\` on the workgroup, with read access to the tables' S3 data and write access to the output location.

MongoDB: connect with its connection string - \`mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/\`, or \`mongodb://\` with a replica set's hosts. A database in the path is the only one watched; without one, every database the login may read is. Each collection's documents, size and writes come from \`$collStats\`, and when it last took a document from its newest \`_id\`. Its fields come from its validator's JSON schema, or else from the names and types of its 100 newest documents' fields, worked out in the database so no value leaves it. Documents are read on a secondary where there is one. A view's source collection is lineage, and a custom check is an aggregation pipeline, as JSON.

\`\`\`javascript
use admin
db.createUser({
  user: "oneuptime_reader",
  pwd: "...",
  roles: [{ role: "readAnyDatabase", db: "admin" }]
})
\`\`\`

To watch one database only, grant \`{ role: "read", db: "orders" }\` in place of \`readAnyDatabase\`.

Microsoft Dataverse: one environment is a database, its tables in \`dbo\`, as its SQL endpoint names them. OneUptime signs in as an app: register one in Microsoft Entra ID with a client secret, and add it to the environment as an application user (Power Platform admin center > the environment > Settings > Users + permissions > Application users) with a security role that may read the tables. Connect with JSON, or with a Dataverse connection string that says \`AuthType=ClientSecret\`. The tenant may be left out: the environment says which one it is in.

\`\`\`json
{ "environmentUrl": "https://contoso.crm.dynamics.com", "tenantId": "...", "clientId": "...", "clientSecret": "..." }
\`\`\`

Every five minutes the Web API gives each table's definition, its rows, from the snapshot Dataverse takes once a day (so they lag by up to a day), and its newest \`modifiedon\`, which is when it last changed. Its columns are read once an hour. Every read counts against the app's Dataverse request limits, and a collection that is asked to slow down leaves the rest to the next one. An environment holds hundreds of tables of its own, so only the core business tables (accounts, contacts, leads, opportunities, quotes, orders, invoices, products, cases, emails, phone calls, appointments, tasks and notes) and your own custom tables are watched. Tables of Microsoft's apps (\`msdyn_\`, \`adx_\` and the other \`ms\` prefixes) are left out: name any other table to watch, as in \`"tables": ["msdyn_workorder"]\`.

Data checks run as read-only SQL on the environment's TDS endpoint, on port 1433 or 5558. It is on unless an admin turned it off; where user level access control for it is on, the app's role needs the **Allow user to access TDS endpoint** privilege. Its SQL has no regular expressions, no \`WITH\` and no sample.

## Metrics every table writes

Each collection writes these for every table, so you can chart them, put them on dashboards and alert on them like any other metric:

| Metric | What it is |
| --- | --- |
| \`oneuptime.data.table.row_count\` | Rows in the table |
| \`oneuptime.data.table.size\` | Bytes the table and its indexes take |
| \`oneuptime.data.table.seconds_since_change\` | Seconds since a row was last inserted, updated or deleted |
| \`oneuptime.data.table.overdue_seconds\` | Seconds the table is past the time it usually changes by; 0 while it is on time. Written once its rhythm is learned |
| \`oneuptime.data.table.row_count_change_percent\` | How much the row count moved since the collection before, in percent (-50 is half the rows gone). Tables under 1,000 rows are left out |
| \`oneuptime.data.table.schema_changes\` | Columns changed since the collection before |
| \`oneuptime.data.table.breaking_schema_changes\` | Columns removed, renamed or retyped since the collection before |

Every row carries \`oneuptime.data.store.id\`, \`oneuptime.data.store.name\`, \`oneuptime.data.table.id\`, \`oneuptime.data.table.schema\`, \`oneuptime.data.table.name\` and \`oneuptime.data.table.key\` (\`schema.table\`). A Metrics monitor grouped by \`oneuptime.data.table.key\` alerts once per table, and its **Anomalously High** and **Anomalously Low** filters compare each table with its own usual value for that hour of the week, so no threshold has to be set.

## Alerts

A database you connect opens on its **Recommended Alerts**; later, choose them for it on **Databases**. Each recommendation is one Metrics monitor for the whole database that alerts once per table, so a table created later is watched too:

| Alert | Fires when |
| --- | --- |
| **Table Is Late** | A table stays past the time it usually changes by for fifteen minutes - the same rule as the **Late** pill |
| **Row Count Fell Sharply** | A table loses half its rows or more between two collections |
| **Row Count Unusually Low** | A table holds far fewer rows than usual for that hour of the week (learns over two weeks) |
| **Schema Changed** | A table's columns are removed, renamed or retyped. A column added breaks nothing, and stays on the timeline |
| **Table Health Stopped Reporting** | No table of the database has been read for fifteen minutes |

Pick severities, on-call policies, owners and labels when you create them. They are ordinary monitors from then on: edit, mute or put them on a status page like any other.

A backfill or a migration should page nobody. Name the database under **Data Observability Databases** on a maintenance event, or put its database server in one, and its data alerts stay quiet while the event is on.

## Owners and labels

A table's **Owners** tab names the people and teams it belongs to, and a table's alert goes to them; with none, to the owners of its database. **Owner Rules** and **Label Rules** apply to every table as it first appears, matched by its labels, or by a regular expression on its name, schema or database. A permission scoped to \`Owned\` reaches only the tables its holder or their teams own, with those tables' checks, activity and reported problems. Owning a database does not make someone an owner of its tables: use an owner rule to give a team a whole database.

## When an alert opens

A table's alert has a **Data** card that says why it most likely happened, ranked: an alert upstream, a failed run, a deploy of a service that writes it, its failing writes, a column that changed, the database or the server it runs on. Below that is what depends on it: tables, dashboards, services and the people who own them.

Say what you made of it: **Useful**, **Expected** (a planned event: nothing changes) or **Not an Issue** (the table is given more room, so the same thing stays quiet next time). If a person finds a problem first, **Report a Problem** on the table records it. **Overview** shows how it adds up: useful issues a week, how many were not noise, how often a problem was raised before someone reported it, how quickly, and how often the likely cause was the real one.


## Data products

The people who use data (analysts, finance, executives, AI agents) think in what they use: "the revenue dashboard's tables", not databases. A data product names those tables, with its owner, its consumers and its freshness SLA. Create one under **Data Products**. Its SLA is either or both of:
- **Fresh by a time of day (UTC):** each day's data lands that day, by then. From that time, every table must have changed that day; until then, yesterday's load stands. A load that is always half an hour late is late for that half hour every day.
- **A maximum age:** no table's last change may be older than this.

Every five minutes each product's tables are checked against its SLA. The product is **Late** when any table is, and its data is as of the oldest last change among them. It writes \`oneuptime.data.product.late_tables\` and \`oneuptime.data.product.data_age\`, so you can chart every product's freshness side by side.

Saving a product also makes, as you and with your permissions:
- **A monitor**, which is the product on a status page. It is Degraded while a table is late, and opens an incident and an alert at your project's least severe level, which resolve on their own. Add it to a status page, private or public, as a resource: consumers who subscribe hear when the product is late, and when it is fresh again.
- **An SLO** over that monitor: the share of the time the data is on time, against the product's SLA target over 30 days, with the fast and slow burn-rate alerts every SLO starts with.

Deleting the product deletes both. Each product also has a **badge** that says what its data is as of, green while on time and amber with "late" once not. Embed it in a BI dashboard, a wiki page or a README from the product's Overview. Its link needs no sign-in, so treat it like a shared link; **Reset Badge Link** makes a new one and retires the old.

## Checks on a table's values

Table health says whether a table changes. A **check** says whether what it holds is right. Add one on a table's **Checks** tab:

| Check | What it reads |
| --- | --- |
| **Null Percent** | Percent of rows whose column is empty |
| **Duplicate Percent** | Percent of values that repeat another row's |
| **Distinct Count** | How many different values the column holds |
| **Minimum**, **Maximum**, **Average**, **Sum** | Of a numeric column (a Sum of no rows is 0) |
| **Invalid Percent** | Percent of values outside a list you give |
| **Format Mismatch Percent** | Percent of values not in a format you pick, such as Email, UUID or Country Code, or that do not match a regular expression of yours (every engine but SQL Server) |
| **Orphan Count** | Rows whose value has no match in another table's column |
| **Row Count** | Rows in the table, most useful with **Segment By** |
| **Custom SQL** | The number one read-only SELECT of yours returns |

**Suggested Checks** on the same tab offer the checks a table's columns call for, from their names and types alone:
- An id is unique.
- A \`customer_id\` has a matching row in \`customers\`.
- An email looks like one, and an amount is not negative.
- A status keeps its usual values.
- A table split by tenant is counted per tenant.

Add one, add them all, or dismiss one for good.

**Segment By** runs a check once per value of a column, such as a tenant or a region: one series and one alert each, for the largest 100 segments. A segmented Row Count alerts when one tenant stops sending data.

Checks run with the database's collection, by OneUptime or by its probe, every 15 minutes, hour, 6 hours or day. Each runs as one aggregate statement in a read-only transaction with a statement timeout: only the number leaves the database, unless a project chooses to keep a masked sample of failing rows. The value is written as \`oneuptime.data.check.value\`, with \`oneuptime.data.check.id\`, \`oneuptime.data.check.name\` and \`oneuptime.data.check.segment\`.

Set **Alert When** to alert on a check:
- **Unusually High** or **Unusually Low** compares each value with its own learned baseline for that hour of the week.
- **Above** or **Below** compares it with a threshold.

Saving the check makes a Metrics monitor for it, as you, with your permissions. Clearing the condition removes the monitor.

**Failing Rows** counts the rows one read-only SELECT of yours returns: the rows that should not exist. 0 is healthy.

Three things keep a check's cost in hand. **Sample Percent** reads a share of the rows, for a check that reads a rate. **Most a Check May Read (GB)**, under **Settings**, stops a check on BigQuery or Athena before it reads more than that. **Wait When a Database Is Busy**, also there, leaves due checks for the next collection when a PostgreSQL, MySQL or SQL Server database looks busy.

**Keep Failing Rows** under **Settings** keeps up to 20 failing rows of a check, with sensitive columns masked before they leave the database. It is off until you turn it on. The rows are stored in OneUptime, on OneUptime's servers on OneUptime Cloud and on your own on a self-hosted install, and turning it off deletes them.

Keep checks in a file in your repository, and apply them from CI with \`oneuptime data-checks apply checks.yaml\`. Run it with \`--dry-run\` on a pull request. A mistake anywhere in the file applies nothing. See the documentation for the file's format.


## Reconciliations

Copies drift: the warehouse has fewer orders than the application's database, or a migration lost rows. A reconciliation compares one measure of two tables, in one database or two:
- **Row Count**
- **Sum** of a column
- **Distinct Count** of a column
- **Custom SQL**: a read-only query that returns one number, named \`value\`.

It has a tolerance, an **Absolute** amount or a **Percent** of the source's value. Create one under **Reconciliations**.

Each side is read by a data check of its own, which the reconciliation makes and keeps, with its database's collection: by OneUptime, or by the database's probe. A reconciliation can therefore compare a PostgreSQL table in your network with its copy in Snowflake or BigQuery. Its checks show on each table's Checks tab and are changed only from the reconciliation.

The two values are compared once both have been read within 15 minutes of each other, and both sides are then scheduled to be read together again. A reconciliation writes:
- \`oneuptime.data.reconciliation.drifted\`: 1 when the two have drifted beyond the tolerance, 0 when they agree. Its monitor reads this, and alerts when they drift.
- \`oneuptime.data.reconciliation.difference\`: the target's value less the source's.
- \`oneuptime.data.reconciliation.difference_percent\`: the difference as a percentage of the source's value.

A side whose check fails says why. A copy that is loaded on a schedule lags its source: compare a measure both have settled on, such as rows older than an hour, with Custom SQL, or allow for the lag in the tolerance.

## Pipelines and lineage, from OpenLineage

Airflow, Dagster, Spark, dbt and Flink describe every run of a job with [OpenLineage](https://openlineage.io) events. Send them to OneUptime, unchanged, with a telemetry ingestion key (Project Settings > Telemetry & APM > Ingestion Keys):

- **URL:** \`https://oneuptime.com/telemetry/openlineage\` (on a self-hosted OneUptime, your own address)
- **Endpoint:** \`api/v1/lineage\`, OpenLineage's default
- **API key:** the ingestion key. It is sent as \`Authorization: Bearer\`, or set \`x-oneuptime-token\`.

For Airflow's OpenLineage provider:

\`\`\`bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
\`\`\`

For any OpenLineage client, set \`OPENLINEAGE_URL\` and \`OPENLINEAGE_API_KEY\`.

Each job appears under **Pipelines**, with its latest run: when it started and ended, how long it took, and the error of a failed run. A run that reads and writes tables OneUptime watches becomes **lineage**: a table's **Lineage** tab shows the tables it is built from, the pipelines that write it with their latest run, and the tables built from it.

Datasets are matched to tables by the OpenLineage naming spec: \`postgres://host:5432\` with \`database.schema.table\`, \`mysql://host:3306\` with \`database.table\`, \`sqlserver://host:1433\` and \`redshift://cluster:5439\` with \`database.schema.table\`, \`snowflake://account\` with \`database.schema.table\`, \`bigquery\` with \`project.dataset.table\`, \`clickhouse://host:8443\` with \`database.table\`, and \`databricks://workspace-host\` with \`catalog.schema.table\`.

Each pipeline learns from its own runs how long a run usually takes (the median of its last 20 completed runs) and how long it goes between runs on its schedule (the longest gap between its last 50 starts that is not a one-off). Both are known after five runs, and fit a job that runs every five minutes as well as one that runs nightly. When your scheduler sends OpenLineage's \`nominalTime\` facet, as Airflow does, a run's scheduled time stands for its start, so a backfill still reads as the schedule.

A pipeline's page recommends three monitors, each created in one click:
- **Pipeline Run Failed**: a run failed or was aborted.
- **Pipeline Run Unusually Long**: a run has taken twice its typical time, or more. It is checked every five minutes while the run is going, so a run that hangs is seen before it ends.
- **Pipeline Is Late**: no run has started for longer than the schedule allows, with a quarter of the interval and at least fifteen minutes of slack.

They read these metrics, each tagged with \`oneuptime.data.pipeline.id\` and \`oneuptime.data.pipeline.name\`:
- \`oneuptime.data.pipeline.run_failed\`: 1 or 0, as each run ends.
- \`oneuptime.data.pipeline.run_duration\`: seconds, as each run ends.
- \`oneuptime.data.pipeline.run_duration_ratio\`: the run's time over the typical run's (counted as at least a minute), as each run ends and every five minutes while it runs.
- \`oneuptime.data.pipeline.overdue_seconds\`: how long past its schedule the next run is, every five minutes; 0 while on time.

A pipeline's page draws its **Lineage**, the first place to look when a run fails or is late: the tables it reads on the left, the tables it writes on the right, and how each is now. Pick more steps to see what those tables are built from and what is built from them; a count of tables not drawn, on the pipeline's card or a table's, draws more of them in place. The same lineage is at \`POST /api/data-observability/pipelines/lineage\`, for your own tools.



## Fivetran and Airbyte syncs

Fivetran and Airbyte load your raw tables, and send no OpenLineage events, but their webhooks say when each sync starts and ends. Each Fivetran connector and Airbyte connection becomes a pipeline under **Pipelines**, and each sync a run, with the same run history, learned duration and schedule, and alerts as any pipeline: a failed run, an unusually long one, and a late one. **Pipelines > Connect Fivetran or Airbyte** fills in the URLs below with one of your ingestion keys.

- **Fivetran:** create a webhook with Fivetran's REST API, for your account or one destination group, with the events \`sync_start\` and \`sync_end\`. Its URL is \`https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>\`, and its secret is that ingestion key. Fivetran signs every delivery with the secret, so the key itself never travels in the URL, and a delivery that is not signed with it is refused.
- **Airbyte:** in your workspace's notification settings, set the webhook to \`https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>\`, and turn it on for failed syncs and successful syncs. Airbyte signs nothing, so its URL carries the key: give Airbyte a key of its own.

A pipeline is named as the tool names the connector or connection, under \`fivetran://<destination group>\` or \`airbyte://<workspace>\`. A failed sync's run shows the tool's error. A Fivetran sync that is rescheduled at an API's rate limit ends as **Rescheduled**: it is not a failure, so it pages no one, and its time teaches no duration.

A Fivetran connector loads the schema of its destination that is named after it. When exactly one watched database has that schema, its tables record the connector as their writer: a table that goes stale points at the sync that should have loaded it, and a failed sync's alert is the cause of the tables' alerts (see One issue per cause). Airbyte names no tables.

## Dashboards in BI tools

The real impact of bad data is the dashboard someone opens. Under **BI Dashboards**, add your BI tools with credentials that may read their dashboards:

| Tool | Credentials (JSON) |
| --- | --- |
| **Metabase** | \`{ "apiKey": "mb_..." }\` (or a user's \`username\` and \`password\`) |
| **Superset** | \`{ "username": "...", "password": "..." }\` |
| **Tableau** | \`{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }\`, a personal access token |
| **Looker** | \`{ "clientId": "...", "clientSecret": "..." }\`, an API client |
| **Power BI** | \`{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }\`, a service principal allowed to use Power BI's admin APIs |
| **Hightouch** | \`{ "apiKey": "..." }\`: each sync is read as one more thing that depends on a table |
| **Census** | \`{ "apiKey": "...", "region": "us" }\`: each sync is read as one more thing that depends on a table |

Every hour, and when a tool is added or you choose **Read Now**, OneUptime reads each dashboard and the tables behind it: a card's table and a native question's SQL (Metabase), a dataset's table or a virtual dataset's SQL (Superset), the Metadata API's upstream tables (Tableau), each tile's explore (Looker), and each report's dataset (Power BI, from a workspace scan). Each table is matched to a watched one by its database, schema and name; a name that still fits two watched tables is left unmatched. A table's **Lineage** tab, its alerts' **Data** card and Production Review list the dashboards built on it, and on the tables built from it. Only names and links are read, never a dashboard's data.

A Power BI tool can also alert on its datasets' failed refreshes. With **Alert on Failed Refreshes** on, as it is for a tool added now, OneUptime keeps one monitor for the tool that opens an alert for each dataset whose last refresh failed or was cancelled, named in the alert's title, and resolves it once a later refresh completes. It reads \`oneuptime.data.bi.refresh_failed\`, tagged with \`oneuptime.data.bi.dataset.name\` and \`oneuptime.data.bi.workspace.name\`: every five minutes, each dataset the hourly read found failing writes 1, and 0 for the hour after a later refresh completes. A refresh still running changes nothing, so one failure is one alert, however many hourly reads see it.

## Jobs in your traces

A Kubernetes CronJob, or a function on a timer, needs nothing installed to show up as a pipeline: spans with \`k8s.cronjob.name\` or \`k8s.job.name\`, or \`faas.name\` with a \`faas.trigger\` of \`timer\` or \`datasource\`, become one, with its runs and the tables its database calls touched. Each run links to its trace and logs, and a CronJob that stops running is seen as late.

## Lineage the databases say

Lineage does not need a pipeline that sends OpenLineage. Each database says some of it itself, and OneUptime reads it with the database's collection:
- **Views:** a view is built from the tables it is defined on, in PostgreSQL, Redshift, MySQL 8 and SQL Server. When a view is redefined or dropped, its old lineage goes with it.
- **Query history:** a query that read one table and wrote another, such as a scheduled query, a dbt model or a MERGE, is lineage too. It comes from BigQuery's jobs (the \`INFORMATION_SCHEMA.JOBS\` view of the dataset's project and location, which needs **BigQuery Resource Viewer**) and Redshift's query log (\`stl_insert\` and \`stl_scan\`, which need \`SYSLOG ACCESS UNRESTRICTED\`). Only jobs run in the dataset's own project are in its jobs view.

Lineage is read once an hour, back to the last read, and a week back at a database's first collection, so it is there from the start. A BigQuery read is billed for the hours of jobs it reads, mostly BigQuery's 10 MB minimum.

Each edge on a table's **Lineage** tab says where it was seen: a pipeline's run, the query history (with a login whose queries moved the data), or a view's definition. Lineage from every source counts for **One issue per cause**.

At the top of a table's **Lineage** tab, a diagram draws its lineage a few steps each way (three, or pick 1, 2 or 5): what it is built from on the left, the tables and dashboards built from it on the right, and the pipelines that load data from outside where it comes in. Each card says how it is now - late, an open alert, a failed run - and an arrow turns red when its pipeline's latest run failed, so a late table can be followed up to the run that broke it. Open any table to center the diagram on it. A card draws at most ten tables each way and counts the rest, such as **+14**: select the count to draw the next of them where they are, and **Reset diagram** to go back. Where the sources name columns, pick one of the table's columns in **Follow a column** to highlight where it comes from and where it goes, even where it is renamed on the way. The same lineage is at \`POST /api/data-observability/tables/lineage\`, for your own tools: send \`"withColumns": true\` for each arrow's columns, and ask \`POST /api/data-observability/lineage/expand\` for a card's next tables.

## dbt

After \`dbt build\` (or run, test, seed or snapshot), send the project's artifacts with the CLI and a telemetry ingestion key. It reads \`target/manifest.json\` and \`target/run_results.json\` and sends only what Data Observability reads of them:

\`\`\`bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
\`\`\`

In CI, run \`oneuptime dbt upload\` as the step after the build, even when the build fails, so failed tests are recorded. For a dbt Cloud job, download its artifacts with dbt Cloud's API, then upload them with \`--manifest\` and \`--run-results\`. Or post them yourself: \`POST /telemetry/dbt/v1/artifacts\` with \`{ "manifest": ..., "run_results": ... }\` and the key in \`x-oneuptime-token\`.

What each upload does:
- **Tables:** each model, seed, snapshot and source that is a table OneUptime watches gets a **dbt** card on its Overview: the node, its materialization, owner, tags and last build. Its dbt description fills the table's description when that is empty. A table is matched by its database, schema and name, for PostgreSQL, MySQL, SQL Server, Redshift, Snowflake, BigQuery, ClickHouse and Databricks. dbt does not know the host, so when two watched databases share a name, their tables are left unmatched, unless only one of them holds the table.
- **Lineage:** what each model is built from becomes lineage on the table's **Lineage** tab, through the project's pipeline.
- **Tests:** each test of a watched table shows on its **Checks** tab, with its last result and the rows it found failing. Click **Alert on Failures** to have a failing test open an alert.
- **Builds:** each build is a run of the project's pipeline under **Pipelines** (namespace \`dbt\`). A build with an error or a failed test is a failed run, so the pipeline alerts work on dbt builds too: failed, unusually long and late.

## Unused tables

Every engine counts the reads of each table in its own statistics:
- PostgreSQL: its scans.
- MySQL: performance_schema's reads.
- SQL Server: its seeks, scans and lookups, with the time of the last.

Each collection compares the counter with the last one kept, so a table's **Last Read** is known to the hour, and so is the time since which it has had none. A counter of 0 at a table's first collection means it has not been read since the engine's statistics started, so an unused table shows as unused from the start, not after months of watching. A read seen in a service's database spans counts too.

**Unused Tables** lists the tables nobody has read for 90 days, biggest first, with when each was last written: a table still written but never read costs its writes and its storage. The Overview shows how many there are and what they hold. Views keep no counters of their own, so they are never listed. When the database login cannot read the counters, a table's last read is not known.

## Warehouse spend

Once an hour, with each warehouse's collection, OneUptime reads what Snowflake and BigQuery spent over the last day, job by job: Snowflake's compute credits from \`QUERY_ATTRIBUTION_HISTORY\` (with \`IMPORTED PRIVILEGES\` on the \`SNOWFLAKE\` database, run on the connection's warehouse), and BigQuery's bytes billed from its jobs view (with **BigQuery Resource Viewer**). A job is one query run again and again - Snowflake's parameterized query, BigQuery's query with its literals left out - named by its query tag or label, or by what it does and the table it writes, and never by its query's text.

**Warehouse Spend** shows the day's credits and bytes billed, by team (the \`team\` in a job's query tag or label, else whoever runs it), the tables whose writes cost the most (a job's spend shared among the tables it writes, where Snowflake's ACCESS_HISTORY or BigQuery's destination table says which), the jobs that failed, and what goes to jobs that write only tables nobody has read for 90 days.

## One issue per cause

When a table goes stale, every table built from it goes stale too. Before a data alert opens, OneUptime looks up lineage for an alert already open on what its table or pipeline is built from: the tables upstream, the pipelines that write them, and the databases they live in, up to five steps up. When it finds one, the new alert is that alert's consequence:
- It starts **acknowledged**, so nobody is paged twice for one problem. It recovers on its own once its data does.
- Its feed says which alert caused it, and so does its **Data** card.
- It joins the cause's episode, when the cause is in one.

The cause's **Data** card lists its **Downstream Impact**: every alert it caused. A table alert's card also shows the services that write the table, with their failed writes, and their deploys and other changes in the day before the alert.

Under the **Data** card, an alert's page draws its **Lineage**: around its table, as the table's **Lineage** tab draws it, or around its pipeline, with the way up to the alert that caused it and down to each alert it caused highlighted, the cause marked **Cause** and each alert it caused **Consequence**. When the cause is on a pipeline drawn on an arrow, the arrow says **Cause** under the pipeline's name. An alert from a check on one column, such as a Null Percent check on \`customer_id\`, opens with that column followed beside these ways, as on the table's **Lineage** tab; pick another of the table's columns there, or clear it to see the ways alone. Someone who may not see the alert that caused it gets neither the **Data** card nor the lineage, and an alert it caused that they may not see is neither highlighted nor counted. The same lineage is at \`POST /api/data-observability/alerts/<alert ID>/lineage\`, with the \`column\` a column check's alert reads and the columns each arrow carries.


## OneUptime AI

- **Investigations of data alerts.** When OneUptime AI investigates an alert on a table, a pipeline or a database, it reads what is next to it: the table's freshness and open alerts, the alert it is a consequence of, the runs of the pipelines that write it since the day before (a failed run with its error), the services that write it with their failed writes and their deploys and other changes, and its lineage: the tables it is built from and the tables built from it, the ones with a problem first, with where the alert it is a consequence of sits and which tables the alerts it caused are on. For an alert from a check on one column, it also follows that column through the lineage: the columns it is built from upstream and the columns built from it downstream, table by table. It names the run, deploy or upstream table behind the alert.
- **A check from a sentence.** On a table's Checks tab, **Write a Check from a Sentence** turns a rule such as "orders never have a negative total" into a Custom SQL check that counts the rows breaking it, with an alert when any do. You read the query before **Add Check** adds it, and it is held to everything any Custom SQL check is: one read-only statement, run in a read-only transaction.
- **Is this table fresh?** Ask OneUptime AI in Ask AI, Slack or Microsoft Teams ("is the orders table fresh?"). It answers with the table's freshness by its own rhythm, when it last changed, its open alerts, its writers' latest runs and the data products it is part of. AI agents ask the same through the MCP server's \`get_data_table_freshness\` tool, before they use the data.
- **What is this table built from?** Ask the same way ("what feeds the revenue table?", "what breaks if raw.orders stops loading?"). It follows the table's lineage three steps each way, or up to five when asked, and puts the tables upstream and downstream that are late, dropped, have open alerts or whose pipeline failed its last run first, nearest first, with how many steps away each is and the tables between; then the rest, the pipelines that load its sources from outside what OneUptime watches, and the BI dashboards built on it. Open alerts are counted, never named, and only those the person who asks may see. AI agents ask the same through the MCP server's \`get_data_table_lineage\` tool, before they change a table.

## Services that use each table

A table's **Services** tab lists the services seen writing and reading it, with the statements each ran, its calls and failures in the last hour, and when it was last seen. It comes from the database spans your services already send with OpenTelemetry: a client span with \`db.system.name\`, \`db.namespace\` and \`db.collection.name\` (or \`db.sql.table\`, or a span named like \`INSERT orders\`). Nothing extra to install. It is updated every 15 minutes.

Each service also shows the endpoints that make its calls, and is marked **AI app** when it calls a model too. **Errors Naming This Table** lists the open exceptions and the last day's error logs from the services that write the table, when they mention it by name.

A span is tied to a table only when its database is the one a collection read, and when two databases share a name, only when its \`server.address\` is one of theirs. When it is not sure, it leaves the span out.

These metrics are OneUptime's own operational data and are not billed as telemetry.
`;

const DataObservabilityDocumentationPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Card
      title="Documentation"
      description="How Data Observability watches your tables, and how to connect a database."
    >
      <MarkdownViewer text={DOCUMENTATION} />
    </Card>
  );
};

export default DataObservabilityDocumentationPage;
