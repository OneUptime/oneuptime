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
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
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
  getTelemetrySource,
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
const MONITOR: string = "0192f1a0-0000-7000-8000-0000000dc001";
const SERVICES: Array<string> = [CHECKOUT, SIGNUP, PAYMENTS];

// Ordinary metrics: each service's, each of a few series, a point every 10 seconds.
const ORDINARY_METRICS: number = 8;
const ORDINARY_SERIES: number = 20 * scale;
const ORDINARY_POINTS: number = 40;
// The login counter labelled by the user's email: a series per user, a point a minute.
const LOGIN_SERIES: number = 3_000 * scale;
const LOGIN_POINTS: number = 5;

let client: ClickHouseClient;
const queryIds: Array<{ id: string; query: string }> = [];

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

// What the last read read, from the server's own log.
async function lastReadCost(): Promise<{
  readRows: number;
  readBytes: number;
  durationMs: number;
}> {
  const last: { id: string } | undefined = queryIds[queryIds.length - 1];

  await client.command({ query: "SYSTEM FLUSH LOGS" });

  const rows: Array<JSONObject> = (
    (await (
      await client.query({
        query: `SELECT read_rows, read_bytes, query_duration_ms FROM system.query_log WHERE query_id = {id:String} AND type = 'QueryFinish'`,
        query_params: { id: last?.id || "" },
        format: "JSON",
      })
    ).json()) as { data: Array<JSONObject> }
  ).data;

  return {
    readRows: Number(rows[0]?.["read_rows"] || 0),
    readBytes: Number(rows[0]?.["read_bytes"] || 0),
    durationMs: Number(rows[0]?.["query_duration_ms"] || 0),
  };
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
    expect(fromRollup.length).toBe(3 * ORDINARY_METRICS + 2);
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

    expect(fewer.length).toBe(6);
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
