import {
  setTimeout as nodeSetTimeout,
  clearTimeout as nodeClearTimeout,
} from "timers";
import { createClient, ClickHouseClient } from "@clickhouse/client";
import Service from "../../../../../Models/DatabaseModels/Service";
import AnalyticsDatabaseService, {
  Results,
} from "../../../../../Server/Services/AnalyticsDatabaseService";
import RumApplicationService from "../../../../../Server/Services/RumApplicationService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import {
  ClickhousePassword,
  ClickhouseUsername,
} from "../../../../../Server/EnvironmentConfig";
import { getClickhouseDatabaseName } from "../../../../../Server/Utils/AnalyticsDatabase/ClusterConfig";
import {
  SQL,
  Statement,
} from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  ContentScanOptions,
  LocationFindings,
} from "../../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import {
  buildTelemetryLargeMetricSampleStatement,
  buildTelemetryMetricSampleStatement,
  buildTelemetryMetricsStatement,
  buildTelemetryOwnersStatement,
  capsOf,
  getNewMetricSince,
  getTelemetrySource,
  isLargeMetric,
  MetricToRead,
  readMetricsToRead,
  readTelemetryRecordValues,
  scanProjectTelemetry,
  TelemetryRecordValue,
  TelemetrySampleCaps,
  TelemetrySampleSource,
  TelemetryStoreScan,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner";
import {
  findTelemetryFindingOccurrences,
  OccurrencePlan,
  planOccurrenceRead,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryFindingOccurrences";
import LlmConversationPrivacy from "../../../../../Server/Utils/LlmObservability/LlmConversationPrivacy";
import logger from "../../../../../Server/Utils/Logger";
import TableColumnType from "../../../../../Types/AnalyticsDatabase/TableColumnType";
import {
  DataSecurityFindingOccurrences,
  DataSecurityOccurrenceRecordKind,
} from "../../../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { FindingSampleRecord } from "../../../../../Types/DataSecurity/FindingSampleRecord";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A PROJECT'S METRICS, READ BY A REAL CLICKHOUSE (issue #9604).
 *
 * The unit tests hold the metric statements to their shape; this runs them
 * against tables keyed as the product's are (MetricItemV3 by projectId,
 * name, primaryEntityId, time, partitioned by day; its per-minute rollup
 * MetricItemAggMV1m, filled by its materialized view on every insert):
 *
 *  - which services wrote metrics, a monitor's left out;
 *  - which metrics each wrote and their newest minute, from the rollup and
 *    from the points alike;
 *  - each metric's newest minute, at most a few points of it, however many
 *    series it has: a login counter of thousands of users costs no more
 *    than its first block;
 *  - a point of each series, however often a metric is sent (#9756): a
 *    queue's depth scraped every fifteen seconds, each scrape a part of
 *    its own, reads a hundred series, and a request metric written point
 *    by point reads every quiet route beside its three busy ones - the
 *    one with a user's email among them, which its first hundred points,
 *    the busy routes' first second and a half, never reached;
 *  - the whole scan, classifying a user's email and a client's IP in two
 *    labels and an email in a metric's name, and the records each finding
 *    was seen in, read again.
 *
 * Opt in against a local ClickHouse server, for example
 *   docker run --rm -p 127.0.0.1:8193:8123 -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7
 * then TEST_CLICKHOUSE_URL=http://localhost:8193 CLICKHOUSE_PASSWORD=test npx jest <this file>.
 * TELEMETRY_METRICS_SCALE (1 by default) multiplies the series, and
 * TELEMETRY_METRICS_COST_REPORT=1 writes what each read read. The suite
 * creates and removes only its own uniquely named database.
 */
const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];
jest.setTimeout(600000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;
const database: string = `telemetry_metrics_${process.pid}_${Date.now()}`;
const scale: number = Math.max(
  1,
  Math.floor(Number(process.env["TELEMETRY_METRICS_SCALE"] || "1")) || 1,
);
const report: boolean = process.env["TELEMETRY_METRICS_COST_REPORT"] === "1";

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000000d6001",
);
const CHECKOUT: string = "0192f1a0-0000-7000-8000-0000000da001";
const SIGNUP: string = "0192f1a0-0000-7000-8000-0000000da002";
const PAYMENTS: string = "0192f1a0-0000-7000-8000-0000000da003";
// The service of a metric written all day and one started lately (#9755).
const REPORTS: string = "0192f1a0-0000-7000-8000-0000000da004";
const MONITOR: string = "0192f1a0-0000-7000-8000-0000000dc001";
const SERVICES: Array<string> = [CHECKOUT, SIGNUP, PAYMENTS, REPORTS];

// Ordinary metrics: each service's, each of a few series, a point every 10 seconds.
const ORDINARY_METRICS: number = 8;
const ORDINARY_SERIES: number = 20 * scale;
const ORDINARY_POINTS: number = 40;
// The login counter labelled by the user's email: a series per user, a point a minute.
const LOGIN_SERIES: number = 3_000 * scale;
const LOGIN_POINTS: number = 5;
/*
 * A queue's depth scraped every fifteen seconds (#9756): four points of each
 * series in a minute, each scrape written by an insert of its own.
 */
const SCRAPED_METRIC: string = "queue.depth";
const SCRAPED_SERIES: number = 2_000;
const SCRAPES: Array<number> = [1, 16, 31, 46];
/*
 * Request durations written point by point: three busy routes, a point
 * every 50 ms, and quiet routes' one point each, spread over the minute -
 * the quiet route at QUIET_EMAIL_ROUTE holding a user's email.
 */
