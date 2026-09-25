import {
  DATABASE_AGENT_COLLECTOR_IMAGE,
  DATABASE_AGENT_CONFIGS,
  DATABASE_AGENT_DOCKER_COMPOSE,
  DATABASE_AGENT_ENGINES,
  DatabaseAgentEngine,
} from "./DatabaseAgentConfigs";
import {
  DatabaseEndpoint,
  formatDatabaseEndpoint,
  parseDatabaseEndpointString,
  splitDatabaseHostInstance,
} from "Common/Types/DatabaseServer/DatabaseEndpoint";
import {
  DATABASE_SYSTEMS,
  DatabaseEngineMetricsSource,
  DatabaseSystemDescriptor,
  getCollectorReceiverComponentName,
  getDatabaseSystemDescriptor,
  getDatabaseSystemDisplayName,
  getDefaultDatabasePort,
  normalizeDatabaseSystem,
} from "Common/Types/DatabaseServer/DatabaseSystem";
import { getDatabaseAlertTemplates } from "Common/Types/Monitor/DatabaseAlertTemplates";
import MonitorType from "Common/Types/Monitor/MonitorType";

/*
 * The in-app install guide for the OneUptime Database Agent — the product
 * Documentation page (engine picker) and every database's own Documentation
 * tab (prefilled for that row, including its oneuptime.database.server.id).
 *
 * The collector config and the compose file below are the REAL files shipped
 * in agents/DatabaseAgent (embedded by DatabaseAgentConfigs.ts, which a test
 * keeps byte-identical to the files on disk), so what the guide shows is
 * exactly what install.sh downloads. The `.env` block interpolates the
 * viewer's OneUptime URL and the ingestion key they picked in the card.
 *
 * An engine the agent ships no config for gets the "your own collector"
 * guide instead, built from the engine catalog (DatabaseSystem.ts): the
 * receiver, Prometheus endpoint or cloud monitoring API its metrics come
 * from — the same facts the docs page's engine table states.
 *
 * Pure: plain strings in, markdown out. No React, no API.
 */

export const DATABASE_AGENT_DIRECTORY_URL: string =
  "https://github.com/OneUptime/oneuptime/tree/master/agents/DatabaseAgent";
export const DATABASE_AGENT_RAW_URL: string =
  "https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DatabaseAgent";

/* Engines the probe-based Database Health monitor can check. */
export const DATABASE_HEALTH_MONITOR_SYSTEMS: ReadonlyArray<string> = [
  "postgresql",
  "mysql",
  "microsoft.sql_server",
];

/* The resource attribute a monitor filters on to attach its alerts here. */
export const DATABASE_SERVER_ID_ATTRIBUTE_NAME: string =
  "oneuptime.database.server.id";

/**
 * The monitor-create page with the Database Health monitor type preselected
 * (Pages/Monitor/Create.tsx reads `monitorType`), from the page's route.
 */
export function getDatabaseHealthMonitorCreateUrl(
  monitorCreateRoute: string,
): string {
  const separator: string = monitorCreateRoute.includes("?") ? "&" : "?";
  return `${monitorCreateRoute}${separator}monitorType=${encodeURIComponent(
    MonitorType.Database,
  )}`;
}

const ENGINE_LABELS: Record<DatabaseAgentEngine, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL / MariaDB",
  redis: "Redis / Valkey / KeyDB / Dragonfly",
  mongodb: "MongoDB",
  sqlserver: "SQL Server",
  oracledb: "Oracle",
  elasticsearch: "Elasticsearch / OpenSearch",
  memcached: "Memcached",
};

/*
 * The DATABASE_SYSTEM (stamped as db.system.name) a config reports when no
 * row names a more specific engine — the engine each receiver is named
 * after.
 */
const DEFAULT_SYSTEM_FOR_ENGINE: Record<DatabaseAgentEngine, string> = {
  postgresql: "postgresql",
  mysql: "mysql",
  redis: "redis",
  mongodb: "mongodb",
  sqlserver: "microsoft.sql_server",
  oracledb: "oracle.db",
  elasticsearch: "elasticsearch",
  memcached: "memcached",
};

/** The picker label of an agent engine. */
export function getDatabaseAgentEngineLabel(
  engine: DatabaseAgentEngine,
): string {
  return ENGINE_LABELS[engine];
}

/**
 * The agent config for a row's dbSystem — the one that runs a receiver the
 * engine lists ("postgres" → "postgresql", "mariadb" → "mysql", "valkey" →
 * "redis", "mssql" → "sqlserver"), or null when the agent ships no config
 * for it.
 */
export function getDatabaseAgentEngine(
  dbSystem: string | null | undefined,
): DatabaseAgentEngine | null {
  const descriptor: DatabaseSystemDescriptor | null =
    getDatabaseSystemDescriptor(dbSystem);
  if (!descriptor) {
    return null;
  }
  return (
    DATABASE_AGENT_ENGINES.find((engine: DatabaseAgentEngine): boolean => {
      return descriptor.receiverTypes.includes(engine);
    }) || null
  );
}

/**
 * The engine the agent stamps (DATABASE_SYSTEM): the row's own engine when
 * this config monitors it (a MariaDB row keeps "mariadb"), otherwise the
 * engine the config is named after.
 */
export function getDatabaseAgentSystem(
  engine: DatabaseAgentEngine,
  dbSystem?: string | null | undefined,
): string {
  const normalized: string | null = normalizeDatabaseSystem(dbSystem);
  if (normalized && getDatabaseAgentEngine(normalized) === engine) {
    return normalized;
  }
  return DEFAULT_SYSTEM_FOR_ENGINE[engine];
}

/**
 * Every engine the agent can monitor, for the product page's picker, in
 * catalog order: each engine a shipped config runs a receiver for, forks
 * included (MariaDB, Valkey, OpenSearch …).
 */
export function getDatabaseAgentSystems(): Array<string> {
  return DATABASE_SYSTEMS.filter(
    (descriptor: DatabaseSystemDescriptor): boolean => {
      return getDatabaseAgentEngine(descriptor.system) !== null;
    },
  ).map((descriptor: DatabaseSystemDescriptor): string => {
    return descriptor.system;
  });
}

