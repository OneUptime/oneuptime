### Postgres Ops

To access postgres use port forwarding in kubernetes

```
kubectl port-forward --address 0.0.0.0 service/oneuptime-postgresql 5432:5432
```

then you should be able to access from the localhost and port 5432

You also need to read postgres password which is stored in kubenretes secrets. You can decode the password by using this command: 


```
# Username for Postgres user is `postgres`
echo $(kubectl get secret --namespace "default" oneuptime-postgresql -o jsonpath="{.data.postgres-password}" | base64 -d)
```

Important: Please ignore % in the end of the password output. 


```
# Username for Postgres user is `oneuptime`
echo $(kubectl get secret --namespace "default" oneuptime-postgresql -o jsonpath="{.data.password}" | base64 -d)
```

Important: Please ignore % in the end of the password output. 


This will make the database accessible from the localhost:5432.


### Postgres Backup

Please fill the values in config.env file and run the following command to take the backup of the database.

```
bash ./backup.sh
```

### Postgres Restore

Please fill the values in config.env file and run the following command to restore the database.

```
bash ./restore.sh
```

### Create Read Only User in Postgres (This can be used for reporting purpose like Metabase)

```
CREATE ROLE readonlyuser WITH LOGIN PASSWORD '<password>'
GRANT pg_read_all_data TO readonlyuser;
```


### Increasing max_connections for postgres. 

To see the current number of max_connections. You need to run the following command in psql.

```
SHOW max_connections;
```

To increase the max_connections, you need to run this sql command in psql.


```
ALTER SYSTEM SET max_connections = 200;
```

Then you need to restart the postgres pod. 


### Check used and free space in Postgres

```sql
SELECT
    datname AS database_name,
    pg_size_pretty(pg_database_size(datname)) AS used_space
FROM pg_database
ORDER BY pg_database_size(datname) DESC;
```

### Operator-managed Postgres with CloudNativePG (optional)

