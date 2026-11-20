import { JSONObject } from "Common/Types/JSON";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import PromQLEngine from "Common/Utils/PromQL/PromQLEngine";
import {
  PromQLQueryResult,
  PromQLResultType,
  PromQLVectorResultSample,
} from "Common/Utils/PromQL/PromQLEngineTypes";
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
 * Prometheus remote write, stored and read back, against a real
 * ClickHouse server (#7714, #7701).
 *
 * The unit suites pin what a request is translated into and the SQL each
 * read sends. What they cannot show is what the real metrics ingest makes
 * of the translation and what ClickHouse makes of the SQL. So a Prometheus
 * server's requests - real protobuf, real snappy - are translated, run
 * through the REAL metrics ingest into a table built from the REAL Metric
 * model, and read back as the product reads them:
 *
 *   - rate() of a counter, through the REAL PromQL engine and series
 *     source, answers what Prometheus answers;
 *   - a classic histogram, its buckets split over two requests as a
 *     sender's shards split them, charts the same percentiles in the
 *     Metrics explorer (MetricService) as the same histogram sent over
 *     OTLP, and histogram_quantile reads it in PromQL;
 *   - an exemplar links exactly its bucket's datapoint to its trace.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18126:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18126 \
 *     npx jest Tests/Telemetry/Compatible/PrometheusRemoteWriteClickhouse.test.ts
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

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn(), getQueue: jest.fn() },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

