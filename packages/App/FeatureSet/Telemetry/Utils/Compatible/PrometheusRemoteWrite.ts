import protobuf from "protobufjs";
import path from "path";
import { JSONObject } from "Common/Types/JSON";
import OtlpJson, { OtlpKeyValue } from "./OtlpJson";

/*
 * PROMETHEUS REMOTE WRITE, AS OPENTELEMETRY METRICS.
 *
 * A Prometheus server, Grafana Alloy, the Grafana Agent, VictoriaMetrics'
 * vmagent or the OpenTelemetry Collector's prometheusremotewrite exporter
 * posts its samples here as a snappy-compressed protobuf: remote write 1.0
 * (prometheus.WriteRequest) or 2.0 (io.prometheus.write.v2.Request), told
 * apart by the Content-Type's proto parameter
 * (https://prometheus.io/docs/specs/prw/remote_write_spec_2_0/). Both become
 * one OTLP ExportMetricsServiceRequest, queued like any OTLP export.
 *
 * WHAT A SERIES BECOMES
 *
 * Every series keeps its Prometheus name (http_requests_total stays
 * http_requests_total, so a query moved from Grafana finds it) and its
 * labels as the datapoint's attributes - job and instance included, so a
 * filter on them still works. Following OpenTelemetry's Prometheus
 * compatibility rules, the job is also the service (service.name) and the
 * instance the service instance (service.instance.id); an
 * x-oneuptime-service-name header names the service instead.
 *
 * A series' type comes from its metadata: remote write 2.0 carries it on
 * every series, 1.0 in the metadata a sender includes now and then (and
 * often in a request of its own, with no samples). Without it, the name
 * decides, as Prometheus' own conventions do: _total is a counter, a
 * _bucket with an `le` label is a classic histogram's bucket, and _count /
 * _sum belong to a histogram or summary only when their buckets or
 * quantiles are in the same request. Counters, buckets and counts are
 * cumulative monotonic sums (OneUptime charts their rate); a histogram's or
 * summary's _sum is a cumulative sum that may go down; everything else is a
 * gauge. A classic histogram stays as its _bucket, _count and _sum series
 * rather than being reassembled, because remote write may split one
 * histogram's buckets across requests.
 *
 * A native histogram becomes an exponential histogram: Prometheus' schema
 * is OpenTelemetry's scale, and Prometheus' bucket i, (base^(i-1), base^i],
 * is OpenTelemetry's bucket i-1. One with custom buckets (schema -53)
 * becomes an explicit-bucket histogram.
 *
 * WHAT IS DROPPED
 *
 * A sample whose value is NaN (Prometheus' staleness marker is a NaN) or
 * infinite: OTLP JSON cannot carry one. The _created series of a counter,
 * histogram or summary, which only says when the series began. Exemplars,
 * for now.
 */

export enum PrometheusRemoteWriteVersion {
  V1 = "1.0",
  V2 = "2.0",
}

// A Prometheus metric type, from metadata.
export enum PrometheusMetricType {
  Unknown = "unknown",
  Counter = "counter",
  Gauge = "gauge",
  Histogram = "histogram",
  GaugeHistogram = "gaugehistogram",
  Summary = "summary",
  Info = "info",
  StateSet = "stateset",
}

export class PrometheusRemoteWriteError extends Error {
  public readonly statusCode: number;

  public constructor(statusCode: number, message: string) {
    super(message);
    this.name = "PrometheusRemoteWriteError";
    this.statusCode = statusCode;
  }
}

export interface PrometheusLabel {
  name: string;
  value: string;
}

export interface PrometheusSample {
  value: number;
  timestampMs: number;
}

export interface PrometheusBucketSpan {
  offset: number;
  length: number;
}

export interface PrometheusNativeHistogram {
  // Counts are integers, except in a float histogram (a recording rule's).
  count: number;
  sum: number;
  schema: number;
  zeroThreshold: number;
  zeroCount: number;
  negativeSpans: Array<PrometheusBucketSpan>;
  // Integer histograms: each bucket's count as a delta from the one before.
  negativeDeltas: Array<number>;
  // Float histograms: each bucket's count.
  negativeCounts: Array<number>;
  positiveSpans: Array<PrometheusBucketSpan>;
  positiveDeltas: Array<number>;
  positiveCounts: Array<number>;
  customValues: Array<number>;
  timestampMs: number;
}