/** The database a guide is prefilled for (a row's Documentation tab). */
export interface DatabaseDocumentationTarget {
  // DatabaseServer id — becomes DATABASE_SERVER_ID.
  id: string;
  name?: string | null | undefined;
  dbSystem?: string | null | undefined;
  serverAddress?: string | null | undefined;
  serverPort?: number | null | undefined;
  /*
   * The stored endpoints, primary first. The first one that parses is the
   * identity the guide stamps when serverAddress is not set (a row detected
   * in Kubernetes or from traces).
   */
  endpoints?: Array<string> | null | undefined;
  kubernetesNamespace?: string | null | undefined;
  isKubernetes?: boolean | undefined;
}

export interface DatabaseAgentIdentity {
  // DATABASE_SERVER_ADDRESS — the name applications use (never host\instance).
  serverAddress: string;
  /*
   * DATABASE_SERVER_PORT; null for an engine without a default port, and
   * for a SQL Server named instance the row knows no port for.
   */
  serverPort: number | null;
  /*
   * host:port the agent connects to (see getDatabaseAgentEndpoint); for a
   * named instance without a known port, the port is
   * INSTANCE_PORT_PLACEHOLDER.
   */
  endpoint: string;
  // DATABASE_SERVER_ID, "" on the product page.
  databaseId: string;
  // False when the values are placeholders, not the row's own.
  isPrefilled: boolean;
  /*
   * The SQL Server named instance (`host\instance`) the row names without a
   * port, lowercased; "" otherwise. It listens on a TCP port of its own —
   * never the default instance's 1433 — so the guide asks for that port
   * instead of defaulting it.
   */
  instanceName: string;
}

/*
 * A name that means one server project-wide, so an agent installed with it
 * as given would create its database: `.internal` and `.local` names, like
 * private IPs, never create one on their own.
 */
const PLACEHOLDER_ADDRESS: string = "db.example.com";

/*
 * The port of a named instance the row does not know. Not a number, so an
 * agent started with it unreplaced fails at once (the SQL Server receiver's
 * port is an integer) instead of monitoring the default instance.
 */
const INSTANCE_PORT_PLACEHOLDER: string = "<instance-tcp-port>";

