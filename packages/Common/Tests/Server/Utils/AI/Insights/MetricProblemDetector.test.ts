import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import MetricAggregationService, {
  MetricAttributeCardinalityRequest,
  MetricAttributeCardinalityRow,
  MetricHourRequest,
  MetricNamePatternRequest,
  MetricShapeRow,
  MetricWindowRequest,
} from "../../../../../Server/Services/MetricAggregationService";
import MetricTypeService from "../../../../../Server/Services/MetricTypeService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TraceAggregationService, {
  ServiceSpanHealthRow,
  TraceAnalyticsRequest,
  TraceAnalyticsTableRow,
} from "../../../../../Server/Services/TraceAggregationService";
import InsightDetectors from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/Index";
import MetricProblemDetector, {
  METRIC_INSIGHT_MAX_VOLUME_ROWS,
  MetricHighCardinalityDetector,
  MetricHistogramBucketsDetector,
  MetricMissingMetricsDetector,
} from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/MetricProblemDetector";
import {
  InsightCandidate,
  InsightDetector,
  InsightScanContext,
} from "../../../../../Server/Utils/AI/SRE/Insights/Types";
import LlmConversationPrivacy from "../../../../../Server/Utils/LlmObservability/LlmConversationPrivacy";
import MetricType from "../../../../../Models/DatabaseModels/MetricType";
import Service from "../../../../../Models/DatabaseModels/Service";
import AIInsightSeverity from "../../../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import { MetricInsightEvidence } from "../../../../../Types/AI/AIInsightEvidence";
import { TelemetryAiLane } from "../../../../../Types/AI/TelemetryAi";
import IncludesAnyOfGroups from "../../../../../Types/BaseDatabase/IncludesAnyOfGroups";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  MetricBucketProblem,
  MetricCardinalityShape,
  MetricInsightKind,
  MetricNamePatternReading,
  MetricValueShape,
  MetricVolumeReading,
  OTEL_DEFAULT_HISTOGRAM_BOUNDS,
} from "../../../../../Utils/Metrics/MetricInsight";

/*
 * Metrics' look (MetricProblemDetector): once an hour, every metric of the
 * hour that ended from the hourly rollup, then - for the ten busiest of the
 * project's own services' - how many values each attribute their code sets
 * took and what their data points are, the metric names with ids in them,
 * and the busy services that never sent a metric. One look per scan, shared
 * by the lane's three detectors; each part read on its own.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5231aaaa-0000-4000-8000-000000000001",
);
const CHECKOUT: string = "5231aaaa-0000-4000-8000-000000000002";
const REPORTING: string = "5231aaaa-0000-4000-8000-000000000003";
const EDGE: string = "5231aaaa-0000-4000-8000-000000000004";
const PAYMENTS: string = "5231aaaa-0000-4000-8000-000000000005";
const SEARCH: string = "5231aaaa-0000-4000-8000-000000000007";
// A host's id: metrics are sent for hosts too, and a host is no service.
const HOST: string = "5231aaaa-0000-4000-8000-000000000006";
const NOW: Date = new Date("2026-10-24T09:00:04.000Z");
const WINDOW_START: string = "2026-10-24T08:00:00.000Z";
const WINDOW_END: string = "2026-10-24T09:00:00.000Z";

function uuid(index: number): string {
  return `6f1c2d3e-4a5b-4c6d-8e7f-${index.toString(16).padStart(12, "0")}`;
}

const USER_IDS: Array<string> = Array.from(
  { length: 100 },
  (_value: unknown, index: number): string => {
    return uuid(index);
  },
);

function volume(
  metricName: string,
  serviceId: string,
  dataPointCount: number,
): MetricVolumeReading {
  return { metricName, serviceId, dataPointCount };
}

function attributeRow(
  metricName: string,
  serviceId: string,
  key: string,
  valueCount: number,
  sampleValues: Array<string> = [],
): MetricAttributeCardinalityRow {
  return { metricName, serviceId, key, valueCount, sampleValues };
}

function shapeRow(
  metricName: string,
  serviceId: string,
  overrides: Partial<MetricShapeRow> = {},
): MetricShapeRow {
  return {
    metricName,
    serviceId,
    pointType: "Sum",
    temporality: "Delta",
    bounds: [],
    bucketCounts: [],
    countSum: 0,
    countMax: 0,
    minValue: null,
    maxValue: null,
    dataPointCount: 900,
    overflowDataPointCount: 0,
    ...overrides,
  };
}

/*
 * Request durations recorded in seconds into the SDKs' default buckets, made
 * for milliseconds: 1,900 of 2,000 values in (0, 5].
 */
