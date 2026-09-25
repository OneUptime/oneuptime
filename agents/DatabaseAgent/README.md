# OneUptime Database Agent

Collect engine metrics — connections, throughput, cache hit ratio, locks, replication lag, memory — from PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, Redis, Valkey, KeyDB, Dragonfly, MongoDB, Elasticsearch, OpenSearch and Memcached with OneUptime, using a pre-configured OpenTelemetry Collector.

The agent is config-only: a stock `otel/opentelemetry-collector-contrib` container running the collector's native receiver for your engine, with a config that stamps every batch with the database's identity and ships it to OneUptime over OTLP. No exporter sidecar and nothing installed on the database server.

**One agent monitors one database server.** The identity (`server.address` / `server.port`) is stamped on everything the agent sends, so a second server added to the same config would merge into the first. Install a second copy in a second directory for a second server.

The full guide — how databases are detected without any agent, what each source provides, every engine OneUptime knows and where its metrics come from, Kubernetes, endpoints and troubleshooting — is at [oneuptime.com/docs/telemetry/databases](https://oneuptime.com/docs/telemetry/databases).

## Files

| File | What it is |
| --- | --- |
| `docker-compose.yml` | The collector container (pinned image) and the environment it reads |
| `configs/postgresql.yaml` | Collector config for PostgreSQL |
| `configs/mysql.yaml` | Collector config for MySQL and MariaDB |
| `configs/sqlserver.yaml` | Collector config for SQL Server |
| `configs/oracledb.yaml` | Collector config for Oracle |
| `configs/redis.yaml` | Collector config for Redis, Valkey, KeyDB and Dragonfly |
| `configs/mongodb.yaml` | Collector config for MongoDB |
| `configs/elasticsearch.yaml` | Collector config for Elasticsearch and OpenSearch |
| `configs/memcached.yaml` | Collector config for Memcached |
| `install.sh` | Asks for the engine, endpoint and credentials, downloads the matching config as `otel-collector-config.yaml`, writes `.env` and starts the agent |
| `troubleshoot.sh` | Checks the whole chain and names the most likely problem |
| `systemd/oneuptime-database-agent.service` | Optional systemd unit |

A fork or drop-in runs its family's config and reports its own name: `DATABASE_SYSTEM=mariadb` downloads `configs/mysql.yaml` and the database shows as MariaDB.

## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the database's port
- A dedicated monitoring user on the database (see below)
- A **OneUptime Telemetry Ingestion Key** — create one from _Project Settings → Telemetry & APM → Ingestion Keys_

## Create a monitoring user

Give the agent its own login with read access to the engine's statistics — never an administrator, and never an application's own login.

### PostgreSQL

```sql
CREATE USER oneuptime_monitor WITH PASSWORD 'a-strong-password';
GRANT pg_monitor TO oneuptime_monitor;
```

`pg_monitor` (PostgreSQL 10+) reads the statistics views and grants no access to your tables. Without it `pg_stat_activity` does not fail — it returns only the agent's own session, so connection counts read `1`. The receiver connects to every database to collect per-database statistics, so the user also needs `CONNECT` on each one (PUBLIC has it by default; `GRANT CONNECT ON DATABASE mydb TO oneuptime_monitor;` where it was revoked). The PostgreSQL receiver refuses to start without a password.

Top queries (`DATABASE_QUERY_EVENTS=true`) also need the `pg_stat_statements` extension, loaded through `shared_preload_libraries = 'pg_stat_statements'` (a restart) and created in every monitored database:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

Their explain plans additionally need `SELECT` on the tables the queries touch, which `pg_monitor` does not grant (for example `GRANT SELECT ON ALL TABLES IN SCHEMA app TO oneuptime_monitor`). Without it top queries still arrive, with empty plans, and the collector logs `failed to explain` for each one — `troubleshoot.sh` reports that as a warning, not as a missing grant.

### MySQL / MariaDB

```sql
CREATE USER 'oneuptime_monitor'@'%' IDENTIFIED BY 'a-strong-password';
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'oneuptime_monitor'@'%';
GRANT SELECT ON performance_schema.* TO 'oneuptime_monitor'@'%';
```

`PROCESS` and `REPLICATION CLIENT` cover `SHOW GLOBAL STATUS`, InnoDB status and replica status; `performance_schema` is needed for query samples and top queries. MariaDB 10.5.9 and later split replica status into its own privilege, so also run `GRANT SLAVE MONITOR ON *.* TO 'oneuptime_monitor'@'%';` there.

### SQL Server

```sql
CREATE LOGIN oneuptime_monitor WITH PASSWORD = 'a-strong-password';
GRANT VIEW SERVER STATE TO oneuptime_monitor;
GRANT VIEW ANY DEFINITION TO oneuptime_monitor;
```

`VIEW SERVER STATE` (on SQL Server 2022 and later `VIEW SERVER PERFORMANCE STATE` is enough) reads the dynamic management views every metric comes from, and grants no access to your data. The receiver puts the login into a connection string without quoting it, so the user name and password must not contain a semicolon (`;`) or a double quote (`"`), nor start or end with a space — `install.sh` refuses them. The driver negotiates encryption with the server itself.

For a named instance (`sql1.corp\INST01`), point `DATABASE_ENDPOINT` at the instance's own TCP port — never the default instance's 1433, which reaches the default instance instead. SQL Server Configuration Manager shows it (the instance's TCP/IP protocol, IPAll), or run `SELECT local_tcp_port FROM sys.dm_exec_connections WHERE session_id = @@SPID;` on the instance. `install.sh` refuses `host\instance` and asks for `host:port`.

### Oracle

```sql
-- In the pluggable database the agent connects to, e.g. ALTER SESSION SET CONTAINER = FREEPDB1;
CREATE USER oneuptime_monitor IDENTIFIED BY "a-strong-password";
GRANT CREATE SESSION TO oneuptime_monitor;
GRANT SELECT_CATALOG_ROLE TO oneuptime_monitor;
```

`SELECT_CATALOG_ROLE` reads the `V$` and `DBA_` views the metrics, query samples and top queries come from, and grants no access to your tables. Set `DATABASE_ORACLE_SERVICE` to the service the agent connects to (`FREEPDB1`, `ORCLPDB1`, …).

### Redis / Valkey / KeyDB / Dragonfly

```text
ACL SETUSER oneuptime_monitor on >a-strong-password -@all +info +ping
```

The receiver only runs `INFO`. Persist the user with `ACL SAVE` (or an `aclfile` / `user` line in `redis.conf`). On a server that uses only `requirepass`, leave `DATABASE_USERNAME` empty and set `DATABASE_PASSWORD`.

### MongoDB

```js
db.getSiblingDB("admin").createUser({
  user: "oneuptime_monitor",
  pwd: "a-strong-password",
  roles: [{ role: "clusterMonitor", db: "admin" }],
});
```

`clusterMonitor` covers every metric. Explain plans on top queries additionally need `{ role: "read", db: "<each monitored database>" }`; without it top queries still arrive, with empty plans.

### Elasticsearch / OpenSearch

```text
POST /_security/role/oneuptime_monitor
{ "cluster": ["monitor"], "indices": [{ "names": ["*"], "privileges": ["monitor"] }] }

POST /_security/user/oneuptime_monitor
{ "password": "a-strong-password", "roles": ["oneuptime_monitor"] }
```

The `monitor` privileges read node, cluster and index statistics and no documents. On OpenSearch with the security plugin, grant the cluster permission `cluster_monitor` and the index permission `indices_monitor` on `*` instead. On a cluster without security, leave `DATABASE_USERNAME` and `DATABASE_PASSWORD` empty. One agent monitors the whole cluster through one endpoint; each node's series stay apart by `elasticsearch.node.name`.

### Memcached

Memcached has no users: the receiver runs `stats` over the text protocol, so leave `DATABASE_USERNAME` and `DATABASE_PASSWORD` empty. A server started with SASL authentication (`-S`) cannot be monitored this way.

## Quick Start — Install Script

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DatabaseAgent/install.sh -o install.sh
bash install.sh
```

The script asks for your OneUptime URL and ingestion key, the engine, the endpoint to connect to and the monitoring credentials (the password is read without echo), installs to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file, and starts the agent. When the endpoint is local to the machine (`localhost`, `host.docker.internal`), it also asks for the host name your applications use — that name is the database's identity in OneUptime. When that name only resolves inside one network — a private or link-local IP, a single-label name, a cluster-local, `.internal` or `.local` name — it asks for the database's id in OneUptime (`DATABASE_SERVER_ID`) as well, because such a name never creates a database on its own.

Every prompt can be answered up front with an exported variable of the same name, for example `INSTALL_DIR=/opt/oneuptime-database-agent-orders DATABASE_SYSTEM=postgresql bash install.sh`. Re-running the script reuses every value in your existing `.env` (nothing is prompted for again).

Any character is fine in the password, apart from the few SQL Server's connection string cannot carry (see [SQL Server](#sql-server)). The collector expands `$` inside the values it reads once more (`$$` becomes `$`, `${NAME}` becomes another variable), so the script writes every `$` in `DATABASE_USERNAME` and `DATABASE_PASSWORD` doubled, and quotes the values for Docker Compose.

## Quick Start — Docker Compose

Download `docker-compose.yml` and the config for your engine from `configs/`, saved as `otel-collector-config.yaml`, into one folder. Create a `.env` file next to them (`chmod 600 .env` — it holds a password):

```bash
# DATABASE_USERNAME and DATABASE_PASSWORD are escaped for the collector: every $ is written as $$.
ONEUPTIME_URL=https://oneuptime.com
ONEUPTIME_TELEMETRY_INGESTION_KEY=your-telemetry-ingestion-key
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

Single-quote the password, and write every `$` in it as `$$` — the collector expands `$$` and `${...}` inside it once more. The first line says so, in the words of the `.env` `install.sh` writes — and `install.sh`, re-run on this folder (`INSTALL_DIR`), reads the file the same way. Then start the agent:

```bash
docker compose up -d
```

The database appears automatically under **Databases** in OneUptime after the first collection — or, if OneUptime already detected it from traces or containers at the same address, its **Engine metrics** status turns to Connected. For a private IP or a name that only resolves inside your network (`db.prod.internal`, a cluster-local name), create the database first (**Databases → Create Database**, same address and port) or set `DATABASE_SERVER_ID`.

To run the agent inside Kubernetes (a Deployment next to the database, with `DATABASE_SERVER_ID` pointing at the database the Kubernetes agent detected), see [the Kubernetes section of the docs](https://oneuptime.com/docs/telemetry/databases#kubernetes).

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key (_Project Settings → Telemetry & APM → Ingestion Keys_) |
| `DATABASE_SYSTEM` | Yes | The engine, stamped as `db.system.name`: `postgresql`, `mysql`, `mariadb`, `redis`, `valkey`, `keydb`, `dragonfly`, `mongodb`, `microsoft.sql_server`, `oracle.db`, `elasticsearch`, `opensearch` or `memcached`. install.sh accepts the usual spellings (`postgres`, `mssql`, `oracle`, …) and downloads the matching `configs/<receiver>.yaml` |
| `DATABASE_ENDPOINT` | Yes | `host:port` the agent connects to. May be `host.docker.internal:<port>` when the agent runs on the database machine. For Elasticsearch / OpenSearch a URL, `http://host:9200` or `https://host:9200` for TLS |
| `DATABASE_ENDPOINT_HOST` | SQL Server | `DATABASE_ENDPOINT`'s host on its own, for the SQL Server receiver (install.sh writes it) |
| `DATABASE_ENDPOINT_PORT` | SQL Server | `DATABASE_ENDPOINT`'s port on its own (install.sh writes it) |
| `DATABASE_ORACLE_SERVICE` | Oracle | The Oracle service to connect to, e.g. `FREEPDB1` or `ORCLPDB1` |
| `DATABASE_SERVER_ADDRESS` | Yes | The database's identity: the host name your applications use to reach it. Never `localhost` — OneUptime ignores local-only addresses. A name that is not unique across networks (a private IP, a single-label name, a cluster-local Kubernetes name, a `.internal` or `.local` name) only joins a database that already has it as an endpoint, or the one `DATABASE_SERVER_ID` names — create the database in OneUptime first |
| `DATABASE_SERVER_PORT` | Yes | The port your applications use |
| `DATABASE_USERNAME` | PostgreSQL, MySQL, SQL Server, Oracle | The monitoring user. Optional for Redis, MongoDB and Elasticsearch without authentication; unused for Memcached |
| `DATABASE_PASSWORD` | PostgreSQL, SQL Server, Oracle | Its password. In `.env`, single-quote it and write every `$` as `$$` (`install.sh` does both for you) |
| `DATABASE_TLS_INSECURE` | No | `true` (default) connects without TLS, `false` turns TLS on (for Elasticsearch / OpenSearch, the endpoint's `https://` does) |
| `DATABASE_TLS_INSECURE_SKIP_VERIFY` | No | `true` accepts a certificate the collector image does not trust. Default `false` |
| `DATABASE_COLLECTION_INTERVAL` | No | How often statistics are read. Default `30s` |
| `DATABASE_QUERY_EVENTS` | No | `true` ships query samples and top queries as logs (PostgreSQL, MySQL, MongoDB, SQL Server, Oracle). They contain query text. Default `false` |
| `DATABASE_SERVER_ID` | No | The id of a database OneUptime already shows (its Documentation tab has it). The data then joins that database directly, whatever address it reports (or none), and shows on its pages — use it in Kubernetes and for private IPs |

## What the config does

- Runs the engine's receiver against `DATABASE_ENDPOINT` and enables the useful metrics that are off upstream (for example `postgresql.blks_hit` / `postgresql.blks_read` for the cache hit ratio, `postgresql.wal.delay` for replication time lag, `mysql.query.count`, `sqlserver.deadlock.rate`, `oracledb.tablespace.utilization`, `redis.maxmemory`, `mongodb.uptime`, `jvm.memory.heap.utilization`). Each config lists further optional metrics in a comment.
- Stamps `db.system.name` (from `DATABASE_SYSTEM`), `server.address`, `server.port`, `oneuptime.database.agent` and `oneuptime.agent.version`, plus `oneuptime.database.server.id` when `DATABASE_SERVER_ID` is set. `service.name` is deleted so the data can never register a phantom Service, and `k8s.cluster.name` is never stamped — OneUptime would read it as the Kubernetes agent's heartbeat. The SQL Server and Oracle configs switch off their receivers' `host.name`, which would name the database machine as a Host.
- Has **no** `resourcedetection` processor on purpose: its `system` detector adds the agent machine's `host.name` / `os.type`, which would make that machine look like the thing being monitored instead of the database.
- Ships query samples and top queries as logs when `DATABASE_QUERY_EVENTS=true`, and (PostgreSQL, MySQL, Redis, MongoDB) has a commented `filelog` receiver for the engine's own log file (mount its directory at `/var/log/database` in `docker-compose.yml`).

## Alert on the database

The database's **Recommendations** tab in OneUptime offers ready-made monitors for its engine once the agent's metrics arrive. To build your own: the agent's data carries `oneuptime.database.server.id`, and a **Metrics** monitor over an engine metric that filters on that attribute (or groups by it) attaches its alerts and incidents to the database, and the database's scheduled maintenance applies to them.

Threshold gauges (connections, memory, replication lag) or a ratio of two gauges. A cumulative counter (deadlocks, slow queries, evictions) only ever grows and monitors have no rate, so add a `cumulativetodelta` processor for the counters you alert on — see [Alerts on a database](https://oneuptime.com/docs/telemetry/databases#alerts-on-a-database).

## Auto-tag with Project Labels

Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label on the database. Add it to the `resource` processor in `otel-collector-config.yaml`:

```yaml
processors:
  resource:
    attributes:
      # ...existing attributes...
      - key: oneuptime.label.team
        value: payments
        action: upsert
```

## Run as a systemd Service

```bash
sudo cp /opt/oneuptime-database-agent/systemd/oneuptime-database-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oneuptime-database-agent
```

The unit assumes `/opt/oneuptime-database-agent`. For a second database, copy it under a new name and change `WorkingDirectory`.

## Upgrading, Uninstalling

Re-run `install.sh` to pick up a new collector pin and config: your `.env` is reused, and `docker-compose.yml`, `otel-collector-config.yaml` and the systemd unit are replaced by the current versions. A file you had edited (`network_mode: host`, a `filelog` receiver and its mount, extra metrics) is kept next to the new one as `<file>.bak.<timestamp>`, and the script lists it at the end so you can re-apply the edit. The script records what it installed in `.agent-files.sha256`, so a file nobody edited is replaced without a copy, however much the new version changed; in a directory without that record (one you set up by hand) every file that differs from the new version is kept, since it may hold edits. To remove the agent: `cd /opt/oneuptime-database-agent && docker compose down`, then drop the monitoring user.

## Troubleshooting

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DatabaseAgent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-database-agent
```

It checks the container, the identity in `.env`, TCP reachability of the database from the agent's network, login / permission / TLS errors in the collector log (and any other receiver error, the most frequent first), and the ingestion key (OneUptime answers a bad key with a silent `200`, so only this check proves it). The key is handed to a pinned curl image on stdin, never on a command line. See the [docs](https://oneuptime.com/docs/telemetry/databases#troubleshooting) for the rest.