export interface PrometheusSeries {
  labels: Array<PrometheusLabel>;
  samples: Array<PrometheusSample>;
  histograms: Array<PrometheusNativeHistogram>;
  // From the series' own metadata (2.0); 1.0's is matched by name later.
  type: PrometheusMetricType;
  help: string;
  unit: string;
  createdTimestampMs: number;
}

export interface PrometheusMetadata {
  type: PrometheusMetricType;
  help: string;
  unit: string;
}

export interface PrometheusWriteRequest {
  series: Array<PrometheusSeries>;
  // Remote write 1.0's metadata, by metric family name.
  metadata: Map<string, PrometheusMetadata>;
}

export interface PrometheusTranslation {
  metrics: JSONObject | null;
  samplesWritten: number;
  histogramsWritten: number;
  // NaN and infinite samples, and _created series.
  samplesDropped: number;
}

// The schema of a native histogram with custom bucket boundaries.
const CUSTOM_BUCKETS_SCHEMA: number = -53;

// Exponential schemas OpenTelemetry can carry as a scale.
const MIN_EXPONENTIAL_SCHEMA: number = -4;
const MAX_EXPONENTIAL_SCHEMA: number = 8;

/*
 * The most buckets one native histogram may expand to. A span list that
 * claims more (its offsets are sint32s) is not expanded into an array that
 * size; the histogram is dropped instead.
 */
const MAX_NATIVE_HISTOGRAM_BUCKETS: number = 16_384;

const PROTO_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "ProtoFiles",
  "Prometheus",
);

const V1Proto: protobuf.Root = protobuf.loadSync(
  path.join(PROTO_DIR, "remote.proto"),
);
const V2Proto: protobuf.Root = protobuf.loadSync(
  path.join(PROTO_DIR, "remote_v2.proto"),
);

export const WriteRequestV1: protobuf.Type = V1Proto.lookupType(
  "prometheus.WriteRequest",
);
export const WriteRequestV2: protobuf.Type = V2Proto.lookupType(
  "io.prometheus.write.v2.Request",
);

const TO_OBJECT_OPTIONS: protobuf.IConversionOptions = {
  longs: Number,
  enums: Number,
  defaults: false,
  arrays: true,
};

// 1.0's and 2.0's metric type enums share their numbers.
const METRIC_TYPE_BY_NUMBER: ReadonlyArray<PrometheusMetricType> = [
  PrometheusMetricType.Unknown,
  PrometheusMetricType.Counter,
  PrometheusMetricType.Gauge,
  PrometheusMetricType.Histogram,
  PrometheusMetricType.GaugeHistogram,
  PrometheusMetricType.Summary,
  PrometheusMetricType.Info,
  PrometheusMetricType.StateSet,
];

// How one series is written as OTLP.
enum OtlpShape {
  Gauge = "gauge",
  MonotonicSum = "monotonic-sum",
  Sum = "sum",
  Skip = "skip",
}

interface MetricAccumulator {
  name: string;
  description: string;
  unit: string;
  shape: OtlpShape | "exponential-histogram" | "histogram";
  dataPoints: Array<JSONObject>;
}

interface ResourceAccumulator {
  attributes: Array<OtlpKeyValue>;
  metrics: Map<string, MetricAccumulator>;
}

