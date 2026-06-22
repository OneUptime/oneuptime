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
ALTER SYSTEM SET max_connections = 1000;
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

#### First install with the operator enabled (CRDs must exist first)

The CloudNativePG CRDs ship as **templates** in the bundled subchart, not in a
`crds/` directory. Helm renders and validates *every* manifest against the API
server **before** applying anything, so on a cluster that does not yet have the
CRDs the very first `helm install`/`helm upgrade` with
`postgresOperator.cnpg.enabled: true` aborts with:

```
Error: ... resource mapping not found for name: "<release>-postgresql-cnpg" ...
no matches for kind "Cluster" in version "postgresql.cnpg.io/v1"
ensure CRDs are installed first
```

Nothing is applied (not even the CRDs), so re-running Helm alone does **not**
help. `--disable-openapi-validation` does not fix it either (the failure is a
resource-mapping check, not schema validation). Install the CRDs **once** before
the first Helm run, then proceed normally. They are cluster-scoped, so this is a
one-time step per cluster:

```bash
# 1) Render the chart and apply ONLY the CloudNativePG CRDs first.
helm template oneuptime ./HelmChart/Public/oneuptime \
  -f ./HelmChart/Public/oneuptime/values.yaml \
  -f ./HelmChart/Values/<your>.values.yaml \
| python3 -c 'import sys,re; d=sys.stdin.read().split("\n---\n"); print("\n---\n".join(x for x in d if re.search(r"^kind: CustomResourceDefinition$",x,re.M) and "cnpg.io" in x))' \
| kubectl apply --server-side -f -

# 2) Hand the CRDs to Helm so the upgrade can adopt them (crds.create stays true).
for c in $(kubectl get crd -o name | grep '\.postgresql\.cnpg\.io' | sed 's#.*/##'); do
  kubectl label  crd "$c" app.kubernetes.io/managed-by=Helm --overwrite
  kubectl annotate crd "$c" \
    meta.helm.sh/release-name=oneuptime \
    meta.helm.sh/release-namespace=default --overwrite
done

# 3) Now the normal install/upgrade (e.g. npm run deploy-test) succeeds.
helm upgrade --install oneuptime ./HelmChart/Public/oneuptime \
  -f ./HelmChart/Public/oneuptime/values.yaml -f ./HelmChart/Values/<your>.values.yaml
```

