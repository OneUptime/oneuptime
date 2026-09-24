/*
 * The database engines the Databases product knows, and everything that has
 * to agree about them. This is the single source of truth for:
 *
 *   - normalizing `db.system.name` / legacy `db.system` values (and the
 *     spellings seen in the wild) to one semconv value per engine
 *   - the engine's display name, which is also the prefix of every
 *     auto-generated DatabaseServer name ("PostgreSQL db.prod:5432")
 *   - the default port applied before an endpoint is keyed (semconv omits
 *     `server.port` when it is the default)
 *   - recognising OpenTelemetry Collector DB receivers from their
 *     instrumentation scope name
 *   - the container images and Helm chart names the Kubernetes / Docker /
 *     Podman classifier accepts
 *
 * The `system` values are the semconv `db.system.name` values
 * (https://opentelemetry.io/docs/specs/semconv/database/). Pure and
 * isomorphic: no server imports, nothing here throws.
 */

export interface DatabaseSystemDescriptor {
  // semconv `db.system.name` value, lowercase — the displayed engine family.
  system: string;
  // "PostgreSQL".
  displayName: string;
  // Raw values that normalize to `system` (legacy `db.system`, spellings).
  aliases: ReadonlyArray<string>;
  defaultPort: number | null;
  // opentelemetry-collector-contrib receiver component types ("postgresql").
  receiverTypes: ReadonlyArray<string>;
  // Metric-name prefixes those receivers emit (lowercase, as stored).
  receiverMetricPrefixes: ReadonlyArray<string>;
  /*
   * Normalized image repositories (see
   * DatabaseContainerClassifier.normalizeImageRepository). An entry without a
   * "/" matches the repository's basename exactly; an entry with one matches
   * the whole repository or a path suffix at a "/" boundary. Never a
   * substring: `acme/redis-cache-warmer` is not Redis.
   */
  imageRepositories: ReadonlyArray<string>;
  // `app.kubernetes.io/name` values of the common Helm charts (Bitnami & co).
  kubernetesChartNames: ReadonlyArray<string>;
  hasCollectorReceiver: boolean;
}

