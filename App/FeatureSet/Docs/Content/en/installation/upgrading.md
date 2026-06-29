# Upgrading OneUptime

This guide covers how to safely upgrade your self-hosted OneUptime installation.

## General Guidance

- Upgrade step-by-step across major versions (for example, 6 → 7 → 8). Do not skip major versions.
- You can leapfrog minor/patch versions (for example, 8.1 → 8.4) as long as you follow the release notes.
- Always take backups before upgrading, and validate you can restore them.

## Upgrading from OneUptime 10 → 11

OneUptime 11 has two changes that need your attention before you upgrade:

1. **Identity features (SSO, OIDC, SCIM) moved to the Enterprise Edition** —
   if you sign in with SSO on a self-hosted Community build, read this first.
2. **The ClickHouse telemetry storage was rebuilt** — relevant if you want to
   carry historical telemetry forward.

This page explains both — what changes, who needs to act, and (for the
telemetry rebuild) every query needed to migrate history.

### Identity features (SSO, OIDC, SCIM) now require the Enterprise Edition

In v11, the following authentication and access-management features moved to
the **OneUptime Enterprise Edition** and are no longer part of the free,
open-source (Community) build:

- **SAML SSO** — both project login and status-page login
- **OpenID Connect (OIDC)** — both project login and status-page login
- **SCIM user provisioning** — project and status page
- **Global (instance-wide) SSO / OIDC**
- **Team compliance settings**

**What you'll see after upgrading:** if you configured any of these on a
Community Edition build, sign-in through them is disabled after the upgrade,
and the settings pages show an upgrade prompt instead of the configuration
form. Your existing provider records are **preserved in the database** —
nothing is deleted — they simply become inactive until the instance runs the
Enterprise Edition.

**Availability:**

- **Self-hosted:** requires the **Enterprise Edition** build.
- **OneUptime Cloud:** requires the **Scale** plan (or above).

**If you rely on SSO and self-host**, email
[support@oneuptime.com](mailto:support@oneuptime.com) for an Enterprise Edition
license so you can restore SSO/OIDC/SCIM. Mention that you upgraded from v10 to
v11 and we'll help you get it back online. If your team is mid-upgrade and this
is blocking sign-in, contact us before upgrading production so we can plan it
with you.

### What changes in v11 (telemetry storage)

Telemetry (logs, traces, metrics, exceptions, profiles, monitor logs,
audit logs) moves to new ClickHouse tables with time-based partitioning,
per-column compression codecs, and the new entity-model columns:

| Old table             | New table             |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

Two columns are renamed on every telemetry table: `serviceId` →
`primaryEntityId` and `serviceType` → `primaryEntityType`. This is a hard
rename — **if you query the OneUptime analytics API directly with
`serviceId`/`serviceType` filters, update them to the new names.**
Dashboards, monitors, and alerts inside OneUptime are migrated
automatically.

The cut is **forward-only**: the new tables start empty, all telemetry
ingested after the upgrade lands in them immediately, and history fills
back in naturally as time passes. The old tables are **dropped
automatically** during the upgrade to reclaim their disk — if you want
the option of carrying history forward, rename them **before**
upgrading (Step 0 below).

