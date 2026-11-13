import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import PrometheusRemoteWrite, {
  PrometheusRemoteWriteError,
  PrometheusRemoteWriteVersion,
  PrometheusTranslation,
  PrometheusWriteRequest,
  WriteRequestV1,
  WriteRequestV2,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/PrometheusRemoteWrite";
import SnappyBlock from "../../../FeatureSet/Telemetry/Utils/Compatible/SnappyBlock";
import { snappyCompress } from "./SnappyTestCompressor";

/*
 * Prometheus remote write 1.0 and 2.0 as OTLP metrics: each series keeps
 * its name and labels, its job and instance name the service, its type
 * comes from metadata or Prometheus' naming conventions, native
 * histograms become exponential histograms, and what OTLP JSON cannot
 * carry (NaN, staleness markers) is dropped and counted.
 */

const STALE_NAN: number = new Float64Array(
  new BigUint64Array([BigInt("0x7ff0000000000002")]).buffer,
)[0]!;

type Labels = Record<string, string>;

const labels: (values: Labels) => Array<{ name: string; value: string }> = (
  values: Labels,
): Array<{ name: string; value: string }> => {
  return Object.keys(values).map((name: string) => {
    return { name: name, value: values[name]! };
  });
};

const encodeV1: (request: JSONObject) => Uint8Array = (
  request: JSONObject,
): Uint8Array => {
  return WriteRequestV1.encode(WriteRequestV1.fromObject(request)).finish();
};

const encodeV2: (request: JSONObject) => Uint8Array = (
  request: JSONObject,
): Uint8Array => {
  return WriteRequestV2.encode(WriteRequestV2.fromObject(request)).finish();
};

const translateV1: (
  request: JSONObject,
  options?: { serviceName?: string },
) => PrometheusTranslation = (
  request: JSONObject,
  options?: { serviceName?: string },
): PrometheusTranslation => {
  const decoded: PrometheusWriteRequest = PrometheusRemoteWrite.decode(
    encodeV1(request),
    PrometheusRemoteWriteVersion.V1,
  );

  return PrometheusRemoteWrite.toOtlp(decoded, options);
};

interface FlatMetric {
  resource: Record<string, unknown>;
  metric: JSONObject;
}

// Every metric of the export request, with its resource's attributes.
const metricsOf: (translation: PrometheusTranslation) => Array<FlatMetric> = (
  translation: PrometheusTranslation,
): Array<FlatMetric> => {
  const result: Array<FlatMetric> = [];

  if (!translation.metrics) {
    return result;
  }

  for (const resourceMetric of translation.metrics[
    "resourceMetrics"
  ] as Array<JSONObject>) {
    const resource: Record<string, unknown> = attributesOf(
      (resourceMetric["resource"] as JSONObject)["attributes"],
    );

    for (const scopeMetric of resourceMetric[
      "scopeMetrics"
    ] as Array<JSONObject>) {
      expect((scopeMetric["scope"] as JSONObject)["name"]).toBe(
        "prometheus-remote-write",
      );

      for (const metric of scopeMetric["metrics"] as Array<JSONObject>) {
        result.push({ resource: resource, metric: metric });
      }
    }
  }

  return result;
};

const metricNamed: (
  translation: PrometheusTranslation,
  name: string,
) => FlatMetric = (
  translation: PrometheusTranslation,
  name: string,
): FlatMetric => {
  const found: FlatMetric | undefined = metricsOf(translation).find(
    (flat: FlatMetric) => {
      return flat.metric["name"] === name;
    },
  );

  if (!found) {
    throw new Error(`No metric named ${name}`);
  }

  return found;
};

const attributesOf: (value: unknown) => Record<string, unknown> = (
  value: unknown,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const attribute of (value || []) as Array<{
    key: string;
    value: Record<string, unknown>;
  }>) {
    result[attribute.key] = Object.values(attribute.value)[0];
  }

  return result;
};

const dataPointsOf: (metric: JSONObject) => Array<JSONObject> = (
  metric: JSONObject,
): Array<JSONObject> => {
  const body: JSONObject = (metric["gauge"] ||
    metric["sum"] ||
    metric["histogram"] ||
    metric["exponentialHistogram"]) as JSONObject;

  return body["dataPoints"] as Array<JSONObject>;
};

