import {
  DATABASE_SYSTEMS,
  DatabaseSystemDescriptor,
  getDatabaseReceiverSystemHint,
  getDatabaseSystemDescriptor,
  getDatabaseSystemDisplayName,
  getDatabaseSystemFromReceiverScopeName,
  getDefaultDatabasePort,
  isAutoCreatableDatabaseSystem,
  isKnownDatabaseSystem,
  normalizeDatabaseSystem,
} from "../../../Types/DatabaseServer/DatabaseSystem";
import { describe, expect, test } from "@jest/globals";

const CONTRIB_PREFIX: string =
  "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/";

describe("DATABASE_SYSTEMS registry integrity", () => {
  test("systems are unique, lowercase and trimmed", () => {
    const systems: Array<string> = DATABASE_SYSTEMS.map(
      (descriptor: DatabaseSystemDescriptor): string => {
        return descriptor.system;
      },
    );
    expect(new Set(systems).size).toBe(systems.length);
    for (const system of systems) {
      expect(system).toBe(system.trim().toLowerCase());
    }
  });

  test("no alias is claimed by two engines or shadows a system", () => {
    const owners: Map<string, string> = new Map<string, string>();
    for (const descriptor of DATABASE_SYSTEMS) {
      owners.set(descriptor.system, descriptor.system);
    }
    for (const descriptor of DATABASE_SYSTEMS) {
      for (const alias of descriptor.aliases) {
        expect(alias).toBe(alias.trim().toLowerCase());
        expect(owners.has(alias)).toBe(false);
        owners.set(alias, descriptor.system);
      }
    }
  });

  test("no receiver type is claimed by two engines", () => {
    const seen: Set<string> = new Set<string>();
    for (const descriptor of DATABASE_SYSTEMS) {
      for (const receiverType of descriptor.receiverTypes) {
        expect(seen.has(receiverType)).toBe(false);
        seen.add(receiverType);
      }
    }
  });

  test("hasCollectorReceiver agrees with receiverTypes and prefixes", () => {
    for (const descriptor of DATABASE_SYSTEMS) {
      expect(descriptor.hasCollectorReceiver).toBe(
        descriptor.receiverTypes.length > 0,
      );
      expect(descriptor.receiverMetricPrefixes.length > 0).toBe(
        descriptor.hasCollectorReceiver,
      );
      for (const prefix of descriptor.receiverMetricPrefixes) {
        // Stored metric names are lowercased at ingest.
        expect(prefix).toBe(prefix.toLowerCase());
        expect(prefix.endsWith(".")).toBe(true);
      }
    }
  });

  test("no image repository or chart name is claimed by two engines", () => {
    const images: Set<string> = new Set<string>();
    const charts: Set<string> = new Set<string>();
    for (const descriptor of DATABASE_SYSTEMS) {
      for (const image of descriptor.imageRepositories) {
        expect(image).toBe(image.toLowerCase());
        expect(images.has(image)).toBe(false);
        images.add(image);
      }
      for (const chart of descriptor.kubernetesChartNames) {
        expect(charts.has(chart)).toBe(false);
        charts.add(chart);
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

  test("every display name is non-empty", () => {
    for (const descriptor of DATABASE_SYSTEMS) {
      expect(descriptor.displayName.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("normalizeDatabaseSystem", () => {
  test.each([
    ["postgresql", "postgresql"],
    ["postgres", "postgresql"],
    ["pg", "postgresql"],
    ["pgsql", "postgresql"],
    ["mariadb", "mysql"],
    ["percona", "mysql"],
    ["mssql", "microsoft.sql_server"],
    ["sqlserver", "microsoft.sql_server"],
    ["sql_server", "microsoft.sql_server"],
    ["microsoft.sql_server", "microsoft.sql_server"],
    ["oracle", "oracle.db"],
    ["oracledb", "oracle.db"],
    ["valkey", "redis"],
    ["keydb", "redis"],
    ["dragonfly", "redis"],
    ["dragonflydb", "redis"],
    ["mongo", "mongodb"],
    ["elastic", "elasticsearch"],
    ["scylladb", "cassandra"],
    ["scylla", "cassandra"],
    ["cockroach", "cockroachdb"],
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

  test("casing and whitespace do not matter", () => {
    expect(normalizeDatabaseSystem("  PostgreSQL ")).toBe("postgresql");
    expect(normalizeDatabaseSystem("MSSQL")).toBe("microsoft.sql_server");
  });

  test("opensearch stays its own engine (not folded into elasticsearch)", () => {
    expect(normalizeDatabaseSystem("opensearch")).toBe("opensearch");
  });

  test("an unknown non-empty value is returned canonicalized", () => {
    expect(normalizeDatabaseSystem("  TiDB ")).toBe("tidb");
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
  });
});

describe("descriptor lookups", () => {
  test("isKnownDatabaseSystem accepts systems and aliases only", () => {
    expect(isKnownDatabaseSystem("postgresql")).toBe(true);
    expect(isKnownDatabaseSystem("postgres")).toBe(true);
    expect(isKnownDatabaseSystem("tidb")).toBe(false);
    expect(isKnownDatabaseSystem("")).toBe(false);
    expect(isKnownDatabaseSystem(null)).toBe(false);
  });

  test("getDatabaseSystemDescriptor resolves an alias to its engine", () => {
    expect(getDatabaseSystemDescriptor("pg")?.system).toBe("postgresql");
    expect(getDatabaseSystemDescriptor("nope")).toBeNull();
  });

  test.each([
    ["postgresql", 5432],
    ["mysql", 3306],
    ["mariadb", 3306],
    ["microsoft.sql_server", 1433],
    ["oracle.db", 1521],
    ["redis", 6379],
    ["mongodb", 27017],
    ["elasticsearch", 9200],
    ["opensearch", 9200],
    ["memcached", 11211],
    ["couchdb", 5984],
    ["cassandra", 9042],
    ["clickhouse", 9000],
    ["cockroachdb", 26257],
    ["neo4j", 7687],
    ["influxdb", 8086],
    ["couchbase", 11210],
    ["ibm.db2", 50000],
    ["sap.hana", 30015],
    ["firebirdsql", 3050],
    ["aws.redshift", 5439],
    ["trino", 8080],
  ])("default port of %s is %d", (system: string, port: number) => {
    expect(getDefaultDatabasePort(system)).toBe(port);
  });

  test("engines without a network port, and unknown engines, have none", () => {
    for (const system of [
      "sqlite",
      "h2database",
      "aws.dynamodb",
      "azure.cosmosdb",
      "gcp.spanner",
      "tidb",
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
    expect(getDatabaseSystemDisplayName("  TiDB ")).toBe("TiDB");
    expect(getDatabaseSystemDisplayName("")).toBe("Database");
    expect(getDatabaseSystemDisplayName("   ")).toBe("Database");
    expect(getDatabaseSystemDisplayName(null)).toBe("Database");
  });
});

describe("isAutoCreatableDatabaseSystem", () => {
  test("known server engines may auto-create", () => {
    for (const system of [
      "postgresql",
      "mysql",
      "redis",
      "mongodb",
      "microsoft.sql_server",
      "oracle.db",
      "cockroachdb",
      "postgres",
    ]) {
      expect(isAutoCreatableDatabaseSystem(system)).toBe(true);
    }
  });

  test("cloud-API, in-process and unknown engines never auto-create", () => {
    for (const system of [
      "aws.dynamodb",
      "dynamodb",
      "azure.cosmosdb",
      "gcp.spanner",
      "sqlite",
      "h2database",
      "h2",
      "other_sql",
      "tidb",
      "",
    ]) {
      expect(isAutoCreatableDatabaseSystem(system)).toBe(false);
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
  ])("current Go-module form of %s → %s", (segment: string, system: string) => {
    expect(
      getDatabaseSystemFromReceiverScopeName(`${CONTRIB_PREFIX}${segment}`),
    ).toBe(system);
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

  test("non-DB receivers and SDK scopes are null", () => {
    for (const scope of [
      `${CONTRIB_PREFIX}hostmetricsreceiver`,
      `${CONTRIB_PREFIX}kafkareceiver`,
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
