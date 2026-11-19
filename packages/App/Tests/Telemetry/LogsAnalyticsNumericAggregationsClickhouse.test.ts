import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import LogAggregationService, {
  AnalyticsRequest,
  AnalyticsTableRow,
  AnalyticsTimeseriesRow,
  AnalyticsTopItem,
} from "Common/Server/Services/LogAggregationService";
import LogService from "Common/Server/Services/LogService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ObjectID from "Common/Types/ObjectID";
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
 * Logs → Analytics' sum, average, minimum, maximum and percentiles of a
 * numeric attribute, against a real ClickHouse server (#7716).
 *
 * LogAnalyticsNumericAggregations.test.ts pins the SQL each aggregation
 * writes. What only a server can show is what it does: which attribute
 * values count as numbers and which are left out - never read as 0, never
 * failing the chart - what each aggregate comes to per service and per
 * time bucket, that a unique count no longer counts a missing attribute
 * as a value, and that the caller's service scope, another project's logs
 * and the retention filter hold for an aggregate as for a count. So this
 * suite loads logs into a table built from the real Log model and reads
 * them through LogAggregationService and LogService, as the route does.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/LogsAnalyticsNumericAggregationsClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
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

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `logs_analytics_numeric_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;
const BUCKET: number = 5 * MINUTE;

// Two five-minute buckets an hour ago, so nothing is near "now".
const FIRST_BUCKET: Date = new Date(
  Math.floor(Date.now() / BUCKET) * BUCKET - 60 * MINUTE,
);
const SECOND_BUCKET: Date = new Date(FIRST_BUCKET.getTime() + BUCKET);
const WINDOW_END: Date = new Date(FIRST_BUCKET.getTime() + 2 * BUCKET - 1000);

// Postgres ids, as service ids always are.
const projectId: ObjectID = new ObjectID(
  "77000000-0000-4000-8000-00000000000a",
);
const otherProjectId: ObjectID = new ObjectID(
  "77000000-0000-4000-8000-00000000000b",
);
const checkout: ObjectID = new ObjectID("77000000-0000-4000-8000-00000000000c");
const search: ObjectID = new ObjectID("77000000-0000-4000-8000-00000000000d");
// A service that logs a duration_ms, but never a number.
const legacy: ObjectID = new ObjectID("77000000-0000-4000-8000-00000000000e");
// The logs that say which values count as numbers.
const probe: ObjectID = new ObjectID("77000000-0000-4000-8000-00000000000f");

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
);
const expiredRetentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), -1),
);

// Each value counts as a number: ClickHouse's toFloat64OrNull reads it.
const NUMBERS: Array<string> = [
  "42",
  "-7",
  "+5",
  "3.14",
  ".5",
  "5.",
  "00012",
  "0",
  "-0",
  "1e3",
  "1E-3",
];

/*
 * Each value is left out: not a number at all, a number with a unit or a
 * space, another notation, or no finite number.
 */
const NOT_NUMBERS: Array<string> = [
  "",
  " 12",
  "12 ",
  "12ms",
  "n/a",
  "1,5",
  "1_000",
  "0x1A",
  "1.2.3",
  "true",
  "nan",
  "NaN",
  "inf",
  "-inf",
  "Infinity",
  "1e400",
];

interface LogFixture {
  at: Date;
  secondsIn: number;
  serviceId: ObjectID;
  attributes: Record<string, string>;
  projectId?: ObjectID;
  isExpired?: boolean;
}

function checkoutLog(
  at: Date,
  secondsIn: number,
  duration?: string,
): LogFixture {
  return {
    at,
    secondsIn,
    serviceId: checkout,
    attributes: {
      "http.route": "/checkout",
      ...(duration === undefined ? {} : { duration_ms: duration }),
    },
  };
}

const LOGS: Array<LogFixture> = [
  // checkout, first bucket: 10, 20, 30 and 40 - and everything that is no number.
  checkoutLog(FIRST_BUCKET, 1, "10"),
  checkoutLog(FIRST_BUCKET, 2, "20"),
  checkoutLog(FIRST_BUCKET, 3, "30"),
  checkoutLog(FIRST_BUCKET, 4, "40"),
  ...NOT_NUMBERS.map((value: string, index: number): LogFixture => {
    return checkoutLog(FIRST_BUCKET, 10 + index, value);
  }),
  // A log with no duration_ms at all.
  checkoutLog(FIRST_BUCKET, 40),
  // checkout, second bucket: 1000, -7, 0.5 and 5, written four ways.
  checkoutLog(SECOND_BUCKET, 1, "1e3"),
  checkoutLog(SECOND_BUCKET, 2, "-7"),
  checkoutLog(SECOND_BUCKET, 3, ".5"),
  checkoutLog(SECOND_BUCKET, 4, "+5"),
  // search, first bucket: 100 and 200.
  {
    at: FIRST_BUCKET,
    secondsIn: 5,
    serviceId: search,
    attributes: { "http.route": "/search", duration_ms: "100" },
  },
  {
    at: FIRST_BUCKET,
    secondsIn: 6,
    serviceId: search,
    attributes: { "http.route": "/search", duration_ms: "200" },
  },
  // legacy: a duration_ms in every log, and never a number.
  {
    at: FIRST_BUCKET,
    secondsIn: 7,
    serviceId: legacy,
    attributes: { "http.route": "/legacy", duration_ms: "slow" },
  },
  {
    at: SECOND_BUCKET,
    secondsIn: 7,
    serviceId: legacy,
    attributes: { "http.route": "/legacy", duration_ms: "n/a" },
  },
  // Another project's checkout: never read.
  {
    at: FIRST_BUCKET,
    secondsIn: 8,
    serviceId: checkout,
    projectId: otherProjectId,
    attributes: { "http.route": "/checkout", duration_ms: "99999" },
  },
  // A checkout log past its retention: never read.
  {
    at: FIRST_BUCKET,
    secondsIn: 9,
    serviceId: checkout,
    isExpired: true,
    attributes: { "http.route": "/checkout", duration_ms: "55555" },
  },
  // Users: two of them, and a log of the same service with no user.id.
  {
    at: SECOND_BUCKET,
    secondsIn: 20,
    serviceId: search,
    attributes: { "user.id": "alice" },
  },
  {
    at: SECOND_BUCKET,
    secondsIn: 21,
    serviceId: search,
    attributes: { "user.id": "bob" },
  },
  {
    at: SECOND_BUCKET,
    secondsIn: 22,
    serviceId: search,
    attributes: { "user.id": "alice" },
  },
  {
    at: SECOND_BUCKET,
    secondsIn: 23,
    serviceId: search,
    attributes: { "http.route": "/search" },
  },
  // An attribute whose key holds dots, a colon, a slash and dashes.
  {
    at: SECOND_BUCKET,
    secondsIn: 30,
    serviceId: search,
    attributes: { "http.server/duration:ms-p": "5" },
  },
  {
    at: SECOND_BUCKET,
    secondsIn: 31,
    serviceId: search,
    attributes: { "http.server/duration:ms-p": "7" },
  },
  // What counts as a number: each value as `v`, and as written in `raw`.
  ...[...NUMBERS, ...NOT_NUMBERS].map(
    (value: string, index: number): LogFixture => {
      return {
        at: SECOND_BUCKET,
        secondsIn: 40 + (index % 15),
        serviceId: probe,
        attributes: { raw: `<${value}>`, v: value },
      };
    },
  ),
];

function logRow(fixture: LogFixture, index: number): JSONObject {
  const time: Date = new Date(fixture.at.getTime() + fixture.secondsIn * 1000);

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: (fixture.projectId || projectId).toString(),
    primaryEntityId: fixture.serviceId.toString(),
    primaryEntityType: "Service",
    time: OneUptimeDate.toClickhouseDateTime64(time),
    timeUnixNano: String(time.getTime() * 1000000 + index),
    severityText: LogSeverity.Information,
    severityNumber: 9,
    attributes: fixture.attributes,
    attributeKeys: Object.keys(fixture.attributes).sort(),
    entityKeys: [],
    traceId: "",
    spanId: "",
    body: "request served",
    retentionDate: fixture.isExpired ? expiredRetentionDate : retentionDate,
  };
}

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

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

function request(overrides: Partial<AnalyticsRequest>): AnalyticsRequest {
  return {
    projectId,
    startTime: FIRST_BUCKET,
    endTime: WINDOW_END,
    bucketSizeInMinutes: 5,
    chartType: "timeseries",
    aggregation: "count",
    ...overrides,
  };
}

// Which bucket a point is in: 0 for the first, 1 for the second.
function bucketOf(time: string): number {
  const start: number = new Date(
    `${time.slice(0, 19).replace(" ", "T")}Z`,
  ).getTime();

  return (start - FIRST_BUCKET.getTime()) / BUCKET;
}

function serviceName(id: string): string {
  return (
    {
      [checkout.toString()]: "checkout",
      [search.toString()]: "search",
      [legacy.toString()]: "legacy",
      [probe.toString()]: "probe",
    }[id] || id
  );
}

// A time series as [bucket, service, value], in that order.
async function seriesByService(
  overrides: Partial<AnalyticsRequest>,
): Promise<Array<[number, string, number]>> {
  const rows: Array<AnalyticsTimeseriesRow> =
    await LogAggregationService.getAnalyticsTimeseries(
      request({
        aggregationField: "duration_ms",
        groupBy: ["primaryEntityId"],
        ...overrides,
      }),
    );

  return rows
    .map((row: AnalyticsTimeseriesRow): [number, string, number] => {
      return [
        bucketOf(row.time),
        serviceName(row.groupValues["primaryEntityId"] || ""),
        row.count,
      ];
    })
    .sort(
      (a: [number, string, number], b: [number, string, number]): number => {
        return a[0] - b[0] || a[1].localeCompare(b[1]);
      },
    );
}

integration(
  "Logs → Analytics' aggregates of a number against ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    let original: ServiceConnection | undefined;

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

      await createTable(client, clickhouse, Log);

      original = {
        database: LogService.database,
        databaseClient: LogService.databaseClient,
        ingestDatabase: LogService.ingestDatabase,
        ingestDatabaseClient: LogService.ingestDatabaseClient,
      };

      LogService.database = clickhouse;
      LogService.databaseClient = client;
      LogService.ingestDatabase = clickhouse;
      LogService.ingestDatabaseClient = client;

      await LogService.insertJsonRows(LOGS.map(logRow), {
        clickhouseSettings: { wait_for_async_insert: 1 },
      });
    });

    afterAll(async (): Promise<void> => {
      if (original) {
        Object.assign(LogService, original);
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }
    });

    test("averages duration_ms per service and bucket, leaving out every value that is no number", async () => {
      expect(await seriesByService({ aggregation: "avg" })).toEqual([
        [0, "checkout", 25],
        [0, "search", 150],
        [1, "checkout", 249.625],
      ]);
    });

    test.each([
      ["sum", 100, 300, 998.5],
      ["min", 10, 100, -7],
      ["max", 40, 200, 1000],
      ["p50", 25, 150, 2.75],
      // Interpolated between the values around the level: -7, 0.5, 5, 1000.
      ["p90", 37, 190, 701.5],
      ["p95", 38.5, 195, 850.75],
      ["p99", 39.7, 199, 970.15],
    ])(
      "the %s of checkout's first bucket is %p, of search's %p, of checkout's second %p",
      async (
        aggregation: string,
        checkoutFirst: number,
        searchFirst: number,
        checkoutSecond: number,
      ) => {
        const series: Array<[number, string, number]> = await seriesByService({
          aggregation: aggregation as AnalyticsRequest["aggregation"],
        });

        expect(
          series.map((point: [number, string, number]) => {
            return point[0] + point[1];
          }),
        ).toEqual(["0checkout", "0search", "1checkout"]);
        expect(series[0]![2]).toBeCloseTo(checkoutFirst, 9);
        expect(series[1]![2]).toBeCloseTo(searchFirst, 9);
        expect(series[2]![2]).toBeCloseTo(checkoutSecond, 9);
      },
    );

    test("a service whose duration_ms is never a number has no series, not a 0", async () => {
      const series: Array<[number, string, number]> = await seriesByService({
        aggregation: "p95",
      });

      expect(
        series.some((point: [number, string, number]): boolean => {
          return point[1] === "legacy";
        }),
      ).toBe(false);

      // Its logs are there to count, all the same.
      const counted: Array<[number, string, number]> = await seriesByService({
        aggregation: "count",
      });

      expect(counted).toContainEqual([0, "legacy", 1]);
      expect(counted).toContainEqual([1, "legacy", 1]);
    });

    test("what counts as a number: an integer or a decimal, signed or not, in scientific notation or not", async () => {
      const rows: Array<AnalyticsTableRow> =
        await LogAggregationService.getAnalyticsTable(
          request({
            chartType: "table",
            aggregation: "max",
            aggregationField: "v",
            groupBy: ["raw"],
            serviceIds: [probe],
            limit: 100,
          }),
        );

      const counted: Record<string, number> = {};

      for (const row of rows) {
        const raw: string = row.groupValues["raw"] || "";
        counted[raw.slice(1, -1)] = row.count;
      }

      expect(Object.keys(counted).sort()).toEqual([...NUMBERS].sort());
      expect(counted).toEqual({
        "42": 42,
        "-7": -7,
        "+5": 5,
        "3.14": 3.14,
        ".5": 0.5,
        "5.": 5,
        "00012": 12,
        "0": 0,
        // Read back as a plain 0.
        "-0": 0,
        "1e3": 1000,
        "1E-3": 0.001,
      });

      for (const value of NOT_NUMBERS) {
        expect(counted[value]).toBeUndefined();
      }
    });

    test("a sum with nan, inf and a number too large for a Float64 among its values stays a number", async () => {
      const series: Array<[number, string, number]> = await seriesByService({
        aggregation: "sum",
        serviceIds: [checkout],
      });

      expect(series).toEqual([
        [0, "checkout", 100],
        [1, "checkout", 998.5],
      ]);
    });

    test("a top list of the average by route puts the slowest first", async () => {
      const top: Array<AnalyticsTopItem> =
        await LogAggregationService.getAnalyticsTopList(
          request({
            chartType: "toplist",
            aggregation: "avg",
            aggregationField: "duration_ms",
            groupBy: ["http.route"],
          }),
        );

      expect(top).toEqual([
        { value: "/search", count: 150 },
        { value: "/checkout", count: 137.3125 },
      ]);
    });

    test("a table of the maximum by service and route, the largest first", async () => {
      const table: Array<AnalyticsTableRow> =
        await LogAggregationService.getAnalyticsTable(
          request({
            chartType: "table",
            aggregation: "max",
            aggregationField: "duration_ms",
            groupBy: ["primaryEntityId", "http.route"],
          }),
        );

      expect(
        table.map((row: AnalyticsTableRow) => {
          return [
            serviceName(row.groupValues["primaryEntityId"] || ""),
            row.groupValues["http.route"],
            row.count,
          ];
        }),
      ).toEqual([
        ["checkout", "/checkout", 1000],
        ["search", "/search", 200],
      ]);
    });

    test("an aggregate keeps the caller's service scope: a service left out is not averaged in", async () => {
      expect(
        await seriesByService({
          aggregation: "avg",
          excludedServiceIds: [search],
        }),
      ).toEqual([
        [0, "checkout", 25],
        [1, "checkout", 249.625],
      ]);

      expect(
        await seriesByService({ aggregation: "max", serviceIds: [search] }),
      ).toEqual([[0, "search", 200]]);

      const top: Array<AnalyticsTopItem> =
        await LogAggregationService.getAnalyticsTopList(
          request({
            chartType: "toplist",
            aggregation: "max",
            aggregationField: "duration_ms",
            groupBy: ["http.route"],
            serviceIds: [checkout],
          }),
        );

      expect(top).toEqual([{ value: "/checkout", count: 1000 }]);
    });

    test("another project's logs and the logs past their retention are never read", async () => {
      // 99999 is another project's; 55555 is past its retention.
      const top: Array<AnalyticsTopItem> =
        await LogAggregationService.getAnalyticsTopList(
          request({
            chartType: "toplist",
            aggregation: "max",
            aggregationField: "duration_ms",
            groupBy: ["http.route"],
          }),
        );

      expect(
        top.map((item: AnalyticsTopItem) => {
          return item.count;
        }),
      ).toEqual([1000, 200]);
    });

    test("an attribute key of dots, a colon, a slash and dashes is read through its bound parameter", async () => {
      const top: Array<AnalyticsTopItem> =
        await LogAggregationService.getAnalyticsTopList(
          request({
            chartType: "toplist",
            aggregation: "avg",
            aggregationField: "http.server/duration:ms-p",
            groupBy: ["primaryEntityId"],
          }),
        );

      expect(top).toEqual([{ value: search.toString(), count: 6 }]);
    });

    test("a key that could be SQL is refused before it reaches ClickHouse", async () => {
      for (const key of [
        "duration_ms') OR 1=1 --",
        "duration_ms']) FROM system.users --",
        "x' OR '1'='1",
      ]) {
        await expect(
          LogAggregationService.getAnalyticsTimeseries(
            request({ aggregation: "avg", aggregationField: key }),
          ),
        ).rejects.toThrow(BadDataException);
      }

      // And the table is as it was.
      expect(await seriesByService({ aggregation: "avg" })).toHaveLength(3);
    });

    test("a unique count of user.id counts only the logs that carry one", async () => {
      const rows: Array<AnalyticsTableRow> =
        await LogAggregationService.getAnalyticsTable(
          request({
            chartType: "table",
            aggregation: "unique",
            aggregationField: "user.id",
            groupBy: ["primaryEntityId"],
            serviceIds: [search],
          }),
        );

      // alice and bob - the search logs with no user.id are no third user.
      expect(rows).toEqual([
        { groupValues: { primaryEntityId: search.toString() }, count: 2 },
      ]);
    });
  },
);

describe("Logs → Analytics ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
