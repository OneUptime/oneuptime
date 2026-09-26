import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Span, { SpanKind } from "Common/Models/AnalyticsModels/Span";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import {
  CALLER_CLUSTER_ATTRIBUTE,
  CALLER_NAMESPACE_ATTRIBUTE,
  DEFAULT_DATABASE_SERVER_MIN_CALLS,
  DatabaseEndpointRow,
  DiscoveredDatabaseEndpoint,
  buildDatabaseEndpointSql,
  databaseQuerySpanSql,
  getDatabaseEndpointCallerContextNeeds,
  getDiscoveredDatabaseEndpoints,
  isDatabaseEndpointAutoCreateCandidate,
  resolveDatabaseEndpointRows,
} from "Common/Server/Utils/Telemetry/DatabaseEndpointDiscovery";
import {
  DATABASE_CONNECTION_SPAN_NAMES,
  isDatabaseConnectionSpanName,
} from "Common/Types/DatabaseServer/DatabaseConnectionSpan";
import {
  DatabaseEndpoint,
  buildDatabaseCallerContext,
  formatDatabaseEndpoint,
  isIpLiteralHost,
} from "Common/Types/DatabaseServer/DatabaseEndpoint";
import {
  DATABASE_ADDRESS_ATTRIBUTES,
  DATABASE_PORT_ATTRIBUTES,
  DATABASE_SYSTEM_ATTRIBUTES,
  resolveDatabaseCallTarget,
} from "Common/Types/DatabaseServer/DatabaseTelemetryResolver";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * Client-span database discovery against a real ClickHouse server.
 *
 * The unit tests compare buildDatabaseEndpointSql as a string and run its
 * TypeScript twin. What they cannot show is that ClickHouse runs it: that
 * the SELECT aliases (serverAddress, dbSystem) resolve inside the later
 * expressions and in WHERE, that the RE2 patterns and their escaping mean
 * what the twin means, that the attributeKeys prefilter keeps every DB span
 * and that the rows come back in the order the row cap relies on. So this
 * suite loads CLIENT spans covering every address shape the endpoint rules
 * distinguish into a table built from the real Span model, runs the exact
 * query, and checks the rows against (1) the TypeScript twin, span by span,
 * and (2) the ingest resolver: the cron must land on exactly the endpoints
 * ingest stamps on the spans.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/Jobs/TelemetryEntity/DatabaseEndpointDiscoveryClickhouse.test.ts
 *
 * The suite creates (and drops) its own database, named from
 * TEST_CLICKHOUSE_DATABASE_PREFIX when that is set. The App Test workflow
 * provides the server; the guard at the bottom fails the run there if it
 * ever goes missing.
 * ------------------------------------------------------------------
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `${
  process.env["TEST_CLICKHOUSE_DATABASE_PREFIX"] ||
  "database_endpoint_discovery_test"
}_${process.pid}_${Date.now()}`;

const PROJECT_ID: string = "7a4c5b1e-2b3f-4c1d-9e8f-1a2b3c4d5e6f";
const OTHER_PROJECT_ID: string = "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f";

const now: number = Date.now();

const WINDOW_START: Date = new Date(now - 15 * 60 * 1000);
const WINDOW_END: Date = new Date(now + 60 * 1000);

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

type Caller = Record<string, string>;

const VM: Caller = {
  "resource.host.name": "vm-7",
  "resource.os.type": "linux",
};

function pod(namespace: string | null, cluster: string | null): Caller {
  const caller: Caller = { "resource.k8s.pod.name": "api-7d9f-x" };
  if (namespace !== null) {
    caller[CALLER_NAMESPACE_ATTRIBUTE] = namespace;
  }
  if (cluster !== null) {
    caller[CALLER_CLUSTER_ATTRIBUTE] = cluster;
  }
  return caller;
}

