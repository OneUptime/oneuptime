# Databases

OneUptime uses three databases:

- **PostgreSQL** — application data, users, and configuration.
- **Redis** — caching and session management.
- **ClickHouse** — analytics, logs, and time-series data.

Each one ships **built-in** (a single, standalone instance — great for getting
started) and can instead point at an **external** database you manage. For
production high availability, PostgreSQL and ClickHouse can run under a
**bundled operator**.

> **Migrating an existing install** from a standalone database to its operator?
> Follow the runbooks:
> [PostgreSQL: Standalone → CloudNativePG](../../../Docs/MigratePostgresStandaloneToOperator.md) ·
> [ClickHouse: Standalone → Altinity](../../../Docs/MigrateClickhouseStandaloneToOperator.md).

---

## PostgreSQL

### Built-in (default)

A standalone PostgreSQL instance with authentication enabled:

```yaml
postgresql:
  enabled: true
  image:
    repository: postgres
    tag: "latest"
    pullPolicy: IfNotPresent
  auth:
    username: oneuptime
    database: oneuptimedb
    # Auto-generated if not provided
    password:
  architecture: standalone
  primary:
    service:
      type: ClusterIP
      ports:
        postgresql: "5432"
    terminationGracePeriodSeconds: 0
    persistence:
      enabled: true
      size: 25Gi
      storageClass: ""
  nodeSelector: {}
  tolerations: []
  affinity: {}
  resources: {}
  # Optional PostgreSQL configuration
  # configuration: |-
  #   max_connections = 500
  #   shared_buffers = 128MB
  #   effective_cache_size = 4GB
```

### External

To use a PostgreSQL database you manage, disable the built-in one and point
OneUptime at yours:

```yaml
postgresql:
  # Don't install PostgreSQL in the cluster
  enabled: false

externalPostgres:
  host:
  port:
  username:
  password:
  # Use an existing secret instead of an inline password
  existingSecret:
    name:
    passwordKey:   # key in the secret holding the password
  database:
  ssl:
    enabled: false
    ca:       # required when ssl.enabled is true
    cert:     # optional
    key:      # optional
```

### Operator-managed (high availability)

