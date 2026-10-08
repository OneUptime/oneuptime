# SQL Query Monitor

The SQL Query Monitor runs a read-only SQL query on a schedule from a probe and alerts on the result — the number of rows returned, a scalar value, how long the query took, or a query error. It is built for the "run a query and open an incident" use case, for example alerting when the number of cancelled orders in the last five minutes spikes, when a queue table grows too large, or when a critical row disappears.

:::cards
- [Create a read-only user](#create-a-read-only-user): The database login the monitor should use.
- [Create the monitor](#create-a-sql-query-monitor): Connect a probe and enter the query.
- [Write the query](#writing-the-query): Put the value you alert on in the first column.
- [Set up criteria](#setting-up-criteria): Alert on a count, a value, a slow query or an error.
:::

## How it works

On each check, the probe connects to your database, runs your query in a read-only context, reads back at most a bounded number of rows, and reports a compact projection to OneUptime. Your monitor's criteria are then evaluated against that projection.

Because the query runs from a probe inside your network, OneUptime never needs a direct connection to your database, and the full result set never leaves the probe — only a small, bounded projection of the result is reported back.

```mermaid title="Only a small projection of the result leaves your network"
sequenceDiagram
    participant O as OneUptime
    participant P as Probe
    participant D as Your database
    O->>P: Monitor settings, secrets resolved
    P->>D: Your query, read-only
    D-->>P: Up to Max Rows + 1 rows
    P->>O: Row count, scalar, first row, time, error
    O->>O: Evaluate criteria
```

The probe reports only:

| Value | What it is |
|---|---|
| **Row Count** | The number of rows the query returned (bounded by the Max Rows limit). |
| **Scalar Value** | The first column of the first row. This is the natural value for a `SELECT COUNT(*)` style query. |
| **First Row** | The first row as a set of column/value pairs, shown in the check summary for context. |
| **Execution Time** | How long the check took, in milliseconds — connecting included, not only the query. |
| **Query Error** | A sanitized error message if the query failed. |

The full result set is never sent to OneUptime, so customer data is not replicated into OneUptime storage.

## Supported databases

| Database | Default port |
|---|---|
| **PostgreSQL** | `5432` |
| **MySQL** | `3306` |
| **Microsoft SQL Server** | `1433` |

MySQL-compatible and PostgreSQL-compatible engines that speak the same wire protocol and SQL dialect generally work as well, but only the three engines above are officially tested.

When the host and port the monitor connects to is one of the endpoints of a database on the [Databases](/docs/telemetry/databases) page, its alerts and incidents also appear on that database's page (see [Alerts on a database](/docs/telemetry/databases#alerts-on-a-database)). A host given as a monitor secret reference is not matched.

## Security model

Running a customer-supplied query against a production database is sensitive, so the SQL Query Monitor is read-only by design and layers several controls:

| Control | What it does |
|---|---|
| **Least-privilege database user** (primary control) | You should always connect with a dedicated, read-only database user that only has access to the tables the query needs. This is the most important control — see [Create a read-only user](#create-a-read-only-user). |
| **Read-only execution** | On PostgreSQL and MySQL the probe opens a `READ ONLY` transaction, which rejects any write (including writable CTEs) regardless of the query text. On Microsoft SQL Server, which has no read-only transaction, the probe runs inside a transaction that is always rolled back. |
| **Single-statement, allow-listed queries** | The query must be a single statement that starts with `SELECT`, `WITH`, `VALUES`, or `TABLE`. Stacked statements (`SELECT 1; DROP TABLE …`) and write or DDL keywords such as `INSERT`, `UPDATE`, `DELETE`, `DROP`, `EXEC` and `INTO` are rejected by the probe before it connects. This check is a safety net, not the boundary: the read-only user is. |
| **Statement timeout** | Every query has a hard time limit. A query that runs too long is cancelled. |
| **Bounded rows** | Only up to Max Rows (plus one, to detect truncation) rows are ever read back, which caps probe memory and payload size. |
| **Credential redaction** | Database errors are sanitized before being stored — the password and any connection string are redacted, so credentials never leak into error messages. |

## Before you begin

- A **probe** with network access to your database host and port. This can be a OneUptime-hosted probe (if your database is reachable from the internet) or a [custom probe](/docs/probe/custom-probe) running inside your network.
- A **read-only database user** and the connection details (host, port, database name, username, password), or a read-only Windows/domain identity when using SQL Server Integrated Authentication.

## Create a read-only user

Always connect with a dedicated read-only user. Run the statements for your engine as an administrator, replacing `orders` with your database:

:::tabs
@tab PostgreSQL
```sql
-- PostgreSQL
CREATE USER oneuptime_ro WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE orders TO oneuptime_ro;
GRANT USAGE ON SCHEMA public TO oneuptime_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO oneuptime_ro;
-- Include tables created in the future:
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO oneuptime_ro;
```
@tab MySQL
```sql
-- MySQL
CREATE USER 'oneuptime_ro'@'%' IDENTIFIED BY 'a-strong-password';
GRANT SELECT ON orders.* TO 'oneuptime_ro'@'%';
FLUSH PRIVILEGES;
```
@tab Microsoft SQL Server
```sql
-- Microsoft SQL Server
CREATE LOGIN oneuptime_ro WITH PASSWORD = 'a-strong-password';
USE orders;
CREATE USER oneuptime_ro FOR LOGIN oneuptime_ro;
ALTER ROLE db_datareader ADD MEMBER oneuptime_ro;
```
:::

For a tighter grant, give the user `SELECT` on only the tables your query reads.

## Create a SQL Query monitor

:::steps
### Start a new monitor

Go to **Monitors** and click **Create Monitor**. Under **Monitor Type**, click **More monitor types** and pick **SQL Query** under **Database Monitoring**, or type `query` in the search box. Enter a **Name**, then click **Next**.

### Enter the connection details

Pick the **Database Type** — the port changes to that engine's default — then fill in the host, database name and the read-only user's credentials. Reference the password as a [Monitor Secret](#using-a-monitor-secret-for-the-password) rather than typing it. Every field is described in [Configuration](#configuration).

### Enter the query

Type a single read-only statement in **SQL Query** (see [Writing the query](#writing-the-query)).

### Test it

Click **Test Monitor** to run the query once from a probe before you save.

### Set the criteria

Review the criteria the monitor starts with and add your own — see [Setting up criteria](#setting-up-criteria). Then click **Next**.

### Pick probes and create

Select the **Probes** that can reach the database and a **Monitoring Interval**, then click **Create Monitor**.
:::

## Configuration

| Field | What to enter |
|---|---|
| **Database Type** | PostgreSQL, MySQL, or Microsoft SQL Server. Choosing a type sets the default port. |
| **Host** | The database host reachable from the probe (for example `db.internal`). |
| **Port** | The database port. |
| **Database Name** | The database to run the query against. |
| **Use Windows Integrated Authentication** | Microsoft SQL Server only. Authenticate with the account running the probe instead of a SQL username and password. See [Windows Integrated Authentication](#windows-integrated-authentication). |
| **Username** | A read-only, least-privilege database user. |
| **Password** | The database password. We strongly recommend referencing a [Monitor Secret](/docs/monitor/monitor-secrets) with `{{monitorSecrets.name}}` instead of typing the password in plain text (see [Using a Monitor Secret for the password](#using-a-monitor-secret-for-the-password)). |
| **SQL Query** | The read-only query to run (see [Writing the query](#writing-the-query)). |
| **Use SSL/TLS** | Enable to connect over TLS. When enabled, you can turn off **Verify server certificate** if the database uses a self-signed certificate. |

### More fields

| Field | Default | Maximum | What it limits |
|---|---|---|---|
| **Connection Timeout (ms)** | `10000` | `30000` | How long to wait to establish a connection. |
| **Statement Timeout (ms)** | `15000` | `60000` | The hard cap on how long the query may run. |
| **Max Rows** | `100` | `1000` | The upper bound on rows read back from the database. |

A value above the maximum is lowered to the maximum.

### Windows Integrated Authentication

For Microsoft SQL Server, enable **Use Windows Integrated Authentication** to open a trusted connection with the identity of the probe process. The Username and Password fields are ignored in this mode and are not passed to the driver. Because the probe needs an identity trusted by your domain, use a self-hosted probe for this authentication mode.

| Probe runs on | What to set up |
|---|---|
| **Windows** | Run the probe service as a domain account that has a read-only SQL Server login. |
| **Linux or macOS** | Configure Kerberos for the SQL Server domain and give the probe process a valid ticket (for example through a keytab). The official Linux probe image includes Microsoft ODBC Driver 18, unixODBC, and the Kerberos client. Mount the Kerberos configuration and ticket cache into the container, make them readable by the probe process, and set `KRB5_CONFIG` or `KRB5CCNAME` when their locations are non-default. |

The probe needs a Microsoft ODBC Driver for SQL Server installed on the host running it. The official probe image bundles **ODBC Driver 18**. When you run a self-hosted or custom probe, the probe automatically detects and uses the newest `ODBC Driver N for SQL Server` registered on the host (for example Driver 17 if that is what is installed) — you do not need to have exactly Driver 18. To pin a specific driver, set the `SQL_SERVER_ODBC_DRIVER` environment variable on the probe to the exact driver name (for example `ODBC Driver 17 for SQL Server`).

SQL Server must have an appropriate `MSSQLSvc` service principal name, the probe and domain controller clocks must be synchronized, and the probe must resolve/reach the SQL Server by the hostname covered by that service principal. Grant only the database permissions needed by the monitoring query to the trusted identity.

## Writing the query

The query must be a **single read-only statement**. It must start with one of `SELECT`, `WITH`, `VALUES`, or `TABLE`. A trailing semicolon is allowed; multiple statements are not. Write and DDL keywords are rejected anywhere in the query — including `INTO`, so `SELECT … INTO` is refused too.

The query is checked by the probe on every check, not when you save. A query that breaks these rules saves, and then each check fails with "Only read-only queries are allowed (must start with SELECT, WITH, VALUES, or TABLE)." — the default criteria take the monitor offline.

Keep queries cheap and well-scoped — they run on every check, so prefer indexed columns and narrow time windows. This query counts the orders cancelled in the last five minutes:

:::tabs
@tab PostgreSQL
```sql
-- Count recent cancellations (PostgreSQL)
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL '5 minutes';
```
@tab MySQL
```sql
-- The same idea on MySQL
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL 5 MINUTE;
```
@tab Microsoft SQL Server
```sql
-- The same idea on Microsoft SQL Server
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > DATEADD(minute, -5, GETDATE());
```
:::

> [!TIP]
> For a `COUNT(*)` style query, the count is available both as **Row Count** (which is `1`, since one row is returned) and as **Scalar Value** (the count itself, from the first column). For alerting on "how many", compare against the **Scalar Value**.

## Using a Monitor Secret for the password

So the database password is never stored in plain text on the monitor, create a [Monitor Secret](/docs/monitor/monitor-secrets) and reference it from the Password field:

:::steps
1. Go to **Monitors → Settings → Secrets** and create a monitor secret.
2. Name it (for example `dbPassword`) and give this monitor access to it.
3. In the monitor's **Password** field, enter `{{monitorSecrets.dbPassword}}`.
:::

OneUptime resolves the secret server-side before the config is handed to the probe. OneUptime never creates these secrets for you — referencing one is your choice. The **Username**, **Host**, **Database Name** and **SQL Query** fields accept secret references too; **Port** does not.

## Setting up criteria

Add criteria to decide when the monitor is considered online, degraded, or offline. These checks are available for a SQL Query Monitor:

| Filter type | What it checks |
|---|---|
| **SQL Is Online** | Whether the database was reachable and the query succeeded. |
| **SQL Query Row Count** | The number of rows returned. Compare with operators like greater than, less than, or equal to. |
| **SQL Query Scalar Value** | The first column of the first row. Compared as a number when the value you enter is a number, otherwise as a string. This is the check to use for `COUNT(*)` style queries. |
| **SQL Query Execution Time (in ms)** | How long the query took. Useful for catching a slow database. |
| **SQL Query Error** | The query error message. Alert when it is (or is not) empty, or matches a specific string. |
| **JavaScript Expression** | Evaluate a custom JavaScript expression over `rowCount`, `scalarValue`, `firstRow`, `executionTimeInMs`, `queryError` and `isOnline`. See [JavaScript Expressions](/docs/monitor/javascript-expression#sql-query-monitors). |

Numeric thresholds are whole numbers: write `10`, not `10.5`. SQL Query filters cannot be evaluated over a period of time; each check stands on its own.

A new SQL Query monitor starts with two criteria: **SQL Is Online** is false — the monitor goes offline and declares an incident that resolves itself — and **SQL Is Online** is true, which marks it online. **Add Criteria** adds one at the bottom; drag it above the online criteria, because criteria are checked from the top and the first one that matches decides.

### Example: alert when cancellations spike

Using the query above:

| Criteria | Filter |
|---|---|
| **Degraded** | `SQL Query Scalar Value` is greater than `10`. |
| **Offline** | `SQL Query Scalar Value` is greater than `50`, or `SQL Is Online` is `false`. |

Attach an on-call policy to the criteria so the right people are paged. A SQL Query monitor has no template variables of its own: an incident's title can name the monitor with `{{monitorName}}`, but cannot quote the query's result.

## Things to consider

- The query runs on every check, so keep it cheap. Use indexes and narrow time windows, and rely on the Statement Timeout as a backstop.
- Only the row count, first cell (scalar), and first row are reported — design your query so the value you want to alert on is the first column.
- If the result is truncated because it exceeded Max Rows, the check summary shows **Rows Truncated**: "Yes (result capped)". Increase Max Rows only if you need it; larger result sets cost more memory on the probe.
- Writes and DDL are always rejected. If you need to test a write path, that is not what this monitor is for.
- Prefer a Monitor Secret over a plain-text password so the credential stays encrypted at rest.

## Next steps

:::cards
- [Database Health Monitor](/docs/monitor/database-health-monitor): Watch connections, locks and replication without writing SQL.
- [Monitor Secrets](/docs/monitor/monitor-secrets): Keep the database password encrypted.
- [JavaScript Expressions](/docs/monitor/javascript-expression): Write criteria that combine several values.
- [Custom Probe](/docs/probe/custom-probe): Run checks from inside your network.
:::
