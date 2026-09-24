# OneUptime Database Agent

Collect engine metrics — connections, throughput, cache hit ratio, locks, replication lag, memory — from PostgreSQL, MySQL/MariaDB, Redis/Valkey and MongoDB with OneUptime, using a pre-configured OpenTelemetry Collector.

The agent is config-only: a stock `otel/opentelemetry-collector-contrib` container running the collector's native receiver for your engine, with a config that stamps every batch with the database's identity and ships it to OneUptime over OTLP. No exporter sidecar and nothing installed on the database server.

**One agent monitors one database server.** The identity (`server.address` / `server.port`) is stamped on everything the agent sends, so a second server added to the same config would merge into the first. Install a second copy in a second directory for a second server.

The full guide — how databases are detected without any agent, what each source provides, Kubernetes, endpoints and troubleshooting — is at [oneuptime.com/docs/telemetry/databases](https://oneuptime.com/docs/telemetry/databases).

## Files

| File | What it is |
| --- | --- |
| `docker-compose.yml` | The collector container (pinned image) and the environment it reads |
| `configs/postgresql.yaml` | Collector config for PostgreSQL |
| `configs/mysql.yaml` | Collector config for MySQL and MariaDB |
| `configs/redis.yaml` | Collector config for Redis and Valkey |
| `configs/mongodb.yaml` | Collector config for MongoDB |
| `install.sh` | Asks for the engine, endpoint and credentials, downloads the matching config as `otel-collector-config.yaml`, writes `.env` and starts the agent |
| `troubleshoot.sh` | Checks the whole chain and names the most likely problem |
| `systemd/oneuptime-database-agent.service` | Optional systemd unit |

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

### MySQL / MariaDB

```sql
CREATE USER 'oneuptime_monitor'@'%' IDENTIFIED BY 'a-strong-password';
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'oneuptime_monitor'@'%';
GRANT SELECT ON performance_schema.* TO 'oneuptime_monitor'@'%';
```

`PROCESS` and `REPLICATION CLIENT` cover `SHOW GLOBAL STATUS`, InnoDB status and replica status; `performance_schema` is needed for query samples and top queries.

### Redis / Valkey

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

## Quick Start — Install Script

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DatabaseAgent/install.sh -o install.sh
bash install.sh
```

The script asks for your OneUptime URL and ingestion key, the engine, the endpoint to connect to and the monitoring credentials (the password is read without echo), installs to `/opt/oneuptime-database-agent`, writes a `0600` `.env` file, and starts the agent. When the endpoint is local to the machine (`localhost`, `host.docker.internal`), it also asks for the host name your applications use — that name is the database's identity in OneUptime. When that name is a private IP, a single-label or a cluster-local name, it asks for the database's id in OneUptime (`DATABASE_SERVER_ID`) as well, because such a name never creates a database on its own.

Every prompt can be answered up front with an exported variable of the same name, for example `INSTALL_DIR=/opt/oneuptime-database-agent-orders DATABASE_SYSTEM=postgresql bash install.sh`. Re-running the script reuses every value in your existing `.env` (nothing is prompted for again) and refreshes only the downloaded files.

## Quick Start — Docker Compose

Download `docker-compose.yml` and the config for your engine from `configs/`, saved as `otel-collector-config.yaml`, into one folder. Create a `.env` file next to them (`chmod 600 .env` — it holds a password):

```bash
ONEUPTIME_URL=https://oneuptime.com
ONEUPTIME_TELEMETRY_INGESTION_KEY=your-telemetry-ingestion-key
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
```

Then start the agent:

```bash
docker compose up -d
```

The database appears automatically under **Databases** in OneUptime after the first collection — or, if OneUptime already detected it from traces or containers at the same address, its **Engine metrics** status turns to Connected. For a private IP or a name that only resolves inside your network, create the database first (**Databases → Create Database**, same address and port) or set `DATABASE_SERVER_ID`.

To run the agent inside Kubernetes (a Deployment next to the database, with `DATABASE_SERVER_ID` pointing at the database the Kubernetes agent detected), see [the Kubernetes section of the docs](https://oneuptime.com/docs/telemetry/databases#kubernetes).

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key (_Project Settings → Telemetry & APM → Ingestion Keys_) |
| `DATABASE_SYSTEM` | Yes | `postgresql`, `mysql`, `redis` or `mongodb` — which `configs/<engine>.yaml` install.sh downloads |
| `DATABASE_ENDPOINT` | Yes | `host:port` the agent connects to. May be `host.docker.internal:<port>` when the agent runs on the database machine |
| `DATABASE_SERVER_ADDRESS` | Yes | The database's identity: the host name your applications use to reach it. Never `localhost` — OneUptime ignores local-only addresses. A name that is not unique across networks (a private IP, a single-label name, a cluster-local Kubernetes name) only joins a database that already has it as an endpoint, or the one `DATABASE_SERVER_ID` names — create the database in OneUptime first |
| `DATABASE_SERVER_PORT` | Yes | The port your applications use |
| `DATABASE_USERNAME` | PostgreSQL, MySQL | The monitoring user. Optional for Redis and MongoDB without authentication |
| `DATABASE_PASSWORD` | PostgreSQL | Its password. Single-quote it in `.env` if it contains `$`, `#` or spaces (`install.sh` does this for you) |
| `DATABASE_TLS_INSECURE` | No | `true` (default) connects without TLS, `false` turns TLS on |
| `DATABASE_TLS_INSECURE_SKIP_VERIFY` | No | `true` accepts a certificate the collector image does not trust. Default `false` |
| `DATABASE_COLLECTION_INTERVAL` | No | How often statistics are read. Default `30s` |
| `DATABASE_QUERY_EVENTS` | No | `true` ships query samples and top queries as logs (PostgreSQL, MySQL, MongoDB). They contain query text. Default `false` |
| `DATABASE_SERVER_ID` | No | The id of a database OneUptime already shows (its Documentation tab has it). The data then joins that database directly, whatever the address — use it in Kubernetes and for private IPs |

## What the config does

- Runs the engine's receiver against `DATABASE_ENDPOINT` and enables the useful metrics that are off upstream (for example `postgresql.blks_hit` / `postgresql.blks_read` for the cache hit ratio, `mysql.query.count`, `redis.maxmemory`, `mongodb.health`). Each config lists further optional metrics in a comment.
- Stamps `db.system.name`, `server.address`, `server.port`, `oneuptime.database.agent` and `oneuptime.agent.version`, plus `oneuptime.database.server.id` when `DATABASE_SERVER_ID` is set. `service.name` is deleted so the data can never register a phantom Service, and `k8s.cluster.name` is never stamped — OneUptime would read it as the Kubernetes agent's heartbeat.
- Has **no** `resourcedetection` processor on purpose: its `system` detector adds the agent machine's `host.name` / `os.type`, which would make that machine look like the thing being monitored instead of the database.
- Ships query samples and top queries as logs when `DATABASE_QUERY_EVENTS=true`, and has a commented `filelog` receiver for the engine's own log file (mount its directory at `/var/log/database` in `docker-compose.yml`).

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

Re-run `install.sh` to pick up a new collector pin and config (your `.env` is reused). To remove the agent: `cd /opt/oneuptime-database-agent && docker compose down`, then drop the monitoring user.

## Troubleshooting

```bash
curl -sSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DatabaseAgent/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside /opt/oneuptime-database-agent
```

It checks the container, the identity in `.env`, TCP reachability of the database from the agent's network, login / permission / TLS errors in the collector log, and the ingestion key (OneUptime answers a bad key with a silent `200`, so only this check proves it). See the [docs](https://oneuptime.com/docs/telemetry/databases#troubleshooting) for the rest.
