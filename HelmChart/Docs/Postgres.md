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
    enabled: true # turns on the operator + an operator-managed Cluster
    instances: 3 # 1 primary + 2 hot standbys (use 1 for single node)
    imageName: "ghcr.io/cloudnative-pg/postgresql:17.4" # pin a minor version
    database: oneuptimedb
```

When `postgresOperator.cnpg.enabled` is `true`:

- The built-in `StatefulSet`, its `Service`s and `ConfigMap`s are **not**
  rendered (regardless of `postgresql.enabled`; the operator path takes
  precedence).
- A CloudNativePG `Cluster` named `<release>-postgresql-cnpg` is created.
- The app connects as the `postgres` superuser to the read-write service
  `<release>-postgresql-cnpg-rw` on port `5432`, using the password in the
  `<release>-postgresql-cnpg-superuser` secret (auto-generated, or set
  `postgresOperator.cnpg.postgresPassword`). The password is preserved across
  upgrades.
- The object is self-contained — `database`, `persistence`, `resources`,
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
`crds/` directory. Helm renders and validates _every_ manifest against the API
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

- **Replication** — `postgresOperator.cnpg.instances` is the total number of
  PostgreSQL pods. `instances: 3` = 1 primary + 2 streaming hot-standby replicas.
  Scaling is online: change `instances` and `helm upgrade`.
- **Automatic failover** — if the primary becomes unhealthy the operator promotes
  a replica and re-points the `-rw` service. No application change is needed.
- **Synchronous replication** — set `postgresOperator.cnpg.synchronousReplicas: N`
  for quorum-based synchronous commits (zero data loss). Keep
  `instances >= synchronousReplicas + 2` so a single standby outage does not block
  writes.
- **Read scaling** — send read-only/reporting traffic to the
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
      schedule: "0 0 3 * * *" # 6-field cron WITH seconds — 03:00 daily
      immediate: true
      volumeSnapshotClassName: "" # your CSI VolumeSnapshotClass (empty = default)
      online: true # hot snapshot, no downtime
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

The chart ships an **opt-in PgBouncer** that is _orthogonal_ to the Postgres
backend: enable it and it fronts whichever backend is active — the built-in
`postgresql` StatefulSet, the `postgresOperator` CNPG cluster, **or**
`externalPostgres`. The `app`/`worker`/`nginx` pods then connect to the pooler
instead of directly to the database.

```yaml
pgbouncer:
  enabled: true
  poolMode: transaction # default; multiplexes idle clients → fewer backend connections
  defaultPoolSize: 400 # max in-flight transactions to the backend (< max_connections)
  maxDbConnections: 450 # hard ceiling on total backend connections
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

