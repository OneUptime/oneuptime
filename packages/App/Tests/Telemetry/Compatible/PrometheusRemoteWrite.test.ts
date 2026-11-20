import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import PrometheusRemoteWrite, {
  PrometheusRefusalReason,
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
    expect(translation.samplesSkipped).toBe(0);
    expect(translation.refused.size).toBe(0);
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
    // Accepted, as a sender is told, but not stored.
    expect(translation.samplesWritten).toBe(3);
    expect(translation.samplesSkipped).toBe(1);
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

  test("staleness markers, NaN and infinities are accepted, counted as written, and not stored", () => {
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
    /*
     * A sender is told they were written: a staleness marker is no fault,
     * and Prometheus counts what it is not told was written as failed.
     */
    expect(translation.samplesWritten).toBe(5);
    expect(translation.samplesSkipped).toBe(4);
    expect(translation.refused.size).toBe(0);
    // Nothing OTLP JSON cannot carry is left in the body.
    expect(JSON.parse(JSON.stringify(translation.metrics))).toEqual(
      translation.metrics,
    );
  });

  test("a series without a name is refused, and said so", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: labels({ job: "node" }),
          samples: [{ value: 1, timestamp: 1700000000000 }],
        },
        {
          labels: labels({ __name__: "up", job: "node" }),
          samples: [{ value: 1, timestamp: 1700000000000 }],
        },
      ],
    });

    expect(metricsOf(translation)).toHaveLength(1);
    expect(translation.samplesWritten).toBe(1);
    expect(translation.refused.get(PrometheusRefusalReason.MissingName)).toEqual(
      { samples: 1, histograms: 0 },
    );
    expect(PrometheusRemoteWrite.describeRefusals(translation)).toBe(
      "Refused 1 sample of series with no metric name (__name__). The rest of the request (1 samples and 0 native histograms) was accepted.",
    );
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

  test("a reference past the symbol table makes the series invalid, and it is refused", () => {
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

    expect(decoded.series[0]!.invalidLabels).toBe(true);

    const translation: PrometheusTranslation =
      PrometheusRemoteWrite.toOtlp(decoded);

    expect(translation.metrics).toBeNull();
    expect(
      translation.refused.get(PrometheusRefusalReason.InvalidLabels),
    ).toEqual({ samples: 1, histograms: 0 });
  });

  test("an odd number of label references is invalid too", () => {
    const decoded: PrometheusWriteRequest = PrometheusRemoteWrite.decode(
      encodeV2({
        symbols: ["", "__name__", "up", "job"],
        timeseries: [
          {
            labelsRefs: [1, 2, 3],
            samples: [{ value: 1, timestamp: 1700000000000 }],
          },
        ],
      }),
      PrometheusRemoteWriteVersion.V2,
    );

    expect(decoded.series[0]!.invalidLabels).toBe(true);
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
  ])("refuses a histogram with %s", (_name: string, histogram: JSONObject) => {
    const translation: PrometheusTranslation =
      nativeHistogramRequest(histogram);

    expect(translation.metrics).toBeNull();
    expect(translation.histogramsWritten).toBe(0);
    expect(
      translation.refused.get(PrometheusRefusalReason.UnreadableHistogram),
    ).toEqual({ samples: 0, histograms: 1 });
  });

  test("a negative count is refused", () => {
    const translation: PrometheusTranslation = nativeHistogramRequest({
      countFloat: -1,
      sum: 1,
      schema: 0,
    });

    expect(
      translation.refused.get(PrometheusRefusalReason.UnreadableHistogram),
    ).toEqual({ samples: 0, histograms: 1 });
  });

  test("a stale native histogram (a NaN sum) is accepted and not stored", () => {
    const translation: PrometheusTranslation = nativeHistogramRequest({
      countInt: 0,
      sum: STALE_NAN,
      schema: 0,
    });

    expect(translation.metrics).toBeNull();
    expect(translation.histogramsWritten).toBe(1);
    expect(translation.refused.size).toBe(0);
  });
});

const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID: string = "00f067aa0ba902b7";

// The exemplar kept on a datapoint, or undefined.
const exemplarOf: (point: JSONObject) => JSONObject | undefined = (
  point: JSONObject,
): JSONObject | undefined => {
  const exemplars: Array<JSONObject> | undefined = point["exemplars"] as
    | Array<JSONObject>
    | undefined;

  if (!exemplars) {
    return undefined;
  }

  expect(exemplars).toHaveLength(1);

  return exemplars[0];
};

