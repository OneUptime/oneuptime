# Production Readiness Checklist

Work through this page to make a OneUptime install on Kubernetes ready for real
traffic. It has three parts, and most installs need only the first.

| Part | Who needs it |
| --- | --- |
| [1. Before you go live](#1-before-you-go-live) | Every install. |
| [2. Stay up through failures](#2-stay-up-through-failures) | Installs that must keep working while a node is drained, the cluster is upgraded or a database fails. |
| [3. Scale up](#3-scale-up) | Large installs, once they show one of the signs listed there. Skip it until then. |

The settings on this page go in your `values.yaml`. Apply a change with:

```console
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

## 1. Before you go live

### Reach people

A new server cannot email or page anyone until you set it up. Sign in as the
first account (the master admin) and open `https://<host>/admin/setup`, the
Admin Dashboard's server setup checklist. It walks you through each of these,
with a test for each:

- [ ] **Set up email** under **Settings > Notifications > Emails**, then click
  **Send test email**. Until email works, OneUptime cannot send invitations,
  sign-in links or notifications.
- [ ] **Set up SMS and calls** (a Twilio account) under
  **Settings > Notifications > Call and SMS**, then click **Send test SMS** and
  **Make test call**, or choose **Use email and push only**.
- [ ] **Choose who can sign up**: turn off **Let people sign up** under
  **Settings > Authentication** once your team has its accounts.
- [ ] **Serve OneUptime over HTTPS.** Point your domain at the cluster and let
  the chart get a free Let's Encrypt certificate, which needs ports 80 and 443
  open to the internet:

  ```yaml
  host: oneuptime.example.com
  httpProtocol: https
  ssl:
    provision: true # leave this off when your own ingress or load balancer ends TLS
  ```

The [Self-Hosting Guide](https://oneuptime.com/docs/installation/self-hosting-guide)
goes through the same steps in order, from installing the chart to a test page.

### Keep your keys and passwords

The chart makes OneUptime's keys and the database passwords on the first
`helm install`, and keeps them on every `helm upgrade`. Set them yourself, so
that nothing can replace them, and keep a copy outside the cluster.

- [ ] **Set the keys and passwords in your values:**

  ```yaml
  oneuptimeSecret: <random string>
  encryptionSecret: <random string>
  probes:
    one:
      key: <random string>
  postgresql:
    auth:
      postgresPassword: <random string>
  clickhouse:
    auth:
      password: <random string>
  valkey:
    auth:
      password: <random string>
  ```

  **New install:** make each one with `openssl rand -hex 32` before the first
  `helm install`.

  **Already installed:** copy the values the chart made instead of making new
  ones. A new `encryptionSecret` cannot read what the old one encrypted, a new
  PostgreSQL password locks OneUptime out of its database, and a new probe key
  registers a new probe and leaves your monitors on the old one. Print them
  with:

  ```bash
  for name in secrets postgresql clickhouse valkey; do
    kubectl get secret "my-oneuptime-$name" \
      -o go-template='{{range $k, $v := .data}}{{$k}}: {{$v | base64decode}}{{"\n"}}{{end}}'
  done
  ```

  | Printed as | Set it as |
  | --- | --- |
  | `oneuptime-secret` | `oneuptimeSecret` |
  | `encryption-secret` | `encryptionSecret` |
  | `register-probe-key` | `registerProbeKey` |
  | `probe-<name>` | `probes.<name>.key` |
  | `global-runner-key` | `globalRunner.key` |
  | `postgres-password` | `postgresql.auth.postgresPassword` |
  | `admin-password` | `clickhouse.auth.password` |
  | `valkey-password` | `valkey.auth.password` |

- [ ] **Deploy with Argo CD, Flux, or anything else built on `helm template`?**
  Then the step above is required: `helm template` makes new random values on
  every sync. Set `globalRunner.key` too. See
  [Probe and Runner identity keys](configuration.md#probe-and-runner-identity-keys).
- [ ] **Keep your values in Git?** Keep the keys in Secrets you manage instead
  of in the file: `externalSecrets`, `probes.<name>.existingSecret`,
  `globalRunner.existingSecret`, `clickhouse.auth.existingSecret`,
  `valkey.auth.existingSecret`, and for web push `vapid.existingSecret.name`.
  See [Application secrets](configuration.md#application-secrets) and
  [Web push notifications](configuration.md#web-push-notifications).

### Pin versions

So that an upgrade happens only when you choose it:

- [ ] **Pin the OneUptime version.** The default tag, `release`, follows every
  release: any pod that restarts can come back on a newer version. Pick the
  newest version on the
  [releases page](https://github.com/OneUptime/oneuptime/releases):

  ```yaml
  image:
    tag: <version>
  ```

- [ ] **Pin PostgreSQL to the major version it runs now.** Its default tag is
  `latest`, and a new major version of PostgreSQL cannot start on the old
  one's data. Find the version with
  `kubectl exec my-oneuptime-postgresql-0 -- postgres --version`, then pin it:

  ```yaml
  postgresql:
    image:
      tag: "<major version>" # such as "17"
  ```

  With the CloudNativePG operator, pin `postgresOperator.cnpg.imageName`
  instead. ClickHouse and Valkey need nothing: the chart pins their versions
  itself (`clickhouse.image.tag`, `valkey.image.tag`).

### Back up your data

- [ ] **Back up PostgreSQL and ClickHouse to storage outside the cluster.** On
  the Enterprise Edition, turn on scheduled backups in the Admin Dashboard: see
  [Backups](https://oneuptime.com/docs/installation/backups). Otherwise, use
  your cloud provider's backups of the persistent volumes, or the CloudNativePG
  operator's [volume snapshot backups](databases.md#operator-managed-high-availability).
  Keep your keys (above) with the backups: what OneUptime encrypted cannot be
  read with a different `encryptionSecret`.

### Stay current

- [ ] **Update OneUptime at least once a week.** We release updates every day.
  Read the [release notes](https://github.com/OneUptime/oneuptime/releases) and
  the [upgrade notes](upgrade-notes.md), set `image.tag` to the new version,
  then:

  ```console
  helm repo update
  helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
  ```

- [ ] **After each upgrade, check that the database migrations finished.** They
  run in a Job. New pods wait, unready, until the migrations they need are
  done, while the old pods keep serving:

  ```console
  kubectl get jobs -l app.kubernetes.io/component=migrate
  ```

  New pods that restart every 15 minutes mean the Job has not finished: read
  its logs with `kubectl logs -l app.kubernetes.io/component=migrate`. See
  [New pods and pending schema migrations](../../../Docs/Postgres.md#new-pods-and-pending-schema-migrations).

## 2. Stay up through failures

The chart runs one copy of each service and each database. Draining a node or
upgrading the cluster stops a service until its pod starts again elsewhere, and
a database that fails stops OneUptime until the database is back.

- [ ] **Run two or more copies of `nginx` and `app`** (and `worker`, if you
  turned it on), **and turn on Pod Disruption Budgets**, so a node drain or a
  cluster upgrade never takes every copy down at once:

  ```yaml
  nginx:
    replicaCount: 2
  app:
    replicaCount: 2
  podDisruptionBudget:
    enabled: true # at most one pod of each service down at a time
  ```

  With autoscaling or KEDA on a service, set its `minReplicas` to 2 instead.
  More than three copies of a service? Also set
  `deployment.updateStrategy.rollingUpdate.maxUnavailable: 0`, so an upgrade
  keeps the old pods serving while the new ones wait for the database
  migrations.

- [ ] **Check that the copies run on different nodes.** The chart asks
  Kubernetes to spread them (`deployment.spreadReplicasAcrossNodes`, on by
  default), but only as a preference. Give the cluster at least two nodes with
  room, and after a rollout check with `kubectl get pods -o wide` that no
  service has every copy on one node. On a cluster across zones, add a zone
  rule: see
  [Spreading replicas across nodes](configuration.md#spreading-replicas-across-nodes).

- [ ] **Run PostgreSQL and ClickHouse with replicas and automatic failover**,
  under the operators the chart bundles, instead of the single built-in
  databases:

  ```yaml
  postgresOperator:
    cnpg:
      enabled: true
      instances: 3 # one primary and two standbys
  clickhouseOperator:
    altinity:
      enabled: true
      cluster:
        replicasCount: 2 # two copies of the data
  ```

  Read [Operator-managed PostgreSQL](databases.md#operator-managed-high-availability)
  and [Operator-managed ClickHouse](databases.md#operator-managed-high-availability-1)
  before you turn them on. An operator starts a new, empty database, so an
  install that already has data moves it first with the runbooks
  ([PostgreSQL](../../../Docs/MigratePostgresStandaloneToOperator.md),
  [ClickHouse](../../../Docs/MigrateClickhouseStandaloneToOperator.md)), and
  the first install of CloudNativePG needs
  [its CRDs in place first](../../../Docs/Postgres.md#first-install-with-the-operator-enabled-crds-must-exist-first).

## 3. Scale up

Skip this part until your install shows one of these signs:

| You see | Do this |
| --- | --- |
| Sign-ins and dashboards slow down while telemetry or other background work is busy | [Run background jobs in their own pods](#run-background-jobs-in-their-own-pods) |
| The app logs `Probe scheduling is at its limit`, or queue jobs fail with `timeout exceeded when trying to connect` | [Run background jobs in their own pods](#run-background-jobs-in-their-own-pods), then [size the Postgres connections](#size-the-postgres-connections) |
| PostgreSQL refuses connections with `sorry, too many clients already` | [Size the Postgres connections](#size-the-postgres-connections) |
| You want pods to scale with the work waiting for them | [Autoscale with KEDA](#autoscale-with-keda) |
| ClickHouse refuses queries with `TOO_MANY_SIMULTANEOUS_QUERIES` | [Keep ClickHouse inserts in budget](#keep-clickhouse-inserts-in-budget) |

### Run background jobs in their own pods

By default the `app` pods serve requests and also run the background jobs:
telemetry ingestion, notifications, incident and alert processing, and
workflows. Give the jobs pods of their own, so they never slow down requests:

```yaml
worker:
  enabled: true
```

The `app` pods then stop running jobs, and the worker runs all of them, so
never let it scale to zero. With KEDA, keep `worker.keda.minReplicas` at 1 or
more, and give the `app` pods a CPU target
(`app.keda.targetCPUUtilizationPercentage`, with `app.resources.requests.cpu`):
they no longer scale on the queue.

### Size the Postgres connections

Every `app`, `worker`, `nginx` and telemetry writer pod opens up to 50
connections to PostgreSQL (`deployment.databaseMaxOpenConnections`). Add that
up over every pod, at the most each autoscaler allows, and keep the total below
PostgreSQL's `max_connections`: 500 for the chart's own PostgreSQL, which ten
pods already reach. When it does not fit:

- **Put PgBouncer in front of PostgreSQL.** Do this once you autoscale workers,
  or with a managed PostgreSQL that limits connections, so many pods starting
  at once cannot use up the database:

  ```yaml
  pgbouncer:
    enabled: true
  ```

  Keep `pgbouncer.defaultPoolSize` and `pgbouncer.maxDbConnections` below
  PostgreSQL's `max_connections`. With a managed PostgreSQL, you can point
  `externalPostgres.host` at your provider's pooled endpoint (RDS Proxy, Neon
  `-pooler`, Supabase Supavisor) instead.
- **Or raise `max_connections`**: see
  [Increasing max_connections](../../../Docs/Postgres.md#increasing-max_connections-for-postgres).

If the app logs `Probe scheduling is at its limit`, or queue jobs fail with
`timeout exceeded when trying to connect`, the database is slower than the
load. Run background jobs in their own pods (above): worker pods serve no
requests, so their jobs keep the whole pool. Then raise the pool together with
`max_connections`. How a pod shares its pool between requests, jobs and probes:
[How a pod shares its connections](../../../Docs/Postgres.md#how-a-pod-shares-its-connections).
PgBouncer's pool modes and TLS:
[Connection pooling with PgBouncer](../../../Docs/Postgres.md#connection-pooling-with-pgbouncer-optional).

### Autoscale with KEDA

KEDA scales pods on the work waiting for them: the `app` and `worker` pods on
the queue of background jobs, and each probe on the checks it has waiting. Turn
it on, and opt each service in:

```yaml
keda:
  enabled: true
worker:
  keda:
    enabled: true
    minReplicas: 1
    maxReplicas: 10 # count these when you size the Postgres connections
```

Decide where KEDA comes from before the first install that turns it on:

- **Your cluster already runs KEDA:** also set `keda.install: false`. A second
  KEDA collides with the one your platform team runs.
- **It does not:** the chart installs KEDA, but the first install needs one
  extra pass to put KEDA's CRDs in place first.

Both, step by step:
[KEDA Ops](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Docs/Keda.md).

### Keep ClickHouse inserts in budget

Every pod that ingests telemetry (the `worker` pods, or the `app` pods while
`worker.enabled` is false) sends ClickHouse at most 4 inserts at once
(`worker.telemetryFanInMaxConcurrentInserts`), so ClickHouse sees *pods × 4*.
Keep that under about 60% of ClickHouse's `max_concurrent_queries`, so reads
and merges still get a turn. The chart's own ClickHouse allows 10000. A
ClickHouse of your own that allows 100 fits about 15 such pods.

To grow past that, lower `telemetryFanInMaxConcurrentInserts` as you add pods,
or turn on the telemetry writer tier: a fixed-size deployment that makes the
telemetry inserts for every other pod, so ClickHouse sees the same number of
inserts however many workers run:

```yaml
telemetryWriter:
  enabled: true
  replicaCount: 2 # ClickHouse then sees at most 2 × 4 inserts at once
```

Size the writer tier to what ClickHouse can take, with the same 60% rule, and
never scale it on the queue: when it is full it answers 429, the workers retry,
and the backlog waits in the queue. Batch sizes, the tier's own autoscaling and
memory, and how durable an insert is:
[Sizing ClickHouse inserts](configuration.md#sizing-clickhouse-inserts).
