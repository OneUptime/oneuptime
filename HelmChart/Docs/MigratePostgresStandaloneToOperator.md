# Migrating PostgreSQL: Standalone → CloudNativePG Operator

This is a step-by-step runbook for moving an existing OneUptime install from the
built-in **standalone PostgreSQL `StatefulSet`** to the **operator-managed**
PostgreSQL provided by the bundled [CloudNativePG](https://cloudnative-pg.io)
(CNPG) operator.

> **Why migrate?** The standalone deployment is a single replica — no
> replication, no automatic failover, no built-in backups. The operator adds
> streaming replication (primary + hot standbys), automatic failover, rolling
> minor upgrades, a read-only service, and scheduled volume-snapshot backups.
> See [Postgres.md](./Postgres.md) for the operator's day-2 operations.

> **The one fact that drives this whole runbook:** enabling the operator
> bootstraps a **fresh, empty** cluster. It does **not** adopt the standalone's
> PersistentVolume in place (different PVC ownership, a `pgdata` sub-directory
> layout, and a different runtime UID). You must copy the data over with one of
> the methods below, keeping the old `StatefulSet` running until cutover.

---

## What actually changes

Only the connection target and the password secret change — the app keeps using
the `postgres` user and the `oneuptimedb` database, so no application config
changes are required beyond flipping the Helm switch.

|                                   | Standalone (`postgresql.enabled: true`)          | Operator (`postgresOperator.cnpg.enabled: true`)       |
| --------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| Workload                          | `StatefulSet/<release>-postgresql` (1 replica)   | `Cluster/<release>-postgresql-cnpg` (N instances)      |
| App connects to (`DATABASE_HOST`) | `<release>-postgresql`                           | `<release>-postgresql-cnpg-rw` (read-write / primary)  |
| Read-only endpoint                | —                                                | `<release>-postgresql-cnpg-ro` (replicas)              |
| Port                              | `5432`                                           | `5432`                                                 |
| User (`DATABASE_USERNAME`)        | `postgres`                                       | `postgres`                                             |
| Database (`DATABASE_NAME`)        | `oneuptimedb`                                    | `oneuptimedb`                                          |
| Password secret                   | `<release>-postgresql` → key `postgres-password` | `<release>-postgresql-cnpg-superuser` → key `password` |

Replace `<release>` with your Helm release name (e.g. `oneuptime`) and run every
command in the release's namespace (add `-n <namespace>` if it isn't `default`).

When `postgresOperator.cnpg.enabled` is `true`, the chart stops rendering the
standalone `StatefulSet`, its `Service`s, and its `ConfigMap`s **regardless of
`postgresql.enabled`** — the operator path always takes precedence. The
standalone's PVC (`data-<release>-postgresql-0`) is **retained** (it is not
garbage-collected when the StatefulSet stops rendering), so your old data
survives the cutover and rollback stays possible until you delete it.

---

## Before you begin (pre-flight)

1. **Take a backup of the standalone database now**, independent of this
   migration (`pg_dump`, a PV snapshot, or your existing `backup.sh`). Every
   option below is non-destructive to the source, but back up anyway.

2. **Install the CloudNativePG CRDs first.** The CRDs ship as templates in the
   bundled subchart, so the very first `helm upgrade` with the operator enabled
   fails on a cluster that doesn't already have them (`no matches for kind
"Cluster" in version "postgresql.cnpg.io/v1"`). This is a one-time,
   cluster-scoped step — follow **"First install with the operator enabled
   (CRDs must exist first)"** in [Postgres.md](./Postgres.md) before you flip the
   switch.

3. **Pick a PostgreSQL major version.** `pg_dump`/`pg_restore` (Options A & C) is
   version-flexible — you can move to a newer major at the same time. The
   physical clone (Option B, `pg_basebackup`) requires the **same** major version
   on both ends. Pin it with `postgresOperator.cnpg.imageName`
   (e.g. `ghcr.io/cloudnative-pg/postgresql:17.4`).

4. **Plan for a short write outage.** OneUptime keeps running on the standalone
   during the copy; the cutover itself is a brief window where the app is
   quiesced so no writes are lost. Use a maintenance window for production.

---

## Quiescing application writes

Several steps below need the app to stop writing to Postgres so the copy is
consistent and the freshly-bootstrapped operator cluster isn't modified mid-restore:

```bash
helm upgrade --install <release> ./HelmChart/Public/oneuptime \
  -f <your-values.yaml> \
  --set deployment.disableDeployments=true
