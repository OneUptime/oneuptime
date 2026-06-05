# Migrating ClickHouse: Standalone → Altinity Operator

This is a step-by-step runbook for moving an existing OneUptime install from the
built-in **standalone ClickHouse `StatefulSet`** to the **operator-managed**
ClickHouse provided by the bundled
[Altinity ClickHouse operator](https://github.com/Altinity/clickhouse-operator).

> **Why migrate?** The standalone deployment is a single replica — no replication
> and no declarative lifecycle management. The operator adds declarative
> management, rolling upgrades, sharding, and replication (HA) backed by a bundled
> [ClickHouse Keeper](https://clickhouse.com/docs/en/guides/sre/keeper/clickhouse-keeper)
> ensemble. See [Clickhouse.md](./Clickhouse.md) for the operator's day-2
> operations.

> **The one fact that drives this whole runbook:** enabling the operator
> bootstraps a **fresh, empty** ClickHouse. It does **not** adopt the
> standalone's PersistentVolume in place. The OneUptime app re-creates its
> ClickHouse **schema** automatically on startup (its built-in migrations own the
> table definitions), so a migration only has to deal with the **data** — and
> only if you need to keep history.

---

## What actually changes

Only the connection target and the password secret change — the app keeps using
the `oneuptime` user and the `oneuptime` database, so no application config
changes are required beyond flipping the Helm switch.

| | Standalone (`clickhouse.enabled: true`) | Operator (`clickhouseOperator.altinity.enabled: true`) |
|---|---|---|
| Workload | `StatefulSet/<release>-clickhouse-shard0` (1 replica) | `ClickHouseInstallation/<release>-clickhouse-altinity` |
| App connects to (`CLICKHOUSE_HOST`) | `<release>-clickhouse` | `<release>-clickhouse-altinity` |
| HTTP port (`CLICKHOUSE_PORT`) | `8123` | `8123` |
| Native TCP port | `9000` | `9000` |
| User (`CLICKHOUSE_USER`) | `oneuptime` | `oneuptime` |
| Database (`CLICKHOUSE_DATABASE`) | `oneuptime` | `oneuptime` |
| Password secret | `<release>-clickhouse` → key `admin-password` | `<release>-clickhouse-altinity` → key `admin-password` |
| Coordination | — | ClickHouse Keeper `<release>-clickhouse-keeper` |

Replace `<release>` with your Helm release name (e.g. `oneuptime`) and run every
command in the release's namespace (add `-n <namespace>` if it isn't `default`).

When `clickhouseOperator.altinity.enabled` is `true`, the chart stops rendering
the standalone `StatefulSet`, its `Service`s, and its `ConfigMap`
**regardless of `clickhouse.enabled`** — the operator path always takes
precedence. The standalone's PVC (`data-<release>-clickhouse-shard0-0`) is
**retained** (it isn't garbage-collected when the StatefulSet stops rendering),
so your old data survives the cutover and stays available to copy from until you
delete it.

---

## Decide first: do you actually need the historical data?

ClickHouse in OneUptime holds **telemetry** — logs, metrics, traces, and
exceptions. This is append-only, time-series data, often very large, and most of
it ages out under retention/TTL policies anyway.

* **If you do _not_ need to keep history** (e.g. dev/test, or you're fine
  starting telemetry fresh), this migration is trivial: just
  [flip the switch](#the-simplest-path-fresh-start-no-data-copy). The app
  recreates an empty schema on the new cluster and starts ingesting. **No data
  copy, no downtime dance.** This is the recommended path when it's acceptable.
* **If you _must_ retain history**, use [Option A](#option-a--clickhouse-backup-recommended-for-large-datasets)
  or [Option B](#option-b--remote-insertselect-over-the-network) below to copy
  the data after cutover. Budget time and scratch space proportional to your
  ClickHouse data size.

---

## The simplest path: fresh start (no data copy)

Set the operator on and the standalone off, then upgrade:

```yaml
# values.yaml
clickhouse:
  enabled: false
clickhouseOperator:
  altinity:
    enabled: true
    image:
      tag: "25.3"          # pin a ClickHouse version for production
    cluster:
      shardsCount: 1
      replicasCount: 2     # 2 = HA (uses the bundled Keeper, on by default)
    keeper:
      enabled: true
      replicas: 3
```

```bash
helm upgrade --install <release> ./HelmChart/Public/oneuptime -f values.yaml
```

The app reconnects to `<release>-clickhouse-altinity`, recreates its schema, and
resumes ingesting telemetry. The old standalone PVC stays around until you
[delete it](#after-cutover--cleanup). Done.

If you need history, **don't** stop here — read on.

---

## Quiescing application writes

To copy a consistent snapshot you want the app to stop writing to ClickHouse
during the capture/cutover window:

```bash
helm upgrade --install <release> ./HelmChart/Public/oneuptime \
  -f <your-values.yaml> \
  --set deployment.disableDeployments=true
```

`disableDeployments=true` scales the OneUptime app/worker Deployments down **and
removes their KEDA `ScaledObject`s** — a plain `kubectl scale` would be reverted
by KEDA's min-replica floor, so always use this flag. Re-enable by removing it
(or setting it back to `false`) on the final cutover upgrade.

> ClickHouse ingestion is buffered/asynchronous; quiescing the app drains the
> writers so no new parts land mid-copy.

---

## Recommended cutover sequence (when retaining data)

Because the chart renders the standalone and the operator **mutually
exclusively**, you cut over first and copy second:

1. [Quiesce the app](#quiescing-application-writes) so writes stop.
2. **Capture** the standalone data (Option A: back it up now) **or** rely on the
   retained PVC (Option B copies from it after cutover).
3. **Flip to operator mode** and `helm upgrade` (keep `disableDeployments=true`).
   The operator + Keeper come up; the app stays down so it doesn't ingest yet.
   Briefly start the app **once** (or run the schema bootstrap) so the **schema**
   is created on the new cluster, then quiesce again — data copy is data-only.
4. **Load the data** into the new cluster ([Option A](#option-a--clickhouse-backup-recommended-for-large-datasets)
   restore, or [Option B](#option-b--remote-insertselect-over-the-network) copy).
5. [Verify row counts](#verifying-the-migration).
6. **Re-enable the app** (remove `disableDeployments`).

> **Why schema-first, then data-only?** The operator-managed cluster may use
> replicated table engines and the app's migrations are the source of truth for
> the table definitions. Let the app create the (empty) schema, then load only
> the rows (`INSERT … SELECT` / `restore --data`) so you never fight over DDL.

---

## Option A — `clickhouse-backup` (recommended for large datasets)

[clickhouse-backup](https://github.com/Altinity/clickhouse-backup) does
full/incremental backups to object storage (S3/GCS/…). Best when you already have
object storage or the dataset is large.

**1. Back up the standalone** (run `clickhouse-backup` as a sidecar, a `Job`, or
manually against `<release>-clickhouse-shard0-0`), then upload to your object
store:

```bash
clickhouse-backup create migration-snapshot
clickhouse-backup upload  migration-snapshot
```

**2. Cut over** to operator mode and let the app create the schema (see the
[recommended sequence](#recommended-cutover-sequence-when-retaining-data) above).

**3. Restore _data only_** into the new cluster (the schema already exists, so
restore without it to avoid DDL conflicts):

```bash
clickhouse-backup download    migration-snapshot
clickhouse-backup restore --data migration-snapshot
```

> On a multi-replica operator cluster (`replicasCount > 1`) the OneUptime tables
> are replicated — restore the data on **one** replica and let ClickHouse
> replication propagate it to the others. Don't restore the same parts to every
> replica.

---

## Option B — `remote()` INSERT…SELECT over the network

No object storage required. After cutover, the old standalone `StatefulSet` is
gone but its PVC remains; bring it back up read-only in a throwaway pod and pull
each table's rows into the new cluster with the
[`remote()`](https://clickhouse.com/docs/en/sql-reference/table-functions/remote)
table function.

**1. Cut over** to operator mode and let the app create the schema (see the
[recommended sequence](#recommended-cutover-sequence-when-retaining-data)).

**2. Bring the old data up as a temporary reader.** Create a one-replica
`StatefulSet`/`Pod` from the `clickhouse/clickhouse-server` image that mounts the
retained PVC `data-<release>-clickhouse-shard0-0` at `/var/lib/clickhouse`, and
expose it as a `Service` named `clickhouse-old` on port `9000`. (Use the same
image tag your standalone ran.)

**3. Copy each table, data-only**, from the new cluster, reading the old user's
password from the retained `<release>-clickhouse` secret:

```sql
-- Run against the new operator cluster (<release>-clickhouse-altinity).
-- Repeat for every table in the `oneuptime` database; the schema already exists.
INSERT INTO oneuptime.<table>
SELECT * FROM remote('clickhouse-old:9000', 'oneuptime', '<table>', 'oneuptime', '<old-password>');
```

To enumerate the tables to copy:

```sql
SELECT name FROM system.tables WHERE database = 'oneuptime' AND engine NOT LIKE '%View';
```

> Skip materialized/standard views (the app recreates them); copy only the base
> `*MergeTree` tables. For very large tables, copy in partition-sized batches
> (add a `WHERE` on the partition key) so a single `INSERT` doesn't run out of
> memory.

**4.** [Verify](#verifying-the-migration), then delete the temporary reader pod
and (later) the old PVC.

---

## Verifying the migration

Before re-enabling the app, compare per-table row counts between the old and new
clusters:

```sql
-- Run on both the old standalone and the new operator cluster, then compare.
SELECT table, sum(rows) AS rows
FROM system.parts
WHERE active AND database = 'oneuptime'
GROUP BY table
ORDER BY table;
```

Only re-enable ingestion once the counts match for the tables you care about.

---

## Rollback

Until you delete the old PVC, rollback is a one-line revert — the standalone data
is intact:

```bash
helm upgrade --install <release> ./HelmChart/Public/oneuptime -f <your-values.yaml> \
  --set clickhouseOperator.altinity.enabled=false \
  --set clickhouse.enabled=true
```

The app reconnects to `<release>-clickhouse`. (Telemetry ingested into the
operator cluster after cutover won't be on the standalone.)

---

## After cutover / cleanup

1. **Confirm health** of the installation and Keeper:
   ```bash
   kubectl get chi <release>-clickhouse-altinity -o wide
   kubectl get pods -l app.kubernetes.io/component=clickhouse-keeper
   ```
2. **Tune replication/sharding** — `clickhouseOperator.altinity.cluster.replicasCount`
   for HA, `shardsCount` for horizontal scale. Scaling is online; see
   [Clickhouse.md](./Clickhouse.md).
3. **Set up backups** — the operator has no built-in snapshot backup; schedule
   [clickhouse-backup](https://github.com/Altinity/clickhouse-backup) going
   forward.
4. **Decommission the standalone** once you're confident: delete the retained PVC
   (and the temporary reader pod from Option B) to reclaim storage.
   ```bash
   kubectl delete pvc data-<release>-clickhouse-shard0-0
   ```
   You can also delete the old `<release>-clickhouse` secret if nothing else
   references it.

---

## See also

* [Clickhouse.md](./Clickhouse.md) — operator day-2 operations: replication,
  sharding, Keeper sizing / bring-your-own ZooKeeper, and backups.
* OneUptime Helm chart [README](../Public/oneuptime/README.md) —
  `clickhouseOperator` configuration reference.