export default class PrometheusRemoteWrite {
  /*
   * Which remote write a request is, from its Content-Type: 2.0 says
   * proto=io.prometheus.write.v2.Request; 1.0 says proto=prometheus.
   * WriteRequest or nothing. null for a proto this endpoint does not read.
   */
  public static versionOf(
    contentType: string | undefined,
  ): PrometheusRemoteWriteVersion | null {
    const parameters: Array<string> = (contentType || "")
      .split(";")
      .slice(1)
      .map((parameter: string): string => {
        return parameter.trim();
      });

    for (const parameter of parameters) {
      const separator: number = parameter.indexOf("=");

      if (separator === -1) {
        continue;
      }

      if (parameter.slice(0, separator).trim().toLowerCase() !== "proto") {
        continue;
      }

      const proto: string = parameter
        .slice(separator + 1)
        .trim()
        .replace(/^"|"$/g, "");

      if (proto === "io.prometheus.write.v2.Request") {
        return PrometheusRemoteWriteVersion.V2;
      }

      if (proto === "prometheus.WriteRequest") {
        return PrometheusRemoteWriteVersion.V1;
      }

      return null;
    }

    return PrometheusRemoteWriteVersion.V1;
  }

  // The decompressed protobuf body, read as the version it is.
  public static decode(
    body: Uint8Array,
    version: PrometheusRemoteWriteVersion,
  ): PrometheusWriteRequest {
    let decoded: JSONObject;

    try {
      const type: protobuf.Type =
        version === PrometheusRemoteWriteVersion.V2
          ? WriteRequestV2
          : WriteRequestV1;
      const message: protobuf.Message = type.decode(body);
      decoded = type.toObject(message, TO_OBJECT_OPTIONS) as JSONObject;
    } catch {
      throw new PrometheusRemoteWriteError(
        400,
        `The body is not a remote write ${version} request (a snappy-compressed ${
          version === PrometheusRemoteWriteVersion.V2
            ? "io.prometheus.write.v2.Request"
            : "prometheus.WriteRequest"
        }).`,
      );
    }

    return version === PrometheusRemoteWriteVersion.V2
      ? PrometheusRemoteWrite.fromV2(decoded)
      : PrometheusRemoteWrite.fromV1(decoded);
  }

  public static toOtlp(
    request: PrometheusWriteRequest,
    options?: { serviceName?: string | undefined },
  ): PrometheusTranslation {
    const translation: PrometheusTranslation = {
      metrics: null,
      samplesWritten: 0,
      histogramsWritten: 0,
      samplesDropped: 0,
    };

    // What the request holds of each family, for the name-only rules.
    const names: Set<string> = new Set<string>();
    const quantileFamilies: Set<string> = new Set<string>();

    for (const series of request.series) {
      const name: string = PrometheusRemoteWrite.labelValue(
        series.labels,
        "__name__",
      );
      names.add(name);

      if (PrometheusRemoteWrite.hasLabel(series.labels, "quantile")) {
        quantileFamilies.add(name);
      }
    }

    const resources: Map<string, ResourceAccumulator> = new Map<
      string,
      ResourceAccumulator
    >();
    const serviceOverride: string = (options?.serviceName || "").trim();

    for (const series of request.series) {
      const name: string = PrometheusRemoteWrite.labelValue(
        series.labels,
        "__name__",
      );

      if (!name) {
        translation.samplesDropped += series.samples.length;
        continue;
      }

      const metadata: PrometheusMetadata = PrometheusRemoteWrite.metadataFor(
        series,
        name,
        request.metadata,
      ) || { type: PrometheusMetricType.Unknown, help: "", unit: "" };

      const shape: OtlpShape = PrometheusRemoteWrite.shapeOf(
        name,
        series.labels,
        metadata.type,
        names,
        quantileFamilies,
      );

      if (shape === OtlpShape.Skip) {
        translation.samplesDropped += series.samples.length;
        continue;
      }

      const resource: ResourceAccumulator = PrometheusRemoteWrite.resourceFor(
        resources,
        series.labels,
        serviceOverride,
      );

      const attributes: Array<OtlpKeyValue> = [];

      for (const label of series.labels) {
        if (label.name === "__name__") {
          continue;
        }

        attributes.push({
          key: label.name,
          value: { stringValue: label.value },
        });
      }

      const startTimeUnixNano: string | null =
        series.createdTimestampMs > 0
          ? OtlpJson.millisecondsToUnixNano(series.createdTimestampMs)
          : null;

      if (series.samples.length > 0) {
        const metric: MetricAccumulator = PrometheusRemoteWrite.metricFor(
          resource,
          name,
          shape,
          metadata,
        );

        for (const sample of series.samples) {
          if (
            !Number.isFinite(sample.value) ||
            !Number.isFinite(sample.timestampMs) ||
            sample.timestampMs < 0
          ) {
            translation.samplesDropped++;
            continue;
          }

          const dataPoint: JSONObject = {
            timeUnixNano: OtlpJson.millisecondsToUnixNano(sample.timestampMs),
            asDouble: sample.value,
            attributes: attributes as unknown as JSONObject[],
          };

          if (startTimeUnixNano && shape !== OtlpShape.Gauge) {
            dataPoint["startTimeUnixNano"] = startTimeUnixNano;
          }

          metric.dataPoints.push(dataPoint);
          translation.samplesWritten++;
        }
      }

      for (const histogram of series.histograms) {
        const dataPoint: JSONObject | null =
          PrometheusRemoteWrite.nativeHistogramDataPoint(
            histogram,
            attributes,
            startTimeUnixNano,
          );

        if (!dataPoint) {
          translation.samplesDropped++;
          continue;
        }

        const metric: MetricAccumulator = PrometheusRemoteWrite.metricFor(
          resource,
          name,
          histogram.schema === CUSTOM_BUCKETS_SCHEMA
            ? "histogram"
            : "exponential-histogram",
          metadata,
        );

        metric.dataPoints.push(dataPoint);
        translation.histogramsWritten++;
      }
    }

    translation.metrics = PrometheusRemoteWrite.toExportRequest(resources);

    return translation;
  }

