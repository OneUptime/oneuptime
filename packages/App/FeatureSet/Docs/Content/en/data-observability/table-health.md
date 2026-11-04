# Table Health

Every five minutes, each connected database's catalog says how every table is doing: when it last changed, how many rows it holds, how big it is, and what its columns are. Data Observability learns each table's rhythm from that, and says when a table is late, shrinks, or changes shape, with no threshold to set.

## What is read

For every table and view:

- **Row count and size**, from the engine's own statistics.
- **When it last changed**: the engine's own time where it keeps one, or the moment its write counters, rows or bytes moved between two collections.
- **Its columns**, with their types and whether they may be empty.
- **When it was last read**, where the engine counts reads.

Only the catalog is read. No row is read, and no value leaves the database.

## Freshness

A table's **rhythm** is how often it usually changes, learned from the time between its changes. A table that goes well past its rhythm shows as **Late**, on its page and in **Tables**, and writes how far past it is. Its freshness is known once it has changed twice: a table loaded hourly is learned within hours, one loaded nightly within days.

A view holds no rows of its own, so its freshness is its sources' freshness: see [Lineage and Pipelines](/docs/data-observability/lineage-and-pipelines).

## Volume and schema changes

- **Rows** are compared between collections: a table that loses half its rows, or holds far fewer than usual for that hour of the week, says so.
- **Columns** are compared too. A column added, removed, renamed, retyped or made nullable goes on the table's **Timeline** and on **Schema Changes**, which lists every change of every database, newest first.
- **Dropped tables** are kept under **Dropped Tables**, with when they were last seen, and come back with their history if the table returns.

## Recommended alerts

On **Databases**, choose **Recommended Alerts** for a database. Each recommendation is one metric monitor for the whole database that alerts once per table, so a table created later is watched too:

| Alert | Fires when |
| --- | --- |
| **Table Is Late** | A table stays past the time it usually changes by for fifteen minutes |
| **Row Count Fell Sharply** | A table loses half its rows or more between two collections |
| **Row Count Unusually Low** | A table holds far fewer rows than usual for that hour of the week (learned over two weeks) |
| **Schema Changed** | A table's columns are added, removed, renamed or retyped |
| **Table Health Stopped Reporting** | No table of the database has been read for fifteen minutes |

Pick severities, on-call policies, owners and labels when you create them. From then on they are ordinary monitors: edit them, mute them, or put them on a status page like any other.

## Metrics every table writes

Each collection writes these for every table, so you can chart them, put them on dashboards and alert on them like any other metric:

| Metric | What it is |
| --- | --- |
| `oneuptime.data.table.row_count` | Rows in the table |
| `oneuptime.data.table.size` | Bytes the table and its indexes take |
| `oneuptime.data.table.seconds_since_change` | Seconds since the table last changed |
| `oneuptime.data.table.overdue_seconds` | Seconds the table is past the time it usually changes by; 0 while on time |
| `oneuptime.data.table.row_count_change_percent` | How much the row count moved since the collection before, in percent |
| `oneuptime.data.table.schema_changes` | Columns changed since the collection before |

Every row carries `oneuptime.data.store.id`, `oneuptime.data.store.name`, `oneuptime.data.table.id`, `oneuptime.data.table.schema`, `oneuptime.data.table.name` and `oneuptime.data.table.key` (`schema.table`). A [metric monitor](/docs/monitor/metrics-monitor) grouped by `oneuptime.data.table.key` alerts once per table, and its **Anomalously High** and **Anomalously Low** filters compare each table with its own usual value for that hour of the week. These metrics are OneUptime's own operational data and are not billed as telemetry.

## Unused tables

Every engine that counts reads says when each table was last read: PostgreSQL's scans, MySQL's performance_schema, SQL Server's seeks, scans and lookups, and the query history of Redshift, ClickHouse and Databricks. A read seen in your services' database spans counts too.

**Unused Tables** lists the tables nobody has read for 90 days, biggest first, with when each was last written: a table still written but never read costs its writes and its storage. A counter of 0 at a table's first collection means it has not been read since the engine's statistics started, so an unused table shows as unused from the start.

## Warehouse spend

Once an hour, Data Observability reads what each Snowflake and BigQuery warehouse spent over the last day, job by job: Snowflake's compute credits, from `QUERY_ATTRIBUTION_HISTORY`, and BigQuery's bytes billed, from its jobs view, which needs **BigQuery Resource Viewer**. A job is one query run again and again, named by its query tag or label, or by what it does and the table it writes: never by its query's text.

**Warehouse Spend** shows the totals by team (the `team` in a job's query tag or label, else whoever runs it), the tables whose writes cost the most, the jobs that failed, and what goes to jobs that write only tables nobody has read for 90 days.

## Services that use each table

A table's **Services** tab lists the services seen writing and reading it, with the statements each ran, its calls and failures in the last hour, and when it was last seen. It comes from the database spans your services already send with OpenTelemetry: a client span with `db.system.name`, `db.namespace` and `db.collection.name`. Nothing extra to install.

A span is tied to a table only when its database is one a collection read, and when two databases share a name, only when its `server.address` is one of theirs.

## Next steps

:::cards
- [Checks and Reconciliations](/docs/data-observability/checks): Rules on what a table holds, beyond whether it changes.
- [Lineage and Pipelines](/docs/data-observability/lineage-and-pipelines): Where a late table's data comes from, and the run that should have loaded it.
:::
