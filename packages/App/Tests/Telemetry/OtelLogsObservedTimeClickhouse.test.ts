import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import LogService from "Common/Server/Services/LogService";
import Query from "Common/Server/Types/AnalyticsDatabase/Query";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { ExpressRequest } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import { MonitorStepLogMonitorUtil } from "Common/Types/Monitor/MonitorStepLogMonitor";
import ObjectID from "Common/Types/ObjectID";
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
 * #6395 against a real ClickHouse. The rows the logs ingest writes for
 * records with both times, only an observed time, neither, and times the
 * Log table cannot hold go into the Log table in ONE insert and read back
 * as stored: the time column, timeUnixNano and observedTimeUnixNano, the
 * Logs page's order and a log monitor's window. What the ingest wrote
 * before for a time past 2262, below zero or past 1e21 is shown to cost
 * the whole insert, the good rows beside it too.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18125:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18125 \
 *     npx jest Tests/Telemetry/OtelLogsObservedTimeClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `logs_observed_time_test_${process.pid}_${Date.now()}`;

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "checkout";

// When the records arrive here, on the server's clock.
const ARRIVED_AT_MS: number = Date.UTC(2026, 10, 9, 10, 0, 7, 250);
const ARRIVED_AT_NANO: string = `${ARRIVED_AT_MS}000000`;
const ARRIVED_AT_COLUMN: string = "2026-11-09 10:00:07.250000000";

// A fixed64 the Log table's DateTime64(9) cannot hold (it ends in 2262).
const PAST_THE_TABLE: string = "9300000000000000000";

const AUTO_DISCOVERY_METHODS: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverIoTFleet",
  "autoDiscoverDatabaseServer",
  "autoDiscoverOpenStackCloud",
];

