/*
 * The database engines the Databases product knows, and everything that has
 * to agree about them. This is the single source of truth for:
 *
 *   - normalizing `db.system.name` / legacy `db.system` values (and the
 *     spellings seen in the wild) to one value per engine
 *   - the engine's display name, which is also the prefix of every
 *     auto-generated DatabaseServer name ("PostgreSQL db.prod:5432")
 *   - the engine family: a fork or wire-compatible drop-in (MariaDB,
 *     Valkey, ScyllaDB, CockroachDB, TiDB, …) is its own engine, but client
 *     libraries report it under the family's name
 *   - the default port applied before an endpoint is keyed (semconv omits
 *     `server.port` when it is the default)
 *   - whether a client span alone may create a database of the engine
 *   - recognising OpenTelemetry Collector DB receivers from their
 *     instrumentation scope name, and where engine metrics come from when
 *     the collector has no receiver for the engine
 *   - the container images and Helm chart names the Kubernetes / Docker /
 *     Podman classifier accepts
 *
 * The `system` values are the semconv `db.system.name` values where semconv
 * defines one (https://opentelemetry.io/docs/specs/semconv/registry/attributes/db/),
 * the legacy `db.system` value where only that exists (`vertica`, `sybase`),
 * and a lowercase OneUptime-defined name otherwise (`snowflake`, `tidb`,
 * `qdrant`), in the semconv `<provider>.<service>` style for managed cloud
 * services (`aws.documentdb`). Pure and isomorphic: no server imports,
 * nothing here throws.
 */

/*
 * How the engine is reached, which decides whether an endpoint seen in a
 * client span names ONE database:
 *
 *   - "server": a server or cluster with its own address — self-hosted, or
 *     a managed service whose endpoint is per cluster / per account
 *     (`orders.abc123.us-east-1.redshift.amazonaws.com`,
 *     `acme.snowflakecomputing.com`).
 *   - "cloud-api": a managed service reached through its provider's API
 *     host. Either every customer in a region shares that host (DynamoDB's
 *     `dynamodb.us-east-1.amazonaws.com`, `bigquery.googleapis.com`), or an
 *     account is served from several regional hosts (Cosmos DB), so the
 *     host does not name one database.
 *   - "embedded": an in-process library (SQLite, H2, DuckDB) — there is no
 *     server, and a span carries no address worth keying.
 *
 * Only "server" engines are created from client spans on their own; every
 * engine can still be created by hand, by an agent or by a linked id.
 */
export type DatabaseDeployment = "server" | "cloud-api" | "embedded";

/*
 * Where the engine's own health metrics come from, for the docs and the
 * in-app guide. The Database Agent and "your own collector" recipes are
 * built from this.
 */
export type DatabaseEngineMetricsSource =
  // A collector-contrib receiver (the descriptor's receiverTypes).
  | { kind: "receiver" }
  /*
   * The engine serves Prometheus metrics itself: scrape it with the
   * collector's `prometheus` receiver and stamp the identity.
   */
  | {
      kind: "prometheus";
      port: number;
      path: string;
      // What has to be switched on first, if anything.
      note?: string | undefined;
    }
  // A managed service: its provider's monitoring API has the metrics.
  | { kind: "cloud-monitoring"; receiver: string; note: string }
  // No ready-made path; `reason` says what the options are.
  | { kind: "none"; reason: string }
  // In-process: there is no server to collect from.
  | { kind: "embedded" };

export interface DatabaseSystemDescriptor {
  // `db.system.name` value (or the OneUptime-defined name), lowercase.
  system: string;
  // "PostgreSQL".
  displayName: string;
  // Raw values that normalize to `system` (legacy `db.system`, spellings).
  aliases: ReadonlyArray<string>;
  defaultPort: number | null;
  /*
   * The opentelemetry-collector-contrib receivers that monitor the engine,
   * by the name in their Go module (`<type>receiver`, which is also the
   * instrumentation scope name): "postgresql", "googlecloudspanner". A fork
   * lists its family's receiver when that receiver works against it
   * (MariaDB is monitored by the `mysql` receiver); the receiver still
   * REPORTS the family, so a scope name maps to the family's engine.
   */
  receiverTypes: ReadonlyArray<string>;
  // Metric-name prefixes those receivers emit (lowercase, as stored).
  receiverMetricPrefixes: ReadonlyArray<string>;
  /*
   * Normalized image repositories (see
   * DatabaseContainerClassifier.normalizeImageRepository). An entry without a
   * "/" matches the repository's basename exactly; an entry with one matches
   * the whole repository or a path suffix at a "/" boundary. Never a
   * substring: `acme/redis-cache-warmer` is not Redis. Listed in their
   * canonical form: `bitnami/…` also stands for Bitnami's relocated
   * `bitnamilegacy/…` and `bitnamisecure/…` repositories, and a Red Hat /
   * OpenShift Software Collections image (`rhel9/postgresql-16`) is matched
   * by its engine's bare basename once normalization drops the version.
   */
  imageRepositories: ReadonlyArray<string>;
  // `app.kubernetes.io/name` values of the common Helm charts (Bitnami & co).
  kubernetesChartNames: ReadonlyArray<string>;
  hasCollectorReceiver: boolean;
  /*
   * The engine this one is a fork or wire-compatible drop-in of ("redis" for
   * Valkey, "mysql" for MariaDB, "cassandra" for ScyllaDB, "postgresql" for
   * CockroachDB). Client libraries cannot tell the two apart, so a span
   * reports the family's value while an image or a receiver can name the
   * fork; getDatabaseSystemFamily lets both land on one row, and a stronger
   * source refines the engine to the fork. Absent for an engine that is its
   * own family.
   */
  family?: string | undefined;
  /*
   * A server's own version string (`SELECT VERSION()`) that names this
   * engine rather than its family: MariaDB answers
   * "10.11.7-MariaDB-1:10.11.7+maria~ubu2204", TiDB "8.0.11-TiDB-v7.5.1",
   * Vitess "8.0.30-Vitess". Only on forks (see
   * refineDatabaseSystemFromVersion).
   */
  versionPattern?: RegExp | undefined;
  /*
   * The lowest MAJOR version that names this engine on its own, because its
   * family's releases never reached it: MySQL's stop at 9.x, while MariaDB
   * numbers its releases 10.x, 11.x and 12.x. It matters because the
   * collector's `mysql` receiver reports only the leading number
   * ("11.4.13", never "11.4.13-MariaDB-ubu2404") in `db.system.version`,
   * which versionPattern cannot read. Only on forks, and checked after every
   * fork's versionPattern (see refineDatabaseSystemFromVersion).
   */
  versionMajorFrom?: number | undefined;
  /*
   * Resource attributes a receiver fills, for this engine, with the version
   * of the engine it stays compatible with rather than its own — never read
   * as this engine's version. Valkey answers INFO's `redis_version` with
   * 7.2.4, the Redis release it forked from, whatever its own version
   * (`valkey_version`) is, and the `redis` receiver reports that field as
   * `redis.version`.
   */
  compatibilityVersionAttributes?: ReadonlyArray<string> | undefined;
  deployment: DatabaseDeployment;
  engineMetrics: DatabaseEngineMetricsSource;
}

