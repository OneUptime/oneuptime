import { ContainerCommandRole } from "../../../Types/DatabaseServer/DatabaseContainerCommand";

/*
 * Real-world container command lines, as Kubernetes pod specs carry them
 * (`command` and `args`), with what each one runs. Shared by
 * DatabaseContainerCommand.test.ts (the JavaScript rules) and
 * DatabaseContainerCommandPostgres.test.ts (the same rules after the
 * Postgres projection), so both are held to one table.
 *
 * "server" means "possibly the database server": only positive evidence of
 * a client, a keep-alive or a Sentinel makes a container anything else.
 */
export interface ContainerCommandCase {
  name: string;
  command?: Array<string> | undefined;
  args?: Array<string> | undefined;
  role: ContainerCommandRole;
}

// MongoDB Community Operator, controllers/construct/mongodbstatefulset.go.
const MONGODB_COMMUNITY_MONGOD_SCRIPT: string = `
if [ -e "/hooks/version-upgrade" ]; then
	#run post-start hook to handle version changes (if exists)
    /hooks/version-upgrade
fi

# wait for config and keyfile to be created by the agent
 while ! [ -f /data/automation-mongod.conf -a -f /var/lib/mongodb-mms-automation/authentication/keyfile ]; do sleep 3 ; done ; sleep 2 ;

# start mongod with this configuration
exec mongod -f /data/automation-mongod.conf;

`;

const MONGODB_COMMUNITY_AGENT_SCRIPT: string = `current_uid=$(id -u)
AGENT_API_KEY="$(cat /mongodb-automation/agent-api-key/agentApiKey)"
declare -r current_uid
if ! grep -q "\${current_uid}" /etc/passwd ; then
sed -e "s/^mongodb:/builder:/" /etc/passwd > /tmp/passwd
echo "mongodb:x:$(id -u):$(id -g):,,,:/:/bin/bash" >> /tmp/passwd
export NSS_WRAPPER_PASSWD=/tmp/passwd
export LD_PRELOAD=libnss_wrapper.so
export NSS_WRAPPER_GROUP=/etc/group
fi
agent/mongodb-agent -healthCheckFilePath=/var/log/mongodb-mms-automation/healthstatus/agent-health-status.json -serveStatusPort=5000 -cluster=/var/lib/automation/config/cluster-config.json -skipMongoStart -noDaemonize -useLocalMongoDbTools`;

// cockroachdb/cockroach cloud/kubernetes/cockroachdb-statefulset.yaml.
const COCKROACHDB_START_SCRIPT: string =
  "exec /cockroach/cockroach start --logtostderr --insecure --advertise-host $(hostname -f) --http-addr 0.0.0.0 --join cockroachdb-0.cockroachdb,cockroachdb-1.cockroachdb,cockroachdb-2.cockroachdb --cache $(expr $MEMORY_LIMIT_MIB / 4)MiB --max-sql-memory $(expr $MEMORY_LIMIT_MIB / 4)MiB";

// scylla-operator's scylla container.
const SCYLLA_SCRIPT: string = `printf '{"L":"INFO","T":"%s","M":"Waiting for /mnt/shared/ignition.done"}\\n' "$( date -u '+%Y-%m-%dT%H:%M:%S,%3NZ' )" > /dev/stderr
until [[ -f "/mnt/shared/ignition.done" ]]; do
  sleep 1;
done
exec /mnt/shared/scylla-operator sidecar --service-name=$(SERVICE_NAME) --cpu-count=$(CPU_COUNT) -- "$@"`;

// Crunchy PGO's replication-cert-copy sidecar (crunchy-postgres image).
const CRUNCHY_CERT_COPY_SCRIPT: string = `
monitor() {
declare -r mode=0600
exec {fd}<> <(:||:)
while read -r -t 5 -u "\${fd}" ||:; do
  install -m "\${mode}" /pgconf/tls/replication/tls.crt /tmp/replication/tls.crt
done
}; export -f monitor; exec -a "$0" bash -ceu monitor`;

