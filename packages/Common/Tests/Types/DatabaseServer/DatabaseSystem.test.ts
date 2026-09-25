import {
  DATABASE_SYSTEMS,
  DatabaseSystemDescriptor,
  getCollectorReceiverComponentName,
  getDatabaseReceiverSystemHint,
  getDatabaseSystemDescriptor,
  getDatabaseSystemDisplayName,
  getDatabaseSystemFamily,
  getDatabaseSystemFromReceiverScopeName,
  getDatabaseSystemMetricsEngine,
  getDatabaseEngineMetricsSource,
  getDefaultDatabasePort,
  getMoreSpecificDatabaseSystem,
  isAutoCreatableDatabaseSystem,
  isCompatibilityVersionAttribute,
  isKnownDatabaseSystem,
  isSameDatabaseFamily,
  normalizeDatabaseSystem,
  refineDatabaseSystemFromVersion,
  trimTrailingCharacter,
} from "../../../Types/DatabaseServer/DatabaseSystem";
import {
  classifyImage,
  ImageClassification,
} from "../../../Types/DatabaseServer/DatabaseContainerClassifier";
import { describe, expect, test } from "@jest/globals";

const CONTRIB_PREFIX: string =
  "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/";

/*
 * The semconv registry's well-known `db.system.name` values
 * (model/db/registry.yaml), and the values of the deprecated `db.system`
 * attribute it replaced (model/db/deprecated/registry-deprecated.yaml).
 * Every one of them is what some instrumentation puts on a span, so each
 * must land on a catalog engine — or be one of the deliberate exceptions
 * below.
 */
const SEMCONV_DB_SYSTEM_NAMES: ReadonlyArray<string> = [
  "other_sql",
  "softwareag.adabas",
  "actian.ingres",
  "aws.dynamodb",
  "aws.redshift",
  "azure.cosmosdb",
  "intersystems.cache",
  "cassandra",
  "clickhouse",
  "cockroachdb",
  "couchbase",
  "couchdb",
  "derby",
  "elasticsearch",
  "firebirdsql",
  "gcp.spanner",
  "geode",
  "h2database",
  "hbase",
  "hive",
  "hsqldb",
  "ibm.db2",
  "ibm.informix",
  "ibm.netezza",
  "influxdb",
  "instantdb",
  "mariadb",
  "memcached",
  "mongodb",
  "microsoft.sql_server",
  "mysql",
  "neo4j",
  "opensearch",
  "oracle.db",
  "postgresql",
  "redis",
  "sap.hana",
  "sap.maxdb",
  "sqlite",
  "teradata",
  "trino",
];

const SEMCONV_DEPRECATED_DB_SYSTEMS: ReadonlyArray<string> = [
  "other_sql",
  "adabas",
  "cache",
  "intersystems_cache",
  "cassandra",
  "clickhouse",
  "cloudscape",
  "cockroachdb",
  "coldfusion",
  "cosmosdb",
  "couchbase",
  "couchdb",
  "db2",
  "derby",
  "dynamodb",
  "edb",
  "elasticsearch",
  "filemaker",
  "firebird",
  "firstsql",
  "geode",
  "h2",
  "hanadb",
  "hbase",
  "hive",
  "hsqldb",
  "influxdb",
  "informix",
  "ingres",
  "instantdb",
  "interbase",
  "mariadb",
  "maxdb",
  "memcached",
  "mongodb",
  "mssql",
  "mssqlcompact",
  "mysql",
  "neo4j",
  "netezza",
  "opensearch",
  "oracle",
  "pervasive",
  "pointbase",
  "postgresql",
  "progress",
  "redis",
  "redshift",
  "spanner",
  "sqlite",
  "sybase",
  "teradata",
  "trino",
  "vertica",
];

/*
 * Values that deliberately stay unknown (normalized to themselves, never
 * shown as an engine they are not):
 *   - other_sql: "some SQL database the instrumentation could not name";
 *   - coldfusion: a web application server, not a database;
 *   - firstsql, pointbase: products discontinued two decades ago;
 *   - mssqlcompact: SQL Server Compact, an in-process library Microsoft
 *     retired in 2016 — never SQL Server itself.
 */
const DELIBERATELY_UNKNOWN: ReadonlyArray<string> = [
  "other_sql",
  "coldfusion",
  "firstsql",
  "pointbase",
  "mssqlcompact",
];

/*
 * The receivers of the collector the Database Agent pins
 * (`otel/opentelemetry-collector-contrib:0.161.0 components`). Every
 * receiver the catalog names must exist there under that name.
 */
const PINNED_COLLECTOR_RECEIVERS: ReadonlySet<string> = new Set<string>([
  "active_directory_ds",
  "aerospike",
  "apache",
  "apache_spark",
  "aws_cloudwatch",
  "aws_lambda",
  "awscontainerinsightreceiver",
  "awsecscontainermetrics",
  "awsfirehose",
  "awss3",
  "awsxray",
  "azure_blob",
  "azure_event_hub",
  "azure_monitor",
  "carbon",
  "chrony",
  "cisco_os",
  "cloud_foundry",
  "cloudflare",
  "collectd",
  "couchdb",
  "datadog",
  "docker_stats",
  "elasticsearch",
  "envoy_als",
  "expvar",
  "faro",
  "file_log",
  "file_stats",
  "flink_metrics",
  "fluent_forward",
  "github",
  "gitlab",
  "google_cloud_spanner",
  "googlecloudmonitoring",
  "googlecloudpubsub",
  "haproxy",
  "host_metrics",
  "http_check",
  "icmp_check",
  "iis",
  "influxdb",
  "jaeger",
  "journald",
  "k8s_cluster",
  "k8s_events",
  "k8s_objects",
  "kafka",
  "kafka_metrics",
  "kubelet_stats",
  "libhoney",
  "loki",
  "macos_unified_logging",
  "memcached",
  "mongodb",
  "mongodb_atlas",
  "mysql",
  "named_pipe",
  "netflow",
  "nginx",
  "nop",
  "nsxt",
  "ntp",
  "obi",
  "oracledb",
  "otelarrow",
  "otlp",
  "otlp_json_file",
  "podman_stats",
  "postgresql",
  "pprof",
  "prometheus",
  "prometheus_remote_write",
  "prometheus_simple",
  "pulsar",
  "purefa",
  "purefb",
  "rabbitmq",
  "receiver_creator",
  "redis",
  "riak",
  "saphana",
  "skywalking",
  "snmp",
  "snowflake",
  "solace",
  "splunk_enterprise",
  "splunk_hec",
  "sql_query",
  "sqlserver",
  "ssh_check",
  "statsd",
  "stef",
  "syslog",
  "systemd",
  "tcp_check",
  "tcp_log",
  "tls_check",
  "udp_log",
  "vcenter",
  "wavefront",
  "webhook_event",
  "windows_event_log",
  "windows_perf_counters",
  "windows_service",
  "yang_grpc",
  "zipkin",
  "zookeeper",
]);