Step 2 is only needed if you keep the default `cloudnative-pg.crds.create: true`
(Helm then manages CRD upgrades for you). Alternatively, set
`cloudnative-pg.crds.create: false` so Helm never templates or owns the CRDs —
then skip step 2, but you must apply CRD upgrades out of band yourself. Once the
CRDs exist, all subsequent upgrades work in a single pass.

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
cluster — it does **not** copy data from the existing standalone `StatefulSet`
(different PVC ownership, a `pgdata` sub-directory layout, and a different runtime
UID mean there's no supported in-place PV hand-off). The full step-by-step
migration runbook — operator-native logical import, `pg_basebackup`, and manual
`pg_dump`/`pg_restore`, plus quiescing, verification, rollback, and cleanup —
lives in its own doc:

➡️ **[Migrating PostgreSQL: Standalone → CloudNativePG Operator](./MigratePostgresStandaloneToOperator.md)**

### Connection pooling with PgBouncer (optional)

Every OneUptime process that talks to Postgres (the `app`, the `worker`, and the
`nginx`/ingress gateway) keeps its own node-postgres pool — up to
`DATABASE_MAX_OPEN_CONNECTIONS` (default **50**) server connections per pod. With
HPA/KEDA autoscaling, the fleet can open far more connections than Postgres's
`max_connections` (the chart default is **500**). On a **managed/external**
Postgres (RDS, Cloud SQL, Aurora, Neon, Azure) you usually cannot raise
`max_connections` without paying for a bigger instance — so a pooler is the
cleaner fix.

The chart ships an **opt-in PgBouncer** that is *orthogonal* to the Postgres
backend: enable it and it fronts whichever backend is active — the built-in
`postgresql` StatefulSet, the `postgresOperator` CNPG cluster, **or**
`externalPostgres`. The `app`/`worker`/`nginx` pods then connect to the pooler
instead of directly to the database.

```yaml
pgbouncer:
  enabled: true
  poolMode: session       # default — see the caveat below before changing
  defaultPoolSize: 50     # server connections per (user,db) to the backend
  maxDbConnections: 0     # set at/below the backend's max_connections to cap it hard
```

For a **managed Postgres**, point the chart's `externalPostgres.host`/`.port` at
the database as usual and turn the pooler on. If your provider already offers a
managed pooled endpoint (RDS Proxy, Neon `-pooler`, Supabase Supavisor), you can
instead just point `externalPostgres.host` at that endpoint and leave
`pgbouncer.enabled: false`.

**TLS.** When fronting an `externalPostgres` with `ssl.enabled: true`, the
app→pooler hop is in-cluster plaintext and PgBouncer originates TLS to the
backend (`server_tls_sslmode` defaults to `require`, verifying against
`externalPostgres.ssl.ca` when provided). Override with `pgbouncer.serverTls.sslmode`.

**Sizing.** Session mode keeps a backend connection busy for the life of each
client connection, so to actually *reduce* backend connections (not just cap
them) on a connection-limited managed DB, also lower the per-pod pool. Set it
globally with `deployment.databaseMaxOpenConnections`, or per service with
`app.databaseMaxOpenConnections` / `worker.databaseMaxOpenConnections` /
`nginx.databaseMaxOpenConnections` (a service value overrides the global;
unset = the app's built-in default of 50). The `worker` is usually the one to
lower, since it fans out widest under KEDA.

```yaml
deployment:
  databaseMaxOpenConnections: 20   # global default for app/worker/nginx pods
worker:
  databaseMaxOpenConnections: 10   # worker fans out widest — keep its pool small
```

**Troubleshooting — "unsupported startup parameter".** If the app logs
`Postgres Database Connection Failed` / `error: unsupported startup parameter:
statement_timeout` and PgBouncer logs `closing because: unsupported startup
parameter`, the driver is sending a libpq startup parameter PgBouncer isn't
told to accept. node-postgres sends `statement_timeout` and
`idle_in_transaction_session_timeout`; both must be in
`pgbouncer.ignoreStartupParameters` (they are by default). PgBouncer accepts and
*ignores* them (does not forward them to the backend), so set
`statement_timeout` on the backend if you need server-side enforcement — the
app's client-side `query_timeout` still aborts slow queries.

**Why session mode is the default — the migration caveat.** OneUptime runs both
its schema migrations (`migrationsRun`) **and** a data-migration runner on boot.
The data-migration runner serializes across pods with a **session-level
`pg_advisory_lock`** held across the whole run. Transaction/statement pooling
would route those statements to different backends, so the lock loses its
mutual-exclusion guarantee (and leaks onto a pooled backend). **Session** pooling
keeps each client on one backend for its whole session, so the advisory lock and
boot migrations work unchanged.

### Transaction mode (real connection reduction)

Session mode caps and reuses connections but does **not** multiplex idle ones —
each open client connection still pins a backend connection. **Transaction mode**
returns a backend connection to the pool after every transaction, so thousands of
mostly-idle client connections share a small set of backend connections. That's
the mode to use when you actually want to *reduce* the connection count Postgres
holds.

Transaction mode is safe here **once migrations no longer run on the pooled
runtime pods** — which is already the default, because `migrate.enabled` is
`true`. So enabling transaction mode is just one change:

```yaml
pgbouncer:
  enabled: true
  poolMode: transaction
# migrate.enabled is true by default — schema + data migrations run in a
# dedicated one-shot Job, not on the pooled runtime pods.
```

With `migrate.enabled: true` (the default), the app/worker/nginx pods are gated
off (`RUN_DATABASE_MIGRATIONS_ON_BOOT=false`) and a Job (`App/Migrate.ts`) runs
migrations once, connecting **directly** to the backend (bypassing PgBouncer).
The data-migration advisory lock then only ever runs in that single Job, so it
never lands on a pooled connection — which is what makes transaction mode safe.
The chart **rejects `poolMode: transaction` unless `migrate.enabled: true`** to
prevent the unsafe combination.

Notes on the migration Job:
- It is a `pre-upgrade` + `post-install` Helm hook. On upgrades it runs before
  the new pods roll (old release still serving). On a **fresh** install an init
  container waits for the database first, then the Job creates the schema; the
  app pods may briefly fail readiness until it completes. A very slow first-time
  cluster bootstrap may need a longer `helm upgrade --install --timeout`.
- Set `migrate.enabled: false` to restore the legacy "every pod migrates on
  boot" model (required if you keep `poolMode: session` and want boot
  migrations). The advisory lock stays in the code — it still protects that boot
  path, also used by docker-compose.
- Through the pooler the server-side `statement_timeout` GUC is dropped (as in
  session mode); the app's client-side `query_timeout` still applies.

