import {
  DATABASE_AGENT_COLLECTOR_IMAGE,
  DATABASE_AGENT_CONFIGS,
  DATABASE_AGENT_DOCKER_COMPOSE,
  DATABASE_AGENT_ENGINES,
  DatabaseAgentEngine,
} from "./DatabaseAgentConfigs";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SETUP_GUIDE_URL_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideLink,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideStepVariant,
  SetupGuideTopic,
  codeBlock,
  shellQuote,
} from "../../../Components/SetupGuide/SetupGuide";
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
import { translateTemplate } from "Common/UI/Utils/TranslateTemplate";

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
 * Two shapes are built from the same pieces:
 *
 *   - getDatabaseAgentSetupGuide / getDatabaseOwnCollectorSetupGuide: the
 *     SetupGuide the Documentation card renders — the engine picker, a few
 *     steps, and everything else folded under Advanced and Troubleshooting;
 *   - getDatabaseAgentInstallationMarkdown / getDatabaseOwnCollectorMarkdown:
 *     the same guide as one markdown document, as it read before the
 *     SetupGuide layout. Its tests pin the identity, quoting and escaping
 *     rules every piece below follows, so it stays byte for byte what it was.
 *
 * Pure: plain strings in, markdown out. No React, no API.
 */

export const DATABASE_AGENT_DIRECTORY_URL: string =
  "https://github.com/OneUptime/oneuptime/tree/master/agents/DatabaseAgent";
export const DATABASE_AGENT_RAW_URL: string =
  "https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DatabaseAgent";

// Where install.sh installs, and where troubleshoot.sh looks by default.
export const DATABASE_AGENT_INSTALL_DIRECTORY: string =
  "/opt/oneuptime-database-agent";

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

/*
 * What each config's receiver reports, as the guide's first sentence says
 * it — the metrics the e2e run saw arriving from each receiver (collector
 * 0.161.0), plus the ones the config switches on. Per engine, because they
 * differ: Memcached, for one, has no locks and no replication.
 */
const COLLECTED_METRICS: Record<DatabaseAgentEngine, string> = {
  postgresql:
    "connections against `max_connections`, commits and rollbacks, cache hit ratio, row throughput, locks and deadlocks, temporary files, database, table and index sizes, checkpoints and the background writer, vacuums and replication lag",
  mysql:
    "threads and connections, connection errors, queries and slow queries, commands, the InnoDB buffer pool, row and table locks, row operations and handlers, temporary tables and sorts, and replica lag",
  redis:
    "connected and blocked clients, commands per second and their latency, keyspace hits and misses, memory against `maxmemory`, evicted and expired keys, and replication",
  mongodb:
    "connections, operations and their latency, active reads and writes, cache operations, memory, data, storage and index sizes, cursors, sessions and page faults",
  sqlserver:
    "user connections, batch requests and compilations, buffer cache hit ratio, page life expectancy, lock waits, deadlocks and blocked processes, pending memory grants, CPU, database I/O and latency, and availability-group replica lag",
  oracledb:
    "sessions, executions, commits and rollbacks, parses, logical and physical reads, CPU and DB time, PGA and SGA memory and tablespace usage",
  elasticsearch:
    "cluster health, nodes, shards and pending tasks, documents, indexing and search operations, thread pools, caches, disk, and JVM heap and garbage collection",
  memcached:
    "connections, commands, get hits and misses (the cache hit ratio), evictions, items, memory used, network traffic, threads and CPU",
};

/*
 * Whether a config ships the receiver's query events (query samples and top
 * queries), which DATABASE_QUERY_EVENTS switches on.
 */
function hasQueryEvents(engine: DatabaseAgentEngine): boolean {
  return DATABASE_AGENT_CONFIGS[engine].includes("db.server.top_query:");
}

/**
 * What the agent collects for an engine, in words: its receiver's metrics,
 * and the optional query events where its config ships them (the configs
 * that switch the receiver's `db.server.top_query` event on).
 */
export function getDatabaseAgentCollectedSummary(
  engine: DatabaseAgentEngine,
): string {
  return hasQueryEvents(engine)
    ? `${COLLECTED_METRICS[engine]}, plus optional query samples and top queries (\`DATABASE_QUERY_EVENTS\`)`
    : COLLECTED_METRICS[engine];
}

/**
 * The metrics half of getDatabaseAgentCollectedSummary as plain text (the
 * markdown's backticks dropped), for copy that is not rendered as markdown:
 * the Overview's "Engine metrics not connected" card.
 */