  private static fromV1(decoded: JSONObject): PrometheusWriteRequest {
    const metadata: Map<string, PrometheusMetadata> = new Map<
      string,
      PrometheusMetadata
    >();

    for (const entry of PrometheusRemoteWrite.objects(decoded["metadata"])) {
      const familyName: string = PrometheusRemoteWrite.text(
        entry["metricFamilyName"],
      );

      if (!familyName) {
        continue;
      }

      metadata.set(familyName, {
        type: PrometheusRemoteWrite.metricType(entry["type"]),
        help: PrometheusRemoteWrite.text(entry["help"]),
        unit: PrometheusRemoteWrite.text(entry["unit"]),
      });
    }

    const series: Array<PrometheusSeries> = PrometheusRemoteWrite.objects(
      decoded["timeseries"],
    ).map((timeSeries: JSONObject): PrometheusSeries => {
      return {
        labels: PrometheusRemoteWrite.objects(timeSeries["labels"]).map(
          (label: JSONObject): PrometheusLabel => {
            return {
              name: PrometheusRemoteWrite.text(label["name"]),
              value: PrometheusRemoteWrite.text(label["value"]),
            };
          },
        ),
        samples: PrometheusRemoteWrite.samples(timeSeries["samples"]),
        histograms: PrometheusRemoteWrite.histograms(timeSeries["histograms"]),
        type: PrometheusMetricType.Unknown,
        help: "",
        unit: "",
        createdTimestampMs: 0,
      };
    });

    return { series: series, metadata: metadata };
  }

  private static fromV2(decoded: JSONObject): PrometheusWriteRequest {
    const symbols: Array<string> = Array.isArray(decoded["symbols"])
      ? (decoded["symbols"] as Array<unknown>).map((symbol: unknown) => {
          return PrometheusRemoteWrite.text(symbol);
        })
      : [];

    const symbol: (reference: unknown) => string = (
      reference: unknown,
    ): string => {
      if (typeof reference !== "number" || !Number.isInteger(reference)) {
        return "";
      }

      return symbols[reference] ?? "";
    };

    const series: Array<PrometheusSeries> = PrometheusRemoteWrite.objects(
      decoded["timeseries"],
    ).map((timeSeries: JSONObject): PrometheusSeries => {
      const references: Array<unknown> = Array.isArray(timeSeries["labelsRefs"])
        ? (timeSeries["labelsRefs"] as Array<unknown>)
        : [];

      const labels: Array<PrometheusLabel> = [];

      for (let index: number = 0; index + 1 < references.length; index += 2) {
        labels.push({
          name: symbol(references[index]),
          value: symbol(references[index + 1]),
        });
      }

      const metadata: JSONObject =
        timeSeries["metadata"] &&
        typeof timeSeries["metadata"] === "object" &&
        !Array.isArray(timeSeries["metadata"])
          ? (timeSeries["metadata"] as JSONObject)
          : {};

      const created: unknown = timeSeries["createdTimestamp"];

      return {
        labels: labels,
        samples: PrometheusRemoteWrite.samples(timeSeries["samples"]),
        histograms: PrometheusRemoteWrite.histograms(timeSeries["histograms"]),
        type: PrometheusRemoteWrite.metricType(metadata["type"]),
        help: symbol(metadata["helpRef"]),
        unit: symbol(metadata["unitRef"]),
        createdTimestampMs:
          typeof created === "number" && Number.isFinite(created) && created > 0
            ? created
            : 0,
      };
    });

    return { series: series, metadata: new Map<string, PrometheusMetadata>() };
  }