interface SpanFixture {
  attributes: Record<string, string>;
  caller: Caller;
  // How many identical spans to insert.
  count?: number;
  kind?: SpanKind;
  projectId?: string;
  minutesAgo?: number;
  // The span name; "query" when absent, NULL when null.
  name?: string | null;
}

// Spans a fixture adds to its group's call count: connection spans add none.
function callsOf(fixture: SpanFixture): number {
  const name: string | null =
    fixture.name === undefined ? "query" : fixture.name;
  return isDatabaseConnectionSpanName(name) ? 0 : fixture.count || 1;
}

function db(
  system: string,
  address: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { "db.system.name": system, "server.address": address, ...extra };
}

const SPANS: Array<SpanFixture> = [
  // One public endpoint from many callers: one group.
  {
    attributes: db("postgresql", "orders.cjd8.eu-west-1.rds.amazonaws.com", {
      "server.port": "5432",
    }),
    caller: pod("shop", "prod"),
    count: 3,
  },
  {
    attributes: db("postgresql", "orders.cjd8.eu-west-1.rds.amazonaws.com", {
      "server.port": "5432",
    }),
    caller: pod("billing", "staging"),
    count: 2,
  },
  {
    attributes: db("postgresql", "orders.cjd8.eu-west-1.rds.amazonaws.com", {
      "server.port": "5432",
    }),
    caller: VM,
  },
  // Legacy attribute names and case.
  {
    attributes: {
      "db.system": "mysql",
      "net.peer.name": "MySQL.Example.COM",
      "net.peer.port": "3306",
    },
    caller: VM,
    count: 2,
  },
  // An empty stable attribute falls through to the legacy one.
  {
    attributes: {
      "db.system.name": "",
      "db.system": "redis",
      "server.address": "",
      "net.peer.name": "cache.example.com",
    },
    caller: VM,
  },
  // network.peer.address fallback, a private IP from a pod.
  {
    attributes: {
      "db.system.name": "redis",
      "network.peer.address": "10.0.0.9",
      "network.peer.port": "6379",
    },
    caller: pod("shop", "prod"),
  },
  // Single-label Service names: per namespace and cluster.
  { attributes: db("postgresql", "postgres"), caller: pod("shop", "prod") },
  {
    attributes: db("postgresql", "postgres"),
    caller: pod("billing", "prod"),
    count: 2,
  },
  { attributes: db("postgresql", "postgres"), caller: VM },
  // The two-label finding: <service>.<namespace> from two clusters.
  {
    attributes: db("postgresql", "postgres.data"),
    caller: pod("shop", "staging"),
    count: 4,
  },
  {
    attributes: db("postgresql", "postgres.data"),
    caller: pod("web", "staging"),
    count: 3,
  },
  {
    attributes: db("postgresql", "postgres.data"),
    caller: pod("shop", "production"),
    count: 5,
  },
  { attributes: db("postgresql", "POSTGRES.DATA"), caller: pod("shop", null) },
  { attributes: db("postgresql", "postgres.data"), caller: pod(null, "prod") },
  { attributes: db("postgresql", "postgres.data"), caller: VM },
  // A namespace of whitespace only (NBSP) is no namespace.
  {
    attributes: db("postgresql", "postgres.data"),
    caller: pod("  ", null),
  },
  // StatefulSet members of the caller's own namespace.
  {
    attributes: db("mongodb", "mongo-0.mongo-headless"),
    caller: pod("data", "prod"),
  },
  {
    attributes: db("redis", "redis-node-2.redis-headless:6379"),
    caller: pod("cache", "prod"),
  },
  // Service DNS, private zones, link-local and IPv6.
  { attributes: db("postgresql", "orders.shop.svc"), caller: pod("x", "prod") },
  {
    attributes: db("postgresql", "ip-10-0-0-5.ec2.internal"),
    caller: pod("x", "prod"),
  },
  { attributes: db("postgresql", "ip-10-0-0-5.ec2.internal"), caller: VM },
  { attributes: db("postgresql", "169.254.1.10"), caller: pod("x", "prod") },
  { attributes: db("postgresql", "[fd00::5]:5432"), caller: pod("x", "prod") },
  { attributes: db("postgresql", "8.8.8.8"), caller: pod("x", "prod") },
  { attributes: db("postgresql", "host.minikube.internal"), caller: VM },
  // The dotless-predicate finding's probes.
  {
    attributes: db("postgresql", "postgresql://svc.user@postgres:5432/db"),
    caller: pod("prod", "c1"),
  },
  { attributes: db("postgresql", "postgres."), caller: pod("prod", "c1") },
  {
    attributes: db("mongodb", "mongo-a:27017,mongo-b.example.com:27017"),
    caller: pod("prod", "c1"),
  },
  {
    attributes: db("mssql", "jdbc:sqlserver://mssql:1433;databaseName=app.db"),
    caller: pod("prod", "c1"),
  },
  // SQL Server named instances: in the address and beside it.
  {
    attributes: db("microsoft.sql_server", "sql1.corp.example.com", {
      "db.mssql.instance_name": "INST01",
    }),
    caller: VM,
    count: 2,
  },
  {
    attributes: db("microsoft.sql_server", "sql1.corp.example.com", {
      "db.namespace": "INST02|orders",
    }),
    caller: VM,
  },
  {
    attributes: db("mssql", "sql1.corp.example.com\\INST03"),
    caller: VM,
  },
  {
    attributes: db("microsoft.sql_server", "sql1.corp.example.com", {
      "db.namespace": "orders",
    }),
    caller: VM,
  },
  // A managed cluster's members.
  {
    attributes: db("mongodb", "c0-shard-00-00.abcd.mongodb.net"),
    caller: VM,
    count: 3,
  },
  {
    attributes: db("mongodb", "c0-shard-00-01.abcd.mongodb.net"),
    caller: VM,
    count: 6,
  },
  {
    attributes: db("mongodb", "c0-shard-00-02.abcd.mongodb.net"),
    caller: VM,
  },
  /*
   * The e2e run's rare-db window, attributes as node-postgres
   * (@opentelemetry/instrumentation-pg 0.74.0) sent them: each of 4 queries
   * came with a pool checkout and a client connect. 4 calls, not 12.
   */
  {
    attributes: db("postgresql", "rare-db.example.com", {
      "server.port": "5432",
      "db.namespace": "orders",
      "db.query.text": "SELECT 1 AS ok",
    }),
    caller: VM,
    name: "pg.query:SELECT orders",
    count: 4,
  },
  {
    attributes: db("postgresql", "rare-db.example.com", {
      "server.port": "5432",
      "db.namespace": "orders",
      "db.postgresql.idle.timeout.millis": "10000",
    }),
    caller: VM,
    name: "pg-pool.connect",
    count: 4,
  },
  {
    attributes: db("postgresql", "rare-db.example.com", {
      "server.port": "5432",
      "db.namespace": "orders",
    }),
    caller: VM,
    name: "pg.connect",
    count: 4,
  },
  // ioredis 0.70.0: its connect span carries db.query.text as well.
  {
    attributes: db("redis", "legacy-cache.example.com", {
      "server.port": "6379",
      "db.query.text": "connect",
    }),
    caller: VM,
    name: "connect",
  },
  {
    attributes: db("redis", "legacy-cache.example.com", {
      "server.port": "6379",
      "db.operation.name": "info",
      "db.query.text": "info",
    }),
    caller: VM,
    name: "info",
    count: 2,
  },
  // Nothing but connection spans: the group is still read, with no calls.
  {
    attributes: db("postgresql", "idle-pool.example.com", {
      "server.port": "5432",
    }),
    caller: VM,
    name: " PG-POOL.CONNECT ",
    count: 3,
  },
  // A span without a name is a query.
  {
    attributes: db("postgresql", "unnamed.example.com"),
    caller: VM,
    name: null,
  },
  /*
   * Never counted: a SERVER span, a span without a system, another
   * project, and a span outside the window.
   */
  {
    attributes: db("postgresql", "never.example.com"),
    caller: VM,
    kind: SpanKind.Server,
  },
  {
    attributes: { "server.address": "never.example.com" },
    caller: VM,
  },
  {
    attributes: db("postgresql", "never.example.com"),
    caller: VM,
    projectId: OTHER_PROJECT_ID,
  },
  {
    attributes: db("postgresql", "never.example.com"),
    caller: VM,
    minutesAgo: 120,
  },
];