```

`disableDeployments=true` scales the OneUptime app/worker Deployments down **and
removes their KEDA `ScaledObject`s** — a plain `kubectl scale` would be reverted
by KEDA's min-replica floor, so always use this flag. Re-enable by removing it
(or setting it back to `false`) on the final cutover upgrade.

---

## Option A — operator-native logical import (recommended, version-flexible)

CloudNativePG can pull the whole database over the network with
`pg_dump`/`pg_restore` **as it bootstraps**, so the import finishes before the
app ever touches the new cluster. Downtime ≈ dump/restore time. Works across
major versions.

**1. Keep the standalone running** (`postgresql.enabled: true`,
`postgresOperator.cnpg.enabled: false`) so the operator can read from it.

**2. Create the superuser secret** the imported cluster will adopt. (The chart
normally creates this, but only once the operator switch is on — here we create
it up front so the one-off `Cluster` can reference it, and so the chart adopts
the same password later.) Pick a strong password:

```bash
kubectl create secret generic <release>-postgresql-cnpg-superuser \
  --from-literal=username=postgres \
  --from-literal=password='<choose-a-strong-password>' \
  --type=kubernetes.io/basic-auth
# Let Helm adopt it on the later upgrade instead of erroring on a pre-existing object:
kubectl label  secret <release>-postgresql-cnpg-superuser app.kubernetes.io/managed-by=Helm --overwrite
kubectl annotate secret <release>-postgresql-cnpg-superuser \
  meta.helm.sh/release-name=<release> \
  meta.helm.sh/release-namespace=<namespace> --overwrite
```

**3. Apply a one-off import `Cluster`** named exactly `<release>-postgresql-cnpg`
(so the chart adopts it later). It imports from the standalone over the network:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: <release>-postgresql-cnpg
spec:
  instances: 1 # scale up AFTER recovery is healthy
  imageName: ghcr.io/cloudnative-pg/postgresql:17.4 # match or upgrade your major version
  storage:
    size: 25Gi # >= your current data size
  enableSuperuserAccess: true
  superuserSecret:
    name: <release>-postgresql-cnpg-superuser
  bootstrap:
    initdb:
      database: oneuptimedb
      owner: oneuptime
      import:
        type: microservice
        databases: ["oneuptimedb"]
        source:
          externalCluster: old-standalone
  externalClusters:
    - name: old-standalone
      connectionParameters:
        host: <release>-postgresql # the existing standalone service
        user: postgres
        dbname: oneuptimedb
      password:
        name: <release>-postgresql # existing standalone secret
        key: postgres-password
```

**4. Watch the import and wait for the cluster to become healthy:**

```bash
kubectl get cluster <release>-postgresql-cnpg -o wide -w
# with the cnpg kubectl plugin:
kubectl cnpg status <release>-postgresql-cnpg
```