  /*
   * The metadata that describes a series: its own (2.0), else 1.0's for
   * its name, else for the family its suffix belongs to (http_requests for
   * http_requests_total; latency for latency_bucket, _count and _sum).
   */
  private static metadataFor(
    series: PrometheusSeries,
    name: string,
    metadata: Map<string, PrometheusMetadata>,
  ): PrometheusMetadata | null {
    if (series.type !== PrometheusMetricType.Unknown) {
      return { type: series.type, help: series.help, unit: series.unit };
    }

    const exact: PrometheusMetadata | undefined = metadata.get(name);

    if (exact) {
      return exact;
    }

    for (const suffix of [
      "_total",
      "_bucket",
      "_count",
      "_sum",
      "_created",
      "_gcount",
      "_gsum",
      "_info",
    ]) {
      if (name.endsWith(suffix)) {
        const family: PrometheusMetadata | undefined = metadata.get(
          name.slice(0, -suffix.length),
        );

        if (family) {
          return family;
        }
      }
    }

    return null;
  }

  private static shapeOf(
    name: string,
    labels: Array<PrometheusLabel>,
    type: PrometheusMetricType,
    names: Set<string>,
    quantileFamilies: Set<string>,
  ): OtlpShape {
    switch (type) {
      case PrometheusMetricType.Counter:
        return name.endsWith("_created")
          ? OtlpShape.Skip
          : OtlpShape.MonotonicSum;
      case PrometheusMetricType.Histogram:
        if (name.endsWith("_created")) {
          return OtlpShape.Skip;
        }

        return name.endsWith("_sum") ? OtlpShape.Sum : OtlpShape.MonotonicSum;
      case PrometheusMetricType.Summary:
        if (name.endsWith("_created")) {
          return OtlpShape.Skip;
        }

        if (name.endsWith("_count")) {
          return OtlpShape.MonotonicSum;
        }

        return name.endsWith("_sum") ? OtlpShape.Sum : OtlpShape.Gauge;
      case PrometheusMetricType.Gauge:
      case PrometheusMetricType.GaugeHistogram:
      case PrometheusMetricType.Info:
      case PrometheusMetricType.StateSet:
        return OtlpShape.Gauge;
      default:
        break;
    }

    // No metadata: Prometheus' naming conventions.
    if (name.endsWith("_total")) {
      return OtlpShape.MonotonicSum;
    }

    if (
      name.endsWith("_bucket") &&
      PrometheusRemoteWrite.hasLabel(labels, "le")
    ) {
      return OtlpShape.MonotonicSum;
    }

    for (const suffix of ["_count", "_sum"]) {
      if (!name.endsWith(suffix)) {
        continue;
      }

      const family: string = name.slice(0, -suffix.length);

      if (names.has(`${family}_bucket`) || quantileFamilies.has(family)) {
        return suffix === "_count" ? OtlpShape.MonotonicSum : OtlpShape.Sum;
      }
    }

    return OtlpShape.Gauge;
  }

