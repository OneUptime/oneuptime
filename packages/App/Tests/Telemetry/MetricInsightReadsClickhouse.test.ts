import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import MetricBaselineHourly from "Common/Models/AnalyticsModels/MetricBaselineHourly";
import Service from "Common/Models/DatabaseModels/Service";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import {
  ClickHouseSettings,
  ClickhouseExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { InsightCandidate } from "Common/Server/Utils/AI/SRE/Insights/Types";
import AIInsightSeverity from "Common/Types/AI/AIInsightSeverity";
import AIInsightType from "Common/Types/AI/AIInsightType";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  METRIC_NAME_ID_PATTERN,
  METRIC_NAME_ID_PLACEHOLDER,
  MetricBucketProblem,
  MetricHighCardinalityReading,
  MetricHistogramBucketsReading,
  MetricNamePatternReading,
  MetricShapeReading,
  MetricValueShape,
  MetricVolumeReading,
  OTEL_DEFAULT_HISTOGRAM_BOUNDS,
  OTEL_METRIC_OVERFLOW_ATTRIBUTE,
  getMetricNamePattern,
  pickHistogramReading,
  readHighCardinalityAttributes,
  readHistogramBuckets,
} from "Common/Utils/Metrics/MetricInsight";
import { generatedTexts } from "Common/Tests/Helpers/GeneratedTexts";
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
 * Metrics' AI section's reads against a real ClickHouse server.
 *
 * The unit suites pin the SQL each read sends
 * (Common/Tests/Server/Services/MetricAggregationServiceInsightReads) and
 * the gates the detector files its findings by. What they cannot show is
 * what ClickHouse makes of the SQL: that the hourly rollup's cell for the
 * hour is the one its materialized view writes, that replaceRegexpAll
 * collapses the ids in a metric's name exactly as the JavaScript pattern
 * does, that sumForEach sums a histogram's buckets bucket by bucket, that
 * the attribute read leaves out the resource's, the scope's and
 * OneUptime's own attributes and the SDK's overflow mark, and that the
 * close reads skip rows outside the hour or past their retention. So this
 * suite loads an hour of a service's metrics into tables built from the
 * real Metric and MetricBaselineHourly models (with the rollup's own
 * materialized view), runs each read through MetricService, on both
 * analyzers, and runs one look of the real detector over them.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/MetricInsightReadsClickhouse.test.ts
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

import MetricService from "Common/Server/Services/MetricService";
import MetricAggregationService, {
  MetricAttributeCardinalityRow,
  MetricSeriesKey,
  MetricShapeRow,
} from "Common/Server/Services/MetricAggregationService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import ServiceService from "Common/Server/Services/ServiceService";
import TraceAggregationService from "Common/Server/Services/TraceAggregationService";
import MetricProblemDetector from "Common/Server/Utils/AI/SRE/Insights/Detectors/MetricProblemDetector";
import LlmConversationPrivacy from "Common/Server/Utils/LlmObservability/LlmConversationPrivacy";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `metric_insight_reads_test_${process.pid}_${Date.now()}`;

const HOUR: number = 60 * 60 * 1000;

// A whole hour two hours ago: nothing is near "now", all within retention.
const HOUR_START: Date = new Date(
  Math.floor(Date.now() / HOUR) * HOUR - 2 * HOUR,
);
const HOUR_END: Date = new Date(HOUR_START.getTime() + HOUR);

// Postgres ids, as service ids always are.
const projectId: ObjectID = new ObjectID(
  "5231dddd-0000-4000-8000-00000000000a",
);
const otherProjectId: ObjectID = new ObjectID(
  "5231dddd-0000-4000-8000-00000000000b",
);
const CHECKOUT: string = "5231dddd-0000-4000-8000-00000000000c";
const PAYMENTS: string = "5231dddd-0000-4000-8000-00000000000d";

const REQUEST_COUNT: string = "http.server.request.count";
const DURATION: string = "http.server.duration";

const ROUTES: Array<string> = ["/orders/:id", "/cart", "/checkout"];

// The users' ids the request counter records: one for each of its points.
const USER_COUNT: number = 1200;

function uuid(index: number): string {
  return `6f1c2d3e-4a5b-4c6d-8e7f-${index.toString(16).padStart(12, "0")}`;
}