function descriptorOf(system: string): DatabaseSystemDescriptor {
  const descriptor: DatabaseSystemDescriptor | null =
    getDatabaseSystemDescriptor(system);
  expect({ system, known: descriptor !== null }).toEqual({
    system,
    known: true,
  });
  return descriptor as DatabaseSystemDescriptor;
}

function isForkOf(descriptor: DatabaseSystemDescriptor): boolean {
  return Boolean(descriptor.family);
}

describe("DATABASE_SYSTEMS registry integrity", () => {
  test("covers the widely used engines (a floor, so an entry is never dropped by accident)", () => {
    expect(DATABASE_SYSTEMS.length).toBeGreaterThanOrEqual(80);
  });

  test("systems are unique, lowercase and trimmed", () => {
    const systems: Array<string> = DATABASE_SYSTEMS.map(
      (descriptor: DatabaseSystemDescriptor): string => {
        return descriptor.system;
      },
    );
    expect(new Set(systems).size).toBe(systems.length);
    for (const system of systems) {
      expect(system).toBe(system.trim().toLowerCase());
      expect(system).toMatch(/^[a-z0-9][a-z0-9._]*$/);
    }
  });

  test("display names are non-empty and unique", () => {
    const names: Array<string> = DATABASE_SYSTEMS.map(
      (descriptor: DatabaseSystemDescriptor): string => {
        return descriptor.displayName;
      },
    );
    for (const name of names) {
      expect(name.trim().length).toBeGreaterThan(0);
      expect(name).toBe(name.trim());
    }
    expect(new Set(names).size).toBe(names.length);
  });

  test("no alias is claimed by two engines or shadows a system", () => {
    const owners: Map<string, string> = new Map<string, string>();
    for (const descriptor of DATABASE_SYSTEMS) {
      owners.set(descriptor.system, descriptor.system);
    }
    for (const descriptor of DATABASE_SYSTEMS) {
      for (const alias of descriptor.aliases) {
        expect(alias).toBe(alias.trim().toLowerCase());
        expect({ alias, claimedBy: owners.get(alias) }).toEqual({
          alias,
          claimedBy: undefined,
        });
        owners.set(alias, descriptor.system);
      }
    }
  });

  test("every family is a known engine that is its own family (no chains, no self-reference)", () => {
    for (const descriptor of DATABASE_SYSTEMS) {
      if (!descriptor.family) {
        continue;
      }
      const family: DatabaseSystemDescriptor = descriptorOf(descriptor.family);
      expect({
        system: descriptor.system,
        family: descriptor.family,
        canonical: family.system,
        chained: Boolean(family.family),
      }).toEqual({
        system: descriptor.system,
        family: descriptor.family,
        canonical: descriptor.family,
        chained: false,
      });
      expect(descriptor.family).not.toBe(descriptor.system);
    }
  });

  test("every receiver type is owned by exactly one engine that is its own family", () => {
    const owners: Map<string, string> = new Map<string, string>();
    for (const descriptor of DATABASE_SYSTEMS) {
      if (isForkOf(descriptor)) {
        continue;
      }
      for (const receiverType of descriptor.receiverTypes) {
        expect({ receiverType, owner: owners.get(receiverType) }).toEqual({
          receiverType,
          owner: undefined,
        });
        owners.set(receiverType, descriptor.system);
      }
    }
    // Everything a fork lists belongs to its own family's engine.
    for (const descriptor of DATABASE_SYSTEMS) {
      if (!isForkOf(descriptor)) {
        continue;
      }
      for (const receiverType of descriptor.receiverTypes) {
        expect({
          fork: descriptor.system,
          receiverType,
          owner: owners.get(receiverType),
        }).toEqual({
          fork: descriptor.system,
          receiverType,
          owner: descriptor.family,
        });
      }
      const family: DatabaseSystemDescriptor = descriptorOf(
        descriptor.family as string,
      );
      for (const prefix of descriptor.receiverMetricPrefixes) {
        expect(family.receiverMetricPrefixes).toContain(prefix);
      }
    }
  });

  test("hasCollectorReceiver agrees with receiverTypes, prefixes and engineMetrics", () => {
    for (const descriptor of DATABASE_SYSTEMS) {
      const context: { system: string } = { system: descriptor.system };
      expect({
        ...context,
        has: descriptor.hasCollectorReceiver,
      }).toEqual({ ...context, has: descriptor.receiverTypes.length > 0 });
      expect({
        ...context,
        prefixes: descriptor.receiverMetricPrefixes.length > 0,
      }).toEqual({ ...context, prefixes: descriptor.hasCollectorReceiver });
      expect({
        ...context,
        receiverKind: descriptor.engineMetrics.kind === "receiver",
      }).toEqual({ ...context, receiverKind: descriptor.hasCollectorReceiver });
      for (const prefix of descriptor.receiverMetricPrefixes) {
        // Stored metric names are lowercased at ingest.
        expect(prefix).toBe(prefix.toLowerCase());
        // A whole name segment: `redis.` never matches `redisearch_…`.
        expect(prefix.endsWith(".") || prefix.endsWith("/")).toBe(true);
      }
    }
  });

  test("every receiver is configured under a name the pinned collector ships", () => {
    for (const descriptor of DATABASE_SYSTEMS) {
      for (const receiverType of descriptor.receiverTypes) {
        const component: string =
          getCollectorReceiverComponentName(receiverType);
        expect({
          receiverType,
          component,
          shipped: PINNED_COLLECTOR_RECEIVERS.has(component),
        }).toEqual({ receiverType, component, shipped: true });
      }
      if (descriptor.engineMetrics.kind === "cloud-monitoring") {
        expect(
          PINNED_COLLECTOR_RECEIVERS.has(descriptor.engineMetrics.receiver),
        ).toBe(true);
      }
    }
    // The Prometheus recipes run the pinned prometheus receiver.
    expect(PINNED_COLLECTOR_RECEIVERS.has("prometheus")).toBe(true);
  });

  test("engineMetrics recipes are complete", () => {
    for (const descriptor of DATABASE_SYSTEMS) {
      const source: DatabaseSystemDescriptor["engineMetrics"] =
        descriptor.engineMetrics;
      // Only an in-process engine has nothing to collect from.
      expect({
        system: descriptor.system,
        embedded: source.kind === "embedded",
      }).toEqual({
        system: descriptor.system,
        embedded: descriptor.deployment === "embedded",
      });
      if (source.kind === "prometheus") {
        expect(Number.isInteger(source.port)).toBe(true);
        expect(source.port).toBeGreaterThanOrEqual(1);
        expect(source.port).toBeLessThanOrEqual(65535);
        expect(source.path.startsWith("/")).toBe(true);
        expect(source.path).not.toMatch(/\s/);
      }
      if (source.kind === "none" || source.kind === "cloud-monitoring") {
        const text: string =
          source.kind === "none" ? source.reason : source.note;
        expect(text.trim().length).toBeGreaterThan(20);
        expect(text.endsWith(".")).toBe(true);
      }
    }
  });

  test("a versionPattern is only on a fork, and it names the fork", () => {
    for (const descriptor of DATABASE_SYSTEMS) {
      if (descriptor.versionPattern) {
        expect({
          system: descriptor.system,
          fork: isForkOf(descriptor),
        }).toEqual({ system: descriptor.system, fork: true });
        expect(descriptor.versionPattern.global).toBe(false);
        expect(descriptor.versionPattern.sticky).toBe(false);
      }
    }
  });

  /*
   * A major version names a fork only when its family never released it:
   * MySQL's releases stop at 9.x, so only MariaDB — 10.x, 11.x, 12.x — may
   * claim the majors from 10 on, and only one fork of a family may claim
   * them.
   */
  test("a versionMajorFrom is only on a fork, above every release of its family", () => {
    const claimedFamilies: Array<string> = [];
    for (const descriptor of DATABASE_SYSTEMS) {
      if (descriptor.versionMajorFrom === undefined) {
        continue;
      }
      expect({
        system: descriptor.system,
        fork: isForkOf(descriptor),
      }).toEqual({ system: descriptor.system, fork: true });
      expect(Number.isInteger(descriptor.versionMajorFrom)).toBe(true);
      expect(descriptor.versionMajorFrom).toBeGreaterThanOrEqual(10);
      claimedFamilies.push(descriptor.family!);
    }
    expect(claimedFamilies).toEqual(["mysql"]);
    expect(getDatabaseSystemDescriptor("mariadb")?.versionMajorFrom).toBe(10);
  });

  test("a compatibility version attribute is only on a fork, and is its receiver's version attribute", () => {
    for (const descriptor of DATABASE_SYSTEMS) {
      for (const key of descriptor.compatibilityVersionAttributes || []) {
        expect({
          system: descriptor.system,
          fork: isForkOf(descriptor),
        }).toEqual({ system: descriptor.system, fork: true });
        expect(key).toBe(`${descriptor.receiverTypes[0]}.version`);
      }
    }
  });

  test("image repositories are canonical, and no repository or chart name is claimed by two engines", () => {
    const images: Map<string, string> = new Map<string, string>();
    const charts: Map<string, string> = new Map<string, string>();
    for (const descriptor of DATABASE_SYSTEMS) {
      for (const image of descriptor.imageRepositories) {
        expect(image).toMatch(/^[a-z0-9._-]+(?:\/[a-z0-9._-]+)*$/);
        /*
         * Canonical form: the registry host and `library/` are stripped
         * before matching, so an entry must not carry them.
         */
        expect(image.split("/")[0]).not.toMatch(/[.:]/);
        expect(image.startsWith("library/")).toBe(false);
        expect({ image, claimedBy: images.get(image) }).toEqual({
          image,
          claimedBy: undefined,
        });
        images.set(image, descriptor.system);
      }
      for (const chart of descriptor.kubernetesChartNames) {
        expect(chart).toBe(chart.toLowerCase());
        expect({ chart, claimedBy: charts.get(chart) }).toEqual({
          chart,
          claimedBy: undefined,
        });
        charts.set(chart, descriptor.system);
      }
    }
  });

  test("every image repository classifies as its own engine, with or without a registry and tag", () => {
    for (const descriptor of DATABASE_SYSTEMS) {
      for (const image of descriptor.imageRepositories) {
        for (const reference of [
          image,
          `${image}:1.2.3`,
          `registry.example.com/${image}:latest`,
        ]) {
          const classification: ImageClassification = classifyImage(reference);
          expect({ reference, classification }).toEqual({
            reference,
            classification: { kind: "database", system: descriptor.system },
          });
        }
      }
    }
  });

  /*
   * Regression (image coverage): these references came out "unknown", so a
   * Docker / Podman / OpenShift database running them never appeared —
   * Bitnami's 2025 bitnamilegacy / bitnamisecure registries, Red Hat
   * Software Collections images, and the official images of catalog
   * engines that listed none. The catalog lists each engine's repositories
   * canonically; the classifier folds the relocated and versioned names
   * onto them.
   */
  test.each([
    ["docker.io/bitnamilegacy/mongodb:7.0.14", "mongodb"],
    ["bitnamisecure/mongodb:7.0", "mongodb"],
    ["bitnamilegacy/redis-cluster:7.2", "redis"],
    ["bitnamilegacy/valkey:8.0", "valkey"],
    ["bitnamilegacy/mariadb-galera:11.4", "mariadb"],
    ["bitnamilegacy/postgresql-repmgr:16", "postgresql"],
    ["bitnamilegacy/clickhouse:24.8", "clickhouse"],
    ["bitnamilegacy/opensearch:2.17", "opensearch"],
    ["bitnamilegacy/mongodb-sharded:7.0", "mongodb"],
    ["registry.redhat.io/rhel9/postgresql-16", "postgresql"],
    ["quay.io/fedora/postgresql-16", "postgresql"],
    ["registry.redhat.io/rhel9/mysql-80", "mysql"],
    ["registry.redhat.io/rhel9/mariadb-1011", "mariadb"],
    ["registry.redhat.io/rhel9/redis-7", "redis"],
    ["registry.redhat.io/rhel10/valkey-8", "valkey"],
    ["citusdata/citus:12.1", "postgresql"],
    ["icr.io/db2_community/db2", "ibm.db2"],
    ["ibmcom/db2:11.5", "ibm.db2"],
    ["saplabs/hanaexpress:2.00.072", "sap.hana"],
    ["firebirdsql/firebird:5", "firebirdsql"],
    ["jacobalberty/firebird:v4.0", "firebirdsql"],
    ["trinodb/trino:450", "trino"],
    ["mariadb:11.4", "mariadb"],
    ["valkey/valkey:8", "valkey"],
    ["docker.dragonflydb.io/dragonflydb/dragonfly:v1.21.0", "dragonfly"],
    ["scylladb/scylla:2025.1", "scylladb"],
    ["pingcap/tidb:v7.5.0", "tidb"],
    ["yugabytedb/yugabyte:2.20", "yugabytedb"],
    ["quay.io/coreos/etcd:v3.5.15", "etcd"],
    ["qdrant/qdrant:v1.12.0", "qdrant"],
    [
      "docker.elastic.co/elasticsearch/elasticsearch-oss:7.10.2",
      "elasticsearch",
    ],
    ["quay.io/mongodb/mongodb-enterprise-database-ubi:2.0", "mongodb"],
  ])("%s is %s", (image: string, system: string) => {
    expect(classifyImage(image)).toEqual({ kind: "database", system });
  });

  /*
   * Regression (Software Collections basenames): the classifier reduces a
   * Red Hat / CentOS / sclorg image name to the engine's bare basename
   * (`centos/mongodb-36-centos7` → `centos/mongodb`,
   * `quay.io/sclorg/valkey-8-c10s` → `sclorg/valkey`), so an engine is only
   * recognised there when its catalog entry lists that bare basename.
   * MongoDB listed only `mongo` and namespaced repositories, so every
   * CentOS / sclorg MongoDB container came out "unknown" and never became
   * a database.
   */
  test.each([
    ["centos/mongodb-36-centos7", "mongodb"],
    ["docker.io/centos/mongodb-36-centos7:latest", "mongodb"],
    ["registry.access.redhat.com/rhscl/mongodb-36-rhel7:1-60", "mongodb"],
    ["quay.io/sclorg/mongodb-36-c8s", "mongodb"],
    ["quay.io/sclorg/valkey-8-c10s", "valkey"],
    ["registry.redhat.io/rhel10/valkey-8:10.0", "valkey"],
    ["quay.io/fedora/valkey-8", "valkey"],
    ["quay.io/sclorg/postgresql-16-c9s", "postgresql"],
    ["quay.io/sclorg/mariadb-1011-c9s", "mariadb"],
    ["quay.io/sclorg/redis-7-c9s", "redis"],
    ["registry.redhat.io/rhel9/memcached:1-80", "memcached"],
  ])(
    "the Software Collections image %s is %s",
    (image: string, system: string) => {
      expect(classifyImage(image)).toEqual({ kind: "database", system });
    },
  );

  test("each engine a Software Collections image is published for lists its bare basename", () => {
    // The engines Red Hat, CentOS and sclorg publish as `<engine>-<version>`.
    for (const system of [
      "postgresql",
      "mysql",
      "mariadb",
      "redis",
      "valkey",
      "mongodb",
      "memcached",
    ]) {
      const descriptor: DatabaseSystemDescriptor | null =
        getDatabaseSystemDescriptor(system);

      expect({
        system,
        listsBasename: descriptor?.imageRepositories.includes(system),
      }).toEqual({ system, listsBasename: true });
    }
  });

  /*
   * Not a basename that means MongoDB: the exporters, operators and admin
   * UIs built around it keep their own names, so the bare entry does not
   * pull them in.
   */
  test.each([
    "percona/mongodb_exporter:0.40",
    "bitnami/mongodb-exporter:0.40",
    "mongodb/mongodb-kubernetes-operator:0.9.0",
    "mongo-express:1.0",
  ])("%s is not a MongoDB database", (image: string) => {
    expect(classifyImage(image)).not.toEqual({
      kind: "database",
      system: "mongodb",
    });
  });

  test("the control plane's own etcd is not a database of the project", () => {
    // Only the etcd distributions people run as a database are listed.
    expect(classifyImage("registry.k8s.io/etcd:3.5.15-0")).not.toEqual({
      kind: "database",
      system: "etcd",
    });
  });

  test("engines with no container of their own list no images or charts", () => {
    for (const descriptor of DATABASE_SYSTEMS) {
      if (descriptor.deployment !== "server") {
        expect({
          system: descriptor.system,
          images: descriptor.imageRepositories,
          charts: descriptor.kubernetesChartNames,
        }).toEqual({
          system: descriptor.system,
          images: [],
          charts: [],
        });
      }
    }
  });

  test("default ports are valid TCP ports or null", () => {
    for (const descriptor of DATABASE_SYSTEMS) {
      if (descriptor.defaultPort !== null) {
        expect(Number.isInteger(descriptor.defaultPort)).toBe(true);
        expect(descriptor.defaultPort).toBeGreaterThanOrEqual(1);
        expect(descriptor.defaultPort).toBeLessThanOrEqual(65535);
      }
    }
  });

  test("a cloud API is reached over HTTPS, so its default port is 443", () => {
    for (const descriptor of DATABASE_SYSTEMS) {
      if (descriptor.deployment === "cloud-api") {
        expect({
          system: descriptor.system,
          port: descriptor.defaultPort,
        }).toEqual({ system: descriptor.system, port: 443 });
      }
    }
  });
});

