# ClickHouse Telemetry Cold Tier and Sharding

This document explains how to enable the new telemetry cold-tier and app-level sharding support in self-hosted OneUptime.

## What this feature does

### Cold tier
When cold tier is enabled, telemetry tables can:
- keep recent data on the local ClickHouse disk
- move older parts to an object-storage-backed ClickHouse disk such as `s3_cold`
- delete data later using the existing retention-based delete path

### Sharding
When telemetry sharding is enabled, OneUptime:
- keeps the existing local telemetry table names as the source of schema, TTL, and mutations
- creates `...Distributed` wrapper tables for telemetry reads and writes
- routes telemetry reads and writes through those distributed wrappers

This makes multi-shard ClickHouse topology meaningful at the app layer.

---

## Prerequisites

Use this only if all of the following are true:

1. You run ClickHouse under the Altinity operator path.
2. Your ClickHouse deployment exposes:
   - a cluster name
   - replicated local tables
   - a Keeper / ZooKeeper-compatible coordinator
3. For cold tier, your ClickHouse deployment also exposes:
   - a disk such as `s3_cold`
   - a storage policy such as `tiered`
4. You can inject environment variables into the OneUptime **app** and **worker** containers.

> Recommended assumption: use this for new topology rollouts or fresh telemetry datasets. Historical telemetry backfill into a new shard layout is a separate task.

---

## 1. Enable operator-managed ClickHouse

Cold tier and meaningful sharding both assume the operator-managed ClickHouse path, not the legacy single-StatefulSet deployment.

Example:

```yaml
clickhouseOperator:
  altinity:
    enabled: true
    cluster:
      shardsCount: 2
      replicasCount: 2
    keeper:
      enabled: true
      replicas: 3
```

Notes:
- `shardsCount` enables horizontal distribution.
- `replicasCount` enables replicated local tables.
- `keeper` is required when you use replicated local tables.

If you only want cold tier without multi-shard routing, keep:

```yaml
cluster:
  shardsCount: 1
  replicasCount: 2
```

---

## 2. Add the cold-tier ClickHouse disk and storage policy

You must provide a ClickHouse disk and policy yourself. The app only consumes them.

Example `files` entry for the Altinity operator values:

```yaml
clickhouseOperator:
  altinity:
    files:
      config.d/storage-s3-cold.xml: |
        <clickhouse>
          <storage_configuration>
            <disks>
              <s3_cold>
                <type>s3</type>
                <endpoint>https://s3.ap-northeast-2.amazonaws.com/your-bucket/oneuptime/</endpoint>
                <use_environment_credentials>1</use_environment_credentials>
                <metadata_path>/var/lib/clickhouse/disks/s3_cold/</metadata_path>
              </s3_cold>
            </disks>
            <policies>
              <tiered>
                <volumes>
                  <default>
                    <disk>default</disk>
                  </default>
                  <s3_cold>
                    <disk>s3_cold</disk>
                  </s3_cold>
                </volumes>
              </tiered>
            </policies>
          </storage_configuration>
        </clickhouse>
```

If you use IAM roles / workload identity instead of static S3 credentials, configure the ClickHouse pod template or service account so the ClickHouse pods can read and write the backing bucket.

---

## 3. Inject the OneUptime environment variables

These variables must be present in both the **app** and **worker** runtimes.

### Cold tier

```bash
CLICKHOUSE_COLD_TIER_ENABLED=true
CLICKHOUSE_COLD_TIER_STORAGE_POLICY=tiered
CLICKHOUSE_COLD_TIER_VOLUME=s3_cold
CLICKHOUSE_COLD_TIER_METRICS_DAYS=7
CLICKHOUSE_COLD_TIER_LOGS_DAYS=7
CLICKHOUSE_COLD_TIER_TRACES_DAYS=3
```

Meaning:
- `CLICKHOUSE_COLD_TIER_ENABLED`: turns cold-tier DDL/reconcile on
- `CLICKHOUSE_COLD_TIER_STORAGE_POLICY`: local table `storage_policy`
- `CLICKHOUSE_COLD_TIER_VOLUME`: volume used in `TO VOLUME ...`
- `*_DAYS`: move-to-cold thresholds per signal

### Sharding

```bash
CLICKHOUSE_TELEMETRY_SHARDING_ENABLED=true
CLICKHOUSE_CLUSTER_NAME=ou
```

Meaning:
- `CLICKHOUSE_TELEMETRY_SHARDING_ENABLED`: turns on distributed-table routing for telemetry
- `CLICKHOUSE_CLUSTER_NAME`: must match the ClickHouse cluster name exposed in your `remote_servers` / operator topology

> The public Helm chart in this repository does not automatically expose these env vars yet. Inject them using your own deployment overlay, Helm customization, or platform-specific env wiring.

---

## 4. Rollout behavior