const RECEIVER: DatabaseEngineMetricsSource = { kind: "receiver" };
const EMBEDDED: DatabaseEngineMetricsSource = { kind: "embedded" };

// CloudWatch has no metrics receiver in collector-contrib; Metric Streams do.
const AWS_CLOUDWATCH_METRICS: DatabaseEngineMetricsSource = {
  kind: "cloud-monitoring",
  receiver: "awsfirehose",
  note: "Stream the service's CloudWatch metrics to a collector through a CloudWatch Metric Stream and Amazon Data Firehose, received by the `awsfirehose` receiver.",
};

const GOOGLE_CLOUD_MONITORING: DatabaseEngineMetricsSource = {
  kind: "cloud-monitoring",
  receiver: "googlecloudmonitoring",
  note: "Read the service's metrics from Cloud Monitoring with the `googlecloudmonitoring` receiver.",
};

const JMX_ONLY: string =
  "exposes its metrics over JMX; run the Prometheus JMX exporter as a Java agent and scrape it with the `prometheus` receiver";

export const DATABASE_SYSTEMS: ReadonlyArray<DatabaseSystemDescriptor> = [
  // ---- relational -------------------------------------------------------
  {
    system: "postgresql",
    displayName: "PostgreSQL",
    // `edb`: EDB Postgres Advanced Server (a legacy semconv value).
    aliases: ["postgres", "pg", "pgsql", "edb"],
    defaultPort: 5432,
    receiverTypes: ["postgresql"],
    receiverMetricPrefixes: ["postgresql."],
    imageRepositories: [
      "postgres",
      "postgresql",
      "postgis/postgis",
      "kartoza/postgis",
      "timescale/timescaledb",
      "timescale/timescaledb-ha",
      "pgvector/pgvector",
      "ankane/pgvector",
      "supabase/postgres",
      "citusdata/citus",
      "paradedb/paradedb",
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
    deployment: "server",
    engineMetrics: RECEIVER,
  },
  {
    system: "mysql",
    displayName: "MySQL",
    // Percona Server for MySQL is MySQL, not a fork with its own protocol.
    aliases: ["percona"],
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
      "percona/percona-server-mysql",
      "percona/percona-xtradb-cluster",
    ],
    kubernetesChartNames: ["mysql"],
    hasCollectorReceiver: true,
    deployment: "server",
    engineMetrics: RECEIVER,
  },
  {
    system: "mariadb",
    displayName: "MariaDB",
    aliases: [],
    defaultPort: 3306,
    receiverTypes: ["mysql"],
    receiverMetricPrefixes: ["mysql."],
    imageRepositories: [
      "mariadb",
      "mariadb/server",
      "bitnami/mariadb",
      "bitnami/mariadb-galera",
    ],
    kubernetesChartNames: ["mariadb", "mariadb-galera"],
    hasCollectorReceiver: true,
    family: "mysql",
    versionPattern: /mariadb/i,
    versionMajorFrom: 10,
    deployment: "server",
    engineMetrics: RECEIVER,
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
    deployment: "server",
    engineMetrics: RECEIVER,
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
    deployment: "server",
    engineMetrics: RECEIVER,
  },
  {
    system: "ibm.db2",
    displayName: "IBM Db2",
    aliases: ["db2"],
    defaultPort: 50000,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["db2_community/db2", "ibmcom/db2"],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no Db2 receiver and its `sql_query` receiver has no Db2 driver; use IBM's own Db2 monitoring (or a Prometheus exporter for Db2) and stamp its data with this database's identity.",
    },
  },
  {
    system: "sap.hana",
    displayName: "SAP HANA",
    // `saphana` is what the collector's saphana receiver puts in `db.system`.
    aliases: ["hanadb", "saphana"],
    defaultPort: 30015,
    receiverTypes: ["saphana"],
    receiverMetricPrefixes: ["saphana."],
    imageRepositories: ["saplabs/hanaexpress"],
    kubernetesChartNames: [],
    hasCollectorReceiver: true,
    deployment: "server",
    engineMetrics: RECEIVER,
  },
  {
    system: "ibm.informix",
    displayName: "IBM Informix",
    aliases: ["informix"],
    defaultPort: 9088,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["informix-developer-database"],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no Informix receiver; export Informix's own statistics (onstat, the sysmaster database) and stamp them with this database's identity.",
    },
  },
  {
    system: "ibm.netezza",
    displayName: "IBM Netezza",
    aliases: ["netezza"],
    defaultPort: 5480,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no Netezza receiver; use the appliance's own monitoring and stamp its data with this database's identity.",
    },
  },
  {
    system: "teradata",
    displayName: "Teradata",
    aliases: [],
    defaultPort: 1025,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no Teradata receiver; export Teradata's own resource usage (DBQL, ResUsage) and stamp it with this database's identity.",
    },
  },
  {
    system: "sap.maxdb",
    displayName: "SAP MaxDB",
    aliases: ["maxdb"],
    defaultPort: 7210,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no MaxDB receiver; export MaxDB's own statistics and stamp them with this database's identity.",
    },
  },
  {
    system: "sybase",
    displayName: "SAP ASE (Sybase)",
    aliases: ["sap.ase"],
    defaultPort: 5000,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no SAP ASE receiver; export the monitoring tables (MDA tables) and stamp them with this database's identity.",
    },
  },
  {
    system: "intersystems.cache",
    displayName: "InterSystems IRIS / Caché",
    aliases: ["cache", "intersystems_cache"],
    defaultPort: 1972,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [
      "intersystems/iris",
      "intersystems/iris-community",
      "intersystemsdc/iris-community",
    ],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "prometheus",
      port: 52773,
      path: "/api/monitor/metrics",
      note: "IRIS serves this on its web server port (Caché has no such endpoint).",
    },
  },
  {
    system: "actian.ingres",
    displayName: "Actian Ingres",
    aliases: ["ingres"],
    // The listen port derives from the installation code; there is no one default.
    defaultPort: null,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no Ingres receiver; export Ingres's own statistics and stamp them with this database's identity.",
    },
  },
  {
    system: "softwareag.adabas",
    displayName: "Software AG Adabas",
    aliases: ["adabas"],
    defaultPort: null,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no Adabas receiver; export Adabas's own statistics and stamp them with this database's identity.",
    },
  },
  {
    system: "firebirdsql",
    displayName: "Firebird",
    aliases: ["firebird"],
    defaultPort: 3050,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["firebirdsql/firebird", "jacobalberty/firebird"],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no Firebird receiver; export the MON$ monitoring tables and stamp them with this database's identity.",
    },
  },
  {
    system: "interbase",
    displayName: "InterBase",
    aliases: [],
    defaultPort: 3050,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    // Firebird forked from InterBase 6 and keeps its wire protocol.
    family: "firebirdsql",
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no InterBase receiver; export the TMP$ monitoring tables and stamp them with this database's identity.",
    },
  },
  {
    system: "progress",
    displayName: "Progress OpenEdge",
    aliases: [],
    // The SQL broker port is chosen per database; there is no one default.
    defaultPort: null,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no OpenEdge receiver; export the virtual system tables (_Connect, _ActSummary) and stamp them with this database's identity.",
    },
  },
  {
    system: "pervasive",
    displayName: "Actian Zen (Pervasive PSQL)",
    aliases: [],
    defaultPort: 1583,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no Actian Zen receiver; export its monitor statistics and stamp them with this database's identity.",
    },
  },
  {
    system: "filemaker",
    displayName: "Claris FileMaker",
    aliases: [],
    // The xDBC (ODBC / JDBC) listener SQL clients connect to.
    defaultPort: 2399,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no FileMaker receiver; export FileMaker Server's statistics (its Admin API) and stamp them with this database's identity.",
    },
  },

  // ---- distributed SQL, PostgreSQL and MySQL wire-compatible ------------
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
    // Applications reach it with a PostgreSQL driver.
    family: "postgresql",
    deployment: "server",
    engineMetrics: { kind: "prometheus", port: 8080, path: "/_status/vars" },
  },
  {
    system: "yugabytedb",
    displayName: "YugabyteDB",
    aliases: ["yugabyte"],
    // YSQL, the PostgreSQL-compatible API.
    defaultPort: 5433,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["yugabytedb/yugabyte"],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    family: "postgresql",
    deployment: "server",
    engineMetrics: {
      kind: "prometheus",
      port: 9000,
      path: "/prometheus-metrics",
      note: "Served by every yb-tserver (yb-master serves the same path on port 7000).",
    },
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
    // Applications reach it with a PostgreSQL driver.
    family: "postgresql",
    // A cluster (or workgroup) endpoint names one warehouse.
    deployment: "server",
    engineMetrics: AWS_CLOUDWATCH_METRICS,
  },
  {
    system: "greenplum",
    displayName: "Greenplum",
    aliases: [],
    defaultPort: 5432,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    family: "postgresql",
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no Greenplum receiver; export the gp_toolkit views and stamp them with this database's identity.",
    },
  },
  {
    system: "questdb",
    displayName: "QuestDB",
    aliases: [],
    // The PostgreSQL wire protocol port applications query.
    defaultPort: 8812,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["questdb/questdb"],
    kubernetesChartNames: ["questdb"],
    hasCollectorReceiver: false,
    family: "postgresql",
    deployment: "server",
    engineMetrics: {
      kind: "prometheus",
      port: 9003,
      path: "/metrics",
      note: "Set `metrics.enabled=true` in server.conf (or QDB_METRICS_ENABLED=true).",
    },
  },
  {
    system: "tidb",
    displayName: "TiDB",
    aliases: [],
    defaultPort: 4000,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["pingcap/tidb"],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    // Applications reach it with a MySQL driver.
    family: "mysql",
    versionPattern: /tidb/i,
    deployment: "server",
    engineMetrics: {
      kind: "prometheus",
      port: 10080,
      path: "/metrics",
      note: "The tidb-server status port.",
    },
  },
  {
    system: "vitess",
    displayName: "Vitess",
    aliases: [],
    // vtgate's MySQL port, as the Vitess operator and PlanetScale serve it.
    defaultPort: 3306,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["vitess/vtgate"],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    family: "mysql",
    versionPattern: /vitess/i,
    deployment: "server",
    engineMetrics: {
      kind: "prometheus",
      port: 15000,
      path: "/metrics",
      note: "Served on each component's web port (`--port`); scrape vtgate and the vttablets.",
    },
  },
  {
    system: "singlestore",
    displayName: "SingleStore",
    aliases: ["memsql"],
    defaultPort: 3306,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [
      "singlestore/cluster-in-a-box",
      "singlestore/node",
      "memsql/cluster-in-a-box",
    ],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    family: "mysql",
    deployment: "server",
    engineMetrics: {
      kind: "prometheus",
      port: 9104,
      path: "/metrics",
      note: "Start the exporter on the master aggregator (`SET GLOBAL exporter_port = 9104`).",
    },
  },
  {
    system: "oceanbase",
    displayName: "OceanBase",
    aliases: [],
    defaultPort: 2881,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["oceanbase/oceanbase-ce"],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    family: "mysql",
    versionPattern: /oceanbase/i,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no OceanBase receiver; scrape the Prometheus endpoint of OceanBase's obagent with the `prometheus` receiver and stamp it with this database's identity.",
    },
  },
  {
    system: "starrocks",
    displayName: "StarRocks",
    aliases: [],
    // The frontend's MySQL protocol port.
    defaultPort: 9030,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["starrocks/allin1-ubuntu", "starrocks/fe-ubuntu"],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    family: "mysql",
    deployment: "server",
    engineMetrics: {
      kind: "prometheus",
      port: 8030,
      path: "/metrics",
      note: "The frontend's HTTP port (backends serve the same path on 8040).",
    },
  },
  {
    system: "doris",
    displayName: "Apache Doris",
    aliases: [],
    defaultPort: 9030,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["apache/doris"],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    family: "mysql",
    deployment: "server",
    engineMetrics: {
      kind: "prometheus",
      port: 8030,
      path: "/metrics",
      note: "The frontend's HTTP port (backends serve the same path on 8040).",
    },
  },
  {
    system: "gcp.spanner",
    displayName: "Cloud Spanner",
    aliases: ["spanner"],
    defaultPort: 443,
    receiverTypes: ["googlecloudspanner"],
    receiverMetricPrefixes: ["database/spanner/"],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: true,
    // spanner.googleapis.com serves every instance.
    deployment: "cloud-api",
    engineMetrics: RECEIVER,
  },

  // ---- warehouses, lakehouses and query engines --------------------------
  {
    system: "snowflake",
    displayName: "Snowflake",
    aliases: [],
    defaultPort: 443,
    receiverTypes: ["snowflake"],
    receiverMetricPrefixes: ["snowflake."],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: true,
    // `<account>.snowflakecomputing.com` names one account.
    deployment: "server",
    engineMetrics: RECEIVER,
  },
  {
    system: "bigquery",
    displayName: "Google BigQuery",
    aliases: ["gcp.bigquery"],
    defaultPort: 443,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    // bigquery.googleapis.com serves every project.
    deployment: "cloud-api",
    engineMetrics: GOOGLE_CLOUD_MONITORING,
  },
  {
    system: "databricks",
    displayName: "Databricks",
    aliases: [],
    defaultPort: 443,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    // `<workspace>.cloud.databricks.com` names one workspace.
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no Databricks receiver; read warehouse and query history from the workspace's system tables and stamp it with this database's identity.",
    },
  },
  {
    system: "vertica",
    displayName: "Vertica",
    aliases: [],
    defaultPort: 5433,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["vertica/vertica-ce"],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no Vertica receiver; export the v_monitor schema (or scrape a Vertica Prometheus exporter) and stamp it with this database's identity.",
    },
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
    deployment: "server",
    engineMetrics: {
      kind: "prometheus",
      port: 9363,
      path: "/metrics",
      note: "Enable the `<prometheus>` section of the server config.",
    },
  },
  {
    system: "hive",
    displayName: "Apache Hive",
    aliases: [],
    // HiveServer2's Thrift port.
    defaultPort: 10000,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["apache/hive"],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: { kind: "none", reason: `HiveServer2 ${JMX_ONLY}.` },
  },
  {
    system: "impala",
    displayName: "Apache Impala",
    aliases: [],
    // The HiveServer2-protocol port JDBC / ODBC clients use.
    defaultPort: 21050,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no Impala receiver; export the daemons' metrics from their debug web UI (/metrics?json) and stamp them with this database's identity.",
    },
  },
  {
    system: "trino",
    displayName: "Trino",
    aliases: [],
    defaultPort: 8080,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["trinodb/trino"],
    kubernetesChartNames: ["trino"],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "prometheus",
      port: 8080,
      path: "/metrics",
      note: "Served by the coordinator; send `X-Trino-User` if authentication is on.",
    },
  },
  {
    system: "presto",
    displayName: "Presto",
    aliases: [],
    defaultPort: 8080,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["prestodb/presto"],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: { kind: "none", reason: `Presto ${JMX_ONLY}.` },
  },
  {
    system: "druid",
    displayName: "Apache Druid",
    aliases: [],
    // The router, which serves Druid SQL.
    defaultPort: 8888,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["apache/druid"],
    kubernetesChartNames: ["druid"],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no Druid receiver; load Druid's `prometheus-emitter` extension, scrape the port you give it with the `prometheus` receiver and stamp it with this database's identity.",
    },
  },
  {
    system: "pinot",
    displayName: "Apache Pinot",
    aliases: [],
    // The broker's query port.
    defaultPort: 8099,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["apachepinot/pinot"],
    kubernetesChartNames: ["pinot"],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: { kind: "none", reason: `Pinot ${JMX_ONLY}.` },
  },

  // ---- key-value stores and caches -----------------------------------------
  {
    system: "redis",
    displayName: "Redis",
    aliases: [],
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
    ],
    kubernetesChartNames: ["redis", "redis-cluster"],
    hasCollectorReceiver: true,
    deployment: "server",
    engineMetrics: RECEIVER,
  },
  {
    system: "valkey",
    displayName: "Valkey",
    aliases: [],
    defaultPort: 6379,
    receiverTypes: ["redis"],
    receiverMetricPrefixes: ["redis."],
    // The bare basename also covers Red Hat's rhel10/valkey-8.
    imageRepositories: ["valkey", "bitnami/valkey-cluster"],
    kubernetesChartNames: ["valkey", "valkey-cluster"],
    hasCollectorReceiver: true,
    family: "redis",
    // INFO: redis_version:7.2.4 next to valkey_version:8.1.10.
    compatibilityVersionAttributes: ["redis.version"],
    deployment: "server",
    engineMetrics: RECEIVER,
  },
  {
    system: "keydb",
    displayName: "KeyDB",
    aliases: [],
    defaultPort: 6379,
    receiverTypes: ["redis"],
    receiverMetricPrefixes: ["redis."],
    imageRepositories: ["eqalpha/keydb"],
    kubernetesChartNames: ["keydb"],
    hasCollectorReceiver: true,
    family: "redis",
    deployment: "server",
    engineMetrics: RECEIVER,
  },
  {
    system: "dragonfly",
    displayName: "Dragonfly",
    aliases: ["dragonflydb"],
    defaultPort: 6379,
    receiverTypes: ["redis"],
    receiverMetricPrefixes: ["redis."],
    imageRepositories: ["dragonflydb/dragonfly"],
    kubernetesChartNames: ["dragonfly"],
    hasCollectorReceiver: true,
    family: "redis",
    /*
     * INFO's redis_version is the Redis API level Dragonfly emulates; its
     * own release is dragonfly_version (df-v1.x).
     */
    compatibilityVersionAttributes: ["redis.version"],
    deployment: "server",
    engineMetrics: RECEIVER,
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
    deployment: "server",
    engineMetrics: RECEIVER,
  },
  {
    system: "etcd",
    displayName: "etcd",
    aliases: [],
    defaultPort: 2379,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    /*
     * Not the bare `etcd` basename: that is also the Kubernetes control
     * plane's own etcd (registry.k8s.io/etcd).
     */
    imageRepositories: ["coreos/etcd", "etcd-development/etcd", "bitnami/etcd"],
    kubernetesChartNames: ["etcd"],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: { kind: "prometheus", port: 2379, path: "/metrics" },
  },
  {
    system: "hazelcast",
    displayName: "Hazelcast",
    aliases: [],
    defaultPort: 5701,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [
      "hazelcast/hazelcast",
      "hazelcast/hazelcast-enterprise",
    ],
    kubernetesChartNames: ["hazelcast"],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no Hazelcast receiver; set PROMETHEUS_PORT on the Hazelcast container (its image bundles the JMX exporter), scrape that port with the `prometheus` receiver and stamp it with this database's identity.",
    },
  },
  {
    system: "ignite",
    displayName: "Apache Ignite",
    aliases: [],
    // The thin-client port.
    defaultPort: 10800,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["apacheignite/ignite"],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: { kind: "none", reason: `Ignite ${JMX_ONLY}.` },
  },
  {
    system: "aerospike",
    displayName: "Aerospike",
    aliases: [],
    defaultPort: 3000,
    receiverTypes: ["aerospike"],
    receiverMetricPrefixes: ["aerospike."],
    imageRepositories: [
      "aerospike/aerospike-server",
      "aerospike/aerospike-server-enterprise",
    ],
    kubernetesChartNames: [],
    hasCollectorReceiver: true,
    deployment: "server",
    engineMetrics: RECEIVER,
  },
  {
    system: "riak",
    displayName: "Riak KV",
    aliases: [],
    // The Protocol Buffers port clients use (the HTTP API is 8098).
    defaultPort: 8087,
    receiverTypes: ["riak"],
    receiverMetricPrefixes: ["riak."],
    imageRepositories: ["basho/riak-kv"],
    kubernetesChartNames: [],
    hasCollectorReceiver: true,
    deployment: "server",
    engineMetrics: RECEIVER,
  },
  {
    system: "foundationdb",
    displayName: "FoundationDB",
    aliases: [],
    defaultPort: 4500,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["foundationdb/foundationdb"],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no FoundationDB receiver; export `status json` (for example with a FoundationDB Prometheus exporter) and stamp it with this database's identity.",
    },
  },
  {
    system: "aws.dynamodb",
    displayName: "Amazon DynamoDB",
    aliases: ["dynamodb"],
    defaultPort: 443,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    // dynamodb.<region>.amazonaws.com serves every table in the region.
    deployment: "cloud-api",
    engineMetrics: AWS_CLOUDWATCH_METRICS,
  },
  {
    system: "gcp.bigtable",
    displayName: "Cloud Bigtable",
    aliases: ["bigtable"],
    defaultPort: 443,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    // bigtable.googleapis.com serves every instance.
    deployment: "cloud-api",
    engineMetrics: GOOGLE_CLOUD_MONITORING,
  },

  // ---- wide-column --------------------------------------------------------
  {
    system: "cassandra",
    displayName: "Cassandra",
    aliases: [],
    defaultPort: 9042,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [
      "cassandra",
      "bitnami/cassandra",
      "k8ssandra/cass-management-api",
      "datastax/dse-server",
    ],
    kubernetesChartNames: ["cassandra"],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: { kind: "none", reason: `Cassandra ${JMX_ONLY}.` },
  },
  {
    system: "scylladb",
    displayName: "ScyllaDB",
    aliases: ["scylla"],
    defaultPort: 9042,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["scylladb/scylla", "scylladb/scylla-enterprise"],
    kubernetesChartNames: ["scylla"],
    hasCollectorReceiver: false,
    // Applications reach it with a Cassandra (CQL) driver.
    family: "cassandra",
    deployment: "server",
    engineMetrics: { kind: "prometheus", port: 9180, path: "/metrics" },
  },
  {
    system: "hbase",
    displayName: "Apache HBase",
    aliases: [],
    // Clients find the cluster through ZooKeeper; there is no one server port.
    defaultPort: null,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no HBase receiver; add `prometheus` to `hbase.http.metrics.servlets` and scrape each server's web UI port (/prometheus) with the `prometheus` receiver, stamped with this database's identity.",
    },
  },
  {
    system: "geode",
    displayName: "Apache Geode",
    aliases: [],
    // The locator clients connect to.
    defaultPort: 10334,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["apachegeode/geode"],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: { kind: "none", reason: `Geode ${JMX_ONLY}.` },
  },

  // ---- document and multi-model -------------------------------------------
  {
    system: "mongodb",
    displayName: "MongoDB",
    aliases: ["mongo"],
    defaultPort: 27017,
    receiverTypes: ["mongodb", "mongodbatlas"],
    receiverMetricPrefixes: ["mongodb.", "mongodbatlas."],
    imageRepositories: [
      "mongo",
      // The bare basename covers Software Collections' centos/mongodb-36-centos7.
      "mongodb",
      "mongodb/mongodb-community-server",
      "mongodb/mongodb-enterprise-server",
      "mongodb/mongodb-enterprise-database",
      "mongodb/mongodb-enterprise-database-ubi",
      "bitnami/mongodb",
      "bitnami/mongodb-sharded",
      "percona/percona-server-mongodb",
    ],
    kubernetesChartNames: ["mongodb", "mongodb-sharded"],
    hasCollectorReceiver: true,
    deployment: "server",
    engineMetrics: RECEIVER,
  },
  {
    system: "ferretdb",
    displayName: "FerretDB",
    aliases: [],
    defaultPort: 27017,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["ferretdb/ferretdb"],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    // Applications reach it with a MongoDB driver.
    family: "mongodb",
    deployment: "server",
    engineMetrics: {
      kind: "prometheus",
      port: 8088,
      path: "/debug/metrics",
      note: "FerretDB's debug handler; make it listen beyond localhost (`FERRETDB_DEBUG_ADDR=:8088`).",
    },
  },
  {
    system: "aws.documentdb",
    displayName: "Amazon DocumentDB",
    aliases: ["documentdb"],
    defaultPort: 27017,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    family: "mongodb",
    // A cluster endpoint names one cluster.
    deployment: "server",
    engineMetrics: AWS_CLOUDWATCH_METRICS,
  },
  {
    system: "azure.cosmosdb",
    displayName: "Azure Cosmos DB",
    aliases: ["cosmosdb"],
    defaultPort: 443,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    /*
     * An account answers on its global host AND on one regional host per
     * region, so a span's host does not name one account.
     */
    deployment: "cloud-api",
    engineMetrics: {
      kind: "cloud-monitoring",
      receiver: "azure_monitor",
      note: "Read the account's metrics from Azure Monitor with the `azure_monitor` receiver.",
    },
  },
  {
    system: "gcp.firestore",
    displayName: "Cloud Firestore",
    aliases: ["firestore"],
    defaultPort: 443,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    // firestore.googleapis.com serves every database.
    deployment: "cloud-api",
    engineMetrics: GOOGLE_CLOUD_MONITORING,
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
    deployment: "server",
    engineMetrics: RECEIVER,
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
    deployment: "server",
    engineMetrics: {
      kind: "prometheus",
      port: 8091,
      path: "/metrics",
      note: "Couchbase Server 7.0 and later; the scrape needs a user with the External Stats Reader role (basic auth).",
    },
  },
  {
    system: "arangodb",
    displayName: "ArangoDB",
    aliases: [],
    defaultPort: 8529,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["arangodb", "arangodb/arangodb", "arangodb/enterprise"],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "prometheus",
      port: 8529,
      path: "/_admin/metrics/v2",
    },
  },
  {
    system: "ravendb",
    displayName: "RavenDB",
    aliases: [],
    defaultPort: 8080,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["ravendb/ravendb"],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no RavenDB receiver; point RavenDB's own OpenTelemetry metrics export at a collector and stamp it with this database's identity.",
    },
  },
  {
    system: "surrealdb",
    displayName: "SurrealDB",
    aliases: [],
    defaultPort: 8000,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["surrealdb/surrealdb"],
    kubernetesChartNames: ["surrealdb"],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no SurrealDB receiver; turn on SurrealDB's OpenTelemetry export (SURREAL_TELEMETRY_PROVIDER=otlp) towards a collector and stamp it with this database's identity.",
    },
  },

  // ---- search ---------------------------------------------------------------
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
      "elasticsearch/elasticsearch-oss",
      "bitnami/elasticsearch",
    ],
    kubernetesChartNames: ["elasticsearch"],
    hasCollectorReceiver: true,
    deployment: "server",
    engineMetrics: RECEIVER,
  },
  {
    system: "opensearch",
    displayName: "OpenSearch",
    aliases: [],
    defaultPort: 9200,
    /*
     * OpenSearch keeps the node, cluster and index statistics APIs the
     * elasticsearch receiver reads.
     */
    receiverTypes: ["elasticsearch"],
    receiverMetricPrefixes: ["elasticsearch."],
    imageRepositories: ["opensearchproject/opensearch", "bitnami/opensearch"],
    kubernetesChartNames: ["opensearch"],
    hasCollectorReceiver: true,
    // Older clients reach it with an Elasticsearch client.
    family: "elasticsearch",
    deployment: "server",
    engineMetrics: RECEIVER,
  },
  {
    system: "solr",
    displayName: "Apache Solr",
    aliases: [],
    defaultPort: 8983,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["solr", "bitnami/solr"],
    kubernetesChartNames: ["solr"],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no Solr receiver; run the Prometheus exporter that ships with Solr (`solr-exporter`), scrape it with the `prometheus` receiver and stamp it with this database's identity.",
    },
  },
  {
    system: "meilisearch",
    displayName: "Meilisearch",
    aliases: [],
    defaultPort: 7700,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["getmeili/meilisearch"],
    kubernetesChartNames: ["meilisearch"],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "prometheus",
      port: 7700,
      path: "/metrics",
      note: "Start Meilisearch with `--experimental-enable-metrics`; the scrape needs the master key as a bearer token.",
    },
  },
  {
    system: "typesense",
    displayName: "Typesense",
    aliases: [],
    defaultPort: 8108,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["typesense/typesense"],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no Typesense receiver and Typesense serves its statistics as JSON (/metrics.json), not in the Prometheus format; convert them and stamp the result with this database's identity.",
    },
  },

  // ---- time series ------------------------------------------------------------
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
    deployment: "server",
    engineMetrics: { kind: "prometheus", port: 8086, path: "/metrics" },
  },

  // ---- graph --------------------------------------------------------------------
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
    deployment: "server",
    engineMetrics: {
      kind: "prometheus",
      port: 2004,
      path: "/metrics",
      note: "Neo4j Enterprise: set `server.metrics.prometheus.enabled=true` and `server.metrics.prometheus.endpoint=0.0.0.0:2004`.",
    },
  },
  {
    system: "aws.neptune",
    displayName: "Amazon Neptune",
    aliases: ["neptune"],
    defaultPort: 8182,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    // A cluster endpoint names one cluster.
    deployment: "server",
    engineMetrics: AWS_CLOUDWATCH_METRICS,
  },

  // ---- vector -------------------------------------------------------------------
  {
    system: "milvus",
    displayName: "Milvus",
    aliases: [],
    defaultPort: 19530,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["milvusdb/milvus", "bitnami/milvus"],
    kubernetesChartNames: ["milvus"],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: { kind: "prometheus", port: 9091, path: "/metrics" },
  },
  {
    system: "qdrant",
    displayName: "Qdrant",
    aliases: [],
    defaultPort: 6333,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["qdrant/qdrant"],
    kubernetesChartNames: ["qdrant"],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: { kind: "prometheus", port: 6333, path: "/metrics" },
  },
  {
    system: "weaviate",
    displayName: "Weaviate",
    aliases: [],
    defaultPort: 8080,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["semitechnologies/weaviate"],
    kubernetesChartNames: ["weaviate"],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "prometheus",
      port: 2112,
      path: "/metrics",
      note: "Set PROMETHEUS_MONITORING_ENABLED=true.",
    },
  },
  {
    system: "chroma",
    displayName: "Chroma",
    aliases: ["chromadb"],
    defaultPort: 8000,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: ["chromadb/chroma", "chroma-core/chroma"],
    kubernetesChartNames: ["chromadb"],
    hasCollectorReceiver: false,
    deployment: "server",
    engineMetrics: {
      kind: "none",
      reason:
        "The collector has no Chroma receiver; Chroma exports OpenTelemetry traces (CHROMA_OTEL_COLLECTION_ENDPOINT) but no engine metrics endpoint.",
    },
  },
  {
    system: "pinecone",
    displayName: "Pinecone",
    aliases: [],
    defaultPort: 443,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    // A managed service reached through Pinecone's shared API hosts.
    deployment: "cloud-api",
    engineMetrics: {
      kind: "none",
      reason:
        "Pinecone publishes index metrics for Prometheus on its own API (Standard and Enterprise plans); scrape them with the `prometheus` receiver and stamp them with this database's identity.",
    },
  },

  // ---- embedded (in-process) ------------------------------------------------------
  {
    system: "sqlite",
    displayName: "SQLite",
    aliases: ["sqlite3"],
    defaultPort: null,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "embedded",
    engineMetrics: EMBEDDED,
  },
  {
    system: "duckdb",
    displayName: "DuckDB",
    aliases: [],
    defaultPort: null,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "embedded",
    engineMetrics: EMBEDDED,
  },
  {
    system: "h2database",
    displayName: "H2",
    aliases: ["h2"],
    // Its TCP server mode; usually it runs in-process.
    defaultPort: 9092,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "embedded",
    engineMetrics: EMBEDDED,
  },
  {
    system: "hsqldb",
    displayName: "HyperSQL",
    aliases: [],
    // Its server mode; usually it runs in-process.
    defaultPort: 9001,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "embedded",
    engineMetrics: EMBEDDED,
  },
  {
    system: "derby",
    displayName: "Apache Derby",
    // IBM Cloudscape became Apache Derby.
    aliases: ["cloudscape"],
    // Its Network Server mode; usually it runs in-process.
    defaultPort: 1527,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "embedded",
    engineMetrics: EMBEDDED,
  },
  {
    system: "instantdb",
    displayName: "InstantDB",
    aliases: [],
    defaultPort: null,
    receiverTypes: [],
    receiverMetricPrefixes: [],
    imageRepositories: [],
    kubernetesChartNames: [],
    hasCollectorReceiver: false,
    deployment: "embedded",
    engineMetrics: EMBEDDED,
  },
];