describe("semconv coverage", () => {
  test.each(
    SEMCONV_DB_SYSTEM_NAMES.filter((value: string): boolean => {
      return !DELIBERATELY_UNKNOWN.includes(value);
    }),
  )(
    "the stable db.system.name value %s is a catalog engine",
    (value: string) => {
      expect(isKnownDatabaseSystem(value)).toBe(true);
      // A stable value is the engine's own `system`, never an alias of another.
      expect(normalizeDatabaseSystem(value)).toBe(value);
    },
  );

  test.each(
    SEMCONV_DEPRECATED_DB_SYSTEMS.filter((value: string): boolean => {
      return !DELIBERATELY_UNKNOWN.includes(value);
    }),
  )(
    "the deprecated db.system value %s lands on a catalog engine",
    (value: string) => {
      expect(isKnownDatabaseSystem(value)).toBe(true);
    },
  );

  test.each([...DELIBERATELY_UNKNOWN])(
    "%s deliberately stays unknown and is never created from traces",
    (value: string) => {
      expect(isKnownDatabaseSystem(value)).toBe(false);
      expect(normalizeDatabaseSystem(value)).toBe(value);
      expect(isAutoCreatableDatabaseSystem(value)).toBe(false);
    },
  );

  test("the deprecated values rename to their stable successors", () => {
    const renames: Record<string, string> = {
      adabas: "softwareag.adabas",
      cache: "intersystems.cache",
      intersystems_cache: "intersystems.cache",
      cosmosdb: "azure.cosmosdb",
      db2: "ibm.db2",
      dynamodb: "aws.dynamodb",
      firebird: "firebirdsql",
      h2: "h2database",
      hanadb: "sap.hana",
      informix: "ibm.informix",
      ingres: "actian.ingres",
      maxdb: "sap.maxdb",
      mssql: "microsoft.sql_server",
      netezza: "ibm.netezza",
      oracle: "oracle.db",
      redshift: "aws.redshift",
      spanner: "gcp.spanner",
      // Predecessors and distributions.
      cloudscape: "derby",
      edb: "postgresql",
      // No stable successor: the legacy value is the engine.
      vertica: "vertica",
      sybase: "sybase",
      progress: "progress",
      pervasive: "pervasive",
      filemaker: "filemaker",
      interbase: "interbase",
    };
    for (const [legacy, stable] of Object.entries(renames)) {
      expect({ legacy, system: normalizeDatabaseSystem(legacy) }).toEqual({
        legacy,
        system: stable,
      });
    }
  });
});