  private static resourceFor(
    resources: Map<string, ResourceAccumulator>,
    labels: Array<PrometheusLabel>,
    serviceOverride: string,
  ): ResourceAccumulator {
    const job: string = PrometheusRemoteWrite.labelValue(labels, "job");
    const instance: string = PrometheusRemoteWrite.labelValue(
      labels,
      "instance",
    );
    const serviceName: string = serviceOverride || job;
    const key: string = JSON.stringify([serviceName, instance]);

    let resource: ResourceAccumulator | undefined = resources.get(key);

    if (!resource) {
      const attributes: Array<OtlpKeyValue> = [];

      OtlpJson.pushAll(
        attributes,
        OtlpJson.stringAttribute("service.name", serviceName),
        OtlpJson.stringAttribute("service.instance.id", instance),
      );

      resource = {
        attributes: attributes,
        metrics: new Map<string, MetricAccumulator>(),
      };
      resources.set(key, resource);
    }

    return resource;
  }

  private static metricFor(
    resource: ResourceAccumulator,
    name: string,
    shape: MetricAccumulator["shape"],
    metadata: PrometheusMetadata,
  ): MetricAccumulator {
    const key: string = `${shape}\u0000${name}`;
    let metric: MetricAccumulator | undefined = resource.metrics.get(key);

    if (!metric) {
      metric = {
        name: name,
        description: metadata.help,
        unit: metadata.unit,
        shape: shape,
        dataPoints: [],
      };
      resource.metrics.set(key, metric);
    }

    return metric;
  }

  /*
   * A native histogram as an OTLP exponential (or, with custom buckets,
   * explicit) histogram datapoint; null for one that cannot be read.
   */
  private static nativeHistogramDataPoint(
    histogram: PrometheusNativeHistogram,
    attributes: Array<OtlpKeyValue>,
    startTimeUnixNano: string | null,
  ): JSONObject | null {
    if (
      !Number.isFinite(histogram.timestampMs) ||
      histogram.timestampMs < 0 ||
      !Number.isFinite(histogram.count) ||
      histogram.count < 0 ||
      !Number.isFinite(histogram.sum)
    ) {
      return null;
    }

    const isFloat: boolean =
      histogram.positiveCounts.length > 0 ||
      histogram.negativeCounts.length > 0;

    const positive: { offset: number; counts: Array<number> } | null =
      PrometheusRemoteWrite.expandBuckets(
        histogram.positiveSpans,
        isFloat ? histogram.positiveCounts : histogram.positiveDeltas,
        isFloat,
      );
    const negative: { offset: number; counts: Array<number> } | null =
      PrometheusRemoteWrite.expandBuckets(
        histogram.negativeSpans,
        isFloat ? histogram.negativeCounts : histogram.negativeDeltas,
        isFloat,
      );

    if (!positive || !negative) {
      return null;
    }

    const dataPoint: JSONObject = {
      timeUnixNano: OtlpJson.millisecondsToUnixNano(histogram.timestampMs),
      count: String(Math.round(histogram.count)),
      sum: histogram.sum,
      attributes: attributes as unknown as JSONObject[],
    };

    if (startTimeUnixNano) {
      dataPoint["startTimeUnixNano"] = startTimeUnixNano;
    }

    if (histogram.schema === CUSTOM_BUCKETS_SCHEMA) {
      const bounds: Array<number> = histogram.customValues.filter(
        (bound: number): boolean => {
          return Number.isFinite(bound);
        },
      );

      if (bounds.length !== histogram.customValues.length) {
        return null;
      }

      // Bucket i is (bounds[i-1], bounds[i]]; the last one is (last, +Inf].
      const bucketCounts: Array<string> = new Array<string>(
        bounds.length + 1,
      ).fill("0");

      for (let index: number = 0; index < positive.counts.length; index++) {
        const bucket: number = positive.offset + index;

        if (bucket < 0 || bucket > bounds.length) {
          return null;
        }

        bucketCounts[bucket] = String(Math.round(positive.counts[index]!));
      }

      dataPoint["explicitBounds"] = bounds;
      dataPoint["bucketCounts"] = bucketCounts;

      return dataPoint;
    }

    if (
      !Number.isInteger(histogram.schema) ||
      histogram.schema < MIN_EXPONENTIAL_SCHEMA ||
      histogram.schema > MAX_EXPONENTIAL_SCHEMA
    ) {
      return null;
    }

    dataPoint["scale"] = histogram.schema;
    dataPoint["zeroCount"] = String(
      Math.max(0, Math.round(histogram.zeroCount)),
    );

    if (
      Number.isFinite(histogram.zeroThreshold) &&
      histogram.zeroThreshold > 0
    ) {
      dataPoint["zeroThreshold"] = histogram.zeroThreshold;
    }

    // Prometheus' bucket i is OpenTelemetry's bucket i - 1.
    dataPoint["positive"] = {
      offset: positive.offset - 1,
      bucketCounts: positive.counts.map((count: number): string => {
        return String(Math.max(0, Math.round(count)));
      }),
    };
    dataPoint["negative"] = {
      offset: negative.offset - 1,
      bucketCounts: negative.counts.map((count: number): string => {
        return String(Math.max(0, Math.round(count)));
      }),
    };

    return dataPoint;
  }

