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

Engine metrics only ever come from a collector talking to the database itself (or, for a managed cloud database, to its provider's monitoring API). Traces and container inventories tell OneUptime that a database exists and how it is used, but not how it is doing inside — the **Engine metrics** status on each database says whether that part is connected.

You can also add a database by hand: **Databases → Create Database** with its engine, address and port.

This page covers the [supported databases](#supported-databases), how databases are detected, the Database Agent, Kubernetes, how endpoints tie the sources together, alerting and troubleshooting. For a probe-based health check that needs no agent at all, see the [Database Health Monitor](/docs/monitor/database-health-monitor).

## Supported databases

OneUptime knows the engines below by name: it normalises what instrumentations put in `db.system.name` (or the older `db.system`) to the value in the second column, shows the engine's name, applies its default port when a span or an address has none, recognises its container images and Helm charts, and knows where its engine metrics come from. An engine that is not listed still works everywhere a database is keyed by its address — it just shows under the raw name your spans report and is never created from traces on its own.

A **family** is the engine a fork or wire-compatible engine is reached through: client libraries cannot tell MariaDB from MySQL or Valkey from Redis, so a span says `mysql` or `redis` while a container image, a Helm chart or the Database Agent names the fork. Both land on the same database, and the database shows the more specific engine once any source names it.

**Created from traces** says whether client spans alone create a database of that engine (see [From application traces](#from-application-traces)): a managed service reached through its provider's shared API host, and an engine that runs inside your application's process, never are. **Engine metrics** says where the engine's own health metrics come from: a Database Agent config, a collector-contrib receiver you add to your own collector, the engine's own Prometheus endpoint (`:port/path`, scraped with the collector's `prometheus` receiver), the cloud provider's monitoring API, or nothing built in. Each database's **Documentation** tab turns that into a ready-to-use collector config for that database.

| Engine | `db.system.name` | Default port | Family | Created from traces | Engine metrics |
| --- | --- | --- | --- | --- | --- |
| Actian Ingres | `actian.ingres` | — | — | Yes | None built in |
| Actian Zen (Pervasive PSQL) | `pervasive` | 1583 | — | Yes | None built in |
| Aerospike | `aerospike` | 3000 | — | Yes | `aerospike` receiver |
| Amazon DocumentDB | `aws.documentdb` | 27017 | MongoDB | Yes | `awsfirehose` receiver (cloud monitoring) |
| Amazon DynamoDB | `aws.dynamodb` | 443 | — | No (cloud API) | `awsfirehose` receiver (cloud monitoring) |
| Amazon Neptune | `aws.neptune` | 8182 | — | Yes | `awsfirehose` receiver (cloud monitoring) |
| Amazon Redshift | `aws.redshift` | 5439 | PostgreSQL | Yes | `awsfirehose` receiver (cloud monitoring) |
| Apache Derby | `derby` | 1527 | — | No (in-process) | None (in-process) |
| Apache Doris | `doris` | 9030 | MySQL | Yes | Prometheus, `:8030/metrics` |
| Apache Druid | `druid` | 8888 | — | Yes | None built in |
| Apache Geode | `geode` | 10334 | — | Yes | None built in |
| Apache HBase | `hbase` | — | — | Yes | None built in |
| Apache Hive | `hive` | 10000 | — | Yes | None built in |
| Apache Ignite | `ignite` | 10800 | — | Yes | None built in |
| Apache Impala | `impala` | 21050 | — | Yes | None built in |
| Apache Pinot | `pinot` | 8099 | — | Yes | None built in |
| Apache Solr | `solr` | 8983 | — | Yes | None built in |
| ArangoDB | `arangodb` | 8529 | — | Yes | Prometheus, `:8529/_admin/metrics/v2` |
| Azure Cosmos DB | `azure.cosmosdb` | 443 | — | No (cloud API) | `azure_monitor` receiver (cloud monitoring) |
| Cassandra | `cassandra` | 9042 | — | Yes | None built in |
| Chroma | `chroma` | 8000 | — | Yes | None built in |
| Claris FileMaker | `filemaker` | 2399 | — | Yes | None built in |
| ClickHouse | `clickhouse` | 9000 | — | Yes | Prometheus, `:9363/metrics` |
| Cloud Bigtable | `gcp.bigtable` | 443 | — | No (cloud API) | `googlecloudmonitoring` receiver (cloud monitoring) |
| Cloud Firestore | `gcp.firestore` | 443 | — | No (cloud API) | `googlecloudmonitoring` receiver (cloud monitoring) |
| Cloud Spanner | `gcp.spanner` | 443 | — | No (cloud API) | `google_cloud_spanner` receiver |
| CockroachDB | `cockroachdb` | 26257 | PostgreSQL | Yes | Prometheus, `:8080/_status/vars` |
| Couchbase | `couchbase` | 11210 | — | Yes | Prometheus, `:8091/metrics` |
| CouchDB | `couchdb` | 5984 | — | Yes | `couchdb` receiver |
| Databricks | `databricks` | 443 | — | Yes | None built in |
| Dragonfly | `dragonfly` | 6379 | Redis | Yes | Database Agent (`redis` receiver) |
| DuckDB | `duckdb` | — | — | No (in-process) | None (in-process) |
| Elasticsearch | `elasticsearch` | 9200 | — | Yes | Database Agent (`elasticsearch` receiver) |
| etcd | `etcd` | 2379 | — | Yes | Prometheus, `:2379/metrics` |
| FerretDB | `ferretdb` | 27017 | MongoDB | Yes | Prometheus, `:8088/debug/metrics` |
| Firebird | `firebirdsql` | 3050 | — | Yes | None built in |
| FoundationDB | `foundationdb` | 4500 | — | Yes | None built in |
| Google BigQuery | `bigquery` | 443 | — | No (cloud API) | `googlecloudmonitoring` receiver (cloud monitoring) |
| Greenplum | `greenplum` | 5432 | PostgreSQL | Yes | None built in |
| H2 | `h2database` | 9092 | — | No (in-process) | None (in-process) |
| Hazelcast | `hazelcast` | 5701 | — | Yes | None built in |
| HyperSQL | `hsqldb` | 9001 | — | No (in-process) | None (in-process) |
| IBM Db2 | `ibm.db2` | 50000 | — | Yes | None built in |
| IBM Informix | `ibm.informix` | 9088 | — | Yes | None built in |
| IBM Netezza | `ibm.netezza` | 5480 | — | Yes | None built in |
| InfluxDB | `influxdb` | 8086 | — | Yes | Prometheus, `:8086/metrics` |
| InstantDB | `instantdb` | — | — | No (in-process) | None (in-process) |
| InterBase | `interbase` | 3050 | Firebird | Yes | None built in |
| InterSystems IRIS / Caché | `intersystems.cache` | 1972 | — | Yes | Prometheus, `:52773/api/monitor/metrics` |
| KeyDB | `keydb` | 6379 | Redis | Yes | Database Agent (`redis` receiver) |
| MariaDB | `mariadb` | 3306 | MySQL | Yes | Database Agent (`mysql` receiver) |
| Meilisearch | `meilisearch` | 7700 | — | Yes | Prometheus, `:7700/metrics` |
| Memcached | `memcached` | 11211 | — | Yes | Database Agent (`memcached` receiver) |
| Milvus | `milvus` | 19530 | — | Yes | Prometheus, `:9091/metrics` |
| MongoDB | `mongodb` | 27017 | — | Yes | Database Agent (`mongodb` receiver) |
| MySQL | `mysql` | 3306 | — | Yes | Database Agent (`mysql` receiver) |
| Neo4j | `neo4j` | 7687 | — | Yes | Prometheus, `:2004/metrics` |
| OceanBase | `oceanbase` | 2881 | MySQL | Yes | None built in |
| OpenSearch | `opensearch` | 9200 | Elasticsearch | Yes | Database Agent (`elasticsearch` receiver) |
| Oracle | `oracle.db` | 1521 | — | Yes | Database Agent (`oracledb` receiver) |
| Pinecone | `pinecone` | 443 | — | No (cloud API) | None built in |
| PostgreSQL | `postgresql` | 5432 | — | Yes | Database Agent (`postgresql` receiver) |
| Presto | `presto` | 8080 | — | Yes | None built in |
| Progress OpenEdge | `progress` | — | — | Yes | None built in |
| Qdrant | `qdrant` | 6333 | — | Yes | Prometheus, `:6333/metrics` |
| QuestDB | `questdb` | 8812 | PostgreSQL | Yes | Prometheus, `:9003/metrics` |
| RavenDB | `ravendb` | 8080 | — | Yes | None built in |
| Redis | `redis` | 6379 | — | Yes | Database Agent (`redis` receiver) |
| Riak KV | `riak` | 8087 | — | Yes | `riak` receiver |
| SAP ASE (Sybase) | `sybase` | 5000 | — | Yes | None built in |
| SAP HANA | `sap.hana` | 30015 | — | Yes | `saphana` receiver |
| SAP MaxDB | `sap.maxdb` | 7210 | — | Yes | None built in |
| ScyllaDB | `scylladb` | 9042 | Cassandra | Yes | Prometheus, `:9180/metrics` |
| SingleStore | `singlestore` | 3306 | MySQL | Yes | Prometheus, `:9104/metrics` |
| Snowflake | `snowflake` | 443 | — | Yes | `snowflake` receiver |
| Software AG Adabas | `softwareag.adabas` | — | — | Yes | None built in |
| SQL Server | `microsoft.sql_server` | 1433 | — | Yes | Database Agent (`sqlserver` receiver) |
| SQLite | `sqlite` | — | — | No (in-process) | None (in-process) |
| StarRocks | `starrocks` | 9030 | MySQL | Yes | Prometheus, `:8030/metrics` |
| SurrealDB | `surrealdb` | 8000 | — | Yes | None built in |
| Teradata | `teradata` | 1025 | — | Yes | None built in |
| TiDB | `tidb` | 4000 | MySQL | Yes | Prometheus, `:10080/metrics` |
| Trino | `trino` | 8080 | — | Yes | Prometheus, `:8080/metrics` |
| Typesense | `typesense` | 8108 | — | Yes | None built in |
| Valkey | `valkey` | 6379 | Redis | Yes | Database Agent (`redis` receiver) |
| Vertica | `vertica` | 5433 | — | Yes | None built in |
| Vitess | `vitess` | 3306 | MySQL | Yes | Prometheus, `:15000/metrics` |
| Weaviate | `weaviate` | 8080 | — | Yes | Prometheus, `:2112/metrics` |
| YugabyteDB | `yugabytedb` | 5433 | PostgreSQL | Yes | Prometheus, `:9000/prometheus-metrics` |

The usual other spellings are accepted too: `postgres` and `pg`, `mssql` and `sqlserver`, `oracle`, `mongo`, `scylla`, `dragonflydb`, `memsql`, and every legacy `db.system` value OpenTelemetry has used (`db2`, `hanadb`, `cosmosdb`, `dynamodb`, `spanner`, `redshift`, `informix`, `maxdb`, `cache`, `h2`, `firebird`, `edb`, `cloudscape`, …). A managed service that speaks an engine's protocol — Amazon RDS and Aurora, Azure Database, Cloud SQL, AlloyDB, Neon, Supabase, PlanetScale, ElastiCache, Memorystore, MongoDB Atlas — is that engine.

## How databases are detected

Each database remembers the source that created it (the **Discovery source** column); later sources add to the same database rather than creating another one, as long as they describe the same endpoint.

### From application traces

Every 10 minutes OneUptime summarises the CLIENT spans your applications sent in the last 15 minutes that carry `db.system.name` (or the older `db.system`). The server comes from `server.address` (or the older `net.peer.name`, then `network.peer.address` / `net.sock.peer.addr`) and the port from `server.port` (or `net.peer.port`, `network.peer.port`, `net.sock.peer.port`); when the span has no port, the engine's default port is assumed. Engine names are normalised (see [Supported databases](#supported-databases)), so `postgres`, `pg` and `postgresql` are one engine, as are `mssql` and `microsoft.sql_server`; `mariadb` and `mysql` are two engines of one family.

A database is **created** from traces only when all of these hold — anything else still counts towards a database that already exists, it just never creates one:

- the address is a real, project-wide name: a DNS name, not an IP literal and not a name that only resolves locally (see [Endpoints](#endpoints-and-the-one-owner-rule));
- the engine is one OneUptime knows, with an address of its own — the **Created from traces** column of [Supported databases](#supported-databases). Cloud APIs whose host every customer shares (DynamoDB, BigQuery, Spanner, Firestore, Bigtable, Cosmos DB, Pinecone), engines that run inside your application (SQLite, DuckDB, H2, HyperSQL, Derby) and engines OneUptime does not know are never created from traces — add them by hand;
- the endpoint received at least 10 calls in the 15-minute window a run looks at, so a one-off script does not create a database;
- the project is under its auto-create budget (500 discovered databases by default).

Every database CLIENT span is also tagged with its endpoint when it is ingested, so once a database owns an endpoint, the **Queries from applications** section and the **Traces** tab show every call to it — including calls made before the database was created. `db.client.*` metrics (for example `db.client.operation.duration`) that carry a `server.address` are tagged the same way.

### From Kubernetes

Every 5 minutes OneUptime looks at the pods of each connected Kubernetes cluster and recognises database workloads:

1. **Operator and chart labels first**: CloudNativePG, Zalando (Spilo), Crunchy PGO, Bitnami charts, ECK, Altinity ClickHouse, cass-operator, Percona and the Oracle MySQL operator. One operator cluster becomes one database.
2. **Container images otherwise**, by exact image name — the official, Bitnami (including the relocated `bitnamilegacy` and `bitnamisecure` repositories) and Red Hat / OpenShift images of every engine in [Supported databases](#supported-databases) that ships one (`postgres`, `bitnami/postgresql`, `rhel9/postgresql-16`, `mysql`, `mariadb`, `mssql/server`, `gvenzl/oracle-free`, `redis`, `valkey/valkey`, `mongo`, `cockroachdb/cockroach`, `pingcap/tidb`, `clickhouse/clickhouse-server`, `qdrant/qdrant`, …). A fork is recognised as itself: a `mariadb` image is MariaDB, a `valkey/valkey` image is Valkey. Exporters, operators, admin UIs, connection poolers (pgbouncer, pgpool, ProxySQL, HAProxy, Cloud SQL Proxy) and backup tools are not databases. A pod that also runs an application container is not treated as a database either — an app with a database sidecar is still the app.

Pods are grouped by their StatefulSet, Deployment or operator cluster, so a three-member StatefulSet is one database with three members. Each database gets endpoints for its Services, qualified by the cluster — `postgres.prod.svc.cluster.local:5432@my-cluster` — so the same name in two clusters stays two databases. (When the project has exactly one cluster, the unqualified `postgres.prod.svc.cluster.local:5432` is added too.) Applications whose telemetry goes through the Kubernetes agent carry their namespace and cluster, so their calls to `postgres` (from the same namespace), `postgres.prod.svc` or the full name are matched to it. A two-part name such as `postgres.prod` is not expanded — use the full name in connection strings you want matched, or add `postgres.prod:5432` as an endpoint on the detected database.

OneUptime reads pod metadata, labels and images only — never environment variables or secrets.

### From Docker and Podman

Every 5 minutes the containers of each connected Docker or Podman host are classified by image the same way. A container is one database, and Compose replicas (`db-1`, `db-2`) are one database with several members. Container names only resolve inside one Docker network, so these databases get **no** endpoints automatically; their page shows the container's own metrics and logs. To join the queries your applications send, add the address they use on the [Endpoints](#endpoints-and-the-one-owner-rule) tab.

### From the Database Agent or your own collector

When engine metrics or logs arrive from a collector database receiver, OneUptime matches them to a database the moment they are ingested — by the endpoint the data names (`server.address` / `server.port`), or directly by id when the data carries `oneuptime.database.server.id` (the agent's `DATABASE_SERVER_ID`):

- an endpoint a database already owns attaches the data to that database, whatever created it;
- data linked by id attaches to that database and shows on its pages whatever its address — a private IP, a cluster-local name, or no address at all;
- otherwise a database is **created**, but only from a name that means one server project-wide — a DNS name or a public IP. A private IP, a single-label name (`db`) or a cluster-local Kubernetes name (`postgres.prod.svc.cluster.local`) can mean a different server in every network, so data naming one only joins a database that already has it as an endpoint. Create that database by hand (**Databases → Create Database**, same address and port) or link the agent to it with `DATABASE_SERVER_ID`;
- a receiver batch that names no server at all is ignored (see [Using your own OpenTelemetry Collector](#using-your-own-opentelemetry-collector)).

Databases created this way do not count towards the auto-create budget: an agent is an explicit request to monitor that server. See [The Database Agent](#the-database-agent).

## The Database Agent

The OneUptime Database Agent is a pre-configured OpenTelemetry Collector for **PostgreSQL**, **MySQL / MariaDB**, **SQL Server**, **Oracle**, **Redis / Valkey / KeyDB / Dragonfly**, **MongoDB**, **Elasticsearch / OpenSearch** and **Memcached**. It is config-only: a stock `otel/opentelemetry-collector-contrib` container running the collector's native receiver for your engine, with a config that stamps every batch with the database's identity and ships it to OneUptime over OTLP. Nothing is installed on the database server. For the other engines in [Supported databases](#supported-databases), see [Using your own OpenTelemetry Collector](#using-your-own-opentelemetry-collector) — each database's **Documentation** tab has the config.

**One agent monitors one database server.** The identity is stamped on everything the agent sends, so run one agent — one install directory — per server, and one per replica if you want replicas on their own pages.

The agent lives in the [DatabaseAgent directory](https://github.com/OneUptime/oneuptime/tree/master/agents/DatabaseAgent): `docker-compose.yml`, one collector config per receiver (`configs/postgresql.yaml`, `configs/mysql.yaml`, `configs/sqlserver.yaml`, `configs/oracledb.yaml`, `configs/redis.yaml`, `configs/mongodb.yaml`, `configs/elasticsearch.yaml`, `configs/memcached.yaml`), `install.sh`, `troubleshoot.sh` and a systemd unit. A fork or drop-in runs its family's config and reports its own name: `DATABASE_SYSTEM=mariadb` runs `configs/mysql.yaml` and the database shows as MariaDB.

### Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the database's port (or a Kubernetes cluster — see [Kubernetes](#kubernetes))
- A monitoring user on the database with the grants below
- A **OneUptime Telemetry Ingestion Key** — create one from _Project Settings → Telemetry & APM → Ingestion Keys_

### Create a monitoring user

Give the agent its own login with read access to the engine's statistics — never an administrator and never an application's login. If you already created a monitoring user for the [Database Health Monitor](/docs/monitor/database-health-monitor#create-a-monitoring-user), its PostgreSQL, MySQL and SQL Server grants cover the agent as well.

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

Explain plans on top queries need `SELECT` on the tables the queries touch, which `pg_monitor` does not grant — give it per schema (`GRANT SELECT ON ALL TABLES IN SCHEMA app TO oneuptime_monitor`) if you want plans. Without it top queries still arrive with empty plans, and the collector logs `failed to explain` for each one; the diagnostic script reports that as a warning, not as a missing grant.

On a managed service where `pg_monitor` is unavailable, `pg_read_all_stats` covers the same views. The agent already skips the internal databases of Amazon RDS, Azure, Cloud SQL and AlloyDB that no customer login can open.

#### MySQL / MariaDB

```sql
CREATE USER 'oneuptime_monitor'@'%' IDENTIFIED BY 'a-strong-password';
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'oneuptime_monitor'@'%';
GRANT SELECT ON performance_schema.* TO 'oneuptime_monitor'@'%';
```

`PROCESS` and `REPLICATION CLIENT` cover the global status counters, InnoDB status and replica status; `performance_schema` (on by default since MySQL 5.6) is read for query samples and top queries. MariaDB 10.5.9 and later split replica status into its own privilege, so also run `GRANT SLAVE MONITOR ON *.* TO 'oneuptime_monitor'@'%';` there. Set `DATABASE_SYSTEM=mariadb` for a MariaDB server: the same config monitors it, and the database shows as MariaDB.

#### SQL Server

```sql
CREATE LOGIN oneuptime_monitor WITH PASSWORD = 'a-strong-password';
GRANT VIEW SERVER STATE TO oneuptime_monitor;
GRANT VIEW ANY DEFINITION TO oneuptime_monitor;
```

`VIEW SERVER STATE` (on SQL Server 2022 and later `VIEW SERVER PERFORMANCE STATE` is enough) reads the dynamic management views every metric comes from, and grants no access to your data. The receiver builds a connection string from the password, so it must not contain a semicolon. The driver negotiates encryption with the server itself, so the TLS variables do not apply.

#### Oracle

```sql
-- In the pluggable database the agent connects to, e.g. ALTER SESSION SET CONTAINER = FREEPDB1;
CREATE USER oneuptime_monitor IDENTIFIED BY "a-strong-password";
GRANT CREATE SESSION TO oneuptime_monitor;
GRANT SELECT_CATALOG_ROLE TO oneuptime_monitor;
```

`SELECT_CATALOG_ROLE` reads the `V$` and `DBA_` views the metrics, query samples and top queries come from, and grants no access to your tables. `DATABASE_ORACLE_SERVICE` names the service the agent connects to (`FREEPDB1`, `ORCLPDB1`, …).

#### Redis / Valkey / KeyDB / Dragonfly

```text
ACL SETUSER oneuptime_monitor on >a-strong-password -@all +info +ping
```

The receiver only runs `INFO`. Persist the user with `ACL SAVE` (or a `user` line in `redis.conf` / your ACL file). On a server protected only by `requirepass`, leave `DATABASE_USERNAME` empty and set `DATABASE_PASSWORD`; on a server without authentication leave both empty. Set `DATABASE_SYSTEM` to `valkey`, `keydb` or `dragonfly` for those servers.

#### MongoDB

```js
db.getSiblingDB("admin").createUser({
  user: "oneuptime_monitor",
  pwd: "a-strong-password",
  roles: [{ role: "clusterMonitor", db: "admin" }],
});
```

`clusterMonitor` covers every metric. Explain plans on top queries additionally need `{ role: "read", db: "<database>" }` for each monitored database; without it top queries still arrive, with empty plans. The agent connects to exactly one member (`direct_connection`), so run one agent per replica-set member.

#### Elasticsearch / OpenSearch

```text
POST /_security/role/oneuptime_monitor
{ "cluster": ["monitor"], "indices": [{ "names": ["*"], "privileges": ["monitor"] }] }

POST /_security/user/oneuptime_monitor
{ "password": "a-strong-password", "roles": ["oneuptime_monitor"] }
```

The `monitor` privileges read node, cluster and index statistics and no documents. On OpenSearch with the security plugin, grant the cluster permission `cluster_monitor` and the index permission `indices_monitor` on `*` instead; on a cluster without security, leave `DATABASE_USERNAME` and `DATABASE_PASSWORD` empty. One agent monitors the whole cluster through one endpoint, a URL (`http://search.internal:9200`, or `https://` for TLS). Set `DATABASE_SYSTEM=opensearch` for an OpenSearch cluster.

#### Memcached

Memcached has no users: the receiver runs `stats` over the text protocol, so leave `DATABASE_USERNAME` and `DATABASE_PASSWORD` empty. A server started with SASL authentication (`-S`) cannot be monitored this way.

### Quick Start (Install Script)

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DatabaseAgent/install.sh -o install.sh
bash install.sh
```

The script asks for your OneUptime URL and ingestion key, the engine, the endpoint to connect to and the monitoring credentials (the password is read without echo). It downloads `docker-compose.yml` and the matching `configs/<receiver>.yaml` (saved as `otel-collector-config.yaml`) to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file and starts the agent. When the endpoint only means something on this machine (`localhost`, `host.docker.internal`) it also asks for the host name your applications use, because that name is the database's identity; when that name is a private IP, a single-label or a cluster-local name, it asks for the id of the database in OneUptime (`DATABASE_SERVER_ID`), because such a name never creates one on its own.

Every prompt can be answered with an exported variable of the same name, and `INSTALL_DIR` picks the directory — for example `INSTALL_DIR=/opt/oneuptime-database-agent-orders bash install.sh` for a second database. Re-running the script reuses every value in your existing `.env` (see [Upgrading and uninstalling](#upgrading-and-uninstalling)).

Any character is fine in the password. The collector expands `$` inside the values it reads once more — `$$` becomes `$` and `${NAME}` becomes another variable — so the script writes every `$` in `DATABASE_USERNAME` and `DATABASE_PASSWORD` doubled, on top of quoting the values for Docker Compose.

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
DATABASE_ENDPOINT_HOST=db.internal
DATABASE_ENDPOINT_PORT=5432
DATABASE_ORACLE_SERVICE=
DATABASE_SERVER_ADDRESS=db.internal
DATABASE_SERVER_PORT=5432
DATABASE_USERNAME=oneuptime_monitor
DATABASE_PASSWORD='a-strong-password'
DATABASE_TLS_INSECURE=true
DATABASE_TLS_INSECURE_SKIP_VERIFY=false
DATABASE_COLLECTION_INTERVAL=30s
DATABASE_QUERY_EVENTS=false
DATABASE_SERVER_ID=
```

Single-quote the password, and write every `$` in it as `$$`. Start it:

```bash
docker compose up -d
```

After the first collection the database appears under **Databases** — or, if OneUptime had already detected it from traces or containers at the same address, its **Engine metrics** status turns to Connected. For a private IP or a name that only resolves inside your network, create the database first or set `DATABASE_SERVER_ID` (see [From the Database Agent or your own collector](#from-the-database-agent-or-your-own-collector)).

### Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (for example `https://oneuptime.com` or your self-hosted host) |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key from _Project Settings → Telemetry & APM → Ingestion Keys_ |
| `DATABASE_SYSTEM` | Yes | The engine, stamped as `db.system.name`: `postgresql`, `mysql`, `mariadb`, `redis`, `valkey`, `keydb`, `dragonfly`, `mongodb`, `microsoft.sql_server`, `oracle.db`, `elasticsearch`, `opensearch` or `memcached`. `install.sh` accepts the usual spellings and downloads the matching config |
| `DATABASE_ENDPOINT` | Yes | `host:port` the agent connects to. Use `host.docker.internal:<port>` when the agent runs on the database machine (see [Troubleshooting](#troubleshooting) if that is refused). For Elasticsearch / OpenSearch a URL: `http://host:9200`, or `https://` for TLS |
| `DATABASE_ENDPOINT_HOST` | SQL Server | `DATABASE_ENDPOINT`'s host on its own — the SQL Server receiver takes host and port apart. `install.sh` writes it |
| `DATABASE_ENDPOINT_PORT` | SQL Server | `DATABASE_ENDPOINT`'s port on its own. `install.sh` writes it |
| `DATABASE_ORACLE_SERVICE` | Oracle | The Oracle service to connect to, for example `FREEPDB1` or `ORCLPDB1` |
| `DATABASE_SERVER_ADDRESS` | Yes | The database's identity, stamped as `server.address`: the host name your **applications** use to reach it. Never `localhost` — OneUptime ignores addresses that only mean something on one machine. A private IP, single-label or cluster-local name only joins a database that already has it as an endpoint. Keep it stable; changing it registers a second database |
| `DATABASE_SERVER_PORT` | Yes | The port your applications use, stamped as `server.port` |
| `DATABASE_USERNAME` | PostgreSQL, MySQL, SQL Server, Oracle | The monitoring user. Optional for Redis, MongoDB and Elasticsearch servers without authentication; unused for Memcached |
| `DATABASE_PASSWORD` | PostgreSQL, SQL Server, Oracle | Its password. In `.env`, single-quote it and write every `$` as `$$` (`install.sh` does both for you) |
| `DATABASE_TLS_INSECURE` | No | `true` (default) connects without TLS; `false` turns TLS on |
| `DATABASE_TLS_INSECURE_SKIP_VERIFY` | No | `true` accepts a certificate the collector image does not trust (self-signed, private CA). Defaults to `false` |
| `DATABASE_COLLECTION_INTERVAL` | No | How often the engine's statistics are read. Defaults to `30s` |
| `DATABASE_QUERY_EVENTS` | No | `true` ships query samples and top queries as logs (PostgreSQL, MySQL, MongoDB, SQL Server and Oracle). They contain query text. Defaults to `false` |
| `DATABASE_SERVER_ID` | No | The id of a database OneUptime already shows (its **Documentation** tab has it, prefilled). The data then joins that database directly and shows on its pages, whatever its address — the way to go in Kubernetes and for private IPs. It must be a database in the project the ingestion key belongs to |

### What Gets Collected

| Engine | Receiver | Also enabled by the agent (off upstream) | Query events |
| --- | --- | --- | --- |
| PostgreSQL | `postgresql` — connections vs `max_connections`, commits and rollbacks, block reads, database and table sizes, row operations, replication and WAL lag, checkpoints, vacuums | `postgresql.blks_hit` / `postgresql.blks_read` (cache hit ratio), `postgresql.deadlocks`, `postgresql.temp_files`, `postgresql.tup_*` (row throughput), `postgresql.database.locks` | query samples (`pg_stat_activity`), top queries (`pg_stat_statements`) |
| MySQL / MariaDB | `mysql` — threads and connections, buffer pool usage and reads, row and table locks, handlers, row operations, uptime | `mysql.query.count`, `mysql.query.slow.count`, `mysql.commands`, `mysql.connection.count`, `mysql.connection.errors`, `mysql.max_used_connections`, `mysql.replica.time_behind_source`, `mysql.client.network.io` | query samples, top queries (`performance_schema`) |
| SQL Server | `sqlserver` — user connections, batch requests, compilations, buffer cache hit ratio, page life expectancy, lock waits | `sqlserver.deadlock.rate`, `sqlserver.processes.blocked`, `sqlserver.memory.grants.pending.count`, `sqlserver.cpu.utilization`, `sqlserver.database.io`, `sqlserver.database.latency`, `sqlserver.availability_group.database_replica.secondary_lag` | query samples, top queries (dynamic management views) |
| Oracle | `oracledb` — sessions, processes, executions, commits and rollbacks, parses, logical and physical reads, CPU time, PGA, tablespace sizes | `oracledb.db.time`, `oracledb.tablespace.utilization`, `oracledb.sga.usage`, `oracledb.sga.limit` | query samples, top queries (`V$SESSION`, `V$SQL`) |
| Redis / Valkey / KeyDB / Dragonfly | `redis` — clients, commands per second, keyspace hits and misses, memory, evictions, expirations, replication offset, uptime | `redis.maxmemory`, `redis.role`, `redis.replication.replica_offset`, `redis.cmd.latency` | — |
| MongoDB | `mongodb` — connections, operations and their time, cache operations, memory, data, storage and index sizes, cursors, sessions | `mongodb.health`, `mongodb.uptime`, `mongodb.operation.latency.time`, `mongodb.page_faults`, `mongodb.lock.deadlock.count`, `mongodb.active.reads`, `mongodb.active.writes` | query samples (`$currentOp`), top queries (profiler or `getLog`) |
| Elasticsearch / OpenSearch | `elasticsearch` — cluster health, shards and pending tasks, per-node documents, operations and their time, thread pools, caches, disk, JVM heap and GC, per-index sizes and operations | `jvm.memory.heap.utilization`, `elasticsearch.process.cpu.usage`, `elasticsearch.node.operations.current` | — |
| Memcached | `memcached` — connections, commands, hits and misses, evictions, items, bytes, network, threads, CPU (all on by default) | — | — |

Each config lists further optional metrics in a comment; enable any of them the same way. The **Engine metrics** section of a database's Overview charts a curated set per engine, and the **Metrics** tab has everything.

Every batch carries `db.system.name` (from `DATABASE_SYSTEM`), `server.address`, `server.port`, `oneuptime.database.agent` and `oneuptime.agent.version`, plus `oneuptime.database.server.id` when `DATABASE_SERVER_ID` is set. The config deletes `service.name` so the data can never register a phantom Service, the SQL Server and Oracle configs switch off their receivers' `host.name` (the database machine's name), and no config has a `resourcedetection` processor, so no machine ever stands in for the database's identity.

### Optional — Ship the database's log file

The PostgreSQL, MySQL, Redis and MongoDB configs have a commented `filelog` receiver. Uncomment it, add it to the `logs` pipeline, and mount the engine's log directory at `/var/log/database` in `docker-compose.yml` (for example `- /var/log/postgresql:/var/log/database:ro`). The collector runs as a non-root user, so the files must be readable by it. The `resource` processor stamps the same identity, so the lines land on the database's **Logs** tab.

### Run as a systemd Service

```bash
sudo cp /opt/oneuptime-database-agent/systemd/oneuptime-database-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-database-agent
```

The unit assumes `/opt/oneuptime-database-agent` (the install script default). For a second database, copy it under a new name and change `WorkingDirectory`.

### Upgrading and uninstalling

Re-run `install.sh`: it reuses every value in your existing `.env` and replaces `docker-compose.yml`, `otel-collector-config.yaml` and the systemd unit with the current versions. A file you had edited — `network_mode: host`, a `filelog` receiver and its mount, extra metrics — is kept next to the new one as `<file>.bak.<timestamp>`, and the script lists it at the end so you can re-apply the edit. To remove the agent, `cd /opt/oneuptime-database-agent && docker compose down`, then drop the monitoring user.

## Kubernetes

Databases running in a cluster with the OneUptime Kubernetes agent are [detected automatically](#from-kubernetes) with their pods, resource usage and logs. Engine metrics need the Database Agent next to them: run it as a small Deployment in the database's namespace, linked to the detected database by its id.

The in-app **Documentation** tab of a detected database renders this manifest prefilled for that database — namespace, engine, address and id. By hand:

1. Put the config for your engine in a ConfigMap and the secrets in a Secret (write every `$` in the password as `$$` — the collector expands it):

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
            - name: DATABASE_ENDPOINT_HOST
              value: "postgres.prod.svc.cluster.local"
            - name: DATABASE_ENDPOINT_PORT
              value: "5432"
            - name: DATABASE_ORACLE_SERVICE
              value: ""
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
              value: "YOUR_DATABASE_ID"
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

Two values tie the metrics to the database OneUptime already detected:

- `DATABASE_SERVER_ID` — the database's id from its **Documentation** tab. A cluster-local name is only unique inside one cluster, so it never creates a database on its own; the id attaches the data to the detected database directly, and it shows on that database's pages even when the project has several clusters. Without it the data joins only a database that already has the plain `<service>.<namespace>.svc.cluster.local:<port>` as an endpoint, which OneUptime adds automatically only while the project has exactly one cluster.
- `DATABASE_SERVER_ADDRESS` — the Service's full name, `<service>.<namespace>.svc.cluster.local`, with `DATABASE_ENDPOINT` pointing at the same Service. For per-member metrics run one agent per member with both set to that pod's headless name (`<pod>.<headless-service>.<namespace>.svc.cluster.local`) and the same `DATABASE_SERVER_ID`: the members' series then stay apart by `server.address`.

The agent never stamps `k8s.cluster.name`. OneUptime reads that attribute as the Kubernetes agent's own heartbeat, so the Database Agent would keep the cluster looking connected — or register a new cluster on a typo.

The collector image mounts the ConfigMap at the path its default command already reads, so no `args` are needed. It is not detected as a database itself: collectors are recognised as infrastructure.

## Using your own OpenTelemetry Collector

If you already run collectors, add the receiver to one of them instead of running the agent. OneUptime recognises data from the collector-contrib `postgresql`, `mysql`, `sqlserver`, `oracledb`, `redis`, `mongodb`, `mongodbatlas`, `elasticsearch`, `memcached`, `couchdb`, `riak`, `saphana`, `snowflake`, `aerospike` and `googlecloudspanner` receivers (current collectors configure the Atlas and Spanner ones as `mongodb_atlas` and `google_cloud_spanner`), and from any resource that carries both `db.system.name` and `server.address` (for example a Prometheus scrape of the engine's own metrics endpoint that you stamp yourself). The **Documentation** tab of each database renders the complete collector config for its engine — receiver or Prometheus scrape, identity stamp, exporter and pipeline. Three rules:

1. **Every batch must name the server.** OneUptime reads `server.address` / `server.port`, then a `host:port` in `service.instance.id`, then `mysql.instance.endpoint`, then `mongodb_atlas.host.name` / `mongodb_atlas.process.port`; values that identify nothing (`unknown`, a container id, the pod's own name) count as missing. Receivers that report none of them — Redis unless `resource_attributes.server.address` and `server.port` are enabled, Memcached, Elasticsearch, CouchDB, SAP HANA, Snowflake, Riak, Aerospike and Cloud Spanner — are ignored until you stamp `server.address` and `server.port` with a `resource` processor, as the agent configs do (or stamp `oneuptime.database.server.id`). One receiver instance per pipeline, or the stamp merges them. A receiver pointed at a fork reports its family — the `mysql` receiver says `mysql` for MariaDB, the `redis` receiver `redis` for Valkey — so stamp `db.system.name` with the fork's name to see it as itself.
2. **Keep `service.name` off the resource.** Data with a `service.name` is routed to that Service first. The Prometheus receiver always sets it (to the job name), so delete it — and `service.instance.id`, the scrape target — in the `resource` processor.
3. **Name the server your applications use.** A loopback endpoint (`localhost:5432`) names no server. OneUptime falls back to the collector machine's `host.name` only for a collector running directly on a VM or bare-metal host (the `resourcedetection` `system` detector reports `os.type`, and nothing marks it as a container, a pod or a serverless task); anywhere else the batch is ignored. Stamping `server.address` with the name applications use is more reliable either way, and it is what joins engine metrics to application traces. Give database receivers their own pipeline, as the agent configs do, rather than sharing one with host metrics.

To attach a receiver to a database OneUptime already shows, whatever its address, also stamp `oneuptime.database.server.id` with that database's id (its **Documentation** tab has it). Values the collector reads from the environment are expanded once more, so write every `$` in a password as `$$`.

## Endpoints and the one-owner rule

An endpoint is a `host:port` a database answers on. A database's **Endpoints** tab lists them: the primary one (read-only) and any aliases. Everything that names an endpoint — a span, a `db.client.*` metric, a receiver batch — is attributed to the database that owns it, so endpoints are what tie traces, Kubernetes and engine metrics into one page.

- **One owner.** An endpoint belongs to at most one database in a project. Adding an alias another database already owns is refused with that database's name — remove it there first. This is also how you merge two databases that turned out to be one server: archive one, remove its endpoint, add it to the other.
- **Canonical forms.** Endpoints are stored lowercase with a port (the engine's default when none is given), IPv6 in brackets. Kubernetes names are expanded to `<service>.<namespace>.svc.cluster.local` and cluster-local names or private IPs get the cluster as a suffix — `postgres.prod.svc.cluster.local:5432@my-cluster` — whenever the cluster is known.
- **Local-only names never identify a database.** `localhost`, `127.0.0.1`, `::1`, `host.docker.internal` and friends point somewhere different for every caller — usually a sidecar proxy such as the Cloud SQL Auth Proxy or pgbouncer on localhost. Calls to them are not attributed to any database and they cannot be added as aliases.
- **Names that are only unique somewhere** — a bare `postgres`, a cluster-local name without its cluster, a private IP without its cluster — are recorded on spans and receiver data but never create a database. They attach only to a database that already has exactly that endpoint: one you created with that address, or one you added it to as an alias because the name really is unique in your project.
- **Calls from Kubernetes carry their cluster.** An application whose telemetry goes through the Kubernetes agent reports its cluster, so its calls to a cluster-local name or a private IP are recorded with the cluster attached. When you add such an endpoint by hand, add it in that form — `postgres.prod.svc.cluster.local:5432@my-cluster`, with the cluster name your Kubernetes agent was installed with — or those calls will not match it.
- **Engine-agnostic.** Endpoints carry no engine, so wire-compatible engines join: a CockroachDB or YugabyteDB cluster that applications reach with a PostgreSQL driver, a MariaDB server they reach with a MySQL driver, or an OpenSearch cluster that clients report as Elasticsearch, still lands on its database — which shows the specific engine once an image, a chart or the agent names it.

A database's name defaults to the engine and its endpoint — `PostgreSQL db.internal:5432` — and can be renamed freely; the name is not the identity. That default makes label and owner rules by name easy: a name pattern of `^PostgreSQL` matches every PostgreSQL database, and `^MariaDB` every MariaDB one.

## Alerts on a database

Engine metrics, query events and the engine's log file carry `oneuptime.database.server.id`, the database's id (its **Documentation** tab shows it). A **Metrics** monitor over an engine metric that filters on that attribute — or groups by it, to watch many databases with one monitor — attaches its alerts and incidents to the database: they appear on its **Alerts** and **Incidents** tabs, and its scheduled maintenance applies to them.

Threshold gauges — connections against their limit, memory, replication lag, cache hit ratio, blocked sessions — or a ratio of two gauges. A cumulative counter (queries, slow queries, deadlocks, connection errors) only ever grows, so a threshold on its raw value fires forever once crossed; alert on its rate instead. For a probe that checks a database without any agent, see the [Database Health Monitor](/docs/monitor/database-health-monitor).

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
| `DATABASE_SERVER_MIN_CALLS` | `10` | Calls an endpoint needs within the 15-minute window each 10-minute run looks at before traces create a database for it |
| `DATABASE_SERVER_AUTO_CREATE_BUDGET` | `500` | Discovered (non-manual, non-agent) databases a project can have before traces, Kubernetes and Docker stop creating new ones |
| `DATABASE_SERVER_AUTO_ARCHIVE_DAYS` | `7` | Days unseen before an untouched discovered database is archived |
| `DATABASE_SERVER_COLLECTOR_STALE_MINUTES` | `15` | Minutes without collector data before Engine metrics reads Not connected (minimum 10) |

## Troubleshooting

### Run the diagnostic script first

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DatabaseAgent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-database-agent
```

It checks the container, the identity in `.env`, TCP reachability of the database from the agent's own network, login, permission and TLS errors in the collector log, and the ingestion key. The key check matters: OneUptime's OTLP endpoints answer a bad key with a silent `200` (so a misconfigured collector cannot retry-flood the server), so the collector log looks clean while everything is dropped. The script calls `GET <url>/otlp/v1/validate`, which answers `200` or `401` for real. It runs its probes from a pinned curl image and hands it the key on stdin, never on a command line.

### The agent runs but no database appears

- `DATABASE_SERVER_ADDRESS` is `localhost`, `127.0.0.1` or `host.docker.internal` — local-only addresses are ignored. Use the name your applications use.
- It is a private IP, a single-label name or a cluster-local name (`*.svc.cluster.local`) — such names never create a database on their own. Create the database by hand with that address and port, or set `DATABASE_SERVER_ID`.
- `DATABASE_SERVER_ID` is not the id of a database in the project the ingestion key belongs to.
- The ingestion key is wrong — run the diagnostic script.
- Your own collector sends receiver batches without `server.address` — **receiver batches that do not name their server are ignored**. Enable `resource_attributes.server.address` / `server.port` (Redis) or stamp both with a `resource` processor (Memcached, Elasticsearch, CouchDB, SAP HANA, Snowflake, Riak, Aerospike, Cloud Spanner).

### The collector cannot connect to the database

Inside the agent's container, `localhost` is the container itself. Use `host.docker.internal:<port>` (the compose file maps it to the machine on Linux too) with the database listening on the Docker bridge address as well — or uncomment `network_mode: host` in `docker-compose.yml` and use `localhost:<port>`. For remote servers check DNS, firewalls and the server's own allow-list (`pg_hba.conf`, `bind-address`, `bind`, `net.bindIp`).

### Login, permission or TLS errors in the collector log

- `password authentication failed`, `Access denied`, `Login failed for user`, `ORA-01017`, `WRONGPASS`, `Authentication failed`: check the credentials. The collector expands `$` inside them once more, so every `$` must be written as `$$` in `.env` or a Kubernetes Secret (`install.sh` does this; a `.env` written by an older `install.sh` did not — re-run it). Quote a password containing `#`, spaces or quotes in `.env`.
- Connections always `1`, `permission denied`, `NOPERM`, `not authorized`, `VIEW SERVER STATE`, `ORA-00942`: the monitoring user is missing its grant — see [Create a monitoring user](#create-a-monitoring-user).
- `failed to explain` on PostgreSQL top queries is not a missing grant: explain plans need `SELECT` on your tables, which `pg_monitor` deliberately does not give. Metrics and top queries are unaffected; only the plans stay empty.
- `SSL is not enabled on the server`: set `DATABASE_TLS_INSECURE=true`. A server that requires TLS: `DATABASE_TLS_INSECURE=false`, plus `DATABASE_TLS_INSECURE_SKIP_VERIFY=true` for a certificate the image does not trust. For Elasticsearch / OpenSearch the `http://` or `https://` of `DATABASE_ENDPOINT` decides it.
- `pg_stat_statements` errors: create the extension, or set `DATABASE_QUERY_EVENTS=false`.

### The metrics land on a Host, or a new Service appears

OneUptime attributes a batch to a database only when the batch names the database's server. A batch that does not is attributed by its other attributes — to the collector's Host when `resourcedetection` added `host.name`, or to a Service when it carries `service.name`. Stamp `server.address` / `server.port` (see [Using your own OpenTelemetry Collector](#using-your-own-opentelemetry-collector)), and delete `service.name` in the `resource` processor.

A database receiver's data belongs to the database even when the receiver shares a collector — and a pipeline — with host or Kubernetes metrics: each receiver emits its own resource, so a PostgreSQL receiver added to a host-metrics or Kubernetes agent pipeline is attributed to its database, not to the Host or the cluster. The database's retention applies to it (set it on the database's **Settings** tab), and its rows carry `oneuptime.database.server.id` rather than `oneuptime.host.id`: a monitor that grouped such metrics by `oneuptime.host.id` should filter or group by `oneuptime.database.server.id` instead.

### Two databases for one server

The sources named it differently — an IP in one place and a DNS name in another, two DNS names, or a two-part Kubernetes name (`postgres.prod`) next to the detected `postgres.prod.svc.cluster.local`. Archive one, remove its endpoint, and add that endpoint as an alias on the other (see [Endpoints](#endpoints-and-the-one-owner-rule)). Pointing the agent at the database with `DATABASE_SERVER_ID` avoids the problem for engine metrics.

### A database my applications use was not created

It was probably outside the [create policy](#from-application-traces): an IP address, a local-only or single-label name, fewer than 10 calls in the last 15 minutes, an engine that is never created from traces (a shared cloud API, an in-process engine, or one OneUptime does not know), or the project's auto-create budget. Create it by hand with the address your applications use — its **Queries from applications** section fills in from the spans already stored.

### A Kubernetes database was not detected

The cluster must be connected (the Kubernetes agent running). A pod that also runs an application container, an image OneUptime does not recognise, or a connection pooler is not a database. Create it by hand and add its Service names as endpoints with the cluster attached (`postgres.prod.svc.cluster.local:5432@my-cluster`), so calls from applications in the cluster match.

### Queries from applications is empty

The spans are missing `db.system.name` / `db.system` or `server.address`, or they use an address that is not one of the database's endpoints — compare the **Endpoints** tab with the `server.address` on a span in the **Traces** explorer, and add the missing alias.

## Next steps

- Alert on engine health with [Metrics monitors](/docs/monitor/metrics-monitor) over the engine metrics, filtered on `oneuptime.database.server.id` (see [Alerts on a database](#alerts-on-a-database)), or connect a probe with the [Database Health Monitor](/docs/monitor/database-health-monitor) (PostgreSQL, MySQL, SQL Server) — no agent required.
- Instrument your applications with [OpenTelemetry](/docs/telemetry/open-telemetry) so their database calls fill the **Queries from applications** section.