import MetricService from "Common/Server/Services/MetricService";
import PromQLMetricSeriesSource from "Common/Server/Utils/PromQL/PromQLMetricSeriesSource";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import OtelIngestBaseService from "../../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import OtelMetricsIngestService from "../../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService from "../../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import ExceptionUtil from "../../../FeatureSet/Telemetry/Utils/Exception";
import PrometheusRemoteWrite, {
  PrometheusRemoteWriteVersion,
  PrometheusTranslation,
  WriteRequestV1,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/PrometheusRemoteWrite";
import SnappyBlock from "../../../FeatureSet/Telemetry/Utils/Compatible/SnappyBlock";
import { snappyCompress } from "./SnappyTestCompressor";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `prometheus_remote_write_test_${process.pid}_${Date.now()}`;

const PROJECT_ID: ObjectID = ObjectID.generate();
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID: string = "00f067aa0ba902b7";

const SCRAPE_MS: number = 15000;
const SCRAPES: number = 40;
// The first scrape, on a whole minute half an hour ago.
const FIRST_SCRAPE_MS: number =
  Math.floor((Date.now() - 30 * 60 * 1000) / 60000) * 60000;
const LAST_SCRAPE_MS: number = FIRST_SCRAPE_MS + (SCRAPES - 1) * SCRAPE_MS;
// The scrape the exemplar is kept on.
const EXEMPLAR_SCRAPE: number = 20;

const SERIES: Array<{ name: string; value: string }> = [
  { name: "instance", value: "10.0.0.7:9090" },
  { name: "job", value: "checkout" },
];

// Each scrape adds 10 observations: 5 under 0.1s, 3 under 0.5s, 2 under 1s.
const BOUNDS: Array<string> = ["0.1", "0.5", "1", "+Inf"];
const PER_SCRAPE: Array<number> = [5, 3, 2, 0];

const scrapeTime: (scrape: number) => number = (scrape: number): number => {
  return FIRST_SCRAPE_MS + scrape * SCRAPE_MS;
};

// The cumulative count up to bound `index` after scrape `scrape` (1-based).
const cumulative: (index: number, scrape: number) => number = (
  index: number,
  scrape: number,
): number => {
  let total: number = 0;

  for (let bucket: number = 0; bucket <= index; bucket++) {
    total += PER_SCRAPE[bucket]!;
  }

  return total * (scrape + 1);
};

const labelled: (
  name: string,
  extra?: Array<{ name: string; value: string }>,
) => Array<{ name: string; value: string }> = (
  name: string,
  extra?: Array<{ name: string; value: string }>,
): Array<{ name: string; value: string }> => {
  return [{ name: "__name__", value: name }, ...SERIES, ...(extra || [])].sort(
    (a: { name: string }, b: { name: string }): number => {
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    },
  );
};

/*
 * Two requests, as a sender with two shards splits its series between
 * them: the counter and the buckets 0.1 and +Inf in one, the buckets 0.5
 * and 1 (and the exemplar of 0.5) in the other.
 */
const remoteWriteRequests: () => Array<Buffer> = (): Array<Buffer> => {
  const first: Array<JSONObject> = [];
  const second: Array<JSONObject> = [];

  for (let scrape: number = 0; scrape < SCRAPES; scrape++) {
    first.push({
      labels: labelled("http_requests_total", [{ name: "code", value: "200" }]),
      samples: [{ value: 100 + 2 * scrape, timestamp: scrapeTime(scrape) }],
    });

    BOUNDS.forEach((le: string, index: number) => {
      (index === 0 || index === 3 ? first : second).push({
        labels: labelled("latency_seconds_bucket", [{ name: "le", value: le }]),
        samples: [
          { value: cumulative(index, scrape), timestamp: scrapeTime(scrape) },
        ],
      });
    });
  }

  // Prometheus sends an exemplar in a series of its own.
  second.push({
    labels: labelled("latency_seconds_bucket", [{ name: "le", value: "0.5" }]),
    exemplars: [
      {
        labels: [
          { name: "span_id", value: SPAN_ID },
          { name: "trace_id", value: TRACE_ID },
        ],
        value: 0.27,
        timestamp: scrapeTime(EXEMPLAR_SCRAPE) - 4000,
      },
    ],
  });

  return [first, second].map((timeseries: Array<JSONObject>): Buffer => {
    return snappyCompress(
      Buffer.from(
        WriteRequestV1.encode(
          WriteRequestV1.fromObject({ timeseries: timeseries }),
        ).finish(),
      ),
    );
  });
};

// The same histogram, as an OpenTelemetry SDK sends it.
const otlpHistogram: () => JSONObject = (): JSONObject => {
  const dataPoints: Array<JSONObject> = [];

  for (let scrape: number = 0; scrape < SCRAPES; scrape++) {
    dataPoints.push({
      timeUnixNano: String(BigInt(scrapeTime(scrape)) * BigInt(1000000)),
      count: String(10 * (scrape + 1)),
      sum: 1,
      explicitBounds: [0.1, 0.5, 1],
      bucketCounts: PER_SCRAPE.map((count: number): string => {
        return String(count * (scrape + 1));
      }),
      attributes: [],
    });
  }

  return {
    resource: {
      attributes: [{ key: "service.name", value: { stringValue: "checkout" } }],
    },
    scopeMetrics: [
      {
        metrics: [
          {
            name: "latency_otlp",
            histogram: { aggregationTemporality: 2, dataPoints: dataPoints },
          },
        ],
      },
    ],
  };
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

let ingested: Array<JSONObject> = [];

// The real metrics ingest, with discovery, service resolution and rule loads replaced.
function stubIngestLookups(): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const service: Record<string, any> =
    OtelMetricsIngestService as unknown as Record<string, any>;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  for (const method of Object.getOwnPropertyNames(OtelIngestBaseService)) {
    if (
      method.startsWith("autoDiscover") &&
      typeof baseService[method] === "function"
    ) {
      jest.spyOn(service, method).mockResolvedValue(null as never);
    }
  }

  const serviceId: ObjectID = ObjectID.generate();

  jest
    .spyOn(service, "resolveTelemetryResource")
    .mockImplementation((async (): Promise<TelemetryServiceMetadata> => {
      return {
        serviceName: "checkout",
        primaryEntityId: serviceId,
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      } as unknown as TelemetryServiceMetadata;
    }) as never);
  jest
    .spyOn(service, "runBatchHostEnrichment")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MetricPipelineRuleService, "loadRules")
    .mockResolvedValue({ projectRules: [], rulesByServiceId: new Map() });
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined as never);
  jest.spyOn(TelemetryFanInWriter, "submit").mockImplementation((async (
    target: FanInInsertTarget,
    batch: Array<JSONObject>,
  ) => {
    if ((target as unknown) === MetricService) {
      ingested.push(...batch);
    }
    return { flushed: Promise.resolve() };
  }) as never);
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
): Promise<void> {
  const model: AnalyticsBaseModel = new Metric();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: Metric as unknown as { new (): AnalyticsBaseModel },
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

integration(
  "Prometheus remote write, stored and read back, against ClickHouse",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    let original:
      | {
          database: ClickhouseDatabase;
          databaseClient: ClickhouseClient | null;
          ingestDatabase: ClickhouseDatabase;
          ingestDatabaseClient: ClickhouseClient | null;
        }
      | undefined;
    const translations: Array<PrometheusTranslation> = [];

    async function ingestAndStore(
      resourceMetrics: Array<JSONObject>,
    ): Promise<void> {
      ingested = [];

      await OtelMetricsIngestService.processMetricsFromQueue({
        projectId: PROJECT_ID,
        body: { resourceMetrics },
        headers: {},
      } as unknown as TelemetryRequest);

      if (ingested.length > 0) {
        await client.insert({
          table: `${database}.${new Metric().tableName}`,
          values: ingested,
          format: "JSONEachRow",
        });
      }
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

      original = {
        database: MetricService.database,
        databaseClient: MetricService.databaseClient,
        ingestDatabase: MetricService.ingestDatabase,
        ingestDatabaseClient: MetricService.ingestDatabaseClient,
      };
      MetricService.database = clickhouse;
      MetricService.databaseClient = client;
      MetricService.ingestDatabase = clickhouse;
      MetricService.ingestDatabaseClient = client;

      stubIngestLookups();

      // What the endpoint does with each body: snappy, decode, translate.
      for (const body of remoteWriteRequests()) {
        const translation: PrometheusTranslation = PrometheusRemoteWrite.toOtlp(
          PrometheusRemoteWrite.decode(
            SnappyBlock.decompress(body, 32 * 1024 * 1024),
            PrometheusRemoteWriteVersion.V1,
          ),
        );
        translations.push(translation);
        await ingestAndStore(
          translation.metrics!["resourceMetrics"] as Array<JSONObject>,
        );
      }

      await ingestAndStore([otlpHistogram()]);
    });

    afterAll(async (): Promise<void> => {
      jest.restoreAllMocks();

      if (original) {
        MetricService.database = original.database;
        MetricService.databaseClient = original.databaseClient;
        MetricService.ingestDatabase = original.ingestDatabase;
        MetricService.ingestDatabaseClient = original.ingestDatabaseClient;
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
        await client.close();
      }
    });

    async function rows(query: string): Promise<Array<JSONObject>> {
      const result: { json: <T>() => Promise<T> } = (await client.query({
        query: query,
        format: "JSONEachRow",
      })) as unknown as { json: <T>() => Promise<T> };

      return await result.json<Array<JSONObject>>();
    }

    async function percentiles(data: {
      name: string;
      aggregationType: AggregationType;
      attributes?: Record<string, string> | undefined;
    }): Promise<Array<number>> {
      const since: Date = new Date(FIRST_SCRAPE_MS);
      const until: Date = new Date(LAST_SCRAPE_MS + 1000);
      const result: AggregatedResult = await MetricService.aggregateBy({
        query: {
          projectId: PROJECT_ID,
          name: data.name,
          time: new InBetween<Date>(since, until),
          ...(data.attributes ? { attributes: data.attributes } : {}),
        } as never,
        aggregationType: data.aggregationType,
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "time",
        aggregationInterval: AggregationInterval.Minute,
        startTimestamp: since,
        endTimestamp: until,
        limit: 1000,
        skip: 0,
        sort: { time: SortOrder.Ascending } as never,
        props: { isRoot: true },
      });

      return result.data.map((row: AggregatedModel): number => {
        return Number(row.value);
      });
    }

    async function vectorAt(
      query: string,
      timeMs: number,
    ): Promise<Array<PromQLVectorResultSample>> {
      const result: PromQLQueryResult = await new PromQLEngine(
        new PromQLMetricSeriesSource({
          projectId: PROJECT_ID,
          serviceFilter: {},
          listStoredNames: async (): Promise<Array<string>> => {
            return ["http_requests_total", "latency_seconds_bucket"];
          },
        }),
      ).instantQuery(query, timeMs);

      expect(result.resultType).toBe(PromQLResultType.Vector);

      return result.resultType === PromQLResultType.Vector
        ? result.samples
        : [];
    }

    test("every sample is stored, under its Prometheus name, with job and instance as its service", async () => {
      const stored: Array<JSONObject> = await rows(
        `SELECT name, metricPointType, count() AS points, any(attributes['resource.service.name']) AS service FROM ${database}.${new Metric().tableName} GROUP BY name, metricPointType ORDER BY name`,
      );

      // A UInt64 may come back as a number or a string.
      expect(
        stored.map((row: JSONObject) => {
          return { ...row, points: Number(row["points"]) };
        }),
      ).toEqual([
        {
          name: "http_requests_total",
          metricPointType: "Sum",
          points: SCRAPES,
          service: "checkout",
        },
        {
          name: "latency_otlp",
          metricPointType: "Histogram",
          points: SCRAPES,
          service: "checkout",
        },
        {
          name: "latency_seconds_bucket",
          metricPointType: "Sum",
          points: SCRAPES * BOUNDS.length,
          service: "checkout",
        },
      ]);
    });

    test("rate() of the counter answers what Prometheus answers", async () => {
      // 2 more every 15s: 2/15 a second, the window filled to its edges.
      const samples: Array<PromQLVectorResultSample> = await vectorAt(
        "rate(http_requests_total[5m])",
        LAST_SCRAPE_MS,
      );

      expect(samples).toHaveLength(1);
      expect(samples[0]!.value).toBeCloseTo(2 / 15, 9);
      expect(samples[0]!.labels["job"]).toBe("checkout");
      expect(samples[0]!.labels["instance"]).toBe("10.0.0.7:9090");
    });

    test("histogram_quantile reads the buckets, though they arrived in two requests", async () => {
      // 95% of 10 is 9.5: in (0.5, 1], 1.5 of its 2 in: 0.5 + 0.5 * 0.75.
      const samples: Array<PromQLVectorResultSample> = await vectorAt(
        "histogram_quantile(0.95, sum by (le) (rate(latency_seconds_bucket[5m])))",
        LAST_SCRAPE_MS,
      );

      expect(samples).toHaveLength(1);
      expect(samples[0]!.value).toBeCloseTo(0.875, 9);
    });

    test("a filter on the series' labels is read before its scrapes are grouped", async () => {
      expect(
        await percentiles({
          name: "latency_seconds_bucket",
          aggregationType: AggregationType.P95,
          attributes: { job: "checkout" },
        }),
      ).toEqual(
        await percentiles({
          name: "latency_seconds_bucket",
          aggregationType: AggregationType.P95,
        }),
      );
      expect(
        await percentiles({
          name: "latency_seconds_bucket",
          aggregationType: AggregationType.P95,
          attributes: { job: "billing" },
        }),
      ).toEqual([]);
    });

    test.each<[AggregationType, number]>([
      [AggregationType.P50, 0.05],
      [AggregationType.P75, 0.3],
      [AggregationType.P95, 0.75],
      [AggregationType.P99, 0.75],
    ])(
      "the Metrics explorer charts %s of the _bucket series as of the same histogram sent over OTLP",
      async (aggregationType: AggregationType, expected: number) => {
        const classic: Array<number> = await percentiles({
          name: "latency_seconds_bucket",
          aggregationType: aggregationType,
        });
        const otlp: Array<number> = await percentiles({
          name: "latency_otlp",
          aggregationType: aggregationType,
        });

        // Ten minutes of scrapes.
        expect(classic.length).toBeGreaterThanOrEqual(10);
        expect(classic).toEqual(otlp);
        expect(Array.from(new Set(classic))).toEqual([expected]);
      },
    );

    test("grouped by a label, over the whole window, and ranked Top-K, the same histogram answers", async () => {
      const since: Date = new Date(FIRST_SCRAPE_MS);
      const until: Date = new Date(LAST_SCRAPE_MS + 1000);
      const result: AggregatedResult = await MetricService.aggregateBy({
        query: {
          projectId: PROJECT_ID,
          name: "latency_seconds_bucket",
          time: new InBetween<Date>(since, until),
        } as never,
        aggregationType: AggregationType.P95,
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "time",
        aggregationInterval: AggregationInterval.Total,
        groupByAttributeKeys: ["job"],
        topK: { count: 5, rankBy: "max" },
        startTimestamp: since,
        endTimestamp: until,
        limit: 1000,
        skip: 0,
        sort: { time: SortOrder.Ascending } as never,
        props: { isRoot: true },
      });

      expect(
        result.data.map((row: AggregatedModel) => {
          return {
            job: (row["attributes"] as JSONObject)["job"],
            value: Number(row.value),
          };
        }),
      ).toEqual([{ job: "checkout", value: 0.75 }]);
    });

    test("an average of the _bucket series is still the average of its values", async () => {
      // An attribute filter keeps it on the table (this database has no rollups).
      const averages: Array<number> = await percentiles({
        name: "latency_seconds_bucket",
        aggregationType: AggregationType.Avg,
        attributes: { job: "checkout" },
      });

      expect(averages.length).toBeGreaterThanOrEqual(10);
      // Not a latency: the cumulative counts' own average.
      expect(averages[0]!).toBeGreaterThan(1);
    });

    test("the exemplar links exactly its bucket's datapoint, at its scrape, to its trace and span", async () => {
      expect(
        translations.reduce(
          (sum: number, translation: PrometheusTranslation) => {
            return sum + translation.exemplarsWritten;
          },
          0,
        ),
      ).toBe(1);

      const linked: Array<JSONObject> = await rows(
        `SELECT attributes['le'] AS le, toUnixTimestamp64Milli(time) AS timeMs, traceId, spanId FROM ${database}.${new Metric().tableName} WHERE name = 'latency_seconds_bucket' AND traceId != ''`,
      );

      expect(
        linked.map((row: JSONObject) => {
          return { ...row, timeMs: Number(row["timeMs"]) };
        }),
      ).toEqual([
        {
          le: "0.5",
          timeMs: scrapeTime(EXEMPLAR_SCRAPE),
          traceId: TRACE_ID,
          spanId: SPAN_ID,
        },
      ]);
    });
  },
);

describe("The remote write ClickHouse suite's wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
