# OneUptime AI and the API

OneUptime AI knows your data: it investigates a data alert from the table's writers, runs and lineage, answers whether a table is fresh and what it is built from wherever it is asked, and writes a check from a rule said in a sentence. Everything Data Observability shows is also there for your own tools, through its endpoints, its metrics and the MCP server.

## OneUptime AI

- **Investigations of data alerts.** When OneUptime AI investigates an alert on a table, a pipeline or a database, it starts from what is next to it: the table's freshness and open alerts, the alert it is a consequence of, the runs of the pipelines that write it since the day before (a failed run with its error, or the run that never came), the services that write it with their failed writes, deploys and other changes, its lineage (the tables it is built from and the tables built from it, the ones with a problem first, where the alert it is a consequence of sits in it, and which tables the alerts it caused are on), and the columns that changed. For an alert from a check on one column, it also follows that column through the lineage: the columns it is built from upstream and the columns built from it downstream, table by table, as the lineage's sources name them. It names the run, deploy or upstream table behind the alert. See [AI SRE](/docs/ai/ai-sre).
- **Is this table fresh?** Ask in [Ask AI](/docs/ai/ask-ai), Slack or Microsoft Teams: "is the orders table fresh?". The answer gives the table's freshness by its own rhythm, when it last changed, its open alerts, its writers' latest runs and the data products it is part of. A name several databases share is answered for each, so nobody is told the wrong table is fresh.
- **What is this table built from?** Ask "what feeds the revenue table?" or "what breaks if raw.orders stops loading?". The answer follows the table's lineage three steps each way, or up to five when asked, and puts what is wrong first: the tables upstream and downstream that are late, dropped, have open alerts or whose pipeline failed its last run, nearest first, each with how many steps away it is and the tables between. Then come the rest, the pipelines that load its sources from outside what OneUptime watches, and the BI dashboards built on it. Open alerts are counted, never named, and only those the person who asks may see.
- **A check from a sentence.** On a table's **Checks** tab, **Write a Check from a Sentence** turns a rule into a Custom SQL check in your engine's SQL. See [Checks and Reconciliations](/docs/data-observability/checks).

- **Slow drift.** A table's rows, or a check's value, moving by a fifth or more in a week, too slowly for any alert, goes to AI Insights as a look-here. It pages no one.
- **Stale data behind AI apps.** A service that both calls a model and reads a table is that table's AI consumer. When such a table goes late, the AI product's **Conversations** page says so: an app answering from old data shows nothing wrong in its own traces.

Each of these needs OneUptime AI to be on for the project, and acts with the permissions of the person who asks.

## AI agents and the MCP server

AI agents should check that data is fresh before they use it, and what is built from a table before they change it. The [MCP server](/docs/ai/mcp-server) has read-only tools for both:

| Tool | What it answers |
| --- | --- |
| `get_data_table_freshness` | Whether a watched table is fresh, when it last changed, its open alerts, its writers' latest runs and its data products. Give `table` as `schema.table`, the table's name alone, or its ID |
| `get_data_table_lineage` | What a watched table is built from and what is built from it, three steps each way or up to five: the tables with a problem first, nearest first, then the rest, the pipelines that load its sources from outside and the BI dashboards built on it. Give `table` as for its freshness, and `depth` from 1 to 5 |

Both work with a read-only sign-in, and answer as the person or API key that signed in.

## Endpoints

| Endpoint | What it is for | Signed with |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | OpenLineage events from Airflow, Dagster, Spark, dbt or Flink | A telemetry ingestion key |
| `POST /telemetry/dbt/v1/artifacts` | A dbt build's `manifest` and `run_results` | A telemetry ingestion key |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | Fivetran's sync webhooks | The ingestion key, as Fivetran's signing secret |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | Airbyte's sync webhooks | The ingestion key in the URL |
| `POST /api/data-observability/tables/freshness` | A table's freshness, as the MCP tool answers it, with `{ "table": "public.orders" }` | An API key |
| `POST /api/data-observability/tables/lineage` | A table's lineage a few steps each way, with how each table is now, as its **Lineage** tab draws it, with `{ "dataAssetId": "<table ID>", "depth": 3 }`, and `"withColumns": true` for the columns each arrow carries | An API key |
| `POST /api/data-observability/tables/lineage/answer` | A table's lineage told in words, the tables with a problem first, as the MCP tool answers it, with `{ "table": "public.orders", "depth": 3 }` | An API key |
| `POST /api/data-observability/pipelines/lineage` | The tables a pipeline reads and writes, with how each is now, as its page draws them, with `{ "dataPipelineId": "<pipeline ID>", "depth": 1 }` | An API key |
| `POST /api/data-observability/alerts/<alert ID>/lineage` | A data alert's lineage, as its page draws it, with the way to the alert that caused it and to the alerts it caused, and for an alert from a check on one column, its `column` and the columns each arrow carries | An API key |
| `POST /api/data-observability/lineage/expand` | The next tables a card of a lineage diagram does not draw, as selecting its count draws them: the card as `nodeId` with its `side`, and what is drawn as `focusNodeId`, `tables` and `dataDashboardIds` | An API key |
| `POST /api/data-observability/checks/apply` | Make the project's checks match a file, as `oneuptime data-checks apply` does, with `{ "manifest": "...", "isDryRun": true, "shouldPrune": false }` | An API key |
| `GET /api/data-observability/data-products/<data product ID>/badge?token=<badge token>` | A data product's "data as of" badge | The badge's own token |

Tables, checks, reconciliations, pipelines, data products, BI connections and warehouse jobs are also ordinary resources of the [API](/docs/api-reference/api-reference), read and changed with an API key that has the matching permissions, and of the MCP server and workflows.

## Metrics

Every number Data Observability keeps is a metric you can chart, put on a dashboard or alert on: `oneuptime.data.table.*` for each table, `oneuptime.data.check.value` for each check, `oneuptime.data.reconciliation.*` for each reconciliation, `oneuptime.data.pipeline.*` for each pipeline and `oneuptime.data.product.*` for each data product. They are OneUptime's own operational data and are not billed as telemetry.

## Next steps

:::cards
- [MCP Server](/docs/ai/mcp-server): Connect an AI agent to OneUptime.
- [Data Observability](/docs/data-observability/index): Back to the overview.
:::
