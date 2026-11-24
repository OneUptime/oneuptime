import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Span, { SpanKind, SpanStatus } from "Common/Models/AnalyticsModels/Span";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import ExceptionAggregationService, {
  HistogramBucket as ExceptionHistogramBucket,
} from "Common/Server/Services/ExceptionAggregationService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import LogAggregationService, {
  AnalyticsTimeseriesRow,
  HistogramBucket as LogHistogramBucket,
} from "Common/Server/Services/LogAggregationService";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import TraceAggregationService, {
  HistogramBucket as TraceHistogramBucket,
  TraceAnalyticsTimeseriesRow,
} from "Common/Server/Services/TraceAggregationService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ObjectID from "Common/Types/ObjectID";
import Timezone from "Common/Types/Timezone";
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
 * The Logs, Traces and Exceptions histograms' day bars, from the reader's
 * midnight, against a real ClickHouse server (issue #7923).
 *
 * A histogram bar of a day used to be 1440 minutes counted from the epoch:
 * UTC's day, 19:00 to 19:00 in New York. A request that names the reader's
 * zone now cuts its day bars at that zone's midnight
 * (TelemetryHistogramBuckets), on the logs' and the spans' minute rollups
 * and on the raw rows alike. What only a server can show is what the SQL
 * does: one bar per New York day, each starting at New York's midnight, a
 * day of 25 hours when the clocks go back and of 23 when they go forward,
 * every row in exactly one bar - and, without a zone, UTC's days as before.
 *
 * The day each row belongs to is worked out here on the platform's own
 * clock (Intl), not by the code under test.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7.38.18
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/TelemetryDayBarsInReaderZoneClickhouse.test.ts
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

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `telemetry_day_bars_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

const PROJECT: ObjectID = new ObjectID("7d00000000000000000000a1");
const SERVICE: ObjectID = new ObjectID("7d00000000000000000000b1");

const NEW_YORK: Timezone = Timezone.AmericaNew_York;

const retention: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
);

/*
 * Sixty days around New York's clocks going back (06:00 UTC on 1 November,
 * a day of 25 hours), and a week around them going forward (07:00 UTC on 8
 * March, a day of 23). A row on every hour, so a row falls exactly on
 * every New York midnight and an hour either side of it.
 */
interface Window {
  name: string;
  start: Date;
  end: Date;
}

const SIXTY_DAYS: Window = {
  name: "sixty days across New York's clocks going back",
  start: new Date("2026-09-20T00:00:00.000Z"),
  end: new Date("2026-11-19T00:00:00.000Z"),
};

const SPRING_WEEK: Window = {
  name: "a week across New York's clocks going forward",
  start: new Date("2026-03-04T00:00:00.000Z"),
  end: new Date("2026-03-11T00:00:00.000Z"),
};

function hourlySamples(window: Window): Array<number> {
  const samples: Array<number> = [];

  for (
    let instant: number = window.start.getTime();
    instant < window.end.getTime();
    instant += HOUR
  ) {
    samples.push(instant);
  }

  return samples;
}

const SAMPLES: Array<number> = [
  ...hourlySamples(SPRING_WEEK),
  ...hourlySamples(SIXTY_DAYS),
];

// ---- The platform's own clock, which the days are worked out on.

const DATE_FORMATS: Map<string, Intl.DateTimeFormat> = new Map();

// "2026-11-01": the date the zone's clocks read at `instant`.
function localDateIn(zone: string, instant: number): string {
  let format: Intl.DateTimeFormat | undefined = DATE_FORMATS.get(zone);

  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    DATE_FORMATS.set(zone, format);
  }

  const parts: Record<string, string> = {};

  for (const part of format.formatToParts(new Date(instant))) {
    parts[part.type] = part.value;
  }

  return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
}

/*
 * The first instant the zone's clocks read `day`: its midnight. Every
 * zone's day starts within 15 hours of the same date's UTC midnight, so a
 * search by the minute between the two finds it.
 */
function startOfLocalDay(zone: string, day: string): number {
  let before: number = Date.parse(`${day}T00:00:00.000Z`) - 15 * HOUR;
  let onOrAfter: number = Date.parse(`${day}T00:00:00.000Z`) + 15 * HOUR;

  while (onOrAfter - before > MINUTE) {
    const middle: number =
      before + Math.floor((onOrAfter - before) / (2 * MINUTE)) * MINUTE;

    if (localDateIn(zone, middle) >= day) {
      onOrAfter = middle;
    } else {
      before = middle;
    }
  }

  return onOrAfter;
}

// Each day of the zone's that holds samples of the window, and how many.
function expectedDays(
  zone: string,
  window: Window,
): Map<number, { day: string; count: number }> {
  const days: Map<number, { day: string; count: number }> = new Map();

  for (const sample of SAMPLES) {
    if (sample < window.start.getTime() || sample >= window.end.getTime()) {
      continue;
    }

    const day: string = localDateIn(zone, sample);
    const start: number = startOfLocalDay(zone, day);
    const known: { day: string; count: number } | undefined = days.get(start);

    days.set(start, { day: day, count: (known?.count || 0) + 1 });
  }

  return days;
}

// "2026-11-01 04:00:00", as ClickHouse writes a UTC DateTime, as an instant.
function instantOf(bucket: string): number {
  return OneUptimeDate.fromString(bucket).getTime();
}

// The bars of an answer: bar start -> the rows in it, summed over series.
function barsOf(
  rows: Array<{ time: string; count: number }>,
): Map<number, number> {
  const bars: Map<number, number> = new Map();

  for (const row of rows) {
    const start: number = instantOf(row.time);
    bars.set(start, (bars.get(start) || 0) + Number(row.count));
  }

  return bars;
}

/*
 * One bar per day of `zone` that holds rows, starting at that zone's
 * midnight, each holding the rows of that day - so every row is in exactly
 * one bar.
 */
function expectDayBars(
  bars: Map<number, number>,
  zone: string,
  window: Window,
): void {
  const days: Map<number, { day: string; count: number }> = expectedDays(
    zone,
    window,
  );

  expect(
    Array.from(bars.keys())
      .sort((a: number, b: number): number => {
        return a - b;
      })
      .map((start: number): string => {
        return new Date(start).toISOString();
      }),
  ).toEqual(
    Array.from(days.keys())
      .sort((a: number, b: number): number => {
        return a - b;
      })
      .map((start: number): string => {
        return new Date(start).toISOString();
      }),
  );

  for (const [start, expected] of days) {
    expect({ day: expected.day, count: bars.get(start) }).toEqual({
      day: expected.day,
      count: expected.count,
    });
  }

  let total: number = 0;

  for (const count of bars.values()) {
    total += count;
  }

  expect(total).toBe(
    SAMPLES.filter((sample: number): boolean => {
      return sample >= window.start.getTime() && sample < window.end.getTime();
    }).length,
  );
}

// ---- The rows.

function logRow(instant: number, index: number): JSONObject {
  const time: Date = new Date(instant);

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: PROJECT.toString(),
    primaryEntityId: SERVICE.toString(),
    primaryEntityType: "Service",
    time: OneUptimeDate.toClickhouseDateTime64(time),
    timeUnixNano: String(instant * 1000000 + index),
    severityText: index % 2 === 0 ? LogSeverity.Information : LogSeverity.Error,
    severityNumber: index % 2 === 0 ? 9 : 17,
    attributes: {},
    attributeKeys: [],
    entityKeys: [],
    traceId: "",
    spanId: "",
    body: "request served",
    retentionDate: retention,
  };
}

function spanRow(instant: number, index: number): JSONObject {
  const time: string = OneUptimeDate.toClickhouseDateTime64(new Date(instant));
  const startNanos: bigint = BigInt(instant) * BigInt(1000000);

  return {
    projectId: PROJECT.toString(),
    primaryEntityId: SERVICE.toString(),
    primaryEntityType: "Service",
    startTime: time,
    endTime: time,
    startTimeUnixNano: startNanos.toString(),
    endTimeUnixNano: (startNanos + BigInt(1000000)).toString(),
    durationUnixNano: "1000000",
    traceId: `trace-${index}`,
    spanId: `span-${index}`,
    parentSpanId: "",
    attributes: {},
    attributeKeys: [],
    entityKeys: [],
    statusCode: index % 3 === 0 ? SpanStatus.Error : SpanStatus.Ok,
    name: "GET /orders",
    kind: SpanKind.Server,
    isRootSpan: true,
    retentionDate: retention,
  };
}

function exceptionRow(instant: number, index: number): JSONObject {
  const time: Date = new Date(instant);

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: PROJECT.toString(),
    primaryEntityId: SERVICE.toString(),
    primaryEntityType: "Service",
    time: OneUptimeDate.toClickhouseDateTime64(time),
    timeUnixNano: String(instant * 1000000),
    exceptionType: "TypeError",
    stackTrace: "",
    message: "cart is undefined",
    spanStatusCode: 2,
    escaped: index % 2 === 0,
    traceId: "",
    spanId: "",
    fingerprint: "cart-undefined",
    spanName: "",
    release: "",
    environment: "",
    parsedFrames: "",
    attributes: {},
    attributeKeys: [],
    entityKeys: [],
    retentionDate: retention.substring(0, 10),
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
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = ${model.tableEngine} PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

function connectionOf(service: ServiceConnection): ServiceConnection {
  return {
    database: service.database,
    databaseClient: service.databaseClient,
    ingestDatabase: service.ingestDatabase,
    ingestDatabaseClient: service.ingestDatabaseClient,
  };
}

// ---- Reads, as the routes make them.

async function logHistogram(
  window: Window,
  timezone?: Timezone | undefined,
): Promise<Map<number, number>> {
  const buckets: Array<LogHistogramBucket> =
    await LogAggregationService.getHistogram({
      projectId: PROJECT,
      startTime: window.start,
      endTime: window.end,
      bucketSizeInMinutes: 1440,
      timezone: timezone,
    });

  return barsOf(buckets);
}

async function logAnalytics(
  window: Window,
  timezone?: Timezone | undefined,
): Promise<Map<number, number>> {
  const rows: Array<AnalyticsTimeseriesRow> =
    await LogAggregationService.getAnalyticsTimeseries({
      projectId: PROJECT,
      startTime: window.start,
      endTime: new Date(window.end.getTime() - 1),
      bucketSizeInMinutes: 1440,
      timezone: timezone,
      chartType: "timeseries",
      aggregation: "count",
    });

  return barsOf(rows);
}

async function traceHistogram(
  window: Window,
  timezone?: Timezone | undefined,
): Promise<Map<number, number>> {
  const buckets: Array<TraceHistogramBucket> =
    await TraceAggregationService.getHistogram({
      projectId: PROJECT,
      startTime: window.start,
      endTime: window.end,
      bucketSizeInMinutes: 1440,
      timezone: timezone,
    });

  return barsOf(buckets);
}

async function traceAnalytics(
  window: Window,
  timezone?: Timezone | undefined,
): Promise<Map<number, number>> {
  const rows: Array<TraceAnalyticsTimeseriesRow> =
    await TraceAggregationService.getAnalyticsTimeseries({
      projectId: PROJECT,
      startTime: window.start,
      endTime: new Date(window.end.getTime() - 1),
      bucketSizeInMinutes: 1440,
      timezone: timezone,
      chartType: "timeseries",
      metric: "count",
    });

  return barsOf(
    rows.map((row: TraceAnalyticsTimeseriesRow) => {
      return { time: row.time, count: row.value };
    }),
  );
}

async function exceptionHistogram(
  window: Window,
  timezone?: Timezone | undefined,
): Promise<Map<number, number>> {
  const buckets: Array<ExceptionHistogramBucket> =
    await ExceptionAggregationService.getHistogram({
      projectId: PROJECT,
      startTime: window.start,
      endTime: new Date(window.end.getTime() - 1),
      bucketSizeInMinutes: 1440,
      timezone: timezone,
    });

  return barsOf(buckets);
}

type Read = (
  window: Window,
  timezone?: Timezone | undefined,
) => Promise<Map<number, number>>;

const READS: Array<[string, Read]> = [
  ["the Logs histogram (the minute rollup)", logHistogram],
  ["Logs Analytics", logAnalytics],
  ["the Traces histogram (the minute rollup)", traceHistogram],
  ["Traces Analytics", traceAnalytics],
  ["the Exceptions histogram", exceptionHistogram],
];

integration(
  "Day bars from the reader's midnight, against ClickHouse (#7923)",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    const originals: Array<[ServiceConnection, ServiceConnection]> = [];

    beforeAll(async (): Promise<void> => {
      const url: URL = new URL(endpoint!);

      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error(
          "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
        );
      }

      // Connecting creates the database.
      const options: ClickHouseClientConfigOptions = {
        url: `${url.protocol}//${url.host}`,
        username: decodeURIComponent(url.username) || "default",
        password: decodeURIComponent(url.password),
        database: database,
        request_timeout: 60000,
      };

      clickhouse = new ClickhouseDatabase(options);
      client = await clickhouse.connect(options);

      // With the projections the histograms are read from.
      await createTable(client, clickhouse, Log);
      await createTable(client, clickhouse, Span);
      await createTable(client, clickhouse, ExceptionInstance);

      for (const service of [
        LogService,
        SpanService,
        ExceptionInstanceService,
      ] as Array<ServiceConnection>) {
        originals.push([service, connectionOf(service)]);
        Object.assign(service, {
          database: clickhouse,
          databaseClient: client,
          ingestDatabase: clickhouse,
          ingestDatabaseClient: client,
        });
      }

      await client.insert({
        table: `${database}.${new Log().tableName}`,
        format: "JSONEachRow",
        values: SAMPLES.map(logRow),
      });

      await client.insert({
        table: `${database}.${new Span().tableName}`,
        format: "JSONEachRow",
        values: SAMPLES.map(spanRow),
      });

      await client.insert({
        table: `${database}.${new ExceptionInstance().tableName}`,
        format: "JSONEachRow",
        values: SAMPLES.map(exceptionRow),
      });
    });

    afterAll(async (): Promise<void> => {
      for (const [service, original] of originals) {
        Object.assign(service, original);
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }
    });

    test("the rows are what the platform's clock makes of them: New York's 1 November is 25 hours, 8 March 23", () => {
      const autumn: Map<number, { day: string; count: number }> = expectedDays(
        NEW_YORK,
        SIXTY_DAYS,
      );
      const spring: Map<number, { day: string; count: number }> = expectedDays(
        NEW_YORK,
        SPRING_WEEK,
      );

      const countOn: (
        days: Map<number, { day: string; count: number }>,
        day: string,
      ) => number | undefined = (
        days: Map<number, { day: string; count: number }>,
        day: string,
      ): number | undefined => {
        return Array.from(days.values()).find(
          (entry: { day: string; count: number }): boolean => {
            return entry.day === day;
          },
        )?.count;
      };

      expect(countOn(autumn, "2026-11-01")).toBe(25);
      expect(countOn(autumn, "2026-10-31")).toBe(24);
      expect(countOn(spring, "2026-03-08")).toBe(23);
    });

    describe.each(READS)("%s", (_name: string, read: Read) => {
      test("sixty days in New York: one bar per New York day, each from New York's midnight, every row in exactly one", async () => {
        const bars: Map<number, number> = await read(SIXTY_DAYS, NEW_YORK);

        expectDayBars(bars, NEW_YORK, SIXTY_DAYS);

        // The day the clocks go back is one bar of 25 hours' rows.
        expect(bars.get(Date.parse("2026-11-01T04:00:00.000Z"))).toBe(25);
        // And the days around it start at 04:00 and then 05:00 UTC.
        expect(bars.has(Date.parse("2026-10-31T04:00:00.000Z"))).toBe(true);
        expect(bars.has(Date.parse("2026-11-02T05:00:00.000Z"))).toBe(true);
      });

      test("a week in New York across the clocks going forward: 8 March is one bar of 23 hours' rows", async () => {
        const bars: Map<number, number> = await read(SPRING_WEEK, NEW_YORK);

        expectDayBars(bars, NEW_YORK, SPRING_WEEK);
        expect(bars.get(Date.parse("2026-03-08T05:00:00.000Z"))).toBe(23);
        expect(bars.has(Date.parse("2026-03-09T04:00:00.000Z"))).toBe(true);
      });

      test("Tokyo's days start at 15:00 UTC", async () => {
        const bars: Map<number, number> = await read(
          SIXTY_DAYS,
          Timezone.AsiaTokyo,
        );

        expectDayBars(bars, Timezone.AsiaTokyo, SIXTY_DAYS);

        for (const start of bars.keys()) {
          expect(new Date(start).toISOString().slice(11)).toBe("15:00:00.000Z");
        }
      });

      test("without a zone, the bars are UTC's days, as they always were", async () => {
        const bars: Map<number, number> = await read(SIXTY_DAYS);

        expectDayBars(bars, "UTC", SIXTY_DAYS);

        for (const start of bars.keys()) {
          expect(new Date(start).toISOString().slice(11)).toBe("00:00:00.000Z");
        }
      });
    });

    test("a bar shorter than a day is counted from the epoch, zone or not", async () => {
      const read: (
        timezone?: Timezone | undefined,
      ) => Promise<Array<LogHistogramBucket>> = (
        timezone?: Timezone | undefined,
      ): Promise<Array<LogHistogramBucket>> => {
        return LogAggregationService.getHistogram({
          projectId: PROJECT,
          startTime: SPRING_WEEK.start,
          endTime: SPRING_WEEK.end,
          bucketSizeInMinutes: 360,
          timezone: timezone,
        });
      };

      const zoned: Map<number, number> = barsOf(await read(NEW_YORK));
      const plain: Map<number, number> = barsOf(await read());

      expect(Array.from(zoned.entries())).toEqual(Array.from(plain.entries()));

      for (const start of plain.keys()) {
        expect(start % (6 * HOUR)).toBe(0);
      }
    });
  },
);

describe("The day bars ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