describe("PrometheusRemoteWrite.versionOf", () => {
  test.each<[string | undefined, PrometheusRemoteWriteVersion | null]>([
    [undefined, PrometheusRemoteWriteVersion.V1],
    ["application/x-protobuf", PrometheusRemoteWriteVersion.V1],
    [
      "application/x-protobuf;proto=prometheus.WriteRequest",
      PrometheusRemoteWriteVersion.V1,
    ],
    [
      "application/x-protobuf; proto=io.prometheus.write.v2.Request",
      PrometheusRemoteWriteVersion.V2,
    ],
    [
      'application/x-protobuf;proto="io.prometheus.write.v2.Request"',
      PrometheusRemoteWriteVersion.V2,
    ],
    ["application/x-protobuf;proto=something.Else", null],
  ])("%s is %s", (contentType: string | undefined, expected: unknown) => {
    expect(PrometheusRemoteWrite.versionOf(contentType)).toBe(expected);
  });
});

describe("PrometheusRemoteWrite - remote write 1.0", () => {
  test("a counter is a cumulative monotonic sum, named and labelled as in Prometheus", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: labels({
            __name__: "http_requests_total",
            job: "checkout",
            instance: "10.0.0.7:9090",
            method: "POST",
            code: "500",
          }),
          samples: [
            { value: 1027, timestamp: 1700000000000 },
            { value: 1031.5, timestamp: 1700000015000 },
          ],
        },
      ],
    });

    const flat: FlatMetric = metricNamed(translation, "http_requests_total");

    expect(flat.resource).toEqual({
      "service.name": "checkout",
      "service.instance.id": "10.0.0.7:9090",
    });
    expect(flat.metric["sum"]).toMatchObject({
      aggregationTemporality: 2,
      isMonotonic: true,
    });

    const points: Array<JSONObject> = dataPointsOf(flat.metric);

    expect(points).toHaveLength(2);
    expect(points[0]!["timeUnixNano"]).toBe("1700000000000000000");
    expect(points[0]!["asDouble"]).toBe(1027);
    expect(points[1]!["asDouble"]).toBe(1031.5);
    expect(attributesOf(points[0]!["attributes"])).toEqual({
      job: "checkout",
      instance: "10.0.0.7:9090",
      method: "POST",
      code: "500",
    });
    expect(translation.samplesWritten).toBe(2);
    expect(translation.samplesDropped).toBe(0);
  });

  test("a series with no metadata and no counter suffix is a gauge", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: labels({
            __name__: "node_memory_MemFree_bytes",
            job: "node",
          }),
          samples: [{ value: 123456789, timestamp: 1700000000000 }],
        },
      ],
    });

    expect(
      metricNamed(translation, "node_memory_MemFree_bytes").metric,
    ).toHaveProperty("gauge");
  });

  test("a classic histogram stays as its _bucket, _count and _sum series", () => {
    const base: Labels = { job: "api", handler: "/checkout" };
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        ...["0.1", "0.5", "+Inf"].map((le: string, index: number) => {
          return {
            labels: labels({
              __name__: "http_request_duration_seconds_bucket",
              ...base,
              le: le,
            }),
            samples: [{ value: 10 * (index + 1), timestamp: 1700000000000 }],
          };
        }),
        {
          labels: labels({
            __name__: "http_request_duration_seconds_count",
            ...base,
          }),
          samples: [{ value: 30, timestamp: 1700000000000 }],
        },
        {
          labels: labels({
            __name__: "http_request_duration_seconds_sum",
            ...base,
          }),
          samples: [{ value: 4.2, timestamp: 1700000000000 }],
        },
      ],
    });

    const buckets: FlatMetric = metricNamed(
      translation,
      "http_request_duration_seconds_bucket",
    );

    expect(buckets.metric["sum"]).toMatchObject({ isMonotonic: true });
    expect(
      dataPointsOf(buckets.metric).map((point: JSONObject) => {
        return attributesOf(point["attributes"])["le"];
      }),
    ).toEqual(["0.1", "0.5", "+Inf"]);

    expect(
      metricNamed(translation, "http_request_duration_seconds_count").metric[
        "sum"
      ],
    ).toMatchObject({ aggregationTemporality: 2, isMonotonic: true });

    // A sum of observations can go down when observations are negative.
    expect(
      metricNamed(translation, "http_request_duration_seconds_sum").metric[
        "sum"
      ],
    ).toMatchObject({ aggregationTemporality: 2, isMonotonic: false });
  });

  test("_count and _sum without their histogram or summary are gauges", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: labels({ __name__: "queue_items_count", job: "worker" }),
          samples: [{ value: 3, timestamp: 1700000000000 }],
        },
        {
          labels: labels({ __name__: "cart_value_sum", job: "worker" }),
          samples: [{ value: 99.5, timestamp: 1700000000000 }],
        },
      ],
    });

    expect(metricNamed(translation, "queue_items_count").metric).toHaveProperty(
      "gauge",
    );
    expect(metricNamed(translation, "cart_value_sum").metric).toHaveProperty(
      "gauge",
    );
  });

  test("a summary's quantiles are gauges, its _count and _sum sums", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: labels({
            __name__: "rpc_duration_seconds",
            job: "rpc",
            quantile: "0.99",
          }),
          samples: [{ value: 0.25, timestamp: 1700000000000 }],
        },
        {
          labels: labels({
            __name__: "rpc_duration_seconds_count",
            job: "rpc",
          }),
          samples: [{ value: 1000, timestamp: 1700000000000 }],
        },
        {
          labels: labels({ __name__: "rpc_duration_seconds_sum", job: "rpc" }),
          samples: [{ value: 53.2, timestamp: 1700000000000 }],
        },
      ],
    });

    expect(
      metricNamed(translation, "rpc_duration_seconds").metric,
    ).toHaveProperty("gauge");
    expect(
      metricNamed(translation, "rpc_duration_seconds_count").metric["sum"],
    ).toMatchObject({ isMonotonic: true });
    expect(
      metricNamed(translation, "rpc_duration_seconds_sum").metric["sum"],
    ).toMatchObject({ isMonotonic: false });
  });

  test("metadata in the request decides the type, and gives the unit and description", () => {
    const translation: PrometheusTranslation = translateV1({
      metadata: [
        {
          type: 1, // COUNTER
          metricFamilyName: "process_cpu_seconds",
          help: "Total user and system CPU time spent in seconds.",
          unit: "seconds",
        },
        { type: 2, metricFamilyName: "temperature_total", help: "", unit: "" }, // GAUGE
      ],
      timeseries: [
        {
          labels: labels({ __name__: "process_cpu_seconds", job: "app" }),
          samples: [{ value: 12.5, timestamp: 1700000000000 }],
        },
        {
          labels: labels({
            __name__: "process_cpu_seconds_created",
            job: "app",
          }),
          samples: [{ value: 1699990000, timestamp: 1700000000000 }],
        },
        {
          labels: labels({ __name__: "temperature_total", job: "app" }),
          samples: [{ value: 21, timestamp: 1700000000000 }],
        },
      ],
    });

    const cpu: FlatMetric = metricNamed(translation, "process_cpu_seconds");

    expect(cpu.metric["sum"]).toMatchObject({ isMonotonic: true });
    expect(cpu.metric["unit"]).toBe("seconds");
    expect(cpu.metric["description"]).toBe(
      "Total user and system CPU time spent in seconds.",
    );

    // A counter's _created series only says when it began.
    expect(
      metricsOf(translation).some((flat: FlatMetric) => {
        return flat.metric["name"] === "process_cpu_seconds_created";
      }),
    ).toBe(false);

    // Metadata wins over the name.
    expect(metricNamed(translation, "temperature_total").metric).toHaveProperty(
      "gauge",
    );
    expect(translation.samplesDropped).toBe(1);
  });

  test("histogram metadata is found for the family's suffixed series", () => {
    const translation: PrometheusTranslation = translateV1({
      metadata: [
        { type: 3, metricFamilyName: "latency", help: "Latency.", unit: "" },
      ],
      timeseries: [
        {
          labels: labels({ __name__: "latency_count", job: "app" }),
          samples: [{ value: 4, timestamp: 1700000000000 }],
        },
      ],
    });

    expect(
      metricNamed(translation, "latency_count").metric["sum"],
    ).toMatchObject({
      isMonotonic: true,
    });
  });

  test("a metadata-only request (as Prometheus sends them) holds nothing to store", () => {
    const translation: PrometheusTranslation = translateV1({
      metadata: [
        {
          type: 1,
          metricFamilyName: "http_requests",
          help: "Requests.",
          unit: "",
        },
      ],
    });

    expect(translation.metrics).toBeNull();
    expect(translation.samplesWritten).toBe(0);
  });

  test("staleness markers, NaN and infinities are dropped and counted", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: labels({ __name__: "up", job: "node", instance: "a:9100" }),
          samples: [
            { value: 1, timestamp: 1700000000000 },
            { value: STALE_NAN, timestamp: 1700000015000 },
            { value: Number.NaN, timestamp: 1700000030000 },
            { value: Number.POSITIVE_INFINITY, timestamp: 1700000045000 },
            { value: Number.NEGATIVE_INFINITY, timestamp: 1700000060000 },
          ],
        },
      ],
    });

    expect(dataPointsOf(metricNamed(translation, "up").metric)).toHaveLength(1);
    expect(translation.samplesWritten).toBe(1);
    expect(translation.samplesDropped).toBe(4);
    // Nothing OTLP JSON cannot carry is left in the body.
    expect(JSON.parse(JSON.stringify(translation.metrics))).toEqual(
      translation.metrics,
    );
  });

  test("a series without a name is dropped", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: labels({ job: "node" }),
          samples: [{ value: 1, timestamp: 1700000000000 }],
        },
      ],
    });

    expect(translation.metrics).toBeNull();
    expect(translation.samplesDropped).toBe(1);
  });

  test("each job and instance is its own resource, and metrics are grouped by name within one", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: labels({ __name__: "up", job: "node", instance: "a:9100" }),
          samples: [{ value: 1, timestamp: 1700000000000 }],
        },
        {
          labels: labels({
            __name__: "up",
            job: "node",
            instance: "a:9100",
            extra: "x",
          }),
          samples: [{ value: 1, timestamp: 1700000000000 }],
        },
        {
          labels: labels({ __name__: "up", job: "node", instance: "b:9100" }),
          samples: [{ value: 0, timestamp: 1700000000000 }],
        },
        {
          labels: labels({ __name__: "up", job: "postgres" }),
          samples: [{ value: 1, timestamp: 1700000000000 }],
        },
      ],
    });

    const resources: Array<JSONObject> = translation.metrics![
      "resourceMetrics"
    ] as Array<JSONObject>;

    expect(resources).toHaveLength(3);

    const first: FlatMetric = metricsOf(translation)[0]!;

    expect(first.resource).toEqual({
      "service.name": "node",
      "service.instance.id": "a:9100",
    });
    expect(dataPointsOf(first.metric)).toHaveLength(2);

    const postgres: FlatMetric | undefined = metricsOf(translation).find(
      (flat: FlatMetric) => {
        return flat.resource["service.name"] === "postgres";
      },
    );

    // No instance label: no service.instance.id.
    expect(postgres!.resource).toEqual({ "service.name": "postgres" });
  });

  test("an x-oneuptime-service-name header names the service instead of the job", () => {
    const translation: PrometheusTranslation = translateV1(
      {
        timeseries: [
          {
            labels: labels({ __name__: "up", job: "node", instance: "a:9100" }),
            samples: [{ value: 1, timestamp: 1700000000000 }],
          },
          {
            labels: labels({
              __name__: "up",
              job: "kube-state",
              instance: "a:9100",
            }),
            samples: [{ value: 1, timestamp: 1700000000000 }],
          },
        ],
      },
      { serviceName: "  payments  " },
    );

    const flats: Array<FlatMetric> = metricsOf(translation);

    expect(
      flats.every((flat: FlatMetric) => {
        return flat.resource["service.name"] === "payments";
      }),
    ).toBe(true);
    // The job is still a label.
    expect(
      attributesOf(dataPointsOf(flats[0]!.metric)[0]!["attributes"])["job"],
    ).toBe("node");
  });

  test("a series with no job has no service.name", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: labels({ __name__: "temperature_celsius" }),
          samples: [{ value: 21.5, timestamp: 1700000000000 }],
        },
      ],
    });

    expect(metricNamed(translation, "temperature_celsius").resource).toEqual(
      {},
    );
  });

  test("a body that is not a WriteRequest is a 400", () => {
    let error: unknown = null;

    try {
      PrometheusRemoteWrite.decode(
        Buffer.from([0x0a, 0xff, 0xff, 0xff, 0xff, 0x0f, 0x01]),
        PrometheusRemoteWriteVersion.V1,
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(PrometheusRemoteWriteError);
    expect((error as PrometheusRemoteWriteError).statusCode).toBe(400);
  });

  test("the whole wire path: protobuf, snappy, decompress, decode, translate", () => {
    const series: Array<JSONObject> = [];

    for (let index: number = 0; index < 500; index++) {
      series.push({
        labels: labels({
          __name__: "node_cpu_seconds_total",
          job: "node",
          instance: `host-${index % 5}:9100`,
          cpu: String(index % 8),
          mode: index % 2 === 0 ? "user" : "system",
        }),
        samples: [{ value: index * 1.5, timestamp: 1700000000000 + index }],
      });
    }

    const compressed: Buffer = snappyCompress(
      Buffer.from(encodeV1({ timeseries: series })),
    );
    const decompressed: Buffer = SnappyBlock.decompress(
      compressed,
      64 * 1024 * 1024,
    );
    const translation: PrometheusTranslation = PrometheusRemoteWrite.toOtlp(
      PrometheusRemoteWrite.decode(
        decompressed,
        PrometheusRemoteWriteVersion.V1,
      ),
    );

    expect(translation.samplesWritten).toBe(500);
    expect(
      translation.metrics!["resourceMetrics"] as Array<JSONObject>,
    ).toHaveLength(5);
  });
});