describe("PrometheusRemoteWrite - exemplars (remote write 1.0)", () => {
  const counter: Labels = {
    __name__: "http_requests_total",
    job: "checkout",
    instance: "10.0.0.7:9090",
    code: "500",
  };

  test("an exemplar sent in a series of its own, as Prometheus sends it, is kept on its series' datapoint", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: labels(counter),
          samples: [{ value: 1027, timestamp: 1700000015000 }],
        },
        {
          labels: labels({ ...counter, code: "200" }),
          samples: [{ value: 5, timestamp: 1700000015000 }],
        },
        {
          labels: labels(counter),
          exemplars: [
            {
              labels: labels({
                trace_id: TRACE_ID,
                span_id: SPAN_ID,
                user: "alice",
              }),
              value: 1,
              timestamp: 1700000012345,
            },
          ],
        },
      ],
    });

    const points: Array<JSONObject> = dataPointsOf(
      metricNamed(translation, "http_requests_total").metric,
    );

    expect(points).toHaveLength(2);
    expect(exemplarOf(points[0]!)).toEqual({
      timeUnixNano: "1700000012345000000",
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      asDouble: 1,
      filteredAttributes: [{ key: "user", value: { stringValue: "alice" } }],
    });
    // The other series' datapoint has none.
    expect(exemplarOf(points[1]!)).toBeUndefined();
    expect(translation.exemplarsWritten).toBe(1);
  });

  test("an exemplar in the same series as its samples (the OpenTelemetry Collector's exporter) is kept too", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: labels(counter),
          samples: [{ value: 1027, timestamp: 1700000015000 }],
          exemplars: [
            {
              labels: labels({ trace_id: TRACE_ID }),
              value: 1,
              timestamp: 1700000014000,
            },
          ],
        },
      ],
    });

    const point: JSONObject = dataPointsOf(
      metricNamed(translation, "http_requests_total").metric,
    )[0]!;

    expect(exemplarOf(point)).toMatchObject({ traceId: TRACE_ID });
    expect(exemplarOf(point)!["spanId"]).toBeUndefined();
    expect(translation.exemplarsWritten).toBe(1);
  });

  test("it goes to the datapoint nearest its time, and one datapoint keeps the nearest of its exemplars", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: labels(counter),
          samples: [
            { value: 1, timestamp: 1700000000000 },
            { value: 2, timestamp: 1700000015000 },
          ],
        },
        {
          labels: labels(counter),
          exemplars: [
            {
              labels: labels({ trace_id: "1".repeat(32) }),
              value: 1,
              timestamp: 1700000010000,
            },
            {
              labels: labels({ trace_id: "2".repeat(32) }),
              value: 1,
              timestamp: 1700000014900,
            },
            {
              labels: labels({ trace_id: "3".repeat(32) }),
              value: 1,
              timestamp: 1700000001000,
            },
          ],
        },
      ],
    });

    const points: Array<JSONObject> = dataPointsOf(
      metricNamed(translation, "http_requests_total").metric,
    );

    // 14.9 s is nearer 15 s than 10 s is; 1 s is nearest 0 s.
    expect(exemplarOf(points[1]!)!["traceId"]).toBe("2".repeat(32));
    expect(exemplarOf(points[0]!)!["traceId"]).toBe("3".repeat(32));
    expect(translation.exemplarsWritten).toBe(2);
  });

  test("halfway between two datapoints, the later one keeps it: the scrape that counted it", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: labels(counter),
          samples: [
            { value: 1, timestamp: 1700000000000 },
            { value: 2, timestamp: 1700000010000 },
          ],
          exemplars: [
            {
              labels: labels({ trace_id: TRACE_ID }),
              value: 1,
              timestamp: 1700000005000,
            },
          ],
        },
      ],
    });

    const points: Array<JSONObject> = dataPointsOf(
      metricNamed(translation, "http_requests_total").metric,
    );

    expect(exemplarOf(points[0]!)).toBeUndefined();
    expect(exemplarOf(points[1]!)).toBeDefined();
  });

  test.each<[string, Labels, string]>([
    ["traceID, as Grafana names it", { traceID: TRACE_ID }, TRACE_ID],
    [
      "a 64-bit trace ID, zero-padded as OpenTelemetry pads it",
      { trace_id: "a3ce929d0e0e4736" },
      "0000000000000000a3ce929d0e0e4736",
    ],
    ["upper-case hex", { trace_id: TRACE_ID.toUpperCase() }, TRACE_ID],
    [
      "a trace ID written with hyphens",
      { TraceId: "4bf92f35-77b3-4da6-a3ce-929d0e0e4736" },
      TRACE_ID,
    ],
  ])("reads %s", (_name: string, exemplarLabels: Labels, traceId: string) => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: labels(counter),
          samples: [{ value: 1, timestamp: 1700000000000 }],
          exemplars: [
            {
              labels: labels(exemplarLabels),
              value: 1,
              timestamp: 1700000000000,
            },
          ],
        },
      ],
    });

    expect(
      exemplarOf(
        dataPointsOf(
          metricNamed(translation, "http_requests_total").metric,
        )[0]!,
      )!["traceId"],
    ).toBe(traceId);
  });

  test.each<[string, JSONObject]>([
    [
      "names no trace",
      { labels: labels({ request_id: "r-42" }), value: 1, timestamp: 1 },
    ],
    [
      "names a trace that is not hex",
      { labels: labels({ trace_id: "not-a-trace" }), value: 1, timestamp: 1 },
    ],
    [
      "names the all-zero trace",
      { labels: labels({ trace_id: "0".repeat(32) }), value: 1, timestamp: 1 },
    ],
    [
      "names a trace longer than 128 bits",
      { labels: labels({ trace_id: "a".repeat(40) }), value: 1, timestamp: 1 },
    ],
  ])(
    "keeps nothing of an exemplar that %s",
    (_name: string, exemplar: JSONObject) => {
      const translation: PrometheusTranslation = translateV1({
        timeseries: [
          {
            labels: labels(counter),
            samples: [{ value: 1, timestamp: 1700000000000 }],
            exemplars: [exemplar],
          },
        ],
      });

      expect(
        exemplarOf(
          dataPointsOf(
            metricNamed(translation, "http_requests_total").metric,
          )[0]!,
        ),
      ).toBeUndefined();
      expect(translation.exemplarsWritten).toBe(0);
    },
  );

  test("an exemplar whose series has no datapoint in the request (or only a staleness marker) has nowhere to be kept", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: labels({ ...counter, code: "404" }),
          samples: [{ value: STALE_NAN, timestamp: 1700000000000 }],
        },
        {
          labels: labels({ ...counter, code: "404" }),
          exemplars: [
            {
              labels: labels({ trace_id: TRACE_ID }),
              value: 1,
              timestamp: 1700000000000,
            },
          ],
        },
        {
          labels: labels({ ...counter, code: "503" }),
          exemplars: [
            {
              labels: labels({ trace_id: TRACE_ID }),
              value: 1,
              timestamp: 1700000000000,
            },
          ],
        },
      ],
    });

    expect(translation.metrics).toBeNull();
    expect(translation.exemplarsWritten).toBe(0);
    // The exemplars are not samples, and refuse nothing.
    expect(translation.refused.size).toBe(0);
  });

  test("an exemplar of a classic histogram's bucket is kept on that bucket's datapoint", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        ...["0.1", "0.5", "+Inf"].map((le: string, index: number) => {
          return {
            labels: labels({
              __name__: "latency_seconds_bucket",
              job: "api",
              le: le,
            }),
            samples: [{ value: index + 1, timestamp: 1700000000000 }],
          };
        }),
        {
          labels: labels({
            __name__: "latency_seconds_bucket",
            job: "api",
            le: "0.5",
          }),
          exemplars: [
            {
              labels: labels({ trace_id: TRACE_ID }),
              value: 0.37,
              timestamp: 1699999999000,
            },
          ],
        },
      ],
    });

    const points: Array<JSONObject> = dataPointsOf(
      metricNamed(translation, "latency_seconds_bucket").metric,
    );

    expect(
      points.map((point: JSONObject) => {
        return exemplarOf(point)?.["asDouble"];
      }),
    ).toEqual([undefined, 0.37, undefined]);
  });

  test("an exemplar of a native histogram is kept on its datapoint", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: labels({ __name__: "rpc_latency_seconds", job: "rpc" }),
          histograms: [
            {
              countInt: 1,
              sum: 0.2,
              schema: 0,
              positiveSpans: [{ offset: 0, length: 1 }],
              positiveDeltas: [1],
              timestamp: 1700000000000,
            },
          ],
          exemplars: [
            {
              labels: labels({ trace_id: TRACE_ID, span_id: SPAN_ID }),
              value: 0.2,
              timestamp: 1700000000000,
            },
          ],
        },
      ],
    });

    expect(
      exemplarOf(
        dataPointsOf(
          metricNamed(translation, "rpc_latency_seconds").metric,
        )[0]!,
      ),
    ).toMatchObject({ traceId: TRACE_ID, spanId: SPAN_ID, asDouble: 0.2 });
    expect(translation.exemplarsWritten).toBe(1);
  });

  test("an exemplar's NaN value is left out, its trace kept", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: labels(counter),
          samples: [{ value: 1, timestamp: 1700000000000 }],
          exemplars: [
            {
              labels: labels({ trace_id: TRACE_ID }),
              value: Number.NaN,
              timestamp: 1700000000000,
            },
          ],
        },
      ],
    });

    const exemplar: JSONObject = exemplarOf(
      dataPointsOf(metricNamed(translation, "http_requests_total").metric)[0]!,
    )!;

    expect(exemplar["traceId"]).toBe(TRACE_ID);
    expect(exemplar).not.toHaveProperty("asDouble");
    expect(JSON.parse(JSON.stringify(translation.metrics))).toEqual(
      translation.metrics,
    );
  });
});

