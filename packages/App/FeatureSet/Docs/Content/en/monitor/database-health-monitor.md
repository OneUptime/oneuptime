# Database Health Monitor

The Database Health Monitor connects to PostgreSQL, MySQL, or Microsoft SQL Server on a schedule and reports the server's own health signals — connection headroom, blocked sessions, replication lag, cache hit ratio, database size, transaction ID wraparound, and thirty-odd more — so you can alert on them the same way you alert on a website being down.

You write no SQL. The probe runs a fixed set of read-only catalog queries chosen by engine, and reports a small set of named numbers.

## Database Health or SQL Query?

The two database monitor types answer different questions and are meant to be used together.

| | Database Health | [SQL Query](/docs/monitor/sql-monitor) |
|---|---|---|
| Question it answers | "Is the database itself healthy?" | "Is my data what I expect it to be?" |
| Query | Built in, per engine, read-only | Yours |
| Reports | Named numeric metrics (see [Metrics collected](#metrics-collected)) | Row count, scalar value, first row, execution time |
| Typical alert | Connections used above 90% | Cancelled orders above 50 in the last five minutes |
| Grants needed | Statistics/DMV read access — see [Create a monitoring user](#create-a-monitoring-user) | `SELECT` on the tables your query touches |

If you want to alert on a business condition, use the SQL Query Monitor. If you want to know that the server is running out of connections before the business condition ever gets a chance to fail, use this one.

## Supported databases

- **PostgreSQL** (default port `5432`)
- **MySQL** (default port `3306`)
- **Microsoft SQL Server** (default port `1433`)

PostgreSQL- and MySQL-compatible engines that speak the same wire protocol usually work, but they may expose fewer statistics views, in which case the affected metrics are reported as unavailable rather than collected. Only the three engines above are officially tested.

## How it works

On every check, a probe:

1. Connects to the database with the credentials you configure.
2. Runs one lightweight probe query. **This is the only statement whose failure can take the monitor offline.**
3. Runs the catalog queries for each enabled [metric group](#metric-groups), each one inside a read-only transaction and under a statement timeout.
4. Reports the numbers it collected, plus a note for each group it could not collect and why.

Only named numeric aggregates are sent to OneUptime. No query text, no rows from your tables, and no schema names leave your network — the queries read the engine's own statistics views (`pg_stat_activity`, `performance_schema.global_status`, `sys.dm_exec_sessions` and friends), never your data.

Because the check runs from a probe, the database only needs to be reachable from the probe. Put a [custom probe](/docs/probe/custom-probe) inside your network and OneUptime never needs a route to the database at all.

## Create a monitoring user

**This is the most important step.** The monitor reads statistics views that ordinary logins are not allowed to see, and the failure mode of an under-privileged login is not always an error — on PostgreSQL it is a wrong answer. Create a dedicated login with exactly these grants and nothing else.

### PostgreSQL

```sql
CREATE USER oneuptime_health WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE mydb TO oneuptime_health;
-- The one grant that matters. Without it, see the note below.
GRANT pg_monitor TO oneuptime_health;
```

`pg_monitor` is a built-in role (PostgreSQL 10 and later) that grants read access to the statistics and monitoring views. It grants no access to your tables.

> **Why `pg_monitor` is not optional on PostgreSQL.** Without it, `pg_stat_activity` does not fail — it succeeds and returns only the monitoring session's own row. Connection counts would read `1`, blocked sessions `0`, and replication lag `0`, forever, on a server that is actually on fire. So the probe checks `pg_has_role(current_user, 'pg_monitor', 'member')` **before** it runs those queries, and when the answer is no it reports the Connections, Activity, Locks, Replication and Maintenance groups as unavailable with the `GRANT` you need. Reporting nothing is the honest answer; reporting `1` is not.

On a managed service where `pg_monitor` is unavailable, `pg_read_all_stats` covers the same views. On Amazon RDS, `GRANT rds_superuser` is not needed — `GRANT pg_monitor TO oneuptime_health;` works as a member of `rds_superuser`.

### MySQL

```sql
CREATE USER 'oneuptime_health'@'%' IDENTIFIED BY 'a-strong-password';
-- INNODB_TRX (open transactions, longest query) and replication status.
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'oneuptime_health'@'%';
-- Status counters, server variables, and lock waits.
GRANT SELECT ON performance_schema.* TO 'oneuptime_health'@'%';
-- Database size: information_schema.TABLES only shows tables the login can see.
GRANT SELECT ON mydb.* TO 'oneuptime_health'@'%';
FLUSH PRIVILEGES;
```

MySQL's `performance_schema` must be enabled (`performance_schema = ON`, the default since 5.6). When it is off, the Connections, Throughput and Locks groups report as unavailable and the fix is a server restart, not a grant.

### Microsoft SQL Server

```sql
CREATE LOGIN oneuptime_health WITH PASSWORD = 'a-strong-password';
-- Every server-scoped DMV the monitor reads.
GRANT VIEW SERVER STATE TO oneuptime_health;

USE mydb;
CREATE USER oneuptime_health FOR LOGIN oneuptime_health;
-- Database size and transaction log space.
GRANT VIEW DATABASE STATE TO oneuptime_health;
```

On Azure SQL Database, `VIEW SERVER STATE` does not exist; use `GRANT VIEW DATABASE STATE TO oneuptime_health;` alone. The server-scoped groups then report as unavailable, and the database-scoped Storage group still collects.

## Prerequisites

- A **probe** with network access to the database host and port. Use a OneUptime-hosted probe if the database is reachable from the internet, or a [custom probe](/docs/probe/custom-probe) inside your network if it is not.
- A **monitoring user** created as above, and its connection details.

## Configuration

Create a monitor and choose **Database Health** as the monitor type, then fill in:

- **Database Type** — PostgreSQL, MySQL, or Microsoft SQL Server. Choosing a type sets the default port and decides which queries run.
- **Host** — the database host reachable from the probe (for example `db.internal`).
- **Port** — the database port.
- **Database Name** — the database to connect to. Database-scoped metrics (size, cache hit ratio, temp spill) are reported for this database; server-scoped metrics (connections, uptime, replication) are reported for the whole server.
- **Use Windows Integrated Authentication** — Microsoft SQL Server only. Authenticate with the identity of the probe process instead of a username and password. See [Windows Integrated Authentication](/docs/monitor/sql-monitor#windows-integrated-authentication) on the SQL Query Monitor page — the setup is identical.
- **Username** — the monitoring user.
- **Password** — the password. Reference a [Monitor Secret](/docs/monitor/monitor-secrets) with `{{monitorSecrets.name}}` rather than typing it in plain text (see [Using a Monitor Secret](#using-a-monitor-secret-for-the-password)).
- **Use SSL/TLS** — connect over TLS. When enabled you can turn off **Verify server certificate** for a self-signed certificate.
- **Collected Metric Groups** — which groups to run. All are on by default; see [Metric groups](#metric-groups).

### Advanced options

- **Connection Timeout (ms)** — how long to wait to establish a connection. Default `10000`, maximum `30000`.
- **Statement Timeout (ms)** — the cap on any single catalog query. Default `10000`, maximum `60000`. The default is deliberately tighter than the SQL Query Monitor's: these queries return in milliseconds on a healthy server, so if `pg_stat_activity` takes ten seconds the useful signal is "this server is in trouble", not a longer wait.

Collection as a whole is also bounded. If the enabled groups have not finished within the collection budget, the check returns with what it has and records every remaining group as timed out — a slow server produces a partial result, never a missing check.

## Using a Monitor Secret for the password

So the password is never stored in plain text on the monitor:

1. Go to OneUptime Dashboard → Monitors → Settings → Secrets → Create Monitor Secret.
2. Create a secret (for example `dbPassword`) and grant this monitor access to it.
3. In the Password field, enter `{{monitorSecrets.dbPassword}}`.

The secret is resolved server-side before the configuration is handed to a probe. The Host, Username, and Database Name fields accept the same reference. Credentials are never written to logs, monitor feeds, or alert templates.

## Metric groups

A group is one collection unit: the queries in it run together, succeed together, and fail together. Groups exist so that one missing grant costs you one group rather than the whole monitor.

| Group | What it collects | Needs |
|---|---|---|
| Connections | Connection counts, the configured ceiling, aborted connects, server uptime | PostgreSQL: `pg_monitor`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Activity | Longest running query, longest open transaction, open transactions | PostgreSQL: `pg_monitor`. MySQL: `PROCESS`. SQL Server: `VIEW SERVER STATE` |
| Throughput | Transactions, queries, cache hit ratio, disk reads and writes, I/O time | PostgreSQL: none beyond `CONNECT`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Locks | Blocked sessions, lock waits, deadlocks, table lock waits | PostgreSQL: `pg_monitor`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Storage | Database size, temp spill, log space, tempdb free space | PostgreSQL: none beyond `CONNECT`. MySQL: `SELECT` on the database. SQL Server: `VIEW DATABASE STATE` |
| Replication | Connected replicas, replication lag in seconds and bytes, inactive slots, recovery state | PostgreSQL: `pg_monitor`. MySQL: `REPLICATION CLIENT`. SQL Server: `VIEW SERVER STATE` |
| Maintenance | Transaction ID wraparound headroom, dead tuples, tables never autovacuumed, checkpoints | PostgreSQL: `pg_monitor` |

Turning a group off is silent: no metrics, no collection issue, no alert. It is the right move in two cases.

- **You cannot get the grant.** Turning the group off stops the collection issue from recurring on every check.
- **The queries are too expensive.** On MySQL, **Storage** is the usual candidate: database size comes from summing `information_schema.TABLES`, which on a schema with tens of thousands of tables is not free and runs on every check. Turn it off, or move that monitor to a five-minute interval.

Clearing every group is not a way to collect nothing — an empty list is normalized back to all groups, so a monitor can never be saved in a state where it silently collects nothing.

## What happens when a metric cannot be collected

**A missing grant never takes the monitor offline.** This is the single most important behaviour of this monitor type, and it is worth stating precisely.

- **The connection fails**, or the probe query fails — bad credentials, refused connection, TLS failure, connect timeout. The monitor goes **offline**. `Database Is Online` is false, and whatever incident and on-call policy you attached to it fires.
- **A group cannot run** — a missing grant, a disabled `performance_schema`, a statement timeout. The monitor **stays online**. That group's metrics are **absent**, not zero. No chart line is drawn, no threshold on those series can match, and no incident can be raised from them. The check records one collection issue naming the group, the reason, and — where there is one — the exact `GRANT` to run, which is shown on the monitor's summary and counted in **Metric Groups Failed**.
- **The engine cannot produce a metric at all** — stock MySQL has no deadlock counter; SQL Server leaves its connection ceiling unlimited by default so a "used percent" would be meaningless; PostgreSQL only populates I/O timing when `track_io_timing` is on. The metric is simply absent. This is **not** a collection issue, does not count toward Metric Groups Failed, and is not something to fix. See the Engines column in [Metrics collected](#metrics-collected).

Absent always means absent. A value that was not measured is never reported as `0`, because a chart of fabricated zeroes is worse than a gap — you can see a gap.

To alert on lost visibility, use `Database Collection Error`, or a threshold on **Metric Groups Failed**. Make both of them alerts rather than incidents: a revoked grant is a ticket, not a page.

## Metrics collected

Forty-one series across eight categories. Engines lists the engines that can actually produce the series; on any other engine it is simply absent. Group is the collection group the series belongs to, which is what you toggle and what degrades together.

### Availability

| Metric | Series | Group | Engines |
|---|---|---|---|
| **Uptime** (s) | `oneuptime.monitor.database.uptime.seconds` | Connections | PostgreSQL, MySQL, SQL Server |
| **Metric Groups Failed** | `oneuptime.monitor.database.metric.groups.failed` | Connections | PostgreSQL, MySQL, SQL Server |

### Connections

| Metric | Series | Group | Engines |
|---|---|---|---|
| **Connections** | `oneuptime.monitor.database.connections.total` | Connections | PostgreSQL, MySQL, SQL Server |
| **Active Connections** | `oneuptime.monitor.database.connections.active` | Connections | PostgreSQL, MySQL, SQL Server |
| **Maximum Connections** | `oneuptime.monitor.database.connections.max` | Connections | PostgreSQL, MySQL |
| **Connections Used** (%) | `oneuptime.monitor.database.connections.used.percent` | Connections | PostgreSQL, MySQL |
| **Idle In Transaction** | `oneuptime.monitor.database.connections.idle.in.transaction` | Connections | PostgreSQL |
| **Aborted Connects** | `oneuptime.monitor.database.connections.aborted.total` | Connections | MySQL |

### Throughput

| Metric | Series | Group | Engines |
|---|---|---|---|
| **Transactions** | `oneuptime.monitor.database.transactions.total` | Throughput | PostgreSQL, SQL Server |
| **Queries** | `oneuptime.monitor.database.queries.total` | Throughput | MySQL, SQL Server |
| **Slow Queries** | `oneuptime.monitor.database.queries.slow.total` | Throughput | MySQL |
| **Rollback Ratio** (%) | `oneuptime.monitor.database.rollback.percent` | Throughput | PostgreSQL |
| **Longest Running Query** (s) | `oneuptime.monitor.database.query.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Longest Open Transaction** (s) | `oneuptime.monitor.database.transaction.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Open Transactions** | `oneuptime.monitor.database.transaction.open.count` | Activity | MySQL |

### Locks and Blocking

| Metric | Series | Group | Engines |
|---|---|---|---|
| **Blocked Sessions** | `oneuptime.monitor.database.sessions.blocked` | Locks | PostgreSQL, MySQL, SQL Server |
| **Lock Waits** | `oneuptime.monitor.database.locks.waiting` | Locks | PostgreSQL, MySQL, SQL Server |
| **Deadlocks** | `oneuptime.monitor.database.deadlocks.total` | Locks | PostgreSQL, SQL Server |
| **Table Lock Waits** | `oneuptime.monitor.database.table.locks.waited.total` | Locks | MySQL |

Stock MySQL exposes no deadlock counter of any kind, which is why Deadlocks is PostgreSQL and SQL Server only.

### Cache and I/O

| Metric | Series | Group | Engines |
|---|---|---|---|
| **Cache Hit Ratio** (%) | `oneuptime.monitor.database.cache.hit.percent` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Reads** | `oneuptime.monitor.database.disk.reads.total` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Writes** | `oneuptime.monitor.database.disk.writes.total` | Throughput | MySQL, SQL Server |
| **I/O Read Time** (ms) | `oneuptime.monitor.database.io.read.time.ms` | Throughput | PostgreSQL, SQL Server |
| **I/O Write Time** (ms) | `oneuptime.monitor.database.io.write.time.ms` | Throughput | PostgreSQL, SQL Server |
| **Page Life Expectancy** (s) | `oneuptime.monitor.database.page.life.expectancy.seconds` | Throughput | SQL Server |
| **Memory Grants Pending** | `oneuptime.monitor.database.memory.grants.pending` | Throughput | SQL Server |

PostgreSQL only fills in I/O read and write time when `track_io_timing` is on. It is off by default, so those two series are commonly absent on a fully-granted PostgreSQL server. That is a server setting, not a permissions problem.

### Storage

| Metric | Series | Group | Engines |
|---|---|---|---|
| **Database Size** (bytes) | `oneuptime.monitor.database.size.bytes` | Storage | PostgreSQL, MySQL, SQL Server |
| **Temp Bytes Written** (bytes) | `oneuptime.monitor.database.temp.bytes.total` | Storage | PostgreSQL |
| **Temp Disk Tables** | `oneuptime.monitor.database.temp.disk.tables.total` | Storage | MySQL |
| **Log Space Used** (%) | `oneuptime.monitor.database.log.space.used.percent` | Storage | SQL Server |
| **TempDB Free Space** (bytes) | `oneuptime.monitor.database.tempdb.free.bytes` | Storage | SQL Server |

### Replication

| Metric | Series | Group | Engines |
|---|---|---|---|
| **Connected Replicas** | `oneuptime.monitor.database.replica.count` | Replication | PostgreSQL, SQL Server |
| **Replication Lag** (s) | `oneuptime.monitor.database.replication.lag.seconds` | Replication | PostgreSQL, MySQL, SQL Server |
| **Replication Lag (Bytes)** (bytes) | `oneuptime.monitor.database.replication.lag.bytes` | Replication | PostgreSQL, SQL Server |
| **Is In Recovery** | `oneuptime.monitor.database.is.in.recovery` | Replication | PostgreSQL |
| **Inactive Replication Slots** | `oneuptime.monitor.database.replication.slots.inactive` | Replication | PostgreSQL |

Replication metrics are reported from whichever side of the link the monitor is connected to. Point a monitor at the primary to see connected replicas and the send queue; point one at each standby to see how far behind that standby actually is.

Lag in seconds reads as zero on an idle primary even when a replica is far behind, because nothing new has been written. **Replication Lag (Bytes)** does not have that blind spot, so alert on both.

### Maintenance

| Metric | Series | Group | Engines |
|---|---|---|---|
| **Transaction ID Used** (%) | `oneuptime.monitor.database.transaction.id.used.percent` | Maintenance | PostgreSQL |
| **Dead Tuples** | `oneuptime.monitor.database.dead.tuples` | Maintenance | PostgreSQL |
| **Tables Never Autovacuumed** | `oneuptime.monitor.database.tables.never.autovacuumed` | Maintenance | PostgreSQL |
| **Requested Checkpoints** | `oneuptime.monitor.database.checkpoints.requested.total` | Maintenance | PostgreSQL |
| **Timed Checkpoints** | `oneuptime.monitor.database.checkpoints.timed.total` | Maintenance | PostgreSQL |

**Transaction ID Used** deserves a criterion on every PostgreSQL monitor you create. PostgreSQL refuses all writes when it reaches 100%, recovery means a single-user-mode vacuum with the database down, and almost nobody watches it. Alert well below the cliff — 80% leaves days of headroom on most workloads.

Counters ending in `total` are cumulative since the server started. Compare two points in time to get a rate; a single value is only meaningful against its own history, and it resets to zero when the server restarts (which **Uptime** will show you).

## Setting up criteria

- **Database Is Online** — whether the database was reachable and the probe query succeeded. This is the offline criterion the monitor is created with, and it is the only check that reflects reachability.
- **Database Metric** — pick a metric, then compare it. The metric picker offers only the metrics your selected engine can produce, so you cannot build a criterion that would sit permanently unmet. If the metric was not collected on a check — the group failed, or the engine does not report it — the filter does not match, and does not match "false" either: it is skipped. A permissions problem cannot page anyone.
- **Database Collection Error** — the collection issue summary for the check. Alert when it is not empty to catch lost visibility, or use Contains to watch for one specific group or one named grant.
- **JavaScript Expression** — full control. See [JavaScript Expressions](/docs/monitor/javascript-expression).

Thresholds are whole numbers. Write `90`, not `90.5` — percentages and seconds are compared as integers.

### JavaScript expression variables

For a Database Health monitor the expression has access to:

| Variable | Type | |
|---|---|---|
| `isOnline` | boolean | Whether the connection and the probe query both succeeded |
| `engineVersion` | string | The version string the server reported |
| `connectionError` | string | Sanitized connection error, empty when there was none |
| `collectedGroups` | array | The groups that produced values on this check |
| `unavailableGroups` | array | The groups that did not, each with a reason and a remediation |
| `metrics` | object | Collected values keyed by series name; a series that was not collected is absent |

```javascript
{{isOnline}} === true && {{collectedGroups}}.length >= 5
```

For a threshold on a single metric, reach for **Database Metric** rather than an expression: it resolves the series for you, only offers what your engine can produce, and skips the check when the value was not collected instead of comparing against nothing.

### Example: a PostgreSQL primary

- **Criteria: Offline** — `Database Is Online` is `false`.
- **Criteria: Degraded** — `Database Metric` → Connections Used is greater than `90`, evaluated over 5 minutes with All Values so a single spike does not page.
- **Criteria: Degraded** — `Database Metric` → Transaction ID Used is greater than `80`.
- **Criteria: Degraded** — `Database Metric` → Blocked Sessions is greater than `0`, over 5 minutes.
- **Criteria: Online** — `Database Is Online` is `true`.

Criteria are evaluated top to bottom and the first match wins, so list the alerting criteria first and the healthy one last.

Attach an on-call policy to the offline criterion, and leave anything derived from **Metric Groups Failed** or `Database Collection Error` as an alert with no on-call policy attached.

## Things to consider

- **The queries run on every check.** They are cheap by design, but "cheap" is relative to the interval. A one-minute interval against a server with thousands of sessions is more `pg_stat_activity` scanning than you may want; five minutes is plenty for capacity metrics.
- **Point the monitor at the database you care about.** Size, cache hit ratio, and temp spill are per-database. Connections, uptime, and replication are per-server and will read the same from any database on that instance.
- **One monitor per instance, not per database**, unless you specifically want per-database size and cache metrics — otherwise you multiply the server-scoped queries for no new information.
- **Alert on rates, not on counters.** Anything ending in `total` only climbs, so a "greater than" threshold on it fires once and never recovers. Chart it, or compare it across a window.
- **Prefer a Monitor Secret over a plain-text password.** The credential then stays encrypted at rest and never appears on the monitor.
- The monitor never writes. Every query is a read against a statistics view, in a read-only transaction where the engine supports one. Anything it cannot read is reported as a missing metric, never as an outage.
