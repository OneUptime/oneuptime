# Production Readiness Checklist

Work through this list to make your OneUptime installation production-ready.

## Pin versions

- [ ] **Pin the OneUptime version.** This prevents breaking changes from
  affecting your install. Check the latest version on the
  [releases page](https://github.com/OneUptime/oneuptime/releases), then pin it:

  ```yaml
  image:
    tag: <specific-version>
  ```

- [ ] **Pin PostgreSQL, Valkey, and ClickHouse versions too.** Find the running
  version by describing a pod:

  ```console
  kubectl describe pod <pod-name>
  # e.g.
  kubectl describe pod my-oneuptime-postgresql-0
  ```

  Then pin them:

  ```yaml
  postgresql:
    image:
      tag: <specific-version>
  valkey:
    image:
      tag: <specific-version>
  clickhouse:
    image:
      tag: <specific-version>
  ```

## Data durability

- [ ] **Enable PVC backups.** This is outside the scope of this chart — refer to
  your cloud provider's documentation on enabling backups for persistent volumes.

- [ ] **Use database high availability.** For production, run PostgreSQL and
  ClickHouse under their bundled operators instead of the single, standalone
  built-ins. Set `postgresOperator.cnpg.enabled: true` (CloudNativePG — streaming
  replication and automatic failover) and `clickhouseOperator.altinity.enabled:
  true` (Altinity — replication, sharding, and declarative lifecycle management).
  See [Operator-managed PostgreSQL](databases.md#operator-managed-high-availability)
  and [Operator-managed ClickHouse](databases.md#operator-managed-high-availability-1)
  for full configuration. Enabling an operator bootstraps a fresh, empty
  cluster — if you already run a standalone database, follow the migration
  runbooks ([PostgreSQL](../../../Docs/MigratePostgresStandaloneToOperator.md),
  [ClickHouse](../../../Docs/MigrateClickhouseStandaloneToOperator.md)) to move
  your data first.

## Background jobs & scaling

- [ ] **Enable the dedicated worker deployment** so background jobs (telemetry
  ingestion, notifications, incident/alert processing, workflows) run in their
  own pods instead of competing with API requests on the shared event loop. Set
  `worker.enabled: true` — the `app` pods then stop consuming queues and the
  worker drains them. The worker becomes REQUIRED for all background work, so
  keep `worker.keda.minReplicas >= 1`, and set
  `app.keda.targetCPUUtilizationPercentage` (with `app.resources.requests.cpu`)
  so the API tier still autoscales once its queue-size trigger is disabled.

- [ ] **Decide where KEDA comes from before the first install.** `keda.enabled`
  renders the chart's `ScaledObject`s; `keda.install` decides whether the chart
  also installs the operator, and follows `keda.enabled` unless you set it. On a
  cluster where a platform team already runs KEDA, set `keda.install: false` —
  installing a second operator collides on cluster-scoped objects the existing
  release owns. On a cluster with no KEDA, the first install needs one extra
  bootstrap pass, because the bundled operator's CRDs have to reach the cluster
  before the `ScaledObject`s can. Both paths are in
  [KEDA Ops](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Docs/Keda.md).

- [ ] **Size ClickHouse insert concurrency when scaling telemetry ingest
  workers.** Every telemetry-ingesting pod runs a fan-in writer that batches
  all telemetry ClickHouse inserts into a handful of large INSERTs, so worker
  replicas are safe to scale horizontally — ClickHouse sees a few big inserts
  per pod instead of one per request. The knob that matters fleet-wide is
  `worker.telemetryFanInMaxConcurrentInserts` (default 4): total ClickHouse
  insert concurrency = worker replicas ×
  `TELEMETRY_FANIN_MAX_CONCURRENT_INSERTS`. Keep that product under roughly
  60% of ClickHouse `max_concurrent_queries` (default 100) so reads and
  background merges still get query slots — e.g. at the defaults, stay at or
  below ~15 telemetry-ingesting replicas, or lower the per-pod insert cap as
  you add replicas. Batch size and flush latency are tunable via
  `worker.telemetryFanInMaxBatchRows` / `worker.telemetryFanInMaxWaitMs`, and
  the per-pod ClickHouse pools via `worker.clickhouseMaxOpenConnections` /
  `worker.clickhouseIngestMaxOpenConnections` (the same keys exist under
  `app:` for setups that run ingestion on the app pods). Telemetry inserts
  are fire-and-forget async inserts by default (ClickHouse owns flushing;
  a ClickHouse crash between buffer-accept and flush can lose that buffer) —
  set `telemetryWaitForAsyncInsert: true` if you want every ack to wait for
  the durable flush instead, and account for each in-flight insert then
  holding a ClickHouse query slot until its buffer flushes.

- [ ] **Enable the telemetry-writer tier before the worker fleet outgrows the
  sizing rule above.** With `telemetryWriter.enabled: true`, worker and app
  pods stop inserting telemetry into ClickHouse themselves and ship their
  batched inserts (cluster-key authenticated HTTP, idempotent retries,
  end-to-end acks) to a dedicated fixed-size deployment that owns
  all telemetry insert concurrency. ClickHouse then sees
  `telemetryWriter.replicaCount × telemetryWriter.telemetryFanInMaxConcurrentInserts`
  concurrent inserts — a constant — so worker replicas can autoscale WITHOUT
  limit; the replicas × inserts rule above moves from the (elastic) worker
  fleet to the (fixed) writer tier. Size the writer tier against ClickHouse
  capacity: keep its product under ~60% of `max_concurrent_queries`, and
  never autoscale it on queue depth — when it saturates it sheds load with
  429, workers back off and retry, and the backlog collects in the BullMQ
  queue where the worker KEDA scaler (not ClickHouse) absorbs it. Two
  opt-in autoscalers exist for the tier itself, both bounded by
  `maxReplicas` (keep `maxReplicas × telemetryFanInMaxConcurrentInserts`
  inside the ClickHouse budget): `telemetryWriter.autoscaling` (plain
  CPU/memory HPA; requires `telemetryWriter.resources.requests`) and
  `telemetryWriter.keda` (scales on the tier-wide shed rate — sustained
  429s while ClickHouse is healthy are the honest "tier too small" signal,
  exported at `/metrics/telemetry-writer-shed-rate` from a Valkey-backed
  counter). Writer-pod memory
  is bounded by `telemetryWriter.maxInflightRequests`; raise pod resources
  together with it. If individual telemetry rows are very large (multi-KB log
  bodies), lower `worker.telemetryFanInMaxBatchRows` so a shipped batch stays
  well under the 50 MB internal request-body limit.

- [ ] **Put PgBouncer in front of PostgreSQL** if you autoscale workers (KEDA) or
  use a connection-limited managed/external PostgreSQL — it keeps a connection
  storm (for example, many worker pods booting at once) from exhausting the
  database. Set `pgbouncer.enabled: true`. It runs in `transaction` pool mode by
  default (the largest connection reduction), which is safe because migrations
  run in a dedicated Job (`migrate.enabled`, on by default) instead of on the
  pooled pods. Keep `pgbouncer.defaultPoolSize` and `pgbouncer.maxDbConnections`
  below your PostgreSQL `max_connections`. For an external/managed PostgreSQL,
  point `externalPostgres.host`/`.port` at the database and enable the pooler —
  or point them at your provider's own pooled endpoint (RDS Proxy, Neon
  `-pooler`, Supabase Supavisor) instead. See **Connection pooling with
  PgBouncer** in [Postgres.md](../../../Docs/Postgres.md).

- [ ] **Confirm the database migration Job is healthy.** With `migrate.enabled:
  true` (the default), schema and data migrations run once per release in a
  dedicated Job rather than on every pod. By default it runs **asynchronously**
  (`migrate.hook: false`) so `helm` never blocks on it, and each new pod waits
  at boot, unready, until the schema migrations its code needs are applied
  (`migrate.runtimeWaitTimeoutSeconds`, 15 minutes) while the old pods keep
  serving — so keep your migrations backward-compatible. A brand-new install
  works the same way: the pods wait for the Job to create the schema. Set
  `migrate.hook: true` to make `helm upgrade` itself wait for the Job (with a
  `--timeout` sized for your migrations). For a fleet of more than three
  replicas, consider `deployment.updateStrategy.rollingUpdate.maxUnavailable: 0`
  so the rollout does not take old pods away while the new ones wait. Pods
  restarting every 15 minutes during a deploy mean the Job has not finished:
  check it with `kubectl get jobs -l app.kubernetes.io/component=migrate` and
  its logs. See **New pods and pending schema migrations** in
  [Postgres.md](../../../Docs/Postgres.md).

## Availability

- [ ] **Enable Pod Disruption Budgets** for the stateless tier and scale those
  services to more than one replica. PDBs (`podDisruptionBudget.enabled: true`,
  off by default; defaults to `maxUnavailable: 1` once enabled) stop a node drain
  or cluster upgrade from evicting every replica of a service at once. They only
  help once a service runs multiple replicas, so set `<service>.replicaCount > 1`
  (or enable `autoscaling` / KEDA with `minReplicas >= 2`) for the services you
  need to stay available — e.g. `nginx` (ingress) and `app` (API). The
  single-replica databases are intentionally excluded; for database HA use the
  bundled operators (above).

## Secrets

- [ ] **Use static database passwords** for Valkey, ClickHouse, and PostgreSQL.
- [ ] **Set `oneuptimeSecret` and `encryptionSecret`** (or configure the
  `externalSecrets` section) to long random strings. Use a password generator.
- [ ] **Set `probes.<key>.key`** to a long random string to secure your probes.
- [ ] **Pin probe and Runner identity keys** if you deploy with Argo CD, Flux, or
  anything else built on `helm template`. Set `probes.<key>.key` / `runner.key`, or
  point `probes.<key>.existingSecret` / `runner.existingSecret` at Secrets you manage.
  A chart-generated identity key is re-randomised on every render, which silently
  re-registers the probe and leaves its monitors pointing at an orphan. See
  [Configuration](configuration.md#probe-and-runner-identity-keys).

## Stay current

- [ ] **Update OneUptime regularly.** We release updates every day; we recommend
  updating at least once a week for production installs.
