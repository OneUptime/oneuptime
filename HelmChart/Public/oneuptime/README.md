<!-- markdownlint-disable MD033 -->
<h1 align="center"><img alt="oneuptime logo" width=50% src="https://raw.githubusercontent.com/OneUptime/oneuptime/master/Home/Static/img/OneUptimePNG/7.png"/></h1>
<!-- markdownlint-enable MD033 -->

# OneUptime Helm Chart

OneUptime is a comprehensive solution for monitoring and managing your online services. Whether you need to check the availability of your website, dashboard, API, or any other online resource, OneUptime can alert your team when downtime happens and keep your customers informed with a status page. OneUptime also helps you handle incidents, set up on-call rotations, run tests, secure your services, analyze logs, track performance, and debug errors.

[Overview of OneUptime](http://www.oneuptime.com)


## Yotube Tutorial

https://youtu.be/Ho5WyPHExTU

## Install Helm Chart


#### Create values.yaml file.

Create a values.yaml file and change the host.

```yaml
host: <ip-address-or-domain-of-server>

# If hosted on non-ssl server then change this to http
httpProtocol: https 
```

#### Pick a Storage Class

Storage class are different for different cloud environemtns. Please pick the right one for your cloud environment.

To get a list of storage classes, run the following command:

```console
kubectl get storageclass
```

and add this to your values.yaml file

```yaml
global: 
  storageClass: "your-storage-class"
```


```console
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

## Community vs. Enterprise Images

| Edition              | Best For                                             | Included Benefits                                                                                     | Requirements |
|----------------------|-------------------------------------------------------|--------------------------------------------------------------------------------------------------------|--------------|
| Community Edition    | Getting started, small self-hosted deployments        | Fully featured OneUptime platform with the standard security posture                                  | None         |
| Enterprise Edition   | Regulated industries, teams with strict compliance needs | Hardened container images with additional security controls;<br>Custom features and roadmap input;<br>Dedicated engineer with 1-hour priority phone support;<br>Custom data residency and retention options;<br>Deploy on private cloud or SaaS with annual invoicing | Valid license |


## Upgrade Helm Chart

```console

# Update the chart repo 
helm repo update

# Upgrade the helm chart
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

## Configuration

The following table lists the configurable parameters of the OneUptime chart and their default values.

| Parameter                                         | Description                                                                                                                                                                            | Default         | Change Required |
|---------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------|-----------------|
| `global.storageClass`                             | Storage class to be used for all persistent volumes                                                                                                                                    | `nil`           | 🚨              |
| `host`                                            | Primary hostname served by OneUptime (used for routing and certificate management)                                                                                                     | `localhost`     | 🚨              |
| `ssl.provision`                                   | Automatically provision a Let's Encrypt certificate for the primary host (requires public access on ports 80 and 443)                                                                  | `false`         |                 |
| `httpProtocol`                                    | If the server is hosted with SSL/TLS cert then change this value to https                                                                                                              | `http`          | 🚨              |
| `oneuptimeSecret`                                 | Value used to define ONEUPTIME_SECRET                                                                                                                                                  | `nil`           |                 |
| `encryptionSecret`                                | Value used to define ENCRYPTION_SECRET                                                                                                                                                 | `nil`           |                 |
| `queueDashboard.enabled`                          | When true, mounts the BullMQ (Bull Board) queue inspector UI at `/worker/inspect/queue/<queueDashboard.secret>`. Requires `queueDashboard.secret` to be non-empty                      | `false`         |                 |
| `queueDashboard.secret`                           | URL path segment used to reach the queue dashboard. Set to a long random string. The dashboard is not mounted while this is empty                                                      | `nil`           |                 |
| `global.clusterDomain`                            | Kubernetes Cluster Domain                                                                                                                                                              | `cluster.local` |                 |
| `image.registry`                                  | Docker image registry                                                                                                                                                                  | `docker.io`     |                 |
| `image.repository`                                | Docker image repository                                                                                                                                                                | `oneuptime`     |                 |
| `image.tag`                                       | Docker image tag                                                                                                                                                                       | `release`       |
| `image.pullPolicy`                                | Docker image pull policy                                                                                                                                                               | `IfNotPresent`  |                 |
| `image.type`                                      | OneUptime image type (`community-edition` or `enterprise-edition`; enterprise requires a valid license)                                                                                | `community-edition` |                 |
| `image.restartPolicy`                             | Docker image restart policy                                                                                                                                                            | `Always`        |                 |
| `autoscaling.enabled`                             | Enable autoscaling                                                                                                                                                                     | `false`         |                 |
| `autoscaling.minReplicas`                         | Minimum number of replicas                                                                                                                                                             | `1`             |                 |
| `autoscaling.maxReplicas`                         | Maximum number of replicas                                                                                                                                                             | `100`           |                 |
| `autoscaling.targetCPUUtilizationPercentage`      | Target CPU utilization percentage                                                                                                                                                      | `80`            |                 |
| `autoscaling.targetMemoryUtilizationPercentage`   | Target memory utilization percentage                                                                                                                                                   | `80`            |                 |
| `podDisruptionBudget.enabled`                     | Create a PodDisruptionBudget for each stateless deployment (app, worker, nginx, home, ai-agent, probes, pgbouncer) to cap voluntary disruptions during node drains / cluster upgrades  | `true`          |                 |
| `podDisruptionBudget.minAvailable`                | Minimum pods that must stay available. Integer or percentage string (e.g. `"50%"`). Takes precedence over `maxUnavailable` when both are set. Leave empty to use `maxUnavailable`      | `""`            |                 |
| `podDisruptionBudget.maxUnavailable`              | Maximum pods that may be unavailable during a voluntary disruption. Integer or percentage string. Safe at `replicaCount: 1` (the lone pod can still be evicted)                        | `1`             |                 |
| `<service>.podDisruptionBudget`                   | Per-service override of the global `podDisruptionBudget` block (`enabled`/`minAvailable`/`maxUnavailable`). Any omitted key inherits the global value. `<service>` = app/worker/nginx/home/aiAgent/probes.&lt;key&gt;/pgbouncer | `{}` (inherit)  |                 |
| `nodeEnvironment`                                 | Node environment (please dont change this unless you're doing local development)                                                                                                       | `production`    |                 |
| `nginx.service.type`                              | nginx service type (exposes the bundled OneUptime ingress gateway)                                                                                                                     | `LoadBalancer`  |                 |
| `nginx.service.loadBalancerIP`                    | nginx service load balancer IP                                                                                                                                                         | `nil`           |                 |
| `deployment.replicaCount`                         | Number of replicas                                                                                                                                                                     | `1`             |                 |
| `probes.<key>.name`                               | Probe name                                                                                                                                                                             | `<key>`         |                 |
| `probes.<key>.description`                        | Probe description                                                                                                                                                                      | `nil`           |                 |
| `probes.<key>.key`                                | Probe key. Please set this to long random string to secure your probes.                                                                                                                | `nil`           |                 |
| `probes.<key>.monitoringWorkers`                  | Number of threads / parallel processes you need to monitor your resources                                                                                                              | `3`             |                 |
| `probes.<key>.monitorFetchLimit`                  | Number of resources to be monitored in parallel                                                                                                                                        | `10`            |                 |
| `probes.<key>.syntheticMonitorScriptTimeoutInMs`  | Timeout for synthetic monitor script                                                                                                                                                   | `60000`         |                 |
| `probes.<key>.customCodeMonitorScriptTimeoutInMs` | Timeout for custom code monitor script                                                                                                                                                 | `60000`         |                 |
| `probes.<key>.proxy.httpProxyUrl`                | HTTP proxy URL for HTTP requests made by the probe (optional)                                                                                                                          | `nil`           |                 |
| `probes.<key>.proxy.httpsProxyUrl`               | HTTPS proxy URL for HTTPS requests made by the probe (optional)                                                                                                                        | `nil`           |                 |
| `probes.<key>.proxy.noProxy`                     | Comma-separated hosts that should bypass the proxy (optional)                                                                                                                          | `nil`           |                 |
| `probes.<key>.additionalContainers`               | Additional containers to add to the probe pod                                                                                                                                          | `nil`           |                 |
| `probes.<key>.resources`                          | Pod resources (limits, requests)                                                                                                                                                       | `nil`           |                 |
| `statusPage.cnameRecord`                          | CNAME record for the status page                                                                                                                                                       | `nil`           |                 |
| `logLevel`                                        | Can be one of the following - INFO, WARN, ERROR, DEBUG                                                                                                                                 | `INFO`          |                 |
| `incidents.disableAutomaticCreation`              | Disable incident creation (use this when your team is overloaded with incidents or in emergencies)                                                                                     | `false`         |                 |
| `alerts.disableAutomaticCreation`                 | Disable alert creation (use this when your team is overloaded with alerts or in emergencies)                                                                                           | `false`         |                 |
| `podSecurityContext`                              | Pod Security Context. Please refer to Kubernetes docuemntation to set these. This chart depends on other bitnami charts. You will have to set security context for those as well       | `{}`            |                 |
| `containerSecurityContext`                        | Container Security Context. Please refer to kubernetes documentation to set these. This chart depends on other bitnami charts. You will have to set security context for those as well | `{}`            |                 |
| `nodeSelector`                                    | Node Selector. Please refer to Kubernetes documentation on how to use them.                                                                                                            | `{}`            |                 |
| `tolerations`                                     | Tolerations. Please refer to Kubernetes documentation on how to use them.                                                                                                              | `[]`            |                 |
| `affinity`                                        | Affinity. Please refer to Kubernetes documentation on how to use them.                                                                                                                 | `{}`            |                 |
| `extraTemplates`                                  | Extra templates to be added to the deployment                                                                                                                                          | `[]`            |                 |
| `script.workflowScriptTimeoutInMs`                | Timeout for workflow script                                                                                                                                                            | `5000`          |                 |




## Using External Databases

> **Migrating from a standalone database to an operator?** Step-by-step runbooks:
> [PostgreSQL: Standalone → CloudNativePG](../../Docs/MigratePostgresStandaloneToOperator.md)
> and [ClickHouse: Standalone → Altinity operator](../../Docs/MigrateClickhouseStandaloneToOperator.md).

### PostgreSQL

OneUptime includes a built-in PostgreSQL deployment using the official PostgreSQL Docker image. PostgreSQL is used for storing application data, user data, and configuration.

#### Built-in PostgreSQL Configuration

The default configuration provides a standalone PostgreSQL instance with authentication enabled:

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
    # Will be auto-generated if not provided
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

#### External PostgreSQL Configuration

If you would like to use an external PostgreSQL database, please add these env vars to your values.yaml file:

```yaml
postgresql:
  # Set Internal PostgreSQL enabled to false, so we dont install PostgreSQL in your cluster
  enabled: false 

# External PostgreSQL Configuration
# You need to set postgresql.enabled to false if you're using an external postgresql database.
externalPostgres: 
  host: 
  port: 
  username: 
  password: 
  # If you're using an existing secret for the password, please use this instead of password. 
  existingSecret:
    name: 
    # This is the key in the secret where the password is stored.
    passwordKey: 
  database:
  ssl:
    enabled: false
    # If this is enabled, please set either "ca"
    ca: 

    # Optional
    cert: 
    key:
```

#### Operator-managed PostgreSQL (High Availability)

The built-in PostgreSQL above is a single, standalone instance — no replication or automatic failover. For production high availability, you can instead run PostgreSQL under the [CloudNativePG](https://cloudnative-pg.io) operator, which is **bundled** with this chart and installed automatically when you enable it. This gives you streaming replication, automatic failover, rolling minor upgrades, and a dedicated read-only service.

This is a separate, self-contained `postgresOperator` object — it does **not** read any `postgresql.*` values. Enabling it replaces the built-in StatefulSet:

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

When `postgresOperator.cnpg.enabled` is `true`, the built-in `postgresql` StatefulSet/Service/ConfigMaps are not rendered, and the OneUptime app connects (as the `postgres` superuser) to the cluster's read-write service `<release>-postgresql-cnpg-rw`.

**Replication** is controlled by `instances`:

- `instances: 1` — a single primary, no replicas.
- `instances: 3` — one primary plus two hot-standby replicas kept current by PostgreSQL streaming replication. If the primary fails, the operator automatically promotes a healthy replica and re-points the `-rw` service. This is **asynchronous** replication by default. Scaling is online — change `instances` and `helm upgrade`.

For **synchronous** replication (a commit is not acknowledged until standbys confirm it — zero data loss on failover), set `synchronousReplicas`:

```yaml
postgresOperator:
  cnpg:
    enabled: true
    instances: 3
    synchronousReplicas: 1      # quorum: every commit waits for >=1 standby
```

Keep `instances >= synchronousReplicas + 2` so writes don't block when a single standby is briefly unavailable.

**Read scaling.** The operator also creates `<release>-postgresql-cnpg-ro` (load-balanced across replicas) and `<release>-postgresql-cnpg-r` (any instance). Point read-heavy/reporting workloads at `-ro`; the OneUptime app itself uses the `-rw` (primary) endpoint.

**Backups.** Enable scheduled, online **volume-snapshot** backups — native, with no object store or extra components:

```yaml
postgresOperator:
  cnpg:
    enabled: true
    backup:
      enabled: true
      schedule: "0 0 3 * * *"      # 6-field cron (incl. seconds) — 3am daily
      volumeSnapshotClassName: ""  # your CSI VolumeSnapshotClass (empty = default)
```

This configures the cluster for CSI snapshot backups and creates a `ScheduledBackup`. Requires a CSI driver with `VolumeSnapshot` support. Restore is a new cluster that bootstraps from a snapshot (optionally to a point in time) — see [Docs/Postgres.md](../../Docs/Postgres.md). Note: CloudNativePG does **not** auto-prune volume snapshots (its `retentionPolicy` is object-store-only), so prune old snapshots yourself, or use object-store backups (Barman Cloud Plugin) for automatic retention + continuous PITR.

**Sharding is not supported.** Neither CloudNativePG nor this chart shards PostgreSQL horizontally, and OneUptime does not need it at typical scale. Scale PostgreSQL with a larger node (vertical), read replicas (above), connection pooling, and PostgreSQL table partitioning for very large tables. True distributed sharding would require the Citus extension (or an operator such as StackGres that wraps it) — a different architecture that is out of scope for this chart.

> **Bundled-operator notes.** The CloudNativePG operator is cluster-scoped and owns the CloudNativePG CRDs. Do not enable it in more than one OneUptime release per cluster, and note that `helm uninstall` can remove the CRDs (and cascade-delete clusters) — back up first. Tune the operator itself under the top-level `cloudnative-pg:` values.

Enabling the operator bootstraps a **fresh, empty** cluster — it does not migrate data from an existing StatefulSet. Follow the step-by-step [Standalone → CloudNativePG migration runbook](../../Docs/MigratePostgresStandaloneToOperator.md) to move your data, and see [Docs/Postgres.md](../../Docs/Postgres.md) for day-2 operations.

### Redis

OneUptime includes a built-in Redis deployment using the official Redis Docker image. Redis is used for caching and session management.

#### Built-in Redis Configuration

The default configuration provides a standalone Redis instance with authentication enabled:

```yaml
redis:
  enabled: true
  auth:
    # Will be auto-generated if not provided
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

#### External Redis Configuration

If you would like to use an external Redis database, please add these env vars to your values.yaml file:

```yaml
redis:
  # Set Internal Redis enabled to false, so we dont install Redis in your cluster
  enabled: false

externalRedis: 
  host: 
  port: 
  password: 
  # If you're using an existing secret for the password, please use this instead of password. 
  existingSecret:
    name: 
    # This is the key in the secret where the password is stored.
    passwordKey: 
  database: 
  tls:
    enabled: false
    # If this is enabled, please set "ca" certificate.
    ca:

    # (optional)
    cert: 
    key:

```

### Clickhouse 

OneUptime includes a built-in ClickHouse deployment using the official ClickHouse Docker image. ClickHouse is used for analytics, logs, and time-series data storage.

#### Built-in ClickHouse Configuration

The default configuration provides a standalone ClickHouse instance with authentication enabled:

```yaml
clickhouse:
  enabled: true
  auth:
    username: oneuptime
    # Will be auto-generated if not provided  
    password:
  image:
    repository: clickhouse/clickhouse-server
    tag: latest
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

#### Operator-managed ClickHouse (High Availability)

The built-in ClickHouse above is a single, standalone instance — no replication or declarative lifecycle management. For production high availability, you can instead run ClickHouse under the [Altinity ClickHouse operator](https://github.com/Altinity/clickhouse-operator), which is **bundled** with this chart and installed automatically when you enable it. This gives you declarative management, rolling upgrades, sharding, and replication backed by a bundled [ClickHouse Keeper](https://clickhouse.com/docs/en/guides/sre/keeper/clickhouse-keeper) ensemble.

This is a separate, self-contained `clickhouseOperator` object — it does **not** read any `clickhouse.*` values. Enabling it replaces the built-in StatefulSet:

```yaml
clickhouseOperator:
  altinity:
    enabled: true
    image:
      tag: "25.3"        # pin a ClickHouse version for production
    cluster:
      shardsCount: 1
      replicasCount: 2   # 2 = HA (uses the bundled Keeper, enabled by default)
    keeper:
      enabled: true
      replicas: 3        # Keeper quorum (1 for dev, 3/5 for production)
```

When `clickhouseOperator.altinity.enabled` is `true`, the built-in `clickhouse` StatefulSet/Service/ConfigMap are not rendered, and the OneUptime app connects (as the `oneuptime` user) to the operator-managed `ClickHouseInstallation`'s root service `<release>-clickhouse-altinity` on port `8123`. A ClickHouse Keeper ensemble (`<release>-clickhouse-keeper`) is created to coordinate replication; bring your own ZooKeeper/Keeper instead with `clickhouseOperator.altinity.zookeeper.nodes`. Follow the step-by-step [Standalone → Altinity operator migration runbook](../../Docs/MigrateClickhouseStandaloneToOperator.md) to move your data, and see [Docs/Clickhouse.md](../../Docs/Clickhouse.md) for scaling and backups (via [clickhouse-backup](https://github.com/Altinity/clickhouse-backup)).

> **Bundled-operator notes.** The Altinity operator is cluster-scoped and owns the ClickHouse CRDs. Do not enable it in more than one OneUptime release per cluster. Tune the operator itself (including its management-user credentials) under the top-level `altinity-clickhouse-operator:` values.

#### External ClickHouse Configuration

If you would like to use an external clickhouse database, please add these env vars to your values.yaml file. 

```yaml
clickhouse: 
  # Set Internal Clickhouse enabled to false, so we dont install the clickhouse database in your cluster
  enabled: false

externalClickhouse:
  host: 
  # if you host is https then set this to true
  isHostHttps: 
  port: 
  username: 
  password: 
  # If you're using an existing secret for the password, please use this instead of password. 
  existingSecret:
    name: 
    # This is the key in the secret where the password is stored.
    passwordKey: 
  database:
  tls:
    enabled: false
    # If this is enabled, please set either "ca"
    ca: 

    # Optional
    cert: 
    key:
```


## If you would like to use a custom domain for your status page, please add these env vars 


| Parameter | Description | Default | Change Required |
| --------- | ----------- | ------- | --------------- |
| `letsEncrypt.accountKey` | Generate a private key via openssl, encode it to base64 | `` | 🚨 |
| `letsEncrypt.email` | Email address to register with letsencrypt for notifications | `` | 🚨 |


## Adding a Custom Domain to your Status Page

**Step 1: Add a CNAME record to your DNS settings**

If you would like to add a custom domain to your status page (something like status.yourcompany.com), you can do so by adding a CNAME record to your DNS settings. 

```
DNS Record Type: CNAME
Host: status.yourcomapny.com
Value: <your-oneuptime-host>
```

Please make sure oneuptime is hosted on a server which is publicly accessible.

**Step 2: Add Custom Domain to your Project**

Please go to your project settings and add the custom domain to your project. You can find the project settings by clicking "More" in the nav bar and by clicking "Project Settings". Please go to "Custom Domain" page and add your custom domain there. You will need to verify the domain. You can find the verification code in the "Custom Domain" page in your project settings. 


**Step 3: Add custom domain to your status page.**

Please go to your status page settings and add the custom domain to your status page. You can find the status page settings by clicking on "View Status Page" in "Status Pages" page. You can add the custom domain in the "Custom Domain" page in your status page settings. 

Once you have added the custom domain, you can access your status page using the custom domain.

## Production Readiness Checklist

Please go through the following checklist to make sure your OneUptime installation is production ready.

- [ ] Please pin OneUptime version to a specific version. This will prevent any breaking changes from affecting your installation.

When you install, you can check the latest version from the github releases page https://github.com/OneUptime/oneuptime/releases. You can pin the version in your values.yaml file.

```
image:
  tag: <specific-version>
```

- [ ] Please pin OneUptime, PostgreSQL,Redis, and ClickHouse versions to a specific version. This will prevent any breaking changes from affecting your installation.

When you install, you can check the version installed by describing the pods. 

```
kubectl describe pod <pod-name>
```

For example: 

```
kubectl describe pod my-oneuptime-postgresql-0
```

Once you have the version, you can pin the version in your values.yaml file.

```
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

- [ ] Please make sure you have backups enabled for your PVCs. This is outside the scope of this chart. Please refer to your cloud provider's documentation on how to enable backups for PVCs.
- [ ] For production high availability, run PostgreSQL and ClickHouse under their bundled operators instead of the single, standalone built-ins. Set `postgresOperator.cnpg.enabled: true` (CloudNativePG — streaming replication and automatic failover) and `clickhouseOperator.altinity.enabled: true` (Altinity — replication, sharding, and declarative lifecycle management). See the **Operator-managed PostgreSQL** and **Operator-managed ClickHouse** sections above for the full configuration. Enabling an operator bootstraps a fresh, empty cluster — if you already run a standalone database, follow the migration runbooks ([PostgreSQL](../../Docs/MigratePostgresStandaloneToOperator.md), [ClickHouse](../../Docs/MigrateClickhouseStandaloneToOperator.md)) to move your data first.
- [ ] Enable the dedicated worker deployment so background jobs (telemetry ingestion, notifications, incident/alert processing, workflows) run in their own pods instead of competing with API requests on the shared event loop. Set `worker.enabled: true` — the `app` pods then stop consuming queues and the worker drains them. The worker becomes REQUIRED for all background work, so keep `worker.keda.minReplicas >= 1`, and set `app.keda.targetCPUUtilizationPercentage` (with `app.resources.requests.cpu`) so the API tier still autoscales once its queue-size trigger is disabled.
- [ ] Put the bundled PgBouncer connection pooler in front of PostgreSQL if you autoscale workers (KEDA) or use a connection-limited managed/external PostgreSQL — it keeps a connection storm (for example, many worker pods booting at once) from exhausting the database. Set `pgbouncer.enabled: true`. It runs in `transaction` pool mode by default (the largest connection reduction, since idle client connections hold no backend connection), which is safe because migrations run in a dedicated Job (`migrate.enabled`, on by default) instead of on the pooled pods. Keep `pgbouncer.defaultPoolSize` and `pgbouncer.maxDbConnections` below your PostgreSQL `max_connections`. For an external/managed PostgreSQL, point `externalPostgres.host`/`.port` at the database and enable the pooler — or point them at your provider's own pooled endpoint (RDS Proxy, Neon `-pooler`, Supabase Supavisor) instead. See the **Connection pooling with PgBouncer** section in [Postgres.md](../../Docs/Postgres.md).
- [ ] Confirm the database migration Job is healthy. With `migrate.enabled: true` (the default), schema and data migrations run once per release in a dedicated Job rather than on every pod. By default it runs it **asynchronously** (`migrate.hook: false`) so deploys never block — which means pods may start before migrations finish, so keep your migrations backward-compatible, or set `migrate.hook: true` to make the deploy wait. Note: with the async default, a brand-new install leaves the app pods unready (CrashLoopBackOff) until the Job creates the schema; for a clean first install run it once with `--set migrate.hook=true` (and a longer `helm upgrade --install --timeout`, e.g. `--timeout 15m`, for a slow first-time CloudNativePG bootstrap), then drop back to the async default. Check the Job with `kubectl get jobs -l app.kubernetes.io/component=migrate` and its logs if a deploy looks wrong.
- [ ] Keep Pod Disruption Budgets enabled for the stateless tier and scale those services to more than one replica. PDBs (`podDisruptionBudget.enabled: true`, on by default with `maxUnavailable: 1`) stop a node drain or cluster upgrade from evicting every replica of a service at once. They only help once a service runs multiple replicas, so set `<service>.replicaCount > 1` (or enable `autoscaling` / KEDA with `minReplicas >= 2`) for the services you need to stay available — e.g. `nginx` (ingress) and `app` (API). The single-replica databases are intentionally excluded; for database HA use the bundled operators (see above).
- [ ] Please make sure you have static passwords for your database passwords (for Redis, ClickHouse and PostgreSQL).
- [ ] Please set `oneuptimeSecret` and `encryptionSecret` (or setup in `externalSecrets` section) to a long random string. You can use a password generator to generate these strings.
- [ ] Please set `probes.<key>.key` to a long random string. This is used to secure your probes.
- [ ] Please regularly update OneUptime. We release updates every day. We recommend you to update the software at least once a week if you're running OneUptime production. 

## Troubleshooting Performance Issues

If your OneUptime deployment is slow or unhealthy, run the bundled diagnostic script. It inspects pods, databases (PostgreSQL, ClickHouse, Redis), storage, logs, autoscaling, and the ingress, then prints a ranked list of findings with concrete action steps.

The script is read-only — it only runs `SELECT` queries and `kubectl get/logs/exec` commands. It does not modify any cluster state.

**Run it:**

```console
curl -sLO https://raw.githubusercontent.com/OneUptime/oneuptime/master/HelmChart/Public/diagnose.sh
chmod +x diagnose.sh

# Auto-detects namespace and helm release name
./diagnose.sh

# Or specify them explicitly
./diagnose.sh --namespace my-namespace --release my-oneuptime
```

**Output:** the script prints findings as it runs and ends with a summary grouped by severity (CRITICAL / WARNING / INFO). Each finding includes the affected component, the symptom, and a specific action — usually the `values.yaml` key to change and the `helm upgrade` command to apply it.

A full report is saved to `oneuptime-diagnostic-<timestamp>.txt` in your current directory. Attach this file to support tickets at [oneuptime.com/support](https://oneuptime.com/support) so we can help diagnose faster.

**Options:**

```console
./diagnose.sh --help                          # show all flags
./diagnose.sh --no-color                      # plain text (for piping/logging)
./diagnose.sh --output report.txt             # custom report file path that you can send to OneUptime support for investigation
```

## Releases 

We release frequently, sometimes multiple times a day. It's usually safe to upgrade to the latest version. Any breaking changes will be documented in the release notes. Please make sure you read the release notes before upgrading.

## Upgrade Notes

- **9.0.0 (2025-11-21)**: Kubernetes Ingress objects are no longer created. OneUptime already ships an ingress gateway container that manages TLS certificates, status page domains, and routing. Remove any `oneuptimeIngress` overrides from your values files and ensure `nginx.service.type` matches how you expose the ingress gateway (for example `LoadBalancer`).

## Chart Dependencies

We use these charts as dependencies for some components. You dont need to install them separately. Please read the readme for these individual charts to understand the configuration options.

| Chart | Description | Repository | 
| ----- | ----------- | ---------- | 
| `keda` | Kubernetes Event-driven Autoscaling | https://kedacore.github.io/charts |
| `cloudnative-pg` | CloudNativePG operator — only installed when `postgresOperator.cnpg.enabled` is `true` | https://cloudnative-pg.github.io/charts |
| `altinity-clickhouse-operator` | Altinity ClickHouse operator — only installed when `clickhouseOperator.altinity.enabled` is `true` | https://helm.altinity.com/ |


## Uninstalling OneUptime

To uninstall/delete the `my-oneuptime` deployment:

```console
helm uninstall my-oneuptime
```

## Contributing

We <3 contributions big and small. 
https://github.com/OneUptime/helm-chart is the read only release repository. Please direct your contributions here: https://github.com/OneUptime/oneuptime