const inThirty: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
);
const yesterday: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), -1),
);

interface PointFixture {
  name: string;
  // Seconds into the hour.
  at: number;
  serviceId?: string;
  projectId?: ObjectID;
  pointType: "Sum" | "Gauge" | "Histogram";
  attributes?: Record<string, string>;
  value?: number;
  histogram?: {
    bounds: Array<number>;
    buckets: Array<number>;
    min: number;
    max: number;
  };
  retentionDate?: string;
}

let rowIndex: number = 0;

function metricRow(fixture: PointFixture): JSONObject {
  const time: Date = new Date(HOUR_START.getTime() + fixture.at * 1000);
  const attributes: Record<string, string> = fixture.attributes || {};
  const count: number | null = fixture.histogram
    ? fixture.histogram.buckets.reduce((sum: number, bucket: number) => {
        return sum + bucket;
      }, 0)
    : null;

  rowIndex++;

  return {
    _id: ObjectID.generate().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: (fixture.projectId || projectId).toString(),
    primaryEntityId: fixture.serviceId || CHECKOUT,
    primaryEntityType: "Service",
    name: fixture.name,
    aggregationTemporality: "Delta",
    metricPointType: fixture.pointType,
    time: OneUptimeDate.toClickhouseDateTime64(time),
    timeUnixNano: String(time.getTime() * 1000000 + rowIndex),
    attributes: attributes,
    attributeKeys: Object.keys(attributes).sort(),
    entityKeys: [],
    value: fixture.histogram ? null : fixture.value ?? 1,
    count: count,
    sum: fixture.histogram ? (count || 0) * 0.2 : null,
    min: fixture.histogram ? fixture.histogram.min : null,
    max: fixture.histogram ? fixture.histogram.max : null,
    bucketCounts: fixture.histogram ? fixture.histogram.buckets : [],
    explicitBounds: fixture.histogram ? fixture.histogram.bounds : [],
    retentionDate: fixture.retentionDate || inThirty,
  };
}

// Sixteen buckets for the default bounds, `count` values in the one at `index`.
function oneBucket(index: number, count: number): Array<number> {
  return OTEL_DEFAULT_HISTOGRAM_BOUNDS.map((_bound: number, at: number) => {
    return at === index ? count : 0;
  }).concat(index === OTEL_DEFAULT_HISTOGRAM_BOUNDS.length ? [count] : [0]);
}