function isCounted(fixture: SpanFixture): boolean {
  return (
    (fixture.kind || SpanKind.Client) === SpanKind.Client &&
    (fixture.projectId || PROJECT_ID) === PROJECT_ID &&
    (fixture.minutesAgo || 1) < 15
  );
}

function allAttributes(fixture: SpanFixture): Record<string, string> {
  return { ...fixture.caller, ...fixture.attributes };
}

function spanRows(): Array<JSONObject> {
  const rowsToInsert: Array<JSONObject> = [];
  let index: number = 0;

  for (const fixture of SPANS) {
    for (let copy: number = 0; copy < (fixture.count || 1); copy++) {
      index++;
      const start: Date = new Date(
        now - (fixture.minutesAgo || 1) * 60 * 1000 - index * 10,
      );
      const attributes: Record<string, string> = allAttributes(fixture);
      rowsToInsert.push({
        projectId: fixture.projectId || PROJECT_ID,
        primaryEntityId: ObjectID.generate().toString(),
        primaryEntityType: "OpenTelemetry",
        startTime: OneUptimeDate.toClickhouseDateTime64(start),
        endTime: OneUptimeDate.toClickhouseDateTime64(start),
        startTimeUnixNano: String(start.getTime() * 1000000),
        endTimeUnixNano: String(start.getTime() * 1000000),
        durationUnixNano: "1000000",
        traceId: `trace-${index}`,
        spanId: `span-${index}`,
        parentSpanId: "",
        attributes: attributes,
        attributeKeys: Object.keys(attributes),
        entityKeys: [],
        statusCode: 0,
        name: fixture.name === undefined ? "query" : fixture.name,
        kind: fixture.kind || SpanKind.Client,
        retentionDate: retentionDate,
      });
    }
  }

  return rowsToInsert;
}