The built-in instance is standalone — no replication or automatic failover. For
production HA, run PostgreSQL under the [CloudNativePG](https://cloudnative-pg.io)
operator, which is **bundled** with this chart and installed automatically when
enabled. You get streaming replication, automatic failover, rolling minor
upgrades, and a dedicated read-only service.

`postgresOperator` is self-contained — it does **not** read any `postgresql.*`
values. Enabling it replaces the built-in StatefulSet:

```yaml
postgresOperator:
  cnpg:
    enabled: true               # installs the operator + an operator-managed cluster
    instances: 3                # 1 primary + 2 hot-standby replicas
    imageName: "ghcr.io/cloudnative-pg/postgresql:17.4"   # pin a minor version
    database: oneuptimedb
    persistence:
      size: 50Gi
```

When `postgresOperator.cnpg.enabled` is `true`, the built-in `postgresql`
StatefulSet/Service/ConfigMaps are not rendered, and OneUptime connects (as the
`postgres` superuser) to the cluster's read-write service
`<release>-postgresql-cnpg-rw`.

**Replication** is controlled by `instances`:

- `instances: 1` — a single primary, no replicas.
- `instances: 3` — one primary plus two hot-standby replicas kept current by
  streaming replication. If the primary fails, the operator promotes a healthy
  replica and re-points the `-rw` service. Replication is **asynchronous** by
  default. Scaling is online — change `instances` and `helm upgrade`.

For **synchronous** replication (zero data loss on failover — a commit is not
acknowledged until standbys confirm it), set `synchronousReplicas`:

```yaml
postgresOperator:
  cnpg:
    enabled: true
    instances: 3
    synchronousReplicas: 1      # quorum: every commit waits for >=1 standby
```

Keep `instances >= synchronousReplicas + 2` so writes don't block when a single
standby is briefly unavailable.

**Read scaling.** The operator also creates `<release>-postgresql-cnpg-ro`
(load-balanced across replicas) and `<release>-postgresql-cnpg-r` (any instance).
Point read-heavy/reporting workloads at `-ro`; the OneUptime app itself uses the
`-rw` (primary) endpoint.

**Backups.** Enable scheduled, online volume-snapshot backups — native, with no
object store or extra components:

```yaml
postgresOperator:
  cnpg:
    enabled: true
    backup:
      enabled: true
      schedule: "0 0 3 * * *"      # 6-field cron (incl. seconds) — 3am daily
      volumeSnapshotClassName: ""  # your CSI VolumeSnapshotClass (empty = default)
```

This configures CSI snapshot backups and creates a `ScheduledBackup` (requires a
CSI driver with `VolumeSnapshot` support). Restore is a new cluster that
bootstraps from a snapshot (optionally to a point in time) — see
[Docs/Postgres.md](../../../Docs/Postgres.md). Note: CloudNativePG does **not**
auto-prune volume snapshots, so prune old snapshots yourself, or use object-store
backups (Barman Cloud Plugin) for automatic retention + continuous PITR.

**Sharding is not supported.** Neither CloudNativePG nor this chart shards
PostgreSQL horizontally, and OneUptime does not need it at typical scale. Scale
with a larger node (vertical), read replicas (above), connection pooling, and
table partitioning for very large tables.

> **Bundled-operator notes.** The CloudNativePG operator is cluster-scoped and
> owns the CloudNativePG CRDs. Do not enable it in more than one OneUptime
> release per cluster, and note that `helm uninstall` can remove the CRDs (and
> cascade-delete clusters) — back up first. Tune the operator itself under the
> top-level `cloudnative-pg:` values.

Enabling the operator bootstraps a **fresh, empty** cluster — it does not migrate
data from an existing StatefulSet. Follow the
[migration runbook](../../../Docs/MigratePostgresStandaloneToOperator.md) to move
your data, and see [Docs/Postgres.md](../../../Docs/Postgres.md) for day-2
operations (including [PgBouncer connection pooling](../../../Docs/Postgres.md)).

---

## Redis

### Built-in (default)

A standalone Redis instance with authentication enabled:

```yaml
redis:
  enabled: true
  auth:
    # Auto-generated if not provided
    password: "your-redis-password"
  image:
    repository: redis
    tag: latest
    pullPolicy: IfNotPresent
  master:
    service:
      type: ClusterIP
      ports:
        redis: "6379"
    persistence:
      enabled: false
      size: 8Gi
      storageClass: ""
    nodeSelector: {}
    tolerations: []
    affinity: {}
    resources: {}
  commonConfiguration: |-
   appendonly no
   save ""
```

### External

```yaml
redis:
  # Don't install Redis in the cluster
  enabled: false

externalRedis:
  host:
  port:
  password:
  # Use an existing secret instead of an inline password
  existingSecret:
    name:
    passwordKey:   # key in the secret holding the password
  database:
  tls:
    enabled: false
    ca:       # required when tls.enabled is true
    cert:     # optional
    key:      # optional
```

---

## ClickHouse

### Built-in (default)

A standalone ClickHouse instance with authentication enabled:

```yaml
clickhouse:
  enabled: true
  auth:
    username: oneuptime
    # Auto-generated if not provided
    password:
  image:
    repository: clickhouse/clickhouse-server
    # Keep this aligned with docker-compose.base.yml and the operator image.
    tag: "26.7"
    pullPolicy: IfNotPresent
  service:
    type: LoadBalancer
    ports:
      http: "8123"
      tcp: "9000"
      mysql: "9004"
      postgresql: "9005"
      interserver: "9009"
  persistence:
    enabled: true
    size: 25Gi
    storageClass: ""
  nodeSelector: {}
  tolerations: []
  affinity: {}
  resources: {}
```

### Operator-managed (high availability)

The built-in instance is standalone — no replication or declarative lifecycle
management. For production HA, run ClickHouse under the
[Altinity ClickHouse operator](https://github.com/Altinity/clickhouse-operator),
which is **bundled** with this chart and installed automatically when enabled.
You get declarative management, rolling upgrades, sharding, and replication
backed by a bundled [ClickHouse Keeper](https://clickhouse.com/docs/en/guides/sre/keeper/clickhouse-keeper)
ensemble.

`clickhouseOperator` is self-contained — it does **not** read any `clickhouse.*`
values. Enabling it replaces the built-in StatefulSet:

```yaml
clickhouseOperator:
  altinity:
    enabled: true
    image:
      tag: "26.7"        # keep aligned with the built-in ClickHouse image
    cluster:
      shardsCount: 1
      replicasCount: 2   # 2 = HA (uses the bundled Keeper, enabled by default)
    keeper:
      enabled: true
      replicas: 3        # Keeper quorum (1 for dev, 3/5 for production)
```

When `clickhouseOperator.altinity.enabled` is `true`, the built-in `clickhouse`
StatefulSet/Service/ConfigMap are not rendered, and OneUptime connects (as the
`oneuptime` user) to the operator-managed `ClickHouseInstallation`'s root service
`<release>-clickhouse-altinity` on port `8123`. A ClickHouse Keeper ensemble
(`<release>-clickhouse-keeper`) is created to coordinate replication; bring your
own ZooKeeper/Keeper instead with `clickhouseOperator.altinity.zookeeper.nodes`.
Follow the [migration runbook](../../../Docs/MigrateClickhouseStandaloneToOperator.md)
to move your data, and see [Docs/Clickhouse.md](../../../Docs/Clickhouse.md) for
scaling and backups (via [clickhouse-backup](https://github.com/Altinity/clickhouse-backup)).

> **Bundled-operator notes.** The Altinity operator is cluster-scoped and owns
> the ClickHouse CRDs. Do not enable it in more than one OneUptime release per
> cluster. Tune the operator itself (including its management-user credentials)
> under the top-level `altinity-clickhouse-operator:` values.

### External

```yaml
clickhouse:
  # Don't install ClickHouse in the cluster
  enabled: false

externalClickhouse:
  host:
  isHostHttps:    # set to true if your host is https
  port:
  username:
  password:
  # Use an existing secret instead of an inline password
  existingSecret:
    name:
    passwordKey:   # key in the secret holding the password
  database:
  tls:
    enabled: false
    ca:       # required when tls.enabled is true
    cert:     # optional
    key:      # optional
```

---

## More database docs

- [Postgres.md](../../../Docs/Postgres.md) — day-2 operations, backups, connection pooling with PgBouncer.
- [Clickhouse.md](../../../Docs/Clickhouse.md) — scaling and backups.
- [Redis.md](../../../Docs/Redis.md) — Redis notes.