By default OneUptime runs Postgres as a single-replica `StatefulSet` (no
replication, failover, or built-in backups). You can instead run Postgres under
the [CloudNativePG](https://cloudnative-pg.io) operator, which adds HA
(primary + hot standbys), automated failover, rolling minor upgrades, and
backup/PITR.

Enabling it is a single switch. The CloudNativePG operator is **bundled** as a
chart dependency and installed together with the release. The config lives in a
self-contained, top-level `postgresOperator` object (**not** nested under
`postgresql`); `cnpg` is nested so other operators can be added later:

```yaml
# values.yaml
postgresOperator:
  cnpg:
    enabled: true        # turns on the operator + an operator-managed Cluster
    instances: 3         # 1 primary + 2 hot standbys (use 1 for single node)
    imageName: "ghcr.io/cloudnative-pg/postgresql:17.4"   # pin a minor version
    database: oneuptimedb
```

When `postgresOperator.cnpg.enabled` is `true`:

* The built-in `StatefulSet`, its `Service`s and `ConfigMap`s are **not**
  rendered (regardless of `postgresql.enabled`; the operator path takes
  precedence).
* A CloudNativePG `Cluster` named `<release>-postgresql-cnpg` is created.
* The app connects as the `postgres` superuser to the read-write service
  `<release>-postgresql-cnpg-rw` on port `5432`, using the password in the
  `<release>-postgresql-cnpg-superuser` secret (auto-generated, or set
  `postgresOperator.cnpg.postgresPassword`). The password is preserved across
  upgrades.
* The object is self-contained — `database`, `persistence`, `resources`,
  `nodeSelector`, `tolerations` and CloudNativePG `parameters` all live under
  `postgresOperator.cnpg.*`. It does not read any `postgresql.*` values.

Read the superuser password:

```
echo $(kubectl get secret --namespace "default" oneuptime-postgresql-cnpg-superuser -o jsonpath="{.data.password}" | base64 -d)
```

> **Bundled-operator caveats.** The operator is cluster-scoped and owns the
> CloudNativePG CRDs. Do **not** enable the bundled operator in more than one
> OneUptime release in the same cluster (they would fight over the CRDs/RBAC).
> Because the CRDs are installed by the chart, `helm uninstall` can remove them
> and cascade-delete every CloudNativePG `Cluster` in the cluster — back up
> first. If you already run CloudNativePG cluster-wide, do not use the bundled
> mode.

### Replication, failover, and scaling (CloudNativePG)

When `postgresOperator.cnpg.enabled` is set, replication and failover are managed
by the operator:

* **Replication** — `postgresOperator.cnpg.instances` is the total number of
  PostgreSQL pods. `instances: 3` = 1 primary + 2 streaming hot-standby replicas.
  Scaling is online: change `instances` and `helm upgrade`.
* **Automatic failover** — if the primary becomes unhealthy the operator promotes
  a replica and re-points the `-rw` service. No application change is needed.
* **Synchronous replication** — set `postgresOperator.cnpg.synchronousReplicas: N`
  for quorum-based synchronous commits (zero data loss). Keep
  `instances >= synchronousReplicas + 2` so a single standby outage does not block
  writes.
* **Read scaling** — send read-only/reporting traffic to the
  `<release>-postgresql-cnpg-ro` service (replicas only). The OneUptime app uses
  the `-rw` (primary) service.

Inspect cluster and replication status:

```
kubectl cnpg status <release>-postgresql-cnpg
# or, without the cnpg kubectl plugin:
kubectl get cluster <release>-postgresql-cnpg -o wide
```

**Sharding is not supported** by CloudNativePG or this chart. Scale via vertical
sizing, read replicas, connection pooling, and PostgreSQL table partitioning for
very large tables. Distributed sharding requires the Citus extension (or an
operator that wraps it) — a separate architecture, out of scope here.

### Backups (CloudNativePG volume snapshots)

Enable scheduled, online volume-snapshot backups — native to CloudNativePG, with
no object store or extra components:

```yaml
postgresOperator:
  cnpg:
    enabled: true
    backup:
      enabled: true
      schedule: "0 0 3 * * *"      # 6-field cron WITH seconds — 03:00 daily
      immediate: true
      volumeSnapshotClassName: ""  # your CSI VolumeSnapshotClass (empty = default)
      online: true                 # hot snapshot, no downtime
```

This sets `spec.backup.volumeSnapshot` on the cluster and creates a
`ScheduledBackup` named `<release>-postgresql-cnpg-backup`. Requirements: a CSI
driver that supports `VolumeSnapshot`, and a `VolumeSnapshotClass` (set
`volumeSnapshotClassName`, or rely on the driver default). Volume snapshots do
**not** require WAL archiving / an object store.

On-demand backup (needs the `cnpg` kubectl plugin):

```
kubectl cnpg backup <release>-postgresql-cnpg
```

**Restore** is a brand-new cluster that bootstraps from a snapshot instead of
`initdb` (the same `bootstrap.recovery` mechanism shown below), optionally with a
`recoveryTarget` for point-in-time recovery.

**Retention caveat.** CloudNativePG does **not** auto-prune volume snapshots —
`spec.backup.retentionPolicy` applies only to object-store (Barman) backups and is
deprecated. With snapshots, old `Backup` / `VolumeSnapshot` objects accumulate
until deleted. Options: prune them with your own job/process, rely on your CSI
driver or cloud provider's snapshot lifecycle, or switch to object-store backups
(Barman Cloud Plugin) which support a recovery-window retention policy plus
continuous WAL archiving (full PITR).

### Migrating existing StatefulSet data into CloudNativePG

Turning on `postgresOperator.cnpg.enabled` bootstraps a **fresh, empty**
cluster — it does not copy data from the existing `StatefulSet`. There is no supported way to hand the
operator your existing PV in place (different PVC ownership, a `pgdata`
sub-directory layout, and a different runtime UID). Use one of these one-time
migrations instead, keeping the old `StatefulSet` running until cutover.

**Option A — logical import (recommended).** Apply a one-off `Cluster` that
imports over the network with `pg_dump`/`pg_restore`. Version-flexible; downtime
≈ dump/restore time. Keep the old StatefulSet (`postgresql.enabled: true`,
`postgresOperator.cnpg.enabled: false`) running while this completes, then cut
the app over.

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: oneuptime-postgresql-cnpg
spec:
  instances: 1                       # scale up AFTER recovery is healthy
  imageName: ghcr.io/cloudnative-pg/postgresql:17.4   # match/upgrade your major
  storage:
    size: 25Gi
  superuserSecret:
    name: oneuptime-postgresql-cnpg-superuser
  enableSuperuserAccess: true
  bootstrap:
    initdb:
      import:
        type: microservice
        databases: ["oneuptimedb"]
        source:
          externalCluster: old-statefulset
  externalClusters:
    - name: old-statefulset
      connectionParameters:
        host: oneuptime-postgresql      # the existing StatefulSet service
        user: postgres
        dbname: oneuptimedb
      password:
        name: oneuptime-postgresql      # existing secret
        key: postgres-password
```

**Option B — `pg_basebackup` (minimal downtime, physical clone).** Requires the
**same major version** as the source. Set `bootstrap.pg_basebackup` instead of
`initdb.import`, pointing at the same `externalClusters` entry. Note: the
StatefulSet's `pg_hba.conf` uses `host all all ...`, which does **not** match
replication connections — add `host replication all 0.0.0.0/0 md5` to
`postgresql.primary.hbaConfiguration` on the source first, or basebackup is
rejected.

After either migration completes and the new cluster is healthy, switch the
release to operator mode (`postgresOperator.cnpg.enabled: true`) so the app
points at `<release>-postgresql-cnpg-rw`, scale `instances` up for HA, then
decommission the old StatefulSet and its PVC.