describe("normalizeDatabaseSystem", () => {
  test.each([
    ["postgresql", "postgresql"],
    ["postgres", "postgresql"],
    ["pg", "postgresql"],
    ["pgsql", "postgresql"],
    ["edb", "postgresql"],
    ["percona", "mysql"],
    ["mssql", "microsoft.sql_server"],
    ["sqlserver", "microsoft.sql_server"],
    ["sql_server", "microsoft.sql_server"],
    ["microsoft.sql_server", "microsoft.sql_server"],
    ["oracle", "oracle.db"],
    ["oracledb", "oracle.db"],
    ["mongo", "mongodb"],
    ["elastic", "elasticsearch"],
    ["cockroach", "cockroachdb"],
    ["saphana", "sap.hana"],
    ["yugabyte", "yugabytedb"],
    ["memsql", "singlestore"],
    ["documentdb", "aws.documentdb"],
    ["neptune", "aws.neptune"],
    ["gcp.bigquery", "bigquery"],
    ["firestore", "gcp.firestore"],
    ["bigtable", "gcp.bigtable"],
    ["chromadb", "chroma"],
    ["sqlite3", "sqlite"],
    ["sap.ase", "sybase"],
    // The semconv legacy → stable renames.
    ["db2", "ibm.db2"],
    ["hanadb", "sap.hana"],
    ["h2", "h2database"],
    ["firebird", "firebirdsql"],
    ["redshift", "aws.redshift"],
    ["cosmosdb", "azure.cosmosdb"],
    ["dynamodb", "aws.dynamodb"],
    ["spanner", "gcp.spanner"],
  ])("%s → %s", (raw: string, system: string) => {
    expect(normalizeDatabaseSystem(raw)).toBe(system);
  });

  /*
   * Regression: forks used to be folded into the engine they fork, so a
   * MariaDB 11.4 read "MySQL 11.4", Dragonfly 1.21 read "Redis 1.21.0" and
   * a `^MariaDB` owner rule never matched.
   */
  test.each([
    ["mariadb", "mariadb", "MariaDB", "mysql"],
    ["valkey", "valkey", "Valkey", "redis"],
    ["keydb", "keydb", "KeyDB", "redis"],
    ["dragonfly", "dragonfly", "Dragonfly", "redis"],
    ["dragonflydb", "dragonfly", "Dragonfly", "redis"],
    ["scylladb", "scylladb", "ScyllaDB", "cassandra"],
    ["scylla", "scylladb", "ScyllaDB", "cassandra"],
    ["tidb", "tidb", "TiDB", "mysql"],
    ["opensearch", "opensearch", "OpenSearch", "elasticsearch"],
  ])(
    "the fork %s is its own engine %s (%s), in the %s family",
    (raw: string, system: string, display: string, family: string) => {
      expect(normalizeDatabaseSystem(raw)).toBe(system);
      expect(getDatabaseSystemDisplayName(raw)).toBe(display);
      expect(getDatabaseSystemFamily(raw)).toBe(family);
    },
  );

  test("casing and whitespace do not matter", () => {
    expect(normalizeDatabaseSystem("  PostgreSQL ")).toBe("postgresql");
    expect(normalizeDatabaseSystem("MSSQL")).toBe("microsoft.sql_server");
    expect(normalizeDatabaseSystem(" MariaDB ")).toBe("mariadb");
  });

  test("an unknown non-empty value is returned canonicalized", () => {
    expect(normalizeDatabaseSystem("  AcmeDB ")).toBe("acmedb");
    expect(normalizeDatabaseSystem("other_sql")).toBe("other_sql");
  });

  test("empty and non-string values are null", () => {
    expect(normalizeDatabaseSystem("")).toBeNull();
    expect(normalizeDatabaseSystem("   ")).toBeNull();
    expect(normalizeDatabaseSystem(null)).toBeNull();
    expect(normalizeDatabaseSystem(undefined)).toBeNull();
    expect(normalizeDatabaseSystem(5432)).toBeNull();
    expect(normalizeDatabaseSystem({ system: "postgresql" })).toBeNull();
  });

  test("Object.prototype member names are not engines", () => {
    expect(normalizeDatabaseSystem("constructor")).toBe("constructor");
    expect(isKnownDatabaseSystem("constructor")).toBe(false);
    expect(getDatabaseSystemDescriptor("__proto__")).toBeNull();
    expect(getDatabaseSystemFamily("hasOwnProperty")).toBe("hasownproperty");
  });
});

