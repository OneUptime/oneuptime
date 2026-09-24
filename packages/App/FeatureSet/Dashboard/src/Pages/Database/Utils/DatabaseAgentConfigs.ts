/*
 * GENERATED — do not edit by hand. The Database Agent's shipped files,
 * embedded verbatim so the in-app install guide shows exactly what
 * install.sh downloads:
 *
 *   agents/DatabaseAgent/configs/<engine>.yaml  → DATABASE_AGENT_CONFIGS
 *   agents/DatabaseAgent/docker-compose.yml     → DATABASE_AGENT_DOCKER_COMPOSE
 *   the compose file's collector image          → DATABASE_AGENT_COLLECTOR_IMAGE
 *
 * Each file is a template literal with three escapes applied, in this
 * order: every backslash doubled, then a backslash put before every
 * backtick and before every "${". When the agent changes, regenerate this
 * file with exactly those escapes and no other edit;
 * Common/Tests/App/Dashboard/DatabaseDocumentationMarkdown.test.ts fails
 * until the embedded copies byte-match the files on disk again.
 */

/**
 * The configs the Database Agent ships, by file name — which is the
 * collector receiver each one runs.
 */
export type DatabaseAgentEngine =
  | "postgresql"
  | "mysql"
  | "redis"
  | "mongodb"
  | "sqlserver"
  | "oracledb"
  | "elasticsearch"
  | "memcached";

export const DATABASE_AGENT_ENGINES: ReadonlyArray<DatabaseAgentEngine> = [
  "postgresql",
  "mysql",
  "redis",
  "mongodb",
  "sqlserver",
  "oracledb",
  "elasticsearch",
  "memcached",
];

export const DATABASE_AGENT_COLLECTOR_IMAGE: string =
  "otel/opentelemetry-collector-contrib:0.161.0";

export const DATABASE_AGENT_DOCKER_COMPOSE: string = `services:
  oneuptime-database-agent:
    # Upstream collector, pinned. There is no oneuptime/database-agent image —
    # the agent is entirely defined by otel-collector-config.yaml, which
    # install.sh downloads next to this file from configs/<receiver>.yaml.
    # The native postgresql / mysql / redis / mongodb / sqlserver / oracledb
    # / elasticsearch / memcached receivers talk to the database directly,
    # so no exporter sidecar is needed. This is the
    # version Tests/Ops/validate-collector-configs.sh validates the configs
    # against; bump the two together (and oneuptime.agent.version in every
    # configs/*.yaml).
    image: otel/opentelemetry-collector-contrib:0.161.0
    # Deliberately no container_name: one agent monitors ONE database, so a
    # machine watching several databases runs several copies of this file
    # in several directories, and Compose names each container after its
    # directory. Use \`docker compose ps\` / \`docker compose logs\` from the
    # install directory.
    # Lets DATABASE_ENDPOINT=host.docker.internal:<port> reach a database
    # running on this machine (outside Docker) on Linux too, as long as it
    # listens on the Docker bridge address as well as on 127.0.0.1.
    extra_hosts:
      - "host.docker.internal:host-gateway"
    # A database that listens on 127.0.0.1 ONLY cannot be reached from the
    # container's own network. Uncomment to share the machine's network
    # instead; DATABASE_ENDPOINT=localhost:<port> then works.
    # network_mode: host
    volumes:
      - ./otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml:ro
      # Uncomment (together with the filelog receiver in
      # otel-collector-config.yaml) to ship the database's own log files.
      # Mount the engine's log directory at /var/log/database, e.g.
      # /var/log/postgresql, /var/log/mysql, /var/log/redis or
      # /var/log/mongodb.
      # - /var/log/postgresql:/var/log/database:ro
    environment:
      - ONEUPTIME_URL=\${ONEUPTIME_URL}
      - ONEUPTIME_TELEMETRY_INGESTION_KEY=\${ONEUPTIME_TELEMETRY_INGESTION_KEY}
      # Which engine this agent monitors, stamped on every batch as
      # db.system.name: postgresql, mysql, mariadb, redis, valkey, keydb,
      # dragonfly, mongodb, microsoft.sql_server, oracle.db, elasticsearch,
      # opensearch or memcached. install.sh picks the matching
      # configs/<receiver>.yaml (mariadb → mysql.yaml, valkey → redis.yaml,
      # …) and reads this back on a re-run.
      - DATABASE_SYSTEM=\${DATABASE_SYSTEM}
      # host:port the agent connects to, e.g. db.internal:5432 — or
      # host.docker.internal:5432 / localhost:5432 when the agent runs next
      # to the database. A URL for Elasticsearch / OpenSearch
      # (http://search.internal:9200, or https:// for TLS).
      - DATABASE_ENDPOINT=\${DATABASE_ENDPOINT}
      # DATABASE_ENDPOINT's host and port apart, for the SQL Server
      # receiver, which takes them separately. install.sh writes both.
      - DATABASE_ENDPOINT_HOST=\${DATABASE_ENDPOINT_HOST:-}
      - DATABASE_ENDPOINT_PORT=\${DATABASE_ENDPOINT_PORT:-}
      # Oracle only: the service to connect to (FREEPDB1, ORCLPDB1, …).
      - DATABASE_ORACLE_SERVICE=\${DATABASE_ORACLE_SERVICE:-}
      # The database's identity in OneUptime, stamped on every metric as
      # server.address / server.port: the host name and port your
      # APPLICATIONS use to reach this database (what their traces report),
      # never localhost. Keep it stable — changing it later registers a
      # second database.
      - DATABASE_SERVER_ADDRESS=\${DATABASE_SERVER_ADDRESS}
      - DATABASE_SERVER_PORT=\${DATABASE_SERVER_PORT}
      # A dedicated read-only monitoring login (see README.md for the
      # least-privilege grants per engine). Optional for Redis, MongoDB and
      # Elasticsearch servers without authentication; Memcached has none.
      # The collector expands $ inside these values once more, so a literal
      # $ is written as $$ (install.sh does this for you).
      - DATABASE_USERNAME=\${DATABASE_USERNAME:-}
      - DATABASE_PASSWORD=\${DATABASE_PASSWORD:-}
      # true connects without TLS; false turns TLS on. Set
      # DATABASE_TLS_INSECURE_SKIP_VERIFY=true as well to accept a
      # certificate the collector image does not trust.
      - DATABASE_TLS_INSECURE=\${DATABASE_TLS_INSECURE:-true}
      - DATABASE_TLS_INSECURE_SKIP_VERIFY=\${DATABASE_TLS_INSECURE_SKIP_VERIFY:-false}
      # How often the database is queried for its statistics.
      - DATABASE_COLLECTION_INTERVAL=\${DATABASE_COLLECTION_INTERVAL:-30s}
      # true ships query samples and top queries (PostgreSQL, MySQL,
      # MongoDB, SQL Server and Oracle) as logs. They contain query text;
      # off by default.
      - DATABASE_QUERY_EVENTS=\${DATABASE_QUERY_EVENTS:-false}
      # Optional: the id of an existing database in OneUptime to attach
      # this data to directly (Databases → the database → Documentation).
      # Needed when DATABASE_SERVER_ADDRESS is a private IP or a name that
      # only resolves inside your network and the database is not in
      # OneUptime yet under that address — such names never register a
      # database on their own.
      - DATABASE_SERVER_ID=\${DATABASE_SERVER_ID:-}
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
`;