/*
 * Collector component names that differ from the receiver's Go module name
 * (receiverTypes): the name to write under `receivers:` in a config.
 */
const RECEIVER_COMPONENT_NAMES: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  ["mongodbatlas", "mongodb_atlas"],
  ["googlecloudspanner", "google_cloud_spanner"],
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

/*
 * receiver type → the engine its data REPORTS. Only an engine that is its
 * own family owns a receiver: the mysql receiver pointed at MariaDB still
 * says "mysql" (refineDatabaseSystemFromVersion can tell them apart).
 */
const DESCRIPTOR_BY_RECEIVER_TYPE: ReadonlyMap<
  string,
  DatabaseSystemDescriptor
> = ((): Map<string, DatabaseSystemDescriptor> => {
  const map: Map<string, DatabaseSystemDescriptor> = new Map<
    string,
    DatabaseSystemDescriptor
  >();
  for (const descriptor of DATABASE_SYSTEMS) {
    if (descriptor.family) {
      continue;
    }
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
 * The engine family a system belongs to: the `family` of a fork or drop-in
 * ("valkey" → "redis", "mariadb" → "mysql"), the system itself for an engine
 * that is its own family, and the canonicalized raw value for an unknown one.
 * Aliases are accepted. Empty or non-string input is null.
 */
export function getDatabaseSystemFamily(system: unknown): string | null {
  const descriptor: DatabaseSystemDescriptor | null =
    getDatabaseSystemDescriptor(system);
  if (descriptor) {
    return descriptor.family || descriptor.system;
  }
  const canonical: string = canonicalRaw(system);
  return canonical || null;
}

/**
 * The engine whose collector receiver produces this engine's metrics — so
 * whose curated metric set applies: the family for a fork its family's
 * receiver monitors (MariaDB → "mysql", Valkey → "redis"), otherwise the
 * engine itself (TiDB stays "tidb": the mysql receiver does not work
 * against it). Aliases accepted; an unknown value is returned
 * canonicalized; empty or non-string input is null.
 */
export function getDatabaseSystemMetricsEngine(system: unknown): string | null {
  const descriptor: DatabaseSystemDescriptor | null =
    getDatabaseSystemDescriptor(system);
  if (descriptor && descriptor.family && descriptor.receiverTypes.length > 0) {
    return descriptor.family;
  }
  return normalizeDatabaseSystem(system);
}

/**
 * True when two engine values describe the same family — the same engine,
 * aliases of it, or a fork and the engine it forks. A span that says "redis"
 * and an image that says "valkey" are the same database seen twice.
 */
export function isSameDatabaseFamily(a: unknown, b: unknown): boolean {
  const familyA: string | null = getDatabaseSystemFamily(a);
  return familyA !== null && familyA === getDatabaseSystemFamily(b);
}

/**
 * The engine a database should show after a new sighting of it, given the
 * engine it shows now. A sighting that names a fork of the current engine
 * refines it ("mysql" seen by an image as "mariadb" becomes MariaDB); a
 * sighting that names only the family never undoes a fork ("mariadb" stays
 * MariaDB when a span says "mysql" — the client cannot tell). Anything else
 * — an unrelated engine, an unknown or empty value — keeps the current one,
 * except that an empty current engine takes the observed one. Both inputs
 * are normalized; the result is null only when both are empty.
 */
export function getMoreSpecificDatabaseSystem(
  current: unknown,
  observed: unknown,
): string | null {
  const currentSystem: string | null = normalizeDatabaseSystem(current);
  const observedSystem: string | null = normalizeDatabaseSystem(observed);

  if (!currentSystem) {
    return observedSystem;
  }
  if (!observedSystem || observedSystem === currentSystem) {
    return currentSystem;
  }

  const currentDescriptor: DatabaseSystemDescriptor | null =
    getDatabaseSystemDescriptor(currentSystem);
  const observedDescriptor: DatabaseSystemDescriptor | null =
    getDatabaseSystemDescriptor(observedSystem);

  // Only a known fork of the current (family) engine is more specific.
  if (
    observedDescriptor &&
    observedDescriptor.family &&
    observedDescriptor.family === currentSystem &&
    (!currentDescriptor || !currentDescriptor.family)
  ) {
    return observedSystem;
  }

  return currentSystem;
}

// The leading number of a version string: "11.4.13" → 11. At most four digits.
const VERSION_MAJOR_PATTERN: RegExp = /^\s*v?(\d{1,4})(?!\d)/i;

function readVersionMajor(version: string): number | null {
  const match: RegExpExecArray | null = VERSION_MAJOR_PATTERN.exec(version);
  return match ? Number(match[1]) : null;
}

/**
 * The engine a server's own version string names, given the engine the
 * data reports: "mysql" + "10.11.7-MariaDB-1:10.11.7+maria~ubu2204" →
 * "mariadb", "mysql" + "8.0.11-TiDB-v7.5.1" → "tidb". A fork's name in the
 * string wins (versionPattern); otherwise a major version the family never
 * released names the fork that did (versionMajorFrom): "mysql" + "11.4.13"
 * → "mariadb", since MySQL has no 10.x or 11.x — which is how a collector's
 * `mysql` receiver pointed at MariaDB is told apart, as it reports only
 * that bare number. A version that names no fork of the engine's family
 * (or no version at all) keeps the engine, normalized; so does a MariaDB
 * older than 10 whose version has lost its "-MariaDB" suffix ("5.5.68").
 * Null only for an empty engine.
 */
export function refineDatabaseSystemFromVersion(
  system: unknown,
  version: unknown,
): string | null {
  const normalized: string | null = normalizeDatabaseSystem(system);
  if (!normalized || typeof version !== "string" || !version.trim()) {
    return normalized;
  }

  const family: string | null = getDatabaseSystemFamily(normalized);
  const descriptor: DatabaseSystemDescriptor | null =
    getDatabaseSystemDescriptor(normalized);
  // A fork already names itself; only a family value is refined.
  if (descriptor && descriptor.family) {
    return normalized;
  }

  // Bounded: a version is a short string, never a document.
  const sample: string = version.substring(0, 256);
  for (const candidate of DATABASE_SYSTEMS) {
    if (
      candidate.family === family &&
      candidate.versionPattern &&
      candidate.versionPattern.test(sample)
    ) {
      return candidate.system;
    }
  }

  const major: number | null = readVersionMajor(sample);
  if (major !== null) {
    for (const candidate of DATABASE_SYSTEMS) {
      if (
        candidate.family === family &&
        typeof candidate.versionMajorFrom === "number" &&
        major >= candidate.versionMajorFrom
      ) {
        return candidate.system;
      }
    }
  }

  return normalized;
}

/**
 * Whether a resource attribute holding a version is NOT this engine's own
 * version but the one of the engine it stays compatible with (see
 * DatabaseSystemDescriptor.compatibilityVersionAttributes): true for
 * `redis.version` on Valkey, whose INFO keeps `redis_version` at 7.2.4.
 * Aliases accepted; `attributeKey` is the flat resource key, with or
 * without the stored `resource.` prefix.
 */
export function isCompatibilityVersionAttribute(
  system: unknown,
  attributeKey: string,
): boolean {
  const descriptor: DatabaseSystemDescriptor | null =
    getDatabaseSystemDescriptor(system);
  if (!descriptor || !descriptor.compatibilityVersionAttributes) {
    return false;
  }
  const key: string =
    typeof attributeKey === "string"
      ? attributeKey.trim().replace(/^resource\./, "")
      : "";
  return descriptor.compatibilityVersionAttributes.includes(key);
}

/**
 * True when a client-span-discovered endpoint of this engine may create a
 * DatabaseServer row on its own: the engine is known and is a server with
 * its own address (see DatabaseDeployment) — not a cloud API whose host
 * every customer shares, and not an in-process library.
 */
export function isAutoCreatableDatabaseSystem(system: unknown): boolean {
  const descriptor: DatabaseSystemDescriptor | null =
    getDatabaseSystemDescriptor(system);
  return descriptor !== null && descriptor.deployment === "server";
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

/**
 * Where an engine's own metrics come from (aliases accepted). An unknown
 * engine has no known path — `none` — which is not the same as `embedded`:
 * only an in-process engine truly has nothing to collect from, so only it
 * may be described as having no engine metrics.
 */
export function getDatabaseEngineMetricsSource(
  system: unknown,
): DatabaseEngineMetricsSource {
  const descriptor: DatabaseSystemDescriptor | null =
    getDatabaseSystemDescriptor(system);
  if (descriptor) {
    return descriptor.engineMetrics;
  }
  return {
    kind: "none",
    reason:
      "OneUptime does not know this engine; stamp whatever exports its metrics with the database's identity.",
  };
}

/**
 * The name a receiver is configured under in a collector config
 * (`receivers:` key) for a receiver type from `receiverTypes`:
 * "googlecloudspanner" → "google_cloud_spanner". Most are the same.
 */
export function getCollectorReceiverComponentName(
  receiverType: string,
): string {
  return RECEIVER_COMPONENT_NAMES.get(receiverType) || receiverType;
}

const RECEIVER_SUFFIX: string = "receiver";

/**
 * The engine a collector-contrib DB receiver reports, from its
 * instrumentation scope name. Matches the LAST path segment against
 * `<type>receiver`, so both the current Go-module form
 * (`github.com/open-telemetry/opentelemetry-collector-contrib/receiver/postgresqlreceiver`)
 * and the legacy `otelcol/postgresqlreceiver` form are recognised. A
 * receiver that also monitors forks reports its family ("mysql" for the
 * mysql receiver, whether it scrapes MySQL or MariaDB). Anything else (an
 * SDK scope, a non-DB receiver) is null.
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
