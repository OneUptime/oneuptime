import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import Span from "Common/Models/AnalyticsModels/Span";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService, {
  ClickHouseSettings,
} from "Common/Server/Services/AnalyticsDatabaseService";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import SecurityConnectedRecords from "Common/Server/Utils/SecurityEvent/Connections/SecurityConnectedRecords";
import SecurityTelemetryMentions from "Common/Server/Utils/SecurityEvent/Connections/SecurityTelemetryMentions";
import TelemetryReadAccess from "Common/Server/Utils/Telemetry/TelemetryReadAccess";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_TELEMETRY_MESSAGE_PLACE,
  SecurityConnectionKind,
  SecurityTelemetryHitsJson,
  SecurityTelemetryMentionsJson,
  SecurityTelemetryValueJson,
} from "Common/Types/SecurityCase/SecurityConnection";
import {
  SecurityEntity,
  SecurityEntityType,
} from "Common/Types/SecurityCase/SecurityEntity";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * "In your logs and traces" against a real ClickHouse server, under its
 * current analyzer and the older one: the one read per signal
 * (SecurityTelemetryStatements) that finds where a case's values appear in
 * the log lines and spans of its window, run through
 * SecurityTelemetryMentions as the API runs it.
 *
 *   a log line   names a value when its message names it whole (never as
 *                part of a longer address or name, whatever the case) or an
 *                attribute holds it exactly in a usual spelling - never a
 *                resource attribute, which only says who sent the line;
 *   a span       when an attribute holds it exactly;
 *
 * and for each value: how many, the records that sent them, where in them
 * it was and the value as the attribute holds it - one project's rows,
 * the window's, the records the reader may read.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server,
 * credentials in the URL:
 *
 *   docker run -d --rm --name security-telemetry-ch -p 18431:8123 \
 *     -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18431 \
 *     npx jest Tests/Telemetry/SecurityTelemetryMentionsClickhouse.test.ts
 *
 * The suite creates and drops only its own uniquely named database. The
 * App Test workflow provides the server, and the guard at the bottom fails
 * the run there if it ever goes missing.
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

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `security_telemetry_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;

// The window the reads look at, ending at a fixed minute: the rows are written around it.
const END: Date = new Date(
  Math.floor(Date.now() / MINUTE) * MINUTE - 60 * MINUTE,
);
const START: Date = new Date(END.getTime() - 120 * MINUTE);

function inside(minutesBeforeEnd: number): Date {
  return new Date(END.getTime() - minutesBeforeEnd * MINUTE);
}

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

interface Connection {
  name: string;
  database: ClickhouseDatabase;
  client: ClickhouseClient;
  olderAnalyzerSetting: string | null;
}

async function readJson<T>(
  client: ClickhouseClient,
  query: string,
): Promise<Array<T>> {
  const result: { json: () => Promise<unknown> } = await client.query({
    query: query,
    format: "JSONEachRow",
  });

  return (await result.json()) as Array<T>;
}

// The model's own table under a plain MergeTree (no Keeper on a disposable server).
async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
  modelType: { new (): AnalyticsBaseModel },
): Promise<void> {
  const model: AnalyticsBaseModel = new modelType();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
      database: clickhouse,
    });
  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

interface Sender {
  id: ObjectID;
  type: ServiceType;
}

function logRow(data: {
  projectId: ObjectID;
  sender: Sender;
  time: Date;
  body: string | null;
  attributes?: Record<string, string> | undefined;
}): JSONObject {
  const attributes: Record<string, string> = data.attributes || {};

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(data.time),
    projectId: data.projectId.toString(),
    primaryEntityId: data.sender.id.toString(),
    primaryEntityType: data.sender.type,
    time: OneUptimeDate.toClickhouseDateTime64(data.time),
    timeUnixNano: String(data.time.getTime() * 1000000),
    severityText: "Information",
    severityNumber: 9,
    attributes,
    attributeKeys: Object.keys(attributes).sort(),
    entityKeys: [],
    traceId: "",
    spanId: "",
    body: data.body,
    retentionDate,
  };
}

function spanRow(data: {
  projectId: ObjectID;
  sender: Sender;
  time: Date;
  attributes: Record<string, string>;
}): JSONObject {
  const startNs: string = String(BigInt(data.time.getTime()) * BigInt(1000000));

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(data.time),
    projectId: data.projectId.toString(),
    primaryEntityId: data.sender.id.toString(),
    primaryEntityType: data.sender.type,
    startTime: OneUptimeDate.toClickhouseDateTime64(data.time),
    endTime: OneUptimeDate.toClickhouseDateTime64(data.time),
    startTimeUnixNano: startNs,
    endTimeUnixNano: startNs,
    durationUnixNano: "1000000",
    traceId: ObjectID.generate().toString(),
    spanId: ObjectID.generate().toString(),
    parentSpanId: "",
    attributes: data.attributes,
    attributeKeys: Object.keys(data.attributes).sort(),
    entityKeys: [],
    statusCode: 0,
    name: "GET /login",
    kind: "SPAN_KIND_SERVER",
    isRootSpan: true,
    retentionDate,
  };
}

type ConnectableService = {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
};

const services: Array<ConnectableService> = [
  LogService as unknown as ConnectableService,
  SpanService as unknown as ConnectableService,
];

const ATTACKER: SecurityEntity = {
  type: SecurityEntityType.IpAddress,
  value: "203.0.113.7",
};
const EMAIL: SecurityEntity = {
  type: SecurityEntityType.User,
  value: "k.morgan@acme.example",
};
const DOMAIN: SecurityEntity = {
  type: SecurityEntityType.Domain,
  value: "evil-c2.example.net",
};
const PRIVATE: SecurityEntity = {
  type: SecurityEntityType.IpAddress,
  value: "10.0.0.1",
};
const NOWHERE: SecurityEntity = {
  type: SecurityEntityType.Domain,
  value: "nowhere.example",
};

const ENTITIES: Array<SecurityEntity> = [
  ATTACKER,
  EMAIL,
  DOMAIN,
  PRIVATE,
  NOWHERE,
  // Never searched for: a bare host name and a user's bare name.
  { type: SecurityEntityType.Host, value: "web-1" },
  { type: SecurityEntityType.User, value: "root" },
];

function valueOf(
  mentions: SecurityTelemetryMentionsJson,
  entity: SecurityEntity,
): SecurityTelemetryValueJson {
  const found: SecurityTelemetryValueJson | undefined = mentions.values.find(
    (value: SecurityTelemetryValueJson): boolean => {
      return value.entityValue === entity.value;
    },
  );

  expect(found).toBeDefined();

  return found!;
}

integration("In your logs and traces, against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let options: ClickHouseClientConfigOptions;
  const connections: Array<Connection> = [];
  const originals: Array<{
    database: ClickhouseDatabase;
    databaseClient: ClickhouseClient | null;
  }> = [];

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    options = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 120000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    await createTable(client, clickhouse, Log);
    await createTable(
      client,
      clickhouse,
      Span as unknown as { new (): AnalyticsBaseModel },
    );

    connections.push({
      name: "the current analyzer",
      database: clickhouse,
      client: client,
      olderAnalyzerSetting: null,
    });

    const [setting] = await readJson<{ name: string }>(
      client,
      "SELECT name FROM system.settings WHERE name IN ('enable_analyzer', 'allow_experimental_analyzer') ORDER BY name = 'enable_analyzer' DESC LIMIT 1",
    );

    if (setting) {
      const olderOptions: ClickHouseClientConfigOptions = {
        ...options,
        clickhouse_settings: { [setting.name]: 0 } as ClickHouseSettings,
      };
      const olderDatabase: ClickhouseDatabase = new ClickhouseDatabase(
        olderOptions,
      );
      const olderClient: ClickhouseClient =
        await olderDatabase.connect(olderOptions);

      connections.push({
        name: "the older analyzer",
        database: olderDatabase,
        client: olderClient,
        olderAnalyzerSetting: setting.name,
      });
    }

    for (const service of services) {
      originals.push({
        database: service.database,
        databaseClient: service.databaseClient,
      });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async (): Promise<void> => {
    services.forEach((service: ConnectableService, index: number): void => {
      if (originals[index]) {
        Object.assign(service, originals[index]);
      }
    });

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    for (const connection of connections) {
      await connection.database.disconnect();
    }
  });

  test("the server knows the older analyzer, so both are run", () => {
    expect(
      connections.map((connection: Connection): string => {
        return connection.name;
      }),
    ).toEqual(["the current analyzer", "the older analyzer"]);
  });

  test("the older connection reads with the older analyzer", async () => {
    const older: Connection | undefined = connections[1];

    expect(older?.olderAnalyzerSetting).toBeTruthy();

    const [row] = await readJson<{ analyzer: string | number }>(
      older!.client,
      `SELECT toUInt8(getSetting('${older!.olderAnalyzerSetting}')) AS analyzer`,
    );

    expect(Number(row!.analyzer)).toBe(0);
  });

  describe.each([
    ["the current analyzer", 0],
    ["the older analyzer (enable_analyzer = 0)", 1],
  ])("through %s", (_name: string, position: number) => {
    // A project of each run's own, so the two runs never read each other's rows.
    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const checkout: Sender = {
      id: ObjectID.generate(),
      type: ServiceType.OpenTelemetry,
    };
    const auth: Sender = {
      id: ObjectID.generate(),
      type: ServiceType.OpenTelemetry,
    };
    const resolver: Sender = {
      id: ObjectID.generate(),
      type: ServiceType.OpenTelemetry,
    };
    const edge: Sender = { id: ObjectID.generate(), type: ServiceType.Host };
    // A service the reader of one test may not read.
    const hidden: Sender = {
      id: ObjectID.generate(),
      type: ServiceType.OpenTelemetry,
    };

    const NAMES: Map<string, { kind: SecurityConnectionKind; name: string }> =
      new Map([
        [
          `${SecurityConnectionKind.Service}:${checkout.id.toString()}`,
          { kind: SecurityConnectionKind.Service, name: "checkout-api" },
        ],
        [
          `${SecurityConnectionKind.Service}:${auth.id.toString()}`,
          { kind: SecurityConnectionKind.Service, name: "auth" },
        ],
        [
          `${SecurityConnectionKind.Service}:${resolver.id.toString()}`,
          { kind: SecurityConnectionKind.Service, name: "dns-resolver" },
        ],
        [
          `${SecurityConnectionKind.Host}:${edge.id.toString()}`,
          { kind: SecurityConnectionKind.Host, name: "edge-1" },
        ],
      ]);

    async function search(): Promise<SecurityTelemetryMentionsJson> {
      jest
        .spyOn(SecurityConnectedRecords, "readNamesOfLogResources")
        .mockResolvedValue(NAMES);

      return await SecurityTelemetryMentions.search({
        projectId,
        entities: ENTITIES,
        window: { start: START, end: END },
        props: { isRoot: true },
      });
    }

    beforeAll(async (): Promise<void> => {
      const connection: Connection = connections[position]!;

      for (const service of services) {
        service.database = connection.database;
        service.databaseClient = connection.client;
      }

      await client.insert({
        table: `${database}.${new Log().tableName}`,
        format: "JSONEachRow",
        values: [
          // The attacker in a message, twice from checkout-api.
          logRow({
            projectId,
            sender: checkout,
            time: inside(10),
            body: "Failed password for deploy from 203.0.113.7 port 52144 ssh2",
          }),
          logRow({
            projectId,
            sender: checkout,
            time: inside(5),
            body: "GET /login 401",
            attributes: { "client.address": "203.0.113.7" },
          }),
          // Another address it is part of: never the attacker.
          logRow({
            projectId,
            sender: checkout,
            time: inside(8),
            body: "Accepted from 203.0.113.70 port 22",
          }),
          /*
           * In a host's message, and in its resource attribute - which only
           * says who sent it, and is never a place it was found in.
           */
          logRow({
            projectId,
            sender: edge,
            time: inside(20),
            body: "upstream 203.0.113.7:443 timed out",
            attributes: { "resource.host.ip": "203.0.113.7" },
          }),
          // A resource attribute alone names nothing.
          logRow({
            projectId,
            sender: edge,
            time: inside(21),
            body: "heartbeat",
            attributes: { "resource.host.ip": "203.0.113.7" },
          }),
          // A service the reader of one test may not read.
          logRow({
            projectId,
            sender: hidden,
            time: inside(30),
            body: "denied 203.0.113.7",
          }),
          // The email: in a line with no message, and in another's message.
          logRow({
            projectId,
            sender: auth,
            time: inside(40),
            body: null,
            attributes: { "user.email": "k.morgan@acme.example" },
          }),
          logRow({
            projectId,
            sender: auth,
            time: inside(41),
            body: "Login failed for K.Morgan@acme.example",
          }),
          // An attribute is matched exactly: a spelling the case did not write is not it.
          logRow({
            projectId,
            sender: auth,
            time: inside(42),
            body: "session",
            attributes: { "user.email": "K.Morgan@Acme.Example" },
          }),
          // The domain in a resolver's message.
          logRow({
            projectId,
            sender: resolver,
            time: inside(50),
            body: "query[A] evil-c2.example.net from 10.0.0.12",
          }),
          // Never inside a longer name.
          logRow({
            projectId,
            sender: resolver,
            time: inside(51),
            body: "query[A] evil-c2.example.network",
          }),
          // The private address, as a whole, once.
          logRow({
            projectId,
            sender: resolver,
            time: inside(52),
            body: "reply to 10.0.0.1.",
          }),
          // Outside the window, and another project's: never read.
          logRow({
            projectId,
            sender: checkout,
            time: new Date(START.getTime() - MINUTE),
            body: "from 203.0.113.7",
          }),
          logRow({
            projectId,
            sender: checkout,
            time: new Date(END.getTime() + MINUTE),
            body: "from 203.0.113.7",
          }),
          logRow({
            projectId: otherProjectId,
            sender: checkout,
            time: inside(10),
            body: "from 203.0.113.7 evil-c2.example.net",
          }),
        ],
        clickhouse_settings: { wait_for_async_insert: 1 },
      });

      await client.insert({
        table: `${database}.${new Span().tableName}`,
        format: "JSONEachRow",
        values: [
          spanRow({
            projectId,
            sender: checkout,
            time: inside(10),
            attributes: {
              "client.address": "203.0.113.7",
              "http.route": "/login",
            },
          }),
          spanRow({
            projectId,
            sender: checkout,
            time: inside(11),
            attributes: { "net.peer.ip": "203.0.113.7" },
          }),
          // Under two keys: one span, a place each.
          spanRow({
            projectId,
            sender: checkout,
            time: inside(12),
            attributes: {
              "client.address": "203.0.113.7",
              "net.peer.ip": "203.0.113.7",
            },
          }),
          // The domain, upper case, as a client wrote it.
          spanRow({
            projectId,
            sender: resolver,
            time: inside(13),
            attributes: { "server.address": "EVIL-C2.EXAMPLE.NET" },
          }),
          // A resource attribute names nothing.
          spanRow({
            projectId,
            sender: resolver,
            time: inside(14),
            attributes: { "resource.host.name": "evil-c2.example.net" },
          }),
          // Another project's span.
          spanRow({
            projectId: otherProjectId,
            sender: checkout,
            time: inside(10),
            attributes: { "client.address": "203.0.113.7" },
          }),
        ],
        clickhouse_settings: { wait_for_async_insert: 1 },
      });
    });

    test("every value named, in the order named, each signal read", async () => {
      const mentions: SecurityTelemetryMentionsJson = await search();

      expect(
        mentions.values.map((value: SecurityTelemetryValueJson): string => {
          return value.entityValue;
        }),
      ).toEqual([
        "203.0.113.7",
        "k.morgan@acme.example",
        "evil-c2.example.net",
        "10.0.0.1",
        "nowhere.example",
      ]);
      expect(mentions.unreadableSignals).toEqual([]);
      expect(mentions.failedSignals).toEqual([]);
      expect(mentions.hasMoreValues).toBe(false);
      expect(mentions.windowStart).toBe(START.toISOString());
      expect(mentions.windowEnd).toBe(END.toISOString());
    });

    test("the attacker's log lines: in a message or an attribute, never a longer address or a resource attribute, the records that sent them the most first", async () => {
      const logs: SecurityTelemetryHitsJson = valueOf(
        await search(),
        ATTACKER,
      ).logs!;

      // checkout-api's two, edge-1's one and the hidden service's one.
      expect(logs.count).toBe(4);
      expect(logs.sourceCount).toBe(3);
      expect(logs.sources).toEqual([
        {
          kind: SecurityConnectionKind.Service,
          id: checkout.id.toString(),
          name: "checkout-api",
          count: 2,
        },
        {
          kind: SecurityConnectionKind.Host,
          id: edge.id.toString(),
          name: "edge-1",
          count: 1,
        },
      ]);
      expect(logs.places).toEqual([
        { key: SECURITY_TELEMETRY_MESSAGE_PLACE, count: 3 },
        { key: "client.address", count: 1, value: "203.0.113.7" },
      ]);
      expect(new Date(logs.lastSeen!).getTime()).toBe(inside(5).getTime());
    });

    test("the attacker's spans: each counted once, a place for each key holding it", async () => {
      const traces: SecurityTelemetryHitsJson = valueOf(
        await search(),
        ATTACKER,
      ).traces!;

      expect(traces.count).toBe(3);
      expect(traces.sources).toEqual([
        {
          kind: SecurityConnectionKind.Service,
          id: checkout.id.toString(),
          name: "checkout-api",
          count: 3,
        },
      ]);
      expect(traces.places).toEqual([
        { key: "client.address", count: 2, value: "203.0.113.7" },
        { key: "net.peer.ip", count: 2, value: "203.0.113.7" },
      ]);
    });

    test("an email in a message whatever its case, in an attribute only as spelled", async () => {
      const email: SecurityTelemetryValueJson = valueOf(await search(), EMAIL);

      expect(email.logs!.count).toBe(2);
      expect(email.logs!.places).toEqual([
        { key: SECURITY_TELEMETRY_MESSAGE_PLACE, count: 1 },
        { key: "user.email", count: 1, value: "k.morgan@acme.example" },
      ]);
      expect(email.traces!.count).toBe(0);
    });

    test("a domain: never inside a longer name; a span's attribute in upper case, as the span holds it", async () => {
      const domain: SecurityTelemetryValueJson = valueOf(
        await search(),
        DOMAIN,
      );

      expect(domain.logs!.count).toBe(1);
      expect(domain.logs!.sources).toEqual([
        {
          kind: SecurityConnectionKind.Service,
          id: resolver.id.toString(),
          name: "dns-resolver",
          count: 1,
        },
      ]);
      expect(domain.traces!.count).toBe(1);
      expect(domain.traces!.places).toEqual([
        { key: "server.address", count: 1, value: "EVIL-C2.EXAMPLE.NET" },
      ]);
    });

    test("a private address as a whole: not in a longer one", async () => {
      const address: SecurityTelemetryValueJson = valueOf(
        await search(),
        PRIVATE,
      );

      expect(address.logs!.count).toBe(1);
      expect(address.traces!.count).toBe(0);
    });

    test("a value nothing names: read in both signals, and none", async () => {
      expect(valueOf(await search(), NOWHERE)).toEqual({
        entityType: SecurityEntityType.Domain,
        entityValue: "nowhere.example",
        logs: {
          count: 0,
          sources: [],
          sourceCount: 0,
          places: [],
          lastSeen: null,
        },
        traces: {
          count: 0,
          sources: [],
          sourceCount: 0,
          places: [],
          lastSeen: null,
        },
      });
    });

    test("the records the reader may not read are not searched", async () => {
      jest
        .spyOn(TelemetryReadAccess, "getServiceFilter")
        .mockResolvedValue({ excludedServiceIds: [hidden.id] });

      const logs: SecurityTelemetryHitsJson = valueOf(
        await search(),
        ATTACKER,
      ).logs!;

      expect(logs.count).toBe(3);
      expect(logs.sourceCount).toBe(2);
    });

    test("a reader of one service reads that service's lines alone", async () => {
      jest
        .spyOn(TelemetryReadAccess, "getServiceFilter")
        .mockResolvedValue({ serviceIds: [edge.id] });

      const mentions: SecurityTelemetryMentionsJson = await search();

      expect(valueOf(mentions, ATTACKER).logs!.count).toBe(1);
      expect(valueOf(mentions, ATTACKER).traces!.count).toBe(0);
    });

    test("the read stops at its own time limit, and throws rather than answering short", async () => {
      const statements: Array<string> = [];
      const logService: AnalyticsDatabaseService<AnalyticsBaseModel> =
        LogService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>;
      const original: AnalyticsDatabaseService<AnalyticsBaseModel>["executeQuery"] =
        logService.executeQuery.bind(logService);

      jest
        .spyOn(logService, "executeQuery")
        .mockImplementation(
          (statement: Statement | string): ReturnType<typeof original> => {
            statements.push(
              statement instanceof Statement ? statement.query : statement,
            );

            return original(statement);
          },
        );

      await search();

      expect(statements.length).toBe(1);
      expect(statements[0]).toContain("max_execution_time = 15");
      expect(statements[0]).toContain("timeout_overflow_mode = 'throw'");
    });
  });
});

describe("In your logs and traces ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