const REQUEST_METRIC: string = "http.server.request.duration";
const BUSY_ROUTES: number = 3;
const BUSY_POINTS: number = 1_200;
const QUIET_ROUTES: number = 60;
const QUIET_EMAIL_ROUTE: number = 40;
const QUIET_EMAIL: string = "quiet.user@acmecorp.io";
/*
 * #9755: a metric the reports service has written all day, a point every
 * ten minutes for 23 hours - none in the minute the window starts in, which
 * the rollup counts whole - and one it started writing half an hour ago.
 */
const DAYLONG_METRIC: string = "app.metric.daylong";
const FRESH_METRIC: string = "app.metric.fresh";

let client: ClickHouseClient;
const queryIds: Array<{ id: string; query: string }> = [];
// The whole minute before the suite started, which the scraped metrics wrote in.
const previousMinuteMs: number =
  Math.floor(Date.now() / 60_000) * 60_000 - 60_000;

function inDatabase(query: string): string {
  return query.split(`${getClickhouseDatabaseName()}.`).join(`${database}.`);
}

async function rowsOf(
  statement: Statement | string,
): Promise<Array<JSONObject>> {
  const id: string = `ds9604_${queryIds.length}_${Date.now()}`;
  const query: string = inDatabase(
    typeof statement === "string" ? statement : statement.query,
  );

  queryIds.push({ id, query });

  const result: { json: () => Promise<unknown> } = await client.query({
    query,
    ...(typeof statement === "string"
      ? {}
      : { query_params: statement.query_params }),
    query_id: id,
    format: "JSON",
  });

  return ((await result.json()) as { data: Array<JSONObject> }).data;
}

interface ReadCost {
  readRows: number;
  readBytes: number;
  durationMs: number;
  // The most memory the read held at once.
  memoryBytes: number;
}

// What the last read read, from the server's own log.
async function lastReadCost(): Promise<ReadCost> {
  const last: { id: string } | undefined = queryIds[queryIds.length - 1];

  await client.command({ query: "SYSTEM FLUSH LOGS" });

  const rows: Array<JSONObject> = (
    (await (
      await client.query({
        query: `SELECT read_rows, read_bytes, query_duration_ms, memory_usage FROM system.query_log WHERE query_id = {id:String} AND type = 'QueryFinish'`,
        query_params: { id: last?.id || "" },
        format: "JSON",
      })
    ).json()) as { data: Array<JSONObject> }
  ).data;

  return {
    readRows: Number(rows[0]?.["read_rows"] || 0),
    readBytes: Number(rows[0]?.["read_bytes"] || 0),
    durationMs: Number(rows[0]?.["query_duration_ms"] || 0),
    memoryBytes: Number(rows[0]?.["memory_usage"] || 0),
  };
}

function describeCost(cost: ReadCost): string {
  return `${cost.readRows.toLocaleString("en-US")} rows read (${(cost.readBytes / 1024 / 1024).toFixed(1)} MiB) in ${cost.durationMs} ms, ${(cost.memoryBytes / 1024 / 1024).toFixed(1)} MiB of memory`;
}

/*
 * The metrics' newest minutes read as the scan read them before #9756: the
 * first points of each, however many of them one series wrote. Written out
 * here to compare against, each metric's name, owner and minute bound as
 * parameters, as the scan binds them: a name is never spliced into the SQL.
 */
function firstPointsStatement(
  metrics: ReadonlyArray<MetricToRead>,
  perMetric: number,
): Statement {
  const statement: Statement = new Statement();

  statement.append(
    `SELECT primaryEntityId AS ownerId, toUnixTimestamp64Milli(toDateTime64(time, 3)) AS readRecordTime, substringUTF8(name, 1, 1024) AS readMetricName, arrayMap((k, v) -> tuple(substringUTF8(k, 1, 256), substringUTF8(v, 1, 4096)), arraySlice(mapKeys(attributes), 1, 128), arraySlice(mapValues(attributes), 1, 128)) AS readAttributes FROM ${getClickhouseDatabaseName()}.MetricItemV3 WHERE projectId = '${PROJECT_ID.toString()}' AND time >= now() - INTERVAL 1 HOUR AND time <= now() AND retentionDate >= now() AND (primaryEntityType = '' OR primaryEntityType = 'OpenTelemetry') AND (`,
  );

  metrics.forEach((metric: MetricToRead, index: number): void => {
    if (index > 0) {
      statement.append(" OR ");
    }

    statement.append(
      SQL`(name = ${{
        type: TableColumnType.Text,
        value: metric.metricName,
      }} AND primaryEntityId = ${{
        type: TableColumnType.Text,
        value: metric.ownerId,
      }} AND time >= ${{
        type: TableColumnType.DateTime64,
        value: metric.newestMinute,
      }})`,
    );
  });

  statement.append(
    `) LIMIT ${perMetric} BY primaryEntityId, name LIMIT ${perMetric * metrics.length}`,
  );

  return statement;
}

// How many series - different attributes - a read's rows of each metric hold.
function seriesByMetric(rows: ReadonlyArray<JSONObject>): Map<string, number> {
  const series: Map<string, Set<string>> = new Map();

  for (const row of rows) {
    const metric: string = `${String(row["ownerId"])}|${String(row["readMetricName"])}`;
    const seen: Set<string> = series.get(metric) || new Set();

    seen.add(JSON.stringify(row["readAttributes"]));
    series.set(metric, seen);
  }

  return new Map(
    Array.from(series.entries()).map(
      ([metric, seen]: [string, Set<string>]): [string, number] => {
        return [metric, seen.size];
      },
    ),
  );
}

