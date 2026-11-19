import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { ClickHouseSettings } from "Common/Server/Services/AnalyticsDatabaseService";
import SecurityEventService from "Common/Server/Services/SecurityEventService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import {
  SQL,
  Statement,
} from "Common/Server/Utils/AnalyticsDatabase/Statement";
import SecurityDetectionMatchedEventsReader from "Common/Server/Utils/SecurityCase/SecurityDetectionMatchedEventsReader";
import SigmaClickhouseCompiler, {
  buildSigmaFieldExpression,
} from "Common/Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_DETECTION_MATCHED_EVENTS_MAX,
  SecurityDetectionMatchedEvent,
  SecurityDetectionMatchedEvents,
} from "Common/Types/SecurityCase/SecurityDetectionMatchedEvents";
import { DetectionRuleDefinition } from "Common/Types/SecurityEvent/SigmaCorrelation";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import SigmaRuleSetParser from "Common/Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
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
 * The events a detection keeps when it fires (#9619), read against a real
 * ClickHouse server, under its current analyzer and the older one
 * (SecurityDetectionMatchedEventsReader):
 *
 *   a rule's groups      its condition, for each group it opens at once,
 *                        the earliest of each first, at most the bound,
 *                        with how far all of their requests got;
 *   one group            a rule that does not group;
 *   a feed's indicators  every event carrying one, in any case, but the
 *                        Detection Findings;
 *
 * each only the project's own events, in the window the source read. Run
 * on a table built from the SecurityEvent model.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server,
 * credentials in the URL:
 *
 *   docker run -d --rm --name detection-kept-ch -p 18125:8123 \
 *     -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18125 \
 *     npx jest Tests/Telemetry/SecurityDetectionMatchedEventsClickhouse.test.ts
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

const database: string = `detection_kept_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;

// The run's window: ten minutes ending at a fixed moment.
const END: Date = new Date(
  Math.floor(Date.now() / (60 * MINUTE)) * 60 * MINUTE,
);
const START: Date = new Date(END.getTime() - 10 * MINUTE);

const FAILED_SIGN_INS: string = `title: Failed sign-ins
id: 7c0f2a51-0000-4000-8000-000000000001
level: high
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
`;

interface Connection {
  name: string;
  database: ClickhouseDatabase;
  client: ClickhouseClient;
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

function eventRow(data: {
  projectId: ObjectID;
  sourceId: ObjectID;
  time: Date;
  uid: string;
  principalIp?: string | undefined;
  statusName?: string | undefined;
  classUid?: number | undefined;
  observables?: Array<string> | undefined;
  requestOutcome?: string | undefined;
}): JSONObject {
  const attributes: Record<string, string> = {
    "oneuptime.log.id": `log-${data.uid}`,
  };

  return {
    _id: ObjectID.generate().toString(),
    projectId: data.projectId.toString(),
    primaryEntityId: data.sourceId.toString(),
    primaryEntityType: ServiceType.OpenTelemetry,
    time: OneUptimeDate.toClickhouseDateTime64(data.time),
    createdAt: OneUptimeDate.toClickhouseDateTime(data.time),
    eventUid: data.uid,
    classUid: data.classUid ?? 3002,
    className: data.classUid === 2004 ? "Detection Finding" : "Authentication",
    statusName: data.statusName ?? "Failure",
    severityId: 3,
    severityName: "Medium",
    message: `Failed sign-in ${data.uid}`,
    principalIp: data.principalIp ?? "",
    observables: data.observables ?? [data.principalIp ?? ""],
    requestOutcome: data.requestOutcome ?? "",
    attributes: attributes,
    attributeKeys: Object.keys(attributes),
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      new Date(END.getTime() + 30 * 24 * 60 * MINUTE),
    ),
  };
}

type ConnectableService = {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
};

const service: ConnectableService =
  SecurityEventService as unknown as ConnectableService;

function failedSignInsCondition(): Statement {
  const definition: DetectionRuleDefinition =
    SigmaRuleSetParser.parse(FAILED_SIGN_INS);

  if (definition.kind !== "single") {
    throw new Error("The test rule is a single rule.");
  }

  return SigmaClickhouseCompiler.compile(definition.rule);
}

function uids(kept: SecurityDetectionMatchedEvents | undefined): Array<string> {
  return (kept?.events || []).map(
    (event: SecurityDetectionMatchedEvent): string => {
      return event.eventUid;
    },
  );
}

integration("the events a detection keeps, against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let options: ClickHouseClientConfigOptions;
  const connections: Array<Connection> = [];
  let original: ConnectableService | null = null;

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

    await createTable(client, clickhouse, SecurityEvent);

    connections.push({
      name: "the current analyzer",
      database: clickhouse,
      client: client,
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

      connections.push({
        name: "the older analyzer",
        database: olderDatabase,
        client: await olderDatabase.connect(olderOptions),
      });
    }

    original = {
      database: service.database,
      databaseClient: service.databaseClient,
    };
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(service, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    for (const connection of connections) {
      await connection.database.disconnect();
    }
  });

  test("the server knows the older analyzer, so both are run", () => {
    expect(connections).toHaveLength(2);
  });

  describe.each([
    ["the current analyzer", 0],
    ["the older analyzer", 1],
  ])("through %s", (_name: string, position: number) => {
    // A project of each run's own, so the two runs never read each other's rows.
    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const sourceId: ObjectID = ObjectID.generate();
    const busy: string = "203.0.113.7";
    const quiet: string = "198.51.100.9";
    const prefix: string = `run${position}`;

    beforeAll(async (): Promise<void> => {
      const connection: Connection = connections[position]!;

      service.database = connection.database;
      service.databaseClient = connection.client;

      const at: (seconds: number) => Date = (seconds: number): Date => {
        return new Date(START.getTime() + seconds * 1000);
      };
      const rows: Array<JSONObject> = [];

      // Thirty failures from the busy address, written newest first.
      for (let index: number = 29; index >= 0; index--) {
        rows.push(
          eventRow({
            projectId,
            sourceId,
            time: at(10 + index),
            uid: `${prefix}-busy-${String(index).padStart(2, "0")}`,
            principalIp: busy,
            requestOutcome: index < 3 ? "Reached App" : "Rejected",
          }),
        );
      }

      rows.push(
        // Three from the quiet one.
        ...[0, 1, 2].map((index: number): JSONObject => {
          return eventRow({
            projectId,
            sourceId,
            time: at(100 + index),
            uid: `${prefix}-quiet-${index}`,
            principalIp: quiet,
          });
        }),
        // A success from the busy address: the condition does not match it.
        eventRow({
          projectId,
          sourceId,
          time: at(200),
          uid: `${prefix}-success`,
          principalIp: busy,
          statusName: "Success",
        }),
        // Before the window, after it, and another project's: never read.
        eventRow({
          projectId,
          sourceId,
          time: new Date(START.getTime() - MINUTE),
          uid: `${prefix}-before`,
          principalIp: busy,
        }),
        eventRow({
          projectId,
          sourceId,
          time: END,
          uid: `${prefix}-at-the-end`,
          principalIp: busy,
        }),
        eventRow({
          projectId: otherProjectId,
          sourceId,
          time: at(20),
          uid: `${prefix}-other-project`,
          principalIp: busy,
        }),
        // A feed's indicator, carried in another case, and a finding about it.
        eventRow({
          projectId,
          sourceId,
          time: at(300),
          uid: `${prefix}-indicator`,
          principalIp: "",
          observables: ["Evil.Example.com", "10.0.0.5"],
          statusName: "Success",
        }),
        eventRow({
          projectId,
          sourceId,
          time: at(301),
          uid: `${prefix}-finding`,
          classUid: 2004,
          principalIp: "",
          observables: ["evil.example.com"],
        }),
      );

      await client.insert({
        table: `${database}.${new SecurityEvent().tableName}`,
        format: "JSONEachRow",
        values: rows,
      });
    });

    test("a rule's groups: the earliest of each, at most the bound, and how far all of their requests got", async () => {
      const kept: Map<string, SecurityDetectionMatchedEvents> =
        await SecurityDetectionMatchedEventsReader.readForGroups({
          projectId,
          start: START,
          end: END,
          condition: failedSignInsCondition(),
          groupExpression: buildSigmaFieldExpression("principalIp"),
          groupValues: [busy, quiet],
        });

      expect(uids(kept.get(busy))).toHaveLength(
        SECURITY_DETECTION_MATCHED_EVENTS_MAX,
      );
      expect(uids(kept.get(busy))[0]).toBe(`${prefix}-busy-00`);
      expect(uids(kept.get(busy))).toEqual(
        Array.from(
          { length: SECURITY_DETECTION_MATCHED_EVENTS_MAX },
          (_: unknown, index: number): string => {
            return `${prefix}-busy-${String(index).padStart(2, "0")}`;
          },
        ),
      );
      // Every match counts, not only the kept ones.
      expect(kept.get(busy)!.outcomes).toEqual({
        Rejected: 27,
        "Reached App": 3,
      });
      expect(uids(kept.get(quiet))).toEqual([
        `${prefix}-quiet-0`,
        `${prefix}-quiet-1`,
        `${prefix}-quiet-2`,
      ]);
      expect(kept.get(quiet)!.outcomes).toEqual({ "": 3 });
    });

    test("keeps each event as the case shows it: its source, its log line and when it leaves the table", async () => {
      const kept: Map<string, SecurityDetectionMatchedEvents> =
        await SecurityDetectionMatchedEventsReader.readForGroups({
          projectId,
          start: START,
          end: END,
          condition: failedSignInsCondition(),
          groupExpression: buildSigmaFieldExpression("principalIp"),
          groupValues: [quiet],
        });
      const event: SecurityDetectionMatchedEvent = kept.get(quiet)!.events[0]!;

      expect(Array.from(kept.keys())).toEqual([quiet]);
      expect(event).toMatchObject({
        eventUid: `${prefix}-quiet-0`,
        sourceId: sourceId.toString(),
        principalIp: quiet,
        className: "Authentication",
        statusName: "Failure",
      });
      expect(event.attributes["oneuptime.log.id"]).toBe(
        `log-${prefix}-quiet-0`,
      );
      expect(new Date(event.time).getTime()).toBe(START.getTime() + 100 * 1000);
      expect(new Date(event.retentionDate).getTime()).toBe(
        END.getTime() + 30 * 24 * 60 * MINUTE,
      );
    });

    test("a rule that does not group keeps its matches under one group", async () => {
      const kept: Map<string, SecurityDetectionMatchedEvents> =
        await SecurityDetectionMatchedEventsReader.readForGroups({
          projectId,
          start: START,
          end: END,
          condition: failedSignInsCondition(),
          groupExpression: null,
          groupValues: [],
        });

      expect(Array.from(kept.keys())).toEqual([""]);
      expect(uids(kept.get(""))).toHaveLength(
        SECURITY_DETECTION_MATCHED_EVENTS_MAX,
      );
      expect(uids(kept.get(""))[0]).toBe(`${prefix}-busy-00`);
      // The 30 failures from the busy address and the 3 from the quiet one.
      expect(kept.get("")!.outcomes).toEqual({
        Rejected: 27,
        "Reached App": 3,
        "": 3,
      });
    });

    test("a feed's indicator: every event carrying it, in any case, but the Detection Findings", async () => {
      const kept: Map<string, SecurityDetectionMatchedEvents> =
        await SecurityDetectionMatchedEventsReader.readForGroups({
          projectId,
          start: START,
          end: END,
          condition: SQL`1`,
          groupExpression: null,
          groupByObservable: true,
          groupValues: ["evil.example.com"],
          excludeClassUids: [2004],
        });

      expect(Array.from(kept.keys())).toEqual(["evil.example.com"]);
      expect(uids(kept.get("evil.example.com"))).toEqual([
        `${prefix}-indicator`,
      ]);
      expect(kept.get("evil.example.com")!.outcomes).toEqual({ "": 1 });
    });

    test("a group nobody's event is in keeps nothing, and a value is never SQL", async () => {
      const kept: Map<string, SecurityDetectionMatchedEvents> =
        await SecurityDetectionMatchedEventsReader.readForGroups({
          projectId,
          start: START,
          end: END,
          condition: failedSignInsCondition(),
          groupExpression: buildSigmaFieldExpression("principalIp"),
          groupValues: ["x'); DROP TABLE SecurityEvent; --"],
        });

      expect(kept.size).toBe(0);

      const [count] = await readJson<{ rows: string | number }>(
        client,
        `SELECT count() AS rows FROM ${database}.${new SecurityEvent().tableName}`,
      );

      expect(Number(count!.rows)).toBeGreaterThan(0);
    });
  });
});

describe("the events a detection keeps: ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
