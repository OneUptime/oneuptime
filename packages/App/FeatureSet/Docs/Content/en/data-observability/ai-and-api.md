# OneUptime AI and the API

OneUptime AI knows your data: it investigates a data alert from the table's writers, runs and upstream tables, answers whether a table is fresh wherever it is asked, and writes a check from a rule said in a sentence. Everything Data Observability shows is also there for your own tools, through its endpoints, its metrics and the MCP server.

## OneUptime AI

- **Investigations of data alerts.** When OneUptime AI investigates an alert on a table, a pipeline or a database, it starts from what is next to it: the table's freshness and open alerts, the alert it is a consequence of, the runs of the pipelines that write it since the day before (a failed run with its error, or the run that never came), the services that write it with their failed writes, deploys and other changes, and the tables it is built from. It names the run, deploy or upstream table behind the alert. See [AI SRE](/docs/ai/ai-sre).
- **Is this table fresh?** Ask in [Ask AI](/docs/ai/ask-ai), Slack or Microsoft Teams: "is the orders table fresh?". The answer gives the table's freshness by its own rhythm, when it last changed, its open alerts, its writers' latest runs and the data products it is part of. A name several databases share is answered for each, so nobody is told the wrong table is fresh.
- **A check from a sentence.** On a table's **Checks** tab, **Write a Check from a Sentence** turns a rule into a Custom SQL check in your engine's SQL. See [Checks and Reconciliations](/docs/data-observability/checks).

Each of these needs OneUptime AI to be on for the project, and acts with the permissions of the person who asks.

## AI agents and the MCP server

AI agents should check that data is fresh before they use it. The [MCP server](/docs/ai/mcp-server) has a read-only tool for that:

| Tool | What it answers |
| --- | --- |
| `get_data_table_freshness` | Whether a watched table is fresh, when it last changed, its open alerts, its writers' latest runs and its data products. Give `table` as `schema.table`, the table's name alone, or its ID |

It works with a read-only sign-in, and answers as the person or API key that signed in.

## Endpoints

| Endpoint | What it is for | Signed with |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | OpenLineage events from Airflow, Dagster, Spark, dbt or Flink | A telemetry ingestion key |
| `POST /telemetry/dbt/v1/artifacts` | A dbt build's `manifest` and `run_results` | A telemetry ingestion key |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | Fivetran's sync webhooks | The ingestion key, as Fivetran's signing secret |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | Airbyte's sync webhooks | The ingestion key in the URL |
| `POST /api/data-observability/tables/freshness` | A table's freshness, as the MCP tool answers it, with `{ "table": "public.orders" }` | An API key |
| `GET /api/data-observability/data-products/<data product ID>/badge?token=<badge token>` | A data product's "data as of" badge | The badge's own token |

Tables, checks, reconciliations, pipelines and data products are also ordinary resources of the [API](/docs/api-reference/api-reference), read and changed with an API key that has the matching permissions.

## Metrics

Every number Data Observability keeps is a metric you can chart, put on a dashboard or alert on: `oneuptime.data.table.*` for each table, `oneuptime.data.check.value` for each check, `oneuptime.data.reconciliation.*` for each reconciliation, `oneuptime.data.pipeline.*` for each pipeline and `oneuptime.data.product.*` for each data product. They are OneUptime's own operational data and are not billed as telemetry.

## Next steps

:::cards
- [MCP Server](/docs/ai/mcp-server): Connect an AI agent to OneUptime.
- [Data Observability](/docs/data-observability/index): Back to the overview.
:::