describe("engine families", () => {
  test.each([
    ["mariadb", "mysql"],
    ["tidb", "mysql"],
    ["vitess", "mysql"],
    ["singlestore", "mysql"],
    ["oceanbase", "mysql"],
    ["starrocks", "mysql"],
    ["doris", "mysql"],
    ["cockroachdb", "postgresql"],
    ["yugabytedb", "postgresql"],
    ["aws.redshift", "postgresql"],
    ["greenplum", "postgresql"],
    ["questdb", "postgresql"],
    ["valkey", "redis"],
    ["keydb", "redis"],
    ["dragonfly", "redis"],
    ["scylladb", "cassandra"],
    ["opensearch", "elasticsearch"],
    ["ferretdb", "mongodb"],
    ["aws.documentdb", "mongodb"],
    ["interbase", "firebirdsql"],
  ])("%s belongs to the %s family", (fork: string, family: string) => {
    expect(getDatabaseSystemFamily(fork)).toBe(family);
    expect(isSameDatabaseFamily(fork, family)).toBe(true);
    expect(isSameDatabaseFamily(family, fork)).toBe(true);
  });

  test("an engine that is its own family, an alias and an unknown value", () => {
    expect(getDatabaseSystemFamily("postgresql")).toBe("postgresql");
    expect(getDatabaseSystemFamily("pg")).toBe("postgresql");
    expect(getDatabaseSystemFamily("dragonflydb")).toBe("redis");
    expect(getDatabaseSystemFamily(" AcmeDB ")).toBe("acmedb");
    expect(getDatabaseSystemFamily("")).toBeNull();
    expect(getDatabaseSystemFamily(null)).toBeNull();
    expect(getDatabaseSystemFamily(42)).toBeNull();
  });

  test("two forks of one family are one family; different families are not", () => {
    expect(isSameDatabaseFamily("valkey", "dragonfly")).toBe(true);
    expect(isSameDatabaseFamily("mariadb", "tidb")).toBe(true);
    expect(isSameDatabaseFamily("mysql", "postgresql")).toBe(false);
    expect(isSameDatabaseFamily("mariadb", "cockroachdb")).toBe(false);
    expect(isSameDatabaseFamily("redis", "memcached")).toBe(false);
    expect(isSameDatabaseFamily("acmedb", " AcmeDB ")).toBe(true);
    expect(isSameDatabaseFamily("", "")).toBe(false);
    expect(isSameDatabaseFamily(null, "redis")).toBe(false);
  });
});

describe("getDatabaseSystemMetricsEngine", () => {
  test.each([
    // Forks their family's receiver monitors chart the family's metrics.
    ["mariadb", "mysql"],
    ["valkey", "redis"],
    ["keydb", "redis"],
    ["dragonflydb", "redis"],
    // Verified against OpenSearch 2.17 with the pinned collector.
    ["opensearch", "elasticsearch"],
    // Forks the family's receiver does NOT monitor keep their own.
    ["tidb", "tidb"],
    ["cockroachdb", "cockroachdb"],
    ["scylladb", "scylladb"],
    ["ferretdb", "ferretdb"],
    // Engines that are their own family, aliases and unknown values.
    ["mysql", "mysql"],
    ["postgres", "postgresql"],
    ["MSSQL", "microsoft.sql_server"],
    [" AcmeDB ", "acmedb"],
  ])("%s → %s", (system: string, expected: string) => {
    expect(getDatabaseSystemMetricsEngine(system)).toBe(expected);
  });

  test("agrees with the receivers each engine lists", () => {
    for (const descriptor of DATABASE_SYSTEMS) {
      const engine: string = getDatabaseSystemMetricsEngine(
        descriptor.system,
      ) as string;
      if (descriptor.receiverTypes.length > 0) {
        expect(descriptorOf(engine).receiverTypes).toEqual(
          expect.arrayContaining([...descriptor.receiverTypes]),
        );
      } else {
        expect(engine).toBe(descriptor.system);
      }
    }
  });

  test("empty and non-string input is null", () => {
    expect(getDatabaseSystemMetricsEngine("")).toBeNull();
    expect(getDatabaseSystemMetricsEngine(null)).toBeNull();
    expect(getDatabaseSystemMetricsEngine(3306)).toBeNull();
  });
});