// One record of each kind, as an OTLP/JSON exporter can send it.
const RECORDS: Array<JSONObject> = [
  {
    body: { stringValue: "both" },
    timeUnixNano: "1794218400123456789",
    observedTimeUnixNano: "1794218400124000001",
  },
  {
    body: { stringValue: "observed only" },
    observedTimeUnixNano: "1794218401500000300",
  },
  { body: { stringValue: "neither" } },
  {
    body: { stringValue: "zero own time" },
    timeUnixNano: "0",
    observedTimeUnixNano: "1794218402000000001",
  },
  {
    body: { stringValue: "own past the table" },
    timeUnixNano: PAST_THE_TABLE,
    observedTimeUnixNano: "1794218403000000001",
  },
  {
    body: { stringValue: "observed past the table" },
    observedTimeUnixNano: PAST_THE_TABLE,
  },
  {
    body: { stringValue: "own below zero" },
    timeUnixNano: "-5",
    observedTimeUnixNano: "1794218404000000001",
  },
  {
    body: { stringValue: "observed below zero" },
    observedTimeUnixNano: "-5",
  },
  {
    body: { stringValue: "observed past 1e21" },
    observedTimeUnixNano: 1e21,
  },
  {
    body: { stringValue: "observed past 2^64" },
    observedTimeUnixNano: "999999999999999999999",
  },
  {
    body: { stringValue: "observed with a fraction" },
    observedTimeUnixNano: "1500.75",
  },
  {
    body: { stringValue: "own at the last nanosecond" },
    timeUnixNano: "9223372036854775807",
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IngestTestMethods = Record<string, any>;

// The rows the logs ingest hands the log writer for RECORDS.
async function ingestRows(): Promise<Array<JSONObject>> {
  const rows: Array<JSONObject> = [];
  const ingest: IngestTestMethods =
    OtelLogsIngestService as unknown as IngestTestMethods;

  for (const method of AUTO_DISCOVERY_METHODS) {
    if (typeof ingest[method] === "function") {
      jest.spyOn(ingest, method).mockResolvedValue(null);
    }
  }
  jest.spyOn(ingest, "resolveTelemetryResource").mockResolvedValue({
    serviceName: SERVICE_NAME,
    primaryEntityId: new ObjectID(SERVICE_ID.toString()),
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  });
  jest.spyOn(LogPipelineService, "loadPipelines").mockResolvedValue([]);
  jest.spyOn(LogDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest.spyOn(LogScrubRuleService, "loadScrubRules").mockResolvedValue([]);
  jest
    .spyOn(TelemetryFanInWriter, "submit")
    .mockImplementation(
      async (target: FanInInsertTarget, batch: Array<JSONObject>) => {
        if (target !== LogService) {
          throw new Error(`unexpected fan-in target ${target.model.tableName}`);
        }
        rows.push(...batch);
        return { flushed: Promise.resolve() };
      },
    );
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined);
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(ARRIVED_AT_MS);
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {});

  try {
    await OtelLogsIngestService.processLogsFromQueue({
      projectId: new ObjectID(PROJECT_ID.toString()),
      headers: {},
      body: {
        resourceLogs: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: SERVICE_NAME } },
              ],
            },
            scopeLogs: [
              { scope: { name: "observed-time" }, logRecords: RECORDS },
            ],
          },
        ],
      },
    } as unknown as ExpressRequest);
  } finally {
    jest.restoreAllMocks();
  }

  return rows;
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
): Promise<void> {
  const model: AnalyticsBaseModel = new Log();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: Log as unknown as { new (): AnalyticsBaseModel },
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

type WiredService = {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
};

// Wait for the flush, so a refused row fails the insert here, not later.
const WAIT_FOR_FLUSH: { clickhouseSettings: { wait_for_async_insert: 1 } } = {
  clickhouseSettings: { wait_for_async_insert: 1 },
};

integration("log record times against ClickHouse (#6395)", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let saved: WiredService | undefined;
  let rows: Array<JSONObject> = [];

  // [body, time, timeUnixNano, observedTimeUnixNano] of every stored row.
  async function readStored(): Promise<Array<Array<string>>> {
    const result: { json: () => Promise<{ data: Array<JSONObject> }> } =
      (await client.query({
        query: `SELECT body, toString(time) AS time, toString(timeUnixNano) AS timeUnixNano, toString(observedTimeUnixNano) AS observedTimeUnixNano FROM ${database}.${new Log().tableName} WHERE projectId = {projectId:String} ORDER BY body`,
        query_params: { projectId: PROJECT_ID.toString() },
        format: "JSON",
      })) as unknown as {
        json: () => Promise<{ data: Array<JSONObject> }>;
      };

    return (await result.json()).data.map((row: JSONObject): Array<string> => {
      return [
        String(row["body"]),
        String(row["time"]),
        String(row["timeUnixNano"]),
        String(row["observedTimeUnixNano"]),
      ];
    });
  }

  // What a log monitor counts in a window ending at `until` (MonitorTelemetryMonitor).
  async function monitorCount(from: string, until: string): Promise<number> {
    const evaluateUntil: Date = new Date(until);
    const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery(
      {
        ...MonitorStepLogMonitorUtil.getDefault(),
        lastXSecondsOfLogs:
          (evaluateUntil.getTime() - new Date(from).getTime()) / 1000,
      },
      evaluateUntil,
    );
    query.projectId = PROJECT_ID;

    return (
      await LogService.countBy({
        query: query,
        limit: 10000,
        skip: 0,
        props: { isRoot: true },
      })
    ).toNumber();
  }

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
    await createTable(client, clickhouse);

    const wired: WiredService = LogService as unknown as WiredService;
    saved = {
      database: wired.database,
      databaseClient: wired.databaseClient,
      ingestDatabase: wired.ingestDatabase,
      ingestDatabaseClient: wired.ingestDatabaseClient,
    };
    wired.database = clickhouse;
    wired.databaseClient = client;
    wired.ingestDatabase = clickhouse;
    wired.ingestDatabaseClient = client;

    rows = await ingestRows();
    await LogService.insertJsonRows(rows, WAIT_FOR_FLUSH);
  });

  afterAll(async (): Promise<void> => {
    if (saved) {
      Object.assign(LogService as unknown as WiredService, saved);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("every row of the batch goes in with one insert and reads back at the time it was stored at", async () => {
    expect(rows).toHaveLength(RECORDS.length);

    expect(await readStored()).toEqual([
      [
        "both",
        "2026-11-09 10:00:00.123456789",
        "1794218400123456789",
        "1794218400124000001",
      ],
      ["neither", ARRIVED_AT_COLUMN, ARRIVED_AT_NANO, "0"],
      // A negative observed time is no time, and its column a zero.
      ["observed below zero", ARRIVED_AT_COLUMN, ARRIVED_AT_NANO, "0"],
      [
        "observed only",
        "2026-11-09 10:00:01.500000300",
        "1794218401500000300",
        "1794218401500000300",
      ],
      // Past what a UInt64 holds: a zero, not a refused or wrapped number.
      ["observed past 1e21", ARRIVED_AT_COLUMN, ARRIVED_AT_NANO, "0"],
      ["observed past 2^64", ARRIVED_AT_COLUMN, ARRIVED_AT_NANO, "0"],
      // Not a time the table holds, but a UInt64 does: kept as sent.
      [
        "observed past the table",
        ARRIVED_AT_COLUMN,
        ARRIVED_AT_NANO,
        PAST_THE_TABLE,
      ],
      // Far in the past, kept as it came, in whole nanoseconds.
      [
        "observed with a fraction",
        "1970-01-01 00:00:00.000001500",
        "1500",
        "1500",
      ],
      [
        "own at the last nanosecond",
        "2262-04-11 23:47:16.854775807",
        "9223372036854775807",
        "0",
      ],
      [
        "own below zero",
        "2026-11-09 10:00:04.000000001",
        "1794218404000000001",
        "1794218404000000001",
      ],
      [
        "own past the table",
        "2026-11-09 10:00:03.000000001",
        "1794218403000000001",
        "1794218403000000001",
      ],
      [
        "zero own time",
        "2026-11-09 10:00:02.000000001",
        "1794218402000000001",
        "1794218402000000001",
      ],
    ]);
  });

  test("the Logs page lists a record without a time of its own where it happened, among the others", async () => {
    const listed: Array<Log> = await LogService.findBy({
      query: {
        projectId: PROJECT_ID,
        time: new InBetween(
          new Date("2026-11-09T09:59:00.000Z"),
          new Date("2026-11-09T10:00:05.000Z"),
        ),
      },
      select: { body: true, time: true },
      sort: { time: SortOrder.Descending },
      skip: 0,
      limit: 100,
      props: { isRoot: true },
    });

    expect(
      listed.map((log: Log): string => {
        return String(log.body);
      }),
    ).toEqual([
      "own below zero",
      "own past the table",
      "zero own time",
      // Before #6395 it was listed at 10:00:07.25, after all of these.
      "observed only",
      "both",
    ]);
  });

  test("a log monitor's window counts a record by its observed time, as it always counted a record by its own time", async () => {
    // Both, observed only, zero own time, own past the table, own below zero.
    expect(
      await monitorCount(
        "2026-11-09T10:00:00.000Z",
        "2026-11-09T10:00:05.000Z",
      ),
    ).toBe(5);
    // Neither, and the four whose observed time is no time: when they arrived.
    expect(
      await monitorCount(
        "2026-11-09T10:00:05.000Z",
        "2026-11-09T10:00:10.000Z",
      ),
    ).toBe(5);
    // Before #6395 the observed-only record was counted in the window above.
    expect(
      await monitorCount(
        "2026-11-09T10:00:01.000Z",
        "2026-11-09T10:00:02.000Z",
      ),
    ).toBe(1);
  });

  test("what the ingest wrote before for a time past 2262, below zero or past 1e21 cost the whole insert", async () => {
    // [the record, what the ingest wrote for it before, ClickHouse's refusal]
    const beforeFix: Array<[string, JSONObject, string]> = [
      [
        "an own time past 2262",
        {
          time: OneUptimeDate.toClickhouseDateTime64(
            OneUptimeDate.fromUnixNano(PAST_THE_TABLE),
            PAST_THE_TABLE,
          ),
          timeUnixNano: PAST_THE_TABLE,
        },
        "(while reading the value of key time)",
      ],
      [
        "an own time below zero",
        { timeUnixNano: "-5" },
        "(while reading the value of key timeUnixNano)",
      ],
      [
        "an observed time below zero",
        { observedTimeUnixNano: "-5" },
        "(while reading the value of key observedTimeUnixNano)",
      ],
      [
        "an observed time past 1e21",
        { observedTimeUnixNano: "1e+21" },
        "(while reading the value of key observedTimeUnixNano)",
      ],
    ];

    // The writer logs each refused insert; the assertions below read them.
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    for (const [label, written, refusal] of beforeFix) {
      await expect(
        LogService.insertJsonRows(
          [
            {
              ...rows[0]!,
              _id: ObjectID.generate().toString(),
              body: "a good row beside it",
            },
            {
              ...rows[0]!,
              ...written,
              _id: ObjectID.generate().toString(),
              body: label,
            },
          ],
          WAIT_FOR_FLUSH,
        ),
      ).rejects.toThrow(refusal);
    }

    jest.restoreAllMocks();

    const bodies: Array<string> = (await readStored()).map(
      (row: Array<string>): string => {
        return row[0]!;
      },
    );

    expect(bodies).not.toContain("a good row beside it");
    expect(bodies).toHaveLength(RECORDS.length);
  });

  test("what the ingest wrote before for an observed time past 2^64 read back as another time", async () => {
    // In a project of its own, so the rows above stay as they are.
    const otherProject: string = ObjectID.generate().toString();

    await LogService.insertJsonRows(
      [
        {
          ...rows[0]!,
          _id: ObjectID.generate().toString(),
          projectId: otherProject,
          observedTimeUnixNano: "999999999999999999999",
        },
      ],
      WAIT_FOR_FLUSH,
    );

    const result: { json: () => Promise<{ data: Array<JSONObject> }> } =
      (await client.query({
        query: `SELECT toString(observedTimeUnixNano) AS observed FROM ${database}.${new Log().tableName} WHERE projectId = {projectId:String}`,
        query_params: { projectId: otherProject },
        format: "JSON",
      })) as unknown as {
        json: () => Promise<{ data: Array<JSONObject> }>;
      };

    // 2092-10-26, not the 21 digits sent; now it is a 0, the column's "none".
    expect((await result.json()).data).toEqual([
      { observed: "3875820019684212735" },
    ]);
  });
});

describe("log record times ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