function hostForUrl(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

/* Characters the shell leaves alone in an unquoted word. */
const SHELL_SAFE_WORD: RegExp = /^[A-Za-z0-9._:@%+,/=-]+$/;

/*
 * One word of a shell command line whose value reaches the command as
 * written: bare when made only of characters the shell leaves alone,
 * otherwise single-quoted (a `'` inside closes, escapes and reopens).
 */
function shellWord(value: string): string {
  return SHELL_SAFE_WORD.test(value)
    ? value
    : `'${value.split("'").join("'\\''")}'`;
}

/**
 * The identity the guide stamps. For a row: its serverAddress / serverPort
 * when set, otherwise its first parseable endpoint (cluster qualifier
 * dropped — the agent stamps server.address and server.port only, and the
 * row id carries the rest). For the product page: placeholders with the
 * engine's default port. A SQL Server named instance without a port keeps
 * its bare host and no port (see DatabaseAgentIdentity.instanceName).
 */
export function resolveDatabaseAgentIdentity(
  system: string,
  target?: DatabaseDocumentationTarget | null | undefined,
): DatabaseAgentIdentity {
  const defaultPort: number | null = getDefaultDatabasePort(system);
  const databaseId: string = (target?.id || "").trim();

  let host: string = "";
  let port: number | null = null;

  const address: string = (target?.serverAddress || "").trim();
  if (address) {
    const parsed: DatabaseEndpoint | null = parseDatabaseEndpointString(
      target?.serverPort
        ? `${hostForUrl(address)}:${target.serverPort}`
        : address,
      { system: system },
    );
    if (parsed) {
      host = parsed.host;
      port = parsed.port;
    }
  }

  if (!host) {
    for (const value of target?.endpoints || []) {
      const parsed: DatabaseEndpoint | null = parseDatabaseEndpointString(
        value,
        {
          system: system,
          kubernetesNamespace: target?.kubernetesNamespace,
        },
      );
      if (parsed) {
        host = parsed.host;
        port = parsed.port;
        break;
      }
    }
  }

  /*
   * The parser keeps `host\instance` only when no port names the instance
   * (a known port already identifies it, and the instance is dropped).
   */
  const split: { host: string; instance: string } =
    port === null ? splitDatabaseHostInstance(host) : { host, instance: "" };
  if (split.instance) {
    return {
      serverAddress: split.host,
      serverPort: null,
      endpoint: `${hostForUrl(split.host)}:${INSTANCE_PORT_PLACEHOLDER}`,
      databaseId,
      isPrefilled: true,
      instanceName: split.instance,
    };
  }

  const isPrefilled: boolean = Boolean(host);
  const serverAddress: string = host || PLACEHOLDER_ADDRESS;
  const serverPort: number | null = port || defaultPort || null;

  return {
    serverAddress,
    serverPort,
    endpoint:
      serverPort !== null
        ? `${hostForUrl(serverAddress)}:${serverPort}`
        : hostForUrl(serverAddress),
    databaseId,
    isPrefilled,
    instanceName: "",
  };
}

/*
 * DATABASE_ENDPOINT_HOST / DATABASE_ENDPOINT_PORT: the endpoint the agent
 * connects to, split for the SQL Server receiver (which takes them apart).
 */
function agentEndpointParts(
  identity: DatabaseAgentIdentity,
  system: string,
): { host: string; port: string } {
  if (identity.instanceName) {
    return { host: identity.serverAddress, port: INSTANCE_PORT_PLACEHOLDER };
  }
  const endpoint: DatabaseEndpoint | null = parseDatabaseEndpointString(
    identity.endpoint,
    { system: system },
  );
  const port: number | null =
    endpoint && endpoint.port !== null ? endpoint.port : identity.serverPort;
  return {
    host: endpoint ? endpoint.host : identity.serverAddress,
    port: port !== null ? String(port) : "",
  };
}

/* DATABASE_SERVER_PORT as the samples write it. */
function serverPortValue(identity: DatabaseAgentIdentity): string {
  if (identity.serverPort !== null) {
    return String(identity.serverPort);
  }
  return identity.instanceName ? INSTANCE_PORT_PLACEHOLDER : "";
}

/**
 * DATABASE_ENDPOINT for a config: host:port, except for Elasticsearch /
 * OpenSearch, whose receiver takes a URL (its scheme turns TLS on).
 */
export function getDatabaseAgentEndpoint(
  engine: DatabaseAgentEngine,
  identity: DatabaseAgentIdentity,
): string {
  return engine === "elasticsearch"
    ? `http://${identity.endpoint}`
    : identity.endpoint;
}

/* The least-privilege monitoring login per engine (agents/DatabaseAgent/README.md). */
const MONITORING_USER_MARKDOWN: Record<DatabaseAgentEngine, string> = {
  postgresql: `
\`\`\`sql
CREATE USER oneuptime_monitor WITH PASSWORD 'a-strong-password';
GRANT pg_monitor TO oneuptime_monitor;
\`\`\`

\`pg_monitor\` (PostgreSQL 10 and later) reads the statistics views and grants no access to your tables. Without it \`pg_stat_activity\` does not fail — it returns only the agent's own session, so connection counts read \`1\`. The receiver connects to every database to read per-database statistics, so the user also needs \`CONNECT\` on each one (\`PUBLIC\` has it by default). The PostgreSQL receiver refuses to start without a password. On a managed service where \`pg_monitor\` is unavailable, \`pg_read_all_stats\` covers the same views.

Top queries (\`DATABASE_QUERY_EVENTS=true\`) also need the \`pg_stat_statements\` extension, loaded through \`shared_preload_libraries = 'pg_stat_statements'\` (a restart) and created in every monitored database:

\`\`\`sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
\`\`\`

Their explain plans additionally need \`SELECT\` on the tables the queries touch, which \`pg_monitor\` does not grant (for example \`GRANT SELECT ON ALL TABLES IN SCHEMA app TO oneuptime_monitor\`). Without it top queries still arrive, with empty plans, and the collector logs \`failed to explain\` for each one.
`,
  mysql: `
\`\`\`sql
CREATE USER 'oneuptime_monitor'@'%' IDENTIFIED BY 'a-strong-password';
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'oneuptime_monitor'@'%';
GRANT SELECT ON performance_schema.* TO 'oneuptime_monitor'@'%';
\`\`\`

\`PROCESS\` and \`REPLICATION CLIENT\` cover the global status counters, InnoDB status and replica status; \`performance_schema\` is read for query samples and top queries. MariaDB 10.5.9 and later split replica status into its own privilege, so also run \`GRANT SLAVE MONITOR ON *.* TO 'oneuptime_monitor'@'%';\` there.
`,
  redis: `
\`\`\`text
ACL SETUSER oneuptime_monitor on >a-strong-password -@all +info +ping
\`\`\`

The receiver only runs \`INFO\`. Persist the user with \`ACL SAVE\` (or a \`user\` line in \`redis.conf\` / your ACL file). On a server protected only by \`requirepass\`, leave \`DATABASE_USERNAME\` empty and set \`DATABASE_PASSWORD\`; on a server without authentication leave both empty. Valkey, KeyDB and Dragonfly take the same ACL.
`,
  mongodb: `
\`\`\`js
db.getSiblingDB("admin").createUser({
  user: "oneuptime_monitor",
  pwd: "a-strong-password",
  roles: [{ role: "clusterMonitor", db: "admin" }],
});
\`\`\`

\`clusterMonitor\` covers every metric. Explain plans on top queries additionally need \`{ role: "read", db: "<database>" }\` for each monitored database. The agent connects to exactly one member, so run one agent per replica-set member.
`,
  sqlserver: `
\`\`\`sql
CREATE LOGIN oneuptime_monitor WITH PASSWORD = 'a-strong-password';
GRANT VIEW SERVER STATE TO oneuptime_monitor;
GRANT VIEW ANY DEFINITION TO oneuptime_monitor;
\`\`\`

\`VIEW SERVER STATE\` (on SQL Server 2022 and later \`VIEW SERVER PERFORMANCE STATE\` is enough) reads the dynamic management views every metric comes from, and grants no access to your data. The receiver puts the login into a connection string without quoting it, so the user name and password must not contain a semicolon (\`;\`) or a double quote (\`"\`), nor start or end with a space — the install script refuses them. For a named instance (\`host\\instance\`), connect to the instance's own TCP port (\`host:port\`), never the default instance's 1433: SQL Server Configuration Manager shows it, or run \`SELECT local_tcp_port FROM sys.dm_exec_connections WHERE session_id = @@SPID;\` on the instance.
`,
  oracledb: `
\`\`\`sql
-- In the pluggable database the agent connects to, e.g. ALTER SESSION SET CONTAINER = FREEPDB1;
CREATE USER oneuptime_monitor IDENTIFIED BY "a-strong-password";
GRANT CREATE SESSION TO oneuptime_monitor;
GRANT SELECT_CATALOG_ROLE TO oneuptime_monitor;
\`\`\`

\`SELECT_CATALOG_ROLE\` reads the \`V$\` and \`DBA_\` views the metrics, query samples and top queries come from, and grants no access to your tables. \`DATABASE_ORACLE_SERVICE\` is the service the agent connects to (\`FREEPDB1\`, \`ORCLPDB1\`, …).
`,
  elasticsearch: `
\`\`\`text
POST /_security/role/oneuptime_monitor
{ "cluster": ["monitor"], "indices": [{ "names": ["*"], "privileges": ["monitor"] }] }

POST /_security/user/oneuptime_monitor
{ "password": "a-strong-password", "roles": ["oneuptime_monitor"] }
\`\`\`

The \`monitor\` privileges read node, cluster and index statistics and no documents. On OpenSearch with the security plugin, grant the cluster permission \`cluster_monitor\` and the index permission \`indices_monitor\` on \`*\` instead. On a cluster without security, leave \`DATABASE_USERNAME\` and \`DATABASE_PASSWORD\` empty.
`,
  memcached: `
Memcached has no users: the receiver runs \`stats\` over the text protocol, so leave \`DATABASE_USERNAME\` and \`DATABASE_PASSWORD\` empty. A server started with SASL authentication (\`-S\`) cannot be monitored this way.
`,
};

function usernameFor(engine: DatabaseAgentEngine): string {
  return engine === "redis" || engine === "memcached"
    ? ""
    : "oneuptime_monitor";
}

function passwordLineFor(engine: DatabaseAgentEngine): string {
  return engine === "memcached" ? "" : "'a-strong-password'";
}

/*
 * install.sh's first line of every .env (its COLLECTOR_ESCAPE_MARKER): the
 * login below holds every `$` doubled for the collector. A hand-written
 * file follows the same rule, so it says so the same way.
 */
const ENV_FILE_ESCAPE_LINE: string =
  "# DATABASE_USERNAME and DATABASE_PASSWORD are escaped for the collector: every $ is written as $$.";

/** The `.env` file, with the viewer's URL and key and the row's identity. */
export function getDatabaseAgentEnvFile(data: {
  oneuptimeUrl: string;
  apiKey: string;
  engine: DatabaseAgentEngine;
  identity: DatabaseAgentIdentity;
  system?: string | null | undefined;
}): string {
  const system: string = getDatabaseAgentSystem(data.engine, data.system);
  const endpoint: { host: string; port: string } = agentEndpointParts(
    data.identity,
    system,
  );
  return `${ENV_FILE_ESCAPE_LINE}
ONEUPTIME_URL=${data.oneuptimeUrl}
ONEUPTIME_TELEMETRY_INGESTION_KEY=${data.apiKey}
DATABASE_SYSTEM=${system}
DATABASE_ENDPOINT=${getDatabaseAgentEndpoint(data.engine, data.identity)}
DATABASE_ENDPOINT_HOST=${endpoint.host}
DATABASE_ENDPOINT_PORT=${endpoint.port}
DATABASE_ORACLE_SERVICE=${data.engine === "oracledb" ? "FREEPDB1" : ""}
DATABASE_SERVER_ADDRESS=${data.identity.serverAddress}
DATABASE_SERVER_PORT=${serverPortValue(data.identity)}
DATABASE_USERNAME=${usernameFor(data.engine)}
DATABASE_PASSWORD=${passwordLineFor(data.engine)}
DATABASE_TLS_INSECURE=true
DATABASE_TLS_INSECURE_SKIP_VERIFY=false
DATABASE_COLLECTION_INTERVAL=30s
DATABASE_QUERY_EVENTS=false
DATABASE_SERVER_ID=${data.identity.databaseId}`;
}

/**
 * A Deployment running the agent next to a Kubernetes database, prefilled
 * for the row: its namespace, engine, the address applications use and its
 * id (a cluster-local name never creates a database on its own, the id
 * attaches the data to this one).
 */
export function getDatabaseAgentKubernetesManifest(data: {
  oneuptimeUrl: string;
  engine: DatabaseAgentEngine;
  identity: DatabaseAgentIdentity;
  namespace: string;
  system?: string | null | undefined;
}): string {
  const namespace: string = data.namespace.trim() || "default";
  const system: string = getDatabaseAgentSystem(data.engine, data.system);
  const endpoint: { host: string; port: string } = agentEndpointParts(
    data.identity,
    system,
  );
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-database-agent
  namespace: ${namespace}
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
          image: ${DATABASE_AGENT_COLLECTOR_IMAGE}
          env:
            - name: ONEUPTIME_URL
              value: "${data.oneuptimeUrl}"
            - name: ONEUPTIME_TELEMETRY_INGESTION_KEY
              valueFrom:
                secretKeyRef:
                  name: oneuptime-database-agent
                  key: ONEUPTIME_TELEMETRY_INGESTION_KEY
            - name: DATABASE_SYSTEM
              value: "${system}"
            - name: DATABASE_ENDPOINT
              value: "${getDatabaseAgentEndpoint(data.engine, data.identity)}"
            - name: DATABASE_ENDPOINT_HOST
              value: "${endpoint.host}"
            - name: DATABASE_ENDPOINT_PORT
              value: "${endpoint.port}"
            - name: DATABASE_ORACLE_SERVICE
              value: "${data.engine === "oracledb" ? "FREEPDB1" : ""}"
            - name: DATABASE_SERVER_ADDRESS
              value: "${data.identity.serverAddress}"
            - name: DATABASE_SERVER_PORT
              value: "${serverPortValue(data.identity)}"
            - name: DATABASE_USERNAME
              value: "${usernameFor(data.engine)}"
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
              value: "${data.identity.databaseId}"
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
            name: oneuptime-database-agent`;
}

function kubernetesSection(data: {
  oneuptimeUrl: string;
  apiKey: string;
  engine: DatabaseAgentEngine;
  system: string;
  identity: DatabaseAgentIdentity;
  namespace: string;
}): string {
  const namespace: string = data.namespace.trim() || "default";
  return `
## Run the agent in Kubernetes

This database runs in Kubernetes, so the agent is best run as a small Deployment in its namespace (\`${namespace}\`). \`DATABASE_SERVER_ID\` ties the metrics to this database directly: a cluster-local name is only unique inside one cluster, so it never creates a database on its own.

1. Put the collector config in a ConfigMap and the secrets in a Secret. The collector expands \`$\` inside the password once more, so write every \`$\` in it as \`$$\`:

\`\`\`bash
curl -fsSL ${DATABASE_AGENT_RAW_URL}/configs/${data.engine}.yaml -o config.yaml
kubectl -n ${namespace} create configmap oneuptime-database-agent --from-file=config.yaml=config.yaml
kubectl -n ${namespace} create secret generic oneuptime-database-agent \\
  --from-literal=ONEUPTIME_TELEMETRY_INGESTION_KEY='${data.apiKey}' \\
  --from-literal=DATABASE_PASSWORD='a-strong-password'
\`\`\`

2. Apply the Deployment:

\`\`\`yaml
${getDatabaseAgentKubernetesManifest({
  oneuptimeUrl: data.oneuptimeUrl,
  engine: data.engine,
  identity: data.identity,
  namespace: namespace,
  system: data.system,
})}
\`\`\`

Set \`DATABASE_ENDPOINT\` and \`DATABASE_SERVER_ADDRESS\` to the database Service's full name (\`<service>.${namespace}.svc.cluster.local\`) if the prefilled value is not it. The agent never stamps \`k8s.cluster.name\`: OneUptime reads that attribute as the Kubernetes agent's heartbeat.
`;
}

/**
 * The endpoint a probe monitor (Database Health, SQL Query) can name to have
 * its alerts land on this database: the first stored endpoint a probe can
 * spell exactly — a host and a port, with no cluster qualifier (a probe
 * carries no cluster) and no SQL Server instance name. Null when the row
 * has none, or no endpoints were given.
 */
export function getDatabaseProbeEndpoint(
  database: DatabaseDocumentationTarget | null | undefined,
): string | null {
  const system: string = normalizeDatabaseSystem(database?.dbSystem) || "";
  for (const value of database?.endpoints || []) {
    const parsed: DatabaseEndpoint | null = parseDatabaseEndpointString(value, {
      system: system,
    });
    if (
      parsed &&
      parsed.port !== null &&
      !parsed.kubernetesClusterName &&
      !parsed.host.includes("\\")
    ) {
      return formatDatabaseEndpoint(parsed);
    }
  }
  return null;
}

/*
 * The probe-based alternative, for the engines the Database Health monitor
 * checks. A probe's alerts land on the database whose endpoints include the
 * host:port it connects to (MonitorStepResourceIdentity), so a row's guide
 * names one of its own endpoints to connect to.
 */
function databaseHealthSection(data: {
  dbSystem: string;
  databaseHealthMonitorUrl?: string | null | undefined;
  database?: DatabaseDocumentationTarget | null | undefined;
}): string {
  if (!DATABASE_HEALTH_MONITOR_SYSTEMS.includes(data.dbSystem)) {
    return "";
  }
  const link: string = data.databaseHealthMonitorUrl
    ? `[create a Database Health monitor](${data.databaseHealthMonitorUrl})`
    : "create a Database Health monitor";

  let linking: string;
  if (!data.database) {
    linking =
      "Its alerts and incidents also appear on the database whose endpoints include the host and port it connects to.";
  } else {
    const probeEndpoint: string | null = getDatabaseProbeEndpoint(
      data.database,
    );
    linking = probeEndpoint
      ? `Point it at \`${probeEndpoint}\`, one of this database's endpoints, and its alerts and incidents appear on this database's Alerts and Incidents tabs.`
      : "Its alerts and incidents appear on this database when the host and port it connects to are one of the endpoints on this database's Endpoints tab, written without an `@cluster` suffix — a probe reports no cluster.";
  }

  return `
## No agent? Use a Database Health monitor

For a probe-based check that needs no agent at all — connections, locks, cache and replication health, with alerting — ${link} (PostgreSQL, MySQL and SQL Server). It uses the same monitoring user. ${linking}
`;
}

/*
 * How a monitor's alerts land on a database: its engine metrics carry the
 * database's id, and an alert whose monitor filters (or groups) on it is
 * attributed to the database. The Recommendations tab offers ready-made
 * monitors for the engines DatabaseAlertTemplates covers; it is only
 * pointed at for those.
 */
function alertingSection(data: {
  databaseId: string;
  system: string;
  recommendationsUrl?: string | null | undefined;
}): string {
  const id: string = data.databaseId || "<database id>";
  const engineLabel: string = getDatabaseSystemDisplayName(data.system);
  const recommendationsTab: string = data.recommendationsUrl
    ? `[Recommendations](${data.recommendationsUrl})`
    : "**Recommendations**";
  const recommended: string =
    getDatabaseAlertTemplates(data.system).length > 0
      ? `The ${recommendationsTab} tab offers ready-made ${engineLabel} monitors, each scoped to this database, once the metrics they read (from the collector's receiver for this engine) have arrived — among them one that fires when they stop. To build your own, create`
      : "Create";
  /*
   * Over the agent's direct connection the sqlserver receiver reads
   * sys.dm_os_performance_counters, whose "/sec" counters are since-start
   * totals: every sqlserver.*.rate metric only grows there (measured), and
   * cumulativetodelta skips them because the receiver types them gauges.
   */
  const sqlServerRates: string = getDatabaseSystemDescriptor(
    data.system,
  )?.receiverTypes.includes("sqlserver")
    ? " SQL Server's `sqlserver.*.rate` metrics behave like counters too: over the agent's direct connection they carry the counter's total since the server started, not a per-second rate, and `cumulativetodelta` leaves them alone (the receiver reports them as gauges) — threshold point-in-time values such as `sqlserver.processes.blocked` instead."
    : "";
  return `
## Alert on this database

Engine metrics and query events carry \`${DATABASE_SERVER_ID_ATTRIBUTE_NAME}\` = \`${id}\`. ${recommended} a **Metrics** monitor over an engine metric and filter it on that attribute (or group it by the attribute to cover several databases with one monitor — each series then lands on its own database): its alerts and incidents then appear on this database's Alerts and Incidents tabs, and none are opened for this database while it is in a scheduled maintenance window. A chart opened from this database's **Metrics** tab has **Create monitor**, which fills that filter in for you (a metric the chart adds up across series becomes a monitor that alerts on each series). Threshold a gauge (connections, memory, replication lag) or a ratio of two gauges. A cumulative counter (deadlocks, slow queries, evictions) only ever grows and monitors have no rate, so turn it into per-interval deltas with the collector's \`cumulativetodelta\` processor before alerting on it.${sqlServerRates}
`;
}

/**
 * The full agent guide for one engine. With `database`, every value that
 * identifies the database is prefilled for that row, its id included; the
 * Kubernetes section appears for a Kubernetes-detected row. `system` picks
 * the engine the agent reports (DATABASE_SYSTEM: "mariadb" with the mysql
 * config); it defaults to the row's engine, then to the config's.
 * `recommendationsUrl` links the row's Recommendations tab from its
 * alerting section.
 */
export function getDatabaseAgentInstallationMarkdown(data: {
  oneuptimeUrl: string;
  apiKey: string;
  engine: DatabaseAgentEngine;
  system?: string | null | undefined;
  database?: DatabaseDocumentationTarget | null | undefined;
  databaseHealthMonitorUrl?: string | null | undefined;
  recommendationsUrl?: string | null | undefined;
}): string {
  const database: DatabaseDocumentationTarget | null | undefined =
    data.database;
  const system: string = getDatabaseAgentSystem(
    data.engine,
    data.system || database?.dbSystem,
  );
  const identity: DatabaseAgentIdentity = resolveDatabaseAgentIdentity(
    system,
    database,
  );
  const serverPortText: string = serverPortValue(identity);
  const engineLabel: string = getDatabaseSystemDisplayName(system);
  const receiverName: string = getCollectorReceiverComponentName(data.engine);

  /*
   * A named instance the row knows no port for: the samples carry a
   * placeholder port, and the reader is told where to find the real one.
   */
  const instanceNote: string = identity.instanceName
    ? ` This database is the SQL Server named instance \`${identity.instanceName}\` on \`${identity.serverAddress}\`, and OneUptime does not know its TCP port — a named instance listens on its own, never on the default instance's 1433, and the agent connects to that port. Find it in SQL Server Configuration Manager (the instance's TCP/IP protocol, IPAll) or by running \`SELECT local_tcp_port FROM sys.dm_exec_connections WHERE session_id = @@SPID;\` on the instance. The install script asks for the endpoint to connect to: give it as \`${identity.serverAddress}:<port>\`. In the samples below, replace \`${INSTANCE_PORT_PLACEHOLDER}\` with it.`
    : "";

  const thisDatabase: string = database
    ? `
## This database

| Setting | Value |
|---------|-------|
| \`DATABASE_SYSTEM\` | \`${system}\` |
| \`DATABASE_SERVER_ID\` | \`${identity.databaseId}\` |
| \`DATABASE_SERVER_ADDRESS\` | \`${identity.serverAddress}\` |
| \`DATABASE_SERVER_PORT\` | \`${serverPortText}\` |

Every block below is prefilled with these values. \`DATABASE_SERVER_ID\` is stamped on the agent's data as \`${DATABASE_SERVER_ID_ATTRIBUTE_NAME}\` and links it to this database directly, whatever its address — its data then shows on this database's pages even when the address is a private IP or a name that only resolves inside your network.${
        identity.isPrefilled
          ? ""
          : ` This database has no address yet: the install script asks for the host name your applications use to reach it, and in the samples below replace \`${PLACEHOLDER_ADDRESS}\` with that name.`
      }${instanceNote}
`
    : "";

  /*
   * A row without an address gets no placeholder on the command line:
   * install.sh would take the placeholder as given and stamp it, while
   * without it the script asks for the real name. Likewise a port the row
   * does not know is left for install.sh, which takes it from the endpoint
   * it asks for. The id still links the data to this row. Every value is
   * one shell word, so the shell hands install.sh exactly this text.
   */
  const installEnv: string = [
    `DATABASE_SYSTEM=${shellWord(system)}`,
    database && identity.isPrefilled
      ? `DATABASE_SERVER_ADDRESS=${shellWord(identity.serverAddress)}`
      : "",
    database && identity.isPrefilled && identity.serverPort !== null
      ? `DATABASE_SERVER_PORT=${identity.serverPort}`
      : "",
    database ? `DATABASE_SERVER_ID=${shellWord(identity.databaseId)}` : "",
  ]
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .join(" ");

  const kubernetes: string =
    database && database.isKubernetes
      ? kubernetesSection({
          oneuptimeUrl: data.oneuptimeUrl,
          apiKey: data.apiKey,
          engine: data.engine,
          system: system,
          identity: identity,
          namespace: database.kubernetesNamespace || "",
        })
      : "";

  return `
The OneUptime Database Agent collects ${engineLabel} engine metrics — connections, throughput, cache hit ratio, locks, replication, memory — with a stock OpenTelemetry Collector container (\`${DATABASE_AGENT_COLLECTOR_IMAGE}\`) running the collector's native \`${receiverName}\` receiver (\`configs/${data.engine}.yaml\`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.
${thisDatabase}
## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the database's port
- A dedicated monitoring user on the database (below)
- A OneUptime telemetry ingestion key (select or create one above)

## Create a monitoring user

Give the agent its own login with read access to the engine's statistics — never an administrator, and never an application's own login.
${MONITORING_USER_MARKDOWN[data.engine]}
## Quick Start — Install Script

\`\`\`bash
curl -sSL ${DATABASE_AGENT_RAW_URL}/install.sh -o install.sh
${installEnv} bash install.sh
\`\`\`

The script asks for anything not given up front (your OneUptime URL and ingestion key, the endpoint to connect to and the monitoring credentials — the password is read without echo), installs to \`/opt/oneuptime-database-agent\`, writes a \`0600\` \`.env\` file with values escaped for the collector and quoted for Docker Compose, and starts the agent. Re-running it reuses the existing \`.env\` and updates the agent; a \`docker-compose.yml\` or collector config you edited is kept next to the new one as \`<file>.bak.<timestamp>\`.

## Quick Start — Docker Compose

Download \`docker-compose.yml\` and \`configs/${data.engine}.yaml\` (saved as \`otel-collector-config.yaml\`) from the [DatabaseAgent directory](${DATABASE_AGENT_DIRECTORY_URL}) into one folder, then create a \`.env\` file next to them (\`chmod 600 .env\` — it holds a password):

\`\`\`bash
${getDatabaseAgentEnvFile({
  oneuptimeUrl: data.oneuptimeUrl,
  apiKey: data.apiKey,
  engine: data.engine,
  identity: identity,
  system: system,
})}
\`\`\`

Then start the agent:

\`\`\`bash
docker compose up -d
\`\`\`

\`DATABASE_ENDPOINT\` is where the agent connects (\`host.docker.internal:<port>\` when it runs on the database machine). \`DATABASE_SERVER_ADDRESS\` is the database's identity: the host name your **applications** use to reach it, never \`localhost\`. Keep it stable — changing it registers a second database. In a hand-written \`.env\`, single-quote the password and write every \`$\` in it as \`$$\`: the collector expands \`$$\` and \`\${...}\` inside it once more. The first line says so, in the words of the \`.env\` the install script writes — and the script, re-run on this folder, reads the file the same way.

### docker-compose.yml

\`\`\`yaml
${DATABASE_AGENT_DOCKER_COMPOSE.trimEnd()}
\`\`\`

### otel-collector-config.yaml (${getDatabaseAgentEngineLabel(data.engine)})

\`\`\`yaml
${DATABASE_AGENT_CONFIGS[data.engine].trimEnd()}
\`\`\`
${kubernetes}
## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| \`ONEUPTIME_URL\` | Yes | Your OneUptime URL |
| \`ONEUPTIME_TELEMETRY_INGESTION_KEY\` | Yes | The telemetry ingestion key selected above |
| \`DATABASE_SYSTEM\` | Yes | The engine, stamped as \`db.system.name\`: \`postgresql\`, \`mysql\`, \`mariadb\`, \`redis\`, \`valkey\`, \`keydb\`, \`dragonfly\`, \`mongodb\`, \`microsoft.sql_server\`, \`oracle.db\`, \`elasticsearch\`, \`opensearch\` or \`memcached\` |
| \`DATABASE_ENDPOINT\` | Yes | \`host:port\` the agent connects to (a \`http://\` or \`https://\` URL for Elasticsearch / OpenSearch) |
| \`DATABASE_ENDPOINT_HOST\` | SQL Server | \`DATABASE_ENDPOINT\`'s host (install.sh writes it) |
| \`DATABASE_ENDPOINT_PORT\` | SQL Server | \`DATABASE_ENDPOINT\`'s port (install.sh writes it) |
| \`DATABASE_ORACLE_SERVICE\` | Oracle | The service to connect to, e.g. \`FREEPDB1\` |
| \`DATABASE_SERVER_ADDRESS\` | Yes | The host name your applications use — the database's identity |
| \`DATABASE_SERVER_PORT\` | Yes | The port your applications use |
| \`DATABASE_USERNAME\` | PostgreSQL, MySQL, SQL Server, Oracle | The monitoring user |
| \`DATABASE_PASSWORD\` | PostgreSQL, SQL Server, Oracle | Its password (single-quoted in \`.env\`, every \`$\` written as \`$$\`) |
| \`DATABASE_TLS_INSECURE\` | No | \`true\` (default) connects without TLS, \`false\` turns TLS on |
| \`DATABASE_TLS_INSECURE_SKIP_VERIFY\` | No | \`true\` accepts a certificate the collector image does not trust |
| \`DATABASE_COLLECTION_INTERVAL\` | No | How often statistics are read. Default \`30s\` |
| \`DATABASE_QUERY_EVENTS\` | No | \`true\` ships query samples and top queries as logs (they contain query text) |
| \`DATABASE_SERVER_ID\` | No | The id of a database OneUptime already shows; the data then joins it directly |

## Verify

After the first collection (about one \`DATABASE_COLLECTION_INTERVAL\`) the database's **Engine metrics** status turns to Connected and its Overview charts the engine. If nothing arrives, run the diagnostic script from the install directory:

\`\`\`bash
curl -sSL ${DATABASE_AGENT_RAW_URL}/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh
\`\`\`
${
  database
    ? alertingSection({
        databaseId: identity.databaseId,
        system: system,
        recommendationsUrl: data.recommendationsUrl,
      })
    : ""
}${databaseHealthSection({
    dbSystem: normalizeDatabaseSystem(database?.dbSystem || system) || "",
    databaseHealthMonitorUrl: data.databaseHealthMonitorUrl,
    database: database,
  })}`;
}

/*
 * The `receivers:` block for each collector-contrib receiver the agent
 * ships no config for, keyed by receiver type (DatabaseSystemDescriptor.
 * receiverTypes). `__ENDPOINT__` / `__HOST__` are replaced with the row's
 * identity; credentials stay `${env:...}` references for the collector's
 * environment. Each renders into a config that passes `otelcol validate`
 * on the collector version the agent pins.
 */
const RECEIVER_SNIPPETS: Record<string, string> = {
  couchdb: `receivers:
  couchdb:
    endpoint: "http://__ENDPOINT__"
    username: "\${env:DATABASE_USERNAME}"
    password: "\${env:DATABASE_PASSWORD}"
    collection_interval: 60s`,
  riak: `receivers:
  riak:
    # Riak's HTTP API (8098), not the Protocol Buffers port.
    endpoint: "http://__HOST__:8098"
    username: "\${env:DATABASE_USERNAME}"
    password: "\${env:DATABASE_PASSWORD}"
    collection_interval: 60s`,
  saphana: `receivers:
  saphana:
    endpoint: "__ENDPOINT__"
    username: "\${env:DATABASE_USERNAME}"
    password: "\${env:DATABASE_PASSWORD}"
    collection_interval: 60s`,
  snowflake: `receivers:
  snowflake:
    # The account identifier: the part of __HOST__ before .snowflakecomputing.com.
    account: "<account identifier>"
    username: "\${env:DATABASE_USERNAME}"
    password: "\${env:DATABASE_PASSWORD}"
    warehouse: "<warehouse to run the monitoring queries on>"
    role: "<role with access to SNOWFLAKE.ACCOUNT_USAGE>"
    collection_interval: 30m`,
  aerospike: `receivers:
  aerospike:
    endpoint: "__ENDPOINT__"
    collect_cluster_metrics: false
    collection_interval: 60s`,
  googlecloudspanner: `receivers:
  google_cloud_spanner:
    collection_interval: 60s
    projects:
      - project_id: "<project id>"
        service_account_key: "/etc/otelcol-contrib/spanner-key.json"
        instances:
          - instance_id: "<instance id>"
            databases:
              - "<database>"`,
};

/*
 * The receivers block for a receiver type, with the row's identity filled
 * in. A receiver without a snippet (none today: the ones the agent ships a
 * config for never reach this guide) points at its README.
 */
function receiverSnippetFor(
  receiverType: string,
  identity: DatabaseAgentIdentity,
): string {
  const template: string | undefined = RECEIVER_SNIPPETS[receiverType];
  if (!template) {
    return `receivers:
  ${getCollectorReceiverComponentName(receiverType)}:
    # See the receiver's README in opentelemetry-collector-contrib.`;
  }
  return template
    .split("__ENDPOINT__")
    .join(identity.endpoint)
    .split("__HOST__")
    .join(hostForUrl(identity.serverAddress));
}

function prometheusSnippet(
  system: string,
  source: { port: number; path: string },
  identity: DatabaseAgentIdentity,
): string {
  return `receivers:
  prometheus/database:
    config:
      scrape_configs:
        - job_name: "${system}"
          scrape_interval: 30s
          metrics_path: "${source.path}"
          static_configs:
            - targets: ["${hostForUrl(identity.serverAddress)}:${source.port}"]`;
}

/** The identity processor, exporter and pipeline every recipe ends with. */
function identityPipeline(data: {
  system: string;
  identity: DatabaseAgentIdentity;
  databaseId: string;
  oneuptimeUrl: string;
  apiKey: string;
  receiverName: string | null;
  isPrometheus: boolean;
}): string {
  const portAttribute: string =
    data.identity.serverPort !== null
      ? `
      - key: server.port
        value: ${data.identity.serverPort}
        action: upsert`
      : "";
  // The prometheus receiver names the scrape job and target itself.
  const instanceDelete: string = data.isPrometheus
    ? `
      - key: service.instance.id
        action: delete`
    : "";
  const pipeline: string = data.receiverName
    ? `

service:
  pipelines:
    metrics/database:
      receivers: [${data.receiverName}]
      processors: [resource/database]
      exporters: [otlphttp]`
    : "";
  return `processors:
  resource/database:
    attributes:
      - key: db.system.name
        value: ${data.system}
        action: upsert
      - key: server.address
        value: "${data.identity.serverAddress}"
        action: upsert${portAttribute}
      - key: ${DATABASE_SERVER_ID_ATTRIBUTE_NAME}
        value: "${data.databaseId}"
        action: upsert
      - key: service.name
        action: delete${instanceDelete}

exporters:
  otlphttp:
    endpoint: "${data.oneuptimeUrl}/otlp"
    headers:
      x-oneuptime-token: "${data.apiKey}"${pipeline}`;
}

/**
 * The guide for an engine the Database Agent ships no config for: where its
 * engine metrics come from (a contrib receiver, its own Prometheus endpoint,
 * its cloud provider's monitoring API — or nowhere, for an in-process
 * engine), with a complete collector config that stamps this database's
 * identity where there is one.
 */
export function getDatabaseOwnCollectorMarkdown(data: {
  oneuptimeUrl: string;
  apiKey: string;
  database: DatabaseDocumentationTarget;
  databaseHealthMonitorUrl?: string | null | undefined;
  recommendationsUrl?: string | null | undefined;
}): string {
  const descriptor: DatabaseSystemDescriptor | null =
    getDatabaseSystemDescriptor(data.database.dbSystem);
  const engineLabel: string = getDatabaseSystemDisplayName(
    data.database.dbSystem,
  );
  const system: string =
    normalizeDatabaseSystem(data.database.dbSystem) || "unknown";
  const source: DatabaseEngineMetricsSource = descriptor
    ? descriptor.engineMetrics
    : {
        kind: "none",
        reason: `OneUptime does not know ${engineLabel}'s engine yet; if a collector receiver or a Prometheus endpoint exposes its metrics, stamp them with the block below.`,
      };

  const healthSection: string = databaseHealthSection({
    dbSystem: system,
    databaseHealthMonitorUrl: data.databaseHealthMonitorUrl,
    database: data.database,
  });
  const agentIntro: string =
    "The OneUptime Database Agent ships configs for PostgreSQL, MySQL / MariaDB, Redis (and Valkey, KeyDB, Dragonfly), MongoDB, SQL Server, Oracle, Elasticsearch / OpenSearch and Memcached.";
  const alongside: string = `Its page shows everything your instrumented applications report about it either way: the queries they send (rate, errors and latency on the Overview and the Traces tab), the services that call it, and — when it runs in Kubernetes, Docker or Podman — its pods or containers with their logs.`;

  if (source.kind === "embedded") {
    return `
${agentIntro} ${engineLabel} runs inside your application's process, so there is no server to collect engine metrics from.

${alongside}

Database id (for \`${DATABASE_SERVER_ID_ATTRIBUTE_NAME}\`): \`${data.database.id}\`
${healthSection}`;
  }

  const identity: DatabaseAgentIdentity = resolveDatabaseAgentIdentity(
    system,
    data.database,
  );

  let lead: string;
  let receiverBlock: string = "";
  let receiverName: string | null = null;

  if (source.kind === "receiver" && descriptor) {
    const receiverType: string = descriptor.receiverTypes[0] || "";
    receiverName = getCollectorReceiverComponentName(receiverType);
    receiverBlock = receiverSnippetFor(receiverType, identity);
    lead = `For ${engineLabel}, run the OpenTelemetry Collector's \`${receiverName}\` receiver in your own collector (\`otel/opentelemetry-collector-contrib\`) and stamp this database's identity on its data, so OneUptime attaches it here. A complete config:`;
  } else if (source.kind === "prometheus") {
    receiverName = "prometheus/database";
    receiverBlock = prometheusSnippet(system, source, identity);
    lead = `The collector has no dedicated receiver for ${engineLabel}, but ${engineLabel} serves Prometheus metrics itself (\`${source.path}\` on port ${source.port}).${
      source.note ? ` ${source.note}` : ""
    } Scrape it with the collector's \`prometheus\` receiver and stamp this database's identity — the \`prometheus\` receiver sets \`service.name\` and \`service.instance.id\` from the scrape job, so both are deleted:`;
  } else if (source.kind === "cloud-monitoring") {
    lead = `${engineLabel} is a managed service: its metrics come from the provider's monitoring API, not from a connection to the database. ${source.note} Stamp this database's identity on that pipeline with the processor below, so the data attaches here:`;
  } else {
    lead = `${source.kind === "none" ? source.reason : ""} Whatever sends ${engineLabel}'s metrics, stamp this database's identity on them with the processor below, so the data attaches here:`;
  }

  const config: string = [
    receiverBlock,
    identityPipeline({
      system: system,
      identity: identity,
      databaseId: data.database.id,
      oneuptimeUrl: data.oneuptimeUrl,
      apiKey: data.apiKey,
      receiverName: receiverName,
      isPrometheus: source.kind === "prometheus",
    }),
  ]
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .join("\n\n");

  const credentials: string = receiverBlock.includes("${env:")
    ? " Set the `${env:...}` variables in the collector's environment; the collector expands `$` inside them once more, so write every `$` in a password as `$$`."
    : "";

  return `
${agentIntro} ${lead}

\`\`\`yaml
${config}
\`\`\`

Keep one receiver instance per database server in this pipeline — every batch carries this database's identity — and no \`resourcedetection\` processor: its \`host.name\` would make the collector's machine look like the thing being monitored.${credentials}${
    identity.isPrefilled
      ? ""
      : ` This database has no address yet, so replace \`${PLACEHOLDER_ADDRESS}\` with the host name your applications use to reach it.`
  }

${alongside}
${alertingSection({
  databaseId: data.database.id,
  system: system,
  recommendationsUrl: data.recommendationsUrl,
})}${healthSection}`;
}