describe("PrometheusRemoteWrite - exemplars and start times (remote write 2.0)", () => {
  const symbols: Array<string> = [
    "",
    "__name__",
    "http_requests_total",
    "job",
    "checkout",
    "trace_id",
    TRACE_ID,
    "span_id",
    SPAN_ID,
  ];

  test("an exemplar-only series, as Prometheus sends 2.0 too, is kept on the datapoint of the same labels", () => {
    const translation: PrometheusTranslation = PrometheusRemoteWrite.toOtlp(
      PrometheusRemoteWrite.decode(
        encodeV2({
          symbols: symbols,
          timeseries: [
            {
              labelsRefs: [1, 2, 3, 4],
              samples: [{ value: 7, timestamp: 1700000000000 }],
              metadata: { type: 1 },
            },
            {
              labelsRefs: [1, 2, 3, 4],
              exemplars: [
                {
                  labelsRefs: [5, 6, 7, 8],
                  value: 1,
                  timestamp: 1699999999000,
                },
              ],
              metadata: { type: 1 },
            },
          ],
        }),
        PrometheusRemoteWriteVersion.V2,
      ),
    );

    expect(
      exemplarOf(
        dataPointsOf(
          metricNamed(translation, "http_requests_total").metric,
        )[0]!,
      ),
    ).toEqual({
      timeUnixNano: "1699999999000000000",
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      asDouble: 1,
    });
    expect(translation.exemplarsWritten).toBe(1);
  });

  test("an exemplar whose label references do not resolve is not kept, and refuses nothing", () => {
    const translation: PrometheusTranslation = PrometheusRemoteWrite.toOtlp(
      PrometheusRemoteWrite.decode(
        encodeV2({
          symbols: symbols,
          timeseries: [
            {
              labelsRefs: [1, 2, 3, 4],
              samples: [{ value: 7, timestamp: 1700000000000 }],
              exemplars: [
                { labelsRefs: [5, 99], value: 1, timestamp: 1700000000000 },
              ],
            },
          ],
        }),
        PrometheusRemoteWriteVersion.V2,
      ),
    );

    expect(translation.exemplarsWritten).toBe(0);
    expect(translation.samplesWritten).toBe(1);
    expect(translation.refused.size).toBe(0);
  });

  test("a sample's start_timestamp is its start time, before an older sender's created_timestamp", () => {
    const translation: PrometheusTranslation = PrometheusRemoteWrite.toOtlp(
      PrometheusRemoteWrite.decode(
        encodeV2({
          symbols: symbols,
          timeseries: [
            {
              labelsRefs: [1, 2, 3, 4],
              samples: [
                {
                  value: 7,
                  timestamp: 1700000000000,
                  startTimestamp: 1699000000000,
                },
                { value: 8, timestamp: 1700000015000 },
                // A start after the sample is no start.
                {
                  value: 9,
                  timestamp: 1700000030000,
                  startTimestamp: 1700000099000,
                },
              ],
              metadata: { type: 1 },
              createdTimestamp: 1698000000000,
            },
          ],
        }),
        PrometheusRemoteWriteVersion.V2,
      ),
    );

    expect(
      dataPointsOf(metricNamed(translation, "http_requests_total").metric).map(
        (point: JSONObject) => {
          return point["startTimeUnixNano"];
        },
      ),
    ).toEqual([
      "1699000000000000000",
      "1698000000000000000",
      "1698000000000000000",
    ]);
  });

  test("a native histogram's start_timestamp is its start time; a gauge has none", () => {
    const translation: PrometheusTranslation = PrometheusRemoteWrite.toOtlp(
      PrometheusRemoteWrite.decode(
        encodeV2({
          symbols: [...symbols, "rpc_latency_seconds", "temperature"],
          timeseries: [
            {
              labelsRefs: [1, 9, 3, 4],
              histograms: [
                {
                  countInt: 1,
                  sum: 0.2,
                  schema: 0,
                  positiveSpans: [{ offset: 0, length: 1 }],
                  positiveDeltas: [1],
                  timestamp: 1700000000000,
                  startTimestamp: 1699000000000,
                },
              ],
              metadata: { type: 3 },
            },
            {
              labelsRefs: [1, 10, 3, 4],
              samples: [
                {
                  value: 21,
                  timestamp: 1700000000000,
                  startTimestamp: 1699000000000,
                },
              ],
              metadata: { type: 2 },
            },
          ],
        }),
        PrometheusRemoteWriteVersion.V2,
      ),
    );

    expect(
      dataPointsOf(metricNamed(translation, "rpc_latency_seconds").metric)[0]![
        "startTimeUnixNano"
      ],
    ).toBe("1699000000000000000");
    expect(
      dataPointsOf(metricNamed(translation, "temperature").metric)[0]!,
    ).not.toHaveProperty("startTimeUnixNano");
  });
});