**Sizing.** In the default **transaction** mode, idle client connections hold no
backend connection, so the pooler reduces the connection count on its own — just
keep `defaultPoolSize` at/below your backend headroom; you do **not** need to
shrink the per-pod pools. In **session** mode, each client connection pins a
backend connection for its whole session, so to actually _reduce_ backend
connections you must also lower the per-pod pool. Set it globally with
`deployment.databaseMaxOpenConnections`, or per service with
`app.databaseMaxOpenConnections` / `worker.databaseMaxOpenConnections` /
`nginx.databaseMaxOpenConnections` (a service value overrides the global;
unset = the app's built-in default of 50). The `worker` is usually the one to
lower, since it fans out widest under KEDA.

```yaml
deployment:
  databaseMaxOpenConnections: 20 # global default for app/worker/nginx pods
worker:
  databaseMaxOpenConnections: 10 # worker fans out widest — keep its pool small
```

**Troubleshooting — "unsupported startup parameter".** If the app logs
`Postgres Database Connection Failed` / `error: unsupported startup parameter:
statement_timeout` and PgBouncer logs `closing because: unsupported startup
parameter`, the driver is sending a libpq startup parameter PgBouncer isn't
told to accept. node-postgres sends `statement_timeout` and
`idle_in_transaction_session_timeout`; both must be in
`pgbouncer.ignoreStartupParameters` (they are by default). PgBouncer accepts and
_ignores_ them (does not forward them to the backend), so the backend applies no
`statement_timeout` to the app's statements unless one is set there (see
[Statement timeout behind the pooler](#statement-timeout-behind-the-pooler)).

**Pool mode and migrations are independent.** They did not used to be: the
data-migration runner held a **session-level `pg_advisory_lock`** across its
whole run, transaction pooling would have routed those statements to different
backends, and the chart rejected `poolMode: transaction` unless
`migrate.enabled: true`. That lock is gone, and so is that rejection — runtime
traffic uses no session-level Postgres features either, so both pool modes are
safe with either `migrate.enabled` setting.

**What replaced it is an operational constraint, not a pooling one.** The
migration runners are no longer serialized at all, so nothing stops two
replicas running the same data migration concurrently except *not starting two
of them*. That is exactly what the dedicated migration Job (`migrate.enabled`,
on by default) does. Keep it enabled. With `migrate.enabled: false` — and under
docker-compose, which has no Job — every replica of every deployment runs the
migration loop on boot, unserialized, so data migrations must be written to
tolerate being run twice at once.

#### Statement timeout behind the pooler

When the app stops waiting for a statement (`DATABASE_QUERY_TIMEOUT_MS`, 35
seconds by default) it cancels it on the database - the cancel request `psql`
sends on Ctrl-C, which PgBouncer passes on to the server connection the
statement runs on - and closes the connection the statement ran on instead of
handing it to another request. A transaction the statement was part of is
rolled back with that connection, so a write the app reported as failed is never
committed later by the next request to borrow the connection. The app waits up
to 5 more seconds for the database to answer the cancel; that answer (the
statement was cancelled) tells it nothing was written.

A cancel cannot reach the database once the connection to it is gone - a
network partition, a pooler restarting. Only the backend's `statement_timeout`
(`DATABASE_STATEMENT_TIMEOUT_MS`, 30 seconds by default) ends such a statement,
and the app relies on it then: a change to who can sign in with SSO whose write
got no answer holds back every other such change until the statement timeout
would have cancelled it (and 10 seconds more), then lets them go on. Behind
PgBouncer - the chart's, or a managed pooled endpoint that drops startup
parameters too - set the timeout on the role the app connects as, to the value
of `DATABASE_STATEMENT_TIMEOUT_MS`:

```sql
-- The role and database the app connects with: postgres and oneuptimedb for
-- the chart's own Postgres, your own for an externalPostgres.
ALTER ROLE "postgres" IN DATABASE "oneuptimedb" SET statement_timeout = '30s';
```

New backend connections pick it up; PgBouncer opens them as it needs them, or
restart PgBouncer to start over. A connection that sends its own
`statement_timeout` keeps it: the migration Job connects directly and sends the
app's, so the role's setting changes nothing for it. A `psql` session for long
manual work under that role can lift it with `SET statement_timeout = 0`.

#### Statements queued in the pooler

PgBouncer cannot cancel a statement still waiting in its own queue for a free
server connection: it drops a cancel for it, and the statement runs once a
connection comes free - however long after the app stopped waiting for it. So
the chart's PgBouncer gives up on a queued statement before the app does:
`pgbouncer.queryWaitTimeoutSeconds` (PgBouncer's `query_wait_timeout`, 30
seconds by default, below the app's 35) answers it with `query_wait_timeout`,
and it never runs. PgBouncer's own default is 120 seconds. If you raise
`DATABASE_QUERY_TIMEOUT_MS`, you may raise this with it - keep it a few seconds
below; `0` lets a statement wait for ever. With your own PgBouncer, or a managed
pooled endpoint, set its `query_wait_timeout` the same way.

```yaml
pgbouncer:
  enabled: true
  queryWaitTimeoutSeconds: 30 # below DATABASE_QUERY_TIMEOUT_MS (35 s by default)
```

### Transaction mode (real connection reduction)

Session mode caps and reuses connections but does **not** multiplex idle ones —
each open client connection still pins a backend connection. **Transaction mode**
returns a backend connection to the pool after every transaction, so thousands of
mostly-idle client connections share a small set of backend connections. That's
the mode to use when you actually want to _reduce_ the connection count Postgres
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
off (`RUN_DATABASE_MIGRATIONS_ON_BOOT=false`) and a Job (`packages/App/Migrate.ts`) runs
migrations once, connecting **directly** to the backend (bypassing PgBouncer).
Migrations therefore run exactly once per release, on an unpooled connection.

Notes on the migration Job:

- **Deploys do not block by default** (`migrate.hook: false`): the migration Job
  runs as a regular async Job for both install and upgrade, so `helm` returns
  immediately and pods roll while migrations run in the background.
- **New pods wait for the schema migrations their code needs.** A runtime pod
  does not start on a schema older than its code: `PostgresDatabase.connect()`
  reads which of the code's migrations the database has not recorded, and
  waits until the Job has applied them before the rest of its boot (see
  [New pods and pending schema migrations](#new-pods-and-pending-schema-migrations)).
  The pod is not ready meanwhile, so the old pods keep serving, and it carries
  on within five seconds of the last one committing. (In 14.0.13 the new worker
  pods started on the old schema: every monitor query selected
  `Monitor."isArchived"` before `AddArchiveToMoreResources` had added it, and no
  monitor was processed until it had.) Keep migrations _backward-compatible_ all
  the same (the expand/contract pattern): the **old** pods serve on the **new**
  schema until they are replaced.
- **Fresh installs with `migrate.hook: false`:** the pods likewise wait for the
  Job to create the schema, instead of crash-looping on an empty database. They
  can still restart a few times while the database itself is starting, since
  they connect before they wait. The Job's own init container waits for the
  database first, so a slow first-time cluster bootstrap may need a longer
  `helm upgrade --install --timeout`.
- Finished async Jobs auto-clean after `migrate.ttlSecondsAfterFinished` (default
  1 day).
- Alternatively, run migrations as a **separate step** before the deploy (e.g.
  `helm template` the Job and `kubectl apply` it, or a CI stage) and keep the
  app deploy itself migration-free.
- Set `migrate.enabled: false` to restore the legacy "every pod migrates on
  boot" model. Nothing serializes those runners any more, so every replica that
  boots at the same time runs the migration loop at the same time. This is the
  same path docker-compose uses.
- Through the pooler the server-side `statement_timeout` GUC is dropped (as in
  session mode); the app's client-side `query_timeout` still applies, and the
  app cancels a statement it stops waiting for - but a cancel cannot reach a
  database it lost the connection to. Set `statement_timeout` on the app's
  database role (see
  [Statement timeout behind the pooler](#statement-timeout-behind-the-pooler)).

### New pods and pending schema migrations

With the migrate Job owning migrations, a runtime pod (app, worker,
telemetry-writer, nginx) waits at boot for the schema migrations its code
needs; see the notes above for why.

#### How long a new pod waits

`migrate.runtimeWaitTimeoutSeconds` (default `900`, rendered as
`DATABASE_MIGRATION_WAIT_TIMEOUT_MS`). When it runs out, the pod exits with an
error naming the migrations still missing, is restarted, and waits again: it
never serves on the older schema. Look at the migrate Job then
(`kubectl logs job/<release>-migrate-<revision>`), which has failed or is still
retrying a migration that cannot get its locks.

A waiting pod has not started, so its startup probe fails until the wait ends,
and Kubernetes runs no liveness or readiness probe before the startup probe
passes. The startup probe kills the pod after about `startupProbe.periodSeconds
x (startupProbe.failureThreshold - 1)`, 17 minutes by default. Keep the wait
below that, with room for the rest of the boot, so a pod gives up by itself
with that error instead of being killed and backed off; the install notes warn
when it is not. With `startupProbe.enabled: false` the liveness probe kills a
waiting pod after about two minutes. `0` turns the wait off: pods start on the
schema as found, as they did before.

#### What the wait costs during an upgrade

- **Capacity.** A rolling update replaces old pods as new ones become ready,
  but removes up to `maxUnavailable` of them (25% of the replicas, rounded
  down) straight away. While the migrations run, that share of capacity is
  gone. Set `deployment.updateStrategy.rollingUpdate.maxUnavailable: 0` to keep
  every old pod until its replacement is ready.
- **Progress deadline.** A rollout whose pods wait longer than
  `progressDeadlineSeconds` (10 minutes) is marked `ProgressDeadlineExceeded`:
  `kubectl rollout status` fails and Argo CD shows the application Degraded,
  though the rollout carries on once the migrations are in.
- **`helm upgrade --wait` / `--atomic`** wait for the new pods to be ready, so
  they now last until the schema migrations are applied: size `--timeout` for
  them. `--wait` does not wait for the Job itself (data migrations included)
  unless you add `--wait-for-jobs`. An `--atomic` deploy that runs out of time
  rolls back, and deletes the migrate Job mid-run.

#### Why `migrate.hook` stays `false` by default

`migrate.hook: true` runs the Job as a Helm hook (`post-install` on install,
`pre-upgrade` on upgrade): `helm upgrade` applies every migration before it
touches a Deployment. It complements the wait, but it is not the default:

- It blocks the whole deploy on the whole Job, data migrations included (they
  can be long backfills), within Helm's `--timeout` of 5 minutes by default.
  One schema migration alone may retry its locks for 10 minutes, as in
  14.0.13. A Job that outlasts the timeout fails the release, so turning it on
  for every existing install would turn routine upgrades into failed ones.
- It does not cover what the wait covers. A `post-install` hook runs after the
  release's pods exist, so a fresh install is not protected. Argo CD renders the
  chart with `helm template`, where every sync is an install, so the Job is
  always a `post-install` hook there, which Argo CD runs as a PostSync hook,
  after the new pods are Healthy. `helm upgrade --no-hooks`, or a rollout
  started by anything other than Helm, skips it.
- With the wait, the async Job gives the same guarantee (no pod serves on an
  older schema) and the new pods are scheduled, pull their image and boot while
  it migrates, so the rollout finishes sooner.

What the hook buys: no old pod is replaced until the migrations have succeeded,
so there is no capacity dip and no progress deadline to watch, and a failed
migration fails the deploy before any pod rolls. Choose it, with a `--timeout`
sized for your migrations, if that matters more to you than a non-blocking
deploy.

Because a `post-install` hook runs only after the release's pods exist (and,
under `helm install --wait` or Argo CD, only once they are ready), pods that
waited for it would wait for each other. So with `migrate.hook: true` the pods
of an install do not wait (`DATABASE_MIGRATION_WAIT_TIMEOUT_MS=0`); the pods of
a Helm upgrade keep the wait, which finds the `pre-upgrade` hook's work done.

### Schema migrations and busy tables

A schema migration needs strong table locks (`ALTER TABLE` takes `ACCESS
EXCLUSIVE`), and Postgres grants locks in queue order: a DDL statement waiting
for one long transaction blocks every query that arrives on that table after
it, plain `SELECT`s included. 14.0.13's `ALTER TABLE "Monitor"` did exactly
that, and monitors stopped being processed while it waited.

The migration Job (and any process with `RUN_DATABASE_MIGRATIONS_ON_BOOT`
left on) therefore runs schema migrations on a connection of their own where
a statement waits at most `DATABASE_MIGRATION_LOCK_TIMEOUT_MS` for a lock. A
migration that runs out is rolled back - releasing everything it held - and
retried, backing off from one second to thirty, until it gets through or
`DATABASE_MIGRATION_LOCK_RETRY_TIMEOUT_MS` passes for that migration; then the
Job fails, and its log names the oldest open transactions in the database and
the tables they hold, which is usually the culprit (a report, a backup, a
session left idle in a transaction).

| Variable | Default | |
| --- | --- | --- |
| `DATABASE_MIGRATION_LOCK_TIMEOUT_MS` | `2000` | Longest lock wait of one migration statement. Keep it below `DATABASE_LOCK_TIMEOUT_MS` (3000), so app queries queued behind a migration are delayed, not failed. `0` waits without limit (the old behaviour). |
| `DATABASE_MIGRATION_LOCK_RETRY_TIMEOUT_MS` | `600000` | How long one migration keeps being retried. `0` never retries. |

Set them for the Job alone with `migrate.extraEnv`. Data migrations still run
on the app's own pool, as before.

Bounding the wait does not bound how long a migration *holds* a lock once it
has it. Index builds and foreign keys on tables that already hold data are
therefore written with `OnlineDdl` (`CREATE INDEX CONCURRENTLY`, and `NOT
VALID` followed by `VALIDATE CONSTRAINT`), which do not block reads or writes;
see `packages/Common/Server/Infrastructure/Postgres/OnlineDdl.ts`.
