# SQL Query Monitor

The SQL Query Monitor runs a read-only SQL query on a schedule from a probe and alerts on the result — the number of rows returned, a scalar value, how long the query took, or a query error. It is built for the "run a query and open an incident" use case, for example alerting when the number of cancelled orders in the last five minutes spikes, when a queue table grows too large, or when a critical row disappears.

Because the query runs from a probe inside your network, OneUptime never needs a direct connection to your database, and the full result set never leaves the probe — only a small, bounded projection of the result is reported back.

## Supported databases

The SQL Query Monitor supports the following database engines:

- **PostgreSQL** (default port `5432`)
- **MySQL** (default port `3306`)
- **Microsoft SQL Server** (default port `1433`)

MySQL-compatible and PostgreSQL-compatible engines that speak the same wire protocol and SQL dialect generally work as well, but only the three engines above are officially tested.

## How it works

On each check, the probe connects to your database, runs your query in a read-only context, reads back at most a bounded number of rows, and reports a compact projection to OneUptime. Your monitor's criteria are then evaluated against that projection.

The probe reports only:

- **Row Count** — the number of rows the query returned (bounded by the Max Rows limit).
- **Scalar Value** — the first column of the first row. This is the natural value for a `SELECT COUNT(*)` style query.
- **First Row** — the first row as a set of column/value pairs, shown in the check summary for context.
- **Execution Time** — how long the query took, in milliseconds.
- **Query Error** — a sanitized error message if the query failed.

The full result set is never sent to OneUptime, so customer data is not replicated into OneUptime storage.

## Security model

Running a customer-supplied query against a production database is sensitive, so the SQL Query Monitor is read-only by design and layers several controls:

