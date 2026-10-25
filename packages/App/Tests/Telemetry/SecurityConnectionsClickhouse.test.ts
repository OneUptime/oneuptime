import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { ClickHouseSettings } from "Common/Server/Services/AnalyticsDatabaseService";
import SecurityEventService, {
  SecurityEventLogResource,
  SecurityEventsNamingSummary,
} from "Common/Server/Services/SecurityEventService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
} from "Common/Types/SecurityCase/SecurityConnection";
import { getObservableSearchValues } from "Common/Utils/SecurityCase/SecurityConnectionMatch";
import ServiceType from "Common/Types/Telemetry/ServiceType";
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
 * The security-event reads behind Security Events' connections, against a
 * real ClickHouse server, under its current analyzer and the older one:
 *
 *   countEventsNaming        a record page's Security card: the events and
 *                            findings naming its identities (in the
 *                            usual spellings), or read from its logs
 *   findLogResourcesNaming   the records the logs behind a case's events
 *                            were sent under
 *   hasEventsSince           whether a project uses Security Events at all
 *
 * Each is run through SecurityEventService, on a table built from the
 * SecurityEvent model (its columns, skip indexes and projection), with the
 * rows of the project read, of another project that must never be read,
 * and of times outside the window.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server,
 * credentials in the URL:
 *
 *   docker run -d --rm --name security-connected-ch -p 18125:8123 \
 *     -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18125 \
 *     npx jest Tests/Telemetry/SecurityConnectionsClickhouse.test.ts
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

const database: string = `security_connections_test_${process.pid}_${Date.now()}`;

const HOUR: number = 60 * 60 * 1000;

/*
 * The week the reads look at, ending at a fixed moment so every run reads
 * the same rows: the rows are written around it.
 */
const END: Date = new Date(
  Math.floor(Date.now() / (24 * HOUR)) * 24 * HOUR - 12 * HOUR,
);
const START: Date = new Date(END.getTime() - 7 * 24 * HOUR);

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

function eventRow(data: {
  projectId: ObjectID;
  time: Date;
  observables: Array<string>;
  classUid?: number | undefined;
  severityId?: number | undefined;
  attributes?: Record<string, string> | undefined;
}): JSONObject {
  const attributes: Record<string, string> = data.attributes || {};

  return {
    _id: ObjectID.generate().toString(),
    projectId: data.projectId.toString(),
    primaryEntityId: ObjectID.generate().toString(),
    primaryEntityType: ServiceType.OpenTelemetry,
    time: OneUptimeDate.toClickhouseDateTime64(data.time),
    createdAt: OneUptimeDate.toClickhouseDateTime(data.time),
    eventUid: ObjectID.generate().toString(),
    classUid: data.classUid ?? 3002,
    className: data.classUid === 2004 ? "Detection Finding" : "Authentication",
    severityId: data.severityId ?? 1,
    message: "test event",
    observables: data.observables,
    attributes: attributes,
    attributeKeys: Object.keys(attributes),
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), 30),
    ),
  };
}

type ConnectableService = {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
};

const service: ConnectableService =
  SecurityEventService as unknown as ConnectableService;