describe("PrometheusRemoteWrite - remote write 2.0", () => {
  test("labels come from the symbol table and the type from each series' own metadata", () => {
    const symbols: Array<string> = [
      "",
      "__name__",
      "http_server_requests",
      "job",
      "gateway",
      "instance",
      "10.1.1.1:8080",
      "route",
      "/pay",
      "Requests served.",
      "requests",
    ];

    const decoded: PrometheusWriteRequest = PrometheusRemoteWrite.decode(
      encodeV2({
        symbols: symbols,
        timeseries: [
          {
            labelsRefs: [1, 2, 3, 4, 5, 6, 7, 8],
            samples: [{ value: 42, timestamp: 1700000000000 }],
            metadata: { type: 1, helpRef: 9, unitRef: 10 },
            createdTimestamp: 1699990000000,
          },
        ],
      }),
      PrometheusRemoteWriteVersion.V2,
    );
    const translation: PrometheusTranslation =
      PrometheusRemoteWrite.toOtlp(decoded);
    const flat: FlatMetric = metricNamed(translation, "http_server_requests");

    expect(flat.resource).toEqual({
      "service.name": "gateway",
      "service.instance.id": "10.1.1.1:8080",
    });
    expect(flat.metric["sum"]).toMatchObject({ isMonotonic: true });
    expect(flat.metric["description"]).toBe("Requests served.");
    expect(flat.metric["unit"]).toBe("requests");

    const point: JSONObject = dataPointsOf(flat.metric)[0]!;

    // The created timestamp is the counter's start.
    expect(point["startTimeUnixNano"]).toBe("1699990000000000000");
    expect(attributesOf(point["attributes"])).toEqual({
      job: "gateway",
      instance: "10.1.1.1:8080",
      route: "/pay",
    });
  });

  test("a reference past the symbol table reads as an empty string", () => {
    const decoded: PrometheusWriteRequest = PrometheusRemoteWrite.decode(
      encodeV2({
        symbols: ["", "__name__", "up"],
        timeseries: [
          {
            labelsRefs: [1, 2, 99, 98],
            samples: [{ value: 1, timestamp: 1700000000000 }],
          },
        ],
      }),
      PrometheusRemoteWriteVersion.V2,
    );

    expect(decoded.series[0]!.labels).toEqual([
      { name: "__name__", value: "up" },
      { name: "", value: "" },
    ]);
  });
});