describe("PrometheusRemoteWrite - what is refused (partial writes)", () => {
  test("a sample with a negative timestamp is refused; the series' other samples are kept", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: labels({ __name__: "up", job: "node" }),
          samples: [
            { value: 1, timestamp: -5 },
            { value: 1, timestamp: 1700000000000 },
          ],
        },
      ],
    });

    expect(dataPointsOf(metricNamed(translation, "up").metric)).toHaveLength(
      1,
    );
    expect(translation.samplesWritten).toBe(1);
    expect(
      translation.refused.get(PrometheusRefusalReason.InvalidTimestamp),
    ).toEqual({ samples: 1, histograms: 0 });
  });

  test("a series with a label that has no name is refused", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: [
            { name: "__name__", value: "up" },
            { name: "", value: "orphan" },
          ],
          samples: [{ value: 1, timestamp: 1700000000000 }],
        },
      ],
    });

    expect(translation.metrics).toBeNull();
    expect(
      translation.refused.get(PrometheusRefusalReason.InvalidLabels),
    ).toEqual({ samples: 1, histograms: 0 });
  });

  test("a label with an empty value is no label, as in Prometheus, and refuses nothing", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: labels({ __name__: "up", job: "node", zone: "" }),
          samples: [{ value: 1, timestamp: 1700000000000 }],
        },
      ],
    });

    expect(
      attributesOf(
        dataPointsOf(metricNamed(translation, "up").metric)[0]!["attributes"],
      ),
    ).toEqual({ job: "node" });
    expect(translation.refused.size).toBe(0);
  });

  test("the answer names every reason, with how many samples and histograms each refused", () => {
    const translation: PrometheusTranslation = translateV1({
      timeseries: [
        {
          labels: labels({ job: "node" }),
          samples: [
            { value: 1, timestamp: 1700000000000 },
            { value: 2, timestamp: 1700000015000 },
          ],
          histograms: [{ countInt: 1, schema: 0, timestamp: 1700000000000 }],
        },
        {
          labels: labels({ __name__: "up", job: "node" }),
          samples: [
            { value: 1, timestamp: -1 },
            { value: 1, timestamp: 1700000000000 },
          ],
        },
      ],
    });

    expect(PrometheusRemoteWrite.describeRefusals(translation)).toBe(
      "Refused 2 samples and 1 native histogram of series with no metric name (__name__); 1 sample with a negative timestamp. The rest of the request (1 samples and 0 native histograms) was accepted.",
    );
  });

  test("nothing refused, nothing said", () => {
    expect(
      PrometheusRemoteWrite.describeRefusals(
        translateV1({
          timeseries: [
            {
              labels: labels({ __name__: "up" }),
              samples: [{ value: 1, timestamp: 1700000000000 }],
            },
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe("PrometheusRemoteWrite - a body is counted before it is decoded", () => {
  // N empty series: two bytes each on the wire, an object each decoded.
  const emptySeries: (count: number) => Buffer = (count: number): Buffer => {
    const body: Buffer = Buffer.alloc(count * 2);

    for (let index: number = 0; index < count; index++) {
      body[index * 2] = 0x0a;
      body[index * 2 + 1] = 0x00;
    }

    return body;
  };

  test("a body that would be more objects than allowed is a 413, and never decoded", () => {
    const decode: jest.SpyInstance = jest.spyOn(WriteRequestV1, "decode");
    let error: unknown = null;

    try {
      PrometheusRemoteWrite.decode(
        emptySeries(1001),
        PrometheusRemoteWriteVersion.V1,
        { maxElements: 1000 },
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(PrometheusRemoteWriteError);
    expect((error as PrometheusRemoteWriteError).statusCode).toBe(413);
    expect((error as Error).message).toContain("max_samples_per_send");
    expect(decode).not.toHaveBeenCalled();
    decode.mockRestore();
  });

  test("at the limit it is decoded", () => {
    expect(
      PrometheusRemoteWrite.decode(
        emptySeries(1000),
        PrometheusRemoteWriteVersion.V1,
        { maxElements: 1000 },
      ).series,
    ).toHaveLength(1000);
  });

  test("labels, samples, exemplars and their labels all count", () => {
    const body: Uint8Array = encodeV1({
      timeseries: [
        {
          // 1 series + 3 labels + 2 samples + 1 exemplar + 1 exemplar label.
          labels: labels({ __name__: "up", job: "node", zone: "a" }),
          samples: [
            { value: 1, timestamp: 1700000000000 },
            { value: 1, timestamp: 1700000015000 },
          ],
          exemplars: [
            { labels: labels({ trace_id: TRACE_ID }), value: 1, timestamp: 1 },
          ],
        },
      ],
    });

    expect(() => {
      PrometheusRemoteWrite.decode(body, PrometheusRemoteWriteVersion.V1, {
        maxElements: 8,
      });
    }).not.toThrow();
    expect(() => {
      PrometheusRemoteWrite.decode(body, PrometheusRemoteWriteVersion.V1, {
        maxElements: 7,
      });
    }).toThrow(PrometheusRemoteWriteError);
  });

  test("2.0's symbols and label references count", () => {
    const body: Uint8Array = encodeV2({
      // 4 symbols + 1 series + 4 references + 1 sample.
      symbols: ["", "__name__", "up", "job"],
      timeseries: [
        {
          labelsRefs: [1, 2, 3, 2],
          samples: [{ value: 1, timestamp: 1700000000000 }],
        },
      ],
    });

    expect(() => {
      PrometheusRemoteWrite.decode(body, PrometheusRemoteWriteVersion.V2, {
        maxElements: 10,
      });
    }).not.toThrow();
    expect(() => {
      PrometheusRemoteWrite.decode(body, PrometheusRemoteWriteVersion.V2, {
        maxElements: 9,
      });
    }).toThrow(PrometheusRemoteWriteError);
  });

  test("by default a 32 MiB body of empty series is refused, in well under a second and without decoding", () => {
    const decode: jest.SpyInstance = jest.spyOn(WriteRequestV1, "decode");
    const startedAt: number = Date.now();
    let error: unknown = null;

    try {
      PrometheusRemoteWrite.decode(
        emptySeries(16 * 1024 * 1024),
        PrometheusRemoteWriteVersion.V1,
      );
    } catch (caught) {
      error = caught;
    }

    expect((error as PrometheusRemoteWriteError).statusCode).toBe(413);
    expect(decode).not.toHaveBeenCalled();
    // It stops counting once past the limit.
    expect(Date.now() - startedAt).toBeLessThan(1000);
    decode.mockRestore();
  });

  test("a body that is not the version's message is a 400 before it is decoded", () => {
    const decode: jest.SpyInstance = jest.spyOn(WriteRequestV1, "decode");
    let error: unknown = null;

    try {
      // A timeseries field that says it is longer than the body.
      PrometheusRemoteWrite.decode(
        Buffer.from([0x0a, 0x7f, 0x0a, 0x00]),
        PrometheusRemoteWriteVersion.V1,
      );
    } catch (caught) {
      error = caught;
    }

    expect((error as PrometheusRemoteWriteError).statusCode).toBe(400);
    expect(decode).not.toHaveBeenCalled();
    decode.mockRestore();
  });
});
