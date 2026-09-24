import {
  DATABASE_AGENT_COLLECTOR_IMAGE,
  DATABASE_AGENT_CONFIGS,
  DATABASE_AGENT_DOCKER_COMPOSE,
  DATABASE_AGENT_ENGINES,
  DatabaseAgentEngine,
} from "./DatabaseAgentConfigs";
import {
  DatabaseEndpoint,
  parseDatabaseEndpointString,
} from "Common/Types/DatabaseServer/DatabaseEndpoint";
import {
  DatabaseSystemDescriptor,
  getDatabaseSystemDescriptor,
  getDatabaseSystemDisplayName,
  getDefaultDatabasePort,
  normalizeDatabaseSystem,
} from "Common/Types/DatabaseServer/DatabaseSystem";

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

const ENGINE_LABELS: Record<DatabaseAgentEngine, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL / MariaDB",
  redis: "Redis / Valkey",
  mongodb: "MongoDB",
};

/** The picker label of an agent engine. */
export function getDatabaseAgentEngineLabel(
  engine: DatabaseAgentEngine,
): string {
  return ENGINE_LABELS[engine];
}

/**
 * The agent engine for a row's dbSystem ("postgres" → "postgresql",
 * "mariadb" → "mysql"), or null when the agent ships no config for it.
 */
export function getDatabaseAgentEngine(
  dbSystem: string | null | undefined,
): DatabaseAgentEngine | null {
  const normalized: string | null = normalizeDatabaseSystem(dbSystem);
  if (!normalized) {
    return null;
  }
  return (
    DATABASE_AGENT_ENGINES.find((engine: DatabaseAgentEngine): boolean => {
      return engine === normalized;
    }) || null
  );
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
  // DATABASE_SERVER_ADDRESS — the name applications use.
  serverAddress: string;
  // DATABASE_SERVER_PORT; null only for an engine without a default port.
  serverPort: number | null;
  // DATABASE_ENDPOINT — where the agent connects.
  endpoint: string;
  // DATABASE_SERVER_ID, "" on the product page.
  databaseId: string;
  // False when the values are placeholders, not the row's own.
  isPrefilled: boolean;
}

const PLACEHOLDER_ADDRESS: string = "db.internal";