### Cold tier behavior
With cold tier enabled:
- new local telemetry tables are created with:
  - `storage_policy = 'tiered'`
  - TTL clauses containing `TO VOLUME 's3_cold'`
- existing local telemetry tables are reconciled at boot under the shared migration advisory lock

That reconcile updates:
- table settings via `MODIFY SETTING storage_policy = ...`
- table TTL via `MODIFY TTL ...`

### Sharding behavior
With sharding enabled:
- local telemetry tables remain the source of:
  - schema
  - TTL
  - mutations
  - reconcile
- OneUptime creates and uses `...Distributed` wrappers for telemetry reads and writes

That means:
- reads and inserts fan out across shards
- `ALTER TABLE`, TTL, and mutation ownership stay on the local tables

---

## 5. Recommended enablement order

### Cold tier only
1. enable operator-managed ClickHouse
2. expose `s3_cold` disk and `tiered` policy
3. inject `CLICKHOUSE_COLD_TIER_*` env vars
4. deploy
5. verify

### Sharding + cold tier together
1. enable operator-managed ClickHouse
2. set `shardsCount > 1`
3. keep `replicasCount >= 1`
4. expose `s3_cold` disk and `tiered` policy
5. inject both:
   - `CLICKHOUSE_COLD_TIER_*`
   - `CLICKHOUSE_TELEMETRY_SHARDING_ENABLED=true`
   - `CLICKHOUSE_CLUSTER_NAME=<cluster>`
6. deploy
7. verify

---

## 6. Verification

After deployment, verify the storage capability first.

### Check storage policy

```sql
SELECT *
FROM system.storage_policies
WHERE policy_name = 'tiered';
```

### Check disk

```sql
SELECT *
FROM system.disks
WHERE name = 's3_cold';
```

### Check a local telemetry table

```sql
SHOW CREATE TABLE oneuptime.MetricItemV3;
SHOW CREATE TABLE oneuptime.LogItemV3;
SHOW CREATE TABLE oneuptime.SpanItemV3;
```

Expect to see:
- a replicated local engine when sharding / replication is enabled
- a TTL containing `TO VOLUME 's3_cold'`
- `storage_policy = 'tiered'`

### Check the distributed wrapper

```sql
SHOW CREATE TABLE oneuptime.MetricItemV3Distributed;
SHOW CREATE TABLE oneuptime.LogItemV3Distributed;
SHOW CREATE TABLE oneuptime.SpanItemV3Distributed;
```

Expect to see:
- `ENGINE = Distributed(...)`
- the configured cluster name
- the original local table name as the target

### Check part placement after TTL materialization

```sql
SELECT database, table, disk_name, path
FROM system.parts
WHERE database = 'oneuptime'
  AND table = 'MetricItemV3'
  AND active;
```

After enough data ages past the configured threshold, old parts should move onto `s3_cold`.

---

## 7. Important limitations

This feature does **not** include:
- historical telemetry backfill into a new shard topology
- migration of old local telemetry datasets into a newly sharded layout
- automatic chart values for the new app env vars in the public Helm chart

Recommended production assumption:
- treat sharded telemetry rollout as a fresh topology cutover
- handle historical backfill separately if needed

---

## 8. Minimal example

```yaml
clickhouseOperator:
  altinity:
    enabled: true
    cluster:
      shardsCount: 2
      replicasCount: 2
    keeper:
      enabled: true
      replicas: 3
    files:
      config.d/storage-s3-cold.xml: |
        <clickhouse>
          <storage_configuration>
            <disks>
              <s3_cold>
                <type>s3</type>
                <endpoint>https://s3.ap-northeast-2.amazonaws.com/your-bucket/oneuptime/</endpoint>
                <use_environment_credentials>1</use_environment_credentials>
                <metadata_path>/var/lib/clickhouse/disks/s3_cold/</metadata_path>
              </s3_cold>
            </disks>
            <policies>
              <tiered>
                <volumes>
                  <default>
                    <disk>default</disk>
                  </default>
                  <s3_cold>
                    <disk>s3_cold</disk>
                  </s3_cold>
                </volumes>
              </tiered>
            </policies>
          </storage_configuration>
        </clickhouse>
```

Inject these env vars into both app and worker:

```bash
CLICKHOUSE_COLD_TIER_ENABLED=true
CLICKHOUSE_COLD_TIER_STORAGE_POLICY=tiered
CLICKHOUSE_COLD_TIER_VOLUME=s3_cold
CLICKHOUSE_COLD_TIER_METRICS_DAYS=7
CLICKHOUSE_COLD_TIER_LOGS_DAYS=7
CLICKHOUSE_COLD_TIER_TRACES_DAYS=3
CLICKHOUSE_TELEMETRY_SHARDING_ENABLED=true
CLICKHOUSE_CLUSTER_NAME=ou
```