export const DATABASE_SYSTEMS: ReadonlyArray<DatabaseSystemDescriptor> = [
  {
    system: "postgresql",
    displayName: "PostgreSQL",
    aliases: ["postgres", "pg", "pgsql"],
    defaultPort: 5432,
    receiverTypes: ["postgresql"],
    receiverMetricPrefixes: ["postgresql."],
    imageRepositories: [
      "postgres",
      "postgresql",
      "postgis/postgis",
      "timescale/timescaledb",
      "timescale/timescaledb-ha",
      "pgvector/pgvector",
      "ankane/pgvector",
      "supabase/postgres",
      "bitnami/postgresql",
      "bitnami/postgresql-repmgr",
      "cloudnative-pg/postgresql",
      "cloudnative-pg/postgis",
      "crunchydata/crunchy-postgres",
      "crunchydata/crunchy-postgres-gis",
      "percona/percona-distribution-postgresql",
    ],
    kubernetesChartNames: ["postgresql", "postgresql-ha"],
    hasCollectorReceiver: true,
  },
  {
    system: "mysql",
    displayName: "MySQL",
    aliases: ["mariadb", "percona"],
    defaultPort: 3306,
    receiverTypes: ["mysql"],
    receiverMetricPrefixes: ["mysql."],
    imageRepositories: [
      "mysql",
      "mysql/mysql-server",
      "mysql/community-server",
      "mysql/enterprise-server",
      "bitnami/mysql",
      "percona",
      "percona/percona-server",
      "percona/percona-xtradb-cluster",
      "mariadb",
      "mariadb/server",
      "bitnami/mariadb",
      "bitnami/mariadb-galera",
    ],
    kubernetesChartNames: ["mysql", "mariadb", "mariadb-galera"],
    hasCollectorReceiver: true,
  },
  {
    system: "microsoft.sql_server",
    displayName: "SQL Server",
    aliases: ["mssql", "sqlserver", "sql_server"],
    defaultPort: 1433,
    receiverTypes: ["sqlserver"],
    receiverMetricPrefixes: ["sqlserver."],
    imageRepositories: ["mssql/server", "mssql/rhel/server", "azure-sql-edge"],
    kubernetesChartNames: ["mssql", "mssql-server"],
    hasCollectorReceiver: true,
  },
  {
    system: "oracle.db",
    displayName: "Oracle",
    aliases: ["oracle", "oracledb"],
    defaultPort: 1521,
    receiverTypes: ["oracledb"],
    receiverMetricPrefixes: ["oracledb."],
    imageRepositories: [
      "gvenzl/oracle-free",
      "gvenzl/oracle-xe",
      "database/enterprise",
      "database/free",
      "database/express",
      "oracle/database",
    ],
    kubernetesChartNames: [],
    hasCollectorReceiver: true,
  },
  {
    system: "redis",
    displayName: "Redis",
    aliases: ["valkey", "keydb", "dragonfly", "dragonflydb"],
    defaultPort: 6379,
    receiverTypes: ["redis"],
    receiverMetricPrefixes: ["redis."],
    imageRepositories: [
      "redis",
      "redis-stack-server",
      "redis/redis-stack",
      "redis/redis-stack-server",
      "bitnami/redis",
      "bitnami/redis-cluster",
      "opstree/redis",
      "valkey/valkey",
      "bitnami/valkey",
      "bitnami/valkey-cluster",
      "eqalpha/keydb",
      "dragonflydb/dragonfly",
    ],
    kubernetesChartNames: [
      "redis",
      "redis-cluster",
      "valkey",
      "valkey-cluster",
    ],
    hasCollectorReceiver: true,
  },
  {
    system: "mongodb",
    displayName: "MongoDB",
    aliases: ["mongo"],
    defaultPort: 27017,
    receiverTypes: ["mongodb", "mongodbatlas"],
    receiverMetricPrefixes: ["mongodb.", "mongodbatlas."],
    imageRepositories: [
      "mongo",
      "mongodb/mongodb-community-server",
      "mongodb/mongodb-enterprise-server",
      "bitnami/mongodb",
      "bitnami/mongodb-sharded",
      "percona/percona-server-mongodb",
    ],
    kubernetesChartNames: ["mongodb", "mongodb-sharded"],
    hasCollectorReceiver: true,
  },
  {
    system: "elasticsearch",
    displayName: "Elasticsearch",
    aliases: ["elastic"],
    defaultPort: 9200,
    receiverTypes: ["elasticsearch"],
    receiverMetricPrefixes: ["elasticsearch."],
    imageRepositories: [
      "elasticsearch",
      "elasticsearch/elasticsearch",
      "bitnami/elasticsearch",
    ],
    kubernetesChartNames: ["elasticsearch"],
    hasCollectorReceiver: true,
  },
  {
    system: "opensearch",
    displayName: "OpenSearch",
    aliases: [],
    defaultPort: 9200,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["opensearchproject/opensearch", "bitnami/opensearch"],
    kubernetesChartNames: ["opensearch"],
    hasCollectorReceiver: false,
  },
  {
    system: "memcached",
    displayName: "Memcached",
    aliases: [],
    defaultPort: 11211,
    receiverTypes: ["memcached"],
    receiverMetricPrefixes: ["memcached."],
    imageRepositories: ["memcached", "bitnami/memcached"],
    kubernetesChartNames: ["memcached"],
    hasCollectorReceiver: true,
  },
  {
    system: "couchdb",
    displayName: "CouchDB",
    aliases: [],
    defaultPort: 5984,
    receiverTypes: ["couchdb"],
    receiverMetricPrefixes: ["couchdb."],
    imageRepositories: ["couchdb", "apache/couchdb", "bitnami/couchdb"],
    kubernetesChartNames: ["couchdb"],
    hasCollectorReceiver: true,
  },
  {
    system: "cassandra",
    displayName: "Cassandra",
    aliases: ["scylladb", "scylla"],
    defaultPort: 9042,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [
      "cassandra",
      "bitnami/cassandra",
      "k8ssandra/cass-management-api",
      "datastax/dse-server",
      "scylladb/scylla",
    ],
    kubernetesChartNames: ["cassandra", "scylla"],
    hasCollectorReceiver: false,
  },
  {
    system: "clickhouse",
    displayName: "ClickHouse",
    aliases: [],
    defaultPort: 9000,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [
      "clickhouse-server",
      "clickhouse/clickhouse-server",
      "yandex/clickhouse-server",
      "altinity/clickhouse-server",
      "bitnami/clickhouse",
    ],
    kubernetesChartNames: ["clickhouse"],
    hasCollectorReceiver: false,
  },
  {
    system: "cockroachdb",
    displayName: "CockroachDB",
    aliases: ["cockroach"],
    defaultPort: 26257,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["cockroachdb/cockroach"],
    kubernetesChartNames: ["cockroachdb"],
    hasCollectorReceiver: false,
  },
  {
    system: "neo4j",
    displayName: "Neo4j",
    aliases: [],
    defaultPort: 7687,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["neo4j", "bitnami/neo4j"],
    kubernetesChartNames: ["neo4j"],
    hasCollectorReceiver: false,
  },
  {
    system: "influxdb",
    displayName: "InfluxDB",
    aliases: [],
    defaultPort: 8086,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["influxdb", "bitnami/influxdb"],
    kubernetesChartNames: ["influxdb", "influxdb2"],
    hasCollectorReceiver: false,
  },
  {
    system: "couchbase",
    displayName: "Couchbase",
    aliases: [],
    defaultPort: 11210,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["couchbase", "couchbase/server"],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
  },
  {
    system: "ibm.db2",
    displayName: "IBM Db2",
    aliases: ["db2"],
    defaultPort: 50000,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
  },
  {
    system: "sap.hana",
    displayName: "SAP HANA",
    aliases: ["hanadb"],
    defaultPort: 30015,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
  },
  {
    system: "h2database",
    displayName: "H2",
    aliases: ["h2"],
    defaultPort: null,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
  },
  {
    system: "firebirdsql",
    displayName: "Firebird",
    aliases: ["firebird"],
    defaultPort: 3050,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
  },
  {
    system: "aws.redshift",
    displayName: "Amazon Redshift",
    aliases: ["redshift"],
    defaultPort: 5439,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
  },
  {
    system: "azure.cosmosdb",
    displayName: "Azure Cosmos DB",
    aliases: ["cosmosdb"],
    defaultPort: null,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
  },
  {
    system: "aws.dynamodb",
    displayName: "Amazon DynamoDB",
    aliases: ["dynamodb"],
    defaultPort: null,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
  },
  {
    system: "gcp.spanner",
    displayName: "Cloud Spanner",
    aliases: ["spanner"],
    defaultPort: null,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
  },
  {
    system: "trino",
    displayName: "Trino",
    aliases: [],
    defaultPort: 8080,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
  },
  {
    system: "sqlite",
    displayName: "SQLite",
    aliases: [],
    defaultPort: null,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
  },
];

