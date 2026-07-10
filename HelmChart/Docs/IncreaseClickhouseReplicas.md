# Scaling ClickHouse: Adding Replicas (Operator)

A runbook for **increasing the replica count** on an operator-managed (Altinity)
ClickHouse in OneUptime — the high-availability knob that keeps N copies of each
shard's data.

> **Applies to the operator path only.** Replication requires the
> [Altinity ClickHouse operator](https://github.com/Altinity/clickhouse-operator)
> (`clickhouseOperator.altinity.enabled: true`) and a
> [ClickHouse Keeper](https://clickhouse.com/docs/en/guides/sre/keeper/clickhouse-keeper)
> ensemble to coordinate. The built-in standalone `StatefulSet` is a single
> replica with no HA — migrate to the operator first (see
> [Migrate ClickHouse Standalone → Operator](./MigrateClickhouseStandaloneToOperator.md)).

> **The good news:** unlike [adding shards](./IncreaseClickhouseShards.md), adding
> a replica **does** bring existing data with it. Each `<T>Local` table is a
> `ReplicatedMergeTree`; a newly added replica registers in Keeper and
> **automatically pulls every existing part** from its peers. No manual backfill,
> no rebalancing — just capacity and Keeper.

Replace `<release>` with your Helm release name (e.g. `oneuptime`) and run every
command in the release's namespace (add `-n <namespace>` if it isn't `default`).

---

## Replicas vs. shards

| Knob                                                                  | What it does                                    | Existing data                         |
| --------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------- |
| `cluster.replicasCount` **(this guide)**                              | **HA** — keeps N copies of each shard           | Auto-replicated to the new replica    |
| `cluster.shardsCount` ([shards guide](./IncreaseClickhouseShards.md)) | **Horizontal scale** — splits data across nodes | **Not** moved; only new inserts split |

`replicasCount` is **copies per shard**, not a total node count. With
`shardsCount: 3` and `replicasCount: 2` you get **6** ClickHouse pods (3 shards ×
2 replicas), and each shard's full dataset is stored **twice**.

OneUptime always runs the analytics schema as a **sharded + replicated cluster**:
each model's app-facing table is a `Distributed` table over a local
`ReplicatedMergeTree` table (`<T>Local`). The operator sets `internal_replication:
true` on the cluster, so the `Distributed` table writes each row to **one** replica
per shard and `ReplicatedMergeTree` fans it out to the other replicas through
Keeper. See
[Clickhouse.md → Cluster-aware analytics schema](./Clickhouse.md#cluster-aware-analytics-schema).

---

## TL;DR

```yaml
# values.yaml
clickhouseOperator:
  altinity:
    enabled: true
    cluster:
      name: oneuptime
      shardsCount: 1 # unchanged
      replicasCount: 2 # was 1 — 2 copies of each shard = HA
    keeper:
      enabled: true # REQUIRED for replicasCount > 1
      replicas: 3
```

```bash
helm upgrade <release> ./HelmChart/Public/oneuptime -f values.yaml
```

The operator adds the new replica pods; each one pulls existing data from its peer
via Keeper. Then [verify replication health](#verify).

---

## Before you start

1. **You must be on the operator path.** `clickhouseOperator.altinity.enabled`
   must already be `true`.
2. **Keeper is REQUIRED and must be healthy.** `replicasCount > 1` needs a
   coordinator — the bundled ClickHouse Keeper. It's on by default
   (`keeper.enabled: true`, `keeper.replicas: 3`). Confirm the quorum is up
   _before_ scaling, because the new replicas can't join without it:
   ```bash
   kubectl get pods -l app.kubernetes.io/component=clickhouse-keeper
   ```
   For a larger/HA-critical cluster use a 5-node quorum (`keeper.replicas: 5`).
   To point at an existing ZooKeeper/Keeper instead, set
   `clickhouseOperator.altinity.zookeeper.nodes` (this disables the bundled
   Keeper).
3. **Budget the storage.** Each replica is a **full copy** of its shard's data. A
   new PersistentVolume (`clickhouseOperator.altinity.persistence.size`, default
   `25Gi`) is provisioned per new replica, and it fills up to roughly the same
   size as the shard it's copying. `replicasCount: 2` ≈ **2× total storage.**
4. **Pin the image tag.** `clickhouseOperator.altinity.image.tag` defaults to
   `latest`. Pin a real version (e.g. `"25.3"`) so a topology change doesn't
   pull a new ClickHouse server version at the same time.

---

## Step 1 — Raise the replica count and upgrade

Bump `replicasCount` in your values and upgrade:

```yaml
# values.yaml
clickhouseOperator:
  altinity:
    enabled: true
    image:
      tag: "25.3" # keep your pinned version
    cluster:
      name: oneuptime
      shardsCount: 1 # unchanged
      replicasCount: 2 # new target
    keeper:
      enabled: true
      replicas: 3
```

```bash
helm upgrade <release> ./HelmChart/Public/oneuptime -f values.yaml
```

The operator adds a new replica pod (and PVC) for each shard and updates the
cluster's `remote_servers` config. This is an **online** operation — existing
replicas keep serving reads and writes throughout.

---

## Step 2 — Replicas self-populate (no manual step)

There is nothing to backfill. As each new replica pod comes up:

- the operator (schema policy `replica: All`) plus OneUptime's `ON CLUSTER`
  schema-sync ensure the `<T>Local` tables exist on it; and
- because those tables are `ReplicatedMergeTree`, the new replica registers its
  path in Keeper and **automatically fetches every existing part** from the
  already-populated replica(s). Once caught up it starts serving reads and
  receiving its share of new writes.

Initial sync streams the whole shard's history to the new replica, so on a large
dataset expect elevated network/disk I/O until `absolute_delay` reaches zero (see
below). Watch it rather than assuming it's instant.

---

## Verify

Topology — each shard should now show N replicas:

```sql
SELECT shard_num, replica_num, host_name
FROM system.clusters
WHERE cluster = 'oneuptime'
ORDER BY shard_num, replica_num;
```

Replication health — run against the cluster; a healthy new replica has
`is_session_expired = 0`, a draining `queue_size`, and `absolute_delay` trending
to `0`, with `active_replicas = total_replicas`:

```sql
SELECT
    database, table,
    total_replicas, active_replicas,
    queue_size, absolute_delay,
    is_readonly, is_session_expired
FROM system.replicas
WHERE database = 'oneuptime'
ORDER BY absolute_delay DESC;
```

Kubernetes:

```bash
kubectl get chi <release>-clickhouse-altinity -o wide
kubectl get pods  -l app.kubernetes.io/name=clickhouse
kubectl get pods  -l app.kubernetes.io/component=clickhouse-keeper
```

---

## Scaling down replicas

Unlike shards, scaling replicas **down is safe** — every replica is a full copy,
so removing one loses no data as long as at least one healthy replica of each
shard remains. Lower `replicasCount` and re-upgrade:

```bash
helm upgrade <release> ./HelmChart/Public/oneuptime -f values.yaml
```

> **Cleanup note.** The operator removes the extra replica pods, but the released
> PersistentVolumeClaims may be **retained** (they aren't always garbage-collected).
> Reclaim the storage manually once you're confident:
>
> ```bash
> kubectl get pvc -l app.kubernetes.io/name=clickhouse   # find the orphaned PVCs
> kubectl delete pvc <name>
> ```
>
> Never drop below `replicasCount: 1`, and don't remove a replica while it's the
> only healthy copy of a shard.

---

## See also

- [Clickhouse.md](./Clickhouse.md) — operator day-2 operations: the cluster-aware
  analytics schema, Keeper sizing / bring-your-own ZooKeeper, and backups.
- [Scaling ClickHouse: Adding Shards (Operator)](./IncreaseClickhouseShards.md) —
  the horizontal-scale knob (`shardsCount`).
- [Migrate ClickHouse Standalone → Operator](./MigrateClickhouseStandaloneToOperator.md)
  — get onto the operator path first if you're still on the standalone
  `StatefulSet`.
- OneUptime Helm chart [values reference](../Public/oneuptime/README.md) —
  `clickhouseOperator` configuration.
