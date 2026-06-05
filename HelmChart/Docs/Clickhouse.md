### Clickhouse Ops

To access clickhouse use port forwarding in kubernetes

```
kubectl port-forward --address 0.0.0.0 service/oneuptime-oneuptime 8123:8123
```

then you should be able to access from the localhost and port 8123

```
# Username for Postgres user is `oneuptime`
echo $(kubectl get secret --namespace "default" oneuptime-clickhouse -o jsonpath="{.data.admin-password}" | base64 -d)
```

Important: Please ignore % in the end of the password output. 


### Basic Ops Queries
 

#### Check Size of Tables in Clickhouse

```sql
SELECT
    database,
    table,
    formatReadableSize(sum(data_compressed_bytes) AS size) AS compressed,
    formatReadableSize(sum(data_uncompressed_bytes) AS usize) AS uncompressed,
    round(usize / size, 2) AS compr_rate,
    sum(rows) AS rows,
    count() AS part_count
FROM system.parts
WHERE (active = 1) AND (database LIKE '%') AND (table LIKE '%')
GROUP BY
    database,
    table
ORDER BY size DESC;
```


#### Check the size fo used and free space in Clickhouse

```sql
SELECT
    d.name AS disk_name,
    formatReadableSize(d.free_space) AS free_space,
    formatReadableSize(d.total_space) AS total_space,
    formatReadableSize(d.total_space - d.free_space) AS used_space,
    round((d.total_space - d.free_space) / d.total_space * 100, 2) AS used_percent
FROM system.disks d
ORDER BY used_percent DESC;
```


### Get List of queries running in Clickhouse

```sql
SELECT
*
FROM system.processes
ORDER BY elapsed DESC;
```

#### Kill a query in Clickhouse

```sql
KILL QUERY WHERE query_id = 'your_query_id';
```


#### Get size of avg row in bytes by table. 

```
SELECT
  c.table,
  sum(c.data_uncompressed_bytes) AS total_uncompressed_bytes,
  t.total_rows,
  sum(c.data_uncompressed_bytes) / t.total_rows AS avg_uncompressed_row_size_bytes
FROM system.columns c
JOIN system.tables t
  ON c.database = t.database AND c.table = t.name
WHERE c.database = 'oneuptime'
GROUP BY c.table, t.total_rows
ORDER BY avg_uncompressed_row_size_bytes DESC;
```

### Operator-managed ClickHouse with the Altinity operator (optional)

By default OneUptime runs ClickHouse as a single-replica `StatefulSet` (no
replication or declarative lifecycle management). You can instead run ClickHouse
under the [Altinity ClickHouse operator](https://github.com/Altinity/clickhouse-operator),
which adds declarative management, rolling upgrades, sharding, and replication
(HA) via a bundled [ClickHouse Keeper](https://clickhouse.com/docs/en/guides/sre/keeper/clickhouse-keeper)
ensemble.

Enabling it is a single switch. The Altinity operator is **bundled** as a chart
dependency and installed together with the release. The config lives in a
self-contained, top-level `clickhouseOperator` object (**not** nested under
`clickhouse`); `altinity` is nested so other operators can be added later:

```yaml
# values.yaml
clickhouseOperator:
  altinity:
    enabled: true        # turns on the operator + an operator-managed CHI + Keeper
    image:
      tag: "25.3"        # pin a ClickHouse version for production
    cluster:
      shardsCount: 1
      replicasCount: 2   # 2 = HA (needs the bundled Keeper, on by default)
```

When `clickhouseOperator.altinity.enabled` is `true`:

* The built-in `StatefulSet`, its `Service`s and `ConfigMap` are **not** rendered
  (regardless of `clickhouse.enabled`; the operator path takes precedence).
* A `ClickHouseInstallation` (CHI) named `<release>-clickhouse-altinity` is created.
* The app connects as the `oneuptime` user to the root CHI service
  `<release>-clickhouse-altinity` on port `8123`, using the password in the
  `<release>-clickhouse-altinity` secret (auto-generated, or set
  `clickhouseOperator.altinity.auth.password`). The password is preserved across
  upgrades.
* A bundled ClickHouse Keeper ensemble (`<release>-clickhouse-keeper`, 3 nodes by
  default) is created to coordinate replication.

Read the ClickHouse user password:

```
echo $(kubectl get secret --namespace "default" oneuptime-clickhouse-altinity -o jsonpath="{.data.admin-password}" | base64 -d)
```

> **Bundled-operator caveats.** The Altinity operator is cluster-scoped and owns
> the ClickHouse CRDs (`ClickHouseInstallation`, etc.), installed via Helm hooks.
> Do **not** enable the bundled operator in more than one OneUptime release in the
> same cluster (they would fight over the CRDs/RBAC). If you already run the
> Altinity operator cluster-wide, do not use the bundled mode. Tune the operator
> itself (including its `clickhouse_operator` management-user credentials) under the
> top-level `altinity-clickhouse-operator:` values.

#### Replication, sharding, and scaling

* **Replication (HA)** — `clickhouseOperator.altinity.cluster.replicasCount` is the
  number of copies of each shard. `replicasCount: 2` keeps two replicas (HA);
  the operator points them at the Keeper ensemble for `ReplicatedMergeTree`
  coordination and automatic recovery. Scaling is online: change the count and
  `helm upgrade`.
* **Sharding** — `clickhouseOperator.altinity.cluster.shardsCount` distributes data
  across shards for horizontal scale.
* **Keeper** — the bundled `keeper` (3-node quorum by default) is required for
  `replicasCount > 1`. Set `keeper.replicas: 1` for dev/non-HA, or `5` for a larger
  quorum. To use an existing ZooKeeper/Keeper instead, set
  `clickhouseOperator.altinity.zookeeper.nodes` (this disables the bundled Keeper).

Inspect the installation and Keeper:

```
kubectl get chi <release>-clickhouse-altinity -o wide
kubectl get pods -l app.kubernetes.io/component=clickhouse-keeper
```

#### Backups (operator mode)

The Altinity operator has **no built-in snapshot backup** (unlike the Postgres /
CloudNativePG path). For backups, use
[clickhouse-backup](https://github.com/Altinity/clickhouse-backup) (full/incremental
backups to object storage), run as a sidecar or CronJob against the CHI pods. The
system-log tables are already capped with a 6-hour TTL (see
`clickhouseOperator.altinity.settings`) so they do not grow unbounded.

#### Migrating existing StatefulSet data into the operator

Turning on `clickhouseOperator.altinity.enabled` bootstraps a **fresh, empty**
ClickHouse — it does **not** copy data from the existing standalone `StatefulSet`.
Because OneUptime stores append-only telemetry here, the simplest migration is
often a fresh start (no copy); when you must keep history, copy it with
`clickhouse-backup` or `INSERT … SELECT remote(...)`. The full step-by-step
runbook — fresh-start vs. data-retaining paths, quiescing, verification,
rollback, and cleanup — lives in its own doc:

➡️ **[Migrating ClickHouse: Standalone → Altinity Operator](./MigrateClickhouseStandaloneToOperator.md)**