function secondsInMillisecondBuckets(
  metricName: string,
  serviceId: string,
): MetricShapeRow {
  return shapeRow(metricName, serviceId, {
    pointType: "Histogram",
    bounds: [...OTEL_DEFAULT_HISTOGRAM_BOUNDS],
    bucketCounts: [0, 1900, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    countSum: 2000,
    countMax: 40,
    minValue: 0.012,
    maxValue: 4.8,
    dataPointCount: 60,
  });
}

function healthRow(
  serviceId: string,
  spanCount: number,
  failedSpanCount: number = 0,
): ServiceSpanHealthRow {
  return {
    primaryEntityId: serviceId,
    spanCount,
    failedSpanCount,
    rootSpanCount: Math.round(spanCount / 4),
  };
}

function operationRow(name: string, count: number): TraceAnalyticsTableRow {
  return {
    groupValues: { name },
    count,
    errorCount: 0,
    avgDurationMs: 30,
    p50DurationMs: 20,
    p90DurationMs: 60,
    p95DurationMs: 80,
    p99DurationMs: 120,
    minDurationMs: 1,
    maxDurationMs: 400,
  };
}

function service(id: string, name: string, sdkLanguage?: string): Service {
  const row: Service = new Service();
  row.id = new ObjectID(id);
  row.name = name;

  if (sdkLanguage) {
    row.telemetrySdkLanguage = sdkLanguage;
  }

  return row;
}

function metricType(name: string, unit: string): MetricType {
  const row: MetricType = new MetricType();
  row.name = name;
  row.unit = unit;
  return row;
}

function types(found: Array<InsightCandidate>): Array<string> {
  return found.map((candidate: InsightCandidate): string => {
    return `${candidate.insightType} ${candidate.serviceName}`;
  });
}

describe("MetricProblemDetector", () => {
  let volumes: Array<MetricVolumeReading>;
  let patterns: Array<MetricNamePatternReading>;
  let shapes: Array<MetricShapeRow>;
  let attributes: Array<MetricAttributeCardinalityRow>;
  let healthRows: Array<ServiceSpanHealthRow>;
  let operations: Map<string, Array<TraceAnalyticsTableRow>>;
  let services: Array<Service>;
  let units: Array<MetricType>;
  // The services the metric catalog records a metric from.
  let catalogServices: Set<string>;
  let catalogFails: boolean;
  let unitsFail: boolean;
  let restricted: Array<string>;
  let readVolumes: SpyInstance<
    typeof MetricAggregationService.getHourlyMetricVolumes
  >;
  let readPatterns: SpyInstance<
    typeof MetricAggregationService.getMetricNamePatterns
  >;
  let readShapes: SpyInstance<typeof MetricAggregationService.getMetricShapes>;
  let readAttributes: SpyInstance<
    typeof MetricAggregationService.getMetricAttributeCardinality
  >;
  let readHealth: SpyInstance<
    typeof TraceAggregationService.getServiceSpanHealth
  >;
  let readTable: SpyInstance<typeof TraceAggregationService.getAnalyticsTable>;
  let readServiceRows: SpyInstance<typeof ServiceService.findBy>;
  let readCatalog: SpyInstance<typeof MetricTypeService.findBy>;
  // The services the catalog was asked about, in order.
  let catalogAsked: Array<string>;

  function context(): InsightScanContext {
    return { projectId: PROJECT_ID, now: NOW };
  }

  beforeEach(() => {
    volumes = [];
    patterns = [];
    shapes = [];
    attributes = [];
    healthRows = [];
    operations = new Map();
    services = [
      service(CHECKOUT, "checkout"),
      service(REPORTING, "reporting"),
      service(EDGE, "edge"),
      service(PAYMENTS, "payments", "nodejs"),
      service(SEARCH, "search"),
    ];
    units = [];
    catalogServices = new Set();
    catalogFails = false;
    unitsFail = false;
    restricted = [];
    catalogAsked = [];

    jest
      .spyOn(LlmConversationPrivacy, "getRestrictedServiceIds")
      .mockImplementation(async () => {
        return restricted;
      });
    readVolumes = jest
      .spyOn(MetricAggregationService, "getHourlyMetricVolumes")
      .mockImplementation(async () => {
        return volumes;
      });
    readPatterns = jest
      .spyOn(MetricAggregationService, "getMetricNamePatterns")
      .mockImplementation(async () => {
        return patterns;
      });
    readShapes = jest
      .spyOn(MetricAggregationService, "getMetricShapes")
      .mockImplementation(async () => {
        return shapes;
      });
    readAttributes = jest
      .spyOn(MetricAggregationService, "getMetricAttributeCardinality")
      .mockImplementation(async () => {
        return attributes;
      });
    readHealth = jest
      .spyOn(TraceAggregationService, "getServiceSpanHealth")
      .mockImplementation(async () => {
        return healthRows;
      });
    readTable = jest
      .spyOn(TraceAggregationService, "getAnalyticsTable")
      .mockImplementation(async (request: TraceAnalyticsRequest) => {
        return (
          operations.get(
            request.serviceIds?.[0]?.toString().toLowerCase() || "",
          ) || []
        );
      });
    readServiceRows = jest
      .spyOn(ServiceService, "findBy")
      .mockImplementation(async () => {
        return services;
      });
    readCatalog = jest
      .spyOn(MetricTypeService, "findBy")
      .mockImplementation(async (data: { query: unknown }) => {
        const query: JSONObject = data.query as JSONObject;

        if (query["services"] instanceof IncludesAnyOfGroups) {
          const serviceId: string = (query["services"] as IncludesAnyOfGroups)
            .groups[0]![0]!;

          catalogAsked.push(serviceId);

          if (catalogFails) {
            throw new Error("the catalog is down");
          }

          return catalogServices.has(serviceId)
            ? [metricType("http.server.duration", "s")]
            : [];
        }

        if (unitsFail) {
          throw new Error("the catalog is down");
        }

        return units;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // checkout's request counter, with its users' ids on it.
  function userIdsOnCheckout(valueCount: number = 12000): void {
    volumes = [volume("http.server.request.count", CHECKOUT, 48000)];
    attributes = [
      attributeRow(
        "http.server.request.count",
        CHECKOUT,
        "user.id",
        valueCount,
        USER_IDS,
      ),
      attributeRow(
        "http.server.request.count",
        CHECKOUT,
        "session.id",
        4000,
        USER_IDS,
      ),
    ];
    shapes = [shapeRow("http.server.request.count", CHECKOUT)];
    units = [metricType("http.server.request.count", "{request}")];
  }

  test("a metric whose code puts its users' ids on it: one high-cardinality finding, with no id kept", async () => {
    userIdsOnCheckout();

    const found: Array<InsightCandidate> =
      await MetricProblemDetector.look(context());

    expect(found).toHaveLength(1);

    const candidate: InsightCandidate = found[0]!;

    expect(candidate.insightType).toBe(AIInsightType.MetricHighCardinality);
    expect(candidate.fingerprint).toBe(
      `metric-high-cardinality:${CHECKOUT}:attribute:http.server.request.count`,
    );
    expect(candidate.title).toBe(
      "http.server.request.count in checkout records 12,000 different user.id values an hour",
    );
    expect(candidate.severity).toBe(AIInsightSeverity.High);
    expect(candidate.serviceName).toBe("checkout");
    expect(candidate.telemetryServiceId?.toString()).toBe(CHECKOUT);
    expect(candidate.metricName).toBe("http.server.request.count");
    expect(candidate.evidence.metric).toEqual({
      serviceId: CHECKOUT,
      kind: MetricInsightKind.HighCardinality,
      shape: MetricCardinalityShape.Attribute,
      windowStartTime: WINDOW_START,
      windowEndTime: WINDOW_END,
      metricName: "http.server.request.count",
      unit: "{request}",
      dataPointCount: 48000,
      attributeKey: "user.id",
      attributeValueCount: 12000,
      valueShape: MetricValueShape.Uuid,
      otherAttributes: [{ key: "session.id", valueCount: 4000 }],
    });
    expect(candidate.detailMarkdown).toContain(
      "**High-cardinality metric in checkout**",
    );

    // The values were read only to tell what they look like.
    const written: string = JSON.stringify(candidate);

    for (const value of USER_IDS) {
      expect(written).not.toContain(value);
    }
  });

  test("an attribute past the SDK's own limit: High whatever its count, and it says so", async () => {
    userIdsOnCheckout(1500);
    shapes = [
      shapeRow("http.server.request.count", CHECKOUT, {
        overflowDataPointCount: 12,
      }),
    ];

    const [candidate] = await MetricProblemDetector.look(context());

    expect(candidate!.severity).toBe(AIInsightSeverity.High);
    expect(candidate!.evidence.metric?.hasOverflow).toBe(true);
    expect(candidate!.detailMarkdown).toContain("otel.metric.overflow");
  });

  test("below 10,000 values and under the SDK's limit: Medium", async () => {
    userIdsOnCheckout(1500);

    const [candidate] = await MetricProblemDetector.look(context());

    expect(candidate!.severity).toBe(AIInsightSeverity.Medium);
    expect(candidate!.evidence.metric?.hasOverflow).toBeUndefined();
  });

  test("a histogram whose buckets were made for another unit: one bucket finding", async () => {
    volumes = [volume("http.server.duration", CHECKOUT, 2400)];
    shapes = [secondsInMillisecondBuckets("http.server.duration", CHECKOUT)];
    units = [metricType("http.server.duration", "s")];

    const found: Array<InsightCandidate> =
      await MetricProblemDetector.look(context());

    expect(found).toHaveLength(1);
    expect(found[0]!.insightType).toBe(AIInsightType.MetricHistogramBuckets);
    expect(found[0]!.fingerprint).toBe(
      `metric-histogram-buckets:${CHECKOUT}:http.server.duration`,
    );
    expect(found[0]!.title).toBe(
      "http.server.duration in checkout puts 95% of its values in its smallest bucket",
    );
    expect(found[0]!.severity).toBe(AIInsightSeverity.Medium);
    expect(found[0]!.evidence.metric).toEqual({
      serviceId: CHECKOUT,
      kind: MetricInsightKind.HistogramBuckets,
      windowStartTime: WINDOW_START,
      windowEndTime: WINDOW_END,
      metricName: "http.server.duration",
      unit: "s",
      dataPointCount: 2400,
      bucketProblem: MetricBucketProblem.BelowSmallestBucket,
      bucketShare: 95,
      valueCount: 2000,
      boundCount: 15,
      smallestBound: 5,
      largestBound: 10000,
      hasDefaultBounds: true,
      minValue: 0.012,
      maxValue: 4.8,
    });
  });

  test("a metric with both problems is one finding: its attribute first", async () => {
    userIdsOnCheckout();
    shapes = [
      secondsInMillisecondBuckets("http.server.request.count", CHECKOUT),
    ];

    const found: Array<InsightCandidate> =
      await MetricProblemDetector.look(context());

    expect(types(found)).toEqual([
      `${AIInsightType.MetricHighCardinality} checkout`,
    ]);
  });

  test("metric names with ids in them: one finding for the pattern", async () => {
    volumes = [volume("http.server.duration", CHECKOUT, 900)];
    patterns = [
      {
        serviceId: CHECKOUT,
        namePattern: "job.{id}.duration",
        nameCount: 1234,
        dataPointCount: 56000,
      },
    ];

    const found: Array<InsightCandidate> =
      await MetricProblemDetector.look(context());

    expect(found).toHaveLength(1);
    expect(found[0]!.insightType).toBe(AIInsightType.MetricHighCardinality);
    expect(found[0]!.fingerprint).toBe(
      `metric-high-cardinality:${CHECKOUT}:name:job.{id}.duration`,
    );
    expect(found[0]!.title).toBe(
      "checkout sends 1,234 metrics named like job.{id}.duration",
    );
    expect(found[0]!.severity).toBe(AIInsightSeverity.High);
    expect(found[0]!.metricName).toBeUndefined();
    expect(found[0]!.evidence.metric).toEqual({
      serviceId: CHECKOUT,
      kind: MetricInsightKind.HighCardinality,
      shape: MetricCardinalityShape.Name,
      windowStartTime: WINDOW_START,
      windowEndTime: WINDOW_END,
      namePattern: "job.{id}.duration",
      nameCount: 1234,
      dataPointCount: 56000,
    });
    // No metric was busy enough to be read closely.
    expect(readShapes).not.toHaveBeenCalled();
    expect(readAttributes).not.toHaveBeenCalled();
  });

  test("a busy service that has never sent a metric: one finding, with its busiest operations and its SDK", async () => {
    volumes = [volume("http.server.duration", CHECKOUT, 900)];
    healthRows = [healthRow(PAYMENTS, 4200, 12)];
    operations.set(PAYMENTS, [
      operationRow("GET /orders", 2000),
      operationRow("POST /checkout", 900),
      operationRow("", 5),
    ]);

    const found: Array<InsightCandidate> =
      await MetricProblemDetector.look(context());

    expect(found).toHaveLength(1);
    expect(found[0]!.insightType).toBe(AIInsightType.MetricMissingMetrics);
    expect(found[0]!.fingerprint).toBe(`metric-missing-metrics:${PAYMENTS}`);
    expect(found[0]!.title).toBe("payments sends traces but no metrics");
    expect(found[0]!.severity).toBe(AIInsightSeverity.Low);
    expect(found[0]!.evidence.metric).toEqual({
      serviceId: PAYMENTS,
      kind: MetricInsightKind.MissingMetrics,
      windowStartTime: WINDOW_START,
      windowEndTime: WINDOW_END,
      spanCount: 4200,
      failedSpanCount: 12,
      topOperations: [
        { name: "GET /orders", spanCount: 2000 },
        { name: "POST /checkout", spanCount: 900 },
      ],
      sdkLanguage: "nodejs",
    });
    expect(catalogAsked).toEqual([PAYMENTS]);

    // Its busiest operations, over the hour, from its own spans.
    const request: TraceAnalyticsRequest = readTable.mock.calls[0]![0];

    expect(request.groupBy).toEqual(["name"]);
    expect(request.limit).toBe(5);
    expect(request.tableSort).toEqual({ column: "count", direction: "desc" });
    expect(request.serviceIds?.map(String)).toEqual([PAYMENTS]);
    expect(request.startTime.toISOString()).toBe(WINDOW_START);
    expect(request.endTime.toISOString()).toBe(WINDOW_END);
  });

  test("a service whose metrics stopped is not missing them: that is no pull request's to add", async () => {
    volumes = [volume("http.server.duration", CHECKOUT, 900)];
    healthRows = [healthRow(PAYMENTS, 4200)];
    catalogServices.add(PAYMENTS);

    expect(await MetricProblemDetector.look(context())).toEqual([]);
    expect(readTable).not.toHaveBeenCalled();
  });

  test("a catalog that cannot say files nothing as missing, and the other findings still come", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    userIdsOnCheckout();
    healthRows = [healthRow(PAYMENTS, 4200)];
    catalogFails = true;

    expect(types(await MetricProblemDetector.look(context()))).toEqual([
      `${AIInsightType.MetricHighCardinality} checkout`,
    ]);
    expect(catalogAsked).toEqual([PAYMENTS]);
  });

  test("with the hour's metrics unread, no service is said to send none", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    readVolumes.mockRejectedValue(new Error("too slow"));
    healthRows = [healthRow(PAYMENTS, 4200)];
    patterns = [
      {
        serviceId: CHECKOUT,
        namePattern: "job.{id}.duration",
        nameCount: 80,
        dataPointCount: 900,
      },
    ];

    // The names were read on their own, and still find theirs.
    expect(types(await MetricProblemDetector.look(context()))).toEqual([
      `${AIInsightType.MetricHighCardinality} checkout`,
    ]);
    expect(catalogAsked).toEqual([]);
  });

  test("with the hour's spans unread, no service is said to send none", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    readHealth.mockRejectedValue(new Error("too slow"));
    userIdsOnCheckout();

    expect(types(await MetricProblemDetector.look(context()))).toEqual([
      `${AIInsightType.MetricHighCardinality} checkout`,
    ]);
    expect(catalogAsked).toEqual([]);
  });

  test("a service that sent data points in the hour, however few, or names with ids, is not asked about", async () => {
    volumes = [
      volume("http.server.duration", CHECKOUT, 900),
      volume("queue.depth", PAYMENTS, 3),
    ];
    patterns = [
      {
        serviceId: EDGE,
        namePattern: "cache.{id}.hits",
        nameCount: 10,
        dataPointCount: 40,
      },
    ];
    healthRows = [healthRow(PAYMENTS, 4200), healthRow(EDGE, 9000)];

    expect(await MetricProblemDetector.look(context())).toEqual([]);
    expect(catalogAsked).toEqual([]);
  });

  test("three services missing their metrics at most, the busiest first", async () => {
    volumes = [volume("http.server.duration", HOST, 900)];
    healthRows = [
      healthRow(CHECKOUT, 1500),
      healthRow(REPORTING, 9000),
      healthRow(EDGE, 4000),
      healthRow(PAYMENTS, 1000),
      healthRow(SEARCH, 999),
    ];

    const found: Array<InsightCandidate> =
      await MetricProblemDetector.look(context());

    expect(types(found)).toEqual([
      `${AIInsightType.MetricMissingMetrics} reporting`,
      `${AIInsightType.MetricMissingMetrics} edge`,
      `${AIInsightType.MetricMissingMetrics} checkout`,
    ]);
    expect(catalogAsked).toEqual([REPORTING, EDGE, CHECKOUT]);
  });

  test("two findings a service at most, the busiest metrics' first", async () => {
    volumes = [
      volume("a.requests", CHECKOUT, 9000),
      volume("b.requests", CHECKOUT, 8000),
      volume("c.requests", CHECKOUT, 7000),
      volume("d.requests", REPORTING, 6000),
    ];
    attributes = ["a.requests", "b.requests", "c.requests"].map(
      (name: string): MetricAttributeCardinalityRow => {
        return attributeRow(name, CHECKOUT, "user.id", 2000, USER_IDS);
      },
    );
    attributes.push(
      attributeRow("d.requests", REPORTING, "report.id", 3000, USER_IDS),
    );
    patterns = [
      {
        serviceId: CHECKOUT,
        namePattern: "job.{id}.duration",
        nameCount: 80,
        dataPointCount: 900,
      },
    ];

    const found: Array<InsightCandidate> =
      await MetricProblemDetector.look(context());

    expect(
      found.map((candidate: InsightCandidate): string => {
        return candidate.fingerprint;
      }),
    ).toEqual([
      `metric-high-cardinality:${CHECKOUT}:attribute:a.requests`,
      `metric-high-cardinality:${CHECKOUT}:attribute:b.requests`,
      `metric-high-cardinality:${REPORTING}:attribute:d.requests`,
    ]);
  });

  test("only the project's own services' metrics are read closely: a host's are not", async () => {
    volumes = [
      volume("system.cpu.utilization", HOST, 100000),
      volume("http.server.request.count", CHECKOUT, 5000),
    ];

    await MetricProblemDetector.look(context());

    const request: MetricWindowRequest = readShapes.mock.calls[0]![0];

    expect(request.metrics).toEqual([
      { metricName: "http.server.request.count", serviceId: CHECKOUT },
    ]);
    expect(readAttributes.mock.calls[0]![0].metrics).toEqual(request.metrics);
  });

  test("an entity whose id is not one a service could have is never asked about", async () => {
    volumes = [volume("system.cpu.utilization", "not-a-service", 100000)];

    expect(await MetricProblemDetector.look(context())).toEqual([]);
    expect(readServiceRows).not.toHaveBeenCalled();
  });

  test("a company AI tool's service is never read", async () => {
    userIdsOnCheckout();
    patterns = [
      {
        serviceId: CHECKOUT,
        namePattern: "job.{id}.duration",
        nameCount: 80,
        dataPointCount: 900,
      },
    ];
    healthRows = [healthRow(CHECKOUT, 4200)];
    restricted = [CHECKOUT.toUpperCase()];

    expect(await MetricProblemDetector.look(context())).toEqual([]);
    expect(readShapes).not.toHaveBeenCalled();
    expect(catalogAsked).toEqual([]);
  });

  test("a close read that fails leaves the other to find what it finds", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    userIdsOnCheckout();
    volumes.push(volume("http.server.duration", CHECKOUT, 2400));
    shapes = [secondsInMillisecondBuckets("http.server.duration", CHECKOUT)];

    readShapes.mockRejectedValueOnce(new Error("too slow"));
    expect(types(await MetricProblemDetector.look(context()))).toEqual([
      `${AIInsightType.MetricHighCardinality} checkout`,
    ]);

    readAttributes.mockRejectedValueOnce(new Error("too slow"));
    expect(types(await MetricProblemDetector.look(context()))).toEqual([
      `${AIInsightType.MetricHistogramBuckets} checkout`,
    ]);
  });

  test("a metric's unit comes from the catalog, and a catalog that cannot say leaves it out", async () => {
    userIdsOnCheckout();
    unitsFail = true;

    const [candidate] = await MetricProblemDetector.look(context());

    expect(candidate!.evidence.metric?.unit).toBeUndefined();
    expect(candidate!.title).toBe(
      "http.server.request.count in checkout records 12,000 different user.id values an hour",
    );
  });

  test("reads the hour that ended, as root and scoped to the project", async () => {
    userIdsOnCheckout();
    healthRows = [healthRow(PAYMENTS, 4200)];

    await MetricProblemDetector.look(context());

    const hour: MetricHourRequest = readVolumes.mock.calls[0]![0];

    expect(hour.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(hour.hourStart.toISOString()).toBe(WINDOW_START);
    expect(hour.limit).toBe(METRIC_INSIGHT_MAX_VOLUME_ROWS);

    const names: MetricNamePatternRequest = readPatterns.mock.calls[0]![0];

    expect(names.hourStart.toISOString()).toBe(WINDOW_START);
    expect(names.minNameCount).toBe(50);
    expect(names.limit).toBe(20);

    const spans: JSONObject = readHealth.mock
      .calls[0]![0] as unknown as JSONObject;

    expect((spans["startTime"] as Date).toISOString()).toBe(WINDOW_START);
    expect((spans["endTime"] as Date).toISOString()).toBe(WINDOW_END);
    expect(spans["limit"]).toBe(200);

    const close: MetricAttributeCardinalityRequest =
      readAttributes.mock.calls[0]![0];

    expect(close.startTime.toISOString()).toBe(WINDOW_START);
    expect(close.endTime.toISOString()).toBe(WINDOW_END);
    expect(close.minValueCount).toBe(1000);
    expect(close.sampleSize).toBe(100);

    for (const call of [
      ...readServiceRows.mock.calls,
      ...readCatalog.mock.calls,
    ]) {
      const read: JSONObject = call[0] as unknown as JSONObject;

      expect(read["props"]).toEqual({ isRoot: true });
      expect(String((read["query"] as JSONObject)["projectId"])).toBe(
        PROJECT_ID.toString(),
      );
    }
  });

  test("nothing busy enough: nothing is read past the hour's rollup", async () => {
    volumes = [volume("http.server.request.count", CHECKOUT, 999)];
    healthRows = [healthRow(PAYMENTS, 999)];

    expect(await MetricProblemDetector.look(context())).toEqual([]);
    expect(readShapes).not.toHaveBeenCalled();
    expect(readTable).not.toHaveBeenCalled();
  });

  test("a look that fails finds nothing, and never throws", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest
      .spyOn(LlmConversationPrivacy, "getRestrictedServiceIds")
      .mockRejectedValue(new Error("Postgres is down"));

    await expect(MetricProblemDetector.look(context())).resolves.toEqual([]);
  });

  test("the lane's three detectors share one look per scan, each with its own kind", async () => {
    userIdsOnCheckout();
    volumes.push(volume("http.server.duration", REPORTING, 2400));
    shapes.push(secondsInMillisecondBuckets("http.server.duration", REPORTING));
    healthRows = [healthRow(PAYMENTS, 4200)];

    const scan: InsightScanContext = context();
    const detectors: Array<InsightDetector> =
      InsightDetectors.getTelemetryAiDetectors(TelemetryAiLane.Metric);

    expect(
      detectors.map((detector: InsightDetector): AIInsightType => {
        return detector.insightType;
      }),
    ).toEqual([
      AIInsightType.MetricHighCardinality,
      AIInsightType.MetricHistogramBuckets,
      AIInsightType.MetricMissingMetrics,
    ]);

    expect(
      types(await new MetricHighCardinalityDetector().detect(scan)),
    ).toEqual([`${AIInsightType.MetricHighCardinality} checkout`]);
    expect(
      types(await new MetricHistogramBucketsDetector().detect(scan)),
    ).toEqual([`${AIInsightType.MetricHistogramBuckets} reporting`]);
    expect(
      types(await new MetricMissingMetricsDetector().detect(scan)),
    ).toEqual([`${AIInsightType.MetricMissingMetrics} payments`]);

    // One look for the three: the rollup was read once.
    expect(readVolumes).toHaveBeenCalledTimes(1);

    // A new scan looks again.
    await new MetricHighCardinalityDetector().detect(context());
    expect(readVolumes).toHaveBeenCalledTimes(2);
  });
});

describe("MetricProblemDetector - the evidence it writes", () => {
  const window: { startTime: Date; endTime: Date } = {
    startTime: new Date(WINDOW_START),
    endTime: new Date(WINDOW_END),
  };

  test("a histogram's values are kept only when they hold together", () => {
    const evidence: (
      minValue: number | null,
      maxValue: number | null,
    ) => MetricInsightEvidence = (
      minValue: number | null,
      maxValue: number | null,
    ): MetricInsightEvidence => {
      return MetricProblemDetector.toHistogramEvidence({
        metric: volume("http.server.duration", CHECKOUT.toUpperCase(), 2400),
        window,
        shape: {
          ...secondsInMillisecondBuckets("http.server.duration", CHECKOUT),
          minValue,
          maxValue,
        },
        reading: {
          problem: MetricBucketProblem.BelowSmallestBucket,
          share: 95,
          valueCount: 2000,
          boundCount: 15,
          smallestBound: 5,
          largestBound: 10000,
          hasDefaultBounds: false,
        },
      });
    };

    expect(evidence(0.012, 4.8)).toMatchObject({
      serviceId: CHECKOUT,
      minValue: 0.012,
      maxValue: 4.8,
    });
    expect(evidence(5, 1).minValue).toBeUndefined();
    expect(evidence(null, 4.8).maxValue).toBeUndefined();
    expect(evidence(0.012, 4.8).hasDefaultBounds).toBeUndefined();
    expect(evidence(0.012, 4.8).unit).toBeUndefined();
  });

  test("a service's five busiest operations, named", () => {
    const evidence: MetricInsightEvidence =
      MetricProblemDetector.toMissingMetricsEvidence({
        traffic: { serviceId: PAYMENTS, spanCount: 9000, failedSpanCount: 0 },
        window,
        operations: [
          operationRow("", 9),
          ...["a", "b", "c", "d", "e", "f"].map(
            (name: string, index: number): TraceAnalyticsTableRow => {
              return operationRow(`GET /${name}`, 1000 - index);
            },
          ),
        ],
      });

    expect(evidence.topOperations).toEqual([
      { name: "GET /a", spanCount: 1000 },
      { name: "GET /b", spanCount: 999 },
      { name: "GET /c", spanCount: 998 },
      { name: "GET /d", spanCount: 997 },
      { name: "GET /e", spanCount: 996 },
    ]);
    expect(evidence.sdkLanguage).toBeUndefined();
    expect(
      MetricProblemDetector.toMissingMetricsEvidence({
        traffic: { serviceId: PAYMENTS, spanCount: 9000, failedSpanCount: 0 },
        window,
        operations: [],
      }).topOperations,
    ).toBeUndefined();
  });

  test("a service's or a metric's text is written into the detail escaped", () => {
    const detail: string = MetricProblemDetector.buildDetail({
      serviceName: "check*out",
      evidence: {
        serviceId: CHECKOUT,
        kind: MetricInsightKind.HighCardinality,
        shape: MetricCardinalityShape.Attribute,
        windowStartTime: WINDOW_START,
        windowEndTime: WINDOW_END,
        metricName: "![x](https://example.com/p.png)",
        attributeKey: "`user`",
        attributeValueCount: 2000,
        valueShape: MetricValueShape.Uuid,
      },
    }).toString();

    expect(detail).toContain("**High-cardinality metric in check\\*out**");
    // A metric's name is code: never an image the detail would load.
    expect(detail).toContain("- Metric: `![x](https://example.com/p.png)`");
    expect(detail).toContain("- Attribute: `` `user` ``");
  });
});