export const SERVER_COMMANDS: Array<ContainerCommandCase> = [
  {
    name: "the image's own entrypoint (official images, Spilo)",
    role: "server",
  },
  { name: "empty command and args", command: [], args: [], role: "server" },
  {
    name: "official postgres with server settings",
    args: ["postgres", "-c", "max_connections=200", "-c", "shared_buffers=1GB"],
    role: "server",
  },
  {
    name: "official postgres through docker-entrypoint.sh",
    command: ["docker-entrypoint.sh"],
    args: ["postgres"],
    role: "server",
  },
  {
    name: "server flags only (the entrypoint prepends the server)",
    args: ["--appendonly", "yes", "--requirepass", "$(REDIS_PASSWORD)"],
    role: "server",
  },
  {
    name: "a postgres setting as the first argument",
    args: ["-c", "config_file=/etc/postgresql/postgresql.conf"],
    role: "server",
  },
  {
    name: "redis-server with a config file",
    command: ["redis-server", "/etc/redis/redis.conf"],
    role: "server",
  },
  {
    name: "valkey-server with a config file",
    command: ["valkey-server", "/etc/valkey/valkey.conf"],
    role: "server",
  },
  {
    name: "mongod with a replica set",
    command: ["mongod", "--replSet", "rs0", "--bind_ip_all"],
    role: "server",
  },
  {
    name: "official mysql with server flags",
    args: ["--default-authentication-plugin=mysql_native_password"],
    role: "server",
  },
  {
    name: "Bitnami run.sh",
    command: ["/opt/bitnami/scripts/postgresql/run.sh"],
    role: "server",
  },
  {
    name: "Bitnami redis master (bash -c start-master.sh)",
    command: ["/bin/bash"],
    args: ["-c", "/opt/bitnami/scripts/start-scripts/start-master.sh"],
    role: "server",
  },
  {
    name: "Bitnami redis node in sentinel mode (bash -c start-node.sh)",
    command: ["/bin/bash"],
    args: ["-c", "/opt/bitnami/scripts/start-scripts/start-node.sh"],
    role: "server",
  },
  {
    name: "Bitnami mongodb setup.sh",
    command: ["/scripts/setup.sh"],
    role: "server",
  },
  {
    name: "Bitnami postgresql-ha sourcing its libraries before exec",
    command: ["/bin/bash", "-c"],
    args: [
      ". /opt/bitnami/scripts/libpostgresql.sh\n. /opt/bitnami/scripts/libos.sh\nexec /opt/bitnami/scripts/postgresql-repmgr/entrypoint.sh /opt/bitnami/scripts/postgresql-repmgr/run.sh",
    ],
    role: "server",
  },
  {
    name: "MongoDB Community Operator mongod (newline-led sh -c script)",
    command: ["/bin/sh", "-c", MONGODB_COMMUNITY_MONGOD_SCRIPT],
    role: "server",
  },
  {
    name: "MongoDB Community Operator agent (bash -c script)",
    command: ["/bin/bash", "-c", MONGODB_COMMUNITY_AGENT_SCRIPT],
    role: "server",
  },
  {
    name: "CloudNativePG instance manager",
    command: [
      "/controller/manager",
      "instance",
      "run",
      "--status-port",
      "8000",
      "--log-level",
      "info",
    ],
    role: "server",
  },
  {
    name: "CockroachDB StatefulSet (bash -ecx)",
    command: ["/bin/bash", "-ecx", COCKROACHDB_START_SCRIPT],
    role: "server",
  },
  {
    name: "CockroachDB Helm chart (the image's `shell` mode)",
    args: ["shell", "-ecx", COCKROACHDB_START_SCRIPT],
    role: "server",
  },
  {
    name: "Percona XtraDB Cluster",
    command: ["/var/lib/mysql/pxc-entrypoint.sh"],
    args: ["mysqld"],
    role: "server",
  },
  {
    name: "Percona Server for MongoDB",
    command: ["/opt/percona/ps-entry.sh"],
    args: ["--bind_ip_all", "--auth", "--dbpath=/data/db", "--replSet=rs0"],
    role: "server",
  },
  {
    name: "Crunchy PGO / Percona PostgreSQL (patroni)",
    command: ["patroni", "/etc/patroni"],
    role: "server",
  },
  {
    name: "Crunchy replication-cert-copy (bash -ceu -- …)",
    command: [
      "bash",
      "-ceu",
      "--",
      CRUNCHY_CERT_COPY_SCRIPT,
      "replication-cert-copy",
    ],
    role: "server",
  },
  {
    name: "ScyllaDB (-euEo pipefail -O inherit_errexit -c)",
    command: [
      "/usr/bin/bash",
      "-euEo",
      "pipefail",
      "-O",
      "inherit_errexit",
      "-c",
      SCYLLA_SCRIPT,
      "--",
    ],
    role: "server",
  },
  {
    name: "TiDB Operator (sh <script file>)",
    command: ["/bin/sh", "/usr/local/bin/tidb_start_script.sh"],
    role: "server",
  },
  {
    name: "sh with the script file in args",
    command: ["sh"],
    args: ["/docker-entrypoint-initdb.d/run.sh"],
    role: "server",
  },
  {
    name: "bash with a script file",
    command: ["/bin/bash", "/scripts/start-redis.sh"],
    role: "server",
  },
  {
    name: "redis-ha split-brain-fix (sh <script file>)",
    command: ["sh"],
    args: ["/readonly-config/fix-split-brain.sh"],
    role: "server",
  },
  {
    name: 'sh -c "exec postgres -c …"',
    command: [
      "sh",
      "-c",
      "exec postgres -c config_file=/etc/postgresql/postgresql.conf",
    ],
    role: "server",
  },
  {
    name: "bash -cex",
    command: ["bash", "-cex", "exec postgres"],
    role: "server",
  },
  {
    name: "bash -o pipefail -c",
    command: ["bash", "-o", "pipefail", "-c", "exec postgres"],
    role: "server",
  },
  {
    name: "bash with long options before -c",
    command: ["bash", "--noprofile", "--norc", "-c", "exec postgres"],
    role: "server",
  },
  {
    name: "a shebang-led script",
    command: ["bash", "-c", "#!/bin/bash\nset -euo pipefail\nexec postgres"],
    role: "server",
  },
  {
    name: "a tab-led script",
    command: ["sh", "-c", "\texec postgres"],
    role: "server",
  },
  {
    name: "a comment-led script with set -x",
    command: [
      "bash",
      "-c",
      "\n  set -x\n  # wait for the volume\n  while [ ! -d /data ]; do sleep 1; done\n  exec docker-entrypoint.sh postgres\n",
    ],
    role: "server",
  },
  {
    name: "sleep first, then exec the server",
    command: ["sh", "-c", "sleep 5 && exec redis-server /conf/redis.conf"],
    role: "server",
  },
  {
    name: "cat a config first, then exec the server",
    command: [
      "sh",
      "-c",
      "cat /tmpl/redis.conf > /etc/redis.conf; exec redis-server /etc/redis.conf",
    ],
    role: "server",
  },
  {
    name: "an until-loop, then exec the server",
    command: [
      "sh",
      "-c",
      "until nslookup mongo-0.mongo; do sleep 2; done\nexec mongod --replSet rs0",
    ],
    role: "server",
  },
  {
    name: "a client probe, then the server without exec",
    command: [
      "sh",
      "-c",
      "redis-cli -h master ping || true; redis-server --replicaof master 6379",
    ],
    role: "server",
  },
  {
    name: "a server started in the background, then a client, then wait",
    command: [
      "sh",
      "-c",
      "mongod --replSet rs0 --bind_ip_all & sleep 5 && mongosh --eval 'rs.initiate()'; wait",
    ],
    role: "server",
  },
  {
    name: "an environment assignment before exec",
    command: ["sh", "-c", "PGDATA=/data/pg exec postgres"],
    role: "server",
  },
  {
    name: 'exec "$@" with the server as a positional argument',
    command: ["bash", "-c", 'exec "$@"', "--", "postgres"],
    role: "server",
  },
  {
    name: "a server under a variable path",
    command: ["sh", "-c", 'exec ${PG_BIN}/postgres -D "$PGDATA"'],
    role: "server",
  },
  {
    name: "line continuations",
    command: [
      "bash",
      "-c",
      "exec postgres \\\n  -c max_connections=200 \\\n  -c shared_buffers=1GB",
    ],
    role: "server",
  },
  {
    name: "CRLF line endings",
    command: ["sh", "-c", "set -e\r\nexec postgres\r\n"],
    role: "server",
  },
  {
    name: "gosu drops privileges and runs the server",
    command: ["/bin/sh", "-c", "exec gosu postgres postgres"],
    role: "server",
  },
  {
    name: "source an env file, then the server",
    command: ["bash", "-c", "source /opt/env.sh; exec postgres"],
    role: "server",
  },
  {
    name: "tini wrapping the entrypoint",
    command: ["tini", "--", "docker-entrypoint.sh", "postgres"],
    role: "server",
  },
  {
    name: "dumb-init wrapping a run script",
    command: ["/usr/bin/dumb-init", "--", "/opt/bitnami/scripts/redis/run.sh"],
    role: "server",
  },
  {
    name: "a quote apostrophe inside a comment",
    command: [
      "sh",
      "-c",
      "# don't start until the config exists\nexec postgres",
    ],
    role: "server",
  },
  {
    name: "an escaped apostrophe before the server",
    command: ["sh", "-c", "echo it\\'s time; exec postgres; echo 'bye'"],
    role: "server",
  },
  {
    name: "a nested shell running the server",
    command: ["bash", "-c", "psql -c 'select 1' && bash -c 'exec postgres'"],
    role: "server",
  },
  // Unreadable: a possible server, never a silent miss.
  {
    name: "sh -c with no script (unreadable)",
    command: ["sh", "-c"],
    role: "server",
  },
  {
    name: "a heredoc (unreadable)",
    command: ["sh", "-c", "psql <<EOF\nSELECT 1;\nEOF"],
    role: "server",
  },
  {
    name: "a wrapper around a client (unreadable)",
    command: ["timeout", "30", "psql", "-h", "db"],
    role: "server",
  },
  {
    name: "env running a client (unreadable)",
    command: ["env", "PGPASSWORD=x", "psql"],
    role: "server",
  },
  {
    name: "a client, then the image's command",
    command: ["sh", "-c", 'psql -h db -f /x.sql; exec "$@"', "--", "postgres"],
    role: "server",
  },
  {
    name: "more shell options than are projected (unreadable)",
    command: [
      "bash",
      "-o",
      "errexit",
      "-o",
      "nounset",
      "-o",
      "pipefail",
      "-o",
      "noclobber",
      "-c",
      "sleep infinity",
    ],
    role: "server",
  },
];