export const DATABASE_AGENT_CONFIGS: Record<DatabaseAgentEngine, string> = {
  postgresql: `# OneUptime Database Agent — PostgreSQL.
#
# ONE agent monitors ONE PostgreSQL server. The resource processor below
# stamps every batch with that server's identity (server.address /
# server.port), so a second server added to this pipeline would be merged
# into the first one in OneUptime. Run a second agent (a second install
# directory) for a second server.
#
# install.sh downloads this file as otel-collector-config.yaml next to
# docker-compose.yml. Every \${env:...} below comes from the .env file that
# docker-compose.yml passes through; see README.md for what each one means.

receivers:
  postgresql:
    # host:port the agent CONNECTS to. This may be localhost:5432 when the
    # agent runs next to the database — the identity OneUptime shows comes
    # from DATABASE_SERVER_ADDRESS / DATABASE_SERVER_PORT below, never
    # from this value.
    endpoint: "\${env:DATABASE_ENDPOINT}"
    transport: tcp
    # A dedicated monitoring login holding the built-in pg_monitor role
    # (see README.md). The receiver refuses to start without a password.
    username: "\${env:DATABASE_USERNAME}"
    password: "\${env:DATABASE_PASSWORD}"
    collection_interval: "\${env:DATABASE_COLLECTION_INTERVAL}"
    initial_delay: 1s
    # Internal databases of managed services that no customer login can
    # connect to. Excluding a database that does not exist is harmless, so
    # the list is safe on a self-hosted server too.
    exclude_databases:
      - rdsadmin
      - azure_maintenance
      - cloudsqladmin
      - alloydbadmin
      - alloydbmetadata
    tls:
      # true (the default in docker-compose.yml) connects WITHOUT TLS
      # (sslmode=disable). false turns TLS on; with insecure_skip_verify
      # true that is sslmode=require, with false it is verify-full.
      # The placeholders are deliberately UNQUOTED: a quoted "\${env:...}"
      # is a string and fails these boolean fields at startup.
      insecure: \${env:DATABASE_TLS_INSECURE}
      insecure_skip_verify: \${env:DATABASE_TLS_INSECURE_SKIP_VERIFY}
    metrics:
      # Off by default upstream. Enabled because they answer the questions
      # people ask first — buffer cache hit ratio, deadlocks, temp files,
      # row throughput, lock counts — on the database's Metrics tab. All of
      # them read pg_stat_database / pg_locks, which pg_monitor already
      # covers.
      postgresql.blks_hit:
        enabled: true
      postgresql.blks_read:
        enabled: true
      postgresql.deadlocks:
        enabled: true
      postgresql.temp_files:
        enabled: true
      postgresql.tup_fetched:
        enabled: true
      postgresql.tup_returned:
        enabled: true
      postgresql.tup_inserted:
        enabled: true
      postgresql.tup_updated:
        enabled: true
      postgresql.tup_deleted:
        enabled: true
      postgresql.database.locks:
        enabled: true
      # Other optional metrics the receiver can emit, all off by default.
      # Enable any of them the same way if you want them in OneUptime:
      #   postgresql.sequential_scans      (sequential scans per table; one series per table)
      #   postgresql.query.conflicts       (queries cancelled by recovery conflicts on a replica)
      #   postgresql.function.calls        (calls per user function; needs track_functions)
      #   postgresql.temp.io               (bytes written to temporary files)
      #   postgresql.wal.delay             (replication delay, the planned replacement for wal.lag)
    # Query samples (pg_stat_activity) and top queries (pg_stat_statements)
    # arrive as logs on the database's Logs tab. Both are off unless
    # DATABASE_QUERY_EVENTS=true. Top queries also need the
    # pg_stat_statements extension in every monitored database (see
    # README.md), and their explain plans need SELECT on the tables the
    # queries touch — pg_monitor grants none, so without it top queries
    # still arrive but with empty plans, and the collector logs "failed to
    # explain" for each one. They carry query text, so review what your
    # queries contain before turning them on.
    events:
      db.server.query_sample:
        enabled: \${env:DATABASE_QUERY_EVENTS}
      db.server.top_query:
        enabled: \${env:DATABASE_QUERY_EVENTS}

  # Optional: ship PostgreSQL's own log file. Uncomment this receiver, add
  # it to the logs pipeline at the bottom, and mount the server's log
  # directory at /var/log/database in docker-compose.yml, e.g.
  #   - /var/log/postgresql:/var/log/database:ro
  # The collector runs as a non-root user, so the files must be readable
  # by "other" (or run the container as a user in the postgres group).
  # filelog:
  #   include:
  #     - /var/log/database/*.log
  #   start_at: end

processors:
  # The identity of this database in OneUptime. OneUptime registers the
  # database from server.address + server.port (engine-agnostic) and joins
  # it to the queries your applications send to the same host:port, so
  # DATABASE_SERVER_ADDRESS must be the name applications use to reach the
  # server — never localhost. Keep it stable: changing it later registers
  # a second database. A name that is not unique across networks — a
  # private IP, a single-label name, a cluster-local Kubernetes name — only
  # joins a database that already owns it (create it in OneUptime first) or
  # the one DATABASE_SERVER_ID names; it never registers one on its own.
  resource:
    attributes:
      # The engine, from DATABASE_SYSTEM (postgresql).
      - key: db.system.name
        value: "\${env:DATABASE_SYSTEM}"
        action: upsert
      - key: server.address
        value: "\${env:DATABASE_SERVER_ADDRESS}"
        action: upsert
      # Unquoted on purpose: server.port is an integer attribute.
      - key: server.port
        value: \${env:DATABASE_SERVER_PORT}
        action: upsert
      # Tells OneUptime this batch was stamped by the Database Agent on
      # purpose, so server.address is trusted as the identity even when
      # it looks like a container id.
      - key: oneuptime.database.agent
        value: "true"
        action: upsert
      # Shown as the agent version on the database's page. Keep it in step
      # with the image pin in docker-compose.yml.
      - key: oneuptime.agent.version
        value: "0.161.0"
        action: upsert
      # Defensive: the receiver does not set service.name, but
      # OTEL_RESOURCE_ATTRIBUTES or a customised pipeline could. OneUptime
      # routes a batch by service.name first, so one that slipped through
      # would register a phantom Service instead of this database. Do not
      # remove this delete.
      - key: service.name
        action: delete
  # The OPTIONAL link to a database OneUptime already shows:
  # oneuptime.database.server.id, from DATABASE_SERVER_ID (Databases → the
  # database → Documentation has it, prefilled). When it is set, the data
  # joins that database directly instead of being matched by address — the
  # reliable choice in Kubernetes and for private IPs, which on their own
  # never register a database. It is set here rather than in the resource
  # processor above because that processor refuses to start on an empty
  # value, and the variable is empty unless you need it: the attribute is
  # set, then removed again when it is empty, so an unset id never reaches
  # OneUptime at all.
  #
  # Do not stamp k8s.cluster.name on this data: OneUptime reads that
  # attribute as the Kubernetes agent's heartbeat, so this agent would keep
  # the cluster looking connected (or register a new one on a typo).
  transform/optional_identity:
    error_mode: ignore
    metric_statements:
      - set(resource.attributes["oneuptime.database.server.id"], "\${env:DATABASE_SERVER_ID}")
      - delete_key(resource.attributes, "oneuptime.database.server.id") where resource.attributes["oneuptime.database.server.id"] == ""
    log_statements:
      - set(resource.attributes["oneuptime.database.server.id"], "\${env:DATABASE_SERVER_ID}")
      - delete_key(resource.attributes, "oneuptime.database.server.id") where resource.attributes["oneuptime.database.server.id"] == ""
  batch:
    timeout: 10s
    send_batch_size: 1024
  memory_limiter:
    check_interval: 5s
    limit_mib: 256
    spike_limit_mib: 64

# Deliberately NO resourcedetection processor: its \`system\` detector adds
# the host.name / os.type of the machine this agent runs on, which would
# make that machine look like the thing being monitored (a Host in
# OneUptime) instead of the database named above.

exporters:
  otlphttp:
    endpoint: "\${env:ONEUPTIME_URL}/otlp"
    headers:
      x-oneuptime-token: "\${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}"

service:
  pipelines:
    metrics:
      receivers: [postgresql]
      processors: [memory_limiter, resource, transform/optional_identity, batch]
      exporters: [otlphttp]
    # Query samples and top queries (DATABASE_QUERY_EVENTS=true). Add
    # filelog to the receivers when you enable it above.
    logs:
      receivers: [postgresql]
      processors: [memory_limiter, resource, transform/optional_identity, batch]
      exporters: [otlphttp]
`,
  mysql: `# OneUptime Database Agent — MySQL / MariaDB.
#
# ONE agent monitors ONE MySQL or MariaDB server. The resource processor
# below stamps every batch with that server's identity (server.address /
# server.port), so a second server added to this pipeline would be merged
# into the first one in OneUptime. Run a second agent (a second install
# directory) for a second server.
#
# install.sh downloads this file as otel-collector-config.yaml next to
# docker-compose.yml. Every \${env:...} below comes from the .env file that
# docker-compose.yml passes through; see README.md for what each one means.

receivers:
  mysql:
    # host:port the agent CONNECTS to. This may be localhost:3306 when the
    # agent runs next to the database — the identity OneUptime shows comes
    # from DATABASE_SERVER_ADDRESS / DATABASE_SERVER_PORT below, never
    # from this value.
    endpoint: "\${env:DATABASE_ENDPOINT}"
    transport: tcp
    # A dedicated monitoring login holding PROCESS, REPLICATION CLIENT and
    # SELECT on performance_schema (see README.md).
    username: "\${env:DATABASE_USERNAME}"
    password: "\${env:DATABASE_PASSWORD}"
    collection_interval: "\${env:DATABASE_COLLECTION_INTERVAL}"
    initial_delay: 1s
    tls:
      # true (the default in docker-compose.yml) connects WITHOUT TLS.
      # false turns TLS on; insecure_skip_verify true then accepts a
      # certificate the image does not trust.
      # The placeholders are deliberately UNQUOTED: a quoted "\${env:...}"
      # is a string and fails these boolean fields at startup.
      insecure: \${env:DATABASE_TLS_INSECURE}
      insecure_skip_verify: \${env:DATABASE_TLS_INSECURE_SKIP_VERIFY}
    resource_attributes:
      # The server version (e.g. 8.0.36 or 11.4.2), shown on the database's
      # page. The receiver reads it once, when it starts: an agent started
      # while the database was unreachable reports none until it restarts.
      db.system.version:
        enabled: true
    metrics:
      # Off by default upstream. Enabled because they answer the questions
      # people ask first — queries per second, slow queries, connection
      # attempts and errors, peak connections, per-command rates,
      # replication lag, client traffic — on the database's Metrics tab.
      # All of them read SHOW GLOBAL STATUS / SHOW REPLICA STATUS, which the
      # grants in README.md cover.
      mysql.query.count:
        enabled: true
      mysql.query.slow.count:
        enabled: true
      mysql.connection.count:
        enabled: true
      mysql.connection.errors:
        enabled: true
      mysql.max_used_connections:
        enabled: true
      mysql.commands:
        enabled: true
      mysql.replica.time_behind_source:
        enabled: true
      mysql.client.network.io:
        enabled: true
      # Other optional metrics the receiver can emit, all off by default.
      # Enable any of them the same way if you want them in OneUptime:
      #   mysql.query.client.count                (statements sent by clients)
      #   mysql.replica.sql_delay                 (configured replication delay)
      #   mysql.innodb.row_lock.wait.count        (InnoDB row lock waits)
      #   mysql.innodb.history_list.length        (undo history length; purge lag)
      #   mysql.innodb.transaction.active.count   (open InnoDB transactions)
      #   mysql.table.size                        (bytes per table; one series per table)
    # Query samples and top queries (performance_schema) arrive as logs on
    # the database's Logs tab. Both are off unless DATABASE_QUERY_EVENTS=
    # true, and both need performance_schema enabled plus SELECT on it.
    # They carry query text, so review what your queries contain before
    # turning them on.
    events:
      db.server.query_sample:
        enabled: \${env:DATABASE_QUERY_EVENTS}
      db.server.top_query:
        enabled: \${env:DATABASE_QUERY_EVENTS}

  # Optional: ship the MySQL error log. Uncomment this receiver, add it to
  # the logs pipeline at the bottom, and mount the server's log directory
  # at /var/log/database in docker-compose.yml, e.g.
  #   - /var/log/mysql:/var/log/database:ro
  # The collector runs as a non-root user, so the files must be readable
  # by "other" (or run the container as a user in the mysql group).
  # filelog:
  #   include:
  #     - /var/log/database/*.log
  #   start_at: end

processors:
  # The identity of this database in OneUptime. OneUptime registers the
  # database from server.address + server.port (engine-agnostic) and joins
  # it to the queries your applications send to the same host:port, so
  # DATABASE_SERVER_ADDRESS must be the name applications use to reach the
  # server — never localhost. Keep it stable: changing it later registers
  # a second database. A name that is not unique across networks — a
  # private IP, a single-label name, a cluster-local Kubernetes name — only
  # joins a database that already owns it (create it in OneUptime first) or
  # the one DATABASE_SERVER_ID names; it never registers one on its own.
  resource:
    attributes:
      # The engine, from DATABASE_SYSTEM: mysql, or mariadb for a MariaDB
      # server (the same config monitors both).
      - key: db.system.name
        value: "\${env:DATABASE_SYSTEM}"
        action: upsert
      - key: server.address
        value: "\${env:DATABASE_SERVER_ADDRESS}"
        action: upsert
      # Unquoted on purpose: server.port is an integer attribute.
      - key: server.port
        value: \${env:DATABASE_SERVER_PORT}
        action: upsert
      # Tells OneUptime this batch was stamped by the Database Agent on
      # purpose, so server.address is trusted as the identity even when
      # it looks like a container id.
      - key: oneuptime.database.agent
        value: "true"
        action: upsert
      # Shown as the agent version on the database's page. Keep it in step
      # with the image pin in docker-compose.yml.
      - key: oneuptime.agent.version
        value: "0.161.0"
        action: upsert
      # Defensive: the receiver does not set service.name, but
      # OTEL_RESOURCE_ATTRIBUTES or a customised pipeline could. OneUptime
      # routes a batch by service.name first, so one that slipped through
      # would register a phantom Service instead of this database. Do not
      # remove this delete.
      - key: service.name
        action: delete
  # The OPTIONAL link to a database OneUptime already shows:
  # oneuptime.database.server.id, from DATABASE_SERVER_ID (Databases → the
  # database → Documentation has it, prefilled). When it is set, the data
  # joins that database directly instead of being matched by address — the
  # reliable choice in Kubernetes and for private IPs, which on their own
  # never register a database. It is set here rather than in the resource
  # processor above because that processor refuses to start on an empty
  # value, and the variable is empty unless you need it: the attribute is
  # set, then removed again when it is empty, so an unset id never reaches
  # OneUptime at all.
  #
  # Do not stamp k8s.cluster.name on this data: OneUptime reads that
  # attribute as the Kubernetes agent's heartbeat, so this agent would keep
  # the cluster looking connected (or register a new one on a typo).
  transform/optional_identity:
    error_mode: ignore
    metric_statements:
      - set(resource.attributes["oneuptime.database.server.id"], "\${env:DATABASE_SERVER_ID}")
      - delete_key(resource.attributes, "oneuptime.database.server.id") where resource.attributes["oneuptime.database.server.id"] == ""
    log_statements:
      - set(resource.attributes["oneuptime.database.server.id"], "\${env:DATABASE_SERVER_ID}")
      - delete_key(resource.attributes, "oneuptime.database.server.id") where resource.attributes["oneuptime.database.server.id"] == ""
  batch:
    timeout: 10s
    send_batch_size: 1024
  memory_limiter:
    check_interval: 5s
    limit_mib: 256
    spike_limit_mib: 64

# Deliberately NO resourcedetection processor: its \`system\` detector adds
# the host.name / os.type of the machine this agent runs on, which would
# make that machine look like the thing being monitored (a Host in
# OneUptime) instead of the database named above.

exporters:
  otlphttp:
    endpoint: "\${env:ONEUPTIME_URL}/otlp"
    headers:
      x-oneuptime-token: "\${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}"

service:
  pipelines:
    metrics:
      receivers: [mysql]
      processors: [memory_limiter, resource, transform/optional_identity, batch]
      exporters: [otlphttp]
    # Query samples and top queries (DATABASE_QUERY_EVENTS=true). Add
    # filelog to the receivers when you enable it above.
    logs:
      receivers: [mysql]
      processors: [memory_limiter, resource, transform/optional_identity, batch]
      exporters: [otlphttp]
`,
  redis: `# OneUptime Database Agent — Redis (and Valkey, KeyDB and Dragonfly, which
# speak the same protocol and INFO format).
#
# ONE agent monitors ONE Redis server. The resource processor below stamps
# every batch with that server's identity (server.address / server.port),
# so a second server added to this pipeline would be merged into the first
# one in OneUptime. Run a second agent (a second install directory) for a
# second server — in a Redis replication setup, one per primary and one per
# replica.
#
# install.sh downloads this file as otel-collector-config.yaml next to
# docker-compose.yml. Every \${env:...} below comes from the .env file that
# docker-compose.yml passes through; see README.md for what each one means.

receivers:
  redis:
    # host:port the agent CONNECTS to. This may be localhost:6379 when the
    # agent runs next to the server — the identity OneUptime shows comes
    # from DATABASE_SERVER_ADDRESS / DATABASE_SERVER_PORT below, never
    # from this value.
    endpoint: "\${env:DATABASE_ENDPOINT}"
    transport: tcp
    # Optional. With Redis 6+ ACLs, a user allowed only INFO and PING (see
    # README.md). Leave DATABASE_USERNAME empty for a requirepass-only
    # server, and both empty for a server without authentication.
    username: "\${env:DATABASE_USERNAME}"
    password: "\${env:DATABASE_PASSWORD}"
    collection_interval: "\${env:DATABASE_COLLECTION_INTERVAL}"
    initial_delay: 1s
    tls:
      # true (the default in docker-compose.yml) connects WITHOUT TLS.
      # false turns TLS on; insecure_skip_verify true then accepts a
      # certificate the image does not trust.
      # The placeholders are deliberately UNQUOTED: a quoted "\${env:...}"
      # is a string and fails these boolean fields at startup.
      insecure: \${env:DATABASE_TLS_INSECURE}
      insecure_skip_verify: \${env:DATABASE_TLS_INSECURE_SKIP_VERIFY}
    resource_attributes:
      # Off by default upstream: without them a Redis batch carries nothing
      # that says which server it came from. The resource processor below
      # overwrites both with the identity you configured; they are enabled
      # so the receiver's own view is there if you remove that stamp.
      server.address:
        enabled: true
      server.port:
        enabled: true
    metrics:
      # Off by default upstream. Enabled because they answer the questions
      # people ask first — memory headroom against maxmemory, primary or
      # replica role, replica offset for replication lag, per-command
      # latency percentiles — on the database's Metrics tab. All of them
      # come from INFO, like the default metrics.
      redis.maxmemory:
        enabled: true
      redis.role:
        enabled: true
      redis.replication.replica_offset:
        enabled: true
      redis.cmd.latency:
        enabled: true
      # Other optional metrics the receiver can emit, all off by default.
      # Enable any of them the same way if you want them in OneUptime:
      #   redis.cmd.calls                     (calls per command)
      #   redis.cmd.usec                      (CPU time per command)
      #   redis.mode                          (standalone / cluster / sentinel)
      #   redis.cluster.state                 (Redis Cluster state; needs cluster mode)
      #   redis.cluster.slots_fail            (Redis Cluster slots in fail state)
      #   redis.memory.used_memory_overhead   (memory used by server internals)

  # Optional: ship the Redis log file. Uncomment this receiver, add a logs
  # pipeline for it at the bottom, and mount the server's log directory at
  # /var/log/database in docker-compose.yml, e.g.
  #   - /var/log/redis:/var/log/database:ro
  # The collector runs as a non-root user, so the files must be readable
  # by "other" (or run the container as a user in the redis group).
  # filelog:
  #   include:
  #     - /var/log/database/*.log
  #   start_at: end

processors:
  # The identity of this database in OneUptime. OneUptime registers the
  # database from server.address + server.port (engine-agnostic) and joins
  # it to the commands your applications send to the same host:port, so
  # DATABASE_SERVER_ADDRESS must be the name applications use to reach the
  # server — never localhost. Keep it stable: changing it later registers
  # a second database. A name that is not unique across networks — a
  # private IP, a single-label name, a cluster-local Kubernetes name — only
  # joins a database that already owns it (create it in OneUptime first) or
  # the one DATABASE_SERVER_ID names; it never registers one on its own.
  resource:
    attributes:
      # The engine, from DATABASE_SYSTEM: redis, or valkey, keydb or
      # dragonfly for those servers (the same config monitors all four).
      - key: db.system.name
        value: "\${env:DATABASE_SYSTEM}"
        action: upsert
      - key: server.address
        value: "\${env:DATABASE_SERVER_ADDRESS}"
        action: upsert
      # Unquoted on purpose: server.port is an integer attribute.
      - key: server.port
        value: \${env:DATABASE_SERVER_PORT}
        action: upsert
      # Tells OneUptime this batch was stamped by the Database Agent on
      # purpose, so server.address is trusted as the identity even when
      # it looks like a container id.
      - key: oneuptime.database.agent
        value: "true"
        action: upsert
      # Shown as the agent version on the database's page. Keep it in step
      # with the image pin in docker-compose.yml.
      - key: oneuptime.agent.version
        value: "0.161.0"
        action: upsert
      # Defensive: the receiver does not set service.name, but
      # OTEL_RESOURCE_ATTRIBUTES or a customised pipeline could. OneUptime
      # routes a batch by service.name first, so one that slipped through
      # would register a phantom Service instead of this database. Do not
      # remove this delete.
      - key: service.name
        action: delete
  # The OPTIONAL link to a database OneUptime already shows:
  # oneuptime.database.server.id, from DATABASE_SERVER_ID (Databases → the
  # database → Documentation has it, prefilled). When it is set, the data
  # joins that database directly instead of being matched by address — the
  # reliable choice in Kubernetes and for private IPs, which on their own
  # never register a database. It is set here rather than in the resource
  # processor above because that processor refuses to start on an empty
  # value, and the variable is empty unless you need it: the attribute is
  # set, then removed again when it is empty, so an unset id never reaches
  # OneUptime at all.
  #
  # Do not stamp k8s.cluster.name on this data: OneUptime reads that
  # attribute as the Kubernetes agent's heartbeat, so this agent would keep
  # the cluster looking connected (or register a new one on a typo).
  transform/optional_identity:
    error_mode: ignore
    metric_statements:
      - set(resource.attributes["oneuptime.database.server.id"], "\${env:DATABASE_SERVER_ID}")
      - delete_key(resource.attributes, "oneuptime.database.server.id") where resource.attributes["oneuptime.database.server.id"] == ""
    log_statements:
      - set(resource.attributes["oneuptime.database.server.id"], "\${env:DATABASE_SERVER_ID}")
      - delete_key(resource.attributes, "oneuptime.database.server.id") where resource.attributes["oneuptime.database.server.id"] == ""
  batch:
    timeout: 10s
    send_batch_size: 1024
  memory_limiter:
    check_interval: 5s
    limit_mib: 256
    spike_limit_mib: 64

# Deliberately NO resourcedetection processor: its \`system\` detector adds
# the host.name / os.type of the machine this agent runs on, which would
# make that machine look like the thing being monitored (a Host in
# OneUptime) instead of the database named above.

exporters:
  otlphttp:
    endpoint: "\${env:ONEUPTIME_URL}/otlp"
    headers:
      x-oneuptime-token: "\${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}"

service:
  pipelines:
    metrics:
      receivers: [redis]
      processors: [memory_limiter, resource, transform/optional_identity, batch]
      exporters: [otlphttp]
    # Redis has no query events. Uncomment together with the filelog
    # receiver above to ship the Redis log file:
    # logs:
    #   receivers: [filelog]
    #   processors: [memory_limiter, resource, transform/optional_identity, batch]
    #   exporters: [otlphttp]
`,
  mongodb: `# OneUptime Database Agent — MongoDB.
#
# ONE agent monitors ONE mongod (or mongos) process. The resource processor
# below stamps every batch with that server's identity (server.address /
# server.port), so a second server added to this pipeline would be merged
# into the first one in OneUptime. Run a second agent (a second install
# directory) for each replica-set member you want to see on its own.
#
# install.sh downloads this file as otel-collector-config.yaml next to
# docker-compose.yml. Every \${env:...} below comes from the .env file that
# docker-compose.yml passes through; see README.md for what each one means.

receivers:
  mongodb:
    hosts:
      # host:port the agent CONNECTS to. This may be localhost:27017 when
      # the agent runs next to the database — the identity OneUptime shows
      # comes from DATABASE_SERVER_ADDRESS / DATABASE_SERVER_PORT below,
      # never from this value.
      - endpoint: "\${env:DATABASE_ENDPOINT}"
    # One agent, one member: never follow the replica set to the other
    # members, whose metrics would be stamped with this member's identity.
    direct_connection: true
    # A dedicated monitoring user holding the built-in clusterMonitor role
    # (see README.md). Leave both empty for a server without
    # authentication; the receiver refuses one without the other.
    username: "\${env:DATABASE_USERNAME}"
    password: "\${env:DATABASE_PASSWORD}"
    collection_interval: "\${env:DATABASE_COLLECTION_INTERVAL}"
    initial_delay: 1s
    tls:
      # true (the default in docker-compose.yml) connects WITHOUT TLS.
      # false turns TLS on; insecure_skip_verify true then accepts a
      # certificate the image does not trust.
      # The placeholders are deliberately UNQUOTED: a quoted "\${env:...}"
      # is a string and fails these boolean fields at startup.
      insecure: \${env:DATABASE_TLS_INSECURE}
      insecure_skip_verify: \${env:DATABASE_TLS_INSECURE_SKIP_VERIFY}
    resource_attributes:
      # server.address is on by default upstream; the port is not. The
      # resource processor below overwrites both with the identity you
      # configured; they are enabled so the receiver's own view is there if
      # you remove that stamp.
      server.address:
        enabled: true
      server.port:
        enabled: true
      # The server version, shown on the database's page.
      db.system.version:
        enabled: true
    metrics:
      # Off by default upstream. Enabled because they answer the questions
      # people ask first — member health, uptime for restart detection,
      # operation latency, page faults, deadlocks, active readers and
      # writers — on the database's Metrics tab. clusterMonitor covers all
      # of them.
      mongodb.health:
        enabled: true
      mongodb.uptime:
        enabled: true
      mongodb.operation.latency.time:
        enabled: true
      mongodb.page_faults:
        enabled: true
      mongodb.lock.deadlock.count:
        enabled: true
      mongodb.active.reads:
        enabled: true
      mongodb.active.writes:
        enabled: true
      # Other optional metrics the receiver can emit, all off by default.
      # Enable any of them the same way if you want them in OneUptime:
      #   mongodb.operation.repl.count          (replicated operations applied on a secondary)
      #   mongodb.lock.acquire.count            (lock acquisitions by lock type and mode)
      #   mongodb.lock.acquire.wait_count       (lock acquisitions that had to wait)
      #   mongodb.wtcache.bytes.read            (bytes read into the WiredTiger cache)
      #   mongodb.wt.concurrent_transaction.ticket.in_use   (WiredTiger read/write tickets in use)
    # Query samples ($currentOp) and top queries (system.profile or getLog)
    # arrive as logs on the database's Logs tab. Both are off unless
    # DATABASE_QUERY_EVENTS=true. Explain plans on top queries additionally
    # need \`read\` on each monitored database (see README.md). They carry
    # query shapes, so review what your queries contain before turning them
    # on.
    events:
      db.server.query_sample:
        enabled: \${env:DATABASE_QUERY_EVENTS}
      db.server.top_query:
        enabled: \${env:DATABASE_QUERY_EVENTS}

  # Optional: ship mongod's own log (JSON lines since MongoDB 4.4).
  # Uncomment this receiver, add it to the logs pipeline at the bottom, and
  # mount the server's log directory at /var/log/database in
  # docker-compose.yml, e.g.
  #   - /var/log/mongodb:/var/log/database:ro
  # The collector runs as a non-root user, so the files must be readable
  # by "other" (or run the container as a user in the mongodb group).
  # filelog:
  #   include:
  #     - /var/log/database/*.log
  #   start_at: end

processors:
  # The identity of this database in OneUptime. OneUptime registers the
  # database from server.address + server.port (engine-agnostic) and joins
  # it to the queries your applications send to the same host:port, so
  # DATABASE_SERVER_ADDRESS must be the name applications use to reach the
  # server — never localhost. Keep it stable: changing it later registers
  # a second database. A name that is not unique across networks — a
  # private IP, a single-label name, a cluster-local Kubernetes name — only
  # joins a database that already owns it (create it in OneUptime first) or
  # the one DATABASE_SERVER_ID names; it never registers one on its own.
  resource:
    attributes:
      # The engine, from DATABASE_SYSTEM (mongodb).
      - key: db.system.name
        value: "\${env:DATABASE_SYSTEM}"
        action: upsert
      - key: server.address
        value: "\${env:DATABASE_SERVER_ADDRESS}"
        action: upsert
      # Unquoted on purpose: server.port is an integer attribute.
      - key: server.port
        value: \${env:DATABASE_SERVER_PORT}
        action: upsert
      # Tells OneUptime this batch was stamped by the Database Agent on
      # purpose, so server.address is trusted as the identity even when
      # it looks like a container id.
      - key: oneuptime.database.agent
        value: "true"
        action: upsert
      # Shown as the agent version on the database's page. Keep it in step
      # with the image pin in docker-compose.yml.
      - key: oneuptime.agent.version
        value: "0.161.0"
        action: upsert
      # Defensive: the receiver does not set service.name, but
      # OTEL_RESOURCE_ATTRIBUTES or a customised pipeline could. OneUptime
      # routes a batch by service.name first, so one that slipped through
      # would register a phantom Service instead of this database. Do not
      # remove this delete.
      - key: service.name
        action: delete
  # The OPTIONAL link to a database OneUptime already shows:
  # oneuptime.database.server.id, from DATABASE_SERVER_ID (Databases → the
  # database → Documentation has it, prefilled). When it is set, the data
  # joins that database directly instead of being matched by address — the
  # reliable choice in Kubernetes and for private IPs, which on their own
  # never register a database. It is set here rather than in the resource
  # processor above because that processor refuses to start on an empty
  # value, and the variable is empty unless you need it: the attribute is
  # set, then removed again when it is empty, so an unset id never reaches
  # OneUptime at all.
  #
  # Do not stamp k8s.cluster.name on this data: OneUptime reads that
  # attribute as the Kubernetes agent's heartbeat, so this agent would keep
  # the cluster looking connected (or register a new one on a typo).
  transform/optional_identity:
    error_mode: ignore
    metric_statements:
      - set(resource.attributes["oneuptime.database.server.id"], "\${env:DATABASE_SERVER_ID}")
      - delete_key(resource.attributes, "oneuptime.database.server.id") where resource.attributes["oneuptime.database.server.id"] == ""
    log_statements:
      - set(resource.attributes["oneuptime.database.server.id"], "\${env:DATABASE_SERVER_ID}")
      - delete_key(resource.attributes, "oneuptime.database.server.id") where resource.attributes["oneuptime.database.server.id"] == ""
  batch:
    timeout: 10s
    send_batch_size: 1024
  memory_limiter:
    check_interval: 5s
    limit_mib: 256
    spike_limit_mib: 64

# Deliberately NO resourcedetection processor: its \`system\` detector adds
# the host.name / os.type of the machine this agent runs on, which would
# make that machine look like the thing being monitored (a Host in
# OneUptime) instead of the database named above.

exporters:
  otlphttp:
    endpoint: "\${env:ONEUPTIME_URL}/otlp"
    headers:
      x-oneuptime-token: "\${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}"

service:
  pipelines:
    metrics:
      receivers: [mongodb]
      processors: [memory_limiter, resource, transform/optional_identity, batch]
      exporters: [otlphttp]
    # Query samples and top queries (DATABASE_QUERY_EVENTS=true). Add
    # filelog to the receivers when you enable it above.
    logs:
      receivers: [mongodb]
      processors: [memory_limiter, resource, transform/optional_identity, batch]
      exporters: [otlphttp]
`,
  sqlserver: `# OneUptime Database Agent — Microsoft SQL Server (and Azure SQL Managed
# Instance, Amazon RDS for SQL Server).
#
# ONE agent monitors ONE SQL Server instance. The resource processor below
# stamps every batch with that server's identity (server.address /
# server.port), so a second instance added to this pipeline would be merged
# into the first one in OneUptime. Run a second agent (a second install
# directory) for a second instance.
#
# install.sh downloads this file as otel-collector-config.yaml next to
# docker-compose.yml. Every \${env:...} below comes from the .env file that
# docker-compose.yml passes through; see README.md for what each one means.

receivers:
  sqlserver:
    # The host and port the agent CONNECTS to — DATABASE_ENDPOINT split in
    # two, because this receiver takes them separately (install.sh writes
    # both). This may be localhost when the agent runs next to the
    # database — the identity OneUptime shows comes from
    # DATABASE_SERVER_ADDRESS / DATABASE_SERVER_PORT below, never from this
    # value.
    server: "\${env:DATABASE_ENDPOINT_HOST}"
    # Unquoted on purpose: port is an integer field.
    port: \${env:DATABASE_ENDPOINT_PORT}
    # A dedicated SQL login holding VIEW SERVER STATE (VIEW SERVER
    # PERFORMANCE STATE on SQL Server 2022 and later) and VIEW ANY
    # DEFINITION (see README.md). The receiver refuses to start without a
    # username and password. The driver negotiates TLS with the server
    # (encrypting at least the login); a server that forces encryption is
    # fine. The password must not contain a semicolon: the receiver builds
    # an ADO connection string from it.
    username: "\${env:DATABASE_USERNAME}"
    password: "\${env:DATABASE_PASSWORD}"
    collection_interval: "\${env:DATABASE_COLLECTION_INTERVAL}"
    initial_delay: 1s
    resource_attributes:
      # On by default upstream, and the SQL Server machine's name: it would
      # make that machine look like a Host in OneUptime. This database's
      # identity is the stamp below.
      host.name:
        enabled: false
      # Off by default upstream. Named instances (SERVER\\INSTANCE) share a
      # host, so the instance name tells their series apart.
      sqlserver.instance.name:
        enabled: true
    metrics:
      # Off by default upstream. Enabled because they answer the questions
      # people ask first — deadlocks, blocked sessions, memory grants
      # waiting, CPU, file I/O and its latency, availability group lag — on
      # the database's Metrics tab. All of them read DMVs that VIEW SERVER
      # STATE covers.
      sqlserver.deadlock.rate:
        enabled: true
      sqlserver.processes.blocked:
        enabled: true
      sqlserver.memory.grants.pending.count:
        enabled: true
      sqlserver.cpu.utilization:
        enabled: true
      sqlserver.database.io:
        enabled: true
      sqlserver.database.latency:
        enabled: true
      sqlserver.availability_group.database_replica.secondary_lag:
        enabled: true
      # Other optional metrics the receiver can emit, all off by default.
      # Enable any of them the same way if you want them in OneUptime:
      #   sqlserver.lock.timeout.rate           (lock requests that timed out)
      #   sqlserver.os.wait.duration            (wait time per wait type; one series per wait type)
      #   sqlserver.database.count              (databases by state)
      #   sqlserver.memory.usage                (memory in use by SQL Server)
      #   sqlserver.database.tempdb.space       (free space in tempdb)
    # Query samples and top queries (sys.dm_exec_requests /
    # sys.dm_exec_query_stats) arrive as logs on the database's Logs tab.
    # Both are off unless DATABASE_QUERY_EVENTS=true. They carry query
    # text, so review what your queries contain before turning them on.
    events:
      db.server.query_sample:
        enabled: \${env:DATABASE_QUERY_EVENTS}
      db.server.top_query:
        enabled: \${env:DATABASE_QUERY_EVENTS}

processors:
  # The identity of this database in OneUptime. OneUptime registers the
  # database from server.address + server.port (engine-agnostic) and joins
  # it to the queries your applications send to the same host:port, so
  # DATABASE_SERVER_ADDRESS must be the name applications use to reach the
  # server — never localhost. Keep it stable: changing it later registers
  # a second database. A name that is not unique across networks — a
  # private IP, a single-label name, a cluster-local Kubernetes name — only
  # joins a database that already owns it (create it in OneUptime first) or
  # the one DATABASE_SERVER_ID names; it never registers one on its own.
  resource:
    attributes:
      # The engine, from DATABASE_SYSTEM (microsoft.sql_server).
      - key: db.system.name
        value: "\${env:DATABASE_SYSTEM}"
        action: upsert
      - key: server.address
        value: "\${env:DATABASE_SERVER_ADDRESS}"
        action: upsert
      # Unquoted on purpose: server.port is an integer attribute.
      - key: server.port
        value: \${env:DATABASE_SERVER_PORT}
        action: upsert
      # Tells OneUptime this batch was stamped by the Database Agent on
      # purpose, so server.address is trusted as the identity even when
      # it looks like a container id.
      - key: oneuptime.database.agent
        value: "true"
        action: upsert
      # Shown as the agent version on the database's page. Keep it in step
      # with the image pin in docker-compose.yml.
      - key: oneuptime.agent.version
        value: "0.161.0"
        action: upsert
      # Defensive: the receiver does not set service.name, but
      # OTEL_RESOURCE_ATTRIBUTES or a customised pipeline could. OneUptime
      # routes a batch by service.name first, so one that slipped through
      # would register a phantom Service instead of this database. Do not
      # remove this delete.
      - key: service.name
        action: delete
  # The OPTIONAL link to a database OneUptime already shows:
  # oneuptime.database.server.id, from DATABASE_SERVER_ID (Databases → the
  # database → Documentation has it, prefilled). When it is set, the data
  # joins that database directly instead of being matched by address — the
  # reliable choice in Kubernetes and for private IPs, which on their own
  # never register a database. It is set here rather than in the resource
  # processor above because that processor refuses to start on an empty
  # value, and the variable is empty unless you need it: the attribute is
  # set, then removed again when it is empty, so an unset id never reaches
  # OneUptime at all.
  #
  # Do not stamp k8s.cluster.name on this data: OneUptime reads that
  # attribute as the Kubernetes agent's heartbeat, so this agent would keep
  # the cluster looking connected (or register a new one on a typo).
  transform/optional_identity:
    error_mode: ignore
    metric_statements:
      - set(resource.attributes["oneuptime.database.server.id"], "\${env:DATABASE_SERVER_ID}")
      - delete_key(resource.attributes, "oneuptime.database.server.id") where resource.attributes["oneuptime.database.server.id"] == ""
    log_statements:
      - set(resource.attributes["oneuptime.database.server.id"], "\${env:DATABASE_SERVER_ID}")
      - delete_key(resource.attributes, "oneuptime.database.server.id") where resource.attributes["oneuptime.database.server.id"] == ""
  batch:
    timeout: 10s
    send_batch_size: 1024
  memory_limiter:
    check_interval: 5s
    limit_mib: 256
    spike_limit_mib: 64

# Deliberately NO resourcedetection processor: its \`system\` detector adds
# the host.name / os.type of the machine this agent runs on, which would
# make that machine look like the thing being monitored (a Host in
# OneUptime) instead of the database named above.

exporters:
  otlphttp:
    endpoint: "\${env:ONEUPTIME_URL}/otlp"
    headers:
      x-oneuptime-token: "\${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}"

service:
  pipelines:
    metrics:
      receivers: [sqlserver]
      processors: [memory_limiter, resource, transform/optional_identity, batch]
      exporters: [otlphttp]
    # Query samples and top queries (DATABASE_QUERY_EVENTS=true).
    logs:
      receivers: [sqlserver]
      processors: [memory_limiter, resource, transform/optional_identity, batch]
      exporters: [otlphttp]
`,
  oracledb: `# OneUptime Database Agent — Oracle Database (and Amazon RDS for Oracle,
# Oracle Autonomous Database over a plain TCP listener).
#
# ONE agent monitors ONE Oracle database (one service). The resource
# processor below stamps every batch with that database's identity
# (server.address / server.port), so a second database added to this
# pipeline would be merged into the first one in OneUptime. Run a second
# agent (a second install directory) for a second database.
#
# install.sh downloads this file as otel-collector-config.yaml next to
# docker-compose.yml. Every \${env:...} below comes from the .env file that
# docker-compose.yml passes through; see README.md for what each one means.

receivers:
  oracledb:
    # host:port of the listener the agent CONNECTS to. This may be
    # localhost:1521 when the agent runs next to the database — the
    # identity OneUptime shows comes from DATABASE_SERVER_ADDRESS /
    # DATABASE_SERVER_PORT below, never from this value.
    endpoint: "\${env:DATABASE_ENDPOINT}"
    # The service name to connect to: a pluggable database such as
    # FREEPDB1, ORCLPDB1 or XEPDB1, or the service of a non-CDB database.
    service: "\${env:DATABASE_ORACLE_SERVICE}"
    # A dedicated monitoring user holding CREATE SESSION and
    # SELECT_CATALOG_ROLE (see README.md). Any character is allowed in the
    # password; the connection is not encrypted (Oracle Native Network
    # Encryption, if the server requires it, is negotiated by the driver).
    username: "\${env:DATABASE_USERNAME}"
    password: "\${env:DATABASE_PASSWORD}"
    collection_interval: "\${env:DATABASE_COLLECTION_INTERVAL}"
    initial_delay: 1s
    resource_attributes:
      # On by default upstream, and the database machine's name: it would
      # make that machine look like a Host in OneUptime. This database's
      # identity is the stamp below.
      host.name:
        enabled: false
    metrics:
      # Off by default upstream. Enabled because they answer the questions
      # people ask first — DB time, how full each tablespace is, SGA sizing
      # — on the database's Metrics tab, connected to a pluggable database
      # or not. SELECT_CATALOG_ROLE covers all of them.
      oracledb.db.time:
        enabled: true
      oracledb.tablespace.utilization:
        enabled: true
      oracledb.sga.usage:
        enabled: true
      oracledb.sga.limit:
        enabled: true
      # Other optional metrics the receiver can emit, all off by default.
      # Enable any of them the same way if you want them in OneUptime. The
      # three *.utilization / *.rate ones come from V$SYSMETRIC, which a
      # connection to a pluggable database does not report — enable them
      # when DATABASE_ORACLE_SERVICE names a non-CDB database or the CDB root:
      #   oracledb.logons                      (logon operations)
      #   oracledb.transaction.rollbacks       (transactions rolled back)
      #   oracledb.storage.utilization         (share of allocated storage in use)
      #   oracledb.buffer_cache.utilization    (logical reads served from the buffer cache)
      #   oracledb.database.cpu.utilization    (share of DB time spent on CPU)
      #   oracledb.enqueue.deadlocks.rate      (enqueue deadlocks per second)
    # Query samples and top queries (V$SESSION / V$SQL) arrive as logs on
    # the database's Logs tab. Both are off unless DATABASE_QUERY_EVENTS=
    # true, and both need SELECT on V_$SQL (SELECT_CATALOG_ROLE has it).
    # They carry query text, so review what your queries contain before
    # turning them on.
    events:
      db.server.query_sample:
        enabled: \${env:DATABASE_QUERY_EVENTS}
      db.server.top_query:
        enabled: \${env:DATABASE_QUERY_EVENTS}

processors:
  # The identity of this database in OneUptime. OneUptime registers the
  # database from server.address + server.port (engine-agnostic) and joins
  # it to the queries your applications send to the same host:port, so
  # DATABASE_SERVER_ADDRESS must be the name applications use to reach the
  # server — never localhost. Keep it stable: changing it later registers
  # a second database. A name that is not unique across networks — a
  # private IP, a single-label name, a cluster-local Kubernetes name — only
  # joins a database that already owns it (create it in OneUptime first) or
  # the one DATABASE_SERVER_ID names; it never registers one on its own.
  resource:
    attributes:
      # The engine, from DATABASE_SYSTEM (oracle.db).
      - key: db.system.name
        value: "\${env:DATABASE_SYSTEM}"
        action: upsert
      - key: server.address
        value: "\${env:DATABASE_SERVER_ADDRESS}"
        action: upsert
      # Unquoted on purpose: server.port is an integer attribute.
      - key: server.port
        value: \${env:DATABASE_SERVER_PORT}
        action: upsert
      # Tells OneUptime this batch was stamped by the Database Agent on
      # purpose, so server.address is trusted as the identity even when
      # it looks like a container id.
      - key: oneuptime.database.agent
        value: "true"
        action: upsert
      # Shown as the agent version on the database's page. Keep it in step
      # with the image pin in docker-compose.yml.
      - key: oneuptime.agent.version
        value: "0.161.0"
        action: upsert
      # Defensive: the receiver does not set service.name, but
      # OTEL_RESOURCE_ATTRIBUTES or a customised pipeline could. OneUptime
      # routes a batch by service.name first, so one that slipped through
      # would register a phantom Service instead of this database. Do not
      # remove this delete.
      - key: service.name
        action: delete
  # The OPTIONAL link to a database OneUptime already shows:
  # oneuptime.database.server.id, from DATABASE_SERVER_ID (Databases → the
  # database → Documentation has it, prefilled). When it is set, the data
  # joins that database directly instead of being matched by address — the
  # reliable choice in Kubernetes and for private IPs, which on their own
  # never register a database. It is set here rather than in the resource
  # processor above because that processor refuses to start on an empty
  # value, and the variable is empty unless you need it: the attribute is
  # set, then removed again when it is empty, so an unset id never reaches
  # OneUptime at all.
  #
  # Do not stamp k8s.cluster.name on this data: OneUptime reads that
  # attribute as the Kubernetes agent's heartbeat, so this agent would keep
  # the cluster looking connected (or register a new one on a typo).
  transform/optional_identity:
    error_mode: ignore
    metric_statements:
      - set(resource.attributes["oneuptime.database.server.id"], "\${env:DATABASE_SERVER_ID}")
      - delete_key(resource.attributes, "oneuptime.database.server.id") where resource.attributes["oneuptime.database.server.id"] == ""
    log_statements:
      - set(resource.attributes["oneuptime.database.server.id"], "\${env:DATABASE_SERVER_ID}")
      - delete_key(resource.attributes, "oneuptime.database.server.id") where resource.attributes["oneuptime.database.server.id"] == ""
  batch:
    timeout: 10s
    send_batch_size: 1024
  memory_limiter:
    check_interval: 5s
    limit_mib: 256
    spike_limit_mib: 64

# Deliberately NO resourcedetection processor: its \`system\` detector adds
# the host.name / os.type of the machine this agent runs on, which would
# make that machine look like the thing being monitored (a Host in
# OneUptime) instead of the database named above.

exporters:
  otlphttp:
    endpoint: "\${env:ONEUPTIME_URL}/otlp"
    headers:
      x-oneuptime-token: "\${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}"

service:
  pipelines:
    metrics:
      receivers: [oracledb]
      processors: [memory_limiter, resource, transform/optional_identity, batch]
      exporters: [otlphttp]
    # Query samples and top queries (DATABASE_QUERY_EVENTS=true).
    logs:
      receivers: [oracledb]
      processors: [memory_limiter, resource, transform/optional_identity, batch]
      exporters: [otlphttp]
`,
  elasticsearch: `# OneUptime Database Agent — Elasticsearch (and OpenSearch, whose node,
# cluster and index statistics APIs this receiver reads the same way).
#
# ONE agent monitors ONE cluster: it reads the statistics of every node
# and index through the endpoint below, and the resource processor stamps
# every batch with the cluster's identity (server.address / server.port) —
# each node's series stay apart by elasticsearch.node.name. A second
# cluster added to this pipeline would be merged into the first one in
# OneUptime. Run a second agent (a second install directory) for a second
# cluster.
#
# install.sh downloads this file as otel-collector-config.yaml next to
# docker-compose.yml. Every \${env:...} below comes from the .env file that
# docker-compose.yml passes through; see README.md for what each one means.

receivers:
  elasticsearch:
    # The URL the agent CONNECTS to — http:// or https://, which is how TLS
    # is chosen for this engine (install.sh builds it from
    # DATABASE_TLS_INSECURE). It may be http://localhost:9200 when the
    # agent runs next to the cluster — the identity OneUptime shows comes
    # from DATABASE_SERVER_ADDRESS / DATABASE_SERVER_PORT below, never from
    # this value.
    endpoint: "\${env:DATABASE_ENDPOINT}"
    # Optional: a user holding the \`monitor\` cluster privilege and
    # \`monitor\` on the indices (see README.md). Leave both empty for a
    # cluster without security.
    username: "\${env:DATABASE_USERNAME}"
    password: "\${env:DATABASE_PASSWORD}"
    collection_interval: "\${env:DATABASE_COLLECTION_INTERVAL}"
    initial_delay: 1s
    tls:
      # Used with an https:// endpoint: true accepts a certificate the
      # collector image does not trust (self-signed, private CA). Unquoted
      # on purpose: a quoted "\${env:...}" is a string and fails this
      # boolean field at startup.
      insecure_skip_verify: \${env:DATABASE_TLS_INSECURE_SKIP_VERIFY}
    metrics:
      # Off by default upstream. Enabled because they answer the questions
      # people ask first — heap pressure, CPU, searches in flight — on the
      # database's Metrics tab. The \`monitor\` privilege covers all of them.
      jvm.memory.heap.utilization:
        enabled: true
      elasticsearch.process.cpu.usage:
        enabled: true
      elasticsearch.node.operations.current:
        enabled: true
      # Other optional metrics the receiver can emit, all off by default.
      # Enable any of them the same way if you want them in OneUptime:
      #   elasticsearch.node.cache.size                  (query cache memory per node)
      #   elasticsearch.index.segments.size              (segment size per index)
      #   elasticsearch.cluster.indices.cache.evictions  (cache evictions across the cluster)
      #   elasticsearch.index.cache.evictions            (cache evictions per index)

processors:
  # The identity of this database in OneUptime. OneUptime registers the
  # database from server.address + server.port (engine-agnostic) and joins
  # it to the requests your applications send to the same host:port, so
  # DATABASE_SERVER_ADDRESS must be the name applications use to reach the
  # cluster — never localhost. Keep it stable: changing it later registers
  # a second database. A name that is not unique across networks — a
  # private IP, a single-label name, a cluster-local Kubernetes name — only
  # joins a database that already owns it (create it in OneUptime first) or
  # the one DATABASE_SERVER_ID names; it never registers one on its own.
  resource:
    attributes:
      # The engine, from DATABASE_SYSTEM: elasticsearch, or opensearch for
      # an OpenSearch cluster (the same config monitors both).
      - key: db.system.name
        value: "\${env:DATABASE_SYSTEM}"
        action: upsert
      - key: server.address
        value: "\${env:DATABASE_SERVER_ADDRESS}"
        action: upsert
      # Unquoted on purpose: server.port is an integer attribute.
      - key: server.port
        value: \${env:DATABASE_SERVER_PORT}
        action: upsert
      # Tells OneUptime this batch was stamped by the Database Agent on
      # purpose, so server.address is trusted as the identity even when
      # it looks like a container id.
      - key: oneuptime.database.agent
        value: "true"
        action: upsert
      # Shown as the agent version on the database's page. Keep it in step
      # with the image pin in docker-compose.yml.
      - key: oneuptime.agent.version
        value: "0.161.0"
        action: upsert
      # Defensive: the receiver does not set service.name, but
      # OTEL_RESOURCE_ATTRIBUTES or a customised pipeline could. OneUptime
      # routes a batch by service.name first, so one that slipped through
      # would register a phantom Service instead of this database. Do not
      # remove this delete.
      - key: service.name
        action: delete
  # The OPTIONAL link to a database OneUptime already shows:
  # oneuptime.database.server.id, from DATABASE_SERVER_ID (Databases → the
  # database → Documentation has it, prefilled). When it is set, the data
  # joins that database directly instead of being matched by address — the
  # reliable choice in Kubernetes and for private IPs, which on their own
  # never register a database. It is set here rather than in the resource
  # processor above because that processor refuses to start on an empty
  # value, and the variable is empty unless you need it: the attribute is
  # set, then removed again when it is empty, so an unset id never reaches
  # OneUptime at all.
  #
  # Do not stamp k8s.cluster.name on this data: OneUptime reads that
  # attribute as the Kubernetes agent's heartbeat, so this agent would keep
  # the cluster looking connected (or register a new one on a typo).
  transform/optional_identity:
    error_mode: ignore
    metric_statements:
      - set(resource.attributes["oneuptime.database.server.id"], "\${env:DATABASE_SERVER_ID}")
      - delete_key(resource.attributes, "oneuptime.database.server.id") where resource.attributes["oneuptime.database.server.id"] == ""
    log_statements:
      - set(resource.attributes["oneuptime.database.server.id"], "\${env:DATABASE_SERVER_ID}")
      - delete_key(resource.attributes, "oneuptime.database.server.id") where resource.attributes["oneuptime.database.server.id"] == ""
  batch:
    timeout: 10s
    send_batch_size: 1024
  memory_limiter:
    check_interval: 5s
    limit_mib: 256
    spike_limit_mib: 64

# Deliberately NO resourcedetection processor: its \`system\` detector adds
# the host.name / os.type of the machine this agent runs on, which would
# make that machine look like the thing being monitored (a Host in
# OneUptime) instead of the database named above.

exporters:
  otlphttp:
    endpoint: "\${env:ONEUPTIME_URL}/otlp"
    headers:
      x-oneuptime-token: "\${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}"

service:
  pipelines:
    metrics:
      receivers: [elasticsearch]
      processors: [memory_limiter, resource, transform/optional_identity, batch]
      exporters: [otlphttp]
`,
  memcached: `# OneUptime Database Agent — Memcached.
#
# ONE agent monitors ONE memcached server. The resource processor below
# stamps every batch with that server's identity (server.address /
# server.port), so a second server added to this pipeline would be merged
# into the first one in OneUptime. Run a second agent (a second install
# directory) for a second server.
#
# install.sh downloads this file as otel-collector-config.yaml next to
# docker-compose.yml. Every \${env:...} below comes from the .env file that
# docker-compose.yml passes through; see README.md for what each one means.

receivers:
  memcached:
    # host:port the agent CONNECTS to. This may be localhost:11211 when the
    # agent runs next to the server — the identity OneUptime shows comes
    # from DATABASE_SERVER_ADDRESS / DATABASE_SERVER_PORT below, never
    # from this value.
    endpoint: "\${env:DATABASE_ENDPOINT}"
    # Required: the receiver refuses to start without a transport.
    transport: tcp
    # The receiver runs \`stats\` over the plain text protocol, so it needs
    # no login (and cannot use SASL or TLS).
    collection_interval: "\${env:DATABASE_COLLECTION_INTERVAL}"
    initial_delay: 1s
    # Every metric the receiver emits — connections, commands, hits and
    # misses, evictions, memory, threads, CPU — is on by default.

processors:
  # The identity of this database in OneUptime. OneUptime registers the
  # database from server.address + server.port (engine-agnostic) and joins
  # it to the commands your applications send to the same host:port, so
  # DATABASE_SERVER_ADDRESS must be the name applications use to reach the
  # server — never localhost. Keep it stable: changing it later registers
  # a second database. A name that is not unique across networks — a
  # private IP, a single-label name, a cluster-local Kubernetes name — only
  # joins a database that already owns it (create it in OneUptime first) or
  # the one DATABASE_SERVER_ID names; it never registers one on its own.
  resource:
    attributes:
      # The engine, from DATABASE_SYSTEM (memcached).
      - key: db.system.name
        value: "\${env:DATABASE_SYSTEM}"
        action: upsert
      - key: server.address
        value: "\${env:DATABASE_SERVER_ADDRESS}"
        action: upsert
      # Unquoted on purpose: server.port is an integer attribute.
      - key: server.port
        value: \${env:DATABASE_SERVER_PORT}
        action: upsert
      # Tells OneUptime this batch was stamped by the Database Agent on
      # purpose, so server.address is trusted as the identity even when
      # it looks like a container id.
      - key: oneuptime.database.agent
        value: "true"
        action: upsert
      # Shown as the agent version on the database's page. Keep it in step
      # with the image pin in docker-compose.yml.
      - key: oneuptime.agent.version
        value: "0.161.0"
        action: upsert
      # Defensive: the receiver does not set service.name, but
      # OTEL_RESOURCE_ATTRIBUTES or a customised pipeline could. OneUptime
      # routes a batch by service.name first, so one that slipped through
      # would register a phantom Service instead of this database. Do not
      # remove this delete.
      - key: service.name
        action: delete
  # The OPTIONAL link to a database OneUptime already shows:
  # oneuptime.database.server.id, from DATABASE_SERVER_ID (Databases → the
  # database → Documentation has it, prefilled). When it is set, the data
  # joins that database directly instead of being matched by address — the
  # reliable choice in Kubernetes and for private IPs, which on their own
  # never register a database. It is set here rather than in the resource
  # processor above because that processor refuses to start on an empty
  # value, and the variable is empty unless you need it: the attribute is
  # set, then removed again when it is empty, so an unset id never reaches
  # OneUptime at all.
  #
  # Do not stamp k8s.cluster.name on this data: OneUptime reads that
  # attribute as the Kubernetes agent's heartbeat, so this agent would keep
  # the cluster looking connected (or register a new one on a typo).
  transform/optional_identity:
    error_mode: ignore
    metric_statements:
      - set(resource.attributes["oneuptime.database.server.id"], "\${env:DATABASE_SERVER_ID}")
      - delete_key(resource.attributes, "oneuptime.database.server.id") where resource.attributes["oneuptime.database.server.id"] == ""
    log_statements:
      - set(resource.attributes["oneuptime.database.server.id"], "\${env:DATABASE_SERVER_ID}")
      - delete_key(resource.attributes, "oneuptime.database.server.id") where resource.attributes["oneuptime.database.server.id"] == ""
  batch:
    timeout: 10s
    send_batch_size: 1024
  memory_limiter:
    check_interval: 5s
    limit_mib: 256
    spike_limit_mib: 64

# Deliberately NO resourcedetection processor: its \`system\` detector adds
# the host.name / os.type of the machine this agent runs on, which would
# make that machine look like the thing being monitored (a Host in
# OneUptime) instead of the database named above.

exporters:
  otlphttp:
    endpoint: "\${env:ONEUPTIME_URL}/otlp"
    headers:
      x-oneuptime-token: "\${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}"

service:
  pipelines:
    metrics:
      receivers: [memcached]
      processors: [memory_limiter, resource, transform/optional_identity, batch]
      exporters: [otlphttp]
`,
};
