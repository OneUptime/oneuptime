# Telemetry V3 Upgrade Guide — Optional Manual History Copy

Status: Active (paste the relevant parts into the release notes of the release that ships the V3 cut)
Last updated: 2026-06-11

## What the upgrade does on its own

The telemetry tables were cut to new ClickHouse tables (`LogItemV3`,
`MetricItemV3`, `SpanItemV3`, `ExceptionItemV3`, `ProfileItemV3`,
`ProfileSampleItemV3`, `MonitorLogV3`, `AuditLogV2`) with renamed columns
(`serviceId` → `primaryEntityId`, `serviceType` → `primaryEntityType`),
time-based partitioning, per-column codecs, and the entity-model columns.
The cut is **forward-only by design**: the new tables start empty, all new
telemetry lands in them from the moment the upgrade boots, and history
ages back in naturally over your retention window. The old `…V2` tables
are left in place and self-delete via their retention TTL.

**Fresh installs and upgraders who don't need pre-upgrade history in the
UI: there is nothing to do.** Dashboards simply show data from the upgrade
moment onward.

## Carrying history forward (optional, manual)

If you want pre-upgrade telemetry visible in the new tables, run the
queries below **after the upgrade has fully booted** (the V3 tables and
their materialized views must exist), directly on your ClickHouse host:

```bash
clickhouse-client --database oneuptime   # native protocol: no HTTP timeouts
```

Notes before you start:

- Expect the copy to take **hours at large scale** (hundreds of GB). It is
  safe to run while OneUptime is live — new telemetry writes to V3
  independently, and copied history fills in behind it.
- Each statement carries an `insert_deduplication_token`, and the V3
  tables ship with `non_replicated_deduplication_window = 10000` — so
  **re-running a statement that failed partway is safe** (already-inserted
  blocks deduplicate instead of duplicating, including through the metric
  rollup MVs) *provided you re-run it reasonably soon* (the window holds
  the last 10,000 insert blocks per table; heavy live ingest eventually
  evicts old tokens).
- Copy **metrics last** if you are disk-constrained: every copied metric
  row also re-fires three rollup MVs (that is what rebuilds the
  pre-aggregated dashboard data, so it is desirable — just slower).

### Step 1 — list the source partitions

Each old table has at most 16 partitions (`sipHash64(projectId) % 16`).
For each source table:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2 ORDER BY _partition_id;
```

### Step 2 — generate the copy statement

The column sets differ slightly between installs (older deployments may
lack recently added columns), so generate the statement from your live
schema instead of copy-pasting a canonical one. Set `src`/`dst` in the
`WITH` clause to one of the pairs below and run:

| source (old)         | destination (new)     |
| -------------------- | --------------------- |
| `LogItemV2`          | `LogItemV3`           |
| `MetricItemV2`       | `MetricItemV3`        |
| `SpanItemV2`         | `SpanItemV3`          |
| `ExceptionItemV2`    | `ExceptionItemV3`     |
| `ProfileItemV2`      | `ProfileItemV3`       |
| `ProfileSampleItemV2`| `ProfileSampleItemV3` |
| `MonitorLogV2`       | `MonitorLogV3`        |
| `AuditLogV1`         | `AuditLogV2`          |

```sql
WITH 'LogItemV2' AS src, 'LogItemV3' AS dst
SELECT concat(
  'INSERT INTO ', dst, ' (`', arrayStringConcat(groupArray(name), '`, `'), '`)',
  ' SELECT ', arrayStringConcat(groupArray(selectExpr), ', '),
  ' FROM ', src,
  ' WHERE _partition_id = ''{PARTITION}''',
  ' ORDER BY ', (SELECT sorting_key FROM system.tables WHERE database = currentDatabase() AND name = dst), ', _id',
  ' SETTINGS max_execution_time = 0, max_partitions_per_insert_block = 0, insert_deduplication_token = ''v3copy:', dst, ':{PARTITION}'', deduplicate_blocks_in_dependent_materialized_views = 1'
) AS copy_sql
FROM (
  SELECT name,
    multiIf(name = 'primaryEntityId', 'serviceId', name = 'primaryEntityType', 'serviceType', name) AS srcName,
    if(srcName = name, concat('`', name, '`'), concat('`', srcName, '` AS `', name, '`')) AS selectExpr,
    position
  FROM system.columns
  WHERE database = currentDatabase() AND table = dst
    AND srcName IN (SELECT name FROM system.columns WHERE database = currentDatabase() AND table = src)
  ORDER BY position
);
```

What the generated statement encodes (all verified against ClickHouse
25.7): the column **intersection** (V3-only columns like `entityKeys` and
the scalar entity-key columns take their table defaults), the
`serviceId`/`serviceType` renames as aliases, a deterministic `ORDER BY`
(the destination sort key) so retried inserts produce identical blocks
that the dedup token can suppress, `max_execution_time = 0` (multi-hour
statements allowed), and `max_partitions_per_insert_block = 0` (one
sipHash source partition fans out into many daily destination
partitions).

### Step 3 — run it per partition

Take the generated statement, substitute `{PARTITION}` (both occurrences
— the `WHERE` and the token) with each partition id from step 1, and run
the statements one at a time. Repeat steps 1–3 for each table pair.

If a statement fails partway: re-run the **same** statement (same token)
promptly — already-committed blocks dedup. If you are re-running long
after (token likely evicted), compare counts first:

```sql
SELECT (SELECT count() FROM LogItemV2 WHERE _partition_id = 'N') AS src,
       (SELECT count() FROM LogItemV3) AS dst_total;
