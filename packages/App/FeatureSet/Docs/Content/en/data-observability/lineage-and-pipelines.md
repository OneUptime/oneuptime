# Lineage and Pipelines

Lineage says which tables each table is built from, and which pipelines write it. Data Observability gathers it from six places at once - OpenLineage events, dbt, Fivetran and Airbyte syncs, jobs in your traces, views, and each database's own query history - and uses it to tie every late or broken table to the run behind it, so one problem opens one issue.

## Where lineage comes from

| Source | What it gives |
| --- | --- |
| **OpenLineage** | Every run of an Airflow, Dagster, Spark, dbt or Flink job, the tables it read and wrote |
| **dbt** | What each model is built from, each build as a run, and each test's result |
| **Fivetran and Airbyte** | Each sync as a run of its connector, and the raw tables it loads |
| **Jobs in your traces** | A Kubernetes CronJob or a scheduled function, its runs, and the tables its database calls read and wrote |
| **Views** | A view is built from the tables it is defined on (PostgreSQL, Redshift, MySQL 8, SQL Server, Oracle, Snowflake, ClickHouse materialized views, Databricks, MongoDB) |
| **Query history** | A query that read one table and wrote another (Snowflake's access history, BigQuery's jobs, Redshift's query log, ClickHouse's query log, Databricks' lineage table) |

A table's **Lineage** tab shows the tables it is built from, the pipelines that write it with their latest run, and the tables built from it. Each edge says where it was seen.

At the top of the tab, a diagram draws that lineage a few steps each way (three, or pick 1, 2 or 5): what the table is built from on the left, the tables and dashboards built from it on the right, and the pipelines that load data from outside where it comes in. Each card says how it is now - late, an open alert, a failed run - and an arrow turns red when its pipeline's latest run failed, so a late table can be followed up to the run that broke it. Open any table to center the diagram on it.

A card draws at most ten tables each way and counts the rest, such as **+14**. Select the count to draw up to ten more of them where they are, problems first, with every arrow between them and what is drawn already. **Reset diagram** goes back to the diagram as it was first drawn. Once a side holds as many tables as one diagram can, open a table to center the diagram on it.

Where the source names columns, a table's **Columns** tab says where each column comes from and what it feeds: Snowflake's access history (Enterprise edition, which needs `IMPORTED PRIVILEGES` on the `SNOWFLAKE` database), and OpenLineage's `columnLineage` facet.

On the **Lineage** tab, pick one of the table's columns in **Follow a column** to highlight where it comes from and where it goes: up the diagram to the columns it is built from, down to the columns built from it, each named on its table, even where it was renamed on the way. An arrow whose sources name no columns may carry it further than is highlighted, and the diagram says so.

Every lineage view - a table's **Lineage** tab, a pipeline's, an alert's, the **Lineage Map**, and what OneUptime AI and the API tell - shows only the tables and pipelines your role lets you read. A role limited to what its members own, or to some labels, never sees another table or pipeline: it is not drawn, not named on an arrow, and not counted among the tables further away.

## Lineage Map

**Data Observability > Lineage Map** draws every flow of data your project has seen on one page, so you can see who uses which data and where it goes without first picking a table. It shows:

- **Services** writing and reading tables, from the database spans in your traces: a span that names its table (`db.collection.name`, or the older `db.sql.table`) and its statement (`db.operation.name`), such as an `INSERT` or a `SELECT`.
- **Tables** built from other tables, from every source above.
- **Pipelines** that load a table from data OneUptime does not watch, such as a Fivetran sync. A pipeline that moves data between two watched tables is named on the arrow between them.
- **Dashboards** and reverse ETL syncs in your BI tools, reading the tables they are built on, even when nothing else touches those tables. A Power BI report built on no table OneUptime watches is drawn with the datasets it charts and the data sources they load from; when none of a BI tool's dashboards is on a watched table, the map says why ([Power BI lineage](#power-bi-lineage)).

Every arrow is something OneUptime recorded, never a guess. Cards sit left to right as data flows, and say how they are as on a table's diagram: red for a late table, an open alert or a failed run. An arrow is teal where a service's traces saw it.

Search for a table, service, pipeline or dashboard to keep what matches and everything upstream and downstream of it. Select a card to highlight its whole lineage, see what it comes from and what it goes to, and open its page; **Show Only Its Lineage** leaves only that on the map. The switches beside the search leave services, pipelines or dashboards off. **List** shows every arrow as a line, and is what a phone opens on.

One map draws up to 400 cards, the most recently seen flows first; when your project has more, the map says so. The same map is served by `POST /api/data-observability/lineage/map`, for anyone who may read data assets and their API keys. A map with more says how many tables it left out, each counted once, and can start somewhere else: pick a database to map the flows of its tables, the dashboards built on them and the cards they join, or type a name and choose **Search Whole Project** to map the flows of every table, pipeline, service, dashboard, dataset and data source whose name holds it, however old they are. **Show Whole Map** goes back. To start the API's map somewhere, send `{ "dataStoreId": "<database ID>" }` or `{ "search": "orders" }`.

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

## Jobs in your traces

A lot of pipelines are a Kubernetes CronJob, or a function on a timer, with no scheduler to send lineage. Their traces say it all the same, with nothing to install. Every fifteen minutes, spans with the resource attribute `k8s.cronjob.name` or `k8s.job.name`, or `faas.name` with a `faas.trigger` of `timer` or `datasource`, become a pipeline under **Pipelines**:

- A run of a CronJob is its Kubernetes Job, and a run of a function is its `faas.invocation_id`.
- A run failed when the span at the top of its trace did. A call that failed and was retried inside it does not fail it.
- The tables it wrote and read come from its database spans.

Each run links to its trace, with its logs. The same three monitors apply, so a CronJob that stops running is seen as late.

## Dashboards in BI tools

The real impact of bad data is the dashboard someone opens. Under **BI Dashboards**, add your BI tools with credentials that may read their dashboards. Every hour Data Observability reads each dashboard and the tables behind it, matches each table to a watched one, and lists the dashboards built on a table, and on the tables built from it, on its **Lineage** tab, on its alerts and in Production Review.

| Tool | Credentials |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, a service principal allowed to use Power BI's read-only admin APIs, with the two metadata tenant settings of [Power BI lineage](#power-bi-lineage) turned on for the tables behind each report. Reports and dashboards are both read, with their views and refreshes (below) |
| **Hightouch** | `{ "apiKey": "..." }` |
| **Census** | `{ "apiKey": "...", "region": "us" }` (or `eu`) |

Hightouch and Census are reverse ETL tools: a sync that copies a table into a CRM depends on that table as a dashboard does, so it is read the same way and named on the table's alerts.

Only dashboards' names and links, the tables they query, and for Power BI who opens them and how their refreshes went, are read: never their data.

### Views and refreshes in Power BI

For each Power BI report and dashboard, **BI Dashboards** shows first how many times it was opened in the last 28 days, when it was last opened, and how the last refresh of its data went, with a failed refresh's error. How many people opened it, who opened it most and its latest refreshes are columns you can switch on. A table's **Lineage** tab says the same of each dashboard built on it, with its owner and viewers under **More**.

- **Views** come from Power BI's activity log, read through its admin activity events API. Power BI keeps 28 days of it, answers 200 requests an hour and splits every request into hours, so OneUptime reads it an hour at a time: each hourly read adds the hours since the last one, then goes back through the 28 days, newest first, with at most 100 requests. A new Power BI tool shows the last few days right away and all 28 days within a day; until then, the views say since when they are counted. An event can take up to an hour to reach the log, so views are up to two hours behind. Viewers are named as Power BI names them, by their email address.
- **Refreshes** of datasets on a capacity (Premium, Premium Per User or Fabric) come from Power BI's admin list of refreshables: each dataset's last refresh with its error, and how many refreshes ran and failed in the seven days Power BI keeps.
- **Refreshes of datasets on shared capacity** are not in that list. Power BI shows a dataset's refresh history only to people who may change the dataset, so add the service principal to its workspace as a **Contributor**, **Member** or **Admin**, and turn on **Service principals can call Fabric public APIs** for it in the Fabric admin portal's developer settings. OneUptime then reads every refresh, with its error. Until then, the BI tool says how many datasets' refreshes it could not read.
- A Power BI dashboard whose tiles come from several datasets shows the latest refresh that failed, or the oldest refresh if none failed: its data is only as fresh as that.

Views, and refreshes on capacities, need nothing beyond the admin API access above: the service principal in a security group allowed by **Service principals can access read-only admin APIs**, with no Power BI permissions on the app that need admin consent. When views or refreshes cannot be read, the dashboards are still read and kept, the BI tool says what was skipped and why, and the next read tries again.

### Alerts on failed refreshes

Turn on **Alert on Failed Refreshes** when you add or edit a Power BI tool (a new one starts with it on), and OneUptime keeps one monitor for the tool under **Monitors**, named after it. The monitor opens an alert for each dataset whose last refresh failed or was cancelled, with the dataset and its workspace in the alert's title, and resolves it once a later refresh completes. A dataset published later is watched as soon as it is read. Turning the switch off, or removing the tool, removes the monitor; until then it is an ordinary monitor, with its owners, on-call policies and maintenance windows.

Failed refreshes do not use the pipeline monitors. A dataset whose refresh failed goes on showing the data of its last completed refresh until a later one completes, so its alert stays open until then, where a failed run's alert clears an hour after the run. And refreshes are read once an hour: a refresh read up to an hour after it ended would often fall outside the hour **Pipeline Run Failed** looks at, a dataset refreshed every half hour would keep turning **Pipeline Is Late**, and a refresh that ended but was not read yet would look **Pipeline Run Unusually Long**.

- Each hourly read keeps the datasets whose latest finished refresh failed or was cancelled. Every five minutes, each one writes `oneuptime.data.bi.refresh_failed`, 1 while it fails and 0 for the hour after a later refresh completes, and the monitor reads it, so one failure opens one alert however many hourly reads see it.
- A failure is seen at the next hourly read: its alert opens up to an hour after the refresh failed, and resolves up to an hour after a later refresh completed.
- A refresh still running changes nothing: the alert of a dataset whose refresh failed stays open while its next refresh runs, and resolves only once a refresh completes.
- On a capacity, Power BI's list of refreshables gives only each dataset's last refresh, so a refresh that failed and was followed by a completed one within the same hour is never seen: by then the data is fresh again.
- Datasets on shared capacity alert only where their refreshes can be read (above), and a dataset whose refreshes could not be read keeps its alert as it was until they can.

## Pipelines

Each job, dbt project and sync appears under **Pipelines**, with its runs: when each started and ended, how long it took, which attempt it was where the scheduler says (Airflow's try number), and a failed run's error. Each pipeline learns from its own runs how long a run usually takes and how long it goes between runs on its schedule, after five runs. A pipeline's page recommends four monitors:

- **Pipeline Run Failed**: a run failed or was aborted.
- **Pipeline Run Unusually Long**: a run has taken twice its typical time or more, checked every five minutes while it runs, so a run that hangs is seen before it ends.
- **Pipeline Is Late**: no run has started for longer than its schedule allows.
- **Pipeline Stopped by Circuit Breaker**: the circuit breaker answered stop, and the stop lasts until it answers go or a run starts.

A pipeline's **Owners** tab names the people and teams who look after it, and its alerts go to them. The **Overview** and **Issues** name a failed or late pipeline's owners, or say it has **No owner**, with a way to add one.

**Owner Rules** can name a pipeline's owners for you. On their **Pipeline Rules** tab, a rule matches a pipeline by a regular expression on its name, such as `orders_daily.load_orders`, or on its namespace, where it runs, such as `airflow://prod`, and adds its people and teams as the pipeline's owners when OneUptime first sees the pipeline. To add them to the pipelines you already have, open the rule and select **Run Now**.

A pipeline's page draws its **Lineage**, the first place to look when a run fails or is late: the tables it reads on the left, the tables it writes on the right, the pipeline between them, and how each is now. Pick more steps to see what those tables are built from and what is built from them, and open any table to see its own **Lineage** tab. A count of tables not drawn, on the pipeline's card or a table's, draws more of them in place here too. Pick one of the columns it writes to follow it across the pipeline: up to the column of each table it reads that it was built from, and down to each table it writes it to.

## Circuit breakers

A failing check or a late table tells its owners, but the pipelines that read the table would still run and copy the bad data downstream. A circuit breaker stops them first: the pipeline's first step asks OneUptime whether the tables it reads are healthy, and the rest runs only when the answer is go.

- A failing check of a table the pipeline reads always stops it: a check whose alert is open, or a dbt test that failed.
- A late table stops it too once **Stop when a table it reads is late** is on, on the pipeline's **Circuit Breaker** page. It is off for every pipeline, since a late table may only mean a quiet day.
- A check that could not run or has not run yet, and a table with no checks, stop nothing.

The step asks with a project API key that may read Data Observability, and names the pipeline as `namespace/name`, by its name alone or by its ID. The circuit breaker reads the tables the pipeline reads from its lineage. A request can also name `tables`, or name only those, each as `schema.table`, by its name alone or by its ID; a name that matches no table comes back in `notFound`, and is never counted as a table that passed. Only the tables the API key may read are judged.

```bash
curl -sSf https://oneuptime.com/api/data-observability/circuit-breaker \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pipeline": "airflow://prod/orders_daily.load_orders", "failWithStatusCode": true}'
```

The answer's `verdict` is `go` or `stop`. `reasons` lists each failing check with its table, and each late table with how late it is; `tables` lists every table judged; and `answer` says the same in a few sentences, for the step's log. With `failWithStatusCode`, a stop answers HTTP 412, so `curl -f` fails the step. Send `stopsOnLateTables` as `true` or `false` to decide for one request, and `dryRun` as `true` to ask without the answer being kept.

In Airflow, put a `ShortCircuitOperator` before the tasks that read the tables: when its function returns false, every task after it is skipped.

```python title="orders_daily.py"
import os

import requests
from airflow.operators.python import ShortCircuitOperator


def inputs_are_healthy() -> bool:
    response = requests.post(
        "https://oneuptime.com/api/data-observability/circuit-breaker",
        headers={"ApiKey": os.environ["ONEUPTIME_API_KEY"]},
        json={"pipeline": "airflow://prod/orders_daily.load_orders"},
        timeout=30,
    )
    response.raise_for_status()
    answer = response.json()
    print(answer["answer"])
    return answer["verdict"] == "go"


check_inputs = ShortCircuitOperator(
    task_id="check_inputs",
    python_callable=inputs_are_healthy,
)

check_inputs >> load_orders
```

dbt's `on-run-start` hooks run SQL in your warehouse, not web requests, so ask in the step that starts dbt: a CI job, a cron line or the task that runs it. A dbt project's pipeline is named `dbt/` followed by the project's name.

```bash
curl -sSf https://oneuptime.com/api/data-observability/circuit-breaker \
  -H "ApiKey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"pipeline": "dbt/analytics", "failWithStatusCode": true}' \
  && dbt build
```

A request that names a pipeline is kept on it, unless it is a dry run. While the circuit breaker has stopped a pipeline, its **Circuit Breaker** page says since when and why, its **Overview** opens on the stop, and **Needs Attention** and **Issues** list it as stopped, in place of its failed or late run. The stop ends when the circuit breaker next answers go, or when a run starts after it. The same page has **Test Now**, which asks the circuit breaker without the answer being kept, and the step for curl, Airflow and dbt with the pipeline's name filled in.

To hear of a stop, add **Pipeline Stopped by Circuit Breaker** from the pipeline's **Recommendations**. Its alert opens when the circuit breaker answers stop, goes to the pipeline's owners, stays open while the stop is kept, and resolves once the stop ends. It reads the pipeline's `oneuptime.data.pipeline.circuit_breaker_stopped` metric: 1 while the circuit breaker has stopped it and 0 once it has not, written as the circuit breaker answers and every five minutes after.

While Data Observability is switched off on the server, the circuit breaker answers go and keeps nothing: switching a product off never stops a pipeline.

## One issue per cause

When a table goes stale, every table built from it goes stale too. Before a data alert opens, OneUptime looks up lineage for an alert already open on what its table or pipeline is built from: the tables upstream, the pipelines that write them, and the databases they live in, up to five steps up. When it finds one, the new alert is that alert's consequence:

- It starts **acknowledged**, so nobody is paged twice for one problem, and recovers on its own once its data does.
- Its feed and its **Data** card say which alert caused it, and it joins the cause's episode.

The cause's **Data** card lists its **Downstream Impact**: every alert it caused. A table alert's card also shows the services that write the table, with their failed writes, and their deploys and other changes in the day before the alert.

Under the **Data** card, an alert's page draws its **Lineage**: around its table, as the table's **Lineage** tab draws it, or around its pipeline. The way up to the alert that caused it and down to each alert it caused is highlighted - the cause's table or pipeline marked **Cause**, each caused alert's marked **Consequence** - and the rest fades, so whoever opens it sees where in the chain the problem started. When the cause is on a pipeline drawn on an arrow, the arrow says **Cause** under the pipeline's name. When the cause is about a whole database, or further up than the diagram reaches, the card says so in words. An alert from a check on one column, such as a Null Percent check on `customer_id`, opens with that column followed beside these ways, as on the table's **Lineage** tab: where it comes from and where it goes, named on each table. Pick another of the table's columns there, or clear it to see the ways alone. **Explore Lineage** opens the table's **Lineage** tab, or the pipeline's page. An alert it caused on a pipeline drawn on an arrow says **Consequence** there in the same way, and the column picker offers the check's column first, then the table's other columns in its own order.

Someone who may not see the alert that caused it gets neither the **Data** card nor the lineage, and an alert it caused that they may not see is neither highlighted nor counted.

## Power BI lineage

**Tables Matched** on each BI tool says how many watched tables its dashboards are built on, and under it the first thing keeping the rest from matching. **See Why** lists what the last read found and what to do: databases your dashboards read that are not connected to OneUptime, each one **Connect Database** away with its kind and address filled in; tables a connected database does not watch, which may be left out of its scan or not collected yet; and sources that are no database, such as files and web pages. For Power BI it also names a tenant setting that is off, dataflows whose definitions Power BI would not export or that are still being read, and datasets Power BI cannot describe. Each dashboard's **Built On** says the datasets it charts and where their data comes from, as Power BI says.

OneUptime reads each Power BI dataset from Power BI's metadata scan, with the Power Query behind each of its tables:

- **The database a connector names**: SQL Server and Azure SQL (`Sql.Database`), PostgreSQL, MySQL, Oracle, Amazon Redshift, Snowflake, Google BigQuery, Databricks, Amazon Athena and Microsoft Dataverse, and the schema and table its navigation picks.
- **SQL a query runs**: a connector's **SQL statement** option, `Value.NativeQuery` and `Odbc.Query`, and the tables after each `FROM` and `JOIN`.
- **Parameters and shared queries**: a parameter stands wherever it is named, and a table that reads a staging query reads what that query reads.
- **Composite models** chart the tables of the datasets they are built on.
- **Dataflows**: a dataset built on a dataflow reads what the dataflow's entity reads. OneUptime exports each dataflow's definition through Power BI's admin API, which needs nothing more than the admin API access above, and reads the entity's query in it as it reads a dataset's, linked entities included. A dataflow is exported once, and again when it changes or a day after an export failed: at most 60 in one read, within Power BI's limit of 200 an hour, so a tenant with many dataflows is read through over a few hours.
- **Dataverse's OData connectors**: `Cds.Entities` and `Cds.Contents`, the legacy Common Data Service connector's, and `Dataverse.Contents` name a table by its entity set (`accounts`), while OneUptime keeps a Dataverse table under its logical name (`account`). OneUptime asks the connected Dataverse environment at that address for its entity set names, with the environment's own connection, once a day, and matches through them; an environment a probe collects is not asked.

A report charts its dataset's tables, and a dashboard its tiles' datasets'. Where the data comes from - a database's server and name, a file's path, a web address - comes from the scan's data sources, which need nothing more than the admin API access above.

Power BI returns a dataset's tables only once a Fabric administrator turns on two tenant settings in the admin portal, under **Tenant settings > Admin API settings**, for the security group that holds the service principal:

- **Enhance admin APIs responses with detailed metadata**: each dataset's tables.
- **Enhance admin APIs responses with DAX and mashup expressions**: the queries that load them, which say which database tables they read.

Power BI then describes a dataset once it has been refreshed or republished; one that only uses DirectQuery, once someone has opened a report on it. It never describes real-time datasets, datasets on a live connection to Analysis Services, Excel workbooks, or datasets over 1 GB on shared capacity.

Each table is matched to a watched table by its name, schema and database, and a server by its short name or its full one. A table of another engine is never matched, and neither is one in another database: a report on `Sales.dbo.Orders` is not tied to `Archive.dbo.Orders` because only `Archive` is watched.

The first read scans the whole tenant. After it, each hourly read scans only the workspaces that changed since the last read, and the whole tenant once a day, which drops reports and workspaces that are gone; **Read Now** scans only what changed. OneUptime runs up to 16 scans at once, of up to 100 workspaces each, as Power BI allows, and a big tenant's scans can take minutes: the hourly read waits up to 20 minutes for them and **Read Now** up to 4. A workspace whose scan failed or did not finish keeps what was read of it, the BI tool's warning says so, and the next read scans it again.

[Refreshes](#views-and-refreshes-in-power-bi) are read apart from the tables: a warning that some datasets' refreshes could not be read says nothing about their tables.

## Before a change merges

When a pull request changes a watched table, [Production Review](/docs/ai/ai-agent) says on the pull request what depends on it: the services that read it, the tables built from it, the dashboards on it, and its data products. A table with a copy on a database marked Staging also says how the copy differs: its rows, its columns, and what the table's checks read there, run on the spot. On a database only a probe can reach, the checks are left out, and it says so.

## Next steps

:::cards
- [Data Products](/docs/data-observability/data-products): Freshness SLAs over the tables people use.
- [OneUptime AI and the API](/docs/data-observability/ai-and-api): Investigations that start from a table's writers and runs. Ask AI and AI agents can ask what a table is built from.
:::