async function createSpanTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
): Promise<string> {
  const model: AnalyticsBaseModel = new Span();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: Span as unknown as { new (): AnalyticsBaseModel },
      database: clickhouse,
    });

  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });

  return model.tableName;
}

// What the query's SELECT must produce for one span: the TypeScript twin.
function expectedGroupKey(fixture: SpanFixture): string | null {
  if (!isCounted(fixture)) {
    return null;
  }

  const attributes: Record<string, string> = allAttributes(fixture);
  const first: (keys: ReadonlyArray<string>) => string = (
    keys: ReadonlyArray<string>,
  ): string => {
    for (const key of keys) {
      const value: string | undefined = attributes[key];
      if (value !== undefined && value !== "") {
        return value;
      }
    }
    return "";
  };

  const system: string = first(DATABASE_SYSTEM_ATTRIBUTES);
  const address: string = first(DATABASE_ADDRESS_ATTRIBUTES);
  if (!system || !address) {
    return null;
  }

  const namespaceAttribute: string = attributes["db.namespace"] || "";
  const instance: string =
    attributes["db.mssql.instance_name"] ||
    (namespaceAttribute.includes("|") ? namespaceAttribute.split("|")[0]! : "");

  const needs: { namespace: boolean; kubernetes: boolean; cluster: boolean } =
    getDatabaseEndpointCallerContextNeeds(address);
  const namespace: string = attributes[CALLER_NAMESPACE_ATTRIBUTE] || "";

  return JSON.stringify([
    system,
    address,
    first(DATABASE_PORT_ATTRIBUTES),
    instance,
    needs.namespace ? namespace : "",
    needs.kubernetes && namespace.trim() ? 1 : 0,
    needs.cluster ? attributes[CALLER_CLUSTER_ATTRIBUTE] || "" : "",
  ]);
}