```

### Step 4 (optional) — per-host metric rollup history

Copied raw metric rows rebuild the service-keyed rollups automatically
(via the MVs), but **not** the per-host rollup: V2 rows have no
`hostEntityKey`, so `MetricItemAggMV1mByHostV2` only accumulates from
post-upgrade ingest. The old per-host rollup table
(`MetricItemAggMV1mByHost`) is intentionally left in place by the upgrade
so you can carry it forward, computing the new key from the hostname:

```sql
INSERT INTO MetricItemAggMV1mByHostV2 (projectId, name, hostEntityKey, bucketTime, valueSumState, valueCountState, valueMinState, valueMaxState, retentionDate)
SELECT
  projectId,
  name,
  substring(lower(hex(SHA256(concat(projectId, '|host|host.name=', lower(trimBoth(hostIdentifier)))))), 1, 16) AS hostEntityKey,
  bucketTime,
  valueSumState,
  valueCountState,
  valueMinState,
  valueMaxState,
  retentionDate
FROM MetricItemAggMV1mByHost
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

(The key expression byte-matches the application's `keyForHost` for
RFC-1123 hostnames; hostnames containing `\`, `|` or `=` would mis-key —
those are not legal hostname characters.)

### Step 5 — verify and clean up

Compare per-table totals (`SELECT count() FROM <old>` vs the V3 table —
remember V3 also contains post-upgrade rows). When satisfied, the old
tables can be dropped early to reclaim disk (they would otherwise drain
via TTL):

```sql
DROP TABLE IF EXISTS LogItemV2;
DROP TABLE IF EXISTS MetricItemV2;
DROP TABLE IF EXISTS SpanItemV2;
DROP TABLE IF EXISTS ExceptionItemV2;
DROP TABLE IF EXISTS ProfileItemV2;
DROP TABLE IF EXISTS ProfileSampleItemV2;
DROP TABLE IF EXISTS MonitorLogV2;
DROP TABLE IF EXISTS AuditLogV1;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost;
DROP TABLE IF EXISTS TelemetryV3CopyProgress; -- only exists on installs that ran a pre-release build
```

## Why there is no in-app copy

An automated copy was built and removed twice during development: run
inline in the boot migration runner it blocked ~23 later migrations for
hours and, worse, the HTTP client's 58s socket-idle timeout killed long
statements while ClickHouse kept committing them server-side — silently
duplicating rows and double-counting rollups on every retry. A
background-cron replacement fixed all of that but amounted to permanent
in-app machinery for a one-time operation most installs don't need.
Running the statements via `clickhouse-client` sidesteps the entire
problem class: the native protocol has no idle timeout, the operator sees
progress and errors directly, and the dedup tokens make retries safe.