export const COMPANION_COMMANDS: Array<ContainerCommandCase> = [
  {
    name: "redis-sentinel",
    command: ["redis-sentinel", "/data/conf/sentinel.conf"],
    role: "companion",
  },
  {
    name: "redis-server --sentinel (spotahome redis-operator)",
    command: ["redis-server", "/redis/sentinel.conf", "--sentinel"],
    role: "companion",
  },
  {
    name: "valkey-sentinel",
    command: ["valkey-sentinel", "/etc/valkey/sentinel.conf"],
    role: "companion",
  },
  {
    name: "valkey-server --sentinel",
    command: ["valkey-server"],
    args: ["/etc/valkey/sentinel.conf", "--sentinel"],
    role: "companion",
  },
  {
    name: "sh -c exec redis-sentinel",
    command: ["sh", "-c", "exec redis-sentinel /etc/redis/sentinel.conf"],
    role: "companion",
  },
];

export const CLIENT_COMMANDS: Array<ContainerCommandCase> = [
  {
    name: "psql -c",
    command: ["psql", "-h", "db", "-c", "select 1"],
    role: "client",
  },
  {
    name: "kubectl run -- psql (args only, through the image entrypoint)",
    args: ["psql", "-h", "prod-db"],
    role: "client",
  },
  {
    name: "psql by its full path",
    command: ["/usr/bin/psql", "-h", "db"],
    role: "client",
  },
  {
    name: "redis-cli ping",
    command: ["redis-cli", "-h", "cache", "ping"],
    role: "client",
  },
  {
    name: "mongosh --eval",
    command: [
      "mongosh",
      "--host",
      "mongo",
      "--eval",
      "db.adminCommand('ping')",
    ],
    role: "client",
  },
  {
    name: "pg_dump",
    command: ["pg_dump", "-h", "db", "-Fc", "-f", "/backup/app.dump"],
    role: "client",
  },
  {
    name: "mysql -e",
    command: ["mysql", "-h", "db", "-e", "SELECT 1"],
    role: "client",
  },
  {
    name: "mongodump",
    command: ["mongodump", "--uri", "mongodb://mongo:27017/app"],
    role: "client",
  },
  {
    name: "cqlsh -e",
    command: ["cqlsh", "cassandra", "-e", "DESCRIBE KEYSPACES"],
    role: "client",
  },
  {
    name: "sh -c psql -c",
    command: ["sh", "-c", "psql -h db -c 'select 1'"],
    role: "client",
  },
  {
    name: "sh -c exec valkey-cli",
    command: ["sh", "-c", "exec valkey-cli -h cache monitor"],
    role: "client",
  },
  {
    name: "a password assignment before psql",
    command: [
      "sh",
      "-c",
      "PGPASSWORD=$DB_PASSWORD psql -h db -U app -f /migrations/001.sql",
    ],
    role: "client",
  },
  {
    name: "wait for the server, then psql",
    command: [
      "/bin/sh",
      "-c",
      "until pg_isready -h db; do sleep 1; done; psql -h db -f /init.sql",
    ],
    role: "client",
  },
  {
    name: "pg_dump piped to gzip",
    command: [
      "bash",
      "-c",
      "pg_dump -h db app | gzip > /backup/app-$(date +%F).sql.gz",
    ],
    role: "client",
  },
  {
    name: "mysqldump to a file",
    command: [
      "sh",
      "-c",
      "mysqldump -h db --all-databases > /backup/all.sql 2>&1",
    ],
    role: "client",
  },
  {
    name: "redis-cli with expansions and quoting",
    command: [
      "sh",
      "-c",
      'redis-cli -h ${REDIS_HOST} -a "$REDIS_PASSWORD" ping',
    ],
    role: "client",
  },
  {
    name: "sleep, then mongosh",
    command: [
      "sh",
      "-c",
      "sleep 10 && mongosh --host mongo-0 --eval 'rs.initiate()'",
    ],
    role: "client",
  },
  {
    name: "a chart test hook (bash -ec, set -x, a client)",
    command: ["/bin/bash", "-ec"],
    args: ["set -x\nredis-cli -h cache-redis-master -p 6379 ping"],
    role: "client",
  },
];