describe("getMoreSpecificDatabaseSystem", () => {
  test.each([
    // A fork refines its family.
    ["mysql", "mariadb", "mariadb"],
    ["redis", "valkey", "valkey"],
    ["postgresql", "cockroachdb", "cockroachdb"],
    ["cassandra", "scylla", "scylladb"],
    ["postgres", "yugabyte", "yugabytedb"],
    // The family never undoes a fork (the client cannot tell them apart).
    ["mariadb", "mysql", "mariadb"],
    ["valkey", "redis", "valkey"],
    ["cockroachdb", "postgresql", "cockroachdb"],
    // A different fork of the same family is not "more specific".
    ["valkey", "dragonfly", "valkey"],
    ["tidb", "mariadb", "tidb"],
    // Unrelated or unknown sightings keep the current engine.
    ["postgresql", "mysql", "postgresql"],
    ["mysql", "acmedb", "mysql"],
    ["acmedb", "mariadb", "acmedb"],
    // Same engine, aliases and casing.
    ["mysql", "MySQL", "mysql"],
    ["mssql", "sqlserver", "microsoft.sql_server"],
  ])(
    "current %s, seen as %s → %s",
    (current: string, observed: string, expected: string) => {
      expect(getMoreSpecificDatabaseSystem(current, observed)).toBe(expected);
    },
  );

  test("an empty side yields the other, both empty is null", () => {
    expect(getMoreSpecificDatabaseSystem("", "mariadb")).toBe("mariadb");
    expect(getMoreSpecificDatabaseSystem(null, "Postgres")).toBe("postgresql");
    expect(getMoreSpecificDatabaseSystem("mysql", "")).toBe("mysql");
    expect(getMoreSpecificDatabaseSystem("mysql", undefined)).toBe("mysql");
    expect(getMoreSpecificDatabaseSystem(null, null)).toBeNull();
  });
});

