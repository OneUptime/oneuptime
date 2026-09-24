# Databases

## Overview

**Databases** (_Resources → Databases_ in the dashboard) gives every database server your project runs or talks to its own page: what is calling it and how fast, where it runs, the engine's own health metrics, its logs and traces, and the incidents, alerts and scheduled maintenance attached to it. Databases have labels, owners, label and owner rules, per-database retention and archiving, like every other resource.

Most databases appear on their own. OneUptime assembles each one from up to four sources, and each source contributes something different:

| Source | What it needs from you | What it adds to the database's page |
| --- | --- | --- |
| **Application traces** | Instrumented applications (OpenTelemetry) | Queries from applications: call rate, errors, latency, and the services calling it |
| **Kubernetes** | The [OneUptime Kubernetes agent](/docs/telemetry/kubernetes-agent) | Where it runs: pods, CPU and memory, and the pods' logs |
| **Docker / Podman** | The [Docker agent](/docs/telemetry/docker-host) or [Podman agent](/docs/telemetry/podman-host) | Where it runs: the containers, their CPU and memory, and their logs |
| **Database Agent** (an OpenTelemetry Collector) | The [Database Agent](#the-database-agent) or your own collector | **Engine metrics** — connections, throughput, cache hit ratio, locks, replication lag, memory — plus optional query samples, top queries and the engine's log file |

Engine metrics only ever come from a collector talking to the database itself. Traces and container inventories tell OneUptime that a database exists and how it is used, but not how it is doing inside — the **Engine metrics** status on each database says whether that part is connected.

You can also add a database by hand: **Databases → Create Database** with its engine, address and port.

This page covers how databases are detected, the Database Agent, Kubernetes, how endpoints tie the sources together, and troubleshooting. For a probe-based health check that needs no agent at all, see the [Database Health Monitor](/docs/monitor/database-health-monitor).

## How databases are detected

Each database remembers the source that created it (the **Discovery source** column); later sources add to the same database rather than creating another one, as long as they describe the same endpoint.

### From application traces

Every 10 minutes OneUptime summarises the CLIENT spans your applications sent that carry `db.system.name` (or the older `db.system`). The server comes from `server.address` (or `net.peer.name`, then `network.peer.address`) and the port from `server.port` (or `net.peer.port`); when the span has no port, the engine's default port is assumed. Engine names are normalised, so `postgres`, `pg` and `postgresql` are one engine, as are `mssql` and `microsoft.sql_server`, or `mariadb` and `mysql`.

A database is **created** from traces only when all of these hold — anything else still counts towards a database that already exists, it just never creates one:

- the address is a real, project-wide name: a DNS name, not an IP literal and not a name that only resolves locally (see [Endpoints](#endpoints-and-the-one-owner-rule));
- the engine is a server you can run — DynamoDB, Cosmos DB, Spanner, SQLite and H2 are never created from traces;
- the endpoint received at least 10 calls in the window, so a one-off script does not create a database;
- the project is under its auto-create budget (500 discovered databases by default).

Every database CLIENT span is also tagged with its endpoint when it is ingested, so once a database owns an endpoint, the **Queries from applications** section and the **Traces** tab show every call to it — including calls made before the database was created. `db.client.*` metrics (for example `db.client.operation.duration`) that carry a `server.address` are tagged the same way.

### From Kubernetes

Every 5 minutes OneUptime looks at the pods of each connected Kubernetes cluster and recognises database workloads:

1. **Operator and chart labels first**: CloudNativePG, Zalando (Spilo), Crunchy PGO, Bitnami charts, ECK, Altinity ClickHouse, cass-operator, Percona and the Oracle MySQL operator. One operator cluster becomes one database.
2. **Container images otherwise**, by exact image name (`postgres`, `bitnami/postgresql`, `mysql`, `mariadb`, `redis`, `valkey/valkey`, `mongo`, …). Exporters, operators, admin UIs, connection poolers (pgbouncer, pgpool, ProxySQL, HAProxy, Cloud SQL Proxy) and backup tools are not databases. A pod that also runs an application container is not treated as a database either — an app with a database sidecar is still the app.

Pods are grouped by their StatefulSet, Deployment or operator cluster, so a three-member StatefulSet is one database with three members. Each database gets endpoints for its Services, qualified by the cluster — `postgres.prod.svc.cluster.local:5432@my-cluster` — so the same name in two clusters stays two databases. (When the project has exactly one cluster, the unqualified `postgres.prod.svc.cluster.local:5432` is added too.) Applications whose telemetry goes through the Kubernetes agent carry their namespace and cluster, so their calls to `postgres` (from the same namespace), `postgres.prod.svc` or the full name are matched to it. A two-part name such as `postgres.prod` is not expanded — use the full name in connection strings you want matched.

OneUptime reads pod metadata, labels and images only — never environment variables or secrets.

### From Docker and Podman

Every 5 minutes the containers of each connected Docker or Podman host are classified by image the same way. A container is one database, and Compose replicas (`db-1`, `db-2`) are one database with several members. Container names only resolve inside one Docker network, so these databases get **no** endpoints automatically; their page shows the container's own metrics and logs. To join the queries your applications send, add the address they use on the [Endpoints](#endpoints-and-the-one-owner-rule) tab.

### From the Database Agent or your own collector

When engine metrics or logs arrive from a collector database receiver, OneUptime registers the database from the endpoint the data names, the moment it is ingested. See [The Database Agent](#the-database-agent) and [Using your own OpenTelemetry Collector](#using-your-own-opentelemetry-collector).

## The Database Agent

The OneUptime Database Agent is a pre-configured OpenTelemetry Collector for **PostgreSQL**, **MySQL / MariaDB**, **Redis / Valkey** and **MongoDB**. It is config-only: a stock `otel/opentelemetry-collector-contrib` container running the collector's native receiver for your engine, with a config that stamps every batch with the database's identity and ships it to OneUptime over OTLP. Nothing is installed on the database server.

**One agent monitors one database server.** The identity is stamped on everything the agent sends, so run one agent — one install directory — per server, and one per replica if you want replicas on their own pages.

The agent lives in the [DatabaseAgent directory](https://github.com/OneUptime/oneuptime/tree/master/agents/DatabaseAgent): `docker-compose.yml`, one collector config per engine (`configs/postgresql.yaml`, `configs/mysql.yaml`, `configs/redis.yaml`, `configs/mongodb.yaml`), `install.sh`, `troubleshoot.sh` and a systemd unit.

### Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the database's port (or a Kubernetes cluster — see [Kubernetes](#kubernetes))
- A monitoring user on the database with the grants below
- A **OneUptime Telemetry Ingestion Key** — create one from _Project Settings → Telemetry & APM → Ingestion Keys_

### Create a monitoring user

Give the agent its own login with read access to the engine's statistics — never an administrator and never an application's login. If you already created a monitoring user for the [Database Health Monitor](/docs/monitor/database-health-monitor#create-a-monitoring-user), its PostgreSQL and MySQL grants cover the agent as well.

#### PostgreSQL

```sql
CREATE USER oneuptime_monitor WITH PASSWORD 'a-strong-password';
GRANT pg_monitor TO oneuptime_monitor;
```

`pg_monitor` is a built-in role (PostgreSQL 10 and later) that grants read access to the statistics and monitoring views and no access to your tables. It is not optional: without it `pg_stat_activity` does not fail, it returns only the agent's own session, so connection counts read `1` on a server that is actually full. The receiver connects to every database to read per-database statistics, so the user also needs `CONNECT` on each one (`PUBLIC` has it by default). The PostgreSQL receiver refuses to start without a password.

Top queries (`DATABASE_QUERY_EVENTS=true`) also read `pg_stat_statements`: load it with `shared_preload_libraries = 'pg_stat_statements'` (a restart) and create it in every monitored database:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

On a managed service where `pg_monitor` is unavailable, `pg_read_all_stats` covers the same views. The agent already skips the internal databases of Amazon RDS, Azure, Cloud SQL and AlloyDB that no customer login can open.

#### MySQL / MariaDB

```sql
CREATE USER 'oneuptime_monitor'@'%' IDENTIFIED BY 'a-strong-password';
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'oneuptime_monitor'@'%';
GRANT SELECT ON performance_schema.* TO 'oneuptime_monitor'@'%';
```

`PROCESS` and `REPLICATION CLIENT` cover the global status counters, InnoDB status and replica status; `performance_schema` (on by default since MySQL 5.6) is read for query samples and top queries. MariaDB is registered as MySQL — the two share a protocol and applications report either name.

#### Redis / Valkey

```text
ACL SETUSER oneuptime_monitor on >a-strong-password -@all +info +ping
```

The receiver only runs `INFO`. Persist the user with `ACL SAVE` (or a `user` line in `redis.conf` / your ACL file). On a server protected only by `requirepass`, leave `DATABASE_USERNAME` empty and set `DATABASE_PASSWORD`; on a server without authentication leave both empty.

#### MongoDB

```js
db.getSiblingDB("admin").createUser({
  user: "oneuptime_monitor",
  pwd: "a-strong-password",
  roles: [{ role: "clusterMonitor", db: "admin" }],
});
```

`clusterMonitor` covers every metric. Explain plans on top queries additionally need `{ role: "read", db: "<database>" }` for each monitored database; without it top queries still arrive, with empty plans. The agent connects to exactly one member (`direct_connection`), so run one agent per replica-set member.

### Quick Start (Install Script)

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DatabaseAgent/install.sh -o install.sh
bash install.sh
```

The script asks for your OneUptime URL and ingestion key, the engine, the endpoint to connect to and the monitoring credentials (the password is read without echo). It downloads `docker-compose.yml` and the matching `configs/<engine>.yaml` (saved as `otel-collector-config.yaml`) to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file and starts the agent. When the endpoint only means something on this machine (`localhost`, `host.docker.internal`) it also asks for the host name your applications use, because that name is the database's identity.

Every prompt can be answered with an exported variable of the same name, and `INSTALL_DIR` picks the directory — for example `INSTALL_DIR=/opt/oneuptime-database-agent-orders bash install.sh` for a second database. Re-running the script reuses every value in your existing `.env` and refreshes only the downloaded files.

### Alternative — Docker Compose

Download `docker-compose.yml` and the config for your engine from the [DatabaseAgent directory](https://github.com/OneUptime/oneuptime/tree/master/agents/DatabaseAgent) into one folder, saving the config as `otel-collector-config.yaml`:

```bash
curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DatabaseAgent/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DatabaseAgent/configs/postgresql.yaml -o otel-collector-config.yaml
```

Create a `.env` file next to them (`chmod 600 .env` — it holds a password):

```bash
ONEUPTIME_URL=YOUR_ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=YOUR_TELEMETRY_INGESTION_KEY
DATABASE_SYSTEM=postgresql
DATABASE_ENDPOINT=db.internal:5432
DATABASE_SERVER_ADDRESS=db.internal
DATABASE_SERVER_PORT=5432
DATABASE_USERNAME=oneuptime_monitor
DATABASE_PASSWORD='a-strong-password'
DATABASE_TLS_INSECURE=true
DATABASE_TLS_INSECURE_SKIP_VERIFY=false
DATABASE_COLLECTION_INTERVAL=30s
DATABASE_QUERY_EVENTS=false
DATABASE_SERVER_ID=
KUBERNETES_CLUSTER_NAME=
```

Start it:

```bash
docker compose up -d
```

After the first collection the database appears under **Databases** — or, if OneUptime had already detected it from traces or containers at the same address, its **Engine metrics** status turns to Connected.

### Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (for example `https://oneuptime.com` or your self-hosted host) |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key from _Project Settings → Telemetry & APM → Ingestion Keys_ |
| `DATABASE_SYSTEM` | Yes | `postgresql`, `mysql`, `redis` or `mongodb` — the engine whose config `install.sh` downloads |
| `DATABASE_ENDPOINT` | Yes | `host:port` the agent connects to. Use `host.docker.internal:<port>` when the agent runs on the database machine (see [Troubleshooting](#troubleshooting) if that is refused) |
| `DATABASE_SERVER_ADDRESS` | Yes | The database's identity, stamped as `server.address`: the host name your **applications** use to reach it. Never `localhost` — OneUptime ignores addresses that only mean something on one machine. Keep it stable; changing it registers a second database |
| `DATABASE_SERVER_PORT` | Yes | The port your applications use, stamped as `server.port` |
| `DATABASE_USERNAME` | PostgreSQL, MySQL | The monitoring user. Optional for Redis and MongoDB servers without authentication |
| `DATABASE_PASSWORD` | PostgreSQL | Its password. If it contains `$`, `#`, spaces or quotes, single-quote it in `.env` (`install.sh` does this for you) |
| `DATABASE_TLS_INSECURE` | No | `true` (default) connects without TLS; `false` turns TLS on |
| `DATABASE_TLS_INSECURE_SKIP_VERIFY` | No | `true` accepts a certificate the collector image does not trust (self-signed, private CA). Defaults to `false` |
| `DATABASE_COLLECTION_INTERVAL` | No | How often the engine's statistics are read. Defaults to `30s` |
| `DATABASE_QUERY_EVENTS` | No | `true` ships query samples and top queries as logs (PostgreSQL, MySQL and MongoDB). They contain query text. Defaults to `false` |
| `DATABASE_SERVER_ID` | No | The id of a database OneUptime already shows (its **Documentation** tab has it, prefilled). The data then joins that database directly, whatever its address |
| `KUBERNETES_CLUSTER_NAME` | No | Kubernetes only: the cluster name the OneUptime Kubernetes agent uses. It qualifies cluster-local addresses the same way detected databases are qualified |

### What Gets Collected

| Engine | Receiver | Also enabled by the agent (off upstream) | Query events |
| --- | --- | --- | --- |
| PostgreSQL | `postgresql` — connections vs `max_connections`, commits and rollbacks, block reads, database and table sizes, row operations, replication and WAL lag, checkpoints, vacuums | `postgresql.blks_hit` / `postgresql.blks_read` (cache hit ratio), `postgresql.deadlocks`, `postgresql.temp_files`, `postgresql.tup_*` (row throughput), `postgresql.database.locks` | query samples (`pg_stat_activity`), top queries (`pg_stat_statements`) |
| MySQL / MariaDB | `mysql` — threads and connections, buffer pool usage and reads, row and table locks, handlers, row operations, uptime | `mysql.query.count`, `mysql.query.slow.count`, `mysql.commands`, `mysql.connection.count`, `mysql.connection.errors`, `mysql.max_used_connections`, `mysql.replica.time_behind_source`, `mysql.client.network.io` | query samples, top queries (`performance_schema`) |
| Redis / Valkey | `redis` — clients, commands per second, keyspace hits and misses, memory, evictions, expirations, replication offset, uptime | `redis.maxmemory`, `redis.role`, `redis.replication.replica_offset`, `redis.cmd.latency` | — |
| MongoDB | `mongodb` — connections, operations and their time, cache operations, memory, data, storage and index sizes, cursors, sessions | `mongodb.health`, `mongodb.uptime`, `mongodb.operation.latency.time`, `mongodb.page_faults`, `mongodb.lock.deadlock.count`, `mongodb.active.reads`, `mongodb.active.writes` | query samples (`$currentOp`), top queries (profiler or `getLog`) |

Each config lists further optional metrics in a comment; enable any of them the same way. The **Engine metrics** section of a database's Overview charts a curated set per engine, and the **Metrics** tab has everything.

Every batch carries `db.system.name`, `server.address`, `server.port`, `oneuptime.database.agent` and `oneuptime.agent.version`, plus `oneuptime.database.server.id` and `k8s.cluster.name` when their variables are set. The config deletes `service.name` so the data can never register a phantom Service, and it deliberately has **no** `resourcedetection` processor, so the machine the agent runs on never stands in for the database's identity.

### Optional — Ship the database's log file

Each config has a commented `filelog` receiver. Uncomment it, add it to the `logs` pipeline, and mount the engine's log directory at `/var/log/database` in `docker-compose.yml` (for example `- /var/log/postgresql:/var/log/database:ro`). The collector runs as a non-root user, so the files must be readable by it. The `resource` processor stamps the same identity, so the lines land on the database's **Logs** tab.

### Run as a systemd Service

```bash
sudo cp /opt/oneuptime-database-agent/systemd/oneuptime-database-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-database-agent
```

The unit assumes `/opt/oneuptime-database-agent` (the install script default). For a second database, copy it under a new name and change `WorkingDirectory`.

### Upgrading and uninstalling

Re-run `install.sh`: it reuses every value in your existing `.env` and downloads the current `docker-compose.yml` and config for your engine. To remove the agent, `cd /opt/oneuptime-database-agent && docker compose down`, then drop the monitoring user.

## Kubernetes

Databases running in a cluster with the OneUptime Kubernetes agent are [detected automatically](#from-kubernetes) with their pods, resource usage and logs. Engine metrics need the Database Agent next to them: run it as a small Deployment in the database's namespace.

The in-app **Documentation** tab of a detected database renders this manifest prefilled for that database. By hand:

1. Put the config for your engine in a ConfigMap and the secrets in a Secret:

```bash
curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DatabaseAgent/configs/postgresql.yaml -o config.yaml
kubectl -n prod create configmap oneuptime-database-agent --from-file=config.yaml=config.yaml
kubectl -n prod create secret generic oneuptime-database-agent \
  --from-literal=ONEUPTIME_TELEMETRY_INGESTION_KEY='YOUR_TELEMETRY_INGESTION_KEY' \
  --from-literal=DATABASE_PASSWORD='a-strong-password'
```

2. Apply the Deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-database-agent
  namespace: prod
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: oneuptime-database-agent
  template:
    metadata:
      labels:
        app.kubernetes.io/name: oneuptime-database-agent
    spec:
      containers:
        - name: otel-collector
          image: otel/opentelemetry-collector-contrib:0.161.0
          env:
            - name: ONEUPTIME_URL
              value: "YOUR_ONEUPTIME_URL"
            - name: ONEUPTIME_TELEMETRY_INGESTION_KEY
              valueFrom:
                secretKeyRef:
                  name: oneuptime-database-agent
                  key: ONEUPTIME_TELEMETRY_INGESTION_KEY
            - name: DATABASE_SYSTEM
              value: "postgresql"
            - name: DATABASE_ENDPOINT
              value: "postgres.prod.svc.cluster.local:5432"
            - name: DATABASE_SERVER_ADDRESS
              value: "postgres.prod.svc.cluster.local"
            - name: DATABASE_SERVER_PORT
              value: "5432"
            - name: DATABASE_USERNAME
              value: "oneuptime_monitor"
            - name: DATABASE_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: oneuptime-database-agent
                  key: DATABASE_PASSWORD
            - name: DATABASE_TLS_INSECURE
              value: "true"
            - name: DATABASE_TLS_INSECURE_SKIP_VERIFY
              value: "false"
            - name: DATABASE_COLLECTION_INTERVAL
              value: "30s"
            - name: DATABASE_QUERY_EVENTS
              value: "false"
            - name: DATABASE_SERVER_ID
              value: ""
            - name: KUBERNETES_CLUSTER_NAME
              value: "my-cluster"
          volumeMounts:
            - name: config
              mountPath: /etc/otelcol-contrib
              readOnly: true
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              memory: 320Mi
      volumes:
        - name: config
          configMap:
            name: oneuptime-database-agent
```

Three values decide whether the metrics land on the database OneUptime already detected:

- `DATABASE_SERVER_ADDRESS` — the Service's full name, `<service>.<namespace>.svc.cluster.local`. Point `DATABASE_ENDPOINT` at the same Service (or at one pod's headless name, `<pod>.<headless-service>.<namespace>.svc.cluster.local`, for per-member metrics).
- `KUBERNETES_CLUSTER_NAME` — exactly the `clusterName` you installed the Kubernetes agent with. A cluster-local name is only unique inside one cluster, so without it OneUptime will not create a database from it, and a different spelling registers a second cluster.
- Or `DATABASE_SERVER_ID` — the database's id from its **Documentation** tab. The data then joins that database directly, whatever the address.

The collector image mounts the ConfigMap at the path its default command already reads, so no `args` are needed. It is not detected as a database itself: collectors are recognised as infrastructure.

## Using your own OpenTelemetry Collector

If you already run collectors, add the receiver to one of them instead of running the agent. OneUptime recognises data from the collector-contrib `postgresql`, `mysql`, `sqlserver`, `oracledb`, `redis`, `mongodb`, `mongodbatlas`, `elasticsearch`, `memcached` and `couchdb` receivers, and from any resource that carries both `db.system.name` and `server.address` (for example a Prometheus exporter scrape you stamp yourself). Three rules:

1. **Every batch must name the server.** OneUptime reads `server.address` / `server.port`, then a `host:port` in `service.instance.id`, then `mysql.instance.endpoint`. Receivers that report none of them — Redis unless `resource_attributes.server.address` and `server.port` are enabled, Memcached, Elasticsearch, CouchDB — are ignored until you stamp `server.address` and `server.port` with a `resource` processor, as the agent configs do. One receiver instance per pipeline, or the stamp merges them.
2. **Keep `service.name` off the resource.** Data with a `service.name` is routed to that Service first. The Prometheus receiver always sets it (to the job name), so delete it in the `resource` processor.
3. **Name the server your applications use.** A loopback endpoint (`localhost:5432`) cannot identify a database, so a receiver pointed at `localhost` needs `server.address` stamped with the real name. Give database receivers their own pipeline, as the agent configs do, rather than sharing one with host metrics and the `resourcedetection` processor.

## Endpoints and the one-owner rule

An endpoint is a `host:port` a database answers on. A database's **Endpoints** tab lists them: the primary one (read-only) and any aliases. Everything that names an endpoint — a span, a `db.client.*` metric, a receiver batch — is attributed to the database that owns it, so endpoints are what tie traces, Kubernetes and engine metrics into one page.

- **One owner.** An endpoint belongs to at most one database in a project. Adding an alias another database already owns is refused with that database's name — remove it there first. This is also how you merge two databases that turned out to be one server: archive one, remove its endpoint, add it to the other.
- **Canonical forms.** Endpoints are stored lowercase with a port (the engine's default when none is given), IPv6 in brackets. Kubernetes names are expanded to `<service>.<namespace>.svc.cluster.local` and cluster-local names or private IPs get the cluster as a suffix — `postgres.prod.svc.cluster.local:5432@my-cluster` — whenever the cluster is known.
- **Local-only names never identify a database.** `localhost`, `127.0.0.1`, `::1`, `host.docker.internal` and friends point somewhere different for every caller — usually a sidecar proxy such as the Cloud SQL Auth Proxy or pgbouncer on localhost. Calls to them are not attributed to any database and they cannot be added as aliases.
- **Names that are only unique somewhere** — a bare `postgres`, a cluster-local name without its cluster, a private IP without its cluster — are recorded on the spans but never create a database or match an alias on their own. If such a name really is unique in your project, add it as an alias yourself and OneUptime honours it.
- **Engine-agnostic.** Endpoints carry no engine, so wire-compatible engines join: a CockroachDB or YugabyteDB cluster that applications reach with a PostgreSQL driver, or an OpenSearch cluster that clients report as Elasticsearch, still lands on its database.

A database's name defaults to the engine and its endpoint — `PostgreSQL db.internal:5432` — and can be renamed freely; the name is not the identity. That default makes label and owner rules by name easy: a name pattern of `^PostgreSQL` matches every PostgreSQL database.

## Lifecycle, archiving and retention

- **Last seen** is updated by every source. **Engine metrics** reads _Connected_ while collector data keeps arriving and _Not connected_ after 15 minutes without it.
- **Archive to dismiss.** Deleting a discovered database removes it only until a source sees it again — the next span or pod brings it back as a new database. To dismiss one for good, **archive** it: an archived database keeps its endpoints, so everything that matches them stays attached to the archived database instead of creating a new one.
- **Automatic archiving.** A discovered database nobody has touched (no labels, owners, incidents, alerts, scheduled maintenance, user-added endpoints or retention setting) that no source has seen for 7 days is archived automatically, and restored automatically if it is seen again. Databases you archived yourself, and databases you created, are never touched.
- **Retention.** The retention setting on a database's **Settings** tab applies to telemetry collected from the database itself by a collector or the agent — engine metrics, query events and its log file. Application traces follow the retention of the service that sent them, and container logs and metrics that of their cluster or host.

Databases can be attached to incidents, alerts and scheduled maintenance like any other resource, and appear on the Incidents, Alerts and Scheduled Maintenance tabs of their page.

## Self-hosted tuning

Self-hosted installations can tune discovery with these environment variables on the OneUptime app:

| Variable | Default | What it controls |
| --- | --- | --- |
| `DATABASE_SERVER_MIN_CALLS` | `10` | Calls an endpoint needs in one 10-minute window before traces create a database for it |
| `DATABASE_SERVER_AUTO_CREATE_BUDGET` | `500` | Discovered (non-manual, non-agent) databases a project can have before traces, Kubernetes and Docker stop creating new ones |
| `DATABASE_SERVER_AUTO_ARCHIVE_DAYS` | `7` | Days unseen before an untouched discovered database is archived |
| `DATABASE_SERVER_COLLECTOR_STALE_MINUTES` | `15` | Minutes without collector data before Engine metrics reads Not connected (minimum 10) |

## Troubleshooting

### Run the diagnostic script first

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DatabaseAgent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-database-agent
```

It checks the container, the identity in `.env`, TCP reachability of the database from the agent's own network, login, permission and TLS errors in the collector log, and the ingestion key. The key check matters: OneUptime's OTLP endpoints answer a bad key with a silent `200` (so a misconfigured collector cannot retry-flood the server), so the collector log looks clean while everything is dropped. The script calls `GET <url>/otlp/v1/validate`, which answers `200` or `401` for real.

### The agent runs but no database appears

- `DATABASE_SERVER_ADDRESS` is `localhost`, `127.0.0.1` or `host.docker.internal` — local-only addresses are ignored. Use the name your applications use.
- It is a cluster-local name (`*.svc.cluster.local`) without `KUBERNETES_CLUSTER_NAME` — set it, or set `DATABASE_SERVER_ID`.
- The ingestion key is wrong — run the diagnostic script.
- Your own collector sends receiver batches without `server.address` — **receiver batches that do not name their server are ignored**. Enable `resource_attributes.server.address` / `server.port` (Redis) or stamp both with a `resource` processor (Memcached, Elasticsearch, CouchDB).

### The collector cannot connect to the database

Inside the agent's container, `localhost` is the container itself. Use `host.docker.internal:<port>` (the compose file maps it to the machine on Linux too) with the database listening on the Docker bridge address as well — or uncomment `network_mode: host` in `docker-compose.yml` and use `localhost:<port>`. For remote servers check DNS, firewalls and the server's own allow-list (`pg_hba.conf`, `bind-address`, `bind`, `net.bindIp`).

### Login, permission or TLS errors in the collector log

- `password authentication failed`, `Access denied`, `WRONGPASS`, `Authentication failed`: check the credentials, and single-quote a password containing `$`, `#` or spaces in `.env`.
- Connections always `1`, `permission denied`, `NOPERM`, `not authorized`: the monitoring user is missing its grant — see [Create a monitoring user](#create-a-monitoring-user).
- `SSL is not enabled on the server`: set `DATABASE_TLS_INSECURE=true`. A server that requires TLS: `DATABASE_TLS_INSECURE=false`, plus `DATABASE_TLS_INSECURE_SKIP_VERIFY=true` for a certificate the image does not trust.
- `pg_stat_statements` errors: create the extension, or set `DATABASE_QUERY_EVENTS=false`.

### The metrics land on a Host, or a new Service appears

OneUptime attributes a batch to a database only when the batch names the database's server. A batch that does not is attributed by its other attributes — to the collector's Host when `resourcedetection` added `host.name`, or to a Service when it carries `service.name`. Stamp `server.address` / `server.port` (see [Using your own OpenTelemetry Collector](#using-your-own-opentelemetry-collector)), and delete `service.name` in the `resource` processor.

### Two databases for one server

The sources named it differently — an IP in one place and a DNS name in another, or two DNS names. Archive one, remove its endpoint, and add that endpoint as an alias on the other (see [Endpoints](#endpoints-and-the-one-owner-rule)). Pointing the agent at the database with `DATABASE_SERVER_ID` avoids the problem for engine metrics.

### A database my applications use was not created

It was probably outside the [create policy](#from-application-traces): an IP address, a local-only or single-label name, fewer than 10 calls in ten minutes, an engine that is never created from traces, or the project's auto-create budget. Create it by hand with the address your applications use — its **Queries from applications** section fills in from the spans already stored.

### A Kubernetes database was not detected

The cluster must be connected (the Kubernetes agent running). A pod that also runs an application container, an image OneUptime does not recognise, or a connection pooler is not a database. Create it by hand and add its Service names as endpoints.

### Queries from applications is empty

The spans are missing `db.system.name` / `db.system` or `server.address`, or they use an address that is not one of the database's endpoints — compare the **Endpoints** tab with the `server.address` on a span in the **Traces** explorer, and add the missing alias.

## Next steps

- Alert on engine health with [Metrics monitors](/docs/monitor/metrics-monitor) over the engine metrics, or connect a probe with the [Database Health Monitor](/docs/monitor/database-health-monitor) (PostgreSQL, MySQL, SQL Server) — no agent required.
- Instrument your applications with [OpenTelemetry](/docs/telemetry/open-telemetry) so their database calls fill the **Queries from applications** section.
