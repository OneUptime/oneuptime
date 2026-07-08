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

- [ ] **Pin PostgreSQL, Redis, and ClickHouse versions too.** Find the running
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
  redis:
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
  (`migrate.hook: false`) so deploys never block — which means pods may start
  before migrations finish, so keep your migrations backward-compatible, or set
  `migrate.hook: true` to make the deploy wait. Note: with the async default, a
  brand-new install leaves the app pods unready (CrashLoopBackOff) until the Job
  creates the schema; for a clean first install run it once with
  `--set migrate.hook=true` (and a longer timeout, e.g.
  `helm upgrade --install --timeout 15m`, for a slow first-time CloudNativePG
  bootstrap), then drop back to the async default. Check the Job with
  `kubectl get jobs -l app.kubernetes.io/component=migrate` and its logs if a
  deploy looks wrong.

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

- [ ] **Use static database passwords** for Redis, ClickHouse, and PostgreSQL.
- [ ] **Set `oneuptimeSecret` and `encryptionSecret`** (or configure the
  `externalSecrets` section) to long random strings. Use a password generator.
- [ ] **Set `probes.<key>.key`** to a long random string to secure your probes.

## Stay current

- [ ] **Update OneUptime regularly.** We release updates every day; we recommend
  updating at least once a week for production installs.