function hostForUrl(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

/**
 * The identity the guide stamps. For a row: its serverAddress / serverPort
 * when set, otherwise its first parseable endpoint (cluster qualifier
 * dropped — the agent stamps server.address and server.port only, and the
 * row id carries the rest). For the product page: placeholders with the
 * engine's default port.
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
  };
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
`,
  mysql: `
\`\`\`sql
CREATE USER 'oneuptime_monitor'@'%' IDENTIFIED BY 'a-strong-password';
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'oneuptime_monitor'@'%';
GRANT SELECT ON performance_schema.* TO 'oneuptime_monitor'@'%';
\`\`\`

\`PROCESS\` and \`REPLICATION CLIENT\` cover the global status counters, InnoDB status and replica status; \`performance_schema\` is read for query samples and top queries. MariaDB uses the same grants.
`,
  redis: `
\`\`\`text
ACL SETUSER oneuptime_monitor on >a-strong-password -@all +info +ping
\`\`\`

The receiver only runs \`INFO\`. Persist the user with \`ACL SAVE\` (or a \`user\` line in \`redis.conf\` / your ACL file). On a server protected only by \`requirepass\`, leave \`DATABASE_USERNAME\` empty and set \`DATABASE_PASSWORD\`; on a server without authentication leave both empty.
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
};

function usernameFor(engine: DatabaseAgentEngine): string {
  return engine === "redis" ? "" : "oneuptime_monitor";
}

/** The `.env` file, with the viewer's URL and key and the row's identity. */
export function getDatabaseAgentEnvFile(data: {
  oneuptimeUrl: string;
  apiKey: string;
  engine: DatabaseAgentEngine;
  identity: DatabaseAgentIdentity;
}): string {
  return `ONEUPTIME_URL=${data.oneuptimeUrl}
ONEUPTIME_TELEMETRY_INGESTION_KEY=${data.apiKey}
DATABASE_SYSTEM=${data.engine}
DATABASE_ENDPOINT=${data.identity.endpoint}
DATABASE_SERVER_ADDRESS=${data.identity.serverAddress}
DATABASE_SERVER_PORT=${data.identity.serverPort ?? ""}
DATABASE_USERNAME=${usernameFor(data.engine)}
DATABASE_PASSWORD='a-strong-password'
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
}): string {
  const namespace: string = data.namespace.trim() || "default";
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
              value: "${data.engine}"
            - name: DATABASE_ENDPOINT
              value: "${data.identity.endpoint}"
            - name: DATABASE_SERVER_ADDRESS
              value: "${data.identity.serverAddress}"
            - name: DATABASE_SERVER_PORT
              value: "${data.identity.serverPort ?? ""}"
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
  identity: DatabaseAgentIdentity;
  namespace: string;
}): string {
  const namespace: string = data.namespace.trim() || "default";
  return `
## Run the agent in Kubernetes

This database runs in Kubernetes, so the agent is best run as a small Deployment in its namespace (\`${namespace}\`). \`DATABASE_SERVER_ID\` ties the metrics to this database directly: a cluster-local name is only unique inside one cluster, so it never creates a database on its own.

1. Put the collector config in a ConfigMap and the secrets in a Secret:

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
})}
\`\`\`

Set \`DATABASE_ENDPOINT\` and \`DATABASE_SERVER_ADDRESS\` to the database Service's full name (\`<service>.${namespace}.svc.cluster.local\`) if the prefilled value is not it. The agent never stamps \`k8s.cluster.name\`: OneUptime reads that attribute as the Kubernetes agent's heartbeat.
`;
}

function databaseHealthSection(data: {
  dbSystem: string;
  databaseHealthMonitorUrl?: string | null | undefined;
}): string {
  if (!DATABASE_HEALTH_MONITOR_SYSTEMS.includes(data.dbSystem)) {
    return "";
  }
  const link: string = data.databaseHealthMonitorUrl
    ? `[create a Database Health monitor](${data.databaseHealthMonitorUrl})`
    : "create a Database Health monitor";
  return `
## No agent? Use a Database Health monitor

For a probe-based check that needs no agent at all — connections, locks, cache and replication health, with alerting — ${link} (PostgreSQL, MySQL and SQL Server). It uses the same monitoring user.
`;
}

/**
 * The full agent guide for one engine. With `database`, every value that
 * identifies the database is prefilled for that row, its id included; the
 * Kubernetes section appears for a Kubernetes-detected row.
 */
export function getDatabaseAgentInstallationMarkdown(data: {
  oneuptimeUrl: string;
  apiKey: string;
  engine: DatabaseAgentEngine;
  database?: DatabaseDocumentationTarget | null | undefined;
  databaseHealthMonitorUrl?: string | null | undefined;
}): string {
  const identity: DatabaseAgentIdentity = resolveDatabaseAgentIdentity(
    data.engine,
    data.database,
  );
  const serverPortText: string =
    identity.serverPort !== null ? String(identity.serverPort) : "";
  const engineLabel: string = getDatabaseAgentEngineLabel(data.engine);
  const database: DatabaseDocumentationTarget | null | undefined =
    data.database;

  const thisDatabase: string = database
    ? `
## This database

| Setting | Value |
|---------|-------|
| \`DATABASE_SERVER_ID\` | \`${identity.databaseId}\` |
| \`DATABASE_SERVER_ADDRESS\` | \`${identity.serverAddress}\` |
| \`DATABASE_SERVER_PORT\` | \`${serverPortText}\` |

Every block below is prefilled with these values. \`DATABASE_SERVER_ID\` links the agent's data to this database directly, whatever its address — keep it set, especially for a private IP or a name that only resolves inside your network.${
        identity.isPrefilled
          ? ""
          : " This database has no address yet, so replace `db.internal` with the host name your applications use to reach it."
      }
`
    : "";

  const installEnv: string = [
    `DATABASE_SYSTEM=${data.engine}`,
    database ? `DATABASE_SERVER_ADDRESS=${identity.serverAddress}` : "",
    database ? `DATABASE_SERVER_PORT=${serverPortText}` : "",
    database ? `DATABASE_SERVER_ID=${identity.databaseId}` : "",
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
          identity: identity,
          namespace: database.kubernetesNamespace || "",
        })
      : "";

  return `
The OneUptime Database Agent collects ${engineLabel} engine metrics — connections, throughput, cache hit ratio, locks, replication, memory — with a stock OpenTelemetry Collector container (\`${DATABASE_AGENT_COLLECTOR_IMAGE}\`) running the collector's native \`${data.engine}\` receiver. Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.
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

The script asks for anything not given up front (your OneUptime URL and ingestion key, the endpoint to connect to and the monitoring credentials — the password is read without echo), installs to \`/opt/oneuptime-database-agent\`, writes a \`0600\` \`.env\` file with values quoted for Docker Compose, and starts the agent. Re-running it reuses the existing \`.env\`.

## Quick Start — Docker Compose

Download \`docker-compose.yml\` and \`configs/${data.engine}.yaml\` (saved as \`otel-collector-config.yaml\`) from the [DatabaseAgent directory](${DATABASE_AGENT_DIRECTORY_URL}) into one folder, then create a \`.env\` file next to them (\`chmod 600 .env\` — it holds a password):

\`\`\`bash
${getDatabaseAgentEnvFile({
  oneuptimeUrl: data.oneuptimeUrl,
  apiKey: data.apiKey,
  engine: data.engine,
  identity: identity,
})}
\`\`\`

Then start the agent:

\`\`\`bash
docker compose up -d
\`\`\`

\`DATABASE_ENDPOINT\` is where the agent connects (\`host.docker.internal:<port>\` when it runs on the database machine). \`DATABASE_SERVER_ADDRESS\` is the database's identity: the host name your **applications** use to reach it, never \`localhost\`. Keep it stable — changing it registers a second database. If the password contains \`$\`, \`#\`, spaces or quotes, single-quote it in \`.env\` as above.

### docker-compose.yml

\`\`\`yaml
${DATABASE_AGENT_DOCKER_COMPOSE.trimEnd()}
\`\`\`

### otel-collector-config.yaml (${engineLabel})

\`\`\`yaml
${DATABASE_AGENT_CONFIGS[data.engine].trimEnd()}
\`\`\`
${kubernetes}
## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| \`ONEUPTIME_URL\` | Yes | Your OneUptime URL |
| \`ONEUPTIME_TELEMETRY_INGESTION_KEY\` | Yes | The telemetry ingestion key selected above |
| \`DATABASE_SYSTEM\` | Yes | \`postgresql\`, \`mysql\`, \`redis\` or \`mongodb\` |
| \`DATABASE_ENDPOINT\` | Yes | \`host:port\` the agent connects to |
| \`DATABASE_SERVER_ADDRESS\` | Yes | The host name your applications use — the database's identity |
| \`DATABASE_SERVER_PORT\` | Yes | The port your applications use |
| \`DATABASE_USERNAME\` | PostgreSQL, MySQL | The monitoring user |
| \`DATABASE_PASSWORD\` | PostgreSQL | Its password (single-quoted in \`.env\`) |
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
${databaseHealthSection({
  dbSystem: normalizeDatabaseSystem(database?.dbSystem || data.engine) || "",
  databaseHealthMonitorUrl: data.databaseHealthMonitorUrl,
})}`;
}

/**
 * The guide for an engine the Database Agent ships no config for: point
 * your own OpenTelemetry Collector's receiver at it and stamp the identity,
 * or — when no collector receiver exists — explain what the page shows
 * without engine metrics.
 */
export function getDatabaseOwnCollectorMarkdown(data: {
  oneuptimeUrl: string;
  apiKey: string;
  database: DatabaseDocumentationTarget;
  databaseHealthMonitorUrl?: string | null | undefined;
}): string {
  const descriptor: DatabaseSystemDescriptor | null =
    getDatabaseSystemDescriptor(data.database.dbSystem);
  const engineLabel: string = getDatabaseSystemDisplayName(
    data.database.dbSystem,
  );
  const system: string =
    normalizeDatabaseSystem(data.database.dbSystem) || "unknown";

  const receiverType: string =
    descriptor && descriptor.hasCollectorReceiver
      ? descriptor.receiverTypes[0] || ""
      : "";

  const healthSection: string = databaseHealthSection({
    dbSystem: system,
    databaseHealthMonitorUrl: data.databaseHealthMonitorUrl,
  });

  if (!receiverType) {
    return `
The OneUptime Database Agent ships configs for PostgreSQL, MySQL / MariaDB, Redis / Valkey and MongoDB. There is no OpenTelemetry Collector receiver for ${engineLabel}, so this database has no engine metrics.

Its page still shows everything your instrumented applications report about it: the queries they send (rate, errors and latency on the Overview and the Traces tab), the services that call it, and — when it runs in Kubernetes, Docker or Podman — its pods or containers with their logs.

Database id (for \`oneuptime.database.server.id\`): \`${data.database.id}\`
${healthSection}`;
  }

  const identity: DatabaseAgentIdentity = resolveDatabaseAgentIdentity(
    system,
    data.database,
  );
  const portAttribute: string =
    identity.serverPort !== null
      ? `
      - key: server.port
        value: ${identity.serverPort}
        action: upsert`
      : "";

  return `
The OneUptime Database Agent ships configs for PostgreSQL, MySQL / MariaDB, Redis / Valkey and MongoDB. For ${engineLabel}, run the OpenTelemetry Collector's \`${receiverType}\` receiver in your own collector (\`otel/opentelemetry-collector-contrib\`) and stamp the database's identity on its data, so OneUptime attaches it to this database:

\`\`\`yaml
processors:
  resource/database:
    attributes:
      - key: db.system.name
        value: ${system}
        action: upsert
      - key: server.address
        value: "${identity.serverAddress}"
        action: upsert${portAttribute}
      - key: oneuptime.database.server.id
        value: "${data.database.id}"
        action: upsert
      - key: service.name
        action: delete

exporters:
  otlphttp:
    endpoint: "${data.oneuptimeUrl}/otlp"
    headers:
      x-oneuptime-token: "${data.apiKey}"
\`\`\`

Add \`resource/database\` to the metrics (and logs) pipeline of the \`${receiverType}\` receiver, with no \`resourcedetection\` processor in that pipeline — its \`host.name\` would make the collector's machine look like the thing being monitored. Keep one receiver instance per database server: every batch carries this database's identity.
${healthSection}`;
}
