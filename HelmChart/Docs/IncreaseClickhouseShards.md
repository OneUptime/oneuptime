# Scaling ClickHouse: Adding Shards (Operator)

A runbook for **increasing the number of shards** on an operator-managed
(Altinity) ClickHouse in OneUptime — the horizontal-scale knob that spreads
telemetry across more nodes.

> **Applies to the operator path only.** Sharding requires the
> [Altinity ClickHouse operator](https://github.com/Altinity/clickhouse-operator)
> (`clickhouseOperator.altinity.enabled: true`). The built-in standalone
> `StatefulSet` is a single node and cannot be sharded — migrate to the operator
> first (see [Migrate ClickHouse Standalone → Operator](./MigrateClickhouseStandaloneToOperator.md)),
> then follow this guide.

> **The one fact that drives this whole runbook:** adding a shard is **online**
> and the app picks it up automatically — but **existing data is NOT moved onto
> the new shard.** ClickHouse only routes _new_ inserts across the enlarged shard
> set; historical rows stay where they are. Plan for that (see
> [Existing data does not rebalance](#existing-data-does-not-rebalance)).

Replace `<release>` with your Helm release name (e.g. `oneuptime`) and run every
command in the release's namespace (add `-n <namespace>` if it isn't `default`).

---

## Shards vs. replicas

Don't confuse the two knobs — they scale different things:

| Knob                                                                        | What it does                                         | Existing data                         |
| --------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------- |
| `cluster.shardsCount` **(this guide)**                                      | **Horizontal scale** — splits data across more nodes | **Not** moved; only new inserts split |
| `cluster.replicasCount` ([replicas guide](./IncreaseClickhouseReplicas.md)) | **HA** — keeps N copies of each shard                | Auto-replicated to the new replica    |

OneUptime always runs the analytics schema as a **sharded + replicated cluster**:
each model's app-facing table is a `Distributed` table over a local
`ReplicatedMergeTree` table (`<T>Local`). Reads scatter-gather across shards;
writes route by a per-table sharding key. See
[Clickhouse.md → Cluster-aware analytics schema](./Clickhouse.md#cluster-aware-analytics-schema)
for the full model.

---

## TL;DR

```yaml
# values.yaml
clickhouseOperator:
  altinity:
    enabled: true
    cluster:
      name: oneuptime
      shardsCount: 3 # was 1
      replicasCount: 1 # leave as-is — this is copies-per-shard, not shards
```

```bash
# 1. Apply the topology change (operator provisions the new shard pods + PVCs)
helm upgrade <release> ./HelmChart/Public/oneuptime -f values.yaml

# 2. Wait for the new shard pods to be Ready and joined to the cluster
kubectl get chi <release>-clickhouse-altinity -o wide -w

# 3. Re-run the migration Job so schema-sync creates the tables on the new shard
helm upgrade <release> ./HelmChart/Public/oneuptime -f values.yaml
```

Then [verify](#verify) and decide how to handle
[old data that stays on the original shard](#existing-data-does-not-rebalance).

---

## Before you start

1. **You must be on the operator path.** `clickhouseOperator.altinity.enabled`
   must already be `true`. If you're on the standalone `StatefulSet`, migrate
   first.
2. **Keeper must be healthy.** Each shard's `ReplicatedMergeTree` tables and the
   `ON CLUSTER` DDL are coordinated through ClickHouse Keeper. The bundled 3-node
   Keeper (default `keeper.enabled: true`, `keeper.replicas: 3`) is enough — no
   Keeper change is needed to add shards. Confirm it's up before you start:
   ```bash
   kubectl get pods -l app.kubernetes.io/component=clickhouse-keeper
   ```
3. **Have capacity.** Every new shard is a **new pod + a new PersistentVolume**
   (`clickhouseOperator.altinity.persistence.size`, default `25Gi`). Make sure
   your cluster has schedulable nodes and storage.
4. **Pin the image tag.** `clickhouseOperator.altinity.image.tag` defaults to
   `latest`. Pin a real version (e.g. `"25.3"`) so a topology change doesn't
   silently pull a new ClickHouse server version at the same time.
5. **Take a backup.** The operator has **no built-in snapshot backup**. If you
   don't already run [clickhouse-backup](https://github.com/Altinity/clickhouse-backup),
   take one before changing topology.

---

## Step 1 — Raise the shard count and upgrade

Bump `shardsCount` in your values and upgrade:

```yaml
# values.yaml
clickhouseOperator:
  altinity:
    enabled: true
    image:
      tag: "25.3" # keep your pinned version
    cluster:
      name: oneuptime
      shardsCount: 3 # new target
      replicasCount: 1 # unchanged
```

```bash
helm upgrade <release> ./HelmChart/Public/oneuptime -f values.yaml
```

The Altinity operator provisions the new shard `StatefulSet`s + PVCs and rewrites
the cluster's `remote_servers` config to include them. **Your existing shard-0
data and pods are left in place — nothing is destroyed.** This is an online
operation.

---

## Step 2 — Let schema-sync create the tables on the new shard

OneUptime's schema-sync issues `CREATE TABLE IF NOT EXISTS <T>Local ON CLUSTER
'oneuptime'` on every run. Because it's `ON CLUSTER`, once the new shard is in the
cluster config the DDL creates the local `ReplicatedMergeTree` tables (and the
materialized-view triggers) on it automatically; `IF NOT EXISTS` makes it a no-op
on the existing shards. The `Distributed` wrapper does **not** need recreating —
it references the cluster _name_, so ClickHouse fans out to whatever shards are in
the config at query time.

> **The race to watch — you must re-run the migration Job.** In the default
> deployment, schema/data migrations run in a dedicated **migration Job**
> (`<release>-migrate-<revision>`, a Helm pre-upgrade/post-install hook), and the
> runtime app/worker pods are gated off (`RUN_DATABASE_MIGRATIONS_ON_BOOT=false`)
> — so **bouncing a worker pod will NOT create the tables on the new shard.** The
> migration Job for the upgrade above can also run _before_ the operator finishes
> bringing the new shard up. Either way, once the new shard pods are **Ready and
> joined**, re-run the upgrade so a fresh migration Job runs its schema-sync
> against the full shard set:
>
> ```bash
> helm upgrade <release> ./HelmChart/Public/oneuptime -f values.yaml
> ```
>
> (A no-op re-upgrade is fine — the hook Job re-runs each revision.)

---

## Verify

Topology — should now list N shards:

```sql
SELECT shard_num, replica_num, host_name
FROM system.clusters
WHERE cluster = 'oneuptime'
ORDER BY shard_num, replica_num;
```

Schema on the new shard — run this **against each shard** (port-forward to the
individual pod, or use `clusterAllReplicas`); every shard must hold the local
tables:

```sql
SELECT count() FROM system.tables
WHERE database = 'oneuptime' AND name LIKE '%Local';
```

Kubernetes:

```bash
kubectl get chi <release>-clickhouse-altinity -o wide
kubectl get pods  -l app.kubernetes.io/name=clickhouse
```

If a new shard is missing its `<T>Local` tables, schema-sync hasn't reached it
yet — re-run the `helm upgrade` from [Step 2](#step-2--let-schema-sync-create-the-tables-on-the-new-shard).

---

## Existing data does not rebalance

> ⚠️ **This is the biggest gotcha — read it before you scale.**

Adding a shard **does not move historical rows.** ClickHouse's `Distributed`
engine only routes _new_ inserts across shards (by each table's sharding key);
everything already on shard 0 stays on shard 0. Reads remain correct — they
scatter-gather across all shards — but shard 0 stays hot and the new shards start
empty until fresh data accumulates.

There is deliberately **no automatic backfill**: streaming a whole telemetry
dataset through one coordinator node OOMs / times out at scale. Choose one of:

- **Recommended for telemetry: let it balance naturally.** Spans, logs, and
  metrics carry a TTL, so old data ages out of shard 0 while new data spreads
  across all shards. Within your retention window the cluster self-balances with
  zero risk and zero effort. This is the right default for the vast majority of
  cases.
- **Manual redistribution (only if you can't wait).** ClickHouse has no safe
  built-in online rebalance, and naively re-inserting live rows through the
  `Distributed` table **duplicates** them. If you must move history, do it in a
  maintenance window with ingestion quiesced, table-by-table (biggest first),
  from a _static snapshot_ of each table — not from the live table. Treat it as a
  real project, watch per-node memory, and verify row counts before dropping any
  source.

---

## Will more shards actually help?

Yes for the heavy tables. The high-volume telemetry models set **high-cardinality
sharding keys**, so their data genuinely spreads across shards:

| Table             | Sharding key                                   |
| ----------------- | ---------------------------------------------- |
| Span              | `cityHash64(traceId)`                          |
| Log               | `cityHash64(projectId, primaryEntityId, time)` |
| Metric            | `cityHash64(projectId, name, primaryEntityId)` |
| ExceptionInstance | `cityHash64(projectId, fingerprint)`           |

Only models that **don't** set their own key fall back to
`cityHash64(projectId)`. With few large tenants, a `projectId`-keyed table can
hotspot a single shard (all of one big project's rows land together). If that's
your situation, override the sharding key globally with
`clickhouseOperator.altinity.cluster.shardingKey` — but for the big telemetry
tables the built-in per-model keys already shard well.

---

## Rolling back / scaling down

> **⚠️ Scaling shards _down_ deletes data.** Reducing `shardsCount` removes the
> higher-numbered shard `StatefulSet`s **and their PVCs** — the rows on those
> shards are **lost** unless you redistribute them onto the remaining shards
> first. This is not a safe rollback for a shard you've already ingested into.
> (Contrast with [replicas](./IncreaseClickhouseReplicas.md), where scaling down
> is safe because every replica is a full copy.)

If you added shards but **nothing has been written to them yet** (e.g. you're
reverting immediately), lowering `shardsCount` back and re-upgrading is safe. Once
telemetry has landed on the new shards, treat a scale-down as data loss and plan a
redistribution first.

---

## See also

- [Clickhouse.md](./Clickhouse.md) — operator day-2 operations: the cluster-aware
  analytics schema, Keeper sizing, sharding keys, and backups.
- [Scaling ClickHouse: Adding Replicas (Operator)](./IncreaseClickhouseReplicas.md)
  — the HA knob (`replicasCount`).
- [Migrate ClickHouse Standalone → Operator](./MigrateClickhouseStandaloneToOperator.md)
  — get onto the operator path first if you're still on the standalone
  `StatefulSet`.
- OneUptime Helm chart [values reference](../Public/oneuptime/README.md) —
  `clickhouseOperator` configuration.