function fixtures(): Array<PointFixture> {
  const points: Array<PointFixture> = [];

  /*
   * checkout's request counter, with a user's id on every point - and the
   * attributes that are not its code's, which the read leaves out.
   */
  for (let index: number = 0; index < USER_COUNT; index++) {
    points.push({
      name: REQUEST_COUNT,
      at: index % 3600,
      pointType: "Sum",
      attributes: {
        "user.id": uuid(index),
        "http.route": ROUTES[index % ROUTES.length]!,
        "resource.service.instance.id": uuid(100000 + index),
        "scope.version": `1.${index}`,
        "oneuptime.trace.id": uuid(200000 + index),
      },
    });
  }

  // Past the SDK's own limit: its overflow series.
  for (let index: number = 0; index < 3; index++) {
    points.push({
      name: REQUEST_COUNT,
      at: 100 + index,
      pointType: "Sum",
      attributes: { [OTEL_METRIC_OVERFLOW_ATTRIBUTE]: "true" },
    });
  }

  // Never read closely: outside the hour, and past its retention.
  points.push({
    name: REQUEST_COUNT,
    at: -60,
    pointType: "Sum",
    attributes: { "user.id": uuid(900001) },
  });
  points.push({
    name: REQUEST_COUNT,
    at: 600,
    pointType: "Sum",
    attributes: { "user.id": uuid(900002) },
    retentionDate: yesterday,
  });

  /*
   * Request durations in seconds, in the SDKs' default buckets made for
   * milliseconds: 1,900 of 2,040 values in (0, 5].
   */
  for (let index: number = 0; index < 1020; index++) {
    points.push({
      name: DURATION,
      at: index % 3600,
      pointType: "Histogram",
      attributes: { "http.route": ROUTES[index % ROUTES.length]! },
      histogram: {
        bounds: [...OTEL_DEFAULT_HISTOGRAM_BOUNDS],
        buckets: index < 950 ? oneBucket(1, 2) : oneBucket(2, 2),
        min: index === 0 ? 0.012 : 0.3,
        max: index === 1 ? 4.8 : 1.2,
      },
    });
  }

  // A job's id in each of its metric's names.
  for (let index: number = 0; index < 60; index++) {
    for (const second of [10, 20]) {
      points.push({
        name: `job.${1000 + index}.duration`,
        at: second,
        pointType: "Gauge",
      });
    }
  }

  // Another project's counter with its users' ids: never read.
  for (let index: number = 0; index < 1500; index++) {
    points.push({
      name: REQUEST_COUNT,
      at: index % 3600,
      projectId: otherProjectId,
      pointType: "Sum",
      attributes: { "user.id": uuid(500000 + index) },
    });
  }

  return points;
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

  // The rollup's own view, read from the table it is written for.
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

function connectionOf(service: typeof MetricService): ServiceConnection {
  return {
    database: service.database,
    databaseClient: service.databaseClient,
    ingestDatabase: service.ingestDatabase,
    ingestDatabaseClient: service.ingestDatabaseClient,
  };
}

const keys: Array<MetricSeriesKey> = [
  { metricName: REQUEST_COUNT, serviceId: CHECKOUT },
  { metricName: DURATION, serviceId: CHECKOUT },
];

interface Reads {
  volumes: Array<MetricVolumeReading>;
  patterns: Array<MetricNamePatternReading>;
  shapes: Array<MetricShapeRow>;
  attributes: Array<MetricAttributeCardinalityRow>;
}

async function readAll(): Promise<Reads> {
  return {
    volumes: await MetricAggregationService.getHourlyMetricVolumes({
      projectId,
      hourStart: HOUR_START,
      limit: 5000,
    }),
    patterns: await MetricAggregationService.getMetricNamePatterns({
      projectId,
      hourStart: HOUR_START,
      minNameCount: 50,
      limit: 20,
    }),
    shapes: await MetricAggregationService.getMetricShapes({
      projectId,
      startTime: HOUR_START,
      endTime: HOUR_END,
      metrics: keys,
    }),
    attributes: await MetricAggregationService.getMetricAttributeCardinality({
      projectId,
      startTime: HOUR_START,
      endTime: HOUR_END,
      metrics: keys,
      minValueCount: 1000,
      sampleSize: 100,
    }),
  };
}

function service(id: string, name: string): Service {
  const row: Service = new Service();
  row.id = new ObjectID(id);
  row.name = name;
  return row;
}

integration("Metrics' AI reads against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let original: ServiceConnection | undefined;
  let reads: Reads;

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

    await createTable(client, clickhouse, Metric);
    await createTable(client, clickhouse, MetricBaselineHourly);

    original = connectionOf(MetricService);
    MetricService.database = clickhouse;
    MetricService.databaseClient = client;
    MetricService.ingestDatabase = clickhouse;
    MetricService.ingestDatabaseClient = client;

    await MetricService.insertJsonRows(fixtures().map(metricRow), {
      clickhouseSettings: { wait_for_async_insert: 1 },
    });

    reads = await readAll();
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(MetricService, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("the hour's metrics come from the rollup's cell for the hour: each one's data points by service, busiest first", () => {
    expect(reads.volumes.slice(0, 2)).toEqual([
      /*
       * Its 1,200 users' points, the 3 overflow points and the one past its
       * retention: the rollup counts what arrived in the hour.
       */
      { metricName: REQUEST_COUNT, serviceId: CHECKOUT, dataPointCount: 1204 },
      { metricName: DURATION, serviceId: CHECKOUT, dataPointCount: 1020 },
    ]);
    expect(reads.volumes).toHaveLength(2 + 60);
    expect(
      reads.volumes.every((reading: MetricVolumeReading): boolean => {
        return reading.serviceId === CHECKOUT;
      }),
    ).toBe(true);
  });

  test("a metric name's ids collapse into the pattern its names share", () => {
    expect(reads.patterns).toEqual([
      {
        serviceId: CHECKOUT,
        namePattern: "job.{id}.duration",
        nameCount: 60,
        dataPointCount: 120,
      },
    ]);
  });

  test("replaceRegexpAll collapses every id as the JavaScript pattern does", async () => {
    const names: Array<string> = [
      "job.8812.duration",
      "tenant.6f1c2d3e-4a5b-4c6d-8e7f-001122334455.requests",
      "cache.0123456789abcdef.hits",
      "x.0123456789abcde.y",
      "a.00000000-0000-4000-8000-000000000000.b",
      "orders_2026_10_24_total",
      "http2.server.v2.requests",
      "deadbeef.count",
      ...generatedTexts(500, 5231, [
        "0",
        "1",
        "9",
        "a",
        "f",
        "x",
        ".",
        "-",
        "_",
        "/",
        "{",
        "}",
      ]),
    ];

    const result: { json: () => Promise<unknown> } = await client.query({
      query:
        "SELECT name, replaceRegexpAll(name, {pattern:String}, {placeholder:String}) AS pattern FROM (SELECT arrayJoin({names:Array(String)}) AS name)",
      query_params: {
        pattern: METRIC_NAME_ID_PATTERN,
        placeholder: METRIC_NAME_ID_PLACEHOLDER,
        names,
      },
      format: "JSONEachRow",
    });
    const rows: Array<{ name: string; pattern: string }> =
      (await result.json()) as Array<{ name: string; pattern: string }>;

    expect(rows).toHaveLength(names.length);

    for (const row of rows) {
      expect({ name: row.name, pattern: row.pattern }).toEqual({
        name: row.name,
        pattern: getMetricNamePattern(row.name),
      });
    }
  });

  test("a histogram's buckets are summed bucket by bucket, over the hour and within retention", () => {
    const duration: Array<MetricShapeRow> = reads.shapes.filter(
      (row: MetricShapeRow): boolean => {
        return row.metricName === DURATION;
      },
    );

    expect(duration).toHaveLength(1);
    expect(duration[0]).toEqual({
      metricName: DURATION,
      serviceId: CHECKOUT,
      pointType: "Histogram",
      temporality: "Delta",
      bounds: [...OTEL_DEFAULT_HISTOGRAM_BOUNDS],
      bucketCounts: [0, 1900, 140, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      countSum: 2040,
      countMax: 2,
      minValue: 0.012,
      maxValue: 4.8,
      dataPointCount: 1020,
      overflowDataPointCount: 0,
    });

    const histogram: MetricShapeReading | null = pickHistogramReading(duration);
    const buckets: MetricHistogramBucketsReading | null = histogram
      ? readHistogramBuckets(histogram)
      : null;

    expect(buckets?.problem).toBe(MetricBucketProblem.BelowSmallestBucket);
    expect(buckets?.share).toBeCloseTo((1900 / 2040) * 100, 6);
    expect(buckets?.hasDefaultBounds).toBe(true);

    const counter: Array<MetricShapeRow> = reads.shapes.filter(
      (row: MetricShapeRow): boolean => {
        return row.metricName === REQUEST_COUNT;
      },
    );

    // Not the point outside the hour, nor the one past its retention.
    expect(counter).toEqual([
      {
        metricName: REQUEST_COUNT,
        serviceId: CHECKOUT,
        pointType: "Sum",
        temporality: "Delta",
        bounds: [],
        bucketCounts: [],
        countSum: 0,
        countMax: 0,
        minValue: null,
        maxValue: null,
        dataPointCount: 1203,
        overflowDataPointCount: 3,
      },
    ]);
  });

  test("only the attributes the code sets are counted, each past the gate with a sample of its values", () => {
    expect(
      reads.attributes.map((row: MetricAttributeCardinalityRow) => {
        return [row.metricName, row.serviceId, row.key, row.valueCount];
      }),
    ).toEqual([[REQUEST_COUNT, CHECKOUT, "user.id", USER_COUNT]]);

    // A hundred of the hour's own users, read to tell what they look like.
    const sample: ReadonlyArray<string> = reads.attributes[0]!.sampleValues;
    const users: Set<string> = new Set<string>(
      Array.from({ length: USER_COUNT }, (_value: unknown, index: number) => {
        return uuid(index);
      }),
    );

    expect(sample).toHaveLength(100);
    expect(new Set(sample).size).toBe(100);
    expect(
      sample.filter((value: string): boolean => {
        return !users.has(value);
      }),
    ).toEqual([]);

    const reading: MetricHighCardinalityReading | null =
      readHighCardinalityAttributes(reads.attributes);

    expect(reading).toEqual({
      attribute: { key: "user.id", valueCount: USER_COUNT },
      valueShape: MetricValueShape.Uuid,
      otherAttributes: [],
    });
  });

  test("the older analyzer reads the same", async () => {
    const found: { json: () => Promise<unknown> } = await client.query({
      query:
        "SELECT name FROM system.settings WHERE name IN ('enable_analyzer', 'allow_experimental_analyzer') ORDER BY name = 'enable_analyzer' DESC LIMIT 1",
      format: "JSONEachRow",
    });
    const [setting] = (await found.json()) as Array<{ name: string }>;

    if (!setting) {
      return;
    }

    const executeQuery: typeof MetricService.executeQuery =
      MetricService.executeQuery.bind(MetricService);

    jest
      .spyOn(MetricService, "executeQuery")
      .mockImplementation(
        (
          statement: Statement | string,
          runOptions?: ClickhouseExecuteOptions,
        ): Promise<never> => {
          return executeQuery(statement, {
            ...(runOptions || {}),
            clickhouseSettings: {
              ...(runOptions?.clickhouseSettings || {}),
              [setting.name]: 0,
            } as ClickHouseSettings,
          }) as Promise<never>;
        },
      );

    // Which hundred values a sample holds is the server's to pick.
    const withoutSamples: (from: Reads) => JSONObject = (
      from: Reads,
    ): JSONObject => {
      return {
        ...from,
        attributes: from.attributes.map(
          (row: MetricAttributeCardinalityRow) => {
            return { ...row, sampleValues: row.sampleValues.length };
          },
        ),
      } as unknown as JSONObject;
    };

    try {
      expect(withoutSamples(await readAll())).toEqual(withoutSamples(reads));
    } finally {
      jest.restoreAllMocks();
    }
  });

  test("one look of the detector finds each kind from these rows", async () => {
    jest
      .spyOn(LlmConversationPrivacy, "getRestrictedServiceIds")
      .mockResolvedValue([]);
    jest
      .spyOn(ServiceService, "findBy")
      .mockResolvedValue([
        service(CHECKOUT, "checkout"),
        service(PAYMENTS, "payments"),
      ]);
    // The catalog records no unit, and no metric ever from payments.
    jest.spyOn(MetricTypeService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(TraceAggregationService, "getServiceSpanHealth")
      .mockResolvedValue([
        {
          primaryEntityId: PAYMENTS,
          spanCount: 4200,
          failedSpanCount: 12,
          rootSpanCount: 1000,
        },
      ]);
    jest
      .spyOn(TraceAggregationService, "getAnalyticsTable")
      .mockResolvedValue([]);

    try {
      const found: Array<InsightCandidate> = await MetricProblemDetector.look({
        projectId,
        now: new Date(HOUR_END.getTime() + 4000),
      });

      expect(
        found.map((candidate: InsightCandidate) => {
          return [
            candidate.insightType,
            candidate.fingerprint,
            candidate.severity,
          ];
        }),
      ).toEqual([
        // Past the SDK's limit: High.
        [
          AIInsightType.MetricHighCardinality,
          `metric-high-cardinality:${CHECKOUT}:attribute:${REQUEST_COUNT}`,
          AIInsightSeverity.High,
        ],
        [
          AIInsightType.MetricHistogramBuckets,
          `metric-histogram-buckets:${CHECKOUT}:${DURATION}`,
          AIInsightSeverity.Medium,
        ],
        // checkout's job names are its third finding: two a service.
        [
          AIInsightType.MetricMissingMetrics,
          `metric-missing-metrics:${PAYMENTS}`,
          AIInsightSeverity.Low,
        ],
      ]);
      expect(found[0]!.title).toBe(
        `${REQUEST_COUNT} in checkout records 1,200 different user.id values an hour`,
      );
      expect(found[0]!.evidence.metric?.hasOverflow).toBe(true);
      expect(found[1]!.evidence.metric).toMatchObject({
        bucketProblem: MetricBucketProblem.BelowSmallestBucket,
        valueCount: 2040,
        minValue: 0.012,
        maxValue: 4.8,
      });

      // No user's id is kept.
      expect(JSON.stringify(found)).not.toContain("6f1c2d3e-4a5b");
    } finally {
      jest.restoreAllMocks();
    }
  });
});

describe("Metrics' AI ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