  /*
   * Spans and per-bucket deltas (or counts) as one dense run of bucket
   * counts from the first bucket's index, gaps filled with zeros. The first
   * span's offset is the first bucket's index; each later span's is the gap
   * after the span before it. null when the spans and the counts disagree.
   */
  private static expandBuckets(
    spans: Array<PrometheusBucketSpan>,
    values: Array<number>,
    isAbsolute: boolean,
  ): { offset: number; counts: Array<number> } | null {
    const total: number = spans.reduce(
      (sum: number, span: PrometheusBucketSpan): number => {
        return sum + span.length;
      },
      0,
    );

    if (total !== values.length) {
      return null;
    }

    if (spans.length === 0) {
      return { offset: 0, counts: [] };
    }

    const offset: number = spans[0]!.offset;
    const counts: Array<number> = [];
    let valueIndex: number = 0;
    let current: number = 0;

    for (let spanIndex: number = 0; spanIndex < spans.length; spanIndex++) {
      const span: PrometheusBucketSpan = spans[spanIndex]!;

      if (spanIndex > 0) {
        if (span.offset < 0) {
          return null;
        }

        for (let gap: number = 0; gap < span.offset; gap++) {
          counts.push(0);

          if (counts.length > MAX_NATIVE_HISTOGRAM_BUCKETS) {
            return null;
          }
        }
      }

      for (let index: number = 0; index < span.length; index++) {
        const value: number = values[valueIndex]!;
        valueIndex++;

        if (!Number.isFinite(value)) {
          return null;
        }

        current = isAbsolute ? value : current + value;
        counts.push(current);

        if (counts.length > MAX_NATIVE_HISTOGRAM_BUCKETS) {
          return null;
        }
      }
    }

    return { offset: offset, counts: counts };
  }

  private static toExportRequest(
    resources: Map<string, ResourceAccumulator>,
  ): JSONObject | null {
    const resourceMetrics: Array<JSONObject> = [];

    for (const resource of resources.values()) {
      const metrics: Array<JSONObject> = [];

      for (const metric of resource.metrics.values()) {
        if (metric.dataPoints.length === 0) {
          continue;
        }

        const otlpMetric: JSONObject = { name: metric.name };

        if (metric.description) {
          otlpMetric["description"] = metric.description;
        }

        if (metric.unit) {
          otlpMetric["unit"] = metric.unit;
        }

        const dataPoints: JSONObject[] = metric.dataPoints;

        if (metric.shape === OtlpShape.Gauge) {
          otlpMetric["gauge"] = { dataPoints: dataPoints };
        } else if (metric.shape === "exponential-histogram") {
          otlpMetric["exponentialHistogram"] = {
            aggregationTemporality: 2,
            dataPoints: dataPoints,
          };
        } else if (metric.shape === "histogram") {
          otlpMetric["histogram"] = {
            aggregationTemporality: 2,
            dataPoints: dataPoints,
          };
        } else {
          otlpMetric["sum"] = {
            aggregationTemporality: 2,
            isMonotonic: metric.shape === OtlpShape.MonotonicSum,
            dataPoints: dataPoints,
          };
        }

        metrics.push(otlpMetric);
      }

      if (metrics.length === 0) {
        continue;
      }

      resourceMetrics.push({
        resource: {
          attributes: resource.attributes as unknown as JSONObject[],
        },
        scopeMetrics: [
          {
            scope: { name: "prometheus-remote-write" },
            metrics: metrics,
          },
        ],
      });
    }

    if (resourceMetrics.length === 0) {
      return null;
    }

    return { resourceMetrics: resourceMetrics };
  }