- **Least-privilege database user (primary control).** You should always connect with a dedicated, read-only database user that only has access to the tables the query needs. This is the most important control — see [Create a read-only user](#create-a-read-only-user) below.
- **Read-only execution.** On PostgreSQL and MySQL the probe opens a `READ ONLY` transaction, which rejects any write (including writable CTEs) regardless of the query text. On Microsoft SQL Server, which has no read-only transaction, the probe runs inside a transaction that is always rolled back.
- **Single-statement, allow-listed queries.** The query must be a single statement that starts with `SELECT`, `WITH`, `VALUES`, or `TABLE`. Stacked statements (`SELECT 1; DROP TABLE …`) and writes/DDL are rejected before the probe connects. The check is comment- and string-literal-aware, so a keyword hidden in a comment or string does not slip through.
- **Statement timeout.** Every query has a hard time limit. A query that runs too long is cancelled.
- **Bounded rows.** Only up to Max Rows (plus one, to detect truncation) rows are ever read back, which caps probe memory and payload size.
- **Credential redaction.** Database errors are sanitized before being stored — the password and any connection string are redacted, so credentials never leak into error messages.

## Prerequisites

- A **probe** with network access to your database host and port. This can be a OneUptime-hosted probe (if your database is reachable from the internet) or a self-hosted probe running inside your network. See the probe documentation for how to install a custom probe.
- A **read-only database user** and the connection details (host, port, database name, username, password), or a read-only Windows/domain identity when using SQL Server Integrated Authentication.

## Configuration

Create a new monitor and choose **SQL Query** as the monitor type, then fill in the connection details:

- **Database Type** — PostgreSQL, MySQL, or Microsoft SQL Server. Choosing a type sets the default port.
- **Host** — the database host reachable from the probe (for example `db.internal`).
- **Port** — the database port.
- **Database Name** — the database to run the query against.
- **Use Windows Integrated Authentication** — Microsoft SQL Server only. Authenticate with the account running the probe instead of a SQL username and password. See [Windows Integrated Authentication](#windows-integrated-authentication).
- **Username** — a read-only, least-privilege database user.
- **Password** — the database password. We strongly recommend referencing a [Monitor Secret](/docs/monitor/monitor-secrets) with `{{monitorSecrets.name}}` instead of typing the password in plain text (see below).
- **SQL Query** — the read-only query to run (see [Writing the query](#writing-the-query)).
- **Use SSL/TLS** — enable to connect over TLS. When enabled, you can turn off **Verify server certificate** if the database uses a self-signed certificate.

### Windows Integrated Authentication

For Microsoft SQL Server, enable **Use Windows Integrated Authentication** to open a trusted connection with the identity of the probe process. The Username and Password fields are ignored in this mode and are not passed to the driver. Because the probe needs an identity trusted by your domain, use a self-hosted probe for this authentication mode.

- **Windows probes:** run the probe service as a domain account that has a read-only SQL Server login.
- **Linux or macOS probes:** configure Kerberos for the SQL Server domain and give the probe process a valid ticket (for example through a keytab). The official Linux probe image includes Microsoft ODBC Driver 18, unixODBC, and the Kerberos client. Mount the Kerberos configuration and ticket cache into the container, make them readable by the probe process, and set `KRB5_CONFIG` or `KRB5CCNAME` when their locations are non-default.

The probe needs a Microsoft ODBC Driver for SQL Server installed on the host running it. The official probe image bundles **ODBC Driver 18**. When you run a self-hosted or custom probe, the probe automatically detects and uses the newest `ODBC Driver N for SQL Server` registered on the host (for example Driver 17 if that is what is installed) — you do not need to have exactly Driver 18. To pin a specific driver, set the `SQL_SERVER_ODBC_DRIVER` environment variable on the probe to the exact driver name (for example `ODBC Driver 17 for SQL Server`).

SQL Server must have an appropriate `MSSQLSvc` service principal name, the probe and domain controller clocks must be synchronized, and the probe must resolve/reach the SQL Server by the hostname covered by that service principal. Grant only the database permissions needed by the monitoring query to the trusted identity.

### Advanced options

- **Connection Timeout (ms)** — how long to wait to establish a connection. Default `10000`, maximum `30000`.
- **Statement Timeout (ms)** — the hard cap on how long the query may run. Default `15000`, maximum `60000`.
- **Max Rows** — the upper bound on rows read back from the database. Default `100`, maximum `1000`.

## Writing the query

The query must be a **single read-only statement**. It must start with one of `SELECT`, `WITH`, `VALUES`, or `TABLE`. A single trailing semicolon is allowed; multiple statements are not.

Keep queries cheap and well-scoped — they run on every check, so prefer indexed columns and narrow time windows.

```sql
-- Count recent cancellations (PostgreSQL)
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL '5 minutes';
```

```sql
-- The same idea on MySQL
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL 5 MINUTE;
```

```sql
-- The same idea on Microsoft SQL Server
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > DATEADD(minute, -5, GETDATE());
```

For a `COUNT(*)` style query, the count is available both as **Row Count** (which is `1`, since one row is returned) and as **Scalar Value** (the count itself, from the first column). For alerting on "how many", compare against the **Scalar Value**.

## Using a Monitor Secret for the password

So the database password is never stored in plain text on the monitor, create a [Monitor Secret](/docs/monitor/monitor-secrets) and reference it from the Password field:

1. Go to OneUptime Dashboard → Project Settings → Monitor Secrets → Create Monitor Secret.
2. Create a secret (for example `dbPassword`) and grant this monitor access to it.
3. In the Password field of the monitor, enter `{{monitorSecrets.dbPassword}}`.

OneUptime resolves the secret server-side before the config is handed to the probe. OneUptime never creates these secrets for you — referencing one is your choice.

## Setting up criteria

Add criteria to decide when the monitor is considered online, degraded, or offline. The following checks are available for a SQL Query Monitor:

- **SQL Is Online** — whether the database was reachable and the query succeeded.
- **SQL Query Row Count** — the number of rows returned. Compare with operators like greater than, less than, or equal to.
- **SQL Query Scalar Value** — the first column of the first row. Compared numerically when both sides look numeric, otherwise as strings. This is the check to use for `COUNT(*)` style queries.
- **SQL Query Execution Time (in ms)** — how long the query took. Useful for catching a slow database.
- **SQL Query Error** — the query error message. Alert when it is (or is not) empty, or matches a specific string.
- **JavaScript Expression** — evaluate a custom JavaScript expression for full control. See [JavaScript Expressions](/docs/monitor/javascript-expression).

### Example: alert when cancellations spike

Using the query above:

- **Criteria: Degraded** — `SQL Query Scalar Value` is greater than `10`.
- **Criteria: Offline** — `SQL Query Scalar Value` is greater than `50`, or `SQL Is Online` is `false`.

Attach an on-call policy to the criteria so the right people are paged.

## Create a read-only user

Always connect with a dedicated read-only user. Examples:

```sql
-- PostgreSQL
CREATE USER oneuptime_ro WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE orders TO oneuptime_ro;
GRANT USAGE ON SCHEMA public TO oneuptime_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO oneuptime_ro;
-- Include tables created in the future:
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO oneuptime_ro;
```

```sql
-- MySQL
CREATE USER 'oneuptime_ro'@'%' IDENTIFIED BY 'a-strong-password';
GRANT SELECT ON orders.* TO 'oneuptime_ro'@'%';
FLUSH PRIVILEGES;
```

```sql
-- Microsoft SQL Server
CREATE LOGIN oneuptime_ro WITH PASSWORD = 'a-strong-password';
USE orders;
CREATE USER oneuptime_ro FOR LOGIN oneuptime_ro;
ALTER ROLE db_datareader ADD MEMBER oneuptime_ro;
```

## Things to consider

- The query runs on every check, so keep it cheap. Use indexes and narrow time windows, and rely on the Statement Timeout as a backstop.
- Only the row count, first cell (scalar), and first row are reported — design your query so the value you want to alert on is the first column.
- If the result is truncated because it exceeded Max Rows, the check summary flags it as capped. Increase Max Rows only if you need it; larger result sets cost more memory on the probe.
- Writes and DDL are always rejected. If you need to test a write path, that is not what this monitor is for.
- Prefer a Monitor Secret over a plain-text password so the credential stays encrypted at rest.