export const KEEP_ALIVE_COMMANDS: Array<ContainerCommandCase> = [
  {
    name: "sleep infinity",
    command: ["sleep", "infinity"],
    role: "keep-alive",
  },
  {
    name: "Bitnami diagnostic mode",
    command: ["sleep"],
    args: ["infinity"],
    role: "keep-alive",
  },
  {
    name: "tail -f /dev/null",
    command: ["tail", "-f", "/dev/null"],
    role: "keep-alive",
  },
  { name: "cat (stdin held open)", command: ["cat"], role: "keep-alive" },
  { name: "an interactive bash", command: ["bash"], role: "keep-alive" },
  { name: "sh -i", command: ["/bin/sh", "-i"], role: "keep-alive" },
  { name: "bash --login", command: ["bash", "--login"], role: "keep-alive" },
  { name: "sh -x (no script)", command: ["sh", "-x"], role: "keep-alive" },
  {
    name: "sh -c sleep",
    command: ["sh", "-c", "sleep 3600"],
    role: "keep-alive",
  },
  {
    name: "sh -c tail -f /dev/null",
    command: ["sh", "-c", "tail -f /dev/null"],
    role: "keep-alive",
  },
  {
    name: "trap and sleep in the background",
    command: ["sh", "-c", "trap : TERM INT; sleep infinity & wait"],
    role: "keep-alive",
  },
  {
    name: "a while-true sleep loop",
    command: ["/bin/sh", "-c", "while true; do sleep 30; done"],
    role: "keep-alive",
  },
  {
    name: "echo, then sleep",
    command: ["sh", "-c", "echo 'debug pod'; sleep infinity"],
    role: "keep-alive",
  },
];

export const ALL_COMMANDS: Array<ContainerCommandCase> = [
  ...SERVER_COMMANDS,
  ...COMPANION_COMMANDS,
  ...CLIENT_COMMANDS,
  ...KEEP_ALIVE_COMMANDS,
];

// command ++ args, as Kubernetes runs them (and as Postgres concatenates them).
export function argvOf(entry: {
  command?: Array<string> | undefined;
  args?: Array<string> | undefined;
}): Array<string> {
  return [...(entry.command || []), ...(entry.args || [])];
}