**5. [Verify the copy](#verifying-the-migration)** (row counts) before cutover.

**6. Cut over.** Flip the chart to operator mode. Because the `Cluster` (and its
superuser secret) already exist with the chart's names and Helm-ownership
metadata, Helm **adopts** them. The chart's template specifies a fresh
`bootstrap.initdb`, but CloudNativePG only ever runs `bootstrap` **once at
creation** — the already-imported data is untouched; the spec change is ignored
post-bootstrap. Set your real values and re-enable the app:

```yaml
# values.yaml
postgresql:
  enabled: false
postgresOperator:
  cnpg:
    enabled: true
    instances: 3 # 1 primary + 2 hot standbys
    imageName: ghcr.io/cloudnative-pg/postgresql:17.4 # same image as the import
    database: oneuptimedb
    persistence:
      size: 25Gi
```

```bash
helm upgrade --install <release> ./HelmChart/Public/oneuptime -f values.yaml
```

The app reconnects to `<release>-postgresql-cnpg-rw`. Then
[finish up](#after-cutover--cleanup).

---

## Option B — `pg_basebackup` (physical clone, minimal downtime)

A byte-for-byte physical clone. **Requires the same PostgreSQL major version** on
both ends. Use `bootstrap.pg_basebackup` instead of `initdb.import` in the same
one-off `Cluster` from Option A, pointing at the same `externalClusters` entry:

```yaml
bootstrap:
  pg_basebackup:
    source: old-standalone
```

**Caveat — replication access.** The standalone's `pg_hba.conf` uses
`host all all ...`, which does **not** match _replication_ connections, so
`pg_basebackup` is rejected by default. On the source first, add a replication
rule via `postgresql.primary.hbaConfiguration` and `helm upgrade` the standalone:

```yaml
postgresql:
  primary:
    hbaConfiguration: |
      host replication all 0.0.0.0/0 md5
```

Then apply the cluster, wait for it to be healthy, verify, and cut over exactly
as in Option A steps 4–6.

---

## Option C — manual `pg_dump` / `pg_restore` (most control)

Use this when you want full control, or when the operator can't reach the
standalone over the network (e.g. you've already torn it down and only the PVC
remains). The app is quiesced, the dump is restored into the
operator-bootstrapped cluster, then the app is re-enabled.

**1. Quiesce the app** ([see above](#quiescing-application-writes)) while leaving
the standalone running.

**2. Dump the standalone to a file _inside a pod_** (never stream a binary dump
through `kubectl exec` stdout — see the pitfalls below):

```bash
kubectl exec -it <release>-postgresql-0 -- \
  pg_dump -U postgres -d oneuptimedb -Fc -f /var/lib/postgresql/data/oneuptime.dump

# Verify the archive end-to-end (exit 0 == complete, not truncated):
kubectl exec -it <release>-postgresql-0 -- \
  pg_restore -f /dev/null /var/lib/postgresql/data/oneuptime.dump && echo "archive OK"
```

**3. Flip to operator mode** while keeping the app quiesced, so the chart
installs the operator and a fresh, empty cluster but the app does **not** start
writing to it yet:

```bash
helm upgrade --install <release> ./HelmChart/Public/oneuptime -f <your-values.yaml> \
  --set postgresql.enabled=false \
  --set postgresOperator.cnpg.enabled=true \
  --set postgresOperator.cnpg.instances=1 \
  --set deployment.disableDeployments=true
```

**4. Restore into the new cluster.** Read the operator superuser password and
restore against the read-write service. `--no-owner` avoids role-ownership
mismatches (the app connects as `postgres` either way):

```bash
PW=$(kubectl get secret <release>-postgresql-cnpg-superuser \
  -o jsonpath="{.data.password}" | base64 -d)

# From a throwaway client pod on the cluster network:
kubectl run pg-restore --rm -it --restart=Never --image=postgres:17 -- bash -lc "
  PGPASSWORD='$PW' pg_restore --no-owner --role=postgres -U postgres \
    -h <release>-postgresql-cnpg-rw -d oneuptimedb /path/to/oneuptime.dump"
```

> Copy the dump file to where the restore runs first (`kubectl cp`, or stream it
> _into_ a pod with `kubectl exec -i ... 'cat > file'`, which is reliable —
> checksum it to confirm). `pg_restore` of a custom-format dump needs a
> **seekable file on disk**; it cannot read one from a stdin pipe.

**5. Re-enable the app** (remove `disableDeployments`) and scale up:

```bash
helm upgrade --install <release> ./HelmChart/Public/oneuptime -f <your-values.yaml> \
  --set postgresql.enabled=false \
  --set postgresOperator.cnpg.enabled=true \
  --set postgresOperator.cnpg.instances=3
```

The app boots against `<release>-postgresql-cnpg-rw`; its schema migrations see
the objects already present and run idempotently.

### Two pitfalls that silently corrupt a manual migration

- **Never pipe `pg_dump` through `kubectl exec` stdout** (`kubectl exec ...
pg_dump -Fc > local.dump`). Large binary stdout gets its tail **silently
  truncated** — the archive looks fine to `pg_restore --list` (the TOC is at the
  front) but fails partway through restore with `could not read from input file:
end of file`. Always `pg_dump -Fc -f <file>` to a file inside the pod, reading
  the source over a normal libpq TCP connection, and verify with
  `pg_restore -f /dev/null <file>` before restoring.
- **`pg_restore` needs a seekable file** for a custom-format dump — it can't read
  one from a stdin pipe (same EOF error). Always restore from a file on disk.

---

## Verifying the migration

Before cutting the app over (or re-enabling it), confirm the copy is complete by
comparing per-table row counts between source and target.

On the **standalone**:

```sql
SELECT relname, n_live_tup
FROM pg_stat_user_tables
ORDER BY relname;
```

On the **operator** primary (`<release>-postgresql-cnpg-rw`), run the same query
and compare. For tables that matter most, an exact `SELECT count(*)` per table is
stronger than the `n_live_tup` estimate. Only proceed once they match.

---

## Rollback

Until you delete the old PVC, rollback is a one-line revert — the standalone
`StatefulSet` and its data are intact:

```bash
helm upgrade --install <release> ./HelmChart/Public/oneuptime -f <your-values.yaml> \
  --set postgresOperator.cnpg.enabled=false \
  --set postgresql.enabled=true
```

The app reconnects to `<release>-postgresql`. (Writes made to the operator
cluster after cutover won't be on the standalone, so roll back before resuming
production writes if you can.)

---

## After cutover / cleanup

1. **Confirm health and replication:**
   ```bash
   kubectl cnpg status <release>-postgresql-cnpg     # or: kubectl get cluster ... -o wide
   ```
2. **Scale up for HA** if you imported with `instances: 1` — set
   `postgresOperator.cnpg.instances: 3` (and optionally `synchronousReplicas`)
   and `helm upgrade`. Scaling is online.
3. **Enable scheduled backups** (`postgresOperator.cnpg.backup.enabled: true`) —
   see [Postgres.md](./Postgres.md).
4. **Decommission the standalone** once you're confident: delete the retained
   PVC to reclaim storage.
   ```bash
   kubectl delete pvc data-<release>-postgresql-0
   ```
   You can also delete the old `<release>-postgresql` secret if nothing else
   references it.

---

## See also

- [Postgres.md](./Postgres.md) — operator day-2 operations: CRD bootstrap,
  replication/failover, synchronous commits, read scaling, and volume-snapshot
  backups.
- OneUptime Helm chart [README](../Public/oneuptime/README.md) — `postgresOperator`
  configuration reference.