describe("refineDatabaseSystemFromVersion", () => {
  test.each([
    ["mysql", "10.11.7-MariaDB-1:10.11.7+maria~ubu2204", "mariadb"],
    ["mysql", "11.4.2-MariaDB", "mariadb"],
    ["mysql", "8.0.11-TiDB-v7.5.1", "tidb"],
    ["mysql", "8.0.30-Vitess", "vitess"],
    ["mysql", "5.7.25-OceanBase_CE-v4.2.1.2", "oceanbase"],
    // Percona Server and plain MySQL stay MySQL.
    ["mysql", "8.0.36-28", "mysql"],
    ["mysql", "8.4.0", "mysql"],
    ["percona", "8.0.36-28", "mysql"],
    // No fork of these families declares a version pattern.
    ["redis", "7.2.4", "redis"],
    ["postgresql", "16.2", "postgresql"],
    // A fork already names itself.
    ["mariadb", "8.0.11-TiDB-v7.5.1", "mariadb"],
    // A version that names a fork of ANOTHER family is ignored.
    ["postgresql", "10.11.7-MariaDB", "postgresql"],
  ])(
    "%s reporting %s is %s",
    (system: string, version: string, expected: string) => {
      expect(refineDatabaseSystemFromVersion(system, version)).toBe(expected);
    },
  );

  /*
   * Regression (e2e, collector-contrib 0.161.0): an agent installed with
   * DATABASE_SYSTEM=mysql against MariaDB 11.4 — whose SELECT VERSION() is
   * "11.4.13-MariaDB-ubu2404" — reported db.system.version "11.4.13", the
   * bare number the mysql receiver keeps, and the database stayed "MySQL"
   * for good. MySQL has never released a 10.x or 11.x, so the major alone
   * names MariaDB.
   */
  test.each([
    ["mysql", "11.4.13", "mariadb"],
    ["mysql", "10.11.7", "mariadb"],
    ["mysql", "10.5.9", "mariadb"],
    ["mysql", "12.0.2", "mariadb"],
    ["mysql", " 11.8.2 ", "mariadb"],
    ["percona", "11.4.13", "mariadb"],
    // MySQL's own releases, 5.x to the 9.x innovation line, stay MySQL.
    ["mysql", "8.4.11", "mysql"],
    ["mysql", "9.4.0", "mysql"],
    ["mysql", "5.7.44-log", "mysql"],
    ["mysql", "8.0.mysql_aurora.3.05.2", "mysql"],
    // A MariaDB older than 10 whose suffix was stripped cannot be told apart.
    ["mysql", "5.5.68", "mysql"],
    // A fork's name beats the major: TiDB answers with MySQL's version.
    ["mysql", "8.0.11-TiDB-v7.5.1", "tidb"],
    // Only the mysql family has such a fork; other families keep theirs.
    ["postgresql", "16.2", "postgresql"],
    ["redis", "11.0.0", "redis"],
    ["mongodb", "10.0.1", "mongodb"],
    // A fork already names itself.
    ["tidb", "11.4.13", "tidb"],
    // Not a version's leading number: a date, a word.
    ["mysql", "20240101", "mysql"],
    ["mysql", "latest", "mysql"],
  ])(
    "the bare version: %s reporting %s is %s",
    (system: string, version: string, expected: string) => {
      expect(refineDatabaseSystemFromVersion(system, version)).toBe(expected);
    },
  );

  test("no version, or a non-string one, keeps the engine; no engine is null", () => {
    expect(refineDatabaseSystemFromVersion("mysql", null)).toBe("mysql");
    expect(refineDatabaseSystemFromVersion("mysql", "")).toBe("mysql");
    expect(refineDatabaseSystemFromVersion("mysql", "   ")).toBe("mysql");
    expect(refineDatabaseSystemFromVersion("mysql", 10)).toBe("mysql");
    expect(refineDatabaseSystemFromVersion("", "10.11.7-MariaDB")).toBeNull();
    expect(refineDatabaseSystemFromVersion(null, "10.11.7-MariaDB")).toBeNull();
    expect(refineDatabaseSystemFromVersion("AcmeDB", "1.0-MariaDB")).toBe(
      "acmedb",
    );
  });

  test("reads the major of a pathological version string in linear time", () => {
    const hostile: string = " ".repeat(100_000) + "x";
    const started: number = performance.now();
    expect(refineDatabaseSystemFromVersion("mysql", hostile)).toBe("mysql");
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("only reads the head of a pathological version string", () => {
    const hostile: string = "9".repeat(100_000) + "-MariaDB";
    const started: number = performance.now();
    expect(refineDatabaseSystemFromVersion("mysql", hostile)).toBe("mysql");
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("descriptor lookups", () => {
  test("isKnownDatabaseSystem accepts systems and aliases only", () => {
    expect(isKnownDatabaseSystem("postgresql")).toBe(true);
    expect(isKnownDatabaseSystem("postgres")).toBe(true);
    expect(isKnownDatabaseSystem("tidb")).toBe(true);
    expect(isKnownDatabaseSystem("snowflake")).toBe(true);
    expect(isKnownDatabaseSystem("acmedb")).toBe(false);
    expect(isKnownDatabaseSystem("")).toBe(false);
    expect(isKnownDatabaseSystem(null)).toBe(false);
  });

  test("getDatabaseSystemDescriptor resolves an alias to its engine", () => {
    expect(getDatabaseSystemDescriptor("pg")?.system).toBe("postgresql");
    expect(getDatabaseSystemDescriptor("scylla")?.system).toBe("scylladb");
    expect(getDatabaseSystemDescriptor("nope")).toBeNull();
  });

  test.each([
    ["postgresql", 5432],
    ["mysql", 3306],
    ["mariadb", 3306],
    ["microsoft.sql_server", 1433],
    ["oracle.db", 1521],
    ["redis", 6379],
    ["valkey", 6379],
    ["mongodb", 27017],
    ["elasticsearch", 9200],
    ["opensearch", 9200],
    ["memcached", 11211],
    ["couchdb", 5984],
    ["cassandra", 9042],
    ["scylladb", 9042],
    ["clickhouse", 9000],
    ["cockroachdb", 26257],
    ["yugabytedb", 5433],
    ["tidb", 4000],
    ["neo4j", 7687],
    ["influxdb", 8086],
    ["couchbase", 11210],
    ["ibm.db2", 50000],
    ["sap.hana", 30015],
    ["firebirdsql", 3050],
    ["aws.redshift", 5439],
    ["trino", 8080],
    ["hive", 10000],
    ["teradata", 1025],
    ["vertica", 5433],
    ["snowflake", 443],
    ["etcd", 2379],
    ["aerospike", 3000],
    ["riak", 8087],
    ["arangodb", 8529],
    ["milvus", 19530],
    ["qdrant", 6333],
    ["solr", 8983],
    ["intersystems.cache", 1972],
    ["aws.dynamodb", 443],
    ["azure.cosmosdb", 443],
    ["gcp.spanner", 443],
    ["h2database", 9092],
    ["derby", 1527],
  ])("default port of %s is %d", (system: string, port: number) => {
    expect(getDefaultDatabasePort(system)).toBe(port);
  });

  test("engines without a network port, and unknown engines, have none", () => {
    for (const system of [
      "sqlite",
      "duckdb",
      "instantdb",
      "hbase",
      "actian.ingres",
      "acmedb",
      "",
    ]) {
      expect(getDefaultDatabasePort(system)).toBeNull();
    }
  });

  test("display names: engine, alias, unknown raw, empty", () => {
    expect(getDatabaseSystemDisplayName("postgresql")).toBe("PostgreSQL");
    expect(getDatabaseSystemDisplayName("postgres")).toBe("PostgreSQL");
    expect(getDatabaseSystemDisplayName("microsoft.sql_server")).toBe(
      "SQL Server",
    );
    expect(getDatabaseSystemDisplayName("snowflake")).toBe("Snowflake");
    expect(getDatabaseSystemDisplayName("  AcmeDB ")).toBe("AcmeDB");
    expect(getDatabaseSystemDisplayName("")).toBe("Database");
    expect(getDatabaseSystemDisplayName("   ")).toBe("Database");
    expect(getDatabaseSystemDisplayName(null)).toBe("Database");
  });
});

describe("isAutoCreatableDatabaseSystem", () => {
  test("server engines may auto-create, managed ones with a per-cluster or per-account endpoint included", () => {
    for (const system of [
      "postgresql",
      "mysql",
      "mariadb",
      "redis",
      "valkey",
      "mongodb",
      "microsoft.sql_server",
      "oracle.db",
      "cockroachdb",
      "tidb",
      "clickhouse",
      "cassandra",
      "scylladb",
      "hive",
      "teradata",
      "vertica",
      "qdrant",
      "postgres",
      // `orders.abc.us-east-1.redshift.amazonaws.com` is one warehouse.
      "aws.redshift",
      "aws.documentdb",
      "aws.neptune",
      // `acme.snowflakecomputing.com` is one account.
      "snowflake",
      "databricks",
    ]) {
      expect({ system, auto: isAutoCreatableDatabaseSystem(system) }).toEqual({
        system,
        auto: true,
      });
    }
  });

  test("cloud-API, in-process and unknown engines never auto-create", () => {
    for (const system of [
      "aws.dynamodb",
      "dynamodb",
      "azure.cosmosdb",
      "gcp.spanner",
      "bigquery",
      "gcp.firestore",
      "gcp.bigtable",
      "pinecone",
      "sqlite",
      "h2database",
      "h2",
      "hsqldb",
      "derby",
      "duckdb",
      "instantdb",
      "other_sql",
      "acmedb",
      "",
    ]) {
      expect({ system, auto: isAutoCreatableDatabaseSystem(system) }).toEqual({
        system,
        auto: false,
      });
    }
  });
});

describe("getDatabaseSystemFromReceiverScopeName", () => {
  test.each([
    ["postgresqlreceiver", "postgresql"],
    ["mysqlreceiver", "mysql"],
    ["sqlserverreceiver", "microsoft.sql_server"],
    ["oracledbreceiver", "oracle.db"],
    ["redisreceiver", "redis"],
    ["mongodbreceiver", "mongodb"],
    ["mongodbatlasreceiver", "mongodb"],
    ["elasticsearchreceiver", "elasticsearch"],
    ["memcachedreceiver", "memcached"],
    ["couchdbreceiver", "couchdb"],
    // Regression: these ship in the pinned collector and were not recognised.
    ["saphanareceiver", "sap.hana"],
    ["snowflakereceiver", "snowflake"],
    ["riakreceiver", "riak"],
    ["aerospikereceiver", "aerospike"],
    ["googlecloudspannerreceiver", "gcp.spanner"],
  ])("current Go-module form of %s → %s", (segment: string, system: string) => {
    expect(
      getDatabaseSystemFromReceiverScopeName(`${CONTRIB_PREFIX}${segment}`),
    ).toBe(system);
  });

  test("a receiver that also monitors forks reports its family, never a fork", () => {
    // MariaDB, Valkey, KeyDB and Dragonfly list these receivers too.
    expect(
      getDatabaseSystemFromReceiverScopeName(`${CONTRIB_PREFIX}mysqlreceiver`),
    ).toBe("mysql");
    expect(
      getDatabaseSystemFromReceiverScopeName(`${CONTRIB_PREFIX}redisreceiver`),
    ).toBe("redis");
  });

  test("every receiver the catalog lists is recognised, as its family's engine", () => {
    for (const descriptor of DATABASE_SYSTEMS) {
      for (const receiverType of descriptor.receiverTypes) {
        expect({
          receiverType,
          system: getDatabaseSystemFromReceiverScopeName(
            `${CONTRIB_PREFIX}${receiverType}receiver`,
          ),
        }).toEqual({
          receiverType,
          system: descriptor.family || descriptor.system,
        });
      }
    }
  });

  test("the legacy otelcol/<type>receiver form is recognised too", () => {
    expect(
      getDatabaseSystemFromReceiverScopeName("otelcol/postgresqlreceiver"),
    ).toBe("postgresql");
    expect(
      getDatabaseSystemFromReceiverScopeName("otelcol/redisreceiver"),
    ).toBe("redis");
  });

  test("casing, padding and a trailing slash are tolerated", () => {
    expect(
      getDatabaseSystemFromReceiverScopeName(
        `  ${CONTRIB_PREFIX.toUpperCase()}PostgreSQLReceiver/ `,
      ),
    ).toBe("postgresql");
  });

  test("non-DB receivers, the generic sql_query receiver and SDK scopes are null", () => {
    for (const scope of [
      `${CONTRIB_PREFIX}hostmetricsreceiver`,
      `${CONTRIB_PREFIX}kafkareceiver`,
      `${CONTRIB_PREFIX}zookeeperreceiver`,
      // It runs whatever SQL it is given against whatever driver: no engine.
      `${CONTRIB_PREFIX}sqlqueryreceiver`,
      `${CONTRIB_PREFIX}prometheusreceiver`,
      "otelcol/receiver",
      "receiver",
      "@opentelemetry/instrumentation-pg",
      "io.opentelemetry.jdbc",
      "postgresql",
      "",
    ]) {
      expect(getDatabaseSystemFromReceiverScopeName(scope)).toBeNull();
    }
    expect(getDatabaseSystemFromReceiverScopeName(null)).toBeNull();
    expect(getDatabaseSystemFromReceiverScopeName(undefined)).toBeNull();
  });

  test("only the LAST path segment counts", () => {
    expect(
      getDatabaseSystemFromReceiverScopeName(
        `${CONTRIB_PREFIX}postgresqlreceiver/internal/metadata`,
      ),
    ).toBeNull();
  });
});

describe("getDatabaseEngineMetricsSource", () => {
  test.each([
    ["postgres", "receiver"],
    ["mariadb", "receiver"],
    ["sap.hana", "receiver"],
    ["spanner", "receiver"],
    ["clickhouse", "prometheus"],
    ["cockroachdb", "prometheus"],
    ["scylla", "prometheus"],
    ["dynamodb", "cloud-monitoring"],
    ["bigquery", "cloud-monitoring"],
    ["db2", "none"],
    ["cassandra", "none"],
    ["sqlite", "embedded"],
    ["h2", "embedded"],
  ])("%s → %s", (system: string, kind: string) => {
    expect(getDatabaseEngineMetricsSource(system).kind).toBe(kind);
  });

  test("an unknown engine has no known path — never 'embedded', which would claim it has no metrics at all", () => {
    for (const system of ["acmedb", "", null, undefined, 42]) {
      const source: ReturnType<typeof getDatabaseEngineMetricsSource> =
        getDatabaseEngineMetricsSource(system);
      expect(source.kind).toBe("none");
    }
  });

  test("a Prometheus recipe carries the port and path to scrape", () => {
    expect(getDatabaseEngineMetricsSource("clickhouse")).toEqual({
      kind: "prometheus",
      port: 9363,
      path: "/metrics",
      note: "Enable the `<prometheus>` section of the server config.",
    });
  });
});

describe("getCollectorReceiverComponentName", () => {
  test("renamed receivers are configured under their new names", () => {
    expect(getCollectorReceiverComponentName("googlecloudspanner")).toBe(
      "google_cloud_spanner",
    );
    expect(getCollectorReceiverComponentName("mongodbatlas")).toBe(
      "mongodb_atlas",
    );
  });

  test("the rest are configured under their type", () => {
    for (const type of ["postgresql", "sqlserver", "saphana", "snowflake"]) {
      expect(getCollectorReceiverComponentName(type)).toBe(type);
    }
  });
});

describe("getDatabaseReceiverSystemHint", () => {
  test("the first DB receiver among the block's scopes wins", () => {
    expect(
      getDatabaseReceiverSystemHint([
        null,
        undefined,
        "",
        `${CONTRIB_PREFIX}hostmetricsreceiver`,
        `${CONTRIB_PREFIX}redisreceiver`,
        `${CONTRIB_PREFIX}postgresqlreceiver`,
      ]),
    ).toBe("redis");
    expect(
      getDatabaseReceiverSystemHint([
        `${CONTRIB_PREFIX}saphanareceiver`,
        `${CONTRIB_PREFIX}redisreceiver`,
      ]),
    ).toBe("sap.hana");
  });

  test("no DB receiver → null", () => {
    expect(getDatabaseReceiverSystemHint([])).toBeNull();
    expect(
      getDatabaseReceiverSystemHint([`${CONTRIB_PREFIX}filelogreceiver`]),
    ).toBeNull();
  });

  test("a non-array input is null rather than a throw", () => {
    expect(
      getDatabaseReceiverSystemHint(
        "otelcol/redisreceiver" as unknown as Array<string>,
      ),
    ).toBeNull();
  });
});

describe("trimTrailingCharacter", () => {
  test("drops every trailing copy of the character and nothing else", () => {
    expect(trimTrailingCharacter("db.prod.", ".")).toBe("db.prod");
    expect(trimTrailingCharacter("db.prod...", ".")).toBe("db.prod");
    expect(trimTrailingCharacter("db.prod", ".")).toBe("db.prod");
    expect(trimTrailingCharacter("...", ".")).toBe("");
    expect(trimTrailingCharacter("", ".")).toBe("");
    expect(trimTrailingCharacter("a/b//", "/")).toBe("a/b");
    expect(trimTrailingCharacter(".a.", ".")).toBe(".a");
  });

  test("stays linear on long runs that do not end the string", () => {
    // The regex it replaced (/\.+$/) backtracks quadratically on this input.
    const hostile: string = "a" + ".".repeat(200_000) + "b";
    const started: number = performance.now();
    expect(trimTrailingCharacter(hostile, ".")).toBe(hostile);
    expect(
      getDatabaseSystemFromReceiverScopeName("x" + "/".repeat(200_000) + "y"),
    ).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

/*
 * Regression (e2e): Valkey 8.1.10 showed "Version 7.2.4". Its INFO keeps
 * redis_version at 7.2.4 — the Redis release it forked from — next to
 * valkey_version:8.1.10, and the redis receiver reports only the former, as
 * redis.version.
 */
describe("isCompatibilityVersionAttribute", () => {
  test.each([
    ["valkey", "redis.version", true],
    ["valkey", "resource.redis.version", true],
    ["Valkey", " redis.version ", true],
    ["dragonfly", "redis.version", true],
    ["dragonflydb", "redis.version", true],
    // Redis's is its own; so is KeyDB's (redis_version:6.3.4 is KeyDB 6.3.4).
    ["redis", "redis.version", false],
    ["keydb", "redis.version", false],
    // Another attribute, or an engine that declares none.
    ["valkey", "db.system.version", false],
    ["mariadb", "db.system.version", false],
    ["opensearch", "elasticsearch.node.version", false],
    ["acmedb", "redis.version", false],
    ["", "redis.version", false],
    [null, "redis.version", false],
  ])(
    "%s + %s is a compatibility version: %s",
    (system: string | null, key: string, expected: boolean) => {
      expect(isCompatibilityVersionAttribute(system, key)).toBe(expected);
    },
  );
});
