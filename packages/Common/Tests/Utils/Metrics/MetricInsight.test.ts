/*
 * The gates Metrics' AI section files its findings by (Utils/Metrics/
 * MetricInsight): which metrics are read closely, when an attribute or a
 * service's metric names hold too many values, when a histogram's buckets
 * cannot tell its values apart, which busy services send no metrics, and
 * what each finding is called, how severe it is, what a person reads on it
 * and what OneUptime asks the AI for it. Every pattern here reads text a
 * service sent, so each is timed on the worst text of its kind.
 */

import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../Types/AI/AIInsightType";
import { MetricInsightEvidence } from "../../../Types/AI/AIInsightEvidence";
import {
  METRIC_INSIGHT_DOMINANT_SHAPE_SHARE,
  METRIC_INSIGHT_FINGERPRINT_PREFIXES,
  METRIC_INSIGHT_HIGH_ATTRIBUTE_VALUES,
  METRIC_INSIGHT_HIGH_NAME_VARIANTS,
  METRIC_INSIGHT_IGNORED_ATTRIBUTE_PREFIXES,
  METRIC_INSIGHT_MAX_FINDINGS_PER_SERVICE,
  METRIC_INSIGHT_MAX_MISSING_METRICS_SERVICES,
  METRIC_INSIGHT_MAX_NAME_PATTERNS,
  METRIC_INSIGHT_MAX_OTHER_ATTRIBUTES,
  METRIC_INSIGHT_MAX_VALUE_LENGTH,
  METRIC_INSIGHT_METRICS_READ,
  METRIC_INSIGHT_MIN_ATTRIBUTE_VALUES,
  METRIC_INSIGHT_MIN_BUCKET_SHARE,
  METRIC_INSIGHT_MIN_DATA_POINTS,
  METRIC_INSIGHT_MIN_HISTOGRAM_VALUES,
  METRIC_INSIGHT_MIN_NAME_VARIANTS,
  METRIC_INSIGHT_MIN_SERVICE_SPANS,
  METRIC_INSIGHT_TOP_OPERATIONS,
  METRIC_INSIGHT_TYPE_BY_KIND,
  METRIC_INSIGHT_VALUE_SAMPLE_SIZE,
  METRIC_INSIGHT_WINDOW_MINUTES,
  METRIC_NAME_ID_PATTERN,
  METRIC_NAME_ID_PLACEHOLDER,
  MetricAttributeReading,
  MetricBucketProblem,
  MetricCardinalityShape,
  MetricHighCardinalityReading,
  MetricHistogramBucketsReading,
  MetricInsightKind,
  MetricNamePatternReading,
  MetricServiceTraffic,
  MetricShapeReading,
  MetricValueShape,
  MetricVolumeReading,
  OTEL_DEFAULT_HISTOGRAM_BOUNDS,
  OTEL_METRIC_OVERFLOW_ATTRIBUTE,
  OTEL_SECONDS_HISTOGRAM_BOUNDS,
  buildMetricFixEvidenceNote,
  buildMetricFixRequestMessage,
  buildMetricInsightDetail,
  describeMetricProblem,
  describeMetricValueShape,
  formatMetricNumber,
  formatMetricPercent,
  getDominantMetricValueShape,
  getHistogramValueCount,
  getMetricFixRequestTitle,
  getMetricInsightFingerprint,
  getMetricInsightSeverity,
  getMetricInsightTitle,
  getMetricInsightWindow,
  getMetricNamePattern,
  getMetricValueShape,
  hasMetricNameId,
  hasMetricOverflow,
  isCodeSetMetricAttribute,
  isMetricBucketProblem,
  isMetricCardinalityShape,
  isMetricInsightFingerprintOfService,
  isMetricInsightKind,
  pickExplodedNamePatterns,
  pickHistogramReading,
  pickMetricsToRead,
  pickServicesMissingMetrics,
  readHighCardinalityAttributes,
  readHistogramBuckets,
} from "../../../Utils/Metrics/MetricInsight";
import { fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";

const SERVICE_A: string = "11111111-1111-4111-8111-111111111111";
const SERVICE_B: string = "22222222-2222-4222-8222-222222222222";
const SERVICE_C: string = "33333333-3333-4333-8333-333333333333";
const SERVICE_D: string = "44444444-4444-4444-8444-444444444444";
const SERVICE_E: string = "55555555-5555-4555-8555-555555555555";
// An id with letters in it: ids are read whatever their case.
const SERVICE_F: string = "abcdef00-1111-4111-8111-111111111111";
// A host's id: metrics are sent for hosts and monitors too, not only services.
const HOST: string = "99999999-9999-4999-8999-999999999999";

const WINDOW_START: string = "2026-10-24T09:00:00.000Z";
const WINDOW_END: string = "2026-10-24T10:00:00.000Z";

// What a pattern must never hold: a number of two digits, a run of hex.
const TWO_DIGITS: RegExp = /[0-9]{2}/u;
const SIXTEEN_HEX: RegExp = /[0-9a-f]{16}/u;

// A UUID of its own for each number.
function uuid(index: number): string {
  return `6f1c2d3e-4a5b-4c6d-8e7f-${index.toString(16).padStart(12, "0")}`;
}

function volume(
  overrides: Partial<MetricVolumeReading> = {},
): MetricVolumeReading {
  return {
    metricName: "http.server.request.count",
    serviceId: SERVICE_A,
    dataPointCount: 5000,
    ...overrides,
  };
}

function namePattern(
  overrides: Partial<MetricNamePatternReading> = {},
): MetricNamePatternReading {
  return {
    serviceId: SERVICE_A,
    namePattern: "job.{id}.duration",
    nameCount: 120,
    dataPointCount: 6000,
    ...overrides,
  };
}

function attribute(
  key: string,
  valueCount: number,
  sampleValues: ReadonlyArray<string> = [],
): MetricAttributeReading {
  return { key: key, valueCount: valueCount, sampleValues: sampleValues };
}

/*
 * A histogram of an hour of request durations recorded in seconds into the
 * SDKs' default buckets, made for milliseconds: 1,900 of its 2,000 values in
 * (0, 5], its smallest bucket above zero.
 */
function histogram(
  overrides: Partial<MetricShapeReading> = {},
): MetricShapeReading {
  return {
    pointType: "Histogram",
    temporality: "Delta",
    bounds: [...OTEL_DEFAULT_HISTOGRAM_BOUNDS],
    bucketCounts: [0, 1900, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    countSum: 2000,
    countMax: 40,
    minValue: 0.012,
    maxValue: 4.8,
    dataPointCount: 60,
    overflowDataPointCount: 0,
    ...overrides,
  };
}

function traffic(
  overrides: Partial<MetricServiceTraffic> = {},
): MetricServiceTraffic {
  return {
    serviceId: SERVICE_A,
    spanCount: 4200,
    failedSpanCount: 12,
    ...overrides,
  };
}

function attributeEvidence(
  overrides: Partial<MetricInsightEvidence> = {},
): MetricInsightEvidence {
  return {
    serviceId: SERVICE_A,
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
    hasOverflow: false,
    ...overrides,
  };
}

function nameEvidence(
  overrides: Partial<MetricInsightEvidence> = {},
): MetricInsightEvidence {
  return {
    serviceId: SERVICE_A,
    kind: MetricInsightKind.HighCardinality,
    shape: MetricCardinalityShape.Name,
    windowStartTime: WINDOW_START,
    windowEndTime: WINDOW_END,
    namePattern: "job.{id}.duration",
    nameCount: 1234,
    dataPointCount: 56000,
    ...overrides,
  };
}

function histogramEvidence(
  overrides: Partial<MetricInsightEvidence> = {},
): MetricInsightEvidence {
  return {
    serviceId: SERVICE_A,
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
    ...overrides,
  };
}

function missingEvidence(
  overrides: Partial<MetricInsightEvidence> = {},
): MetricInsightEvidence {
  return {
    serviceId: SERVICE_A,
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
    ...overrides,
  };
}

describe("the gates", () => {
  test("are the numbers the docs and the settings page say", () => {
    expect(METRIC_INSIGHT_WINDOW_MINUTES).toBe(60);
    expect(METRIC_INSIGHT_METRICS_READ).toBe(10);
    expect(METRIC_INSIGHT_MIN_DATA_POINTS).toBe(1000);
    expect(METRIC_INSIGHT_MIN_ATTRIBUTE_VALUES).toBe(1000);
    expect(METRIC_INSIGHT_MIN_NAME_VARIANTS).toBe(50);
    expect(METRIC_INSIGHT_MIN_HISTOGRAM_VALUES).toBe(1000);
    expect(METRIC_INSIGHT_MIN_BUCKET_SHARE).toBe(90);
    expect(METRIC_INSIGHT_MIN_SERVICE_SPANS).toBe(1000);
    expect(METRIC_INSIGHT_MAX_MISSING_METRICS_SERVICES).toBe(3);
    expect(METRIC_INSIGHT_MAX_FINDINGS_PER_SERVICE).toBe(2);
    expect(METRIC_INSIGHT_MAX_NAME_PATTERNS).toBe(20);
    expect(METRIC_INSIGHT_TOP_OPERATIONS).toBe(5);
    expect(METRIC_INSIGHT_MAX_OTHER_ATTRIBUTES).toBe(3);
    expect(METRIC_INSIGHT_VALUE_SAMPLE_SIZE).toBe(100);
    expect(METRIC_INSIGHT_MAX_VALUE_LENGTH).toBe(200);
    expect(METRIC_INSIGHT_HIGH_ATTRIBUTE_VALUES).toBe(10000);
    expect(METRIC_INSIGHT_HIGH_NAME_VARIANTS).toBe(500);
    expect(METRIC_INSIGHT_DOMINANT_SHAPE_SHARE).toBe(0.6);
  });

  test("a High finding is ten times past its gate", () => {
    expect(METRIC_INSIGHT_HIGH_ATTRIBUTE_VALUES).toBe(
      METRIC_INSIGHT_MIN_ATTRIBUTE_VALUES * 10,
    );
    expect(METRIC_INSIGHT_HIGH_NAME_VARIANTS).toBe(
      METRIC_INSIGHT_MIN_NAME_VARIANTS * 10,
    );
  });

  test("each kind is filed as its own insight type", () => {
    expect(METRIC_INSIGHT_TYPE_BY_KIND).toEqual({
      [MetricInsightKind.HighCardinality]: AIInsightType.MetricHighCardinality,
      [MetricInsightKind.HistogramBuckets]:
        AIInsightType.MetricHistogramBuckets,
      [MetricInsightKind.MissingMetrics]: AIInsightType.MetricMissingMetrics,
    });
    expect(isMetricInsightKind("HighCardinality")).toBe(true);
    expect(isMetricInsightKind("highcardinality")).toBe(false);
    expect(isMetricInsightKind(undefined)).toBe(false);
    expect(isMetricCardinalityShape("Name")).toBe(true);
    expect(isMetricCardinalityShape("Slow")).toBe(false);
    expect(isMetricBucketProblem("NoBuckets")).toBe(true);
    expect(isMetricBucketProblem(42)).toBe(false);
  });

  test("a look reads the whole clock hour before the one it runs in", () => {
    expect(
      getMetricInsightWindow(new Date("2026-10-24T10:05:30.000Z")),
    ).toEqual({
      startTime: new Date("2026-10-24T09:00:00.000Z"),
      endTime: new Date("2026-10-24T10:00:00.000Z"),
    });
    // On the hour, the hour that just ended.
    expect(
      getMetricInsightWindow(new Date("2026-10-24T10:00:00.000Z")),
    ).toEqual({
      startTime: new Date("2026-10-24T09:00:00.000Z"),
      endTime: new Date("2026-10-24T10:00:00.000Z"),
    });
    // Past midnight, the last hour of the day before.
    expect(
      getMetricInsightWindow(new Date("2026-10-25T00:20:00.000Z")),
    ).toEqual({
      startTime: new Date("2026-10-24T23:00:00.000Z"),
      endTime: new Date("2026-10-25T00:00:00.000Z"),
    });
  });

  test("the SDKs' default buckets are milliseconds, the semantic conventions' seconds", () => {
    expect(OTEL_DEFAULT_HISTOGRAM_BOUNDS).toEqual([
      0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000,
    ]);
    expect(OTEL_SECONDS_HISTOGRAM_BOUNDS).toEqual([
      0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
    ]);
    expect(OTEL_METRIC_OVERFLOW_ATTRIBUTE).toBe("otel.metric.overflow");
  });
});

describe("which attributes are the code's", () => {
  test("not the resource's, the scope's or OneUptime's own, nor the SDK's overflow mark", () => {
    expect(METRIC_INSIGHT_IGNORED_ATTRIBUTE_PREFIXES).toEqual([
      "resource.",
      "scope.",
      "oneuptime.",
    ]);

    for (const key of [
      "user.id",
      "http.route",
      "messaging.destination.name",
      "resources",
      "scoped.thing",
    ]) {
      expect({ key, set: isCodeSetMetricAttribute(key) }).toEqual({
        key,
        set: true,
      });
    }

    for (const key of [
      "resource.service.instance.id",
      "Resource.host.name",
      "scope.name",
      "oneuptime.telemetry.service.id",
      "otel.metric.overflow",
      "OTEL.METRIC.OVERFLOW",
      "",
      "   ",
    ]) {
      expect({ key, set: isCodeSetMetricAttribute(key) }).toEqual({
        key,
        set: false,
      });
    }
  });
});

describe("metric names with ids in them", () => {
  test("collapse each id into one placeholder, in lower case", () => {
    expect(getMetricNamePattern("job.8812.duration")).toBe("job.{id}.duration");
    expect(getMetricNamePattern("Job.8812.Duration")).toBe("job.{id}.duration");
    expect(
      getMetricNamePattern(
        "tenant.6f1c2d3e-4a5b-4c6d-8e7f-001122334455.requests",
      ),
    ).toBe("tenant.{id}.requests");
    expect(getMetricNamePattern("cache.0123456789abcdef.hits")).toBe(
      "cache.{id}.hits",
    );
    expect(getMetricNamePattern("orders_2026_10_24_total")).toBe(
      "orders_{id}_{id}_{id}_total",
    );
    expect(METRIC_NAME_ID_PLACEHOLDER).toBe("{id}");
  });

  test("leave a name with no id as it is: one digit, a version or a short hex word is not an id", () => {
    for (const name of [
      "http2.server.requests",
      "api.v2.latency",
      "deadbeef.count",
      "s3.put.bytes",
      "http.server.request.duration",
    ]) {
      expect(getMetricNamePattern(name)).toBe(name);
      expect(hasMetricNameId(getMetricNamePattern(name))).toBe(false);
    }

    expect(hasMetricNameId("job.{id}.duration")).toBe(true);
    expect(hasMetricNameId("")).toBe(false);
  });

  test("read leftmost first, as ClickHouse's replaceRegexpAll reads them", () => {
    // A UUID is taken whole before its parts are read as hex or numbers.
    expect(
      getMetricNamePattern("a.00000000-0000-4000-8000-000000000000.b"),
    ).toBe("a.{id}.b");
    // Fifteen hex characters are not a hex id, but the numbers in them are.
    expect(getMetricNamePattern("x.0123456789abcde.y")).toBe("x.{id}abcde.y");
  });

  test("use only what RE2 reads as JavaScript does: classes, counts and alternation", () => {
    expect(METRIC_NAME_ID_PATTERN).not.toMatch(/\(\?|\\[1-9]|[*+?}]\?/u);
    expect(METRIC_NAME_ID_PATTERN.split("|")).toEqual([
      "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
      "[0-9a-f]{16,}",
      "[0-9]{2,}",
    ]);
  });

  test("a pattern holds no id, and reads the same read again", () => {
    const names: Array<string> = generatedTexts(3000, 7183, [
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
    ]);

    for (const name of names) {
      const pattern: string = getMetricNamePattern(name);

      expect({ name, twice: getMetricNamePattern(pattern) }).toEqual({
        name,
        twice: pattern,
      });
      expect({ name, digits: TWO_DIGITS.test(pattern) }).toEqual({
        name,
        digits: false,
      });
      expect({ name, hex: SIXTEEN_HEX.test(pattern) }).toEqual({
        name,
        hex: false,
      });
    }
  });
});

describe("what an attribute's values look like", () => {
  test("each shape, by one value", () => {
    const shapes: Array<[string, MetricValueShape]> = [
      ["42", MetricValueShape.Number],
      ["-3.5", MetricValueShape.Number],
      [uuid(7), MetricValueShape.Uuid],
      [uuid(7).toUpperCase(), MetricValueShape.Uuid],
      ["0123456789abcdef", MetricValueShape.HexId],
      ["4bf92f3577b34da6a3ce929d0e0e4736", MetricValueShape.HexId],
      ["2026-10-24T09:00:00Z", MetricValueShape.Timestamp],
      ["2026-10-24 09:00", MetricValueShape.Timestamp],
      ["ada@example.com", MetricValueShape.Email],
      [" ada@example.com ", MetricValueShape.Email],
      ["/orders/8812", MetricValueShape.UrlWithIds],
      [
        "https://shop.example.com/orders/8812/items",
        MetricValueShape.UrlWithIds,
      ],
      ["/orders/" + uuid(3), MetricValueShape.UrlWithIds],
      ["/orders", MetricValueShape.Text],
      ["/v2/orders", MetricValueShape.Text],
      ["checkout", MetricValueShape.Text],
      // Not an address: no dot after the @, two @s, nothing before it, a space.
      ["ada@localhost", MetricValueShape.Text],
      ["a@@example.com", MetricValueShape.Text],
      ["@example.com", MetricValueShape.Text],
      ["ada lovelace@example.com", MetricValueShape.Text],
    ];

    for (const [value, shape] of shapes) {
      expect({ value, shape: getMetricValueShape(value) }).toEqual({
        value,
        shape,
      });
    }
  });

  test("a value is cut before it is read", () => {
    const digits: string = "1".repeat(METRIC_INSIGHT_MAX_VALUE_LENGTH);

    // What lies past the cut is never read.
    expect(getMetricValueShape(digits + "x")).toBe(MetricValueShape.Number);
    expect(getMetricValueShape(digits.slice(1) + "x")).toBe(
      MetricValueShape.Text,
    );
  });

  test("a sample looks like the shape 60% or more of it has, else a mix", () => {
    const uuids: Array<string> = [0, 1, 2, 3, 4, 5, 6].map(uuid);

    expect(getDominantMetricValueShape([...uuids, "a", "b", "c"])).toBe(
      MetricValueShape.Uuid,
    );
    expect(
      getDominantMetricValueShape([
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "a",
        "b",
        "c",
        "d",
      ]),
    ).toBe(MetricValueShape.Number);
    expect(
      getDominantMetricValueShape([
        "1",
        "2",
        "3",
        "4",
        "5",
        "a",
        "b",
        "c",
        "d",
        "e",
      ]),
    ).toBe(MetricValueShape.Mixed);
    expect(getDominantMetricValueShape([])).toBe(MetricValueShape.Mixed);
    expect(getDominantMetricValueShape(["", "  "])).toBe(
      MetricValueShape.Mixed,
    );
  });

  test("only the first hundred values are read, and what is not text is passed over", () => {
    const texts: Array<string> = Array.from(
      { length: METRIC_INSIGHT_VALUE_SAMPLE_SIZE },
      (_value: unknown, index: number): string => {
        return `plan-${String.fromCharCode(97 + (index % 26))}`;
      },
    );
    const uuids: Array<string> = Array.from(
      { length: 1000 },
      (_value: unknown, index: number): string => {
        return uuid(index);
      },
    );

    expect(getDominantMetricValueShape([...texts, ...uuids])).toBe(
      MetricValueShape.Text,
    );
    expect(
      getDominantMetricValueShape([
        null as unknown as string,
        42 as unknown as string,
        uuid(1),
        uuid(2),
      ]),
    ).toBe(MetricValueShape.Uuid);
  });

  test("each shape is said in a phrase", () => {
    expect(
      Object.values(MetricValueShape).map((shape: MetricValueShape) => {
        return describeMetricValueShape(shape);
      }),
    ).toEqual([
      "numbers, such as ids",
      "UUIDs",
      "hex ids",
      "URLs or paths with ids in them",
      "email addresses",
      "timestamps",
      "free text",
      "a mix of kinds",
    ]);
    expect(describeMetricValueShape(undefined)).toBe("a mix of kinds");
  });
});

describe("which metrics a look reads closely", () => {
  test("the project's own services' metrics with 1,000 data points or more, busiest first", () => {
    const picked: Array<MetricVolumeReading> = pickMetricsToRead({
      readings: [
        volume({
          metricName: "http.server.request.count",
          serviceId: SERVICE_F.toUpperCase(),
          dataPointCount: 5000,
        }),
        volume({ metricName: "http.server.duration", dataPointCount: 9000 }),
        // Too few data points.
        volume({
          metricName: "queue.depth",
          serviceId: SERVICE_B,
          dataPointCount: 999,
        }),
        // A host's, not a service's.
        volume({
          metricName: "system.cpu.utilization",
          serviceId: HOST,
          dataPointCount: 100000,
        }),
        // A service whose telemetry the project keeps out of AI.
        volume({
          metricName: "orders.created",
          serviceId: SERVICE_C,
          dataPointCount: 20000,
        }),
        volume({ metricName: "", dataPointCount: 30000 }),
        volume({ metricName: "broken", dataPointCount: Number.NaN }),
        volume({
          metricName: "orders.amount",
          serviceId: SERVICE_B,
          dataPointCount: 1000,
        }),
      ],
      serviceIds: new Set([SERVICE_A, SERVICE_B, SERVICE_C, SERVICE_F]),
      excludedServiceIds: new Set([SERVICE_C]),
    });

    expect(picked).toEqual([
      volume({ metricName: "http.server.duration", dataPointCount: 9000 }),
      volume({
        metricName: "http.server.request.count",
        serviceId: SERVICE_F,
        dataPointCount: 5000,
      }),
      volume({
        metricName: "orders.amount",
        serviceId: SERVICE_B,
        dataPointCount: 1000,
      }),
    ]);
  });

  test("ten at most, ties by name and then by service", () => {
    const readings: Array<MetricVolumeReading> = [];

    for (let index: number = 11; index >= 0; index--) {
      readings.push(
        volume({
          metricName: `metric.${String(index).padStart(2, "0")}`,
          dataPointCount: 2000,
        }),
      );
    }

    readings.push(
      volume({
        metricName: "metric.00",
        serviceId: SERVICE_B,
        dataPointCount: 2000,
      }),
    );

    const picked: Array<MetricVolumeReading> = pickMetricsToRead({
      readings,
      serviceIds: new Set([SERVICE_A, SERVICE_B]),
    });

    expect(picked).toHaveLength(METRIC_INSIGHT_METRICS_READ);
    expect(
      picked.map((reading: MetricVolumeReading): string => {
        return `${reading.metricName} ${reading.serviceId.slice(0, 1)}`;
      }),
    ).toEqual([
      "metric.00 1",
      "metric.00 2",
      "metric.01 1",
      "metric.02 1",
      "metric.03 1",
      "metric.04 1",
      "metric.05 1",
      "metric.06 1",
      "metric.07 1",
      "metric.08 1",
    ]);
  });
});

describe("which metric names are one name with ids in it", () => {
  test("the project's own services' patterns with an id and 50 names or more, the most names first", () => {
    const picked: Array<MetricNamePatternReading> = pickExplodedNamePatterns({
      readings: [
        namePattern({ namePattern: "job.{id}.duration", nameCount: 50 }),
        namePattern({
          serviceId: SERVICE_F.toUpperCase(),
          namePattern: "tenant.{id}.requests",
          nameCount: 400,
        }),
        // No id was collapsed: many names, but each its own.
        namePattern({ namePattern: "job.duration", nameCount: 600 }),
        namePattern({
          serviceId: SERVICE_B,
          namePattern: "cache.{id}.hits",
          nameCount: 49,
        }),
        namePattern({
          serviceId: SERVICE_C,
          namePattern: "kept.{id}.out",
          nameCount: 900,
        }),
        namePattern({
          serviceId: HOST,
          namePattern: "disk.{id}.used",
          nameCount: 900,
        }),
        namePattern({ namePattern: "nan.{id}", nameCount: Number.NaN }),
      ],
      serviceIds: new Set([SERVICE_A, SERVICE_B, SERVICE_C, SERVICE_F]),
      excludedServiceIds: new Set([SERVICE_C]),
    });

    expect(picked).toEqual([
      namePattern({
        serviceId: SERVICE_F,
        namePattern: "tenant.{id}.requests",
        nameCount: 400,
      }),
      namePattern({ namePattern: "job.{id}.duration", nameCount: 50 }),
    ]);
  });

  test("twenty at most", () => {
    const readings: Array<MetricNamePatternReading> = [];

    for (let index: number = 0; index < 25; index++) {
      readings.push(
        namePattern({
          namePattern: `p${String(index).padStart(2, "0")}.{id}`,
          nameCount: 60,
        }),
      );
    }

    const picked: Array<MetricNamePatternReading> = pickExplodedNamePatterns({
      readings,
      serviceIds: new Set([SERVICE_A]),
    });

    expect(picked).toHaveLength(METRIC_INSIGHT_MAX_NAME_PATTERNS);
    expect(picked[0]!.namePattern).toBe("p00.{id}");
    expect(picked[19]!.namePattern).toBe("p19.{id}");
  });
});

describe("which attribute makes a metric high cardinality", () => {
  test("the code's attribute with the most values past 1,000, and three others past it", () => {
    const uuids: Array<string> = Array.from(
      { length: 100 },
      (_value: unknown, index: number): string => {
        return uuid(index);
      },
    );
    const reading: MetricHighCardinalityReading | null =
      readHighCardinalityAttributes([
        attribute("resource.service.instance.id", 50000, uuids),
        attribute("scope.version", 3000),
        attribute("oneuptime.telemetry.service.id", 9000),
        attribute(OTEL_METRIC_OVERFLOW_ATTRIBUTE, 2000),
        attribute("http.route", 40, ["/orders/:id"]),
        attribute("session.id", 4000),
        attribute("user.id", 12000, uuids),
        attribute("cart.id", 1200),
        attribute("request.path", 1000),
        attribute("trace.id", 999),
        attribute("order.id", 1100),
      ]);

    expect(reading).toEqual({
      attribute: { key: "user.id", valueCount: 12000 },
      valueShape: MetricValueShape.Uuid,
      otherAttributes: [
        { key: "session.id", valueCount: 4000 },
        { key: "cart.id", valueCount: 1200 },
        { key: "order.id", valueCount: 1100 },
      ],
    });
  });

  test("none, when no attribute of the code's took 1,000 values", () => {
    expect(
      readHighCardinalityAttributes([
        attribute("resource.service.instance.id", 50000),
        attribute("http.route", 40),
        attribute("http.response.status_code", 12),
        attribute("trace.id", 999),
        attribute("broken", Number.NaN),
      ]),
    ).toBeNull();
    expect(readHighCardinalityAttributes([])).toBeNull();
  });

  test("ties by key, and no value leaves the reading", () => {
    const reading: MetricHighCardinalityReading | null =
      readHighCardinalityAttributes([
        attribute("b.key", 2000, ["ada@example.com", "bob@example.com"]),
        attribute("a.key", 2000, ["ada@example.com", "bob@example.com"]),
      ]);

    expect(reading?.attribute.key).toBe("a.key");
    expect(reading?.valueShape).toBe(MetricValueShape.Email);
    expect(JSON.stringify(reading)).not.toContain("@example.com");
  });
});

describe("whether a histogram's buckets fit its values", () => {
  test("its values are counted as its temporality counts them", () => {
    expect(
      getHistogramValueCount(histogram({ countSum: 2000, countMax: 40 })),
    ).toBe(2000);
    // A cumulative point counts every value since its series started.
    expect(
      getHistogramValueCount(
        histogram({
          temporality: "Cumulative",
          countSum: 90000,
          countMax: 1500,
        }),
      ),
    ).toBe(1500);
    expect(
      getHistogramValueCount(
        histogram({ temporality: "", countSum: 90000, countMax: 1500 }),
      ),
    ).toBe(1500);
    expect(getHistogramValueCount(histogram({ countSum: -5 }))).toBe(0);
    expect(getHistogramValueCount(histogram({ countSum: Number.NaN }))).toBe(0);
  });

  test("seconds in buckets made for milliseconds: nearly every value in its smallest bucket above zero", () => {
    const reading: MetricHistogramBucketsReading | null =
      readHistogramBuckets(histogram());

    expect(reading).toEqual({
      problem: MetricBucketProblem.BelowSmallestBucket,
      share: 95,
      valueCount: 2000,
      boundCount: 15,
      smallestBound: 5,
      largestBound: 10000,
      hasDefaultBounds: true,
    });
  });

  test("with no zero bound, its smallest bucket is its first", () => {
    const reading: MetricHistogramBucketsReading | null = readHistogramBuckets(
      histogram({
        bounds: [...OTEL_SECONDS_HISTOGRAM_BOUNDS],
        bucketCounts: [1900, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      }),
    );

    expect(reading).toEqual({
      problem: MetricBucketProblem.BelowSmallestBucket,
      share: 95,
      valueCount: 2000,
      boundCount: 14,
      smallestBound: 0.005,
      largestBound: 10,
      hasDefaultBounds: false,
    });
  });

  test("milliseconds in buckets made for seconds: nearly every value above its largest bucket", () => {
    const reading: MetricHistogramBucketsReading | null = readHistogramBuckets(
      histogram({
        bounds: [...OTEL_SECONDS_HISTOGRAM_BOUNDS],
        bucketCounts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 1900],
        minValue: 12,
        maxValue: 4800,
      }),
    );

    expect(reading).toEqual({
      problem: MetricBucketProblem.AboveLargestBucket,
      share: 95,
      valueCount: 2000,
      boundCount: 14,
      smallestBound: 0.005,
      largestBound: 10,
      hasDefaultBounds: false,
    });
  });

  test("a histogram with no buckets at all", () => {
    expect(
      readHistogramBuckets(histogram({ bounds: [], bucketCounts: [2000] })),
    ).toEqual({
      problem: MetricBucketProblem.NoBuckets,
      share: 100,
      valueCount: 2000,
      boundCount: 0,
      hasDefaultBounds: false,
    });
  });

  test("from 90% of its values in one end bucket", () => {
    expect(
      readHistogramBuckets(
        histogram({
          bucketCounts: [0, 900, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          countSum: 1000,
        }),
      )?.share,
    ).toBe(90);
    expect(
      readHistogramBuckets(
        histogram({
          bucketCounts: [0, 899, 101, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          countSum: 1000,
        }),
      ),
    ).toBeNull();
  });

  test("not a histogram whose values fit, or are mostly exactly zero", () => {
    expect(
      readHistogramBuckets(
        histogram({
          bounds: [...OTEL_SECONDS_HISTOGRAM_BOUNDS],
          bucketCounts: [
            0, 100, 200, 300, 400, 300, 200, 100, 100, 100, 100, 50, 25, 25, 0,
          ],
        }),
      ),
    ).toBeNull();
    // Values of zero are read as zero, whatever bucket they fall in.
    expect(
      readHistogramBuckets(
        histogram({
          bucketCounts: [1900, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        }),
      ),
    ).toBeNull();
  });

  test("not fewer than 1,000 values, nor another kind of metric", () => {
    expect(
      readHistogramBuckets(
        histogram({
          temporality: "Cumulative",
          countSum: 50000,
          countMax: 999,
        }),
      ),
    ).toBeNull();
    expect(readHistogramBuckets(histogram({ countSum: 999 }))).toBeNull();

    for (const pointType of [
      "Sum",
      "Gauge",
      "ExponentialHistogram",
      "Summary",
    ]) {
      expect(readHistogramBuckets(histogram({ pointType }))).toBeNull();
    }
  });

  test("not when its points do not hold together", () => {
    // Bounds out of order.
    expect(
      readHistogramBuckets(
        histogram({
          bounds: [5, 1, 10],
          bucketCounts: [1900, 50, 50, 0],
        }),
      ),
    ).toBeNull();
    // One count too few.
    expect(
      readHistogramBuckets(
        histogram({
          bucketCounts: [0, 1900, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        }),
      ),
    ).toBeNull();
    expect(
      readHistogramBuckets(
        histogram({
          bucketCounts: [0, 1900, -100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        }),
      ),
    ).toBeNull();
    expect(
      readHistogramBuckets(
        histogram({
          bucketCounts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        }),
      ),
    ).toBeNull();
    expect(
      readHistogramBuckets(
        histogram({
          bounds: [Number.NaN, ...OTEL_DEFAULT_HISTOGRAM_BOUNDS.slice(1)],
        }),
      ),
    ).toBeNull();
  });

  test("of a metric's readings, the histogram one with the most data points", () => {
    const busier: MetricShapeReading = histogram({ dataPointCount: 60 });

    expect(
      pickHistogramReading([
        histogram({ pointType: "Sum", dataPointCount: 900 }),
        histogram({ dataPointCount: 40 }),
        busier,
      ]),
    ).toBe(busier);
    expect(
      pickHistogramReading([histogram({ pointType: "Gauge" })]),
    ).toBeNull();
  });

  test("whether any point carried the SDK's overflow mark", () => {
    expect(
      hasMetricOverflow([
        histogram(),
        histogram({ pointType: "Sum", overflowDataPointCount: 3 }),
      ]),
    ).toBe(true);
    expect(hasMetricOverflow([histogram()])).toBe(false);
    expect(
      hasMetricOverflow([histogram({ overflowDataPointCount: Number.NaN })]),
    ).toBe(false);
    expect(hasMetricOverflow([])).toBe(false);
  });
});

describe("which busy services send no metrics", () => {
  test("the project's own, with 1,000 spans or more and no data point of their own, busiest first", () => {
    const picked: Array<MetricServiceTraffic> = pickServicesMissingMetrics({
      traffic: [
        traffic({ serviceId: SERVICE_A, spanCount: 5000 }),
        traffic({ serviceId: SERVICE_F.toUpperCase(), spanCount: 1000 }),
        traffic({ serviceId: SERVICE_C, spanCount: 999 }),
        // It sends metrics.
        traffic({ serviceId: SERVICE_D, spanCount: 90000 }),
        // Its telemetry is kept out of AI.
        traffic({ serviceId: SERVICE_E, spanCount: 7000 }),
        traffic({ serviceId: HOST, spanCount: 9000 }),
        traffic({ serviceId: SERVICE_A, spanCount: Number.NaN }),
      ],
      serviceIds: new Set([
        SERVICE_A,
        SERVICE_C,
        SERVICE_D,
        SERVICE_E,
        SERVICE_F,
      ]),
      servicesWithMetrics: new Set([SERVICE_D]),
      excludedServiceIds: new Set([SERVICE_E]),
    });

    expect(picked).toEqual([
      traffic({ serviceId: SERVICE_A, spanCount: 5000 }),
      traffic({ serviceId: SERVICE_F, spanCount: 1000 }),
    ]);
  });
});

describe("a finding's identity", () => {
  test("is its kind, its service and its metric, or the pattern its names share", () => {
    expect(
      getMetricInsightFingerprint({
        kind: MetricInsightKind.HighCardinality,
        shape: MetricCardinalityShape.Attribute,
        serviceId: SERVICE_F.toUpperCase(),
        metricName: "HTTP.Server.Request.Count",
      }),
    ).toBe(
      `metric-high-cardinality:${SERVICE_F}:attribute:http.server.request.count`,
    );
    // An attribute finding is the default shape.
    expect(
      getMetricInsightFingerprint({
        kind: MetricInsightKind.HighCardinality,
        serviceId: SERVICE_A,
        metricName: "http.server.request.count",
      }),
    ).toBe(
      `metric-high-cardinality:${SERVICE_A}:attribute:http.server.request.count`,
    );
    expect(
      getMetricInsightFingerprint({
        kind: MetricInsightKind.HighCardinality,
        shape: MetricCardinalityShape.Name,
        serviceId: SERVICE_A,
        namePattern: "job.{id}.duration",
      }),
    ).toBe(`metric-high-cardinality:${SERVICE_A}:name:job.{id}.duration`);
    expect(
      getMetricInsightFingerprint({
        kind: MetricInsightKind.HistogramBuckets,
        serviceId: SERVICE_A,
        metricName: " http.server.duration ",
      }),
    ).toBe(`metric-histogram-buckets:${SERVICE_A}:http.server.duration`);
    expect(
      getMetricInsightFingerprint({
        kind: MetricInsightKind.MissingMetrics,
        serviceId: SERVICE_A,
      }),
    ).toBe(`metric-missing-metrics:${SERVICE_A}`);
  });

  test("one metric's two problems are two findings", () => {
    expect(
      getMetricInsightFingerprint({
        kind: MetricInsightKind.HighCardinality,
        serviceId: SERVICE_A,
        metricName: "http.server.duration",
      }),
    ).not.toBe(
      getMetricInsightFingerprint({
        kind: MetricInsightKind.HistogramBuckets,
        serviceId: SERVICE_A,
        metricName: "http.server.duration",
      }),
    );
  });

  test("tells a service's findings from another's, and from the other metric findings", () => {
    for (const prefix of Object.values(METRIC_INSIGHT_FINGERPRINT_PREFIXES)) {
      expect(
        isMetricInsightFingerprintOfService(
          `${prefix}:${SERVICE_F}:http.server.duration`,
          SERVICE_F.toUpperCase(),
        ),
      ).toBe(true);
      expect(
        isMetricInsightFingerprintOfService(
          `${prefix}:${SERVICE_A}:http.server.duration`,
          SERVICE_B,
        ),
      ).toBe(false);
    }

    expect(
      isMetricInsightFingerprintOfService(
        `metric-missing-metrics:${SERVICE_A}`,
        SERVICE_A,
      ),
    ).toBe(true);
    // Another id that starts with this one is another service.
    expect(
      isMetricInsightFingerprintOfService(
        `metric-missing-metrics:${SERVICE_A}0`,
        SERVICE_A,
      ),
    ).toBe(false);
    // A drift finding names the metric first: it is not one of these.
    expect(
      isMetricInsightFingerprintOfService(
        `metric-drift:http.server.duration:${SERVICE_A}`,
        SERVICE_A,
      ),
    ).toBe(false);
    expect(
      isMetricInsightFingerprintOfService("metric-missing-metrics:", ""),
    ).toBe(false);
  });
});

describe("how findings say numbers", () => {
  test("shares", () => {
    expect(formatMetricPercent(98.4)).toBe("98%");
    expect(formatMetricPercent(100)).toBe("100%");
    expect(formatMetricPercent(5.44)).toBe("5.4%");
    expect(formatMetricPercent(0.75)).toBe("0.8%");
    expect(formatMetricPercent(Number.NaN)).toBe("0%");
  });

  test("bounds and values", () => {
    expect(formatMetricNumber(10000)).toBe("10,000");
    expect(formatMetricNumber(-2500)).toBe("-2,500");
    expect(formatMetricNumber(2.5)).toBe("2.5");
    expect(formatMetricNumber(7.125)).toBe("7.13");
    expect(formatMetricNumber(0.005)).toBe("0.005");
    expect(formatMetricNumber(0.0021345)).toBe("0.00213");
    expect(formatMetricNumber(0)).toBe("0");
    expect(formatMetricNumber(Number.NaN)).toBe("0");
    expect(formatMetricNumber(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("what a finding is called", () => {
  test("each kind, in a sentence that names the metric and the service", () => {
    expect(
      getMetricInsightTitle({
        evidence: attributeEvidence(),
        serviceName: "checkout",
      }),
    ).toBe(
      "http.server.request.count in checkout records 12,000 different user.id values an hour",
    );
    expect(
      getMetricInsightTitle({
        evidence: nameEvidence(),
        serviceName: "checkout",
      }),
    ).toBe("checkout sends 1,234 metrics named like job.{id}.duration");
    expect(
      getMetricInsightTitle({
        evidence: histogramEvidence(),
        serviceName: "checkout",
      }),
    ).toBe(
      "http.server.duration in checkout puts 95% of its values in its smallest bucket",
    );
    expect(
      getMetricInsightTitle({
        evidence: histogramEvidence({
          bucketProblem: MetricBucketProblem.AboveLargestBucket,
          bucketShare: 97.5,
        }),
        serviceName: "checkout",
      }),
    ).toBe(
      "http.server.duration in checkout puts 98% of its values above its largest bucket",
    );
    expect(
      getMetricInsightTitle({
        evidence: histogramEvidence({
          bucketProblem: MetricBucketProblem.NoBuckets,
          bucketShare: 100,
        }),
        serviceName: "checkout",
      }),
    ).toBe("http.server.duration in checkout is a histogram with no buckets");
    expect(
      getMetricInsightTitle({
        evidence: missingEvidence(),
        serviceName: "checkout",
      }),
    ).toBe("checkout sends traces but no metrics");
  });

  test("without the service's name", () => {
    expect(
      getMetricInsightTitle({ evidence: attributeEvidence(), serviceName: "" }),
    ).toBe(
      "http.server.request.count records 12,000 different user.id values an hour",
    );
    expect(
      getMetricInsightTitle({ evidence: nameEvidence(), serviceName: "" }),
    ).toBe("A service sends 1,234 metrics named like job.{id}.duration");
    expect(
      getMetricInsightTitle({ evidence: missingEvidence(), serviceName: "" }),
    ).toBe("A service sends traces but no metrics");
  });
});

describe("how severe a finding is", () => {
  test("names with ids: High from 500 names", () => {
    expect(getMetricInsightSeverity(nameEvidence({ nameCount: 499 }))).toBe(
      AIInsightSeverity.Medium,
    );
    expect(getMetricInsightSeverity(nameEvidence({ nameCount: 500 }))).toBe(
      AIInsightSeverity.High,
    );
  });

  test("an attribute: High from 10,000 values, or once the SDK folds its series into one", () => {
    expect(
      getMetricInsightSeverity(
        attributeEvidence({ attributeValueCount: 9999 }),
      ),
    ).toBe(AIInsightSeverity.Medium);
    expect(
      getMetricInsightSeverity(
        attributeEvidence({ attributeValueCount: 10000 }),
      ),
    ).toBe(AIInsightSeverity.High);
    expect(
      getMetricInsightSeverity(
        attributeEvidence({ attributeValueCount: 1000, hasOverflow: true }),
      ),
    ).toBe(AIInsightSeverity.High);
  });

  test("buckets that do not fit are Medium, a service with no metrics Low", () => {
    expect(getMetricInsightSeverity(histogramEvidence())).toBe(
      AIInsightSeverity.Medium,
    );
    expect(getMetricInsightSeverity(missingEvidence())).toBe(
      AIInsightSeverity.Low,
    );
  });
});

describe("what the problem is, in sentences", () => {
  test("an attribute: how many values, what they look like, and what it costs", () => {
    expect(describeMetricProblem(attributeEvidence())).toBe(
      "Over the last hour its attribute user.id took 12,000 different values, which look like UUIDs. Every value makes a series of its own, so the metric costs more to store and its charts and monitors slow down.",
    );
    expect(
      describeMetricProblem(attributeEvidence({ hasOverflow: true })),
    ).toContain(
      " The SDK already folds its new series into one overflow series (otel.metric.overflow), so its numbers are wrong as well as costly.",
    );
  });

  test("names with ids: how many, and that each id is a metric of its own", () => {
    expect(describeMetricProblem(nameEvidence())).toBe(
      "Over the last hour it sent 1,234 metrics whose names differ only by an id, all named like job.{id}.duration (56,000 data points together). Each id makes a metric of its own.",
    );
  });

  test("buckets: where the values fell, their range, and whose buckets they are", () => {
    expect(describeMetricProblem(histogramEvidence())).toBe(
      "Over the last hour 95% of its values were at or below 5, its smallest bucket's bound, so its percentiles cannot be told apart: every chart and monitor reads the same number whatever the values were. The values it recorded ranged from 0.012 to 4.8. Its buckets are the OpenTelemetry SDKs' default ones, made for milliseconds.",
    );
    expect(
      describeMetricProblem(
        histogramEvidence({
          bucketProblem: MetricBucketProblem.AboveLargestBucket,
          bucketShare: 95,
          largestBound: 10,
          hasDefaultBounds: false,
          minValue: undefined,
        }),
      ),
    ).toBe(
      "Over the last hour 95% of its values were above 10, its largest bucket's bound, so its percentiles cannot be told apart: every chart and monitor reads the same number whatever the values were.",
    );
    expect(
      describeMetricProblem(
        histogramEvidence({
          bucketProblem: MetricBucketProblem.NoBuckets,
          bucketShare: 100,
          boundCount: 0,
          hasDefaultBounds: false,
        }),
      ),
    ).toBe(
      "It has no bucket bounds, so every value it recorded over the last hour went into one bucket and its percentiles cannot be told apart: every chart and monitor reads the same number whatever the values were. The values it recorded ranged from 0.012 to 4.8.",
    );
  });

  test("no metrics: its spans, what nothing charts, and its busiest operations", () => {
    expect(describeMetricProblem(missingEvidence())).toBe(
      "It sent 4,200 spans over the last hour and has never sent a metric, so nothing charts or alerts on its request rate, errors or latency over time without reading every span. Its busiest operations: GET /orders (2,000), POST /checkout (900).",
    );
    expect(
      describeMetricProblem(missingEvidence({ topOperations: [] })),
    ).not.toContain("busiest");
  });
});

describe("the evidence a person reads on the finding", () => {
  function lines(
    evidence: MetricInsightEvidence,
    serviceName?: string,
  ): Array<string> {
    return buildMetricInsightDetail({
      serviceName: serviceName ?? "checkout",
      evidence: evidence,
    })
      .toString()
      .split("\n");
  }

  test("an attribute: the metric, its unit, the attribute and its values' shape, and the others", () => {
    expect(lines(attributeEvidence())).toEqual([
      "**High-cardinality metric in checkout**",
      "",
      "- Metric: `http.server.request.count`",
      "- Unit: `{request}`",
      "- In the last hour: 48,000 data points",
      "- Attribute: `user.id`, 12,000 different values",
      "- Its values look like: UUIDs",
      "- Also with many values: `session.id` (4,000)",
      "- Every value makes a series of its own: it costs more to store, and its charts and monitors slow down",
    ]);
  });

  test("an attribute past the SDK's limit says its numbers are wrong", () => {
    expect(
      lines(attributeEvidence({ hasOverflow: true, otherAttributes: [] })),
    ).toContain(
      "- The SDK already folds new series into one overflow series (`otel.metric.overflow`): its numbers are wrong",
    );
  });

  test("names with ids: the pattern, how many names, and why each is a metric", () => {
    expect(lines(nameEvidence())).toEqual([
      "**Metric names with ids in checkout**",
      "",
      "- Names like: `job.{id}.duration`",
      "- In the last hour: 1,234 such names, 56,000 data points",
      "- An id in a metric's name makes a new metric for each value",
    ]);
  });

  test("buckets: where the values fell, their range and the buckets", () => {
    expect(lines(histogramEvidence())).toEqual([
      "**Histogram buckets that do not fit in checkout**",
      "",
      "- Metric: `http.server.duration`",
      "- Unit: `s`",
      "- In the last hour: 2,400 data points",
      "- 95% of its values were at or below 5, its smallest bucket's bound",
      "- Values recorded: from 0.012 to 4.8",
      "- Buckets: 15 bucket bounds, the smallest above zero 5 and the largest 10,000 - the OpenTelemetry SDKs' default ones, made for milliseconds",
      "- Its percentiles cannot be told apart: every chart and monitor reads the same number",
    ]);
    expect(
      lines(
        histogramEvidence({
          bucketProblem: MetricBucketProblem.NoBuckets,
          bucketShare: 100,
          boundCount: 0,
          smallestBound: undefined,
          largestBound: undefined,
          hasDefaultBounds: false,
          minValue: undefined,
          maxValue: undefined,
          unit: undefined,
        }),
      ),
    ).toEqual([
      "**Histogram buckets that do not fit in checkout**",
      "",
      "- Metric: `http.server.duration`",
      "- In the last hour: 2,400 data points",
      "- It records every value into one bucket: it has no bucket bounds at all",
      "- Its percentiles cannot be told apart: every chart and monitor reads the same number",
    ]);
  });

  test("no metrics: its spans, its busiest operations and its SDK", () => {
    expect(lines(missingEvidence())).toEqual([
      "**Missing metrics in checkout**",
      "",
      "- In the last hour: 4,200 spans, 12 failed",
      "- No metric has ever arrived from this service",
      "- Busiest operations: `GET /orders` (2,000), `POST /checkout` (900)",
      "- Telemetry SDK: nodejs",
      "- Without metrics, nothing charts or alerts on its request rate, errors or latency over time",
    ]);
  });

  test("a service's names are written as text, and a metric's name as code, whatever they hold", () => {
    const detail: Array<string> = lines(
      attributeEvidence({ metricName: "a`b*c", attributeKey: "x_y" }),
      "check*out <b>",
    );

    expect(detail[0]).toBe("**High-cardinality metric in check\\*out \\<b>**");
    // A longer fence, padded: Markdown drops the two spaces when it draws it.
    expect(detail).toContain("- Metric: `` a`b*c ``");
    expect(detail).toContain("- Attribute: `x_y`, 12,000 different values");
  });
});

describe("what OneUptime asks the AI", () => {
  test("each kind's title: what to do, and where", () => {
    expect(
      getMetricFixRequestTitle({
        evidence: attributeEvidence(),
        serviceName: "checkout",
      }),
    ).toBe("Stop recording user.id on http.server.request.count in checkout");
    expect(
      getMetricFixRequestTitle({
        evidence: nameEvidence(),
        serviceName: "checkout",
      }),
    ).toBe(
      "Take the ids out of checkout's metric names like job.{id}.duration",
    );
    expect(
      getMetricFixRequestTitle({
        evidence: histogramEvidence(),
        serviceName: "checkout",
      }),
    ).toBe("Fix the buckets of http.server.duration in checkout");
    expect(
      getMetricFixRequestTitle({
        evidence: missingEvidence(),
        serviceName: "checkout",
      }),
    ).toBe("Add metrics to checkout");
    expect(
      getMetricFixRequestTitle({
        evidence: histogramEvidence({ metricName: undefined }),
        serviceName: "",
      }),
    ).toBe("Fix the buckets of this metric");
    expect(
      getMetricFixRequestTitle({
        evidence: missingEvidence(),
        serviceName: "",
      }),
    ).toBe("Add metrics to this service");
  });

  test("started by OneUptime: the title, what it found on its own, what to do and leave to change nothing", () => {
    const message: Array<string> = buildMetricFixRequestMessage({
      evidence: attributeEvidence(),
      serviceName: "checkout",
      isStartedByOneUptime: true,
    }).split("\n");

    expect(message[0]).toBe(
      "Stop recording user.id on http.server.request.count in checkout",
    );
    expect(message[1]).toBe("");
    expect(message[2]).toBe(
      `OneUptime found this in the service's metrics on its own. ${describeMetricProblem(attributeEvidence())}`,
    );
    expect(message[3]).toBe("");
    expect(message[4]).toBe(
      "Find where the code records this metric and stop putting user.id on it: drop it, or record a value with a few possible values in its place (a tier, a type or a region rather than an id). If the value helps when debugging, put it on the span or the log line instead, where one value per request costs nothing. Keep the metric's name and its other attributes as they are, and update the tests that check its attributes. If this metric is recorded by a library, an agent or a collector configured outside this repository, say where and change nothing.",
    );
    expect(message).toHaveLength(5);
  });

  test("asked for by a person: the same, without OneUptime's leave", () => {
    const message: string = buildMetricFixRequestMessage({
      evidence: attributeEvidence(),
      serviceName: "checkout",
      isStartedByOneUptime: false,
    });

    expect(message).not.toContain("on its own");
    expect(message).not.toContain("change nothing");
    expect(message.split("\n")[2]).toBe(
      describeMetricProblem(attributeEvidence()),
    );
  });

  test("what an attribute is replaced with, by what its values look like", () => {
    const ask: (shape: MetricValueShape) => string = (
      shape: MetricValueShape,
    ): string => {
      return buildMetricFixRequestMessage({
        evidence: attributeEvidence({ valueShape: shape }),
        serviceName: "checkout",
        isStartedByOneUptime: false,
      });
    };

    expect(ask(MetricValueShape.UrlWithIds)).toContain(
      "stop putting user.id on it: record the route template (http.route) instead of the URL.",
    );
    expect(ask(MetricValueShape.Timestamp)).toContain(
      "stop putting user.id on it: drop it, since every data point already has its time.",
    );

    for (const shape of [
      MetricValueShape.Number,
      MetricValueShape.Uuid,
      MetricValueShape.HexId,
      MetricValueShape.Email,
    ]) {
      expect(ask(shape)).toContain(
        "drop it, or record a value with a few possible values in its place (a tier, a type or a region rather than an id).",
      );
    }

    for (const shape of [MetricValueShape.Text, MetricValueShape.Mixed]) {
      expect(ask(shape)).toContain(
        "drop it, or bucket it into a few possible values.",
      );
    }
  });

  test("names with ids: one fixed name, the changing part as a bounded attribute", () => {
    const message: string = buildMetricFixRequestMessage({
      evidence: nameEvidence(),
      serviceName: "checkout",
      isStartedByOneUptime: true,
    });

    expect(message).toContain(
      "Find where the code builds these metric names and use one fixed name in their place.",
    );
    expect(message).toContain("never the id itself");
    expect(message).toContain(
      "If this metric is recorded by a library, an agent or a collector configured outside this repository, say where and change nothing.",
    );
  });

  test("buckets: the semantic conventions' boundaries, or explicit ones for a histogram with none", () => {
    const below: string = buildMetricFixRequestMessage({
      evidence: histogramEvidence(),
      serviceName: "checkout",
      isStartedByOneUptime: false,
    });

    expect(below).toContain(
      "the OpenTelemetry semantic conventions' boundaries (0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10)",
    );
    expect(below).toContain(
      "so the metric's unit, its values and its buckets agree",
    );

    const none: string = buildMetricFixRequestMessage({
      evidence: histogramEvidence({
        bucketProblem: MetricBucketProblem.NoBuckets,
      }),
      serviceName: "checkout",
      isStartedByOneUptime: false,
    });

    expect(none).toContain("give it explicit bucket boundaries");
    expect(none).not.toContain("semantic conventions' boundaries");
  });

  test("no metrics: set up the SDK as its traces are exported, bounded attributes, and nothing else changed", () => {
    const message: string = buildMetricFixRequestMessage({
      evidence: missingEvidence(),
      serviceName: "checkout",
      isStartedByOneUptime: true,
    });

    expect(message.split("\n")[0]).toBe("Add metrics to checkout");
    expect(message).toContain(
      "Set up the OpenTelemetry metrics SDK in this service and export its metrics to OneUptime the way its traces are exported now (the same endpoint, headers and service.name).",
    );
    expect(message).toContain("never ids or full URLs");
    expect(message).toContain("Do not change what the code does.");
    expect(message).toContain(
      "If this service's metrics are recorded somewhere other than this repository, or reach OneUptime another way, say where and change nothing.",
    );
  });
});

describe("what the task is given beside the code", () => {
  test("an attribute", () => {
    expect(
      buildMetricFixEvidenceNote(
        attributeEvidence({ hasOverflow: true }),
      ).split("\n"),
    ).toEqual([
      "Metric: http.server.request.count",
      "Unit: {request}",
      `Window: ${WINDOW_START} to ${WINDOW_END}`,
      "Data points in the window: 48,000",
      "Attribute: user.id, 12,000 different values, which look like UUIDs",
      "Also many values: session.id (4,000)",
      "The SDK folds new series into its overflow series (otel.metric.overflow).",
    ]);
  });

  test("names with ids", () => {
    expect(buildMetricFixEvidenceNote(nameEvidence()).split("\n")).toEqual([
      `Window: ${WINDOW_START} to ${WINDOW_END}`,
      "Data points in the window: 56,000",
      "Names like: job.{id}.duration (1,234 names; {id} stands for the part that changes)",
    ]);
  });

  test("buckets", () => {
    expect(buildMetricFixEvidenceNote(histogramEvidence()).split("\n")).toEqual(
      [
        "Metric: http.server.duration",
        "Unit: s",
        `Window: ${WINDOW_START} to ${WINDOW_END}`,
        "Data points in the window: 2,400",
        "95% of its values were at or below 5, its smallest bucket's bound",
        "Values recorded: from 0.012 to 4.8",
        "Buckets: 15 bucket bounds, the smallest above zero 5 and the largest 10,000 (the OpenTelemetry SDKs' default buckets)",
      ],
    );
  });

  test("no metrics", () => {
    expect(buildMetricFixEvidenceNote(missingEvidence()).split("\n")).toEqual([
      `Window: ${WINDOW_START} to ${WINDOW_END}`,
      "Spans in the window: 4,200",
      "Failed spans: 12",
      "Busy operation: GET /orders (2,000 spans)",
      "Busy operation: POST /checkout (900 spans)",
      "Telemetry SDK language: nodejs",
    ]);
  });
});

/*
 * Every pattern here reads text a service sent - a metric's name, an
 * attribute's value - so each must take time in line with the text whatever
 * it holds: the fastest of up to three runs, on the worst text of its kind.
 */
describe("text a service sent is read quickly, whatever it holds", () => {
  const LENGTH: number = 400000;

  const repeat: (unit: string) => string = (unit: string): string => {
    return unit.repeat(Math.ceil(LENGTH / unit.length)).slice(0, LENGTH);
  };

  const timeOf: (run: () => unknown) => number = (
    run: () => unknown,
  ): number => {
    return fastestRun({ run: run, limitInMs: 2000 }).inMs;
  };

  const WORST_TEXTS: Array<[string, string]> = [
    ["a run of digits", repeat("1")],
    ["a run of hex", repeat("a")],
    [
      "almost a UUID, again and again",
      repeat("0123abcd-0123-0123-0123-0123abcd012x"),
    ],
    ["fifteen hex characters between dashes", repeat("fffffffffffffff-")],
    ["single digits between letters", repeat("1a")],
    ["at signs", repeat("@")],
    ["a path of single digits", "/" + repeat("1/")],
    ["dots after an at sign", "a@" + repeat(".")],
  ];

  test.each(WORST_TEXTS)(
    "%s, as a metric's name",
    (_label: string, text: string) => {
      expect(
        timeOf(() => {
          hasMetricNameId(getMetricNamePattern(text));
        }),
      ).toBeLessThan(2000);
    },
  );

  test.each(WORST_TEXTS)(
    "%s, as an attribute's values",
    (_label: string, text: string) => {
      expect(
        timeOf(() => {
          getMetricValueShape(text);
          getDominantMetricValueShape([text, text, text]);
          isCodeSetMetricAttribute(text);
        }),
      ).toBeLessThan(2000);
    },
  );
});