describe("PrometheusRemoteWrite - native histograms", () => {
  const nativeHistogramRequest: (
    histogram: JSONObject,
  ) => PrometheusTranslation = (
    histogram: JSONObject,
  ): PrometheusTranslation => {
    return translateV1({
      timeseries: [
        {
          labels: labels({ __name__: "rpc_latency_seconds", job: "rpc" }),
          histograms: [{ timestamp: 1700000000000, ...histogram }],
        },
      ],
    });
  };

  test("an integer histogram becomes an exponential histogram, buckets shifted by one and gaps filled", () => {
    const translation: PrometheusTranslation = nativeHistogramRequest({
      countInt: 13,
      sum: 3.5,
      schema: 3,
      zeroThreshold: 1e-128,
      zeroCountInt: 2,
      // Buckets 2, 3, then a gap of 1, then bucket 5.
      positiveSpans: [
        { offset: 2, length: 2 },
        { offset: 1, length: 1 },
      ],
      positiveDeltas: [4, -1, 2], // counts 4, 3, 5
      negativeSpans: [{ offset: 0, length: 1 }],
      negativeDeltas: [1],
    });

    const flat: FlatMetric = metricNamed(translation, "rpc_latency_seconds");

    expect(flat.metric["exponentialHistogram"]).toMatchObject({
      aggregationTemporality: 2,
    });

    const point: JSONObject = dataPointsOf(flat.metric)[0]!;

    expect(point).toMatchObject({
      timeUnixNano: "1700000000000000000",
      count: "13",
      sum: 3.5,
      scale: 3,
      zeroCount: "2",
      zeroThreshold: 1e-128,
      positive: { offset: 1, bucketCounts: ["4", "3", "0", "5"] },
      negative: { offset: -1, bucketCounts: ["1"] },
    });
    expect(translation.histogramsWritten).toBe(1);
  });

  test("a float histogram's counts are absolute, rounded to whole counts", () => {
    const point: JSONObject = dataPointsOf(
      metricNamed(
        nativeHistogramRequest({
          countFloat: 7.6,
          sum: 1.25,
          schema: 0,
          zeroCountFloat: 0.4,
          positiveSpans: [{ offset: -1, length: 2 }],
          positiveCounts: [2.2, 4.9],
        }),
        "rpc_latency_seconds",
      ).metric,
    )[0]!;

    expect(point).toMatchObject({
      count: "8",
      zeroCount: "0",
      positive: { offset: -2, bucketCounts: ["2", "5"] },
      negative: { offset: -1, bucketCounts: [] },
    });
  });

  test("custom buckets (schema -53) become an explicit-bucket histogram", () => {
    const translation: PrometheusTranslation = nativeHistogramRequest({
      countInt: 6,
      sum: 2,
      schema: -53,
      customValues: [0.1, 0.5, 1],
      positiveSpans: [
        { offset: 0, length: 2 },
        { offset: 1, length: 1 },
      ],
      positiveDeltas: [1, 2, -1], // buckets 0, 1, 3: 1, 3, 2
    });

    const flat: FlatMetric = metricNamed(translation, "rpc_latency_seconds");
    const point: JSONObject = dataPointsOf(flat.metric)[0]!;

    expect(flat.metric).toHaveProperty("histogram");
    expect(point["explicitBounds"]).toEqual([0.1, 0.5, 1]);
    expect(point["bucketCounts"]).toEqual(["1", "3", "0", "2"]);
  });

  test.each<[string, JSONObject]>([
    [
      "spans that disagree with the deltas",
      {
        countInt: 1,
        schema: 0,
        positiveSpans: [{ offset: 0, length: 3 }],
        positiveDeltas: [1],
      },
    ],
    ["a schema OpenTelemetry has no scale for", { countInt: 1, schema: 9 }],
    [
      "a later span with a negative gap",
      {
        countInt: 2,
        schema: 0,
        positiveSpans: [
          { offset: 0, length: 1 },
          { offset: -2, length: 1 },
        ],
        positiveDeltas: [1, 0],
      },
    ],
    [
      "a span list that claims a huge range",
      {
        countInt: 2,
        schema: 0,
        positiveSpans: [
          { offset: 0, length: 1 },
          { offset: 2_000_000_000, length: 1 },
        ],
        positiveDeltas: [1, 0],
      },
    ],
    [
      "custom buckets outside the boundaries",
      {
        countInt: 1,
        schema: -53,
        customValues: [1],
        positiveSpans: [{ offset: 5, length: 1 }],
        positiveDeltas: [1],
      },
    ],
  ])("drops a histogram with %s", (_name: string, histogram: JSONObject) => {
    const translation: PrometheusTranslation =
      nativeHistogramRequest(histogram);

    expect(translation.metrics).toBeNull();
    expect(translation.histogramsWritten).toBe(0);
    expect(translation.samplesDropped).toBe(1);
  });
});
