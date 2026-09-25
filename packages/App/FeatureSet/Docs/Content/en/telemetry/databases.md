# Databases

## Overview

**Databases** (_Resources → Databases_ in the dashboard) gives every database server your project runs or talks to its own page: what is calling it and how fast, where it runs, the engine's own health metrics, its logs and traces, the incidents, alerts and scheduled maintenance attached to it, and the alert monitors recommended for its engine. Databases have labels, owners, label and owner rules, per-database retention and archiving, like every other resource.

Most databases appear on their own. OneUptime assembles each one from up to four sources, and each source contributes something different:

| Source | What it needs from you | What it adds to the database's page |
| --- | --- | --- |
| **Application traces** | Instrumented applications (OpenTelemetry) | Queries from applications: call rate, errors, latency, and the services calling it |
| **Kubernetes** | The [OneUptime Kubernetes agent](/docs/telemetry/kubernetes-agent) | Where it runs: pods, CPU and memory, and the pods' logs |
| **Docker / Podman** | The [Docker agent](/docs/telemetry/docker-host) or [Podman agent](/docs/telemetry/podman-host) | Where it runs: the containers, their CPU and memory, and their logs |
| **Database Agent** (an OpenTelemetry Collector) | The [Database Agent](#the-database-agent) or your own collector | **Engine metrics** — connections, throughput, cache hit ratio, locks, replication lag, memory, as far as the engine has them (see [What Gets Collected](#what-gets-collected)) — plus optional query samples, top queries and the engine's log file |

Engine metrics only ever come from a collector talking to the database itself (or, for a managed cloud database, to its provider's monitoring API). Traces and container inventories tell OneUptime that a database exists and how it is used, but not how it is doing inside — the **Engine metrics** status on each database says whether that part is connected.

You can also add a database by hand: **Databases → Create Database** with its engine, address and port.

This page covers the [supported databases](#supported-databases), [how databases are detected](#how-databases-are-detected), the Database Agent, Kubernetes, how [endpoints](#endpoints-and-the-one-owner-rule) tie the sources together, [alerting](#alerts-on-a-database), the [lifecycle](#lifecycle-archiving-and-retention) of a discovered database and troubleshooting. For a probe-based health check that needs no agent at all, see the [Database Health Monitor](/docs/monitor/database-health-monitor).

## Supported databases

OneUptime knows the engines below by name: it normalises what instrumentations put in `db.system.name` (or the older `db.system`) to the value in the second column, shows the engine's name, applies its default port when a span or an address has none, recognises its container images and Helm charts, and knows where its engine metrics come from. An engine that is not listed still works everywhere a database is keyed by its address — it just shows under the raw name your spans report and is never created from traces on its own.

A **family** is the engine a fork or wire-compatible engine is reached through: client libraries cannot tell MariaDB from MySQL or Valkey from Redis, so a span says `mysql` or `redis` while a container image, a Helm chart or the Database Agent names the fork. Both land on the same database, and the database shows the more specific engine once its container image, or a source at least as strong as the one behind its current engine, names it (see [Which engine a database shows](#which-engine-a-database-shows)).

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

Each database remembers the source that created it (the **Discovery source** column), and the first item on its **Feed** says what found it: the Kubernetes workload and its cluster, the Docker or Podman container — or Compose or Swarm service — and its host, the endpoint applications called, or the Database Agent (with its version) or collector that reported it. Later sources add to the same database rather than creating another one, as long as they describe the same endpoint (see [Endpoints](#endpoints-and-the-one-owner-rule)).

### From application traces

Every 10 minutes OneUptime summarises the CLIENT spans your applications sent in the last 15 minutes that carry `db.system.name` (or the older `db.system`). The server comes from `server.address` (or the older `net.peer.name`, then `network.peer.address` / `net.sock.peer.addr`) and the port from `server.port` (or `net.peer.port`, `network.peer.port`, `net.sock.peer.port`); when the span has no port, the engine's default port is assumed. Engine names are normalised (see [Supported databases](#supported-databases)), so `postgres`, `pg` and `postgresql` are one engine, as are `mssql` and `microsoft.sql_server`; `mariadb` and `mysql` are two engines of one family.

A database is **created** from traces only when all of these hold — anything else still counts towards a database that already exists, it just never creates one:

- the address names one server project-wide: a DNS name — not an IP literal, and not a name that only resolves on one machine or inside one network unless the caller's Kubernetes cluster qualifies it (see [Endpoints](#endpoints-and-the-one-owner-rule));
- the engine is one OneUptime knows, with an address of its own — the **Created from traces** column of [Supported databases](#supported-databases). Cloud APIs whose host every customer shares (DynamoDB, BigQuery, Spanner, Firestore, Bigtable, Cosmos DB, Pinecone), engines that run inside your application (SQLite, DuckDB, H2, HyperSQL, Derby) and engines OneUptime does not know are never created from traces — add them by hand;
- the endpoint received at least 10 queries in the 15-minute window a run looks at, so a one-off script does not create a database. A client library's connection-management spans (`pg.connect` and `pg-pool.connect` from node-postgres, `redis-connect`, `connect`, …) are not queries: they count neither here nor in a database's **Queries**;
- the project is under its [auto-create budget](#the-auto-create-budget).

Every database CLIENT span is also tagged with its endpoint when it is ingested, so once a database owns an endpoint, the **Queries from applications** section and the **Traces** tab show every call to it — including calls made before the database was created. `db.client.*` metrics (for example `db.client.operation.duration`) that carry a `server.address` are tagged the same way.

**Clusters and host lists.** A connection string that lists several hosts (`m1:27017,m2:27017,m3:27017`) is one database, whatever order a client lists them in. MongoDB Atlas members (`cluster0-shard-00-01.ab1cd.mongodb.net`) become one database named after their cluster (`cluster0.ab1cd.mongodb.net`), and every member seen becomes one of its endpoints. Drivers that report each member of a Cassandra ring, a Redis Cluster, an Elasticsearch cluster or ElastiCache nodes on its own still produce one database per member: nothing in those host names says which cluster they belong to. Keep one and [merge](#endpoints-and-the-one-owner-rule) the others into it.

### From Kubernetes

Every 5 minutes OneUptime looks at the pods of each connected Kubernetes cluster and recognises database workloads:

1. **Operator and chart labels first**: CloudNativePG, Zalando (Spilo), Crunchy PGO, Bitnami charts, ECK, Altinity ClickHouse, cass-operator, Percona, the Oracle MySQL operator and the Vitess operator (its `vtgate` pods are the database; `vttablet`, `vtctld`, `vtorc` and `vtbackup` are parts of it, not members). One operator cluster becomes one database. The Vitess cluster's own vtgate Service has a hashed name, so add it on the database's **Endpoints** tab if applications connect through it.
2. **Container images otherwise**, by exact image name — the official, Bitnami (including the relocated `bitnamilegacy` and `bitnamisecure` repositories) and Red Hat / OpenShift images of every engine in [Supported databases](#supported-databases) that ships one (`postgres`, `bitnami/postgresql`, `rhel9/postgresql-16`, `mysql`, `mariadb`, `mssql/server`, `gvenzl/oracle-free`, `redis`, `valkey/valkey`, `mongo`, `cockroachdb/cockroach`, `pingcap/tidb`, `clickhouse/clickhouse-server`, `qdrant/qdrant`, …). A fork is recognised as itself: a `mariadb` image is MariaDB, a `valkey/valkey` image is Valkey. Exporters, operators, admin UIs, connection poolers (pgbouncer, pgpool, ProxySQL, HAProxy, Cloud SQL Proxy) and backup tools are not databases. A pod that also runs an application container is not treated as a database either — an app with a database sidecar is still the app — though a StatefulSet whose database container declares the engine's default port may carry one extra container OneUptime does not recognise (a log shipper, say).

A database image does not make a pod a database server, but only positive evidence makes it anything else. A container whose program is a client or dump tool (`psql`, `redis-cli`, `mongosh`, `pg_dump`, `mysql`), a keep-alive (`sleep infinity`, `tail -f /dev/null`) or an interactive shell — or whose `sh -c` script runs nothing but such tools, shell builtins and plain utilities (`echo`, `cp`) — is a client or debug run, not a database; so is a Redis or Valkey Sentinel (`redis-sentinel`, `redis-server --sentinel`). That holds behind a launcher too: `env` (with its `NAME=value` settings), `nohup`, `setsid`, `tini`, `dumb-init` and an image's `docker-entrypoint.sh` are looked through to the program they start, and so are `exec`, `env` and `nohup` inside a script, so `env PGPASSWORD=… psql` and `tini -- redis-cli` are client runs while `tini -- docker-entrypoint.sh postgres` is the server — and so is `docker-entrypoint.sh -c max_connections=200`, the image's own server started with a flag. A script that goes on to start anything else (`sleep 5 && exec redis-server`, `bash -ecx 'exec cockroach start …'`), a script file (`sh /start.sh`), a wrapper that takes arguments of its own before the program (`gosu postgres …`, `timeout 30 …`) or a script too long to read counts as a possible server. Finished pods, batch jobs and one-off `kubectl run` pods that declare no port are not databases either.

A database appears once one of its pods has been Ready for about 10 minutes (when only a sidecar keeps the pod from turning Ready, a ready database container counts instead). A crash-looping pod turns Ready afresh on every restart, so it never becomes a database, and neither does a CI job or a pod that crashed after a minute. Once created, a database is refreshed on every run.

Pods are grouped by their StatefulSet, Deployment or operator cluster, so a three-member StatefulSet is one database with three members. **Instances** on its page counts the pods whose database container is running — not one waiting in `CrashLoopBackOff` or `ImagePullBackOff`, or one that has terminated, although Kubernetes may still report such a pod as Running; a workload scaled to zero shows 0 and keeps its page until [automatic archiving](#lifecycle-archiving-and-retention) retires it. The way back works too: the workload's StatefulSet or Deployment page, and each of its pods' pages, name the database it runs with an **Open database** link — a StatefulSet or Deployment named otherwise than its database (Bitnami's `shop-redis-master` for `shop-redis`, Percona's `cluster1-pxc` for `cluster1`) included, while a pooler or backup workload an operator labels as part of a cluster says it is part of that database's cluster.

The Kubernetes agent does not report Service objects, so a database's Service names come from the conventions charts and operators follow: the owning StatefulSet or Deployment name, the StatefulSet's headless Service (and each member behind it, `<pod>.<headless-service>`), and the proxy and pooler Services of the operators — Percona XtraDB Cluster's HAProxy and ProxySQL, Percona Server for MySQL's router and HAProxy, Percona Server for MongoDB's mongos, Crunchy's pgBouncer, and the Zalando and CloudNativePG poolers. Each becomes an endpoint qualified by the cluster — `postgres.prod.svc.cluster.local:5432@my-cluster` — so the same name in two clusters stays two databases. While the project has exactly one cluster the unqualified `postgres.prod.svc.cluster.local:5432` is added too, and released again about 2 hours after a second cluster appears. Add a Service with any other name on the database's **Endpoints** tab.

Applications whose telemetry goes through the Kubernetes agent carry their namespace and cluster, so their calls are read the way their pod's resolver reads them: `postgres` (from the same namespace), `postgres.prod` (the Service `postgres` in namespace `prod`), `postgres.prod.svc` and the full name are all matched to the database, and so is `mongo-0.mongo-headless`, a StatefulSet member in the caller's own namespace.

OneUptime reads pod metadata, labels, images, declared ports and what a container's command line runs — the program's name, a shell's flags and which well-known client, keep-alive and shell commands its script runs (any other command is only noted as unrecognised) — never environment variables, argument values, script text or secrets.

### From Docker and Podman

Every 5 minutes the containers of each connected Docker or Podman host are classified by image the same way, then grouped and filtered by their names and their Compose, Swarm and Testcontainers labels — never by the command they run (see below). Containers of one Compose service (by the Compose project and service labels) or one Swarm service are one database with several members, and its workload is that service (`Compose service/<project>-<service>`, `Swarm service/<service>`). Any other container is its own database under its exact name (`Container/<name>`), so `redis-6379` and `redis-6380` stay two. Testcontainers, `docker compose run` one-offs, containers the kubelet runs on a Docker node (Kubernetes discovery finds those as pods) and containers that run for less than 10 minutes never become databases. A container's age is its uptime, so one that has already run that long becomes a database on the first run after the agent is installed. **Instances** counts the running containers, and each container's page links back to its database (**Open database**). A host registered twice under the same name is read once, through the registration seen most recently.

The agent sends those labels with each container's metrics, once its `otel-collector-config.yaml` copies them (`container_labels_to_metric_labels`). An older Docker or Podman agent does not: update it, or every container is a database of its own, Testcontainers runs and one-offs included.

Unlike in Kubernetes, a container's command line is never read — the agents do not send it, since it can carry secrets — so a long-running client or debug container of a database image (`sleep infinity`, a `psql` or `redis-cli` loop) becomes a database once it has run for 10 minutes. Archive it to dismiss it: a database a person archived stays archived. Left alone, it is [archived automatically](#lifecycle-archiving-and-retention) 7 days after the container stops.

Container names only resolve inside one Docker network, so these databases get **no** endpoints automatically; their page shows the containers' own metrics and logs. To join the queries your applications send, add the address they use on the [Endpoints](#endpoints-and-the-one-owner-rule) tab.

For engine metrics, install the [Database Agent](#the-database-agent) from the database's own **Documentation** tab: its install command and `.env` carry `DATABASE_SERVER_ID`, prefilled, so the agent's data joins this database. An agent installed without it is matched by its `DATABASE_SERVER_ADDRESS` instead, which a container database does not own: a DNS name registers the server as a second database — one page with the containers, another with the engine metrics (see [Two databases for one server](#two-databases-for-one-server)) — and a private IP or a container name attaches to nothing.

### From the Database Agent or your own collector

When engine metrics or logs arrive from a collector database receiver, OneUptime matches them to a database the moment they are ingested — directly by id when the data carries `oneuptime.database.server.id` (the agent's `DATABASE_SERVER_ID`), otherwise by the endpoint the data names (`server.address` / `server.port`):

- data linked by id attaches to that database and shows on its pages — and only there — whatever address it reports: a private IP, a cluster-local name, an address another database owns, or none at all. An address it reports that names one server project-wide and belongs to no database yet is added to the database as an endpoint, so application traces to that address land there too;
- otherwise, an endpoint a database already owns attaches the data to that database, whatever created it;
- otherwise a database is **created**, but only from a name that means one server project-wide — a DNS name, a public IP, or a cluster-local, `.internal` or `.local` name the data qualifies with its Kubernetes cluster (`k8s.cluster.name`, which the Database Agent never stamps) — and only for an engine that may be created on its own (the **Created from traces** column of [Supported databases](#supported-databases): never a shared cloud API, an in-process engine or an unknown one). Private and link-local IPs, single-label names (`db`) and unqualified cluster-local (`postgres.prod.svc.cluster.local`), `.internal` or `.local` names can mean a different server in every network; a pod IP changes with every restart; and a single-label name the collector's own namespace completed may be a Service or the collector's own pod. Data naming one of those only joins a database that already has it as an endpoint — the Kubernetes-detected workload, for its Service names. Create that database by hand (**Databases → Create Database**, same address and port) or link the agent to it with `DATABASE_SERVER_ID`. In a project with a Kubernetes cluster, a cluster-local Service name is refused without its cluster: create the database as `postgres.prod.svc.cluster.local:5432@my-cluster`, then add the unqualified `postgres.prod.svc.cluster.local:5432` — what the agent reports — on its **Endpoints** tab;
- a receiver batch that names no server at all is ignored (see [Using your own OpenTelemetry Collector](#using-your-own-opentelemetry-collector)).

Databases a collector creates count towards the [auto-create budget](#the-auto-create-budget) like every other discovered database; a database you created by hand and linked with `DATABASE_SERVER_ID` never needs a create. See [The Database Agent](#the-database-agent).

### Which engine a database shows

When sources disagree about a database's engine, the stronger evidence wins: an engine a person set, then a collector or the Database Agent (the engine reporting on itself), then a container image or Helm chart, then client spans — a PostgreSQL driver reports `postgresql` even when it talks to CockroachDB. A source moves a database to another engine family only when its evidence is stronger than what named the current engine, and an engine a person set is never changed by discovery. Within a family, a fork refines the engine when the source naming it is at least as strong as the one that named the current engine, or is a container image: a span says `redis`, the image says `valkey`, and the database shows Valkey — even where a collector's `redis` receiver said `redis`, since it cannot tell the two apart. Application traces alone never refine an engine an image or a collector determined: a client names the protocol it speaks, and MariaDB Connector/J reports `mariadb` to a MySQL server. A collector names the fork when it stamps it in `db.system.name` (the Database Agent does, from `DATABASE_SYSTEM`), or when the batch's `db.system.version` names it: a version string that carries the fork's name (`8.0.11-TiDB-v7.5.1`), or a major version only the fork has released — MySQL has no 10.x or 11.x, so `mysql` with `11.4.13`, the bare number the `mysql` receiver reports for MariaDB 11.4, is MariaDB (see [Using your own OpenTelemetry Collector](#using-your-own-opentelemetry-collector)). A fork is undone only by a container image naming its family engine, and only when no more than application traces named the fork — a collector or a trace naming the family never undoes one. A Kubernetes workload whose image moves to a fork of the same family (`redis` to `valkey`) stays the same database.

### The auto-create budget

Traces, Kubernetes, Docker, Podman and collectors create databases on their own only while the project holds fewer than 500 live, non-archived discovered databases (`DATABASE_SERVER_AUTO_CREATE_BUDGET`, see [Self-hosted tuning](#self-hosted-tuning)). Databases you create by hand never count and are never blocked; archived databases do not count, so [automatic archiving](#lifecycle-archiving-and-retention) frees budget; and databases that already exist keep being matched and updated. Once the budget is reached, collector data for a new endpoint creates nothing — it only joins databases that already exist — and OneUptime logs a warning at most once every 10 minutes per project.

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

`PROCESS` and `REPLICATION CLIENT` cover the global status counters, InnoDB status and replica status; `performance_schema` (on by default since MySQL 5.6) is read for query samples and top queries. MariaDB 10.5.9 and later split replica status into its own privilege, so also run `GRANT SLAVE MONITOR ON *.* TO 'oneuptime_monitor'@'%';` there. Set `DATABASE_SYSTEM=mariadb` for a MariaDB server: the same config monitors it, and the database shows as MariaDB. That is the reliable way. An agent installed as `mysql` against MariaDB 10 or later ends up there too, by its version number (`11.4.13` — MySQL never released a 10.x or 11.x), but a MariaDB 5.5 stays MySQL.

#### SQL Server

```sql
CREATE LOGIN oneuptime_monitor WITH PASSWORD = 'a-strong-password';
GRANT VIEW SERVER STATE TO oneuptime_monitor;
GRANT VIEW ANY DEFINITION TO oneuptime_monitor;
```

`VIEW SERVER STATE` (on SQL Server 2022 and later `VIEW SERVER PERFORMANCE STATE` is enough) reads the dynamic management views every metric comes from, and grants no access to your data. The receiver puts the login into a connection string without quoting it, so the user name and password must not contain a semicolon (`;`) or a double quote (`"`), nor start or end with a space — `install.sh` refuses them. The driver negotiates encryption with the server itself, so the TLS variables do not apply.

For a named instance (`sql1.corp\INST01`), point `DATABASE_ENDPOINT` at the instance's own TCP port — never the default instance's 1433, which reaches the default instance instead. SQL Server Configuration Manager shows it (the instance's TCP/IP protocol, IPAll), or run `SELECT local_tcp_port FROM sys.dm_exec_connections WHERE session_id = @@SPID;` on the instance. `install.sh` refuses `host\instance` and asks for `host:port`.

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

The receiver only runs `INFO`. Persist the user with `ACL SAVE` (or a `user` line in `redis.conf` / your ACL file). On a server protected only by `requirepass`, leave `DATABASE_USERNAME` empty and set `DATABASE_PASSWORD`; on a server without authentication leave both empty. Set `DATABASE_SYSTEM` to `valkey`, `keydb` or `dragonfly` for those servers. The receiver reads the version from `INFO`'s `redis_version`, which Valkey keeps at `7.2.4` (the Redis release it forked from) and Dragonfly sets to the Redis version it emulates. OneUptime ignores it for them, so a Valkey or Dragonfly database shows the version of its container image when Kubernetes, Docker or Podman runs it, and none under the agent alone.

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

The script asks for your OneUptime URL and ingestion key, the engine, the endpoint to connect to and the monitoring credentials (the password is read without echo). It downloads `docker-compose.yml` and the matching `configs/<receiver>.yaml` (saved as `otel-collector-config.yaml`) to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file and starts the agent. When the endpoint only means something on this machine (`localhost`, `host.docker.internal`) it also asks for the host name your applications use, because that name is the database's identity; when that name only resolves inside one network — a private or link-local IP, a single-label name, a cluster-local, `.internal` or `.local` name — it asks for the id of the database in OneUptime (`DATABASE_SERVER_ID`), because such a name never creates one on its own.

Every prompt can be answered with an exported variable of the same name, and `INSTALL_DIR` picks the directory — for example `INSTALL_DIR=/opt/oneuptime-database-agent-orders bash install.sh` for a second database. Re-running the script reuses every value in your existing `.env` (see [Upgrading and uninstalling](#upgrading-and-uninstalling)).

Any character is fine in the password, apart from the few SQL Server's connection string cannot carry (see [SQL Server](#sql-server)). The collector expands `$` inside the values it reads once more — `$$` becomes `$` and `${NAME}` becomes another variable — so the script writes every `$` in `DATABASE_USERNAME` and `DATABASE_PASSWORD` doubled, on top of quoting the values for Docker Compose.

### Alternative — Docker Compose

Download `docker-compose.yml` and the config for your engine from the [DatabaseAgent directory](https://github.com/OneUptime/oneuptime/tree/master/agents/DatabaseAgent) into one folder, saving the config as `otel-collector-config.yaml`:

```bash
curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DatabaseAgent/docker-compose.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DatabaseAgent/configs/postgresql.yaml -o otel-collector-config.yaml
```

Create a `.env` file next to them (`chmod 600 .env` — it holds a password):

```bash
# DATABASE_USERNAME and DATABASE_PASSWORD are escaped for the collector: every $ is written as $$.
ONEUPTIME_URL=YOUR_ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=YOUR_TELEMETRY_INGESTION_KEY
DATABASE_SYSTEM=postgresql
DATABASE_ENDPOINT=db.example.com:5432
DATABASE_ENDPOINT_HOST=db.example.com
DATABASE_ENDPOINT_PORT=5432
DATABASE_ORACLE_SERVICE=
DATABASE_SERVER_ADDRESS=db.example.com
DATABASE_SERVER_PORT=5432
DATABASE_USERNAME=oneuptime_monitor
DATABASE_PASSWORD='a-strong-password'
DATABASE_TLS_INSECURE=true
DATABASE_TLS_INSECURE_SKIP_VERIFY=false
DATABASE_COLLECTION_INTERVAL=30s
DATABASE_QUERY_EVENTS=false
DATABASE_SERVER_ID=
```

Single-quote the password, and write every `$` in it as `$$`. The first line says so, in the words of the `.env` `install.sh` writes — and `install.sh`, re-run on this folder (`INSTALL_DIR`), reads the file the same way. Start it:

```bash
docker compose up -d
```

After the first collection the database appears under **Databases** — or, if OneUptime had already detected it from traces or containers at the same address, its **Engine metrics** status turns to Connected. For a private IP or a name that only resolves inside your network (`db.prod.internal`, a cluster-local name), create the database first or set `DATABASE_SERVER_ID` (see [From the Database Agent or your own collector](#from-the-database-agent-or-your-own-collector)).

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
| `DATABASE_SERVER_ADDRESS` | Yes | The database's identity, stamped as `server.address`: the host name your **applications** use to reach it. Never `localhost` — OneUptime ignores addresses that only mean something on one machine. A name that only resolves inside one network — a private IP, a single-label name, a cluster-local, `.internal` or `.local` name — only joins a database that already has it as an endpoint. Keep it stable; changing it registers a second database |
| `DATABASE_SERVER_PORT` | Yes | The port your applications use, stamped as `server.port` |
| `DATABASE_USERNAME` | PostgreSQL, MySQL, SQL Server, Oracle | The monitoring user. Optional for Redis, MongoDB and Elasticsearch servers without authentication; unused for Memcached |
| `DATABASE_PASSWORD` | PostgreSQL, SQL Server, Oracle | Its password. In `.env`, single-quote it and write every `$` as `$$` (`install.sh` does both for you) |
| `DATABASE_TLS_INSECURE` | No | `true` (default) connects without TLS; `false` turns TLS on |
| `DATABASE_TLS_INSECURE_SKIP_VERIFY` | No | `true` accepts a certificate the collector image does not trust (self-signed, private CA). Defaults to `false` |
| `DATABASE_COLLECTION_INTERVAL` | No | How often the engine's statistics are read. Defaults to `30s` |
| `DATABASE_QUERY_EVENTS` | No | `true` ships query samples and top queries as logs (PostgreSQL, MySQL, MongoDB, SQL Server and Oracle). They contain query text. Defaults to `false` |
| `DATABASE_SERVER_ID` | No | The id of a database OneUptime already shows (its **Documentation** tab has it, prefilled). The data then joins that database directly and shows on its pages, whatever address it reports (or none) — the way to go in Kubernetes and for private IPs. It must be a database in the project the ingestion key belongs to |

### What Gets Collected

| Engine | Receiver | Also enabled by the agent (off upstream) | Query events |
| --- | --- | --- | --- |
| PostgreSQL | `postgresql` — connections vs `max_connections`, commits and rollbacks, block reads, database and table sizes, row operations, replication byte lag, WAL age, checkpoints, vacuums | `postgresql.blks_hit` / `postgresql.blks_read` (cache hit ratio), `postgresql.deadlocks`, `postgresql.temp_files`, `postgresql.tup_*` (row throughput), `postgresql.database.locks`, `postgresql.wal.delay` (replication time lag) | query samples (`pg_stat_activity`), top queries (`pg_stat_statements`) |
| MySQL / MariaDB | `mysql` — threads and connections, buffer pool usage and reads, row and table locks, handlers, row operations (MySQL only), uptime | `mysql.query.count`, `mysql.query.slow.count`, `mysql.commands`, `mysql.connection.count`, `mysql.connection.errors`, `mysql.max_used_connections`, `mysql.replica.time_behind_source`, `mysql.client.network.io` | query samples, top queries (`performance_schema`) |
| SQL Server | `sqlserver` — user connections, batch requests, compilations, buffer cache hit ratio, page life expectancy, lock waits | `sqlserver.deadlock.rate`, `sqlserver.processes.blocked`, `sqlserver.memory.grants.pending.count`, `sqlserver.cpu.utilization`, `sqlserver.database.io`, `sqlserver.database.latency`, `sqlserver.availability_group.database_replica.secondary_lag` | query samples, top queries (dynamic management views) |
| Oracle | `oracledb` — sessions, executions, commits and rollbacks, parses, logical and physical reads, CPU time, PGA, tablespace sizes (a connection to a pluggable database reports no process count and no session or process limits) | `oracledb.db.time`, `oracledb.tablespace.utilization`, `oracledb.sga.usage`, `oracledb.sga.limit` | query samples, top queries (`V$SESSION`, `V$SQL`) |
| Redis / Valkey / KeyDB / Dragonfly | `redis` — clients, commands per second, keyspace hits and misses, memory, evictions, expirations, replication offset, uptime | `redis.maxmemory`, `redis.role`, `redis.replication.replica_offset`, `redis.cmd.latency` | — |
| MongoDB | `mongodb` — connections, operations and their time, cache operations, memory, data, storage and index sizes, cursors, sessions | `mongodb.uptime`, `mongodb.operation.latency.time`, `mongodb.page_faults`, `mongodb.lock.deadlock.count`, `mongodb.active.reads`, `mongodb.active.writes` | query samples (`$currentOp`), top queries (profiler or `getLog`) |
| Elasticsearch / OpenSearch | `elasticsearch` — cluster health, shards and pending tasks, per-node documents, operations and their time, thread pools, caches, disk, JVM heap and GC, per-index sizes and operations | `jvm.memory.heap.utilization`, `elasticsearch.process.cpu.usage`, `elasticsearch.node.operations.current` | — |
| Memcached | `memcached` — connections, commands, hits and misses, evictions, items, bytes, network, threads, CPU (all on by default) | — | — |

The PostgreSQL receiver's `postgresqlreceiver.preciselagmetrics` feature gate, on by default, records the replication time lag as `postgresql.wal.delay` instead of `postgresql.wal.lag`, and that metric is off upstream — which is why the agent switches it on. Each config lists further optional metrics in a comment; enable any of them the same way. The **Engine metrics** section of a database's Overview charts a curated set for every engine in this table — for Elasticsearch / OpenSearch cluster health, nodes, unassigned shards, pending tasks, JVM heap, free disk, searches and indexing; for Memcached connections, memory, items, get hits and misses, commands and evictions — and the **Metrics** tab has everything. There, a metric the Overview charts shows the Overview's value — its series combined the same way, a counter as a per-second rate — with a caption saying how (_total of series_, _per second, all series_); every other row shows the average of its series, and so does every row while you filter the list by an attribute. MariaDB reports `mysql.buffer_pool.limit` as the buffer pool's page count rather than the bytes the receiver declares, so on a MariaDB database that row and its chart read in pages. MariaDB has no `Innodb_rows_*` status counters, so the receiver sends no `mysql.row_operations` for it and a MariaDB Overview has no **Row operations** chart; **Handler operations** shows its row reads and writes.

The database's **Version** comes from the receiver where it reports one: `db.system.version` (MySQL / MariaDB, MongoDB), `redis.version` (Redis, KeyDB), `oracle.db.version` (Oracle) and `elasticsearch.node.version` (Elasticsearch / OpenSearch). The PostgreSQL, SQL Server and Memcached receivers report none, so under the agent alone those databases show no version; one that also runs in Kubernetes, Docker or Podman shows its container image's.

Query samples and top queries arrive on the database's **Logs** tab with the query text as their message. The receivers send them with an empty body and the query in `db.query.text`; the config's `transform/query_event_body` processor copies it into the body and keeps the attribute, and gives an event without query text its event name (`db.server.query_sample`, `db.server.top_query`).

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

Re-run `install.sh`: it reuses every value in your existing `.env`, replaces `docker-compose.yml`, `otel-collector-config.yaml` and the systemd unit with the current versions, and recreates the agent's container so the new config takes effect. A file you had edited — `network_mode: host`, a `filelog` receiver and its mount, extra metrics — is kept next to the new one as `<file>.bak.<timestamp>`, and the script lists it at the end so you can re-apply the edit. Apply any edit to `.env` or `otel-collector-config.yaml` with `docker compose up -d --force-recreate`: the collector reads its config only when it starts, and a plain `docker compose up -d` leaves the running container alone when only the config file changed. The script records what it installed in `.agent-files.sha256`, so a file nobody edited is replaced without a copy, however much the new version changed; in a directory without that record (one you set up by hand) every file that differs from the new version is kept, since it may hold edits. To remove the agent, `cd /opt/oneuptime-database-agent && docker compose down`, then drop the monitoring user.

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

If you already run collectors, add the receiver to one of them instead of running the agent. OneUptime recognises data from the collector-contrib `postgresql`, `mysql`, `sqlserver`, `oracledb`, `redis`, `mongodb`, `mongodbatlas`, `elasticsearch`, `memcached`, `couchdb`, `riak`, `saphana`, `snowflake`, `aerospike` and `googlecloudspanner` receivers (current collectors configure the Atlas and Spanner ones as `mongodb_atlas` and `google_cloud_spanner`), and from any resource that carries both `db.system.name` (or the older `db.system`) and `server.address` (for example a Prometheus scrape of the engine's own metrics endpoint that you stamp yourself). The **Documentation** tab of each database renders the complete collector config for its engine — receiver or Prometheus scrape, identity stamp, exporter and pipeline. Three rules:

1. **Every batch must name the server.** OneUptime reads `server.address` / `server.port`, then a `host:port` in `service.instance.id`, then `mysql.instance.endpoint`, then `mongodb_atlas.host.name` / `mongodb_atlas.process.port`, then `saphana.host` (with SAP HANA's default port, 30015); values that identify nothing (`unknown`, a container id, the pod's own name) count as missing. Receivers that report none of them — Redis unless `resource_attributes.server.address` and `server.port` are enabled, Memcached, Elasticsearch, CouchDB, Snowflake, Riak, Aerospike and Cloud Spanner — are ignored until you stamp `server.address` and `server.port` with a `resource` processor, as the agent configs do (or stamp `oneuptime.database.server.id`). The `saphana` receiver's batches attach by HANA's own hostname; stamp `server.address` and `server.port` (or the id) anyway when that hostname is a single-label name — which only joins a database that already has it and never creates one — or is not the address your applications use. One receiver instance per pipeline, or the stamp merges them. A receiver pointed at a fork reports its family — with its default settings the `mysql` receiver says `mysql` for MariaDB and TiDB, the `redis` receiver `redis` for Valkey. The `mysql` receiver names MariaDB itself once its `resource_attributes.db.system.name` is switched on (it is off by default): it then reports `mariadb`. A `db.system.version` holding the server's own version string refines the engine too when it names MariaDB, TiDB, Vitess or OceanBase (`8.0.11-TiDB-v7.5.1` is TiDB). The `mysql` receiver reports only the number there (`11.4.13`, never `11.4.13-MariaDB`); that still names MariaDB 10 and later, because MySQL never released a 10.x or 11.x, but not a MariaDB 5.5, nor TiDB, Vitess or OceanBase, whose numbers are MySQL's. Stamping `db.system.name` with the fork's name is the reliable way to see it as itself — the Database Agent does, from `DATABASE_SYSTEM`.
2. **Keep `service.name` off the resource.** Data with a `service.name` is routed to that Service first. The Prometheus receiver always sets it (to the job name), so delete it — and `service.instance.id`, the scrape target — in the `resource` processor.
3. **Name the server your applications use.** A loopback endpoint (`localhost:5432`) names no server. OneUptime falls back to the collector machine's `host.name` only for a collector running directly on a VM or bare-metal host (the `resourcedetection` `system` detector reports `os.type`, and nothing marks it as a container, a pod or a serverless task); anywhere else the batch is ignored. Stamping `server.address` with the name applications use is more reliable either way, and it is what joins engine metrics to application traces. Give database receivers their own pipeline, as the agent configs do: the receiver's data belongs to its database either way (see [The metrics land on a Host](#the-metrics-land-on-a-host-or-a-new-service-appears)), but a `resource` processor that stamps a database's identity stamps every resource in its pipeline, host metrics included.

To attach a receiver to a database OneUptime already shows, whatever its address, also stamp `oneuptime.database.server.id` with that database's id (its **Documentation** tab has it). Values the collector reads from the environment are expanded once more, so write every `$` in a password as `$$`.

If you switch on a receiver's query events (`db.server.query_sample`, `db.server.top_query`), copy the query text into the log body the way the agent configs do — the receivers leave the body empty, and the **Logs** tab would show `{}` as each event's message:

```yaml
processors:
  transform/query_event_body:
    error_mode: ignore
    log_statements:
      - set(log.body, log.attributes["db.query.text"]) where (log.body == nil or log.body == "") and log.attributes["db.query.text"] != nil and log.attributes["db.query.text"] != ""
      - set(log.body, log.event_name) where (log.body == nil or log.body == "") and log.event_name != ""
```

Add it to the `logs` pipeline, before `batch`.

## Endpoints and the one-owner rule

An endpoint is a `host:port` a database answers on. A database's **Endpoints** tab lists them: the primary one — the endpoint the database was created from, which cannot be removed — and any aliases. Everything that names an endpoint — a span, a `db.client.*` metric, a receiver batch, a Database Health or SQL Query monitor — is attributed to the database that owns it, so endpoints are what tie traces, Kubernetes, engine metrics and alerts into one page.

- **One owner.** An endpoint belongs to at most one database in a project. Adding an alias another database already owns is refused, naming that database when you can see it.
- **Adding or removing an alias is an edit.** It needs permission to edit that database — a label- or owner-scoped edit permission covers only the databases it reaches — and the primary endpoint can never be removed. Each alias added or removed this way goes on the database's **Feed**, naming the endpoint and who changed it; discovery's own endpoint changes do not.
- **Merging two databases that are one server.** Note the endpoints of the one you do not keep, delete it, and add those endpoints as aliases on the other straight away. Deleting frees every endpoint of the deleted database, its primary one included; archiving does not — an archived database keeps its endpoints. Once the aliases are added, everything that names them lands on the database you kept, so the deleted one does not come back.
- **Canonical forms.** Endpoints are stored lowercase with a port (the engine's default when none is given), IPv6 in brackets. Kubernetes names are expanded to `<service>.<namespace>.svc.cluster.local`, and names that only resolve inside one network get the cluster as a suffix — `postgres.prod.svc.cluster.local:5432@my-cluster` — whenever the cluster is known. A connection string that lists several hosts is one endpoint, whatever order it lists them in.
- **SQL Server named instances.** Two named instances on one host are two databases. An address that names an instance and no port — `sql1.corp\INST01`, or a span's `db.mssql.instance_name` or the instance half of a `db.namespace` of the form `instance|database` — becomes the endpoint `sql1.corp\inst01`, with no port. A known port already identifies the instance, so `sql1.corp:14330` needs no instance name, and `MSSQLSERVER`, the default instance, is no instance at all. If some applications name an instance and others its port, merge the two databases as above.
- **Local-only names never identify a database.** `localhost`, `127.0.0.1`, `::1`, `host.docker.internal`, `host.containers.internal`, every other `*.docker.internal` name and the `host.<tool>.internal` names of minikube, k3d, Lima, OrbStack and Rancher Desktop point somewhere different for every caller — usually a sidecar proxy such as the Cloud SQL Auth Proxy or pgbouncer on localhost. Calls to them are not attributed to any database and they cannot be added as aliases.
- **Names that only resolve inside one network** — a single-label name (`postgres`), a cluster-local name, a `.internal`, `.local`, `.home.arpa` or `.localdomain` name, a private IP (`10/8`, `172.16/12`, `192.168/16`, `100.64/10`, `fc00::/7`) — are qualified with the caller's cluster when the caller runs in Kubernetes. Without a cluster — a call from a VM, a laptop, a serverless function or the Database Agent — they are recorded on spans and receiver data but never create a database: they attach only to a database that already has exactly that endpoint, one you created with that address or one you added it to as an alias because the name really is unique in your project. Link-local addresses (`169.254/16`, `fe80::/10`) never create a database, even from a pod: every network link has its own.
- **Calls from Kubernetes carry their cluster.** An application whose telemetry goes through the Kubernetes agent reports its namespace and cluster, so its calls are read the way its pod's resolver reads them — `postgres` as the Service in its own namespace, `postgres.prod` as the Service `postgres` in namespace `prod` — and names that only resolve inside the cluster are recorded with the cluster attached. A two-part name called from a VM is an ordinary DNS name.
- **Naming the cluster yourself.** When you type an endpoint — the address of a database you create, or an alias on its Endpoints tab — write the cluster after an `@` for a name that only resolves inside one cluster or network: `postgres.prod.svc.cluster.local:5432@my-cluster` or `postgres.prod:5432@my-cluster`, with the cluster name your Kubernetes agent was installed with; otherwise calls from that cluster will not match it. On a database detected in Kubernetes, a name typed without a cluster takes the database's own. The qualifier is refused on a name that resolves the same everywhere (`db.example.com@prod`), a single-label name needs its namespace first (`postgres.prod@prod`, not `postgres@prod`), and `user@host` (`admin@10.0.0.5:5432`) is refused: the database user does not belong in an endpoint.
- **Engine-agnostic.** Endpoints carry no engine, so wire-compatible engines join: a CockroachDB or YugabyteDB cluster that applications reach with a PostgreSQL driver, a MariaDB server they reach with a MySQL driver, or an OpenSearch cluster that clients report as Elasticsearch, still lands on its database — which shows the specific engine once an image, a chart or the agent names it.
- **Discovered endpoints move on.** The **Added by** column says whether a person added an endpoint or discovery did. Discovery maintains its own: a Kubernetes Service name is released about 2 hours after the workload stops producing it (a renamed Service, or the unqualified form once the project has a second cluster), and when a workload is replaced — a Deployment moved to a StatefulSet, an image recognised as another engine — the endpoints of the old database move to the new one once the old workload has not been seen for an hour. They also move away from an untouched duplicate that application traces created before the workload was detected — one nobody renamed, described, labelled, owned, linked to an incident, alert or scheduled maintenance, added an endpoint to, changed the retention of, or restored from the archive in the last 30 days. Endpoints a person added are never moved or released. **Last Matched** is refreshed at most once an hour; for a Kubernetes Service name it is when the workload last produced it.

A database's name defaults to the engine and its endpoint — `PostgreSQL db.example.com:5432` — or, for a database detected from its containers, the engine and its workload: `<namespace>/<workload>` in Kubernetes (`PostgreSQL data/postgres`), and on Docker or Podman the container's name, its Compose service (`<project>-<service>`) or its Swarm service. It can be renamed freely; the name is not the identity. That default makes label and owner rules by name easy: a name pattern of `^PostgreSQL` matches every PostgreSQL database, and `^MariaDB` every MariaDB one.

## Alerts on a database

A database's **Alerts** and **Incidents** tabs show what the monitors that name it opened. While the database is in an ongoing scheduled maintenance window, those monitors open no new incidents or alerts, unless they also name a resource that is outside the window. Their status still updates, and what they opened before the window still resolves. Databases can also be attached to incidents, alerts and scheduled maintenance by hand, like any other resource.

### Recommended monitors

The database's **Recommendations** tab offers ready-made Metrics monitors for its engine — connections near their limit, replication lag, memory and cache pressure, blocked sessions, full tablespaces, cluster health, restarts, and an **Engine Metrics Stopped** check that fires when the engine's metrics stop arriving — for these engines: PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, Redis, Valkey, KeyDB, Dragonfly, Memcached, MongoDB, CouchDB, Elasticsearch and OpenSearch. They read the metrics the engine's collector receiver reports, so they are offered once one of those metrics has arrived stamped with the database's `oneuptime.database.server.id` in the last 30 days — its logs, another receiver (a MongoDB Atlas cluster's `mongodbatlas` receiver, say) or an exporter do not count, and until then the tab says why it is empty — and every one filters on the database's `oneuptime.database.server.id`. The badge next to the tab counts the ones not created yet.

A receiver's documentation lists what it can report, not what arrives from every setup, so the SQL Server and Oracle monitors read only metrics seen arriving from the Database Agent's own configs. That is why SQL Server has no transaction-log or lock-wait-time monitor (only Windows performance counters report them, and the agent connects directly) and Oracle none on its session or process limit (a connection to a pluggable database does not report them).

### Monitors you build

A monitor you build attaches its alerts and incidents to a database when it names the database:

- **By id.** A **Metrics** monitor over an engine metric, or a **Logs** monitor over its query events and log file, that filters on `oneuptime.database.server.id` — the id on the database's **Documentation** tab. To watch many databases with one monitor, group the query by `oneuptime.database.server.id` instead: each series then attaches to its own database and is silenced by that database's scheduled maintenance alone.
- **By endpoint.** **Database Health** and **SQL Query** monitors attach to the database whose endpoints include the host and port they connect to (for a SQL Server named instance, `host\instance`, its host and instance: the driver ignores the port for a named instance and asks SQL Browser for the instance's own), and so do Metrics and **Traces** monitors that filter `server.address` — with `server.port`, or else the default port of the engine a `db.system.name` filter or a receiver metric (`postgresql.backends`) names. A Traces monitor on the failed calls to `orders-db.example.com` is that database's. The address is read the way a span's is, so a `k8s.namespace.name` or `k8s.cluster.name` filter next to a cluster-local name completes and qualifies it; a probe carries no cluster, so it matches a name that only resolves inside one cluster only while the database also has it unqualified (a project with one Kubernetes cluster).

The quickest way to build one is from the chart itself: a chart opened from the database's **Metrics** tab has **Create monitor**, which opens a new Metrics monitor over that metric — with the chart's aggregation, attribute filters and time range — filtered on the database's `oneuptime.database.server.id`, so it belongs to the database from the start. A curated gauge the chart adds up across series — connections per database, one agent per replica-set member — becomes a monitor that alerts on each series (a monitor cannot add series together), and one whose chart shows the highest or lowest of its series is read with Max or Min; a line under the button says so. The button is disabled, and says why, for a cumulative counter (the chart shows its rate, and a monitor has no rate) and for a metric that does not carry the database's id: `db.client.*` metrics from the applications that call it, or the CPU and memory of the pods and containers it runs as. Build those from the Metrics explorer instead.

Grouping by `server.address` attaches nothing: group by `oneuptime.database.server.id`. Charts overlay a database's incidents and alerts when they are filtered by `oneuptime.database.server.id`, never by `oneuptime.database.server.name`, which is a display name made from the data rather than the database's own name.

### What to alert on

Threshold gauges — connections against their limit, memory, replication lag, cache hit ratio, blocked sessions — or a ratio of two gauges from the same scrape. A cumulative counter (slow queries, deadlocks, rejected connections, evictions) only ever grows and monitors have no rate function, so a threshold on its raw value fires once and never clears; the **Metrics** tab still charts it as a rate. To alert on one, turn it into deltas in the collector with a `cumulativetodelta` processor — each point is then the increase since the previous one, and a Sum over the monitor's window thresholds it. In the agent's `otel-collector-config.yaml`, add the processor and put it in the `metrics` pipeline before `batch`:

```yaml
processors:
  cumulativetodelta/alerting:
    include:
      metrics:
        - postgresql.deadlocks
        - postgresql.rollbacks
      match_type: strict

service:
  pipelines:
    metrics:
      processors: [memory_limiter, resource, transform/optional_identity, cumulativetodelta/alerting, batch]
```

List only the counters you alert on: from then on the database's charts show those metrics per interval. An upgrade replaces the config and keeps your edited copy next to it (see [Upgrading and uninstalling](#upgrading-and-uninstalling)), so re-apply the edit afterwards.

SQL Server's `sqlserver.*.rate` metrics (batch requests, compilations, lock waits, deadlocks) are counters in disguise: over the agent's direct connection they carry the counter's total since the server started rather than a per-second rate (only Windows performance counters report the rate), and `cumulativetodelta` leaves them alone because the receiver reports them as gauges. Alert on SQL Server's point-in-time values instead — blocked sessions, pending memory grants, page life expectancy, buffer cache hit ratio.

For a probe that checks a database without any agent, see the [Database Health Monitor](/docs/monitor/database-health-monitor).

## Lifecycle, archiving and retention

- **Last seen** is updated by every source, and the pill in a database's header reads it: _Seen recently_ while some source saw the database in the last 30 minutes, _Not seen recently_ after that, and _Never seen_ before any source has. It says nothing about engine metrics, which have a status of their own.
- **Engine metrics** reads _Connected_ while collector data keeps arriving, _Disconnected_ once a collector that reported stops for 15 minutes, and _Not connected_ when no Database Agent or collector has ever reported. The 15 minutes are a floor: OneUptime records a collector's heartbeat only every 5 minutes or so while data flows, so it waits 7 minutes on top of them, counted from the last recorded heartbeat, and it checks every 5 minutes — a collector that stops reads _Disconnected_ between 15 and about 27 minutes after its last data point. The list's **Engine metrics** filter offers all three.
- **Archive to dismiss.** Deleting a discovered database removes it only until a source sees it again — the next span or pod brings it back as a new database. To dismiss one for good, **archive** it: an archived database keeps its endpoints, so everything that matches them stays attached to the archived database instead of creating a new one.
- **Automatic archiving.** A discovered database that no source has seen for 7 days is archived automatically, unless somebody invested in it: labels or owners a person added, an incident, alert or scheduled maintenance, an endpoint a person added, or a retention setting. Labels and owners that label or owner rules, or `oneuptime.label.*` attributes, attached on their own do not count — a catch-all rule would otherwise keep every database forever — until a person saves them on the database. Databases of a Kubernetes cluster or a Docker or Podman host that has gone quiet itself are not archived while it is dark: a database only counts as unseen when it went unseen well before its cluster or host did.
- **Restoring.** A database archived automatically is restored automatically as soon as a source sees it again — except the database of a Kubernetes, Docker or Podman workload, which only its workload or a collector brings back: application traces that still name its Service neither restore it nor count as seeing it (its **Last seen** does not move). Databases you created, and databases a person archived, are never archived or restored by discovery. A database a person restores stays restored for 30 days (or the archive window, if that is longer) even while nothing sees it; from its next sighting the 7-day rule applies again.
- **Retention.** The retention setting on a database's **Settings** tab applies to telemetry collected from the database itself by a collector or the agent — engine metrics, query events and its log file, including a database receiver's data that shares a collector with host or Kubernetes metrics. Without a setting the project's default applies. Application traces follow the retention of the service that sent them, and container logs and metrics that of their cluster or host.

## Self-hosted tuning

Self-hosted installations can tune discovery with these environment variables on the OneUptime app:

| Variable | Default | What it controls |
| --- | --- | --- |
| `DATABASE_SERVER_MIN_CALLS` | `10` | Queries an endpoint needs within the 15-minute window each 10-minute run looks at before traces create a database for it (connection spans such as `pg.connect` do not count) |
| `DATABASE_SERVER_AUTO_CREATE_BUDGET` | `500` | Live, non-archived discovered databases a project can have before traces, Kubernetes, Docker, Podman and collectors stop creating new ones. Only databases created by hand are exempt; `0` turns automatic creation off |
| `DATABASE_SERVER_AUTO_ARCHIVE_DAYS` | `7` | Days unseen before an untouched discovered database is archived (minimum 1) |
| `DATABASE_SERVER_COLLECTOR_STALE_MINUTES` | `15` | Minutes of collector silence before Engine metrics reads Disconnected (minimum 10) — at least this long after the last data, and up to about 12 minutes more (see [Lifecycle](#lifecycle-archiving-and-retention)) |

## Troubleshooting

### Run the diagnostic script first

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DatabaseAgent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-database-agent
```

It checks the container, the identity in `.env`, TCP reachability of the database from the agent's own network, login, permission and TLS errors in the collector log (and names any other receiver error it finds there), and the ingestion key. The key check matters: OneUptime's OTLP endpoints answer a bad key with a silent `200` (so a misconfigured collector cannot retry-flood the server), so the collector log looks clean while everything is dropped. The script calls `GET <url>/otlp/v1/validate`, which answers `200` or `401` for real. It runs its probes from a pinned curl image and hands it the key on stdin, never on a command line.

### The agent runs but no database appears

- `DATABASE_SERVER_ADDRESS` is `localhost`, `127.0.0.1` or `host.docker.internal` — local-only addresses are ignored. Use the name your applications use.
- It is a private IP, a single-label name or a cluster-local name (`*.svc.cluster.local`) — such names never create a database on their own. Create the database by hand with that address and port, or set `DATABASE_SERVER_ID`. In a project with a Kubernetes cluster, create a cluster-local Service name with its cluster (`postgres.prod.svc.cluster.local:5432@my-cluster`) — the unqualified name is refused there — and then add the unqualified name the agent reports on the database's **Endpoints** tab.
- `DATABASE_SERVER_ID` is not the id of a database in the project the ingestion key belongs to.
- The ingestion key is wrong — run the diagnostic script.
- Your own collector sends receiver batches without `server.address` — **receiver batches that do not name their server are ignored**. Enable `resource_attributes.server.address` / `server.port` (Redis) or stamp both with a `resource` processor (Memcached, Elasticsearch, CouchDB, Snowflake, Riak, Aerospike, Cloud Spanner). A resource you stamp yourself needs `db.system.name` (or the older `db.system`) next to `server.address`.
- Your own collector's batches name a server only by a single-label name — SAP HANA's own hostname, say — which never creates a database. Stamp `server.address` / `server.port` with the name applications use, or `oneuptime.database.server.id`.

### The collector cannot connect to the database

Inside the agent's container, `localhost` is the container itself. Use `host.docker.internal:<port>` (the compose file maps it to the machine on Linux too) with the database listening on the Docker bridge address as well — or uncomment `network_mode: host` in `docker-compose.yml` and use `localhost:<port>`. For remote servers check DNS, firewalls and the server's own allow-list (`pg_hba.conf`, `bind-address`, `bind`, `net.bindIp`).

### Login, permission or TLS errors in the collector log

- `password authentication failed`, `Access denied for user`, `Login failed for user`, `ORA-01017`, `WRONGPASS`, `Authentication failed`: check the credentials. The collector expands `$` inside them once more, so every `$` must be written as `$$` in `.env` or a Kubernetes Secret (`install.sh` does this). Quote a password containing `#`, spaces or quotes in `.env`. On SQL Server a login containing `;` or `"`, or with spaces around it, always fails: its connection string cannot carry them (see [SQL Server](#sql-server)).
- Connections always `1`, `permission denied`, `Access denied; you need … privilege(s)` (MySQL / MariaDB error 1227: `PROCESS`, or `SLAVE MONITOR` on MariaDB 10.5.9 and later), `NOPERM`, `not authorized`, `VIEW SERVER STATE`, `ORA-00942`: the monitoring user is missing its grant — see [Create a monitoring user](#create-a-monitoring-user).
- `ORA-12514` or `ORA-12505`: the Oracle listener answers — so the connection check passes — but does not know the service `DATABASE_ORACLE_SERVICE` names; `lsnrctl services` on the database host lists the ones it does.
- `ORA-28000` or `ORA-28001`: the Oracle monitoring user is locked or its password expired.
- `failed to explain` on PostgreSQL top queries is not a missing grant: explain plans need `SELECT` on your tables, which `pg_monitor` deliberately does not give. Metrics and top queries are unaffected; only the plans stay empty.
- `SSL is not enabled on the server`: set `DATABASE_TLS_INSECURE=true`. A server that requires TLS: `DATABASE_TLS_INSECURE=false`, plus `DATABASE_TLS_INSECURE_SKIP_VERIFY=true` for a certificate the image does not trust. For Elasticsearch / OpenSearch the `http://` or `https://` of `DATABASE_ENDPOINT` decides it.
- `pg_stat_statements` errors: create the extension, or set `DATABASE_QUERY_EVENTS=false`.
- For any other receiver error the diagnostic script prints the most frequent one, as the database driver worded it (with the password redacted).

### The metrics land on a Host, or a new Service appears

OneUptime attributes a batch to a database only when the batch names the database's server, or carries its `oneuptime.database.server.id`. A batch that does not is attributed by its other attributes — to the collector's Host when `resourcedetection` added `host.name`, or to a Service when it carries `service.name`, which wins even over a database's identity. Stamp `server.address` / `server.port` (see [Using your own OpenTelemetry Collector](#using-your-own-opentelemetry-collector)), and delete `service.name` in the `resource` processor.

A database receiver's data belongs to the database even when the receiver shares a collector — and a pipeline — with host or Kubernetes metrics: each receiver emits its own resource, so a PostgreSQL receiver added to a host-metrics or Kubernetes agent pipeline is attributed to its database, not to the Host or the cluster, and it neither registers an Inventory Host nor keeps one alive with a heartbeat. Only a single resource that itself also carries `system.*` or `process.*` metrics stays a Host. Collectors set up this way before the database existed now send that data to the database — created automatically when its address allows — so:

- the database's retention applies to it (set it on the database's **Settings** tab), and until you set one, the project's default — not the Host's or the cluster's;
- its rows carry `oneuptime.database.server.id` rather than `oneuptime.host.id`: a monitor or dashboard that grouped such metrics by `oneuptime.host.id` should filter or group by `oneuptime.database.server.id` instead.

### Two databases for one server

The sources named it differently — an IP in one place and a DNS name in another, two DNS names, a SQL Server instance named by its instance in one place and by its port in another, or a cluster member a driver reported on its own (Cassandra, Redis Cluster, Elasticsearch, ElastiCache). Delete the one you do not keep and add its endpoints as aliases on the other (see [Endpoints](#endpoints-and-the-one-owner-rule)). Pointing the agent at the database with `DATABASE_SERVER_ID` avoids the problem for engine metrics — in particular for a database detected from its Docker or Podman containers, which has no endpoint the agent's address could match: install the agent from that database's **Documentation** tab, where the id is prefilled.

### A database my applications use was not created

It was probably outside the [create policy](#from-application-traces): an IP address, a local-only or single-label name, a name that only resolves inside one network (a `.internal` or `.local` name, a cluster-local name) called from outside Kubernetes, fewer than 10 queries in the last 15 minutes (connection spans such as `pg.connect` and `pg-pool.connect` do not count), an engine that is never created from traces (a shared cloud API, an in-process engine, or one OneUptime does not know), or the project's [auto-create budget](#the-auto-create-budget). Create it by hand with the address your applications use — its **Queries from applications** section fills in from the spans already stored.

### A Kubernetes database was not detected

The cluster must be connected (the Kubernetes agent running), and one of the database's pods must have been Ready for about 10 minutes; a pod in `CrashLoopBackOff` turns Ready afresh on every restart. A pod that also runs an application container, a client or debug run of a database image (directly, through `sh -c`, or behind `env`, `nohup`, `tini`, `dumb-init` or `docker-entrypoint.sh`), a `kubectl run` pod that declares no port, an image OneUptime does not recognise, or a connection pooler is not a database. Create it by hand and add its Service names as endpoints with the cluster attached (`postgres.prod.svc.cluster.local:5432@my-cluster`), so calls from applications in the cluster match.

### Queries from applications is empty

The spans are missing `db.system.name` / `db.system` or `server.address`, or they use an address that is not one of the database's endpoints — compare the **Endpoints** tab with the `server.address` on a span in the **Traces** explorer, and add the missing alias.

### Engine metrics reads Disconnected or Not connected

_Not connected_: no Database Agent or collector has ever reported for this database — install the agent from its **Documentation** tab. _Disconnected_: one did and has sent nothing for at least 15 minutes (see [Lifecycle](#lifecycle-archiving-and-retention)) — run the [diagnostic script](#run-the-diagnostic-script-first) where it runs. Recommended monitors appear on the **Recommendations** tab once the engine receiver's own metrics have arrived.

### A monitor's alerts do not show on the database

The monitor does not name the database. Filter or group a Metrics or Logs monitor by `oneuptime.database.server.id`, or check that the host and port a Database Health, SQL Query, Metrics or Traces monitor names is one of the database's endpoints, exactly as the **Endpoints** tab lists it (see [Monitors you build](#monitors-you-build)).

## Next steps

- Open a database's **Recommendations** tab to create the monitors recommended for its engine, or build your own [Metrics monitor](/docs/monitor/metrics-monitor) over its engine metrics filtered on `oneuptime.database.server.id` (see [Alerts on a database](#alerts-on-a-database)).
- Connect a probe with the [Database Health Monitor](/docs/monitor/database-health-monitor) (PostgreSQL, MySQL, SQL Server) — no agent required; its alerts land on the database whose endpoint it connects to.
- Instrument your applications with [OpenTelemetry](/docs/telemetry/open-telemetry) so their database calls fill the **Queries from applications** section.