/*
 * Engines that exist only for normalization and display. Cloud-API databases
 * are reached through a shared regional API host (every DynamoDB table in
 * us-east-1 shares one `server.address`), and SQLite / H2 are in-process, so
 * an endpoint seen in a client span never names ONE server of theirs.
 */
const NON_AUTO_CREATABLE_SYSTEMS: ReadonlySet<string> = new Set<string>([
  "aws.dynamodb",
  "azure.cosmosdb",
  "gcp.spanner",
  "sqlite",
  "h2database",
]);

// raw (system or alias) → descriptor. A Map, so "constructor" finds nothing.
const DESCRIPTOR_BY_NAME: ReadonlyMap<string, DatabaseSystemDescriptor> =
  ((): Map<string, DatabaseSystemDescriptor> => {
    const map: Map<string, DatabaseSystemDescriptor> = new Map<
      string,
      DatabaseSystemDescriptor
    >();
    for (const descriptor of DATABASE_SYSTEMS) {
      map.set(descriptor.system, descriptor);
      for (const alias of descriptor.aliases) {
        map.set(alias, descriptor);
      }
    }
    return map;
  })();

// receiver component type → descriptor.
const DESCRIPTOR_BY_RECEIVER_TYPE: ReadonlyMap<
  string,
  DatabaseSystemDescriptor
> = ((): Map<string, DatabaseSystemDescriptor> => {
  const map: Map<string, DatabaseSystemDescriptor> = new Map<
    string,
    DatabaseSystemDescriptor
  >();
  for (const descriptor of DATABASE_SYSTEMS) {
    for (const receiverType of descriptor.receiverTypes) {
      map.set(receiverType, descriptor);
    }
  }
  return map;
})();

function canonicalRaw(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim().toLowerCase();
}

/**
 * `value` without any run of `character` at its end. A plain loop rather than
 * `replace(/x+$/, "")`: that regex backtracks quadratically on telemetry-supplied
 * strings holding long runs of `character` that do not end the string.
 */