> **Already on 11.0.0 or 11.0.1?** Those releases kept the old tables
> (they drained via TTL, and the copy could be run "any time after the
> upgrade"). Any later update **drops them at boot**. If you still want
> the history copy and have not done it yet, run Step 0 below before
> applying the update.

### Who needs to do anything

- **Fresh installations:** nothing to do.
- **Upgrades that don't need pre-upgrade telemetry in the UI:** nothing to
  do. Telemetry pages simply show data from the upgrade moment onward;
  the old tables are dropped during the upgrade.
- **Upgrades that want pre-upgrade telemetry visible:** rename the old
  tables **before** the upgrade (Step 0 below), then run the manual copy
  any time after it.

As always: upgrade major versions step-by-step (10 → 11, do not skip),
and take backups of Postgres and ClickHouse before upgrading.

### Optional: carry telemetry history forward

Step 0 runs **before the upgrade**; everything from Step 1 on runs
**after the upgrade has fully booted** (the new tables and their
materialized views must exist). Connect directly on your ClickHouse
host — the native protocol has no HTTP timeouts, so multi-hour statements
are fine:

```bash
clickhouse-client --database oneuptime
```

Good to know before starting:

- The copy is safe to run while OneUptime is live. New telemetry writes
  to the new tables independently; copied history fills in behind it.
- Expect hours at large scale (hundreds of GB).
- Every statement below carries an `insert_deduplication_token`, and the
  new tables ship with a deduplication window — so **re-running a
  statement that failed partway is safe** (already-inserted blocks are
  skipped, including in the metric rollups), provided you re-run it
  reasonably soon. Under heavy live ingest the window (last 10,000 insert
  blocks per table) eventually evicts old tokens.
- Copying metrics also rebuilds the pre-aggregated dashboard rollups
  automatically (each copied row re-feeds the rollup materialized views)
  — this makes the metric copy slower than the others; run it last.

#### Step 0 — before upgrading, rename the old tables

The upgrade drops the old tables at boot, so move the ones you want to
copy from out of its reach first. Stop OneUptime (scale the deployment
down) so nothing is writing to or able to recreate them, then rename —
`RENAME TABLE` is an instant metadata operation, and `IF EXISTS` lets
the batch skip tables your installation never had (deployments older
than mid-10.0.x may lack `AuditLogV1` or some `…V2` tables entirely —
there is no history of that type to copy):

```sql
RENAME TABLE IF EXISTS LogItemV2 TO LogItemV2_backup;
RENAME TABLE IF EXISTS MetricItemV2 TO MetricItemV2_backup;
RENAME TABLE IF EXISTS SpanItemV2 TO SpanItemV2_backup;
RENAME TABLE IF EXISTS ExceptionItemV2 TO ExceptionItemV2_backup;
RENAME TABLE IF EXISTS ProfileItemV2 TO ProfileItemV2_backup;
RENAME TABLE IF EXISTS ProfileSampleItemV2 TO ProfileSampleItemV2_backup;
RENAME TABLE IF EXISTS MonitorLogV2 TO MonitorLogV2_backup;
RENAME TABLE IF EXISTS AuditLogV1 TO AuditLogV1_backup;
RENAME TABLE IF EXISTS MetricItemAggMV1mByHost TO MetricItemAggMV1mByHost_backup;
```

Then upgrade and let OneUptime boot fully before continuing.

> If you roll back to v10 after renaming (v10 recreates empty old-name
> tables at boot), rename the `_backup` tables back to their original
> names before restarting v10 — otherwise telemetry ingested during the
> rollback lands in the recreated tables and is dropped at the eventual
> upgrade.

#### Step 1 — list the source partitions

Each old table has at most 16 partitions. For each source table:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Step 2 — generate the copy statement

Column sets can differ slightly between installations (older deployments
may lack recently added columns), so generate the statement from your
live schema rather than copy-pasting a fixed one. Set `src` and `dst` in
the `WITH` clause to one of the table pairs from the table above (the
source carries the `_backup` suffix from Step 0), and run:

```sql
WITH 'LogItemV2_backup' AS src, 'LogItemV3' AS dst
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

The generated statement copies only the columns both tables share (new
columns take their defaults), renames `serviceId`/`serviceType` on the
fly, orders rows deterministically so a retry produces identical,
deduplicatable blocks, and lifts the execution-time and partition-count
limits that a statement this size needs.

#### Step 3 — run it, one partition at a time

Take the generated statement and substitute `{PARTITION}` (it appears
twice — in the `WHERE` and in the token) with each partition id from
Step 1. Run the statements one at a time, then repeat Steps 1–3 for each
table pair.

> Note: if a source table was skipped in Step 0 because it did not exist
> on your installation, Step 1 fails with `UNKNOWN_TABLE` for that pair —
> simply skip the pair; there is no history of that type to copy.

If a statement fails partway, re-run the **same** statement promptly —
already-committed blocks deduplicate. If re-running much later, compare
row counts first (Step 5).

#### Step 4 (optional) — per-host metric rollup history

Copied raw metric rows rebuild the service-level rollups automatically,
but not the **per-host** rollup (old rows have no host entity key). The
renamed old rollup table from Step 0 is the only source for this
history; carry it forward by computing the new key from the hostname:

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
FROM MetricItemAggMV1mByHost_backup
ORDER BY projectId, name, hostIdentifier, bucketTime, _id
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

The `ORDER BY` matters: it makes a re-run produce identical insert blocks
so the deduplication token can recognize them. Without it, a retry could
be silently skipped or double-counted. (Edge case: hostnames containing
`\`, `|`, or `=` — not legal RFC-1123 hostname characters — would compute
a different key than the application; ignore unless you know you have
such hosts.)

#### Step 5 — verify

Compare totals per table pair (the new table also contains post-upgrade
rows, so it should be greater than or equal to the old one):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Step 6 — drop the backups

The renamed tables keep their retention TTL, so they drain and shrink by
themselves — but once you are satisfied with the copy, drop them to
reclaim the disk immediately:

```sql
DROP TABLE IF EXISTS LogItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS SpanItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ExceptionItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileSampleItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MonitorLogV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS AuditLogV1_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost_backup SETTINGS max_table_size_to_drop = 0;
```

(`max_table_size_to_drop = 0` lifts the server's 50 GB drop protection
for that one statement.)

> Tip: as with every major upgrade, test in a staging environment first
> and confirm telemetry is flowing into the new tables before relying on
> the copy in production.

## Upgrading from OneUptime 9 → 10

No changes that require manual action. Just follow the standard upgrade process.

## Upgrading from OneUptime 8 → 9

The Helm chart no longer provisions a Kubernetes Ingress resource. OneUptime ships an ingress gateway container that already terminates TLS, manages status page domains, and routes traffic for the platform, so a cluster ingress controller is no longer necessary.

- Remove any `oneuptimeIngress` overrides from your custom `values.yaml` files before upgrading. Those keys are now ignored and will cause validation errors if left in place.
- Ensure `nginx.service.type` reflects how you want to expose the bundled ingress gateway (for example `LoadBalancer`, `NodePort`, or `ClusterIP` with an external load balancer).
- Verify any DNS records for status pages or primary hosts still point to the Service or load balancer that fronts the OneUptime ingress gateway.
- After the upgrade, confirm TLS certificates continue to renew via the embedded gateway and that status page domains resolve correctly.

## Upgrading from OneUptime 7 → 8

If you're running on Kubernetes, there are important breaking changes:

- We no longer use Bitnami charts for Postgres, Redis, and ClickHouse because of [Bitnami License Changes](https://github.com/bitnami/charts/issues/35164)
- These changes are not backward compatible. You must follow the new structure in the Helm chart `values.yaml`.
- Backup your data (Postgres, ClickHouse, and any persistent volumes) before upgrading.

> Tip: Test the upgrade in a staging environment first. Confirm your workloads are healthy and data is intact before upgrading production.
