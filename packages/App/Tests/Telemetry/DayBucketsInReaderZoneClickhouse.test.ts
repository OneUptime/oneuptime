import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import Timezone from "Common/Types/Timezone";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import MetricItemAggMV1m from "Common/Models/AnalyticsModels/MetricItemAggMV1m";
import MetricItemAggMV1mByHostV2 from "Common/Models/AnalyticsModels/MetricItemAggMV1mByHostV2";
import SloHistory from "Common/Models/AnalyticsModels/SloHistory";
import Span, { SpanKind, SpanStatus } from "Common/Models/AnalyticsModels/Span";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import MetricService from "Common/Server/Services/MetricService";
import SloHistoryService from "Common/Server/Services/SloHistoryService";
import SpanService from "Common/Server/Services/SpanService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import BadDataException from "Common/Types/Exception/BadDataException";
import ChartDataPoint, {
  CHART_DATA_POINT_X_AXIS_KEY,
} from "Common/UI/Components/Charts/ChartLibrary/Types/ChartDataPoint";
import SeriesPoints from "Common/UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis,
  XAxisAggregateType,
} from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "Common/UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import DataPointUtil from "Common/UI/Components/Charts/Utils/DataPoint";
import { keyForHost } from "Common/Utils/Telemetry/EntityKey";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ------------------------------------------------------------------
 * A day, a week, a month and a year in the reader's zone, against a real
 * ClickHouse server (issue #7277).
 *
 * A chart over days asks for its buckets in the reader's zone
 * (AggregateBy.timezone), and every aggregate builder starts a day, a week,
 * a month and a year at that zone's midnight, Monday, 1st and 1 January,
 * through one expression (AggregateUtil.buildBucketTimestampStatement).
 * AnalyticsReaderTimezoneStatements.test.ts and
 * MetricServiceReaderTimezone.test.ts pin the words of that SQL. What only
 * a server can show is what the words do: that a New York day holds New
 * York's hours, 23 of them on the day the clocks go forward and 25 on the
 * day they go back; that a Kolkata day starts half past a UTC hour; that a
 * Santiago day whose midnight never comes starts when the clocks resume;
 * that the bucket comes back as the UTC instant the reader's day starts at,
 * whatever zone the session runs in; that every zone the product lists is
 * one the server knows; and that every path a metric read can take (the
 * minute rollup, a host's rollup, the raw table, a percentile), the
 * builder every other model reads through (an SLO's history) and the span
 * projections the trace charts read (whose window once read the bucket in
 * place of the span's start, and lost its first day) do the same.
 *
 * The bucket each sample belongs in is worked out here on the platform's
 * own clock (Intl), not by the code under test.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/DayBucketsInReaderZoneClickhouse.test.ts
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

const database: string = `reader_zone_buckets_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const METRIC: string = "http.server.request.count";
const HOST: string = "web-1";
const HOST_ATTRIBUTE: string = "resource.host.name";
const ENVIRONMENT_ATTRIBUTE: string = "deployment.environment";

// A sample on every hour of the periods below: the tables a reader can check.
const HOURLY_PROJECT: ObjectID = new ObjectID("7c00000000000000000000a1");
// The same hours, and a sample either side of every zone's midnight.
const EDGES_PROJECT: ObjectID = new ObjectID("7c00000000000000000000a2");
const SERVICE_ID: ObjectID = new ObjectID("7c00000000000000000000b1");
// The service a failed child span of each hour's request belongs to.
const DATABASE_SERVICE_ID: ObjectID = new ObjectID("7c00000000000000000000b2");
const SLO_ID: ObjectID = new ObjectID("7c00000000000000000000c1");
const SLO_SERIES: string = "good.count";

let nextProject: number = 1;

// A project with nothing written to it, which no read has looked up yet.
function emptyProject(): ObjectID {
  return new ObjectID(`7c00000000000000000000f${(nextProject++).toString(16)}`);
}

const retention: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
);

// ---- The periods sampled, each around a day some zone makes odd.

interface Period {
  name: string;
  start: Date;
  end: Date;
}

function period(name: string, startDay: string, endDay: string): Period {
  return {
    name: name,
    start: new Date(`${startDay}T00:00:00.000Z`),
    end: new Date(`${endDay}T00:00:00.000Z`),
  };
}

// New York's clocks go forward at 07:00 UTC on 8 March: that day has 23 hours.
const NEW_YORK_SPRING: Period = period(
  "New York's clocks go forward",
  "2026-03-05",
  "2026-03-11",
);

/*
 * New York's clocks go back at 06:00 UTC on 1 November: that day has 25
 * hours, and is the first of November.
 */
const NEW_YORK_FALL: Period = period(
  "New York's clocks go back",
  "2026-10-29",
  "2026-11-04",
);

// Santiago, Auckland and Lord Howe put their clocks back on 4 and 5 April.
const SOUTH_FALL: Period = period(
  "the south's clocks go back",
  "2026-04-02",
  "2026-04-08",
);

/*
 * Santiago's clocks skip its midnight on 6 September: 24:00 on the 5th is
 * 01:00 on the 6th, and the 6th starts then.
 */
const SANTIAGO_SPRING: Period = period(
  "Santiago skips a midnight",
  "2026-09-04",
  "2026-09-08",
);

// Auckland's clocks go forward on 27 September, Lord Howe's on 4 October.
const SOUTH_SPRING: Period = period(
  "the south's clocks go forward",
  "2026-09-25",
  "2026-10-06",
);

const NEW_YEAR: Period = period("the year turns", "2025-12-30", "2026-01-03");

const PERIODS: Array<Period> = [
  NEW_YEAR,
  NEW_YORK_SPRING,
  SOUTH_FALL,
  SANTIAGO_SPRING,
  SOUTH_SPRING,
  NEW_YORK_FALL,
];

// Every period, for a read of weeks, months and years.
const WHOLE_SPAN: Period = period("every period", "2025-12-29", "2026-11-05");

/*
 * The windows a trace chart reads with no interval pinned, so the server
 * picks one from the window's length: days for more than a week, weeks for
 * more than six, months for more than six months. Each starts in the
 * middle of every zone's day.
 */
const TEN_DAYS: Period = {
  name: "ten days from 02:00 UTC on 5 March",
  start: new Date("2026-03-05T02:00:00.000Z"),
  end: new Date("2026-03-15T02:00:00.000Z"),
};
const TWO_MONTHS: Period = {
  name: "two months from 02:00 UTC on 4 September",
  start: new Date("2026-09-04T02:00:00.000Z"),
  end: new Date("2026-11-04T02:00:00.000Z"),
};
const TEN_MONTHS: Period = {
  name: "ten months from 02:00 UTC on 29 December",
  start: new Date("2025-12-29T02:00:00.000Z"),
  end: new Date("2026-11-05T00:00:00.000Z"),
};

// The zones read against the platform's clock.
const ZONES: Array<Timezone> = [
  Timezone.AmericaNew_York,
  Timezone.UTC,
  Timezone.AsiaTokyo,
  Timezone.AsiaKolkata,
  Timezone.AmericaSantiago,
  Timezone.PacificAuckland,
  Timezone.AustraliaLord_Howe,
  Timezone.AsiaKathmandu,
];

// ---- The platform's own clock, which the buckets are worked out on.

const DATE_FORMATS: Map<string, Intl.DateTimeFormat> = new Map();

// "2026-03-08": the date the zone's clocks read at `instant`.
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

  const parts: Array<Intl.DateTimeFormatPart> = format.formatToParts(
    new Date(instant),
  );
  const part: (type: Intl.DateTimeFormatPartTypes) => string = (
    type: Intl.DateTimeFormatPartTypes,
  ): string => {
    return (
      parts.find((candidate: Intl.DateTimeFormatPart): boolean => {
        return candidate.type === type;
      })?.value || ""
    );
  };

  return `${part("year")}-${part("month")}-${part("day")}`;
}

const DAY_STARTS: Map<string, number> = new Map();

/*
 * The first instant the zone's clocks read `day`: its midnight, or when
 * the clocks resume on a day they skip midnight. Every zone's day starts
 * within 15 hours either side of the same date's UTC midnight, and in the
 * zones read here the date only moves forward, so a search by the minute
 * between the two finds it.
 */
function startOfLocalDay(zone: string, day: string): number {
  const key: string = `${zone}|${day}`;
  const known: number | undefined = DAY_STARTS.get(key);

  if (known !== undefined) {
    return known;
  }

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

  DAY_STARTS.set(key, onOrAfter);

  return onOrAfter;
}

// The calendar day `days` days after `day`.
function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY)
    .toISOString()
    .slice(0, 10);
}

// The day the bucket of `interval` that holds `day` starts on.
function bucketDayOf(day: string, interval: AggregationInterval): string {
  switch (interval) {
    case AggregationInterval.Day:
      return day;
    case AggregationInterval.Week: {
      // Weeks start on Monday.
      const daysSinceMonday: number =
        (new Date(`${day}T00:00:00.000Z`).getUTCDay() + 6) % 7;

      return addDays(day, -daysSinceMonday);
    }
    case AggregationInterval.Month:
      return `${day.slice(0, 7)}-01`;
    case AggregationInterval.Year:
      return `${day.slice(0, 4)}-01-01`;
    default:
      throw new Error(`${interval} does not start on a day`);
  }
}

// ---- The samples.

interface Sample {
  time: number;
  // Its place among all the samples of its set, in time: 1, 2, 3 ...
  rank: number;
}

function hoursOf(periods: Array<Period>): Array<number> {
  const times: Array<number> = [];

  for (const each of periods) {
    for (
      let time: number = each.start.getTime();
      time < each.end.getTime();
      time += HOUR
    ) {
      times.push(time);
    }
  }

  return times;
}

/*
 * Every zone's midnights well inside a period, and the last millisecond
 * before each.
 */
function midnightsOf(
  periods: Array<Period>,
  zones: Array<string>,
): Array<number> {
  const times: Array<number> = [];

  for (const each of periods) {
    for (const zone of zones) {
      const lastDay: string = addDays(localDateIn(zone, each.end.getTime()), 1);

      for (
        let day: string = localDateIn(zone, each.start.getTime());
        day <= lastDay;
        day = addDays(day, 1)
      ) {
        const midnight: number = startOfLocalDay(zone, day);

        if (
          midnight >= each.start.getTime() + 2 * HOUR &&
          midnight <= each.end.getTime() - 2 * HOUR
        ) {
          times.push(midnight - 1, midnight);
        }
      }
    }
  }

  return times;
}

function ranked(times: Array<number>): Array<Sample> {
  return [...times]
    .sort((left: number, right: number): number => {
      return left - right;
    })
    .map((time: number, index: number): Sample => {
      return { time: time, rank: index + 1 };
    });
}

const HOURLY: Array<Sample> = ranked(hoursOf(PERIODS));
const EDGES: Array<Sample> = ranked([
  ...hoursOf(PERIODS),
  ...midnightsOf(PERIODS, ZONES),
]);

// The first sample of a set at an instant.
function rankAt(samples: Array<Sample>, instant: string): number {
  return samples.find((sample: Sample): boolean => {
    return sample.time === Date.parse(instant);
  })!.rank;
}

// ---- The buckets the samples belong in.

interface Bucket {
  time: string;
  count: number;
  // The first and the last sample in it.
  min: number;
  max: number;
}

function expectedBuckets(data: {
  samples: Array<Sample>;
  zone: string;
  interval: AggregationInterval;
  window: Period;
}): Array<Bucket> {
  const buckets: Map<number, Bucket> = new Map();

  for (const sample of data.samples) {
    if (
      sample.time < data.window.start.getTime() ||
      sample.time > data.window.end.getTime()
    ) {
      continue;
    }

    const start: number =
      data.interval === AggregationInterval.Hour
        ? Math.floor(sample.time / HOUR) * HOUR
        : startOfLocalDay(
            data.zone,
            bucketDayOf(localDateIn(data.zone, sample.time), data.interval),
          );
    const bucket: Bucket | undefined = buckets.get(start);

    if (!bucket) {
      buckets.set(start, {
        time: new Date(start).toISOString(),
        count: 1,
        min: sample.rank,
        max: sample.rank,
      });
      continue;
    }

    bucket.count++;
    bucket.min = Math.min(bucket.min, sample.rank);
    bucket.max = Math.max(bucket.max, sample.rank);
  }

  return [...buckets.values()].sort((left: Bucket, right: Bucket): number => {
    return left.time.localeCompare(right.time);
  });
}

// ---- Rows as ingest writes them.

function metricRowOf(project: ObjectID, sample: Sample): JSONObject {
  const time: Date = new Date(sample.time);

  return {
    _id: ObjectID.generate().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: project.toString(),
    primaryEntityId: SERVICE_ID.toString(),
    primaryEntityType: "Service",
    name: METRIC,
    aggregationTemporality: "Delta",
    metricPointType: "Gauge",
    time: OneUptimeDate.toClickhouseDateTime64(time),
    timeUnixNano: String(sample.time * 1000000 + sample.rank),
    attributes: {
      [HOST_ATTRIBUTE]: HOST,
      [ENVIRONMENT_ATTRIBUTE]: "production",
    },
    attributeKeys: [HOST_ATTRIBUTE, ENVIRONMENT_ATTRIBUTE],
    entityKeys: [],
    // As ingest stamps it, from the resource.
    hostEntityKey: keyForHost(project.toString(), HOST),
    value: sample.rank,
    retentionDate: retention,
  };
}

// An SLO's history row as SloHistoryService.insertHistoryRows writes it.
function sloRowOf(sample: Sample): JSONObject {
  return {
    _id: ObjectID.generate().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: HOURLY_PROJECT.toString(),
    sloId: SLO_ID.toString(),
    metricName: SLO_SERIES,
    bucketStart: OneUptimeDate.toClickhouseDateTime(new Date(sample.time)),
    value: sample.rank,
    version: 1,
  };
}

interface RequestSpan {
  service: ObjectID;
  isRoot: boolean;
  status: SpanStatus;
  nanos: number;
}

/*
 * A request at each sample, as ingest writes its spans: the service's root
 * span, which took `rank` nanoseconds and set no status, and a failed child
 * span the database service ran, which took a thousand times as long.
 */
function spanRowsOf(sample: Sample): Array<JSONObject> {
  const time: string = OneUptimeDate.toClickhouseDateTime64(
    new Date(sample.time),
  );
  const startNanos: bigint = BigInt(sample.time) * BigInt(1000000);
  const spans: Array<RequestSpan> = [
    {
      service: SERVICE_ID,
      isRoot: true,
      status: SpanStatus.Unset,
      nanos: sample.rank,
    },
    {
      service: DATABASE_SERVICE_ID,
      isRoot: false,
      status: SpanStatus.Error,
      nanos: sample.rank * 1000,
    },
  ];

  return spans.map((span: RequestSpan, index: number): JSONObject => {
    return {
      projectId: HOURLY_PROJECT.toString(),
      primaryEntityId: span.service.toString(),
      primaryEntityType: "Service",
      startTime: time,
      endTime: time,
      startTimeUnixNano: startNanos.toString(),
      endTimeUnixNano: (startNanos + BigInt(span.nanos)).toString(),
      durationUnixNano: String(span.nanos),
      traceId: `trace-${sample.rank}`,
      spanId: `span-${sample.rank}-${index}`,
      parentSpanId: span.isRoot ? "" : `span-${sample.rank}-0`,
      attributes: {},
      attributeKeys: [],
      entityKeys: [],
      statusCode: span.status,
      name: span.isRoot ? "GET /orders" : "SELECT orders",
      kind: span.isRoot ? SpanKind.Server : SpanKind.Client,
      isRootSpan: span.isRoot,
      retentionDate: retention,
    };
  });
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

  // A rollup's own view, read from the table it is written for.
  for (const view of model.materializedViews || []) {
    await client.command({ query: view.query });
  }
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

// ---- Reads.

/*
 * The paths a metric read over `value` by `time` can take, by its filter:
 * none reads the project's minute rollup; the host alone reads the host's
 * rollup; any other attribute reads the raw table.
 */
type MetricPath = "the minute rollup" | "the host's rollup" | "the raw table";

const METRIC_PATHS: Array<MetricPath> = [
  "the minute rollup",
  "the host's rollup",
  "the raw table",
];

const PATH_ATTRIBUTES: Record<MetricPath, JSONObject | undefined> = {
  "the minute rollup": undefined,
  "the host's rollup": { [HOST_ATTRIBUTE]: HOST },
  "the raw table": { [ENVIRONMENT_ATTRIBUTE]: "production" },
};

interface Row {
  time: string;
  value: number;
}

interface MetricRead {
  project: ObjectID;
  window: Period;
  interval: AggregationInterval;
  type: AggregationType;
  // Left out when undefined, passed as it is otherwise, null included.
  timezone?: unknown;
  path: MetricPath;
}

function rowsOf(result: AggregatedResult): Array<Row> {
  return result.data
    .map((row: AggregatedResult["data"][number]): Row => {
      return {
        time: new Date(row.timestamp).toISOString(),
        value: Number(row.value),
      };
    })
    .sort((left: Row, right: Row): number => {
      return left.time.localeCompare(right.time);
    });
}

function aggregateMetric(read: MetricRead): Promise<AggregatedResult> {
  const attributes: JSONObject | undefined = PATH_ATTRIBUTES[read.path];

  return MetricService.aggregateBy({
    query: {
      projectId: read.project,
      name: METRIC,
      time: new InBetween<Date>(read.window.start, read.window.end),
      ...(attributes ? { attributes: attributes } : {}),
    } as never,
    aggregationType: read.type,
    aggregateColumnName: "value",
    aggregationTimestampColumnName: "time",
    aggregationInterval: read.interval,
    startTimestamp: read.window.start,
    endTimestamp: read.window.end,
    ...(read.timezone !== undefined ? { timezone: read.timezone } : {}),
    limit: 10000,
    skip: 0,
    props: { isRoot: true },
  } as never);
}

async function readMetric(read: MetricRead): Promise<Array<Row>> {
  return rowsOf(await aggregateMetric(read));
}

// A read, and the statement it ran: one read at a time.
async function readMetricAndStatement(
  read: MetricRead,
): Promise<{ rows: Array<Row>; statement: string }> {
  const executed: SpyInstance<typeof MetricService.executeQuery> = jest.spyOn(
    MetricService,
    "executeQuery",
  );

  try {
    const rows: Array<Row> = await readMetric(read);
    const calls: Array<Parameters<typeof MetricService.executeQuery>> =
      executed.mock.calls;
    const last: Statement | string = calls[calls.length - 1]![0];

    return {
      rows: rows,
      statement: last instanceof Statement ? last.query : last,
    };
  } finally {
    executed.mockRestore();
  }
}

// What each path reads from, in the statement it runs.
function expectReadFrom(
  statement: string,
  path: MetricPath | "a percentile",
): void {
  switch (path) {
    case "the minute rollup":
      expect(statement).toContain(".MetricItemAggMV1m WHERE");
      return;
    case "the host's rollup":
      expect(statement).toContain(".MetricItemAggMV1mByHostV2");
      return;
    case "the raw table":
      expect(statement).toContain(".MetricItemV3");
      expect(statement).not.toContain("MetricItemAggMV1m");
      expect(statement).not.toContain("quantileExactWeighted");
      return;
    case "a percentile":
      expect(statement).toContain(".MetricItemV3");
      expect(statement).toContain("quantileExactWeighted");
      return;
  }
}

async function readSloHistory(data: {
  window: Period;
  interval: AggregationInterval;
  timezone?: unknown;
}): Promise<Array<Row>> {
  return rowsOf(
    await SloHistoryService.aggregateBy({
      query: {
        projectId: HOURLY_PROJECT,
        sloId: SLO_ID,
        metricName: SLO_SERIES,
        bucketStart: new InBetween<Date>(data.window.start, data.window.end),
      } as never,
      aggregationType: AggregationType.Count,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "bucketStart",
      aggregationInterval: data.interval,
      startTimestamp: data.window.start,
      endTimestamp: data.window.end,
      ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
      limit: 10000,
      skip: 0,
      props: { isRoot: true },
    } as never),
  );
}

/*
 * A trace chart's read of span durations by startTime, with no interval
 * pinned (the window picks it), as SpanService's projection statement
 * serves it.
 */
interface SpanRead {
  window: Period;
  type: AggregationType;
  // Left out when undefined, passed as it is otherwise.
  timezone?: unknown;
  // The filters past the project and the window.
  filters?: Record<string, unknown>;
}

function aggregateSpans(read: SpanRead): Promise<AggregatedResult> {
  return SpanService.aggregateBy({
    query: {
      projectId: HOURLY_PROJECT,
      startTime: new InBetween<Date>(read.window.start, read.window.end),
      ...(read.filters || {}),
    } as never,
    aggregationType: read.type,
    aggregateColumnName: "durationUnixNano",
    aggregationTimestampColumnName: "startTime",
    startTimestamp: read.window.start,
    endTimestamp: read.window.end,
    ...(read.timezone !== undefined ? { timezone: read.timezone } : {}),
    limit: 10000,
    skip: 0,
    props: { isRoot: true },
  } as never);
}

// A read, and the statement it ran: one read at a time.
async function readSpansAndStatement(
  read: SpanRead,
): Promise<{ rows: Array<Row>; statement: Statement }> {
  const executed: SpyInstance<typeof SpanService.executeQuery> = jest.spyOn(
    SpanService,
    "executeQuery",
  );

  try {
    const rows: Array<Row> = rowsOf(await aggregateSpans(read));
    const calls: Array<Parameters<typeof SpanService.executeQuery>> =
      executed.mock.calls;
    const last: Statement | string = calls[calls.length - 1]![0];

    if (!(last instanceof Statement)) {
      throw new Error("A span read ran a statement with no parameters.");
    }

    return { rows: rows, statement: last };
  } finally {
    executed.mockRestore();
  }
}

async function readSpans(read: SpanRead): Promise<Array<Row>> {
  return (await readSpansAndStatement(read)).rows;
}

// ClickHouse's text of a DateTime in UTC, as an ISO instant.
function instantOf(text: unknown): string {
  return new Date(`${String(text).replace(" ", "T")}Z`).toISOString();
}

/*
 * The rows a statement reads when the server must answer it from one of the
 * table's projections: force_optimize_projection refuses a statement no
 * projection can serve.
 */
async function rowsThroughAProjection(
  client: ClickhouseClient,
  statement: Statement,
): Promise<Array<Row>> {
  const result: Awaited<ReturnType<ClickhouseClient["query"]>> =
    await client.query({
      query: statement.query,
      query_params: statement.query_params,
      format: "JSON",
      clickhouse_settings: { force_optimize_projection: 1 },
    });
  // The JSON format's body: its rows under data.
  const json: { data?: Array<JSONObject> } = (await result.json()) as {
    data?: Array<JSONObject>;
  };

  return (json.data || [])
    .map((row: JSONObject): Row => {
      return {
        time: instantOf(row["startTime"]),
        value: Number(row["durationUnixNano"]),
      };
    })
    .sort((left: Row, right: Row): number => {
      return left.time.localeCompare(right.time);
    });
}

function countsOf(buckets: Array<Bucket>): Array<Row> {
  return buckets.map((bucket: Bucket): Row => {
    return { time: bucket.time, value: bucket.count };
  });
}

function rowsFromTable(buckets: Array<[string, number]>): Array<Row> {
  return buckets.map(([time, value]: [string, number]): Row => {
    return { time: new Date(time).toISOString(), value: value };
  });
}

// ---- The tables a reader can check: an hourly sample, counted.

interface CountTable {
  zone: Timezone;
  window: Period;
  interval: AggregationInterval;
  // Each bucket's UTC instant, and the hours in it.
  buckets: Array<[string, number]>;
}

const TABLES: Array<CountTable> = [
  {
    zone: Timezone.AmericaNew_York,
    window: NEW_YORK_SPRING,
    interval: AggregationInterval.Day,
    // Midnight is 05:00 UTC until the clocks go forward, 04:00 after.
    buckets: [
      // The window starts at 19:00 on 4 March.
      ["2026-03-04T05:00:00Z", 5],
      ["2026-03-05T05:00:00Z", 24],
      ["2026-03-06T05:00:00Z", 24],
      ["2026-03-07T05:00:00Z", 24],
      // The clocks go forward: 23 hours.
      ["2026-03-08T05:00:00Z", 23],
      ["2026-03-09T04:00:00Z", 24],
      // The window ends at 20:00 on 10 March.
      ["2026-03-10T04:00:00Z", 20],
    ],
  },
  {
    zone: Timezone.UTC,
    window: NEW_YORK_SPRING,
    interval: AggregationInterval.Day,
    buckets: [
      ["2026-03-05T00:00:00Z", 24],
      ["2026-03-06T00:00:00Z", 24],
      ["2026-03-07T00:00:00Z", 24],
      ["2026-03-08T00:00:00Z", 24],
      ["2026-03-09T00:00:00Z", 24],
      ["2026-03-10T00:00:00Z", 24],
    ],
  },
  {
    zone: Timezone.AsiaTokyo,
    window: NEW_YORK_SPRING,
    interval: AggregationInterval.Day,
    // Midnight is 15:00 UTC the day before.
    buckets: [
      ["2026-03-04T15:00:00Z", 15],
      ["2026-03-05T15:00:00Z", 24],
      ["2026-03-06T15:00:00Z", 24],
      ["2026-03-07T15:00:00Z", 24],
      ["2026-03-08T15:00:00Z", 24],
      ["2026-03-09T15:00:00Z", 24],
      ["2026-03-10T15:00:00Z", 9],
    ],
  },
  {
    zone: Timezone.AsiaKolkata,
    window: NEW_YORK_SPRING,
    interval: AggregationInterval.Day,
    // Midnight is 18:30 UTC the day before: half past a UTC hour.
    buckets: [
      ["2026-03-04T18:30:00Z", 19],
      ["2026-03-05T18:30:00Z", 24],
      ["2026-03-06T18:30:00Z", 24],
      ["2026-03-07T18:30:00Z", 24],
      ["2026-03-08T18:30:00Z", 24],
      ["2026-03-09T18:30:00Z", 24],
      ["2026-03-10T18:30:00Z", 5],
    ],
  },
  {
    zone: Timezone.AmericaNew_York,
    window: NEW_YORK_FALL,
    interval: AggregationInterval.Day,
    // Midnight is 04:00 UTC until the clocks go back, 05:00 after.
    buckets: [
      ["2026-10-28T04:00:00Z", 4],
      ["2026-10-29T04:00:00Z", 24],
      ["2026-10-30T04:00:00Z", 24],
      ["2026-10-31T04:00:00Z", 24],
      // The clocks go back: 25 hours.
      ["2026-11-01T04:00:00Z", 25],
      ["2026-11-02T05:00:00Z", 24],
      ["2026-11-03T05:00:00Z", 19],
    ],
  },
  {
    zone: Timezone.UTC,
    window: NEW_YORK_FALL,
    interval: AggregationInterval.Day,
    buckets: [
      ["2026-10-29T00:00:00Z", 24],
      ["2026-10-30T00:00:00Z", 24],
      ["2026-10-31T00:00:00Z", 24],
      ["2026-11-01T00:00:00Z", 24],
      ["2026-11-02T00:00:00Z", 24],
      ["2026-11-03T00:00:00Z", 24],
    ],
  },
  {
    zone: Timezone.AsiaTokyo,
    window: NEW_YORK_FALL,
    interval: AggregationInterval.Day,
    buckets: [
      ["2026-10-28T15:00:00Z", 15],
      ["2026-10-29T15:00:00Z", 24],
      ["2026-10-30T15:00:00Z", 24],
      ["2026-10-31T15:00:00Z", 24],
      ["2026-11-01T15:00:00Z", 24],
      ["2026-11-02T15:00:00Z", 24],
      ["2026-11-03T15:00:00Z", 9],
    ],
  },
  {
    zone: Timezone.AsiaKolkata,
    window: NEW_YORK_FALL,
    interval: AggregationInterval.Day,
    buckets: [
      ["2026-10-28T18:30:00Z", 19],
      ["2026-10-29T18:30:00Z", 24],
      ["2026-10-30T18:30:00Z", 24],
      ["2026-10-31T18:30:00Z", 24],
      ["2026-11-01T18:30:00Z", 24],
      ["2026-11-02T18:30:00Z", 24],
      ["2026-11-03T18:30:00Z", 5],
    ],
  },
  {
    zone: Timezone.AmericaNew_York,
    window: NEW_YORK_SPRING,
    interval: AggregationInterval.Week,
    // Monday 2 March at midnight EST, Monday 9 March at midnight EDT.
    buckets: [
      ["2026-03-02T05:00:00Z", 100],
      ["2026-03-09T04:00:00Z", 44],
    ],
  },
  {
    zone: Timezone.UTC,
    window: NEW_YORK_SPRING,
    interval: AggregationInterval.Week,
    buckets: [
      ["2026-03-02T00:00:00Z", 96],
      ["2026-03-09T00:00:00Z", 48],
    ],
  },
  {
    zone: Timezone.AsiaTokyo,
    window: NEW_YORK_SPRING,
    interval: AggregationInterval.Week,
    buckets: [
      ["2026-03-01T15:00:00Z", 87],
      ["2026-03-08T15:00:00Z", 57],
    ],
  },
  {
    zone: Timezone.AsiaKolkata,
    window: NEW_YORK_SPRING,
    interval: AggregationInterval.Week,
    buckets: [
      ["2026-03-01T18:30:00Z", 91],
      ["2026-03-08T18:30:00Z", 53],
    ],
  },
  {
    zone: Timezone.AmericaNew_York,
    window: NEW_YORK_FALL,
    interval: AggregationInterval.Month,
    // November starts on the day the clocks go back, at midnight EDT.
    buckets: [
      ["2026-10-01T04:00:00Z", 76],
      ["2026-11-01T04:00:00Z", 68],
    ],
  },
  {
    zone: Timezone.UTC,
    window: NEW_YORK_FALL,
    interval: AggregationInterval.Month,
    buckets: [
      ["2026-10-01T00:00:00Z", 72],
      ["2026-11-01T00:00:00Z", 72],
    ],
  },
  {
    zone: Timezone.AsiaTokyo,
    window: NEW_YORK_FALL,
    interval: AggregationInterval.Month,
    buckets: [
      ["2026-09-30T15:00:00Z", 63],
      ["2026-10-31T15:00:00Z", 81],
    ],
  },
  {
    zone: Timezone.AsiaKolkata,
    window: NEW_YORK_FALL,
    interval: AggregationInterval.Month,
    buckets: [
      ["2026-09-30T18:30:00Z", 67],
      ["2026-10-31T18:30:00Z", 77],
    ],
  },
  {
    zone: Timezone.AmericaNew_York,
    window: NEW_YEAR,
    interval: AggregationInterval.Year,
    buckets: [
      ["2025-01-01T05:00:00Z", 53],
      ["2026-01-01T05:00:00Z", 43],
    ],
  },
  {
    zone: Timezone.UTC,
    window: NEW_YEAR,
    interval: AggregationInterval.Year,
    buckets: [
      ["2025-01-01T00:00:00Z", 48],
      ["2026-01-01T00:00:00Z", 48],
    ],
  },
  {
    zone: Timezone.AsiaTokyo,
    window: NEW_YEAR,
    interval: AggregationInterval.Year,
    buckets: [
      ["2024-12-31T15:00:00Z", 39],
      ["2025-12-31T15:00:00Z", 57],
    ],
  },
  {
    zone: Timezone.AsiaKolkata,
    window: NEW_YEAR,
    interval: AggregationInterval.Year,
    buckets: [
      ["2024-12-31T18:30:00Z", 43],
      ["2025-12-31T18:30:00Z", 53],
    ],
  },
];

function tableName(table: CountTable): string {
  return `${table.interval} in ${table.zone}, ${table.window.name}`;
}

// ---- The chart a reader sees.

const Y_AXIS: YAxis = {
  legend: "",
  options: {
    type: YAxisType.Number,
    min: 0,
    max: "auto",
    precision: YAxisPrecision.NoDecimals,
    formatter: (value: number): string => {
      return String(value);
    },
  },
};

// A space, a no-break space or a narrow one: the same to a reader.
function spaced(text: string): string {
  return text.replace(/\s/g, " ");
}

// The rows a day chart of the window draws from the rows the server sent.
function chartOf(window: Period, rows: Array<Row>): Array<[string, unknown]> {
  const series: SeriesPoints = {
    seriesName: "Requests",
    data: rows.map((row: Row): { x: Date; y: number } => {
      return { x: new Date(row.time), y: row.value };
    }),
  };
  const xAxis: XAxis = {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: window.start,
      max: window.end,
      aggregateType: XAxisAggregateType.Sum,
      precision: XAxisPrecision.EVERY_DAY,
    },
  };

  return DataPointUtil.getChartDataPoints({
    seriesPoints: [series],
    xAxis: xAxis,
    yAxis: Y_AXIS,
  }).map((row: ChartDataPoint): [string, unknown] => {
    return [spaced(String(row[CHART_DATA_POINT_X_AXIS_KEY])), row["Requests"]];
  });
}

integration(
  "Day, week, month and year buckets in the reader's zone, against ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    let zoned: ClickhouseDatabase;
    let zonedClient: ClickhouseClient;
    let originalMetric: ServiceConnection | undefined;
    let originalSlo: ServiceConnection | undefined;
    let originalSpan: ServiceConnection | undefined;

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

      /*
       * A server in another zone, without one to hand: every statement of a
       * session in that zone reads as such a server does.
       */
      const zonedOptions: ClickHouseClientConfigOptions = {
        ...options,
        clickhouse_settings: { session_timezone: "Asia/Tokyo" },
      };

      zoned = new ClickhouseDatabase(zonedOptions);
      zonedClient = await zoned.connect(zonedOptions);

      await createTable(client, clickhouse, Metric);
      await createTable(client, clickhouse, MetricItemAggMV1m);
      await createTable(client, clickhouse, MetricItemAggMV1mByHostV2);
      await createTable(client, clickhouse, SloHistory);
      // With the projections the trace charts are read from.
      await createTable(client, clickhouse, Span);

      originalMetric = connectionOf(MetricService);
      originalSlo = connectionOf(SloHistoryService);
      originalSpan = connectionOf(SpanService);

      for (const service of [MetricService, SloHistoryService, SpanService]) {
        Object.assign(service, {
          database: clickhouse,
          databaseClient: client,
          ingestDatabase: clickhouse,
          ingestDatabaseClient: client,
        });
      }

      // Written by the plain session: a session's zone moves how text is read.
      await client.insert({
        table: `${database}.${new Metric().tableName}`,
        format: "JSONEachRow",
        values: [
          ...HOURLY.map((sample: Sample): JSONObject => {
            return metricRowOf(HOURLY_PROJECT, sample);
          }),
          ...EDGES.map((sample: Sample): JSONObject => {
            return metricRowOf(EDGES_PROJECT, sample);
          }),
        ],
      });

      await client.insert({
        table: `${database}.${new SloHistory().tableName}`,
        format: "JSONEachRow",
        values: HOURLY.map(sloRowOf),
      });

      await client.insert({
        table: `${database}.${new Span().tableName}`,
        format: "JSONEachRow",
        values: HOURLY.flatMap(spanRowsOf),
      });
    });

    afterAll(async (): Promise<void> => {
      if (originalMetric) {
        Object.assign(MetricService, originalMetric);
      }

      if (originalSlo) {
        Object.assign(SloHistoryService, originalSlo);
      }

      if (originalSpan) {
        Object.assign(SpanService, originalSpan);
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (zoned) {
        await zoned.disconnect();
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }
    });

    describe("New York, UTC, Tokyo and Kolkata, an hour at a time", () => {
      test("the tables are what the platform's clock makes of the samples", () => {
        for (const table of TABLES) {
          expect({
            table: tableName(table),
            buckets: countsOf(
              expectedBuckets({
                samples: HOURLY,
                zone: table.zone,
                interval: table.interval,
                window: table.window,
              }),
            ),
          }).toEqual({
            table: tableName(table),
            buckets: rowsFromTable(table.buckets),
          });
        }
      });

      test.each(METRIC_PATHS)(
        "read from %s, each bucket holds its zone's hours",
        async (path: MetricPath) => {
          for (const table of TABLES) {
            const read: { rows: Array<Row>; statement: string } =
              await readMetricAndStatement({
                project: HOURLY_PROJECT,
                window: table.window,
                interval: table.interval,
                type: AggregationType.Count,
                timezone: table.zone,
                path: path,
              });

            expectReadFrom(read.statement, path);
            expect({ table: tableName(table), rows: read.rows }).toEqual({
              table: tableName(table),
              rows: rowsFromTable(table.buckets),
            });
          }
        },
      );

      test("an SLO's history, read through the builder every other model reads through, holds its zone's hours", async () => {
        for (const table of TABLES) {
          expect({
            table: tableName(table),
            rows: await readSloHistory({
              window: table.window,
              interval: table.interval,
              timezone: table.zone,
            }),
          }).toEqual({
            table: tableName(table),
            rows: rowsFromTable(table.buckets),
          });
        }
      });

      test("a percentile's buckets start at the zone's midnights, Mondays, 1sts and 1 Januaries", async () => {
        for (const table of TABLES) {
          const read: { rows: Array<Row>; statement: string } =
            await readMetricAndStatement({
              project: HOURLY_PROJECT,
              window: table.window,
              interval: table.interval,
              type: AggregationType.P90,
              timezone: table.zone,
              path: "the minute rollup",
            });

          expectReadFrom(read.statement, "a percentile");
          expect({
            table: tableName(table),
            times: read.rows.map((row: Row): string => {
              return row.time;
            }),
          }).toEqual({
            table: tableName(table),
            times: rowsFromTable(table.buckets).map((row: Row): string => {
              return row.time;
            }),
          });
        }
      });
    });

    describe("every sample in the bucket of its reader's day, week, month and year", () => {
      const READS: Array<{ interval: AggregationInterval; window: Period }> = [
        ...PERIODS.map(
          (each: Period): { interval: AggregationInterval; window: Period } => {
            return { interval: AggregationInterval.Day, window: each };
          },
        ),
        { interval: AggregationInterval.Week, window: WHOLE_SPAN },
        { interval: AggregationInterval.Month, window: WHOLE_SPAN },
        { interval: AggregationInterval.Year, window: WHOLE_SPAN },
      ];

      test.each(ZONES)("read in %s", async (zone: Timezone) => {
        for (const { interval, window } of READS) {
          const expected: Array<Bucket> = expectedBuckets({
            samples: EDGES,
            zone: zone,
            interval: interval,
            window: window,
          });
          const context: string = `${interval} over ${window.name}`;

          for (const path of METRIC_PATHS) {
            const read: (type: AggregationType) => Promise<Array<Row>> = (
              type: AggregationType,
            ): Promise<Array<Row>> => {
              return readMetric({
                project: EDGES_PROJECT,
                window: window,
                interval: interval,
                type: type,
                timezone: zone,
                path: path,
              });
            };

            expect({
              context: context,
              path: path,
              count: await read(AggregationType.Count),
              first: await read(AggregationType.Min),
              last: await read(AggregationType.Max),
            }).toEqual({
              context: context,
              path: path,
              count: countsOf(expected),
              first: expected.map((bucket: Bucket): Row => {
                return { time: bucket.time, value: bucket.min };
              }),
              last: expected.map((bucket: Bucket): Row => {
                return { time: bucket.time, value: bucket.max };
              }),
            });
          }

          // A percentile is one of its bucket's own samples.
          const percentiles: Array<Row> = await readMetric({
            project: EDGES_PROJECT,
            window: window,
            interval: interval,
            type: AggregationType.P90,
            timezone: zone,
            path: "the minute rollup",
          });

          expect({
            context: context,
            times: percentiles.map((row: Row): string => {
              return row.time;
            }),
          }).toEqual({
            context: context,
            times: expected.map((bucket: Bucket): string => {
              return bucket.time;
            }),
          });

          percentiles.forEach((row: Row, index: number): void => {
            expect(row.value).toBeGreaterThanOrEqual(expected[index]!.min);
            expect(row.value).toBeLessThanOrEqual(expected[index]!.max);
          });
        }
      });

      test("the last millisecond before New York's midnight is the day before's, and the midnight is its own day's", async () => {
        const lastOfSeventh: number = rankAt(EDGES, "2026-03-08T04:59:59.999Z");
        const firstOfEighth: number = rankAt(EDGES, "2026-03-08T05:00:00.000Z");
        const lastOfEighth: number = rankAt(EDGES, "2026-03-09T03:59:59.999Z");
        const firstOfNinth: number = rankAt(EDGES, "2026-03-09T04:00:00.000Z");

        for (const path of METRIC_PATHS) {
          const read: (type: AggregationType) => Promise<Array<Row>> = (
            type: AggregationType,
          ): Promise<Array<Row>> => {
            return readMetric({
              project: EDGES_PROJECT,
              window: NEW_YORK_SPRING,
              interval: AggregationInterval.Day,
              type: type,
              timezone: Timezone.AmericaNew_York,
              path: path,
            });
          };
          const firsts: Array<Row> = await read(AggregationType.Min);
          const lasts: Array<Row> = await read(AggregationType.Max);
          const valueAt: (
            rows: Array<Row>,
            time: string,
          ) => number | undefined = (
            rows: Array<Row>,
            time: string,
          ): number | undefined => {
            return rows.find((row: Row): boolean => {
              return row.time === time;
            })?.value;
          };

          expect({
            path: path,
            lastOfSeventh: valueAt(lasts, "2026-03-07T05:00:00.000Z"),
            firstOfEighth: valueAt(firsts, "2026-03-08T05:00:00.000Z"),
            lastOfEighth: valueAt(lasts, "2026-03-08T05:00:00.000Z"),
            firstOfNinth: valueAt(firsts, "2026-03-09T04:00:00.000Z"),
          }).toEqual({
            path: path,
            lastOfSeventh: lastOfSeventh,
            firstOfEighth: firstOfEighth,
            lastOfEighth: lastOfEighth,
            firstOfNinth: firstOfNinth,
          });
        }
      });
    });

    /*
     * Each window ends earlier in its day than it starts, as a window from
     * 14:42 to 09:00 does: the day it ends in has no slot of the walk from
     * its start, and gets one of its own at its midnight (issue #7278).
     */
    describe("a chart over days draws each day's total on its own day", () => {
      afterEach(() => {
        OneUptimeDate.setUserTimezone(null);
      });

      test("read in New York from 14:42 on 4 March to 09:00 on 10 March, 8 March holds the 23 hours it had, and 10 March its 10", async () => {
        OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

        const window: Period = {
          name: "14:42 EST on 4 March to 09:00 EDT on 10 March",
          start: new Date("2026-03-04T19:42:00.000Z"),
          end: new Date("2026-03-10T13:00:00.000Z"),
        };
        const rows: Array<Row> = await readMetric({
          project: HOURLY_PROJECT,
          window: window,
          interval: AggregationInterval.Day,
          type: AggregationType.Count,
          timezone: OneUptimeDate.getCurrentTimezone(),
          path: "the minute rollup",
        });

        expect(chartOf(window, rows)).toEqual([
          // The samples start at 19:00 on 4 March.
          ["04 Mar", 5],
          ["05 Mar", 24],
          ["06 Mar", 24],
          ["07 Mar", 24],
          ["08 Mar", 23],
          ["09 Mar", 24],
          // From midnight to 09:00.
          ["10 Mar", 10],
        ]);
      });

      test("read in Kolkata from 14:42 on 29 October to 09:00 on 3 November, each day holds the hours from its own midnight", async () => {
        OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

        const window: Period = {
          name: "14:42 IST on 29 October to 09:00 IST on 3 November",
          start: new Date("2026-10-29T09:12:00.000Z"),
          end: new Date("2026-11-03T03:30:00.000Z"),
        };
        const rows: Array<Row> = await readMetric({
          project: HOURLY_PROJECT,
          window: window,
          interval: AggregationInterval.Day,
          type: AggregationType.Count,
          timezone: OneUptimeDate.getCurrentTimezone(),
          path: "the raw table",
        });

        expect(chartOf(window, rows)).toEqual([
          // The hours from 15:30, the first sample after 14:42.
          ["29 Oct", 9],
          ["30 Oct", 24],
          ["31 Oct", 24],
          ["01 Nov", 24],
          ["02 Nov", 24],
          // From midnight to 08:30, the last sample before 09:00.
          ["03 Nov", 9],
        ]);
      });
    });

    /*
     * The trace charts read span durations through SpanService's own
     * statement, which the span table's projections serve. Its bucket is
     * aliased startTime, and its window once read that alias in place of
     * the span's start: the window's first bucket starts before the window,
     * so the whole of it was filtered out.
     */
    describe("a trace chart, read from the span table's projections", () => {
      afterEach(() => {
        OneUptimeDate.setUserTimezone(null);
      });

      test("read in New York from 21:00 on 4 March, the first day keeps the window's first three hours", async () => {
        const read: { rows: Array<Row>; statement: Statement } =
          await readSpansAndStatement({
            window: TEN_DAYS,
            type: AggregationType.Count,
            timezone: Timezone.AmericaNew_York,
            filters: { primaryEntityId: SERVICE_ID },
          });

        // SpanService's projection statement, not the generic one.
        expect(read.statement.query).toContain(" AS s WHERE s.projectId = {");
        expect(read.rows).toEqual(
          rowsFromTable([
            // 21:00, 22:00 and 23:00 on 4 March.
            ["2026-03-04T05:00:00Z", 3],
            ["2026-03-05T05:00:00Z", 24],
            ["2026-03-06T05:00:00Z", 24],
            ["2026-03-07T05:00:00Z", 24],
            // The clocks go forward at 02:00.
            ["2026-03-08T05:00:00Z", 23],
            ["2026-03-09T04:00:00Z", 24],
            // The samples end at 23:00 UTC on 10 March, 19:00 in New York.
            ["2026-03-10T04:00:00Z", 20],
          ]),
        );
        expect(await rowsThroughAProjection(client, read.statement)).toEqual(
          read.rows,
        );
      });

      test("read in Kolkata from 14:42 on 25 September to 09:00 on 5 October, a day chart draws each day's spans on its own day", async () => {
        OneUptimeDate.setUserTimezone(Timezone.AsiaKolkata);

        const window: Period = {
          name: "14:42 IST on 25 September to 09:00 IST on 5 October",
          start: new Date("2026-09-25T09:12:00.000Z"),
          end: new Date("2026-10-05T03:30:00.000Z"),
        };
        const rows: Array<Row> = await readSpans({
          window: window,
          type: AggregationType.Count,
          timezone: OneUptimeDate.getCurrentTimezone(),
          filters: { primaryEntityId: SERVICE_ID },
        });

        expect(chartOf(window, rows)).toEqual([
          // The hours from 15:30, the first sample after 14:42.
          ["25 Sep", 9],
          ["26 Sep", 24],
          ["27 Sep", 24],
          ["28 Sep", 24],
          ["29 Sep", 24],
          ["30 Sep", 24],
          ["01 Oct", 24],
          ["02 Oct", 24],
          ["03 Oct", 24],
          ["04 Oct", 24],
          // From midnight to 08:30, the last sample before 09:00.
          ["05 Oct", 9],
        ]);
      });

      const READS: Array<{ interval: AggregationInterval; window: Period }> = [
        { interval: AggregationInterval.Day, window: TEN_DAYS },
        { interval: AggregationInterval.Week, window: TWO_MONTHS },
        { interval: AggregationInterval.Month, window: TEN_MONTHS },
      ];

      test.each(ZONES)(
        "read in %s, every span is in the bucket of its day, week and month, the window's first bucket too",
        async (zone: Timezone) => {
          for (const each of READS) {
            const buckets: Array<Bucket> = expectedBuckets({
              samples: HOURLY,
              zone: zone,
              interval: each.interval,
              window: each.window,
            });
            const name: string = `${each.interval} in ${zone}, ${each.window.name}`;

            // The window starts after the first bucket does.
            expect(Date.parse(buckets[0]!.time)).toBeLessThan(
              each.window.start.getTime(),
            );

            const reads: Array<[string, SpanRead, Array<Row>]> = [
              [
                "every span",
                { window: each.window, type: AggregationType.Count },
                buckets.map((bucket: Bucket): Row => {
                  return { time: bucket.time, value: 2 * bucket.count };
                }),
              ],
              [
                "the service's root spans that set no status or ok",
                {
                  window: each.window,
                  type: AggregationType.Count,
                  filters: {
                    primaryEntityId: SERVICE_ID,
                    isRootSpan: true,
                    statusCode: new Includes([SpanStatus.Unset, SpanStatus.Ok]),
                  },
                },
                countsOf(buckets),
              ],
              [
                "the database's failed spans",
                {
                  window: each.window,
                  type: AggregationType.Count,
                  filters: {
                    primaryEntityId: new Includes([DATABASE_SERVICE_ID]),
                    statusCode: SpanStatus.Error,
                  },
                },
                countsOf(buckets),
              ],
              [
                "the service's average duration",
                {
                  window: each.window,
                  type: AggregationType.Avg,
                  filters: { primaryEntityId: SERVICE_ID },
                },
                // Consecutive ranks: their average is their middle.
                buckets.map((bucket: Bucket): Row => {
                  return {
                    time: bucket.time,
                    value: (bucket.min + bucket.max) / 2,
                  };
                }),
              ],
            ];

            for (const [readName, read, expected] of reads) {
              const result: { rows: Array<Row>; statement: Statement } =
                await readSpansAndStatement({ ...read, timezone: zone });

              expect({ name: name, read: readName, rows: result.rows }).toEqual(
                {
                  name: name,
                  read: readName,
                  rows: expected,
                },
              );
              expect(result.statement.query).toContain(
                " AS s WHERE s.projectId = {",
              );
              expect({
                name: name,
                read: readName,
                rows: await rowsThroughAProjection(client, result.statement),
              }).toEqual({ name: name, read: readName, rows: expected });
            }

            // A P99 is one of the bucket's own durations, or between two.
            const p99: { rows: Array<Row>; statement: Statement } =
              await readSpansAndStatement({
                window: each.window,
                type: AggregationType.P99,
                timezone: zone,
                filters: { primaryEntityId: SERVICE_ID },
              });

            expect({
              name: name,
              times: p99.rows.map((row: Row): string => {
                return row.time;
              }),
            }).toEqual({
              name: name,
              times: buckets.map((bucket: Bucket): string => {
                return bucket.time;
              }),
            });

            const outside: Array<string> = p99.rows
              .filter((row: Row, index: number): boolean => {
                return (
                  row.value < buckets[index]!.min ||
                  row.value > buckets[index]!.max
                );
              })
              .map((row: Row): string => {
                return `${name}: ${row.time} ${row.value}`;
              });

            expect(outside).toEqual([]);
            expect(
              (await rowsThroughAProjection(client, p99.statement)).map(
                (row: Row): string => {
                  return row.time;
                },
              ),
            ).toEqual(
              buckets.map((bucket: Bucket): string => {
                return bucket.time;
              }),
            );
          }
        },
      );

      test.each([Timezone.AmericaNew_York, Timezone.AsiaKolkata])(
        "read in %s, five days are UTC hours, with the zone or without it",
        async (zone: Timezone) => {
          const window: Period = {
            name: "five days from 02:00 UTC on 5 March",
            start: new Date("2026-03-05T02:00:00.000Z"),
            end: new Date("2026-03-10T02:00:00.000Z"),
          };
          const hours: Array<Row> = countsOf(
            expectedBuckets({
              samples: HOURLY,
              zone: zone,
              interval: AggregationInterval.Hour,
              window: window,
            }),
          );

          // From 02:00 on 5 March to 02:00 on 10 March, both included.
          expect(hours).toHaveLength(5 * 24 + 1);
          expect(
            await readSpans({
              window: window,
              type: AggregationType.Count,
              timezone: zone,
              filters: { primaryEntityId: SERVICE_ID },
            }),
          ).toEqual(hours);
          expect(
            await readSpans({
              window: window,
              type: AggregationType.Count,
              filters: { primaryEntityId: SERVICE_ID },
            }),
          ).toEqual(hours);
        },
      );

      test("with no zone, ten days are UTC's days, the first one too", async () => {
        expect(
          await readSpans({
            window: TEN_DAYS,
            type: AggregationType.Count,
            filters: { primaryEntityId: SERVICE_ID },
          }),
        ).toEqual(
          countsOf(
            expectedBuckets({
              samples: HOURLY,
              zone: Timezone.UTC,
              interval: AggregationInterval.Day,
              window: TEN_DAYS,
            }),
          ),
        );
      });
    });

    describe("an hour and shorter are read as they always were", () => {
      test.each([Timezone.AmericaNew_York, Timezone.AsiaKolkata])(
        "read in %s, an hour is a UTC hour, with the zone or without it",
        async (zone: Timezone) => {
          const hours: Array<Row> = expectedBuckets({
            samples: HOURLY,
            zone: zone,
            interval: AggregationInterval.Hour,
            window: NEW_YORK_SPRING,
          }).map((bucket: Bucket): Row => {
            return { time: bucket.time, value: bucket.count };
          });

          expect(hours).toHaveLength(144);

          for (const path of METRIC_PATHS) {
            const read: (timezone?: unknown) => Promise<Array<Row>> = (
              timezone?: unknown,
            ): Promise<Array<Row>> => {
              return readMetric({
                project: HOURLY_PROJECT,
                window: NEW_YORK_SPRING,
                interval: AggregationInterval.Hour,
                type: AggregationType.Count,
                timezone: timezone,
                path: path,
              });
            };

            expect({ path: path, rows: await read(zone) }).toEqual({
              path: path,
              rows: hours,
            });
            expect({ path: path, rows: await read() }).toEqual({
              path: path,
              rows: hours,
            });
          }
        },
      );

      test("no zone, or null, reads UTC's days, as a day was read before", async () => {
        const utcDays: Array<Row> = rowsFromTable(TABLES[1]!.buckets);

        expect(TABLES[1]!.zone).toBe(Timezone.UTC);

        for (const timezone of [undefined, null]) {
          for (const path of METRIC_PATHS) {
            expect({
              timezone: timezone,
              path: path,
              rows: await readMetric({
                project: HOURLY_PROJECT,
                window: NEW_YORK_SPRING,
                interval: AggregationInterval.Day,
                type: AggregationType.Count,
                timezone: timezone,
                path: path,
              }),
            }).toEqual({ timezone: timezone, path: path, rows: utcDays });
          }

          expect(
            await readSloHistory({
              window: NEW_YORK_SPRING,
              interval: AggregationInterval.Day,
              timezone: timezone,
            }),
          ).toEqual(utcDays);
        }
      });
    });

    describe("the zones the product lists", () => {
      test("a name kept for old records reads the days of the zone it is another name for", async () => {
        // US/Pacific-New is not a zone this server knows; Asia/Calcutta is.
        for (const [legacy, current] of [
          [Timezone.USPacificNew, Timezone.AmericaLos_Angeles],
          [Timezone.AsiaCalcutta, Timezone.AsiaKolkata],
        ] as Array<[Timezone, Timezone]>) {
          const expected: Array<Row> = countsOf(
            expectedBuckets({
              samples: HOURLY,
              zone: current,
              interval: AggregationInterval.Day,
              window: NEW_YORK_SPRING,
            }),
          );

          for (const path of METRIC_PATHS) {
            expect({
              legacy: legacy,
              path: path,
              rows: await readMetric({
                project: HOURLY_PROJECT,
                window: NEW_YORK_SPRING,
                interval: AggregationInterval.Day,
                type: AggregationType.Count,
                timezone: legacy,
                path: path,
              }),
            }).toEqual({ legacy: legacy, path: path, rows: expected });
          }

          expect(
            await readSloHistory({
              window: NEW_YORK_SPRING,
              interval: AggregationInterval.Day,
              timezone: legacy,
            }),
          ).toEqual(expected);
        }
      });

      /*
       * Each zone's days are checked against the platform's clock above; here
       * every zone in the list is one the server reads days in, and each of
       * them a day long. (Exact instants for all of them would compare two
       * copies of the zone database, which need not agree on a zone that
       * changed its rules last month.)
       */
      test("every zone in the list reads days, every sample in exactly one", async () => {
        const zones: Array<string> = Object.values(Timezone);
        const window: Period = NEW_YORK_SPRING;
        const lastSample: number = window.end.getTime() - HOUR;
        const problems: Array<string> = [];

        expect(zones.length).toBeGreaterThan(500);

        for (let index: number = 0; index < zones.length; index += 8) {
          const chunk: Array<string> = zones.slice(index, index + 8);
          const reads: Array<{ zone: string; rows: Array<Row> | string }> =
            await Promise.all(
              chunk.map(
                async (
                  zone: string,
                ): Promise<{ zone: string; rows: Array<Row> | string }> => {
                  try {
                    return {
                      zone: zone,
                      rows: await readMetric({
                        project: HOURLY_PROJECT,
                        window: window,
                        interval: AggregationInterval.Day,
                        type: AggregationType.Count,
                        timezone: zone,
                        path: "the minute rollup",
                      }),
                    };
                  } catch (error) {
                    return { zone: zone, rows: String(error) };
                  }
                },
              ),
            );

          for (const read of reads) {
            if (typeof read.rows === "string") {
              problems.push(`${read.zone}: ${read.rows}`);
              continue;
            }

            const rows: Array<Row> = read.rows;
            const times: Array<number> = rows.map((row: Row): number => {
              return Date.parse(row.time);
            });
            const total: number = rows.reduce(
              (sum: number, row: Row): number => {
                return sum + row.value;
              },
              0,
            );

            if (total !== 144) {
              problems.push(`${read.zone}: ${total} samples, not 144`);
            }

            if (rows.length < 6 || rows.length > 7) {
              problems.push(`${read.zone}: ${rows.length} days`);
            }

            if (
              times[0]! > window.start.getTime() ||
              times[0]! < window.start.getTime() - 26 * HOUR ||
              times[times.length - 1]! > lastSample
            ) {
              problems.push(`${read.zone}: days from ${rows[0]!.time}`);
            }

            times.forEach((time: number, at: number): void => {
              if (time % (15 * MINUTE) !== 0) {
                problems.push(
                  `${read.zone}: a day starts at ${rows[at]!.time}`,
                );
              }

              const gap: number = at > 0 ? time - times[at - 1]! : DAY;

              if (gap < 22 * HOUR || gap > 26 * HOUR) {
                problems.push(`${read.zone}: a day of ${gap / HOUR} hours`);
              }
            });
          }
        }

        expect(problems).toEqual([]);
      });
    });

    describe("a session in another zone", () => {
      /*
       * The window is read a day wider than its samples: a session's zone
       * also moves how the window's own bounds are read, which is older than
       * this and not what is shown here.
       */
      const WIDE: Period = {
        name: "a day either side of New York's clocks going forward",
        start: new Date(NEW_YORK_SPRING.start.getTime() - DAY),
        end: new Date(NEW_YORK_SPRING.end.getTime() + DAY),
      };

      test("reads the same instants: a bucket comes back as a UTC instant", async () => {
        const expected: Array<Row> = rowsFromTable(TABLES[0]!.buckets);

        expect(TABLES[0]!.zone).toBe(Timezone.AmericaNew_York);

        for (const path of METRIC_PATHS) {
          const read: () => Promise<Array<Row>> = (): Promise<Array<Row>> => {
            return readMetric({
              project: HOURLY_PROJECT,
              window: WIDE,
              interval: AggregationInterval.Day,
              type: AggregationType.Count,
              timezone: Timezone.AmericaNew_York,
              path: path,
            });
          };

          expect({ path: path, rows: await read() }).toEqual({
            path: path,
            rows: expected,
          });

          MetricService.databaseClient = zonedClient;

          try {
            expect({ path: path, rows: await read() }).toEqual({
              path: path,
              rows: expected,
            });
          } finally {
            MetricService.databaseClient = client;
          }
        }

        SloHistoryService.databaseClient = zonedClient;

        try {
          expect(
            await readSloHistory({
              window: WIDE,
              interval: AggregationInterval.Day,
              timezone: Timezone.AmericaNew_York,
            }),
          ).toEqual(expected);
        } finally {
          SloHistoryService.databaseClient = client;
        }

        // Eight days: the span projection reads them by the day.
        const spans: () => Promise<Array<Row>> = (): Promise<Array<Row>> => {
          return readSpans({
            window: WIDE,
            type: AggregationType.Count,
            timezone: Timezone.AmericaNew_York,
            filters: { primaryEntityId: SERVICE_ID },
          });
        };

        expect(await spans()).toEqual(expected);

        SpanService.databaseClient = zonedClient;

        try {
          expect(await spans()).toEqual(expected);
        } finally {
          SpanService.databaseClient = client;
        }
      });
    });

    describe("a zone that is not one in the list", () => {
      test.each([
        ["a zone the list does not have", "Mars/Olympus"],
        ["a listed zone spelled another way", "america/new_york"],
        ["text written to be SQL", "UTC'), 'UTC') AS time FROM system.one --"],
        ["an empty name", ""],
        ["a number", 5],
      ])(
        "%s is refused with a 400, before anything is read",
        async (_name: string, timezone: unknown) => {
          const executedMetric: SpyInstance<typeof MetricService.executeQuery> =
            jest.spyOn(MetricService, "executeQuery");
          const executedSlo: SpyInstance<
            typeof SloHistoryService.executeQuery
          > = jest.spyOn(SloHistoryService, "executeQuery");
          const executedSpan: SpyInstance<typeof SpanService.executeQuery> =
            jest.spyOn(SpanService, "executeQuery");

          try {
            for (const path of METRIC_PATHS) {
              await expect(
                aggregateMetric({
                  project: emptyProject(),
                  window: NEW_YORK_SPRING,
                  interval: AggregationInterval.Day,
                  type: AggregationType.Count,
                  timezone: timezone,
                  path: path,
                }),
              ).rejects.toThrow(BadDataException);
            }

            await expect(
              readSloHistory({
                window: NEW_YORK_SPRING,
                interval: AggregationInterval.Day,
                timezone: timezone,
              }),
            ).rejects.toThrow(BadDataException);

            await expect(
              aggregateSpans({
                window: TEN_DAYS,
                type: AggregationType.Count,
                timezone: timezone,
              }),
            ).rejects.toThrow(BadDataException);

            expect(executedMetric).not.toHaveBeenCalled();
            expect(executedSlo).not.toHaveBeenCalled();
            expect(executedSpan).not.toHaveBeenCalled();
          } finally {
            executedMetric.mockRestore();
            executedSlo.mockRestore();
            executedSpan.mockRestore();
          }
        },
      );
    });
  },
);

describe("The reader's-zone bucket ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
