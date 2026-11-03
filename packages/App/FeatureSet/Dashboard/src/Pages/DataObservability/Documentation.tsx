import PageComponentProps from "../PageComponentProps";
import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * How Data Observability works and how to connect a database, on one page:
 * what is read (the catalog, never a row), the read-only login each engine
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

Only the database's catalog is read. **No row is ever read**, and no value leaves the database.

## Connect a database

Use a **read-only login**. On Databases, choose **Connect a Database**, then either:

- **OneUptime connects**: paste a connection string. It is stored encrypted and never shown again.
- **A probe in my network connects**: pick one of this project's probes and name the probe's environment variable that holds the connection string (for example \`ORDERS_DB_URL\`). The connection string never leaves your network. Update the probe to the latest version first.

A database already connected for Data Security is watched too.

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
GRANT SHOW VIEW ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
\`\`\`

SQL Server (\`VIEW DATABASE STATE\` lets OneUptime read sizes and last updates):

\`\`\`sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
\`\`\`

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

Every row carries \`oneuptime.data.store.id\`, \`oneuptime.data.store.name\`, \`oneuptime.data.table.id\`, \`oneuptime.data.table.schema\`, \`oneuptime.data.table.name\` and \`oneuptime.data.table.key\` (\`schema.table\`). A Metrics monitor grouped by \`oneuptime.data.table.key\` alerts once per table, and its **Anomalously High** and **Anomalously Low** filters compare each table with its own usual value for that hour of the week, so no threshold has to be set.

## Alerts

On **Databases**, choose **Recommended Alerts** for a database. Each recommendation is one Metrics monitor for the whole database that alerts once per table, so a table created later is watched too:

| Alert | Fires when |
| --- | --- |
| **Table Is Late** | A table stays past the time it usually changes by for fifteen minutes - the same rule as the **Late** pill |
| **Row Count Fell Sharply** | A table loses half its rows or more between two collections |
| **Row Count Unusually Low** | A table holds far fewer rows than usual for that hour of the week (learns over two weeks) |
| **Schema Changed** | A table's columns are added, removed, renamed or retyped |
| **Table Health Stopped Reporting** | No table of the database has been read for fifteen minutes |

Pick severities, on-call policies, owners and labels when you create them. They are ordinary monitors from then on: edit, mute or put them on a status page like any other.

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
      <div className="px-6 pb-6">
        <MarkdownViewer text={DOCUMENTATION} />
      </div>
    </Card>
  );
};

export default DataObservabilityDocumentationPage;
