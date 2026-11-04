# Lineage and Pipelines

Lineage says which tables each table is built from, and which pipelines write it. Data Observability gathers it from five places at once - OpenLineage events, dbt, Fivetran and Airbyte syncs, views, and each database's own query history - and uses it to tie every late or broken table to the run behind it, so one problem opens one issue.

## Where lineage comes from

| Source | What it gives |
| --- | --- |
| **OpenLineage** | Every run of an Airflow, Dagster, Spark, dbt or Flink job, the tables it read and wrote |
| **dbt** | What each model is built from, each build as a run, and each test's result |
| **Fivetran and Airbyte** | Each sync as a run of its connector, and the raw tables it loads |
| **Views** | A view is built from the tables it is defined on (PostgreSQL, Redshift, MySQL 8, SQL Server, Oracle, ClickHouse materialized views, Databricks, MongoDB) |
| **Query history** | A query that read one table and wrote another (BigQuery's jobs, Redshift's query log, ClickHouse's query log, Databricks' lineage table) |

A table's **Lineage** tab shows the tables it is built from, the pipelines that write it with their latest run, and the tables built from it. Each edge says where it was seen.

## OpenLineage

Send OpenLineage events to OneUptime, unchanged, with a telemetry [ingestion key](/docs/telemetry/ingestion-keys):

- **URL:** `https://oneuptime.com/telemetry/openlineage` (on a self-hosted OneUptime, your own address)
- **Endpoint:** `api/v1/lineage`, OpenLineage's default
- **API key:** the ingestion key, sent as `Authorization: Bearer`, or set `x-oneuptime-token`

For Airflow's OpenLineage provider:

```bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
```

For any other OpenLineage client, set `OPENLINEAGE_URL` and `OPENLINEAGE_API_KEY`. Datasets are matched to tables by the OpenLineage naming spec, such as `postgres://host:5432` with `database.schema.table`, `snowflake://account` with `database.schema.table`, `clickhouse://host:8443` with `database.table`, and `databricks://workspace-host` with `catalog.schema.table`.

## dbt

After `dbt build` (or run, test, seed or snapshot), send the project's artifacts with the [OneUptime CLI](/docs/cli/index):

```bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
```

In CI, run `oneuptime dbt upload` as the step after the build, even when the build fails, so failed tests are recorded. Each table dbt builds gets a **dbt** card on its Overview, its models' lineage, and its tests on its **Checks** tab; each build is a run of the project's pipeline.

## Fivetran and Airbyte

Their webhooks say when each sync starts and ends. **Pipelines > Connect Fivetran or Airbyte** fills in the URLs with one of your ingestion keys:

- **Fivetran:** a webhook made with Fivetran's REST API, for the events `sync_start` and `sync_end`, to `https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>`, with the ingestion key as its secret. Fivetran signs every delivery with it, so the key never travels in the URL.
- **Airbyte:** the workspace's webhook set to `https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>`, on for failed and successful syncs. Give Airbyte a key of its own.

A Fivetran sync rescheduled at an API's rate limit ends as **Rescheduled**: not a failure, so it pages no one.

## Dashboards in BI tools

The real impact of bad data is the dashboard someone opens. Under **BI Dashboards**, add your BI tools with credentials that may read their dashboards. Every hour Data Observability reads each dashboard and the tables behind it, matches each table to a watched one, and lists the dashboards built on a table, and on the tables built from it, on its **Lineage** tab, on its alerts and in Production Review.

| Tool | Credentials |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, a service principal allowed to use Power BI's admin APIs |

Only dashboards' names and links, and the tables they query, are read: never their data.

## Pipelines

Each job, dbt project and sync appears under **Pipelines**, with its runs: when each started and ended, how long it took, and a failed run's error. Each pipeline learns from its own runs how long a run usually takes and how long it goes between runs on its schedule, after five runs. A pipeline's page recommends three monitors:

- **Pipeline Run Failed**: a run failed or was aborted.
- **Pipeline Run Unusually Long**: a run has taken twice its typical time or more, checked every five minutes while it runs, so a run that hangs is seen before it ends.
- **Pipeline Is Late**: no run has started for longer than its schedule allows.

## One issue per cause

When a table goes stale, every table built from it goes stale too. Before a data alert opens, OneUptime looks up lineage for an alert already open on what its table or pipeline is built from: the tables upstream, the pipelines that write them, and the databases they live in, up to five steps up. When it finds one, the new alert is that alert's consequence:

- It starts **acknowledged**, so nobody is paged twice for one problem, and recovers on its own once its data does.
- Its feed and its **Data** card say which alert caused it, and it joins the cause's episode.

The cause's **Data** card lists its **Downstream Impact**: every alert it caused. A table alert's card also shows the services that write the table, with their failed writes, and their deploys and other changes in the day before the alert.

## Next steps

:::cards
- [Data Products](/docs/data-observability/data-products): Freshness SLAs over the tables people use.
- [OneUptime AI and the API](/docs/data-observability/ai-and-api): Investigations that start from a table's writers and runs.
:::