function options(): ContentScanOptions {
  return {
    limits: {
      maxObjects: 2000,
      maxBytesPerObject: 65536,
      maxBytesTotal: 52428800,
      maxRowsPerTable: 1000,
      maxTables: 200,
      deadline: new Date(Date.now() + 60 * 60 * 1000),
    },
    customDetectors: [],
    extraHints: [],
    disabledDataTypeIds: new Set(),
    allowedValues: new Set(),
    exclusions: [],
    fingerprintKey: "test-key",
  };
}

function window(): { projectId: ObjectID; since: Date; until: Date } {
  const until: Date = new Date();

  return {
    projectId: PROJECT_ID,
    since: new Date(until.getTime() - 60 * 60 * 1000),
    until,
  };
}

function namedService(id: string, name: string): Service {
  const service: Service = new Service();
  service._id = id;
  service.name = name;
  return service;
}

const POINT_COLUMNS: string =
  "projectId, primaryEntityId, primaryEntityType, name, metricPointType, time, timeUnixNano, attributes, attributeKeys, value, retentionDate, _id, createdAt";

integration("a project's metrics, in a real ClickHouse", () => {
  beforeAll(async (): Promise<void> => {
    // The real ClickHouse HTTP client needs Node timers with unref().
    jest.spyOn(globalThis, "setTimeout").mockImplementation(nodeSetTimeout);
    jest.spyOn(globalThis, "clearTimeout").mockImplementation(nodeClearTimeout);

    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "This integration suite requires a local ClickHouse server.",
      );
    }

    client = createClient({
      url: endpoint!,
      username: ClickhouseUsername,
      password: ClickhousePassword,
      request_timeout: 300000,
    });

    for (const query of [
      `CREATE DATABASE ${database}`,
      `CREATE TABLE ${database}.MetricItemV3 (projectId String, primaryEntityId String, primaryEntityType LowCardinality(Nullable(String)), name String CODEC(ZSTD(1)), metricPointType LowCardinality(Nullable(String)), time DateTime64(9) CODEC(DoubleDelta, ZSTD(1)), timeUnixNano UInt64 CODEC(DoubleDelta, ZSTD(1)), attributes Map(String, String) CODEC(ZSTD(3)), attributeKeys Array(String) CODEC(ZSTD(3)), value Nullable(Double), sum Nullable(Double), traceId Nullable(String), spanId Nullable(String), retentionDate DateTime CODEC(DoubleDelta, ZSTD(1)), _id String, createdAt DateTime, INDEX idx_name name TYPE bloom_filter(0.01) GRANULARITY 1) ENGINE = MergeTree PARTITION BY toYYYYMMDD(time) PRIMARY KEY (projectId, name, primaryEntityId, time) ORDER BY (projectId, name, primaryEntityId, time)`,
      `CREATE TABLE ${database}.MetricItemAggMV1m (projectId String, name String, primaryEntityId String, bucketTime DateTime, valueSumState AggregateFunction(sum, Float64), valueCountState AggregateFunction(count, Float64), retentionDate SimpleAggregateFunction(max, DateTime)) ENGINE = AggregatingMergeTree PARTITION BY toYYYYMM(bucketTime) ORDER BY (projectId, name, primaryEntityId, bucketTime)`,
      `CREATE MATERIALIZED VIEW ${database}.MetricItemAggMV1m_mv TO ${database}.MetricItemAggMV1m AS SELECT projectId, name, primaryEntityId, toStartOfMinute(time) AS bucketTime, sumState(toFloat64(coalesce(value, sum, 0))) AS valueSumState, countState(toFloat64(coalesce(value, sum, 0))) AS valueCountState, maxSimpleState(retentionDate) AS retentionDate FROM ${database}.MetricItemV3 GROUP BY projectId, name, primaryEntityId, bucketTime`,
      // Each service's ordinary metrics: a method, a route and its host as labels.
      `INSERT INTO ${database}.MetricItemV3 (${POINT_COLUMNS}) SELECT '${PROJECT_ID.toString()}', ['${CHECKOUT}', '${SIGNUP}', '${PAYMENTS}'][intDiv(number, ${ORDINARY_METRICS * ORDINARY_SERIES * ORDINARY_POINTS}) + 1], 'OpenTelemetry', concat('app.metric.', toString(intDiv(number, ${ORDINARY_SERIES * ORDINARY_POINTS}) % ${ORDINARY_METRICS})), 'Gauge', toDateTime64(now64(3) - toIntervalSecond(10 * (number % ${ORDINARY_POINTS})), 9), toUInt64(toUnixTimestamp64Nano(toDateTime64(now64(3) - toIntervalSecond(10 * (number % ${ORDINARY_POINTS})), 9))), map('http.method', if(intDiv(number, ${ORDINARY_POINTS}) % 2 = 0, 'GET', 'POST'), 'http.route', concat('/api/v1/items/', toString(intDiv(number, ${ORDINARY_POINTS}) % 10)), 'resource.host.name', concat('host-', toString(intDiv(number, ${ORDINARY_POINTS}) % 3)), 'oneuptime.service.id', 'stamped'), ['http.method', 'http.route', 'oneuptime.service.id', 'resource.host.name'], rand() % 1000, now() + toIntervalDay(15), generateUUIDv4(), now() FROM numbers(${3 * ORDINARY_METRICS * ORDINARY_SERIES * ORDINARY_POINTS})`,
      // A login counter labelled by each user's email, and the client's IP as a resource attribute.
      `INSERT INTO ${database}.MetricItemV3 (${POINT_COLUMNS}) SELECT '${PROJECT_ID.toString()}', '${CHECKOUT}', 'OpenTelemetry', 'user.logins', 'Sum', toDateTime64(now64(3) - toIntervalSecond(60 * (number % ${LOGIN_POINTS})), 9), toUInt64(toUnixTimestamp64Nano(toDateTime64(now64(3) - toIntervalSecond(60 * (number % ${LOGIN_POINTS})), 9))), map('user.email', concat('user', toString(intDiv(number, ${LOGIN_POINTS})), '@acmecorp.io'), 'resource.client.ip', concat('34.120.', toString(intDiv(number, ${LOGIN_POINTS}) % 250), '.', toString(intDiv(number, ${LOGIN_POINTS}) % 200 + 1)), 'oneuptime.service.id', 'stamped'), ['oneuptime.service.id', 'resource.client.ip', 'user.email'], 1, now() + toIntervalDay(15), generateUUIDv4(), now() FROM numbers(${LOGIN_SERIES * LOGIN_POINTS})`,
      // A metric whose name a project built from a user's email.
      `INSERT INTO ${database}.MetricItemV3 (${POINT_COLUMNS}) SELECT '${PROJECT_ID.toString()}', '${SIGNUP}', 'OpenTelemetry', 'signups.jane.doe@acmecorp.io.count', 'Sum', toDateTime64(now64(3) - toIntervalSecond(60 * number), 9), toUInt64(toUnixTimestamp64Nano(toDateTime64(now64(3) - toIntervalSecond(60 * number), 9))), map('plan', 'pro'), ['plan'], 1, now() + toIntervalDay(15), generateUUIDv4(), now() FROM numbers(30)`,
      // A monitor's metric: not a service's telemetry, never read.
      `INSERT INTO ${database}.MetricItemV3 (${POINT_COLUMNS}) SELECT '${PROJECT_ID.toString()}', '${MONITOR}', 'Monitor', 'oneuptime.monitor.response.time', 'Gauge', toDateTime64(now64(3) - toIntervalSecond(60 * number), 9), toUInt64(toUnixTimestamp64Nano(toDateTime64(now64(3) - toIntervalSecond(60 * number), 9))), map('owner.email', 'ops@acmecorp.io'), ['owner.email'], 1, now() + toIntervalDay(15), generateUUIDv4(), now() FROM numbers(30)`,
      // A queue's depth scraped every fifteen seconds: each scrape an insert, a part, of its own.
      ...SCRAPES.map((second: number): string => {
        const nanos: string = `toInt64(${previousMinuteMs + second * 1000}) * 1000000`;

        return `INSERT INTO ${database}.MetricItemV3 (${POINT_COLUMNS}) SELECT '${PROJECT_ID.toString()}', '${PAYMENTS}', 'OpenTelemetry', '${SCRAPED_METRIC}', 'Gauge', fromUnixTimestamp64Nano(${nanos}), toUInt64(${nanos}), map('queue', concat('queue-', toString(number)), 'resource.host.name', concat('host-', toString(number % 4))), ['queue', 'resource.host.name'], rand() % 100, now() + toIntervalDay(15), generateUUIDv4(), now() FROM numbers(${SCRAPED_SERIES})`;
      }),
      // A metric written all day, a point every ten minutes, and one started half an hour ago.
      `INSERT INTO ${database}.MetricItemV3 (${POINT_COLUMNS}) SELECT '${PROJECT_ID.toString()}', '${REPORTS}', 'OpenTelemetry', '${DAYLONG_METRIC}', 'Gauge', toDateTime64(now64(3) - toIntervalMinute(3 + 10 * number), 9), toUInt64(toUnixTimestamp64Nano(toDateTime64(now64(3) - toIntervalMinute(3 + 10 * number), 9))), map('report', 'daily'), ['report'], 1, now() + toIntervalDay(15), generateUUIDv4(), now() FROM numbers(138)`,
      `INSERT INTO ${database}.MetricItemV3 (${POINT_COLUMNS}) SELECT '${PROJECT_ID.toString()}', '${REPORTS}', 'OpenTelemetry', '${FRESH_METRIC}', 'Gauge', toDateTime64(now64(3) - toIntervalMinute(number), 9), toUInt64(toUnixTimestamp64Nano(toDateTime64(now64(3) - toIntervalMinute(number), 9))), map('report', 'weekly'), ['report'], 1, now() + toIntervalDay(15), generateUUIDv4(), now() FROM numbers(30)`,
      /*
       * Request durations written point by point, one insert: the busy
       * routes' points every 50 ms, then the quiet routes' one each, spread
       * over the minute - the one at QUIET_EMAIL_ROUTE a user's email.
       */
      ((): string => {
        const busy: number = BUSY_ROUTES * BUSY_POINTS;
        const nanos: string = `toInt64(${previousMinuteMs} + if(number < ${busy}, (number % ${BUSY_POINTS}) * 50, (number - ${busy}) * 900)) * 1000000`;
        const route: string = `if(number < ${busy}, concat('/api/busy/', toString(intDiv(number, ${BUSY_POINTS}))), if(number - ${busy} = ${QUIET_EMAIL_ROUTE}, '/users/${QUIET_EMAIL}/orders', concat('/users/', toString(number - ${busy}), '/orders')))`;

        return `INSERT INTO ${database}.MetricItemV3 (${POINT_COLUMNS}) SELECT '${PROJECT_ID.toString()}', '${PAYMENTS}', 'OpenTelemetry', '${REQUEST_METRIC}', 'Histogram', fromUnixTimestamp64Nano(${nanos}), toUInt64(${nanos}), map('http.route', ${route}, 'http.request.method', 'GET'), ['http.request.method', 'http.route'], rand() % 500, now() + toIntervalDay(15), generateUUIDv4(), now() FROM numbers(${busy + QUIET_ROUTES})`;
      })(),
    ]) {
      await client.command({ query });
    }

    // Every read the scan makes, against this database.
    jest
      .spyOn(AnalyticsDatabaseService.prototype, "executeQuery")
      .mockImplementation((async (statement: Statement): Promise<Results> => {
        const data: Array<JSONObject> = await rowsOf(statement);

        return {
          json: (): Promise<unknown> => {
            return Promise.resolve({ data });
          },
        } as unknown as Results;
      }) as never);
    jest
      .spyOn(LlmConversationPrivacy, "getRestrictedServiceIds")
      .mockResolvedValue([]);
    jest
      .spyOn(ServiceService, "findBy")
      .mockResolvedValue([
        namedService(CHECKOUT, "checkout"),
        namedService(SIGNUP, "signup"),
        namedService(PAYMENTS, "payments"),
        namedService(REPORTS, "reports"),
      ] as never);
    jest.spyOn(RumApplicationService, "findBy").mockResolvedValue([] as never);
    // The other signals' tables are not here: their reads fail, and are logged.
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
  });

  afterAll(async (): Promise<void> => {
    if (client) {
      try {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      } finally {
        await client.close();
      }
    }

    jest.restoreAllMocks();
  });

  test("the services that wrote metrics in the window, a monitor's left out", async () => {
    const rows: Array<JSONObject> = await rowsOf(
      buildTelemetryOwnersStatement({
        ...window(),
        source: TelemetrySampleSource.Metrics,
        excludedOwnerIds: [],
        limit: 200,
      }),
    );

    expect(
      rows
        .map((row: JSONObject): string => {
          return String(row["ownerId"]);
        })
        .sort(),
    ).toEqual([...SERVICES].sort());
  });

  test("which metrics each service wrote, the busiest first, read alike from the rollup and from the points", async () => {
    const read: (fromRollup: boolean) => Promise<Array<MetricToRead>> = async (
      fromRollup: boolean,
    ): Promise<Array<MetricToRead>> => {
      return readMetricsToRead(
        await rowsOf(
          buildTelemetryMetricsStatement({
            ...window(),
            ownerIds: SERVICES,
            perOwner: 100,
            total: 2000,
            fromRollup,
          }),
        ),
        new Set(SERVICES),
      );
    };
    const fromRollup: Array<MetricToRead> = await read(true);
    const fromPoints: Array<MetricToRead> = await read(false);
    const keyOf: (metric: MetricToRead) => string = (
      metric: MetricToRead,
    ): string => {
      return `${metric.ownerId}|${metric.metricName}|${metric.points}|${metric.newestMinute.toISOString()}|${metric.newestMinutePoints}`;
    };

    expect(fromRollup.map(keyOf).sort()).toEqual(fromPoints.map(keyOf).sort());
    // Each service's ordinary metrics, the login counter, the named one, the queue, the requests, the day's and the fresh one.
    expect(fromRollup.length).toBe(3 * ORDINARY_METRICS + 6);
    // A series a minute: the login counter's newest minute holds a point of each user.
    expect(
      fromRollup.find((metric: MetricToRead): boolean => {
        return metric.metricName === "user.logins";
      })?.newestMinutePoints,
    ).toBe(LOGIN_SERIES);
    // The login counter is checkout's busiest metric.
    expect(
      fromRollup.find((metric: MetricToRead): boolean => {
        return metric.ownerId === CHECKOUT;
      })?.metricName,
    ).toBe("user.logins");

    for (const metric of fromRollup) {
      expect(metric.newestMinute.getTime()).toBeLessThanOrEqual(Date.now());
      expect(metric.newestMinute.getTime()).toBeGreaterThan(
        Date.now() - 5 * 60 * 1000,
      );
    }

    // At most perOwner of each service.
    const fewer: Array<MetricToRead> = readMetricsToRead(
      await rowsOf(
        buildTelemetryMetricsStatement({
          ...window(),
          ownerIds: SERVICES,
          perOwner: 2,
          total: 2000,
          fromRollup: true,
        }),
      ),
      new Set(SERVICES),
    );

    expect(fewer.length).toBe(2 * SERVICES.length);
  });

  test("each metric's newest minute, at most a few points of it, each range of the table read once", async () => {
    const metrics: Array<MetricToRead> = readMetricsToRead(
      await rowsOf(
        buildTelemetryMetricsStatement({
          ...window(),
          ownerIds: SERVICES,
          perOwner: 100,
          total: 2000,
          fromRollup: true,
        }),
      ),
      new Set(SERVICES),
    );
    const caps: TelemetrySampleCaps = capsOf(
      getTelemetrySource(TelemetrySampleSource.Metrics),
      options(),
    );
    const rows: Array<JSONObject> = await rowsOf(
      buildTelemetryMetricSampleStatement({
        ...window(),
        metrics,
        perMetric: 100,
        caps,
      }),
    );
    const cost: { readRows: number; readBytes: number; durationMs: number } =
      await lastReadCost();
    const byMetric: Map<string, number> = new Map();

    for (const row of rows) {
      const key: string = `${String(row["ownerId"])}|${String(row["readMetricName"])}`;
      byMetric.set(key, (byMetric.get(key) || 0) + 1);
    }

    expect(byMetric.size).toBe(metrics.length);
    expect(byMetric.get(`${CHECKOUT}|user.logins`)).toBe(100);

    for (const count of byMetric.values()) {
      expect(count).toBeLessThanOrEqual(100);
    }

    // Read as the scan reads it: the name, then the labels, OneUptime's own left out.
    const login: JSONObject = rows.find((row: JSONObject): boolean => {
      return row["readMetricName"] === "user.logins";
    })!;
    const values: Array<TelemetryRecordValue> = readTelemetryRecordValues(
      TelemetrySampleSource.Metrics,
      login,
      capsOf(getTelemetrySource(TelemetrySampleSource.Metrics), options()),
    )!;

    // The map keeps its keys in the order they were written.
    expect(
      values.map((value: TelemetryRecordValue): string => {
        return value.location;
      }),
    ).toEqual([
      "name",
      "attributes.user.email",
      "attributes.resource.client.ip",
    ]);
    expect(Number(login["readRecordTime"])).toBeGreaterThan(0);

    const totalPoints: number =
      3 * ORDINARY_METRICS * ORDINARY_SERIES * ORDINARY_POINTS +
      LOGIN_SERIES * LOGIN_POINTS +
      30 +
      SCRAPED_SERIES * SCRAPES.length +
      BUSY_ROUTES * BUSY_POINTS +
      QUIET_ROUTES +
      138 +
      30;

    // A metric of many series, by a branch of its own: stopped at its first points.
    const logins: MetricToRead = metrics.find((metric: MetricToRead) => {
      return metric.metricName === "user.logins";
    })!;
    const loginRows: Array<JSONObject> = await rowsOf(
      buildTelemetryLargeMetricSampleStatement({
        ...window(),
        metrics: [logins],
        perMetric: 100,
        caps,
      }),
    );
    const loginCost: {
      readRows: number;
      readBytes: number;
      durationMs: number;
    } = await lastReadCost();

    if (report) {
      process.stdout.write(
        `\n[metrics sample] ${metrics.length} metrics in one read: ${rows.length} rows returned, ${cost.readRows} rows read of ${totalPoints} points (${(cost.readBytes / 1024 / 1024).toFixed(1)} MiB) in ${cost.durationMs} ms\n[metrics sample] user.logins by its own branch: ${loginRows.length} rows returned, ${loginCost.readRows} rows read of its ${logins.newestMinutePoints} newest-minute points (${(loginCost.readBytes / 1024 / 1024).toFixed(1)} MiB) in ${loginCost.durationMs} ms\n`,
      );
    }

    // Each range read once: never more than the table holds.
    expect(cost.readRows).toBeLessThanOrEqual(totalPoints);
    expect(loginRows.length).toBe(100);
    // Stopped early: no more than a few granules, however many series.
    expect(loginCost.readRows).toBeLessThanOrEqual(3 * 8192);
  });

  // #9755: when each metric first wrote, of the last day, from the rollup alone.
  test("a metric the service started writing lately is listed first, with when it first wrote; one written all day is not new", async () => {
    const listed: (
      fromRollup: boolean,
    ) => Promise<Array<MetricToRead>> = async (
      fromRollup: boolean,
    ): Promise<Array<MetricToRead>> => {
      return readMetricsToRead(
        await rowsOf(
          buildTelemetryMetricsStatement({
            ...window(),
            ownerIds: [REPORTS],
            perOwner: 100,
            total: 2000,
            fromRollup,
          }),
        ),
        new Set([REPORTS]),
      );
    };
    const metrics: Array<MetricToRead> = await listed(true);
    const cost: ReadCost = await lastReadCost();
    const newSince: Date = getNewMetricSince(new Date());
    const byName: (name: string) => MetricToRead = (
      name: string,
    ): MetricToRead => {
      return metrics.find((metric: MetricToRead): boolean => {
        return metric.metricName === name;
      })!;
    };
    const daylong: MetricToRead = byName(DAYLONG_METRIC);
    const fresh: MetricToRead = byName(FRESH_METRIC);

    // Written all day: its first minute about 23 hours ago, not new.
    expect(daylong.firstMinute!.getTime()).toBeLessThan(
      Date.now() - 22 * 60 * 60 * 1000,
    );
    expect(daylong.firstMinute!.getTime()).toBeLessThan(newSince.getTime());
    // Its points: the window's alone, six of them, not the day's 138.
    expect(daylong.points).toBeLessThanOrEqual(7);
    // Started half an hour ago: new, listed before the day's metric.
    expect(fresh.firstMinute!.getTime()).toBeGreaterThan(
      Date.now() - 31 * 60 * 1000,
    );
    expect(fresh.firstMinute!.getTime()).toBeGreaterThanOrEqual(
      newSince.getTime(),
    );
    expect(metrics.indexOf(fresh)).toBeLessThan(metrics.indexOf(daylong));
    // The day's metric listed after every metric the service started lately.
    expect(
      metrics
        .slice(metrics.indexOf(daylong) + 1)
        .every((metric: MetricToRead): boolean => {
          return (metric.firstMinute?.getTime() || 0) < newSince.getTime();
        }),
    ).toBe(true);

    // From the points, the window alone: when nothing first wrote is known.
    for (const metric of await listed(false)) {
      expect(metric.firstMinute).toBeUndefined();
    }

    if (report) {
      process.stdout.write(
        `\n[metrics list] reports' ${metrics.length} metrics, a day of the rollup: ${describeCost(cost)}\n`,
      );
    }
  });

  /*
   * #9756: a metric's newest minute was read for its first hundred points,
   * which were a hundred series only where each series wrote one point a
   * minute. A point of each series is read now, however often each writes.
   */
  test("a point of each series, however often a metric is sent: a scraped queue's hundred series, and every quiet route beside the busy ones", async () => {
    const metrics: Array<MetricToRead> = readMetricsToRead(
      await rowsOf(
        buildTelemetryMetricsStatement({
          ...window(),
          ownerIds: SERVICES,
          perOwner: 100,
          total: 2000,
          fromRollup: true,
        }),
      ),
      new Set(SERVICES),
    );
    // The scan's ordinary read: the metrics not of many series.
    const ordinary: Array<MetricToRead> = metrics.filter(
      (metric: MetricToRead): boolean => {
        return !isLargeMetric(metric);
      },
    );
    const caps: TelemetrySampleCaps = capsOf(
      getTelemetrySource(TelemetrySampleSource.Metrics),
      options(),
    );
    const rows: Array<JSONObject> = await rowsOf(
      buildTelemetryMetricSampleStatement({
        ...window(),
        metrics: ordinary,
        perMetric: 100,
        caps,
      }),
    );
    const cost: ReadCost = await lastReadCost();
    const before: Array<JSONObject> = await rowsOf(
      firstPointsStatement(ordinary, 100),
    );
    const costBefore: ReadCost = await lastReadCost();
    const series: Map<string, number> = seriesByMetric(rows);
    const seriesBefore: Map<string, number> = seriesByMetric(before);
    const rowsOfMetric: (
      read: ReadonlyArray<JSONObject>,
      metric: string,
    ) => Array<JSONObject> = (
      read: ReadonlyArray<JSONObject>,
      metric: string,
    ): Array<JSONObject> => {
      return read.filter((row: JSONObject): boolean => {
        return row["readMetricName"] === metric;
      });
    };
    const holdsTheEmail: (row: JSONObject) => boolean = (
      row: JSONObject,
    ): boolean => {
      return JSON.stringify(row["readAttributes"]).includes(QUIET_EMAIL);
    };

    // Every row a series of its own, a hundred at most of each metric.
    for (const metric of ordinary) {
      const key: string = `${metric.ownerId}|${metric.metricName}`;
      const read: number = rows.filter((row: JSONObject): boolean => {
        return (
          row["ownerId"] === metric.ownerId &&
          row["readMetricName"] === metric.metricName
        );
      }).length;

      expect(series.get(key)).toBe(read);
      expect(read).toBeLessThanOrEqual(100);
    }

    // The scraped queue: a hundred of its series, four points of each in its minute.
    expect(
      ordinary.find((metric: MetricToRead): boolean => {
        return metric.metricName === SCRAPED_METRIC;
      })?.newestMinutePoints,
    ).toBe(SCRAPED_SERIES * SCRAPES.length);
    expect(series.get(`${PAYMENTS}|${SCRAPED_METRIC}`)).toBe(100);

    // Every route of the requests: the three busy ones, and every quiet one.
    expect(series.get(`${PAYMENTS}|${REQUEST_METRIC}`)).toBe(
      BUSY_ROUTES + QUIET_ROUTES,
    );
    expect(
      rowsOfMetric(rows, REQUEST_METRIC).filter(holdsTheEmail).length,
    ).toBe(1);
    // Its first hundred points were the busy routes' first second and a half.
    expect(rowsOfMetric(before, REQUEST_METRIC).length).toBe(100);
    expect(seriesBefore.get(`${PAYMENTS}|${REQUEST_METRIC}`)).toBeLessThan(10);
    expect(rowsOfMetric(before, REQUEST_METRIC).some(holdsTheEmail)).toBe(
      false,
    );

    if (report) {
      process.stdout.write(
        `\n[metrics series] ${ordinary.length} metrics, a point of each series: ${rows.length} rows returned, ${describeCost(cost)}; ${SCRAPED_METRIC} ${series.get(`${PAYMENTS}|${SCRAPED_METRIC}`)} series, ${REQUEST_METRIC} ${series.get(`${PAYMENTS}|${REQUEST_METRIC}`)} series\n[metrics series] the same metrics, their first points (before #9756): ${before.length} rows returned, ${describeCost(costBefore)}; ${SCRAPED_METRIC} ${seriesBefore.get(`${PAYMENTS}|${SCRAPED_METRIC}`)} series, ${REQUEST_METRIC} ${seriesBefore.get(`${PAYMENTS}|${REQUEST_METRIC}`)} series\n`,
      );
    }

    // The same ranges of the table, read once each: what the first points' read read.
    expect(cost.readRows).toBe(costBefore.readRows);
  });

  test("a scan finds a user's email and a client's IP in labels and an email in a metric's name, and reads their records again", async () => {
    const scans: Array<TelemetryStoreScan> = await scanProjectTelemetry({
      projectId: PROJECT_ID,
      sampleSize: 500,
      since: new Date(Date.now() - 60 * 60 * 1000),
      options: options(),
    });
    const metricStores: Array<TelemetryStoreScan> = scans.filter(
      (scan: TelemetryStoreScan): boolean => {
        return scan.kind === DataStoreKind.TelemetryMetrics;
      },
    );

    expect(
      metricStores
        .map((scan: TelemetryStoreScan): string => {
          return scan.serviceId;
        })
        .sort(),
    ).toEqual([...SERVICES].sort());

    const checkout: TelemetryStoreScan = metricStores.find(
      (scan: TelemetryStoreScan): boolean => {
        return scan.serviceId === CHECKOUT;
      },
    )!;
    const signup: TelemetryStoreScan = metricStores.find(
      (scan: TelemetryStoreScan): boolean => {
        return scan.serviceId === SIGNUP;
      },
    )!;
    const at: (
      scan: TelemetryStoreScan,
      location: string,
    ) => LocationFindings | undefined = (
      scan: TelemetryStoreScan,
      location: string,
    ): LocationFindings | undefined => {
      return scan.result.locations.find((entry: LocationFindings): boolean => {
        return entry.location === location;
      });
    };

    const email: LocationFindings = at(checkout, "attributes.user.email")!;
    const ip: LocationFindings = at(checkout, "attributes.resource.client.ip")!;
    const name: LocationFindings = at(signup, "name")!;

    expect(email.classifications[0]?.dataTypeId).toBe("email-address");
    // Each label value once: as many values as were sampled, all different.
    expect(email.classifications[0]?.valueCount).toBe(100);
    expect(ip.classifications[0]?.dataTypeId).toBe("ip-address");
    expect(
      name.classifications.map((classification: { dataTypeId: string }) => {
        return classification.dataTypeId;
      }),
    ).toContain("email-address");
    // The ordinary labels hold nothing sensitive.
    expect(at(checkout, "attributes.http.route")).toBeUndefined();
    expect(at(checkout, "attributes.oneuptime.service.id")).toBeUndefined();

    // #9756: the quiet route beside the busy ones is read, and its email found.
    const payments: TelemetryStoreScan = metricStores.find(
      (scan: TelemetryStoreScan): boolean => {
        return scan.serviceId === PAYMENTS;
      },
    )!;

    expect(
      at(payments, "attributes.http.route")?.classifications.map(
        (classification: { dataTypeId: string }): string => {
          return classification.dataTypeId;
        },
      ),
    ).toEqual(["email-address"]);

    const emailRecords: Array<FindingSampleRecord> =
      email.sampleRecords?.["email-address"] || [];
    const nameRecords: Array<FindingSampleRecord> =
      name.sampleRecords?.["email-address"] || [];

    /*
     * Every series of a metric is written in its export's millisecond: the
     * points sampled from one export are one reference, of that metric.
     */
    expect(emailRecords.length).toBeGreaterThan(0);
    expect(
      emailRecords.every((record: FindingSampleRecord): boolean => {
        return record.metricName === "user.logins";
      }),
    ).toBe(true);
    // Never a name that is the data itself.
    expect(nameRecords.length).toBeGreaterThan(0);
    expect(
      nameRecords.every((record: FindingSampleRecord): boolean => {
        return record.metricName === undefined;
      }),
    ).toBe(true);

    const occurrencesOf: (data: {
      ownerId: string;
      location: string;
      records: Array<FindingSampleRecord>;
    }) => Promise<DataSecurityFindingOccurrences> = async (data: {
      ownerId: string;
      location: string;
      records: Array<FindingSampleRecord>;
    }): Promise<DataSecurityFindingOccurrences> => {
      const plan: OccurrencePlan = planOccurrenceRead(
        DataStoreKind.TelemetryMetrics,
        data.location,
      )!;

      return await findTelemetryFindingOccurrences({
        projectId: PROJECT_ID,
        plan,
        ownerId: data.ownerId,
        location: data.location,
        dataTypeId: "email-address",
        options: options(),
        sampleRecords: data.records,
        lastSeenAt: new Date(),
      });
    };

    const emailOccurrences: DataSecurityFindingOccurrences =
      await occurrencesOf({
        ownerId: CHECKOUT,
        location: "attributes.user.email",
        records: emailRecords,
      });

    expect(emailOccurrences.occurrences.length).toBeGreaterThan(0);

    for (const occurrence of emailOccurrences.occurrences) {
      expect(occurrence.recordKind).toBe(
        DataSecurityOccurrenceRecordKind.Metric,
      );
      expect(occurrence.name).toBe("user.logins");
      expect(occurrence.metricName).toBe("user.logins");
      expect(occurrence.serviceId).toBe(CHECKOUT);
      expect(occurrence.excerpt?.field).toBe("user.email");
      expect(occurrence.maskedValue).not.toContain("acmecorp.io");
    }

    // The export's millisecond holds every user's series: as many as are shown.
    expect(emailOccurrences.occurrences.length).toBe(10);

    const nameOccurrences: DataSecurityFindingOccurrences = await occurrencesOf(
      {
        ownerId: SIGNUP,
        location: "name",
        records: nameRecords,
      },
    );

    expect(nameOccurrences.occurrences.length).toBe(1);
    expect(nameOccurrences.occurrences[0]?.name).not.toContain("jane.doe");
    expect(nameOccurrences.occurrences[0]?.metricName).toBeUndefined();

    // A finding from before records were kept: the hour it was last seen in, narrowed.
    const searched: DataSecurityFindingOccurrences = await occurrencesOf({
      ownerId: CHECKOUT,
      location: "attributes.user.email",
      records: [],
    });

    expect(searched.occurrences.length).toBe(10);
  });
});