export function getDatabaseAgentCollectedMetricsText(
  engine: DatabaseAgentEngine,
): string {
  return COLLECTED_METRICS[engine].replace(/`/g, "");
}

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

/*
 * A fork or drop-in the config monitors besides the engine it is named
 * after: MariaDB with the mysql config, Valkey with the redis one.
 */
function isForkOfEngine(engine: DatabaseAgentEngine, system: string): boolean {
  return system !== DEFAULT_SYSTEM_FOR_ENGINE[engine];
}

/*
 * One line under each engine in the product page's picker: the config it
 * runs, and for a fork the name it reports.
 */
function getDatabaseAgentSystemDescription(system: string): string {
  const engine: DatabaseAgentEngine = getDatabaseAgentEngine(
    system,
  ) as DatabaseAgentEngine;
  const receiverName: string = getCollectorReceiverComponentName(engine);
  return isForkOfEngine(engine, system)
    ? `Runs the ${receiverName} receiver and reports the server as ${getDatabaseSystemDisplayName(system)}.`
    : `Runs the collector's ${receiverName} receiver.`;
}

/*
 * The product page's picker: every engine the agent monitors, forks
 * included, keyed by the DATABASE_SYSTEM it installs under.
 */
export const DATABASE_AGENT_SYSTEM_OPTIONS: Array<SetupGuideOption> =
  getDatabaseAgentSystems().map((system: string): SetupGuideOption => {
    return {
      key: system,
      label: getDatabaseSystemDisplayName(system),
      description: getDatabaseAgentSystemDescription(system),
    };
  });

export const DEFAULT_DATABASE_AGENT_SYSTEM: string = "postgresql";

/** The picked engine, or PostgreSQL for one the picker does not offer. */
export function resolveDatabaseAgentSystem(
  system: string | null | undefined,
): string {
  const isOffered: boolean = DATABASE_AGENT_SYSTEM_OPTIONS.some(
    (option: SetupGuideOption): boolean => {
      return option.key === system;
    },
  );
  return isOffered ? (system as string) : DEFAULT_DATABASE_AGENT_SYSTEM;
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

/**
 * The title and description of a database's Documentation tab: an engine
 * the agent monitors is told to install it, one it does not to use its own
 * collector, and an in-process engine that there is no server to monitor.
 */
export function getDatabaseDocumentationHeading(
  database: DatabaseDocumentationTarget,
): { title: string; description: string } {
  const engineLabel: string = getDatabaseSystemDisplayName(database.dbSystem);

  if (getDatabaseAgentEngine(database.dbSystem)) {
    return {
      title: translateTemplate("Connect {{engine}} engine metrics", {
        engine: engineLabel,
      }),
      description:
        "Install the OneUptime Database Agent next to this database to add its engine metrics. Every value below is prefilled for this database, including its id.",
    };
  }

  if (
    getDatabaseSystemDescriptor(database.dbSystem)?.engineMetrics.kind ===
    "embedded"
  ) {
    return {
      title: translateTemplate("Monitor {{engine}}", { engine: engineLabel }),
      description: translateTemplate(
        "{{engine}} runs inside your application's process, so this database's page fills in from the traces of the applications that use it.",
        { engine: engineLabel },
      ),
    };
  }

  return {
    title: translateTemplate("Connect {{engine}} engine metrics", {
      engine: engineLabel,
    }),
    description:
      "Send this database's engine metrics from your own OpenTelemetry Collector. Every value below is prefilled for this database, including its id.",
  };
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

/*
 * One word of a shell command line whose value reaches the command as
 * written (the guides' shared quoting): bare when made only of characters
 * the shell leaves alone, otherwise single-quoted.
 */
const shellWord: (value: string) => string = shellQuote;

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

/*
 * Where a piece of an engine's monitoring-user instructions is shown:
 *
 *   - "document": the single-document guide, which prints every piece of
 *     the engine in order (the text the README's grants are pinned to);
 *   - "engine": the setup guide's step, for the engine the config is named
 *     after (PostgreSQL, MySQL, Redis, Elasticsearch …);
 *   - "fork": the setup guide's step, for a fork the config also monitors
 *     (MariaDB, Valkey, OpenSearch …) — so MySQL is not told about
 *     MariaDB's extra grant, and OpenSearch is not shown Elasticsearch's
 *     security API;
 *   - "queryEvents": the setup guide's "Query samples and top queries"
 *     topic, since a first install leaves them off.
 */
type MonitoringUserPlacement = "document" | "engine" | "fork" | "queryEvents";

interface MonitoringUserPiece {
  text: string;
  placements: Array<MonitoringUserPlacement>;
}

const DOCUMENT_AND_STEPS: Array<MonitoringUserPlacement> = [
  "document",
  "engine",
  "fork",
];

/* The least-privilege monitoring login per engine (agents/DatabaseAgent/README.md). */
const MONITORING_USER_PIECES: Record<
  DatabaseAgentEngine,
  Array<MonitoringUserPiece>
> = {
  postgresql: [
    {
      text: `
${codeBlock(
  "sql",
  `CREATE USER oneuptime_monitor WITH PASSWORD 'a-strong-password';
GRANT pg_monitor TO oneuptime_monitor;`,
)}

\`pg_monitor\` (PostgreSQL 10 and later) reads the statistics views and grants no access to your tables. Without it \`pg_stat_activity\` does not fail — it returns only the agent's own session, so connection counts read \`1\`. The receiver connects to every database to read per-database statistics, so the user also needs \`CONNECT\` on each one (\`PUBLIC\` has it by default). The PostgreSQL receiver refuses to start without a password. On a managed service where \`pg_monitor\` is unavailable, \`pg_read_all_stats\` covers the same views.
`,
      placements: DOCUMENT_AND_STEPS,
    },
    {
      text: `
Top queries (\`DATABASE_QUERY_EVENTS=true\`) also need the \`pg_stat_statements\` extension, loaded through \`shared_preload_libraries = 'pg_stat_statements'\` (a restart) and created in every monitored database:

${codeBlock("sql", "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;")}

Their explain plans additionally need \`SELECT\` on the tables the queries touch, which \`pg_monitor\` does not grant (for example \`GRANT SELECT ON ALL TABLES IN SCHEMA app TO oneuptime_monitor\`). Without it top queries still arrive, with empty plans, and the collector logs \`failed to explain\` for each one.
`,
      placements: ["document", "queryEvents"],
    },
  ],
  mysql: [
    {
      text: `
${codeBlock(
  "sql",
  `CREATE USER 'oneuptime_monitor'@'%' IDENTIFIED BY 'a-strong-password';
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'oneuptime_monitor'@'%';
GRANT SELECT ON performance_schema.* TO 'oneuptime_monitor'@'%';`,
)}

\`PROCESS\` and \`REPLICATION CLIENT\` cover the global status counters, InnoDB status and replica status; \`performance_schema\` is read for query samples and top queries.`,
      placements: DOCUMENT_AND_STEPS,
    },
    {
      text: " MariaDB 10.5.9 and later split replica status into its own privilege, so also run `GRANT SLAVE MONITOR ON *.* TO 'oneuptime_monitor'@'%';` there.",
      placements: ["document", "fork"],
    },
    { text: "\n", placements: DOCUMENT_AND_STEPS },
  ],
  redis: [
    {
      text: `
${codeBlock(
  "text",
  "ACL SETUSER oneuptime_monitor on >a-strong-password -@all +info +ping",
)}

The receiver only runs \`INFO\`. Persist the user with \`ACL SAVE\` (or a \`user\` line in \`redis.conf\` / your ACL file). On a server protected only by \`requirepass\`, leave \`DATABASE_USERNAME\` empty and set \`DATABASE_PASSWORD\`; on a server without authentication leave both empty.`,
      placements: DOCUMENT_AND_STEPS,
    },
    {
      text: " Valkey, KeyDB and Dragonfly take the same ACL.",
      placements: ["document", "fork"],
    },
    { text: "\n", placements: DOCUMENT_AND_STEPS },
  ],
  mongodb: [
    {
      text: `
${codeBlock(
  "js",
  `db.getSiblingDB("admin").createUser({
  user: "oneuptime_monitor",
  pwd: "a-strong-password",
  roles: [{ role: "clusterMonitor", db: "admin" }],
});`,
)}

\`clusterMonitor\` covers every metric.`,
      placements: DOCUMENT_AND_STEPS,
    },
    {
      text: ' Explain plans on top queries additionally need `{ role: "read", db: "<database>" }` for each monitored database.',
      placements: ["document", "queryEvents"],
    },
    {
      text: " The agent connects to exactly one member, so run one agent per replica-set member.\n",
      placements: DOCUMENT_AND_STEPS,
    },
  ],
  sqlserver: [
    {
      text: `
${codeBlock(
  "sql",
  `CREATE LOGIN oneuptime_monitor WITH PASSWORD = 'a-strong-password';
GRANT VIEW SERVER STATE TO oneuptime_monitor;
GRANT VIEW ANY DEFINITION TO oneuptime_monitor;`,
)}

\`VIEW SERVER STATE\` (on SQL Server 2022 and later \`VIEW SERVER PERFORMANCE STATE\` is enough) reads the dynamic management views every metric comes from, and grants no access to your data. The receiver puts the login into a connection string without quoting it, so the user name and password must not contain a semicolon (\`;\`) or a double quote (\`"\`), nor start or end with a space — the install script refuses them. For a named instance (\`host\\instance\`), connect to the instance's own TCP port (\`host:port\`), never the default instance's 1433: SQL Server Configuration Manager shows it, or run \`SELECT local_tcp_port FROM sys.dm_exec_connections WHERE session_id = @@SPID;\` on the instance.
`,
      placements: DOCUMENT_AND_STEPS,
    },
  ],
  oracledb: [
    {
      text: `
${codeBlock(
  "sql",
  `-- In the pluggable database the agent connects to, e.g. ALTER SESSION SET CONTAINER = FREEPDB1;
CREATE USER oneuptime_monitor IDENTIFIED BY "a-strong-password";
GRANT CREATE SESSION TO oneuptime_monitor;
GRANT SELECT_CATALOG_ROLE TO oneuptime_monitor;`,
)}

\`SELECT_CATALOG_ROLE\` reads the \`V$\` and \`DBA_\` views the metrics, query samples and top queries come from, and grants no access to your tables. \`DATABASE_ORACLE_SERVICE\` is the service the agent connects to (\`FREEPDB1\`, \`ORCLPDB1\`, …).
`,
      placements: DOCUMENT_AND_STEPS,
    },
  ],
  elasticsearch: [
    {
      text: `
${codeBlock(
  "text",
  `POST /_security/role/oneuptime_monitor
{ "cluster": ["monitor"], "indices": [{ "names": ["*"], "privileges": ["monitor"] }] }

POST /_security/user/oneuptime_monitor
{ "password": "a-strong-password", "roles": ["oneuptime_monitor"] }`,
)}

The \`monitor\` privileges read node, cluster and index statistics and no documents.`,
      placements: ["document", "engine"],
    },
    {
      text: " On OpenSearch with the security plugin, grant the cluster permission `cluster_monitor` and the index permission `indices_monitor` on `*` instead.",
      placements: ["document"],
    },
    {
      text: "On OpenSearch with the security plugin, give the monitoring user the cluster permission `cluster_monitor` and the index permission `indices_monitor` on `*`.",
      placements: ["fork"],
    },
    {
      text: " On a cluster without security, leave `DATABASE_USERNAME` and `DATABASE_PASSWORD` empty.\n",
      placements: DOCUMENT_AND_STEPS,
    },
  ],
  memcached: [
    {
      text: `
Memcached has no users: the receiver runs \`stats\` over the text protocol, so leave \`DATABASE_USERNAME\` and \`DATABASE_PASSWORD\` empty. A server started with SASL authentication (\`-S\`) cannot be monitored this way.
`,
      placements: ["document"],
    },
  ],
};

/*
 * An engine's monitoring-user instructions for one place: the whole text
 * for the single document, the parts that apply to the picked engine for
 * the setup guide's step, or the query-event requirements.
 */
function getMonitoringUserMarkdown(
  engine: DatabaseAgentEngine,
  placement: MonitoringUserPlacement,
): string {
  const text: string = MONITORING_USER_PIECES[engine]
    .filter((piece: MonitoringUserPiece): boolean => {
      return piece.placements.includes(placement);
    })
    .map((piece: MonitoringUserPiece): string => {
      return piece.text;
    })
    .join("");
  // The document keeps its own spacing; a step or topic body is trimmed.
  return placement === "document" ? text : text.trim();
}

const MONITORING_USER_INTRO: string =
  "Give the agent its own login with read access to the engine's statistics — never an administrator, and never an application's own login.";

/*
 * How install.sh treats the monitoring login per config (its LOGIN
 * variable): PostgreSQL, MySQL, SQL Server and Oracle refuse to start
 * without one, Memcached has none, and the rest take one when the server
 * has users.
 */
function isLoginRequired(engine: DatabaseAgentEngine): boolean {
  return (
    engine === "postgresql" ||
    engine === "mysql" ||
    engine === "sqlserver" ||
    engine === "oracledb"
  );
}

function hasLogin(engine: DatabaseAgentEngine): boolean {
  return engine !== "memcached";
}

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

/*
 * Running the agent as a Deployment in a Kubernetes database's namespace:
 * the ConfigMap and Secret it reads, then the Deployment.
 */
function kubernetesDeploymentMarkdown(data: {
  oneuptimeUrl: string;
  apiKey: string;
  engine: DatabaseAgentEngine;
  system: string;
  identity: DatabaseAgentIdentity;
  namespace: string;
}): string {
  const namespace: string = data.namespace.trim() || "default";
  return `This database runs in Kubernetes, so the agent is best run as a small Deployment in its namespace (\`${namespace}\`). \`DATABASE_SERVER_ID\` ties the metrics to this database directly: a cluster-local name is only unique inside one cluster, so it never creates a database on its own.

1. Put the collector config in a ConfigMap and the secrets in a Secret. The collector expands \`$\` inside the password once more, so write every \`$\` in it as \`$$\`:

${codeBlock(
  "bash",
  `curl -fsSL ${DATABASE_AGENT_RAW_URL}/configs/${data.engine}.yaml -o config.yaml
kubectl -n ${namespace} create configmap oneuptime-database-agent --from-file=config.yaml=config.yaml
kubectl -n ${namespace} create secret generic oneuptime-database-agent \\
  --from-literal=ONEUPTIME_TELEMETRY_INGESTION_KEY='${data.apiKey}' \\
  --from-literal=DATABASE_PASSWORD='a-strong-password'`,
)}

2. Apply the Deployment:

${codeBlock(
  "yaml",
  getDatabaseAgentKubernetesManifest({
    oneuptimeUrl: data.oneuptimeUrl,
    engine: data.engine,
    identity: data.identity,
    namespace: namespace,
    system: data.system,
  }),
)}

Set \`DATABASE_ENDPOINT\` and \`DATABASE_SERVER_ADDRESS\` to the database Service's full name (\`<service>.${namespace}.svc.cluster.local\`) if the prefilled value is not it. The agent never stamps \`k8s.cluster.name\`: OneUptime reads that attribute as the Kubernetes agent's heartbeat.`;
}

function kubernetesSection(data: {
  oneuptimeUrl: string;
  apiKey: string;
  engine: DatabaseAgentEngine;
  system: string;
  identity: DatabaseAgentIdentity;
  namespace: string;
}): string {
  return `
## Run the agent in Kubernetes

${kubernetesDeploymentMarkdown(data)}
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
 * names one of its own endpoints to connect to. Empty for other engines.
 */
function databaseHealthMarkdown(data: {
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

  return `For a probe-based check that needs no agent at all — connections, locks, cache and replication health, with alerting — ${link} (PostgreSQL, MySQL and SQL Server). It uses the same monitoring user. ${linking}`;
}

function databaseHealthSection(data: {
  dbSystem: string;
  databaseHealthMonitorUrl?: string | null | undefined;
  database?: DatabaseDocumentationTarget | null | undefined;
}): string {
  const body: string = databaseHealthMarkdown(data);
  if (!body) {
    return "";
  }
  return `
## No agent? Use a Database Health monitor

${body}
`;
}

/*
 * How a monitor's alerts land on a database: its engine metrics carry the
 * database's id, and an alert whose monitor filters (or groups) on it is
 * attributed to the database. The Recommendations tab offers ready-made
 * monitors for the engines DatabaseAlertTemplates covers; it is only
 * pointed at for those.
 */
function alertingMarkdown(data: {
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
  return `Engine metrics and query events carry \`${DATABASE_SERVER_ID_ATTRIBUTE_NAME}\` = \`${id}\`. ${recommended} a **Metrics** monitor over an engine metric and filter it on that attribute (or group it by the attribute to cover several databases with one monitor — each series then lands on its own database): its alerts and incidents then appear on this database's Alerts and Incidents tabs, and none are opened for this database while it is in a scheduled maintenance window. A chart opened from this database's **Metrics** tab has **Create monitor**, which fills that filter in for you (a metric the chart adds up across series becomes a monitor that alerts on each series). Threshold a gauge (connections, memory, replication lag) or a ratio of two gauges. A cumulative counter (deadlocks, slow queries, evictions) only ever grows and monitors have no rate, so turn it into per-interval deltas with the collector's \`cumulativetodelta\` processor before alerting on it.${sqlServerRates}`;
}

function alertingSection(data: {
  databaseId: string;
  system: string;
  recommendationsUrl?: string | null | undefined;
}): string {
  return `
## Alert on this database

${alertingMarkdown(data)}
`;
}

/*
 * The guide's opening sentence: what the agent collects from this engine,
 * with what, and that one agent watches one server.
 */
function agentIntroParagraph(
  engine: DatabaseAgentEngine,
  engineLabel: string,
): string {
  return `The OneUptime Database Agent collects ${engineLabel} engine metrics — ${getDatabaseAgentCollectedSummary(engine)} — with a stock OpenTelemetry Collector container (\`${DATABASE_AGENT_COLLECTOR_IMAGE}\`) running the collector's native \`${getCollectorReceiverComponentName(engine)}\` receiver (\`configs/${engine}.yaml\`). Nothing is installed on the database server. **One agent monitors one database server**; run a second copy in a second directory for a second server.`;
}

/* A row's identity, as every block of its guide is prefilled with it. */
function thisDatabaseTable(
  system: string,
  identity: DatabaseAgentIdentity,
): string {
  return `| Setting | Value |
|---------|-------|
| \`DATABASE_SYSTEM\` | \`${system}\` |
| \`DATABASE_SERVER_ID\` | \`${identity.databaseId}\` |
| \`DATABASE_SERVER_ADDRESS\` | \`${identity.serverAddress}\` |
| \`DATABASE_SERVER_PORT\` | \`${serverPortValue(identity)}\` |`;
}

/*
 * What the prefilled identity means, what to do when the row has no
 * address, and — for a SQL Server named instance the row knows no port
 * for — where to find the port the samples leave as a placeholder.
 */
function thisDatabaseNote(identity: DatabaseAgentIdentity): string {
  const instanceNote: string = identity.instanceName
    ? ` This database is the SQL Server named instance \`${identity.instanceName}\` on \`${identity.serverAddress}\`, and OneUptime does not know its TCP port — a named instance listens on its own, never on the default instance's 1433, and the agent connects to that port. Find it in SQL Server Configuration Manager (the instance's TCP/IP protocol, IPAll) or by running \`SELECT local_tcp_port FROM sys.dm_exec_connections WHERE session_id = @@SPID;\` on the instance. The install script asks for the endpoint to connect to: give it as \`${identity.serverAddress}:<port>\`. In the samples below, replace \`${INSTANCE_PORT_PLACEHOLDER}\` with it.`
    : "";

  return `Every block below is prefilled with these values. \`DATABASE_SERVER_ID\` is stamped on the agent's data as \`${DATABASE_SERVER_ID_ATTRIBUTE_NAME}\` and links it to this database directly, whatever its address — its data then shows on this database's pages even when the address is a private IP or a name that only resolves inside your network.${
    identity.isPrefilled
      ? ""
      : ` This database has no address yet: the install script asks for the host name your applications use to reach it, and in the samples below replace \`${PLACEHOLDER_ADDRESS}\` with that name.`
  }${instanceNote}`;
}

/*
 * The NAME=value words the install command line passes to install.sh. A
 * row without an address gets no placeholder on the command line:
 * install.sh would take the placeholder as given and stamp it, while
 * without it the script asks for the real name. Likewise a port the row
 * does not know is left for install.sh, which takes it from the endpoint
 * it asks for. The id still links the data to this row. Every value is
 * one shell word, so the shell hands install.sh exactly this text.
 */
function installScriptWords(data: {
  system: string;
  identity: DatabaseAgentIdentity;
  database?: DatabaseDocumentationTarget | null | undefined;
}): Array<string> {
  const identity: DatabaseAgentIdentity = data.identity;
  const database: DatabaseDocumentationTarget | null | undefined =
    data.database;
  return [
    `DATABASE_SYSTEM=${shellWord(data.system)}`,
    database && identity.isPrefilled
      ? `DATABASE_SERVER_ADDRESS=${shellWord(identity.serverAddress)}`
      : "",
    database && identity.isPrefilled && identity.serverPort !== null
      ? `DATABASE_SERVER_PORT=${identity.serverPort}`
      : "",
    database ? `DATABASE_SERVER_ID=${shellWord(identity.databaseId)}` : "",
  ].filter((part: string): boolean => {
    return part.length > 0;
  });
}

function installScriptCommand(words: Array<string>): string {
  return `curl -sSL ${DATABASE_AGENT_RAW_URL}/install.sh -o install.sh
${[...words, "bash install.sh"].join(" ")}`;
}

/*
 * Moving an installed agent to the current files. Running the current
 * install script again is the upgrade: it reuses the agent's .env and
 * replaces docker-compose.yml and otel-collector-config.yaml. The guide's
 * "Upgrade or uninstall the agent" topic and the upgrade dialog beside an
 * outdated agent version (Components/AgentVersion) both show this command,
 * so the two never drift.
 */
export function getDatabaseAgentUpgradeCommand(): string {
  return installScriptCommand([]);
}

/*
 * The agent's two files for one engine, downloaded into the current folder:
 * the Docker Compose install step, and the same files again to upgrade an
 * agent installed that way.
 */
export function getDatabaseAgentDownloadCommand(
  engine: DatabaseAgentEngine,
): string {
  return `curl -fsSL ${DATABASE_AGENT_RAW_URL}/docker-compose.yml -o docker-compose.yml
curl -fsSL ${DATABASE_AGENT_RAW_URL}/configs/${engine}.yaml -o otel-collector-config.yaml`;
}

/*
 * Recreates the container so the collector reads its new config: a plain
 * `docker compose up -d` keeps the running container when only the config
 * file changed.
 */
export const DATABASE_AGENT_RECREATE_COMMAND: string =
  "docker compose up -d --force-recreate";

/*
 * The Docker Compose notes: where the agent connects versus what the
 * database is called, and how a hand-written `.env` holds the password.
 */
const COMPOSE_IDENTITY_NOTE: string =
  "`DATABASE_ENDPOINT` is where the agent connects (`host.docker.internal:<port>` when it runs on the database machine). `DATABASE_SERVER_ADDRESS` is the database's identity: the host name your **applications** use to reach it, never `localhost`. Keep it stable — changing it registers a second database.";

const COMPOSE_PASSWORD_NOTE: string =
  "In a hand-written `.env`, single-quote the password and write every `$` in it as `$$`: the collector expands `$$` and `${...}` inside it once more. The first line says so, in the words of the `.env` the install script writes — and the script, re-run on this folder, reads the file the same way.";

/* The agent's environment, as docker-compose.yml passes it to the collector. */
const ENVIRONMENT_VARIABLES_TABLE: string = `| Variable | Required | Description |
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
| \`DATABASE_SERVER_ID\` | No | The id of a database OneUptime already shows; the data then joins it directly |`;

/**
 * The full agent guide for one engine, as one markdown document. With
 * `database`, every value that identifies the database is prefilled for
 * that row, its id included; the Kubernetes section appears for a
 * Kubernetes-detected row. `system` picks the engine the agent reports
 * (DATABASE_SYSTEM: "mariadb" with the mysql config); it defaults to the
 * row's engine, then to the config's. `recommendationsUrl` links the row's
 * Recommendations tab from its alerting section. The Documentation card
 * renders getDatabaseAgentSetupGuide, the same pieces laid out as steps.
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
  const engineLabel: string = getDatabaseSystemDisplayName(system);

  const thisDatabase: string = database
    ? `
## This database

${thisDatabaseTable(system, identity)}

${thisDatabaseNote(identity)}
`
    : "";

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
${agentIntroParagraph(data.engine, engineLabel)}
${thisDatabase}
## Prerequisites

- Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the database's port
- A dedicated monitoring user on the database (below)
- A OneUptime telemetry ingestion key (select or create one above)

## Create a monitoring user

${MONITORING_USER_INTRO}
${getMonitoringUserMarkdown(data.engine, "document")}
## Quick Start — Install Script

${codeBlock(
  "bash",
  installScriptCommand(
    installScriptWords({
      system: system,
      identity: identity,
      database: database,
    }),
  ),
)}

The script asks for anything not given up front (your OneUptime URL and ingestion key, the endpoint to connect to and the monitoring credentials — the password is read without echo), installs to \`${DATABASE_AGENT_INSTALL_DIRECTORY}\`, writes a \`0600\` \`.env\` file with values escaped for the collector and quoted for Docker Compose, and starts the agent. Re-running it reuses the existing \`.env\` and updates the agent; a \`docker-compose.yml\` or collector config you edited is kept next to the new one as \`<file>.bak.<timestamp>\`.

## Quick Start — Docker Compose

Download \`docker-compose.yml\` and \`configs/${data.engine}.yaml\` (saved as \`otel-collector-config.yaml\`) from the [DatabaseAgent directory](${DATABASE_AGENT_DIRECTORY_URL}) into one folder, then create a \`.env\` file next to them (\`chmod 600 .env\` — it holds a password):

${codeBlock(
  "bash",
  getDatabaseAgentEnvFile({
    oneuptimeUrl: data.oneuptimeUrl,
    apiKey: data.apiKey,
    engine: data.engine,
    identity: identity,
    system: system,
  }),
)}

Then start the agent:

${codeBlock("bash", "docker compose up -d")}

${COMPOSE_IDENTITY_NOTE} ${COMPOSE_PASSWORD_NOTE}

### docker-compose.yml

${codeBlock("yaml", DATABASE_AGENT_DOCKER_COMPOSE.trimEnd())}

### otel-collector-config.yaml (${getDatabaseAgentEngineLabel(data.engine)})

${codeBlock("yaml", DATABASE_AGENT_CONFIGS[data.engine].trimEnd())}
${kubernetes}
## Environment Variables

${ENVIRONMENT_VARIABLES_TABLE}

## Verify

After the first collection (about one \`DATABASE_COLLECTION_INTERVAL\`) the database's **Engine metrics** status turns to Connected and its Overview charts the engine. If nothing arrives, run the diagnostic script from the install directory:

${codeBlock(
  "bash",
  `curl -sSL ${DATABASE_AGENT_RAW_URL}/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh`,
)}
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
 * ---- The Database Agent setup guide ---------------------------------------
 *
 * What the Documentation card renders: the picked engine's steps — the
 * monitoring user, the install (script, Docker Compose, or a Deployment for
 * a Kubernetes database) and how to check it worked — with the reference
 * material folded under Advanced and the known problems under
 * Troubleshooting.
 */

export interface DatabaseAgentSetupGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  /*
   * Whether `apiKey` is a key the reader picked rather than the
   * placeholder. Only then are the URL and key put on the install command
   * line: install.sh stores whatever it is given. Defaults to "not the
   * placeholder".
   */
  hasApiKey?: boolean | undefined;
  engine: DatabaseAgentEngine;
  // The engine the agent reports (DATABASE_SYSTEM); see getDatabaseAgentSystem.
  system?: string | null | undefined;
  // The row a database's own Documentation tab installs for.
  database?: DatabaseDocumentationTarget | null | undefined;
  databaseHealthMonitorUrl?: string | null | undefined;
  recommendationsUrl?: string | null | undefined;
}

const PICK_KEY_NOTE: string = `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`;

const TROUBLESHOOT_COMMAND: string = `curl -sSL ${DATABASE_AGENT_RAW_URL}/troubleshoot.sh -o troubleshoot.sh
bash troubleshoot.sh    # add -d <dir> if you installed outside ${DATABASE_AGENT_INSTALL_DIRECTORY}`;

function joinWithAnd(parts: Array<string>): string {
  if (parts.length <= 1) {
    return parts.join("");
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/*
 * install.sh reads ONEUPTIME_URL and ONEUPTIME_TELEMETRY_INGESTION_KEY from
 * its environment before it prompts for them (`if [ -z "$ONEUPTIME_URL" ]`),
 * so once a key is picked both go on the command line. Never a
 * placeholder: the script would store it in `.env` as given.
 */
function prefilledConnectionWords(data: {
  oneuptimeUrl: string;
  apiKey: string;
  hasApiKey: boolean;
}): Array<string> {
  if (
    !data.hasApiKey ||
    !data.apiKey ||
    data.apiKey === SETUP_GUIDE_API_KEY_PLACEHOLDER
  ) {
    return [];
  }
  const words: Array<string> = [];
  if (data.oneuptimeUrl && data.oneuptimeUrl !== SETUP_GUIDE_URL_PLACEHOLDER) {
    words.push(`ONEUPTIME_URL=${shellQuote(data.oneuptimeUrl)}`);
  }
  words.push(`ONEUPTIME_TELEMETRY_INGESTION_KEY=${shellQuote(data.apiKey)}`);
  return words;
}

function getAgentPrerequisites(data: {
  engine: DatabaseAgentEngine;
  namespace: string | null;
  isProductPage: boolean;
}): Array<string> {
  const docker: string =
    "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the database's port";
  const lines: Array<string> = [
    data.namespace !== null
      ? `\`kubectl\` access to the \`${data.namespace}\` namespace — or ${docker}`
      : `${docker} — nothing is installed on the database server`,
  ];

  if (hasLogin(data.engine)) {
    lines.push(
      "A database login that may create users and grant privileges, for the monitoring user in step 2",
    );
  } else {
    lines.push(
      "A Memcached server without SASL authentication (`-S`): Memcached has no users, and the agent runs `stats` over the text protocol without logging in",
    );
  }

  if (data.isProductPage) {
    lines.push(
      "The host name your applications use to reach the database — it becomes the database's identity in OneUptime",
    );
  }

  return lines;
}

function getMonitoringUserStep(
  engine: DatabaseAgentEngine,
  system: string,
): SetupGuideStep {
  return {
    title: "Create a monitoring user",
    description: MONITORING_USER_INTRO,
    markdown: getMonitoringUserMarkdown(
      engine,
      isForkOfEngine(engine, system) ? "fork" : "engine",
    ),
  };
}

function getInstallScriptVariant(data: {
  oneuptimeUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  engine: DatabaseAgentEngine;
  system: string;
  identity: DatabaseAgentIdentity;
  database: DatabaseDocumentationTarget | null;
}): SetupGuideStepVariant {
  const connection: Array<string> = prefilledConnectionWords(data);
  const words: Array<string> = [
    ...connection,
    ...installScriptWords({
      system: data.system,
      identity: data.identity,
      database: data.database,
    }),
  ];

  const isUrlPrefilled: boolean = connection.some((word: string): boolean => {
    return word.startsWith("ONEUPTIME_URL=");
  });
  const asked: Array<string> = [];
  if (!isUrlPrefilled) {
    asked.push("your OneUptime URL");
  }
  if (connection.length === 0) {
    asked.push("the ingestion key from step 1");
  }
  asked.push("the endpoint to connect to");
  if (data.engine === "oracledb") {
    asked.push("the Oracle service name");
  }
  if (hasLogin(data.engine)) {
    asked.push(
      isLoginRequired(data.engine)
        ? "the monitoring credentials"
        : "the monitoring credentials, if the server has users",
    );
  }

  const notes: Array<string> = [
    `The script asks for ${joinWithAnd(asked)}${
      hasLogin(data.engine) ? " (the password is read without echo)" : ""
    }, then installs to \`${DATABASE_AGENT_INSTALL_DIRECTORY}\`, writes a \`0600\` \`.env\` file and starts the agent.`,
  ];

  if (!data.database) {
    notes.push(
      "When the endpoint only means something on this machine (`localhost`, `host.docker.internal`), it also asks for the host name your applications use: that name is the database's identity in OneUptime.",
    );
  }

  return {
    label: "Install script",
    markdown: [
      codeBlock("bash", installScriptCommand(words)),
      notes.join(" "),
    ].join("\n\n"),
  };
}

function getDockerComposeVariant(data: {
  oneuptimeUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  engine: DatabaseAgentEngine;
  system: string;
  identity: DatabaseAgentIdentity;
}): SetupGuideStepVariant {
  const notes: Array<string> = [COMPOSE_IDENTITY_NOTE];
  if (hasLogin(data.engine)) {
    notes.push(COMPOSE_PASSWORD_NOTE);
  }
  if (!data.hasApiKey) {
    notes.push(PICK_KEY_NOTE);
  }

  return {
    label: "Docker Compose",
    markdown: [
      `Download \`docker-compose.yml\` and \`configs/${data.engine}.yaml\` (saved as \`otel-collector-config.yaml\`) from the [DatabaseAgent directory](${DATABASE_AGENT_DIRECTORY_URL}) into one folder:`,
      codeBlock("bash", getDatabaseAgentDownloadCommand(data.engine)),
      `Create a \`.env\` file next to them (\`chmod 600 .env\` — it holds ${
        hasLogin(data.engine) ? "a password" : "your ingestion key"
      }):`,
      codeBlock(
        "bash",
        getDatabaseAgentEnvFile({
          oneuptimeUrl: data.oneuptimeUrl,
          apiKey: data.apiKey,
          engine: data.engine,
          identity: data.identity,
          system: data.system,
        }),
      ),
      "Start the agent:",
      codeBlock("bash", "docker compose up -d"),
      ...notes,
    ].join("\n\n"),
  };
}

function getKubernetesVariant(data: {
  oneuptimeUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  engine: DatabaseAgentEngine;
  system: string;
  identity: DatabaseAgentIdentity;
  namespace: string;
}): SetupGuideStepVariant {
  const markdown: string = kubernetesDeploymentMarkdown(data);
  return {
    label: "Kubernetes",
    markdown: data.hasApiKey ? markdown : `${markdown}\n\n${PICK_KEY_NOTE}`,
  };
}

function getAgentVerifyStep(data: {
  database: DatabaseDocumentationTarget | null;
  namespace: string | null;
  engine: DatabaseAgentEngine;
}): SetupGuideStep {
  const arrival: string = data.database
    ? "After the first collection (about one `DATABASE_COLLECTION_INTERVAL`, 30 seconds by default) this database's **Engine metrics** status turns to Connected and its Overview charts the engine."
    : "After the first collection (about one `DATABASE_COLLECTION_INTERVAL`, 30 seconds by default) the database appears under **Databases** — or, when OneUptime already shows it from traces or containers at the same address, its **Engine metrics** status turns to Connected and its Overview charts the engine.";

  const parts: Array<string> = [
    arrival,
    "If nothing arrives, run the diagnostic script where the agent runs. It checks the container, the identity in `.env`, the connection to the database, the collector's log and the ingestion key, and names the most likely problem:",
    codeBlock("bash", TROUBLESHOOT_COMMAND),
  ];

  if (data.namespace !== null) {
    parts.push(
      `The script needs Docker. For the Deployment, read the collector's log instead: \`kubectl -n ${data.namespace} logs deployment/oneuptime-database-agent\`.`,
    );
  }

  // Only where the AI agent has diagnostics: for any other engine it runs nothing.
  if (hasAiAgentDiagnostics(data.engine)) {
    parts.push(
      "**OneUptime AI agent (on by default, read-only).** AI investigations are on: with the install script or Docker Compose, the OneUptime AI agent runs beside the collector and lets OneUptime AI read this database's diagnostics while it investigates an incident or alert, and it changes nothing unless you allow fixes — see **The files the agent runs** under Advanced.",
    );
  }

  return {
    title: "Verify the installation",
    description: "Check that the engine metrics arrive.",
    markdown: parts.join("\n\n"),
  };
}

/*
 * The OneUptime AI agent runs next to the collector (the compose file's
 * oneuptime-database-ai-agent service). install.sh's AI_SUPPORTED: it has
 * diagnostics for these configs only, and runs nothing for the others.
 */
function hasAiAgentDiagnostics(engine: DatabaseAgentEngine): boolean {
  return (
    engine === "postgresql" ||
    engine === "mysql" ||
    engine === "redis" ||
    engine === "mongodb"
  );
}

/*
 * What query events need beyond step 2's grants: PostgreSQL's extension and
 * explain-plan access, MongoDB's per-database role, and for the rest the
 * grant of step 2 that already covers them.
 */
function getQueryEventsRequirements(engine: DatabaseAgentEngine): string {
  switch (engine) {
    case "mysql":
      return "They read `performance_schema`, which the monitoring user's grant from step 2 already covers.";
    case "sqlserver":
      return "They read the dynamic management views, which `VIEW SERVER STATE` from step 2 already covers.";
    case "oracledb":
      return "They read the `V$` views, which `SELECT_CATALOG_ROLE` from step 2 already covers.";
    default:
      return getMonitoringUserMarkdown(engine, "queryEvents");
  }
}

function getQueryEventsTopic(data: {
  engine: DatabaseAgentEngine;
  namespace: string | null;
}): SetupGuideTopic {
  const kubernetes: string =
    data.namespace !== null
      ? ' In Kubernetes, set the Deployment\'s `DATABASE_QUERY_EVENTS` value to `"true"` instead.'
      : "";

  return {
    title: "Query samples and top queries",
    summary:
      "Ship the queries the database runs as logs. Off by default, because they contain query text.",
    markdown: [
      "With `DATABASE_QUERY_EVENTS=true` the agent also ships query samples and top queries as logs: they arrive on the database's **Logs** tab with the query text as their message. They contain query text, so they are off by default — the install script asks whether to ship them.",
      `To turn them on later, set \`DATABASE_QUERY_EVENTS=true\` in the agent's \`.env\` and recreate the container with \`docker compose up -d --force-recreate\` in its folder.${kubernetes}`,
      getQueryEventsRequirements(data.engine),
    ]
      .filter((part: string): boolean => {
        return part.length > 0;
      })
      .join("\n\n"),
  };
}

function getAgentFilesTopic(
  engine: DatabaseAgentEngine,
  system: string,
): SetupGuideTopic {
  const aiAgent: string = hasAiAgentDiagnostics(engine)
    ? "The compose file also runs `oneuptime-database-ai-agent`, the OneUptime AI agent: it lets OneUptime AI read the database's diagnostics while it investigates an incident or alert — read-only unless you allow fixes — and shows on the database's **AI → AI agent** page. Remove its service if you do not use OneUptime AI."
    : `The compose file also runs \`oneuptime-database-ai-agent\`, the OneUptime AI agent. It has no AI diagnostics for ${getDatabaseSystemDisplayName(system)} yet, so it runs nothing — remove its service if you do not want it running.`;

  return {
    title: "The files the agent runs",
    summary:
      "The docker-compose.yml and the collector config the install script downloads, in full.",
    markdown: [
      `The install script downloads both into \`${DATABASE_AGENT_INSTALL_DIRECTORY}\`; the Docker Compose steps use the same files.`,
      "**docker-compose.yml**",
      codeBlock("yaml", DATABASE_AGENT_DOCKER_COMPOSE.trimEnd()),
      `**otel-collector-config.yaml** — \`configs/${engine}.yaml\`, the ${getDatabaseAgentEngineLabel(engine)} config`,
      codeBlock("yaml", DATABASE_AGENT_CONFIGS[engine].trimEnd()),
      aiAgent,
    ].join("\n\n"),
  };
}

function getUpgradeTopic(data: {
  engine: DatabaseAgentEngine;
  system: string;
  connection: Array<string>;
}): SetupGuideTopic {
  const secondAgent: string = [
    ...data.connection,
    `INSTALL_DIR=${DATABASE_AGENT_INSTALL_DIRECTORY}-orders`,
    `DATABASE_SYSTEM=${shellWord(data.system)}`,
    "bash install.sh",
  ].join(" ");

  return {
    title: "Upgrade or uninstall the agent",
    summary:
      "Move to the current config and keep your settings, monitor a second server, or remove the agent.",
    markdown: [
      `**Upgrade** by running the current install script again. It reuses your \`.env\`, replaces \`docker-compose.yml\` and \`otel-collector-config.yaml\` with the current versions and recreates the container; a file you edited is kept next to the new one as \`<file>.bak.<timestamp>\`.`,
      codeBlock("bash", getDatabaseAgentUpgradeCommand()),
      `After editing \`.env\` or \`otel-collector-config.yaml\` yourself, apply the change with \`${DATABASE_AGENT_RECREATE_COMMAND}\` in the agent's folder: the collector reads its config only when it starts, and a plain \`docker compose up -d\` keeps the running container when only the config file changed.`,
      "**Monitor a second database server** with a second agent in a directory of its own — one agent monitors one server:",
      codeBlock("bash", secondAgent),
      "**Uninstall** the agent:",
      codeBlock(
        "bash",
        `cd ${DATABASE_AGENT_INSTALL_DIRECTORY} && docker compose down`,
      ),
      hasLogin(data.engine) ? "Then drop the monitoring user." : "",
    ]
      .filter((part: string): boolean => {
        return part.length > 0;
      })
      .join("\n\n"),
  };
}

function getAgentAdvancedTopics(data: {
  engine: DatabaseAgentEngine;
  system: string;
  identity: DatabaseAgentIdentity;
  database: DatabaseDocumentationTarget | null;
  namespace: string | null;
  connection: Array<string>;
  databaseHealthMonitorUrl?: string | null | undefined;
  recommendationsUrl?: string | null | undefined;
}): Array<SetupGuideTopic> {
  const topics: Array<SetupGuideTopic> = [];
  const engineLabel: string = getDatabaseSystemDisplayName(data.system);

  if (data.database) {
    topics.push({
      title: "Alert on this database",
      summary:
        "Metrics monitors whose alerts and incidents land on this database, and what to threshold.",
      markdown: alertingMarkdown({
        databaseId: data.identity.databaseId,
        system: data.system,
        recommendationsUrl: data.recommendationsUrl,
      }),
    });
  }

  topics.push({
    title: "What the agent collects",
    summary: translateTemplate(
      "The {{engine}} metrics the collector's {{receiver}} receiver reads.",
      {
        engine: engineLabel,
        receiver: getCollectorReceiverComponentName(data.engine),
      },
    ),
    markdown: agentIntroParagraph(data.engine, engineLabel),
  });

  if (hasQueryEvents(data.engine)) {
    topics.push(
      getQueryEventsTopic({ engine: data.engine, namespace: data.namespace }),
    );
  }

  topics.push(
    {
      title: "Environment variables",
      summary: "Every setting the agent reads from its .env file.",
      markdown: ENVIRONMENT_VARIABLES_TABLE,
    },
    getAgentFilesTopic(data.engine, data.system),
    getUpgradeTopic({
      engine: data.engine,
      system: data.system,
      connection: data.connection,
    }),
  );

  const health: string = databaseHealthMarkdown({
    dbSystem:
      normalizeDatabaseSystem(data.database?.dbSystem || data.system) || "",
    databaseHealthMonitorUrl: data.databaseHealthMonitorUrl,
    database: data.database,
  });
  if (health) {
    topics.push({
      title: "No agent? Use a Database Health monitor",
      summary:
        "A probe-based check with alerting that needs no agent, for PostgreSQL, MySQL and SQL Server.",
      markdown: health,
    });
  }

  return topics;
}

/*
 * What the collector logs when the database refuses the agent: a rejected
 * login, and a login without the grants of step 2 — the messages
 * troubleshoot.sh looks for, per engine.
 */
const LOGIN_ERRORS: Record<
  DatabaseAgentEngine,
  { rejected: Array<string>; missingGrant: Array<string> } | null
> = {
  postgresql: {
    rejected: ["password authentication failed"],
    missingGrant: ["permission denied", "must be superuser"],
  },
  mysql: {
    rejected: ["Access denied for user"],
    missingGrant: ["Access denied; you need … privilege(s)"],
  },
  redis: { rejected: ["WRONGPASS", "NOAUTH"], missingGrant: ["NOPERM"] },
  mongodb: {
    rejected: ["Authentication failed"],
    missingGrant: ["not authorized"],
  },
  sqlserver: {
    rejected: ["Login failed for user"],
    missingGrant: ["VIEW SERVER STATE"],
  },
  oracledb: {
    rejected: ["ORA-01017"],
    missingGrant: ["ORA-00942", "ORA-01031"],
  },
  elasticsearch: {
    rejected: ["status code 401"],
    missingGrant: ["status code 403"],
  },
  memcached: null,
};

/*
 * The server's own allow-list that can refuse the agent's connection, for
 * the engines that have one by name.
 */
const ALLOW_LISTS: Partial<Record<DatabaseAgentEngine, string>> = {
  postgresql: "`pg_hba.conf`",
  mysql: "`bind-address`",
  redis: "`bind`",
  mongodb: "`net.bindIp`",
};

function inlineCodeList(values: Array<string>): string {
  return values
    .map((value: string): string => {
      return `\`${value}\``;
    })
    .join(", ");
}

function getLoginErrorsTopic(data: {
  engine: DatabaseAgentEngine;
  namespace: string | null;
}): SetupGuideTopic | null {
  const errors: {
    rejected: Array<string>;
    missingGrant: Array<string>;
  } | null = LOGIN_ERRORS[data.engine];
  if (!errors) {
    return null;
  }

  const logs: string =
    data.namespace !== null
      ? `\`docker compose logs --tail 100\` in the agent's folder, or \`kubectl -n ${data.namespace} logs deployment/oneuptime-database-agent\``
      : "`docker compose logs --tail 100` in the agent's folder";

  const bullets: Array<string> = [
    `${inlineCodeList(errors.rejected)}: the database rejected the login. Check \`DATABASE_USERNAME\` and \`DATABASE_PASSWORD\` — the collector expands \`$\` inside them once more, so every \`$\` must be written as \`$$\` in \`.env\` or a Kubernetes Secret (the install script does this).${
      data.engine === "sqlserver"
        ? " A login containing `;` or `\"`, or with spaces around it, always fails: the receiver's connection string cannot carry them."
        : ""
    }`,
    `${inlineCodeList(errors.missingGrant)}${
      data.engine === "postgresql"
        ? ", or connection counts that always read `1`"
        : ""
    }: the monitoring user is missing the grants from step 2.${
      data.engine === "mysql"
        ? " MySQL / MariaDB error 1227 names the privilege: `PROCESS`, or `SLAVE MONITOR` on MariaDB 10.5.9 and later."
        : ""
    }`,
  ];

  if (data.engine === "oracledb") {
    bullets.push(
      "`ORA-12514` or `ORA-12505`: the listener answers but does not know the service `DATABASE_ORACLE_SERVICE` names — `lsnrctl services` on the database host lists the ones it does.",
      "`ORA-28000` or `ORA-28001`: the monitoring user is locked or its password expired.",
    );
  }

  if (data.engine === "postgresql") {
    bullets.push(
      "`pg_stat_statements` errors: top queries are on without the extension — create it (see Query samples and top queries), or set `DATABASE_QUERY_EVENTS=false`.",
      "`failed to explain` is not a missing grant: explain plans of top queries need `SELECT` on your tables, which `pg_monitor` deliberately does not give. Metrics and top queries are unaffected; only the plans stay empty.",
    );
  }

  /*
   * The SQL Server and Oracle drivers negotiate encryption themselves, so
   * the TLS switches do not apply to them (install.sh's HAS_TLS).
   */
  const hasTlsSwitches: boolean =
    data.engine !== "sqlserver" && data.engine !== "oracledb";
  if (data.engine === "elasticsearch") {
    bullets.push(
      "TLS errors: the `http://` or `https://` of `DATABASE_ENDPOINT` decides whether the agent uses TLS. Set `DATABASE_TLS_INSECURE_SKIP_VERIFY=true` for a certificate the collector image does not trust.",
    );
  } else if (hasTlsSwitches) {
    bullets.push(
      `TLS errors${
        data.engine === "postgresql"
          ? " (`SSL is not enabled on the server`)"
          : ""
      }: match \`DATABASE_TLS_INSECURE\` to the server — \`true\` when it does not speak TLS, \`false\` when it requires it, plus \`DATABASE_TLS_INSECURE_SKIP_VERIFY=true\` for a certificate the collector image does not trust.`,
    );
  }

  return {
    title: hasTlsSwitches
      ? "Login, permission or TLS errors in the collector log"
      : "Login or permission errors in the collector log",
    markdown: `The collector's log (${logs}) names the problem:

${bullets
  .map((bullet: string): string => {
    return `- ${bullet}`;
  })
  .join("\n")}

After changing \`.env\`, apply it with \`docker compose up -d --force-recreate\`.`,
  };
}

function getAgentTroubleshootingTopics(data: {
  engine: DatabaseAgentEngine;
  identity: DatabaseAgentIdentity;
  database: DatabaseDocumentationTarget | null;
  namespace: string | null;
  // The number the verify step (the diagnostic script) has on screen.
  verifyStepNumber: number;
}): Array<SetupGuideTopic> {
  const topics: Array<SetupGuideTopic> = [];
  const kubernetesLogs: string =
    data.namespace !== null
      ? `\`kubectl -n ${data.namespace} logs deployment/oneuptime-database-agent\``
      : "";

  if (data.database) {
    topics.push({
      title: 'Engine metrics reads "Not connected" or "Disconnected"',
      markdown: `_Not connected_: nothing has arrived for this database yet. _Disconnected_: the agent reported, then sent nothing for at least 15 minutes. Either way, run the diagnostic script from step ${data.verifyStepNumber} where the agent runs — it names the most likely problem. Also check that \`DATABASE_SERVER_ID\` is this database's id, \`${data.identity.databaseId}\`: the data joins it only when the id names a database in the project the ingestion key belongs to.`,
    });
  } else {
    topics.push({
      title: "The database does not appear under Databases",
      markdown: `- \`DATABASE_SERVER_ADDRESS\` is \`localhost\`, \`127.0.0.1\` or \`host.docker.internal\`: OneUptime ignores addresses that only mean something on one machine. Use the host name your applications use.
- It is a private IP, a single-label name or a cluster-local name (\`*.svc.cluster.local\`): such names never create a database on their own. Create the database under **Databases → Create Database** with that address and port, or install the agent from the database's own **Documentation** tab, which sets \`DATABASE_SERVER_ID\`.
- The ingestion key is wrong — the diagnostic script from step ${data.verifyStepNumber} checks it.`,
    });
  }

  const allowList: string | undefined = ALLOW_LISTS[data.engine];
  topics.push({
    title: "The agent cannot connect to the database",
    markdown: `Inside the agent's container, \`localhost\` is the container itself. Use \`host.docker.internal:<port>\` (the compose file maps it to the machine on Linux too) with the database listening on the Docker bridge address as well — or uncomment \`network_mode: host\` in \`docker-compose.yml\` and use \`localhost:<port>\`. For a remote server, check DNS, firewalls and the server's own allow-list${
      allowList ? ` (${allowList})` : ""
    }.${
      data.namespace !== null
        ? ` In Kubernetes, point \`DATABASE_ENDPOINT\` at the database Service's full name (\`<service>.${data.namespace}.svc.cluster.local\`).`
        : ""
    }`,
  });

  const loginErrors: SetupGuideTopic | null = getLoginErrorsTopic({
    engine: data.engine,
    namespace: data.namespace,
  });
  if (loginErrors) {
    topics.push(loginErrors);
  }

  topics.push(
    {
      title: 'The collector log shows "Exporting failed"',
      markdown:
        "The collector cannot deliver to `ONEUPTIME_URL`. `HTTP Status Code 401` or `422` in that line means OneUptime refused the ingestion key: it is unknown, revoked, disabled or expired — or a Browser key, which ingest only accepts from a browser. Pick a server key in step 1. Otherwise check the URL, outbound HTTPS from the agent's machine and, for a self-hosted OneUptime, its certificate.",
    },
    {
      title: "The agent container keeps restarting",
      markdown: `A restart loop is almost always a configuration error, which the collector names on its first log lines:

${codeBlock("bash", `cd ${DATABASE_AGENT_INSTALL_DIRECTORY}\ndocker compose logs --tail 50`)}${
        kubernetesLogs
          ? `\n\nFor the Deployment, read them with ${kubernetesLogs}.`
          : ""
      }`,
    },
  );

  return topics;
}

function getAgentLinks(showsHealthMonitor: boolean): Array<SetupGuideLink> {
  const links: Array<SetupGuideLink> = [
    {
      title: "Database Agent documentation",
      url: "/docs/telemetry/databases",
    },
  ];
  if (showsHealthMonitor) {
    links.push({
      title: "Database Health monitor",
      url: "/docs/monitor/database-health-monitor",
    });
  }
  return links;
}

/**
 * The Database Agent setup guide for one engine, filled in with the
 * reader's OneUptime URL and ingestion key. Without `database` it is the
 * product page's guide for the picked engine; with it, every value that
 * identifies the database is prefilled for that row, its id included, and
 * a Kubernetes database is offered a Deployment first.
 */
export function getDatabaseAgentSetupGuide(
  options: DatabaseAgentSetupGuideOptions,
): SetupGuideContent {
  const engine: DatabaseAgentEngine = options.engine;
  const database: DatabaseDocumentationTarget | null = options.database || null;
  const system: string = getDatabaseAgentSystem(
    engine,
    options.system || database?.dbSystem,
  );
  const identity: DatabaseAgentIdentity = resolveDatabaseAgentIdentity(
    system,
    database,
  );
  const hasApiKey: boolean =
    options.hasApiKey ?? options.apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER;
  const namespace: string | null =
    database && database.isKubernetes
      ? (database.kubernetesNamespace || "").trim() || "default"
      : null;
  const connection: Array<string> = prefilledConnectionWords({
    oneuptimeUrl: options.oneuptimeUrl,
    apiKey: options.apiKey,
    hasApiKey: hasApiKey,
  });

  const installData: {
    oneuptimeUrl: string;
    apiKey: string;
    hasApiKey: boolean;
    engine: DatabaseAgentEngine;
    system: string;
    identity: DatabaseAgentIdentity;
  } = {
    oneuptimeUrl: options.oneuptimeUrl,
    apiKey: options.apiKey,
    hasApiKey: hasApiKey,
    engine: engine,
    system: system,
    identity: identity,
  };

  const variants: Array<SetupGuideStepVariant> = [
    getInstallScriptVariant({ ...installData, database: database }),
    getDockerComposeVariant(installData),
  ];
  // A cluster-local name only resolves inside the cluster: the Deployment comes first.
  if (namespace !== null) {
    variants.unshift(
      getKubernetesVariant({ ...installData, namespace: namespace }),
    );
  }

  const steps: Array<SetupGuideStep> = [];
  if (hasLogin(engine)) {
    steps.push(getMonitoringUserStep(engine, system));
  }
  steps.push(
    {
      title: "Install the agent",
      description:
        namespace !== null
          ? "Run it as a Deployment next to the database, or with Docker on any machine that can reach it. One agent monitors one database server."
          : "Run it with Docker on any machine that can reach the database. One agent monitors one database server.",
      variants: variants,
    },
    getAgentVerifyStep({
      database: database,
      namespace: namespace,
      engine: engine,
    }),
  );

  const advanced: Array<SetupGuideTopic> = getAgentAdvancedTopics({
    engine: engine,
    system: system,
    identity: identity,
    database: database,
    namespace: namespace,
    connection: connection,
    databaseHealthMonitorUrl: options.databaseHealthMonitorUrl,
    recommendationsUrl: options.recommendationsUrl,
  });

  return {
    intro: database
      ? `**This database**

${thisDatabaseTable(system, identity)}

${thisDatabaseNote(identity)}`
      : undefined,
    prerequisites: getAgentPrerequisites({
      engine: engine,
      namespace: namespace,
      isProductPage: !database,
    }),
    steps: steps,
    advanced: advanced,
    troubleshooting: getAgentTroubleshootingTopics({
      engine: engine,
      identity: identity,
      database: database,
      namespace: namespace,
      // Step 1 is the ingestion key, and the check is the last step.
      verifyStepNumber: steps.length + 1,
    }),
    links: getAgentLinks(
      advanced.some((topic: SetupGuideTopic): boolean => {
        return topic.title === "No agent? Use a Database Health monitor";
      }),
    ),
  };
}

/*
 * ---- Your own collector ---------------------------------------------------
 *
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

const OWN_COLLECTOR_AGENT_INTRO: string =
  "The OneUptime Database Agent ships configs for PostgreSQL, MySQL / MariaDB, Redis (and Valkey, KeyDB, Dragonfly), MongoDB, SQL Server, Oracle, Elasticsearch / OpenSearch and Memcached.";

const OWN_COLLECTOR_ALONGSIDE: string =
  "Its page shows everything your instrumented applications report about it either way: the queries they send (rate, errors and latency on the Overview and the Traces tab), the services that call it, and — when it runs in Kubernetes, Docker or Podman — its pods or containers with their logs.";

/*
 * Where an engine the agent has no config for gets its engine metrics from,
 * and the collector config that sends them with this database's identity.
 * `collector` is null for an in-process engine: there is no server.
 */
interface OwnCollectorRecipe {
  source: DatabaseEngineMetricsSource;
  engineLabel: string;
  system: string;
  collector: {
    identity: DatabaseAgentIdentity;
    receiverName: string | null;
    // What the config does, ending where the config follows.
    lead: string;
    config: string;
    // One receiver per pipeline, no resourcedetection, credentials, address.
    note: string;
    hasCredentials: boolean;
  } | null;
}

function getOwnCollectorRecipe(data: {
  oneuptimeUrl: string;
  apiKey: string;
  database: DatabaseDocumentationTarget;
}): OwnCollectorRecipe {
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

  if (source.kind === "embedded") {
    return { source, engineLabel, system, collector: null };
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

  const hasCredentials: boolean = receiverBlock.includes("${env:");
  const credentials: string = hasCredentials
    ? " Set the `${env:...}` variables in the collector's environment; the collector expands `$` inside them once more, so write every `$` in a password as `$$`."
    : "";

  return {
    source,
    engineLabel,
    system,
    collector: {
      identity,
      receiverName,
      lead,
      config,
      note: `Keep one receiver instance per database server in this pipeline — every batch carries this database's identity — and no \`resourcedetection\` processor: its \`host.name\` would make the collector's machine look like the thing being monitored.${credentials}${
        identity.isPrefilled
          ? ""
          : ` This database has no address yet, so replace \`${PLACEHOLDER_ADDRESS}\` with the host name your applications use to reach it.`
      }`,
      hasCredentials,
    },
  };
}

/**
 * The guide for an engine the Database Agent ships no config for, as one
 * markdown document: where its engine metrics come from (a contrib
 * receiver, its own Prometheus endpoint, its cloud provider's monitoring
 * API — or nowhere, for an in-process engine), with a complete collector
 * config that stamps this database's identity where there is one. The
 * Documentation card renders getDatabaseOwnCollectorSetupGuide.
 */
export function getDatabaseOwnCollectorMarkdown(data: {
  oneuptimeUrl: string;
  apiKey: string;
  database: DatabaseDocumentationTarget;
  databaseHealthMonitorUrl?: string | null | undefined;
  recommendationsUrl?: string | null | undefined;
}): string {
  const recipe: OwnCollectorRecipe = getOwnCollectorRecipe(data);

  const healthSection: string = databaseHealthSection({
    dbSystem: recipe.system,
    databaseHealthMonitorUrl: data.databaseHealthMonitorUrl,
    database: data.database,
  });

  if (!recipe.collector) {
    return `
${OWN_COLLECTOR_AGENT_INTRO} ${recipe.engineLabel} runs inside your application's process, so there is no server to collect engine metrics from.

${OWN_COLLECTOR_ALONGSIDE}

Database id (for \`${DATABASE_SERVER_ID_ATTRIBUTE_NAME}\`): \`${data.database.id}\`
${healthSection}`;
  }

  return `
${OWN_COLLECTOR_AGENT_INTRO} ${recipe.collector.lead}

${codeBlock("yaml", recipe.collector.config)}

${recipe.collector.note}

${OWN_COLLECTOR_ALONGSIDE}
${alertingSection({
  databaseId: data.database.id,
  system: recipe.system,
  recommendationsUrl: data.recommendationsUrl,
})}${healthSection}`;
}

export interface DatabaseOwnCollectorSetupGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  hasApiKey?: boolean | undefined;
  database: DatabaseDocumentationTarget;
  databaseHealthMonitorUrl?: string | null | undefined;
  recommendationsUrl?: string | null | undefined;
}

/*
 * The collector step's heading: what the reader adds to their collector.
 * The description says what the config holds; the lead under it says why.
 */
function getOwnCollectorStepHeading(recipe: OwnCollectorRecipe): {
  title: string;
  description: string;
} {
  if (recipe.source.kind === "receiver" && recipe.collector?.receiverName) {
    return {
      title: translateTemplate(
        "Add the {{receiver}} receiver to your collector",
        { receiver: recipe.collector.receiverName },
      ),
      description: translateTemplate(
        "One config: the {{receiver}} receiver, this database's identity and the exporter to OneUptime.",
        { receiver: recipe.collector.receiverName },
      ),
    };
  }
  if (recipe.source.kind === "prometheus") {
    return {
      title: translateTemplate("Scrape {{engine}}'s metrics endpoint", {
        engine: recipe.engineLabel,
      }),
      description:
        "One config: the Prometheus scrape, this database's identity and the exporter to OneUptime.",
    };
  }
  return {
    title: "Stamp this database's identity on its metrics",
    description:
      "The processor that stamps this database's identity, and the exporter to OneUptime.",
  };
}

/**
 * The setup guide for an engine the Database Agent ships no config for:
 * the collector config that sends its engine metrics with this database's
 * identity, then how to check they arrive. An in-process engine has no
 * server to collect from, so its guide is about the traces of the
 * applications that use it instead.
 */
export function getDatabaseOwnCollectorSetupGuide(
  options: DatabaseOwnCollectorSetupGuideOptions,
): SetupGuideContent {
  const recipe: OwnCollectorRecipe = getOwnCollectorRecipe(options);
  const hasApiKey: boolean =
    options.hasApiKey ?? options.apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER;
  const otlpEndpoint: string = `${options.oneuptimeUrl}/otlp`;
  const links: Array<SetupGuideLink> = [
    { title: "Databases documentation", url: "/docs/telemetry/databases" },
  ];

  const health: string = databaseHealthMarkdown({
    dbSystem: recipe.system,
    databaseHealthMonitorUrl: options.databaseHealthMonitorUrl,
    database: options.database,
  });
  const healthTopics: Array<SetupGuideTopic> = health
    ? [
        {
          title: "No agent? Use a Database Health monitor",
          summary:
            "A probe-based check with alerting that needs no collector, for PostgreSQL, MySQL and SQL Server.",
          markdown: health,
        },
      ]
    : [];
  const pageTopic: SetupGuideTopic = {
    title: "What this page shows without engine metrics",
    summary:
      "The queries, calling services and containers your applications and platforms report, with or without a collector.",
    markdown: recipe.collector
      ? OWN_COLLECTOR_ALONGSIDE
      : `${OWN_COLLECTOR_ALONGSIDE}\n\nDatabase id (for \`${DATABASE_SERVER_ID_ATTRIBUTE_NAME}\`): \`${options.database.id}\``,
  };

  if (!recipe.collector) {
    return {
      keyStep: {
        description:
          "Your application's OpenTelemetry SDK sends its traces to OneUptime with this key. Pick an existing key or create a new one — the settings below update to use it.",
        endpointLabel: "OTLP endpoint",
        endpointValue: otlpEndpoint,
      },
      intro: `${OWN_COLLECTOR_AGENT_INTRO} ${recipe.engineLabel} runs inside your application's process, so there is no server to collect engine metrics from.`,
      steps: [
        {
          title: "Instrument your application",
          description:
            "This database's page fills in from the traces of the applications that use it.",
          markdown: [
            "Send your application's traces with an [OpenTelemetry SDK](/docs/telemetry/open-telemetry), pointed at OneUptime with the key from step 1:",
            codeBlock(
              "bash",
              `export OTEL_EXPORTER_OTLP_ENDPOINT=${shellQuote(otlpEndpoint)}
export OTEL_EXPORTER_OTLP_HEADERS=${shellQuote(`x-oneuptime-token=${options.apiKey}`)}`,
            ),
            hasApiKey ? "" : PICK_KEY_NOTE,
          ]
            .filter((part: string): boolean => {
              return part.length > 0;
            })
            .join("\n\n"),
        },
      ],
      advanced: [pageTopic, ...healthTopics],
      links: [
        ...links,
        {
          title: "OpenTelemetry documentation",
          url: "/docs/telemetry/open-telemetry",
        },
      ],
    };
  }

  const collector: NonNullable<OwnCollectorRecipe["collector"]> =
    recipe.collector;
  const stepHeading: { title: string; description: string } =
    getOwnCollectorStepHeading(recipe);

  const prerequisites: Array<string> = [
    "Your own OpenTelemetry Collector, built with the contrib components (`otel/opentelemetry-collector-contrib`)",
  ];
  if (collector.hasCredentials) {
    prerequisites.push(
      "A monitoring login on the database, set as `DATABASE_USERNAME` and `DATABASE_PASSWORD` in the collector's environment",
    );
  }

  return {
    keyStep: {
      description:
        "Your collector sends this database's metrics to OneUptime with this key. Pick an existing key or create a new one — the config below updates to use it.",
      endpointLabel: "OTLP endpoint",
      endpointValue: otlpEndpoint,
    },
    intro: `${OWN_COLLECTOR_AGENT_INTRO} ${recipe.engineLabel} is not one of them, so its engine metrics come through your own OpenTelemetry Collector.`,
    prerequisites: prerequisites,
    steps: [
      {
        title: stepHeading.title,
        description: stepHeading.description,
        markdown: [
          collector.lead,
          codeBlock("yaml", collector.config),
          collector.note,
          hasApiKey ? "" : PICK_KEY_NOTE,
        ]
          .filter((part: string): boolean => {
            return part.length > 0;
          })
          .join("\n\n"),
      },
      {
        title: "Verify the metrics arrive",
        description: "Check that this database's engine metrics arrive.",
        markdown:
          "Restart your collector with the new config: it reads its config only when it starts. After its first collection, this database's **Engine metrics** status turns to Connected.",
      },
    ],
    advanced: [
      {
        title: "Alert on this database",
        summary:
          "Metrics monitors whose alerts and incidents land on this database, and what to threshold.",
        markdown: alertingMarkdown({
          databaseId: options.database.id,
          system: recipe.system,
          recommendationsUrl: options.recommendationsUrl,
        }),
      },
      pageTopic,
      ...healthTopics,
    ],
    troubleshooting: [
      {
        title: 'Engine metrics reads "Not connected"',
        markdown: `Look for export errors in your collector's log: \`HTTP Status Code 401\` or \`422\` means OneUptime refused the ingestion key. Check that the \`resource/database\` processor is in the pipeline that sends ${recipe.engineLabel}'s metrics — a receiver batch that names no server is ignored.`,
      },
      {
        title: "The metrics land on a Host, or a new Service appears",
        markdown:
          "Keep the `service.name` delete in the `resource/database` processor — data with a `service.name` is routed to that Service first — and leave the `resourcedetection` processor out of this pipeline: its `host.name` makes the collector's machine look like the thing being monitored.",
      },
    ],
    links: links,
  };
}