function rowGroupKey(row: DatabaseEndpointRow): string {
  return JSON.stringify([
    row.dbSystem,
    row.serverAddress,
    row.serverPort,
    row.dbInstance,
    row.callerNamespace,
    Number(row.callerInKubernetes),
    row.callerCluster,
  ]);
}

integration("Client-span database discovery SQL against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let rows: Array<DatabaseEndpointRow> = [];

  async function runDiscoveryQuery(
    tableName: string,
    maxRows: number,
  ): Promise<Array<DatabaseEndpointRow>> {
    const sql: string = buildDatabaseEndpointSql({
      projectId: PROJECT_ID,
      startSql: `toDateTime64('${OneUptimeDate.toClickhouseDateTime64(WINDOW_START)}', 9)`,
      endSql: `toDateTime64('${OneUptimeDate.toClickhouseDateTime64(WINDOW_END)}', 9)`,
      maxRows: maxRows,
    });
    expect(sql).toContain(`FROM oneuptime.${tableName}`);

    const result: { json: () => Promise<unknown> } = await client.query({
      query: sql.replace(
        `FROM oneuptime.${tableName}`,
        `FROM ${database}.${tableName}`,
      ),
      format: "JSON",
    });
    const parsed: { data: Array<DatabaseEndpointRow> } =
      (await result.json()) as { data: Array<DatabaseEndpointRow> };
    return parsed.data;
  }

  let tableName: string = "";

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 60000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    tableName = await createSpanTable(client, clickhouse);

    await client.insert({
      table: `${database}.${tableName}`,
      values: spanRows(),
      format: "JSONEachRow",
    });

    rows = await runDiscoveryQuery(tableName, 500);
  });

  afterAll(async (): Promise<void> => {
    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("the query runs and returns grouped rows", () => {
    expect(rows.length).toBeGreaterThan(20);
  });

  test("every row is exactly the group the TypeScript twin predicts, with its span count", () => {
    const expected: Map<string, number> = new Map<string, number>();
    for (const fixture of SPANS) {
      const key: string | null = expectedGroupKey(fixture);
      if (key) {
        expected.set(key, (expected.get(key) || 0) + callsOf(fixture));
      }
    }

    const actual: Map<string, number> = new Map<string, number>();
    for (const row of rows) {
      actual.set(rowGroupKey(row), Number(row.callCount));
    }

    expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected));
  });

  test("connection spans are read but never counted: the e2e rare-db window is 4 calls", () => {
    const byEndpoint: Map<string, DiscoveredDatabaseEndpoint> = new Map<
      string,
      DiscoveredDatabaseEndpoint
    >(
      resolveDatabaseEndpointRows(rows).map(
        (
          entry: DiscoveredDatabaseEndpoint,
        ): [string, DiscoveredDatabaseEndpoint] => {
          return [formatDatabaseEndpoint(entry.endpoint), entry];
        },
      ),
    );

    // 4 queries + 4 pool checkouts + 4 client connects.
    const rare: DiscoveredDatabaseEndpoint | undefined = byEndpoint.get(
      "rare-db.example.com:5432",
    );
    expect(rare?.callCount).toBe(4);
    expect(
      isDatabaseEndpointAutoCreateCandidate({
        discovered: rare!,
        minCalls: DEFAULT_DATABASE_SERVER_MIN_CALLS,
      }),
    ).toBe(false);

    // ioredis: 2 commands; its connect span carries db.query.text and still is not one.
    expect(byEndpoint.get("legacy-cache.example.com:6379")?.callCount).toBe(2);

    // A group of nothing but connection spans is read (it can sight a row) with no calls.
    expect(byEndpoint.get("idle-pool.example.com:5432")?.callCount).toBe(0);

    // A span with no name is a query.
    expect(byEndpoint.get("unnamed.example.com:5432")?.callCount).toBe(1);
  });

  test("the ClickHouse predicate and isDatabaseConnectionSpanName agree on every listed name", async () => {
    const probes: Array<string> = [
      ...DATABASE_CONNECTION_SPAN_NAMES,
      ...DATABASE_CONNECTION_SPAN_NAMES.map((name: string): string => {
        return ` ${name.toUpperCase()} `;
      }),
      "pg.query:SELECT orders",
      "SELECT connect",
      "redis-GET",
      "",
    ];
    const result: { json: () => Promise<unknown> } = await client.query({
      query: `SELECT name, ${databaseQuerySpanSql("name")} AS isQuery FROM (SELECT arrayJoin({names:Array(String)}) AS name)`,
      query_params: { names: probes },
      format: "JSON",
    });
    const parsed: { data: Array<{ name: string; isQuery: number | string }> } =
      (await result.json()) as {
        data: Array<{ name: string; isQuery: number | string }>;
      };

    expect(parsed.data).toHaveLength(probes.length);
    for (const entry of parsed.data) {
      expect([entry.name, Number(entry.isQuery) === 1]).toEqual([
        entry.name,
        !isDatabaseConnectionSpanName(entry.name),
      ]);
    }
  });

  test("SERVER spans, spans without a system, other projects and old spans are never read", () => {
    for (const row of rows) {
      expect(row.serverAddress).not.toBe("never.example.com");
    }
  });

  test("the cron lands on exactly the endpoints ingest stamps on the spans", () => {
    const ingest: Map<string, number> = new Map<string, number>();
    for (const fixture of SPANS) {
      if (!isCounted(fixture)) {
        continue;
      }
      const attributes: Record<string, string> = allAttributes(fixture);
      const target: { endpoint: DatabaseEndpoint } | null =
        resolveDatabaseCallTarget({
          getAttribute: (key: string): unknown => {
            return attributes[key];
          },
          caller: buildDatabaseCallerContext(attributes),
        });
      if (target) {
        const key: string = formatDatabaseEndpoint(target.endpoint);
        ingest.set(key, (ingest.get(key) || 0) + callsOf(fixture));
      }
    }

    const discovered: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows(rows);
    const cronEndpoints: Array<string> = discovered
      .flatMap(getDiscoveredDatabaseEndpoints)
      .map((entry: DatabaseEndpoint): string => {
        return formatDatabaseEndpoint(entry);
      });

    expect([...cronEndpoints].sort()).toEqual(Array.from(ingest.keys()).sort());

    let cronCalls: number = 0;
    for (const entry of discovered) {
      cronCalls += entry.callCount;
    }
    let ingestCalls: number = 0;
    for (const calls of ingest.values()) {
      ingestCalls += calls;
    }
    expect(cronCalls).toBe(ingestCalls);
  });

  test("the audit's probes resolve as the endpoint rules say", () => {
    const discovered: Array<DiscoveredDatabaseEndpoint> =
      resolveDatabaseEndpointRows(rows);
    const byEndpoint: Map<string, DiscoveredDatabaseEndpoint> = new Map<
      string,
      DiscoveredDatabaseEndpoint
    >(
      discovered.map(
        (
          entry: DiscoveredDatabaseEndpoint,
        ): [string, DiscoveredDatabaseEndpoint] => {
          return [formatDatabaseEndpoint(entry.endpoint), entry];
        },
      ),
    );

    // postgres.data: one endpoint per cluster, never one global row.
    expect(
      byEndpoint.get("postgres.data.svc.cluster.local:5432@staging")?.callCount,
    ).toBe(7);
    expect(
      byEndpoint.get("postgres.data.svc.cluster.local:5432@production")
        ?.callCount,
    ).toBe(5);
    expect(
      byEndpoint.get("postgres.data.svc.cluster.local:5432@prod")?.callCount,
    ).toBe(1);
    /*
     * No cluster: one local endpoint for the namespaced caller; the NBSP
     * "namespace" and the VM read the name as a domain.
     */
    expect(byEndpoint.get("postgres.data.svc.cluster.local:5432")?.scope).toBe(
      "local",
    );
    expect(byEndpoint.get("postgres.data:5432")?.callCount).toBe(2);

    // The dotless-predicate probes keep their caller's context.
    expect(
      byEndpoint.get("postgres.prod.svc.cluster.local:5432@c1")?.callCount,
    ).toBe(2);
    expect(byEndpoint.has("mongo-a.prod.svc.cluster.local:27017@c1")).toBe(
      true,
    );
    expect(byEndpoint.has("mssql.prod.svc.cluster.local:1433@c1")).toBe(true);

    // StatefulSet members keep the caller's namespace.
    expect(
      byEndpoint.has(
        "mongo-0.mongo-headless.data.svc.cluster.local:27017@prod",
      ),
    ).toBe(true);
    expect(
      byEndpoint.has(
        "redis-node-2.redis-headless.cache.svc.cluster.local:6379@prod",
      ),
    ).toBe(true);

    // SQL Server named instances stay apart; the default instance is 1433.
    expect(byEndpoint.get("sql1.corp.example.com\\inst01")?.callCount).toBe(2);
    expect(byEndpoint.has("sql1.corp.example.com\\inst02")).toBe(true);
    expect(byEndpoint.has("sql1.corp.example.com\\inst03")).toBe(true);
    expect(byEndpoint.has("sql1.corp.example.com:1433")).toBe(true);

    // Per-network names.
    expect(byEndpoint.get("169.254.1.10:5432@prod")?.scope).toBe("local");
    expect(byEndpoint.get("ip-10-0-0-5.ec2.internal:5432")?.scope).toBe(
      "local",
    );
    expect(byEndpoint.get("ip-10-0-0-5.ec2.internal:5432@prod")?.scope).toBe(
      "global",
    );

    // The Atlas members are one database, recorded under the busiest.
    const atlas: DiscoveredDatabaseEndpoint | undefined = byEndpoint.get(
      "c0-shard-00-01.abcd.mongodb.net:27017",
    );
    expect(atlas?.callCount).toBe(10);
    expect(atlas?.siblings).toHaveLength(2);
    expect(atlas?.displayName).toBe("MongoDB c0.abcd.mongodb.net:27017");
  });

  test("rows naming an IP address come after every host-named row", () => {
    const isIpRow: Array<boolean> = rows.map(
      (row: DatabaseEndpointRow): boolean => {
        const address: string = (row.serverAddress || "").toLowerCase();
        const host: string = address.startsWith("[")
          ? address.substring(1, address.indexOf("]"))
          : address.split(":").length > 2
            ? address
            : address.split(":")[0]!;
        return isIpLiteralHost(host);
      },
    );
    const firstIp: number = isIpRow.indexOf(true);
    expect(firstIp).toBeGreaterThan(0);
    expect(isIpRow.slice(firstIp).every(Boolean)).toBe(true);
  });

  test("with a tight row cap, host-named groups win over busier IP groups", async () => {
    const capped: Array<DatabaseEndpointRow> = await runDiscoveryQuery(
      tableName,
      3,
    );
    expect(capped).toHaveLength(3);
    for (const row of capped) {
      expect(isIpLiteralHost(row.serverAddress || "")).toBe(false);
    }
    // …and among those, the busiest first.
    expect(Number(capped[0]!.callCount)).toBeGreaterThanOrEqual(
      Number(capped[1]!.callCount),
    );
  });
});

describe("Client-span database discovery ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