integration("Security Events' connections against ClickHouse", () => {
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
    const quietProjectId: ObjectID = ObjectID.generate();
    const hostId: ObjectID = ObjectID.generate();
    const serviceId: ObjectID = ObjectID.generate();

    beforeAll(async (): Promise<void> => {
      const connection: Connection = connections[position]!;

      service.database = connection.database;
      service.databaseClient = connection.client;

      const inside: (hours: number) => Date = (hours: number): Date => {
        return new Date(END.getTime() - hours * HOUR);
      };
      const fromHostLogs: Record<string, string> = {
        [SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]: hostId.toString(),
        [SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE]: ServiceType.Host,
      };
      const fromServiceLogs: Record<string, string> = {
        [SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]: serviceId.toString(),
        [SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE]: ServiceType.OpenTelemetry,
      };

      await client.insert({
        table: `${database}.${new SecurityEvent().tableName}`,
        format: "JSONEachRow",
        values: [
          // web-1, as its own logs say: in the week.
          eventRow({
            projectId,
            time: inside(2),
            observables: ["web-1", "203.0.113.7"],
            attributes: fromHostLogs,
          }),
          eventRow({
            projectId,
            time: inside(30),
            observables: ["web-1"],
            attributes: fromHostLogs,
          }),
          // WEB-1, as an EDR spells it: a High finding, the latest of the week.
          eventRow({
            projectId,
            time: inside(1),
            observables: ["WEB-1", "k.morgan@acme.example"],
            classUid: 2004,
            severityId: 4,
          }),
          // Its public address alone.
          eventRow({
            projectId,
            time: inside(50),
            observables: ["203.0.113.9"],
            classUid: 2004,
            severityId: 2,
          }),
          // A web attack read from a service's logs, naming the attacker only.
          eventRow({
            projectId,
            time: inside(3),
            observables: ["198.51.100.4"],
            attributes: fromServiceLogs,
          }),
          // Before the week: never counted.
          eventRow({
            projectId,
            time: new Date(START.getTime() - HOUR),
            observables: ["web-1"],
            attributes: fromHostLogs,
          }),
          // After the window: never counted.
          eventRow({
            projectId,
            time: new Date(END.getTime() + HOUR),
            observables: ["web-1"],
          }),
          // Another project's web-1: never read.
          eventRow({
            projectId: otherProjectId,
            time: inside(2),
            observables: ["web-1"],
            classUid: 2004,
            severityId: 5,
            attributes: fromHostLogs,
          }),
        ],
        clickhouse_settings: { wait_for_async_insert: 1 },
      });
    });

    test("the events and findings naming a host's name or its address, in the usual spellings, over the week", async () => {
      const summary: SecurityEventsNamingSummary =
        await SecurityEventService.countEventsNaming({
          projectId,
          values: getObservableSearchValues(["web-1", "203.0.113.9"]),
          startTime: START,
          endTime: END,
        });

      expect(summary.eventCount).toBe(4);
      expect(summary.findingCount).toBe(2);
      expect(summary.maxSeverityId).toBe(4);
      expect(summary.lastSeen?.getTime()).toBe(END.getTime() - HOUR);
    });

    test("exactly the spellings given: web-1 alone does not find an EDR's WEB-1", async () => {
      const summary: SecurityEventsNamingSummary =
        await SecurityEventService.countEventsNaming({
          projectId,
          values: ["web-1"],
          startTime: START,
          endTime: END,
        });

      expect(summary.eventCount).toBe(2);
    });

    test("a service's events: the ones read from its logs", async () => {
      const summary: SecurityEventsNamingSummary =
        await SecurityEventService.countEventsNaming({
          projectId,
          values: [],
          logResourceId: serviceId,
          startTime: START,
          endTime: END,
        });

      expect(summary.eventCount).toBe(1);
      expect(summary.findingCount).toBe(0);
    });

    test("the values or the logs: an event that is both is counted once", async () => {
      const summary: SecurityEventsNamingSummary =
        await SecurityEventService.countEventsNaming({
          projectId,
          values: ["web-1"],
          logResourceId: hostId,
          startTime: START,
          endTime: END,
        });

      expect(summary.eventCount).toBe(2);
    });

    test("a value nothing names: nothing, and no time it was seen", async () => {
      expect(
        await SecurityEventService.countEventsNaming({
          projectId,
          values: ["nobody.example"],
          startTime: START,
          endTime: END,
        }),
      ).toEqual({
        eventCount: 0,
        findingCount: 0,
        maxSeverityId: 0,
        lastSeen: null,
      });
    });

    test("the records the logs behind events naming a value were sent under, the most named first, this project's only", async () => {
      const resources: Array<SecurityEventLogResource> =
        await SecurityEventService.findLogResourcesNaming({
          projectId,
          values: ["web-1", "198.51.100.4", "WEB-1"],
          startTime: START,
          endTime: END,
          limit: 20,
        });

      expect(resources).toEqual([
        { type: ServiceType.Host, id: hostId.toString(), eventCount: 2 },
        {
          type: ServiceType.OpenTelemetry,
          id: serviceId.toString(),
          eventCount: 1,
        },
      ]);
    });

    test("at most the limit asked for", async () => {
      expect(
        (
          await SecurityEventService.findLogResourcesNaming({
            projectId,
            values: ["web-1", "198.51.100.4"],
            startTime: START,
            endTime: END,
            limit: 1,
          })
        ).length,
      ).toBe(1);
    });

    test("whether a project uses Security Events: this one does, a quiet one and a later window do not", async () => {
      expect(
        await SecurityEventService.hasEventsSince({
          projectId,
          startTime: START,
        }),
      ).toBe(true);
      expect(
        await SecurityEventService.hasEventsSince({
          projectId: quietProjectId,
          startTime: START,
        }),
      ).toBe(false);
      expect(
        await SecurityEventService.hasEventsSince({
          projectId,
          startTime: new Date(END.getTime() + 2 * HOUR),
        }),
      ).toBe(false);
    });
  });
});

describe("Security Events' connections ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