export function trimTrailingCharacter(
  value: string,
  character: string,
): string {
  let end: number = value.length;
  while (end > 0 && value.charAt(end - 1) === character) {
    end--;
  }
  return end === value.length ? value : value.substring(0, end);
}

/**
 * Normalize a raw `db.system.name` / `db.system` value. A known alias maps to
 * its engine ("postgres" → "postgresql", "mssql" → "microsoft.sql_server");
 * an unknown non-empty value is returned canonicalized (trimmed, lowercased)
 * so it still displays and groups; an empty or non-string value is null.
 */
export function normalizeDatabaseSystem(raw: unknown): string | null {
  const canonical: string = canonicalRaw(raw);
  if (!canonical) {
    return null;
  }
  const descriptor: DatabaseSystemDescriptor | undefined =
    DESCRIPTOR_BY_NAME.get(canonical);
  return descriptor ? descriptor.system : canonical;
}

/** The engine's descriptor (aliases accepted), or null for an unknown one. */
export function getDatabaseSystemDescriptor(
  system: unknown,
): DatabaseSystemDescriptor | null {
  return DESCRIPTOR_BY_NAME.get(canonicalRaw(system)) || null;
}

export function isKnownDatabaseSystem(system: unknown): boolean {
  return getDatabaseSystemDescriptor(system) !== null;
}

/**
 * True when a client-span-discovered endpoint of this engine may create a
 * DatabaseServer row on its own: the engine is known, and it is not a
 * cloud-API or in-process database (see NON_AUTO_CREATABLE_SYSTEMS).
 */
export function isAutoCreatableDatabaseSystem(system: unknown): boolean {
  const descriptor: DatabaseSystemDescriptor | null =
    getDatabaseSystemDescriptor(system);
  return (
    descriptor !== null && !NON_AUTO_CREATABLE_SYSTEMS.has(descriptor.system)
  );
}

/**
 * "PostgreSQL" for a known engine (aliases accepted), the trimmed raw value
 * for an unknown one, and "Database" when there is nothing to show.
 */
export function getDatabaseSystemDisplayName(system: unknown): string {
  const descriptor: DatabaseSystemDescriptor | null =
    getDatabaseSystemDescriptor(system);
  if (descriptor) {
    return descriptor.displayName;
  }
  const raw: string = typeof system === "string" ? system.trim() : "";
  return raw || "Database";
}

export function getDefaultDatabasePort(system: unknown): number | null {
  const descriptor: DatabaseSystemDescriptor | null =
    getDatabaseSystemDescriptor(system);
  return descriptor ? descriptor.defaultPort : null;
}

const RECEIVER_SUFFIX: string = "receiver";

/**
 * The engine a collector-contrib DB receiver reports, from its
 * instrumentation scope name. Matches the LAST path segment against
 * `<type>receiver`, so both the current Go-module form
 * (`github.com/open-telemetry/opentelemetry-collector-contrib/receiver/postgresqlreceiver`)
 * and the legacy `otelcol/postgresqlreceiver` form are recognised. Anything
 * else (an SDK scope, a non-DB receiver) is null.
 */
export function getDatabaseSystemFromReceiverScopeName(
  scopeName: unknown,
): string | null {
  const canonical: string = trimTrailingCharacter(canonicalRaw(scopeName), "/");
  if (!canonical) {
    return null;
  }

  const lastSegment: string =
    canonical.substring(canonical.lastIndexOf("/") + 1) || "";

  if (
    lastSegment.length <= RECEIVER_SUFFIX.length ||
    !lastSegment.endsWith(RECEIVER_SUFFIX)
  ) {
    return null;
  }

  const receiverType: string = lastSegment.substring(
    0,
    lastSegment.length - RECEIVER_SUFFIX.length,
  );

  const descriptor: DatabaseSystemDescriptor | undefined =
    DESCRIPTOR_BY_RECEIVER_TYPE.get(receiverType);

  return descriptor ? descriptor.system : null;
}

/**
 * The engine of the first DB receiver among a batch's scope names (the
 * receiver system hint ingest passes to
 * `resolveDatabaseFromResourceAttributes`), or null when no scope is a DB
 * receiver.
 */
export function getDatabaseReceiverSystemHint(
  scopeNames: Array<string | null | undefined>,
): string | null {
  if (!Array.isArray(scopeNames)) {
    return null;
  }
  for (const scopeName of scopeNames) {
    const system: string | null =
      getDatabaseSystemFromReceiverScopeName(scopeName);
    if (system) {
      return system;
    }
  }
  return null;
}