  private static samples(value: unknown): Array<PrometheusSample> {
    return PrometheusRemoteWrite.objects(value).map(
      (sample: JSONObject): PrometheusSample => {
        return {
          value: PrometheusRemoteWrite.number(sample["value"], 0),
          timestampMs: PrometheusRemoteWrite.number(sample["timestamp"], 0),
        };
      },
    );
  }

  private static histograms(value: unknown): Array<PrometheusNativeHistogram> {
    return PrometheusRemoteWrite.objects(value).map(
      (histogram: JSONObject): PrometheusNativeHistogram => {
        const spans: (spansValue: unknown) => Array<PrometheusBucketSpan> = (
          spansValue: unknown,
        ): Array<PrometheusBucketSpan> => {
          return PrometheusRemoteWrite.objects(spansValue).map(
            (span: JSONObject): PrometheusBucketSpan => {
              return {
                offset: PrometheusRemoteWrite.number(span["offset"], 0),
                length: PrometheusRemoteWrite.number(span["length"], 0),
              };
            },
          );
        };

        const numbers: (numbersValue: unknown) => Array<number> = (
          numbersValue: unknown,
        ): Array<number> => {
          return Array.isArray(numbersValue)
            ? numbersValue.map((item: unknown): number => {
                return PrometheusRemoteWrite.number(item, Number.NaN);
              })
            : [];
        };

        return {
          count:
            histogram["countFloat"] !== undefined
              ? PrometheusRemoteWrite.number(histogram["countFloat"], 0)
              : PrometheusRemoteWrite.number(histogram["countInt"], 0),
          sum: PrometheusRemoteWrite.number(histogram["sum"], 0),
          schema: PrometheusRemoteWrite.number(histogram["schema"], 0),
          zeroThreshold: PrometheusRemoteWrite.number(
            histogram["zeroThreshold"],
            0,
          ),
          zeroCount:
            histogram["zeroCountFloat"] !== undefined
              ? PrometheusRemoteWrite.number(histogram["zeroCountFloat"], 0)
              : PrometheusRemoteWrite.number(histogram["zeroCountInt"], 0),
          negativeSpans: spans(histogram["negativeSpans"]),
          negativeDeltas: numbers(histogram["negativeDeltas"]),
          negativeCounts: numbers(histogram["negativeCounts"]),
          positiveSpans: spans(histogram["positiveSpans"]),
          positiveDeltas: numbers(histogram["positiveDeltas"]),
          positiveCounts: numbers(histogram["positiveCounts"]),
          customValues: numbers(histogram["customValues"]),
          timestampMs: PrometheusRemoteWrite.number(histogram["timestamp"], 0),
        };
      },
    );
  }

  private static metricType(value: unknown): PrometheusMetricType {
    if (typeof value === "number" && Number.isInteger(value)) {
      return METRIC_TYPE_BY_NUMBER[value] ?? PrometheusMetricType.Unknown;
    }

    return PrometheusMetricType.Unknown;
  }

  private static labelValue(
    labels: Array<PrometheusLabel>,
    name: string,
  ): string {
    for (const label of labels) {
      if (label.name === name) {
        return label.value;
      }
    }

    return "";
  }

  private static hasLabel(
    labels: Array<PrometheusLabel>,
    name: string,
  ): boolean {
    return labels.some((label: PrometheusLabel): boolean => {
      return label.name === name;
    });
  }

  private static objects(value: unknown): Array<JSONObject> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item: unknown): item is JSONObject => {
      return Boolean(item) && typeof item === "object" && !Array.isArray(item);
    });
  }

  private static text(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  private static number(value: unknown, fallback: number): number {
    return typeof value === "number" ? value : fallback;
  }
}
