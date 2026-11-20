import protobuf from "protobufjs";
import path from "path";
import { JSONObject } from "Common/Types/JSON";
import { PROMETHEUS_REMOTE_WRITE_MAX_ELEMENTS } from "Common/Types/Telemetry/CompatibleIngest";
import OtlpJson, { OtlpKeyValue } from "./OtlpJson";
import ProtobufElementCounter, {
  ProtobufCountSchema,
  ProtobufElementCount,
  ProtobufElementCountOutcome,
} from "./ProtobufElementCount";

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
 * x-oneuptime-service-name header names the service instead. A label with
 * an empty value is no label, as in Prometheus.
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
 * gauge. A counter's start (2.0's start_timestamp, or an older sender's
 * created_timestamp) is its points' start time.
 *
 * A classic histogram stays as its _bucket, _count and _sum series rather
 * than being folded into one histogram point: a sender shards its series
 * over parallel requests by series, so one histogram's buckets arrive in
 * different requests, often at different servers. Its _bucket series is
 * read as one histogram where it is charted instead - a percentile in the
 * Metrics explorer (MetricService) and histogram_quantile in PromQL - and
 * both see every bucket, wherever it arrived.
 *
 * A native histogram becomes an exponential histogram: Prometheus' schema
 * is OpenTelemetry's scale, and Prometheus' bucket i, (base^(i-1), base^i],
 * is OpenTelemetry's bucket i-1. One with custom buckets (schema -53)
 * becomes an explicit-bucket histogram.
 *
 * EXEMPLARS
 *
 * An exemplar that names a trace (a trace_id label, as the specification
 * asks, or traceID) links its series' datapoint to that trace and span: the
 * metric store keeps one trace and span ID a datapoint, which the Metrics
 * explorer draws as a dot to open. Prometheus sends an exemplar in a series
 * of its own, beside the samples of the same labels, so an exemplar is
 * matched to the datapoint of its labels nearest its time anywhere in the
 * request; one whose datapoint is in another request, or that names no
 * trace, has nowhere to be kept.
 *
 * WHAT IS ACCEPTED BUT NOT STORED
 *
 * A sample whose value is NaN (Prometheus' staleness marker is a NaN) or
 * infinite, which OTLP JSON cannot carry, and the _created series of a
 * counter, histogram or summary, which only says when the series began.
 * They are counted as written: nothing is wrong with them, and a sender
 * that heard otherwise would count them as failed.
 *
 * WHAT IS REFUSED
 *
 * Data neither version allows: a series with no metric name or a label with
 * no name (or, in 2.0, a label reference outside the symbols), a sample
 * with a negative timestamp, a native histogram whose buckets cannot be
 * read. The rest of the request is still queued, and the endpoint answers
 * 400 with what was refused, as both specifications ask of a partial write.
 *
 * LIMITS
 *
 * A body is counted before it is decoded (ProtobufElementCount): one that
 * would become more than PROMETHEUS_REMOTE_WRITE_MAX_ELEMENTS objects is
 * refused with 413 without being decoded.
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

// Why a series, a sample or a histogram was refused.
export enum PrometheusRefusalReason {
  MissingName = "missing-name",
  InvalidLabels = "invalid-labels",
  InvalidTimestamp = "invalid-timestamp",
  UnreadableHistogram = "unreadable-histogram",
}

/*
 * How a refusal is said in the answer's plain text, which senders log:
 * after "Refused 2 samples" or "Refused 1 native histogram".
 */
const REFUSAL_WORDS: Record<PrometheusRefusalReason, string> = {
  [PrometheusRefusalReason.MissingName]:
    "of series with no metric name (__name__)",
  [PrometheusRefusalReason.InvalidLabels]:
    "of series with a label that has no name, or a label reference outside the symbols",
  [PrometheusRefusalReason.InvalidTimestamp]: "with a negative timestamp",
  [PrometheusRefusalReason.UnreadableHistogram]:
    "whose buckets cannot be read",
};

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
  // 2.0's start_timestamp: when the counter began; 0 when it is not set.
  startTimestampMs: number;
}

export interface PrometheusExemplar {
  labels: Array<PrometheusLabel>;
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
  // 2.0's start_timestamp: 0 when it is not set.
  startTimestampMs: number;
}

export interface PrometheusSeries {
  labels: Array<PrometheusLabel>;
  samples: Array<PrometheusSample>;
  histograms: Array<PrometheusNativeHistogram>;
  exemplars: Array<PrometheusExemplar>;
  // From the series' own metadata (2.0); 1.0's is matched by name later.
  type: PrometheusMetricType;
  help: string;
  unit: string;
  // An older 2.0 sender's series-wide created_timestamp; 0 when not set.
  createdTimestampMs: number;
  // Set when the labels could not be read (2.0's references).
  invalidLabels: boolean;
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

export interface PrometheusRefusalCount {
  samples: number;
  histograms: number;
}

export interface PrometheusTranslation {
  metrics: JSONObject | null;
  /*
   * What was accepted, as 2.0's X-Prometheus-Remote-Write-*-Written
   * headers count it: samples and histograms stored or accepted without
   * being stored (see samplesSkipped), and exemplars stored.
   */
  samplesWritten: number;
  histogramsWritten: number;
  exemplarsWritten: number;
  // Accepted, not stored: NaN and infinite values (staleness markers), _created series.
  samplesSkipped: number;
  // Refused as invalid, by why.
  refused: Map<PrometheusRefusalReason, PrometheusRefusalCount>;
}

// The schema of a native histogram with custom bucket boundaries.
const CUSTOM_BUCKETS_SCHEMA: number = -53;

// Exponential schemas OpenTelemetry can carry as a scale.
const MIN_EXPONENTIAL_SCHEMA: number = -4;
const MAX_EXPONENTIAL_SCHEMA: number = 8;

/*
 * The most buckets one native histogram may expand to. A span list that
 * claims more (its offsets are sint32s) is not expanded into an array that
 * size; the histogram is refused instead.
 */
const MAX_NATIVE_HISTOGRAM_BUCKETS: number = 16_384;

// The exemplar labels that name a trace and a span, in lower case.
const TRACE_ID_LABELS: ReadonlySet<string> = new Set<string>([
  "trace_id",
  "traceid",
]);
const SPAN_ID_LABELS: ReadonlySet<string> = new Set<string>([
  "span_id",
  "spanid",
]);

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

/*
 * What each version decodes into an object, for the count taken before it
 * is decoded: messages, and every value of a repeated field.
 */
const BUCKET_SPAN_COUNT: ProtobufCountSchema = {};
const HISTOGRAM_COUNT: ProtobufCountSchema = {
  messages: { 8: BUCKET_SPAN_COUNT, 11: BUCKET_SPAN_COUNT },
  varints: new Set<number>([9, 12]),
  fixed64s: new Set<number>([10, 13, 16]),
};
const V1_LABEL_COUNT: ProtobufCountSchema = {};

export const REMOTE_WRITE_V1_COUNT: ProtobufCountSchema = {
  messages: {
    // timeseries: labels, samples, exemplars (with labels), histograms.
    1: {
      messages: {
        1: V1_LABEL_COUNT,
        2: {},
        3: { messages: { 1: V1_LABEL_COUNT } },
        4: HISTOGRAM_COUNT,
      },
    },
    // metadata
    3: {},
  },
};

export const REMOTE_WRITE_V2_COUNT: ProtobufCountSchema = {
  // symbols
  strings: new Set<number>([4]),
  messages: {
    // timeseries: label references, samples, histograms, exemplars, metadata.
    5: {
      varints: new Set<number>([1]),
      messages: {
        2: {},
        3: HISTOGRAM_COUNT,
        4: { varints: new Set<number>([1]) },
        5: {},
      },
    },
  },
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

// A datapoint an exemplar of its series may be kept on.
interface ExemplarTarget {
  timestampMs: number;
  dataPoint: JSONObject;
  // How far the kept exemplar's time is from the datapoint's.
  keptDistanceMs: number;
}

export default class PrometheusRemoteWrite {
  /*
   * Which remote write a request is, from its Content-Type: 2.0 says
   * proto=io.prometheus.write.v2.Request; 1.0 says proto=prometheus.
   * WriteRequest or nothing. null for a proto this endpoint does not read.
   * Other parameters (2.0's mode=stateless) change nothing here.
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

  /*
   * The decompressed protobuf body, read as the version it is. Counted
   * first: a body that would decode into more than `maxElements` objects is
   * refused with 413, and one that is not that version's message with 400,
   * before anything is decoded.
   */
  public static decode(
    body: Uint8Array,
    version: PrometheusRemoteWriteVersion,
    options?: { maxElements?: number | undefined },
  ): PrometheusWriteRequest {
    const maxElements: number =
      options?.maxElements ?? PROMETHEUS_REMOTE_WRITE_MAX_ELEMENTS;
    const notAWriteRequest: () => PrometheusRemoteWriteError =
      (): PrometheusRemoteWriteError => {
        return new PrometheusRemoteWriteError(
          400,
          `The body is not a remote write ${version} request (a snappy-compressed ${
            version === PrometheusRemoteWriteVersion.V2
              ? "io.prometheus.write.v2.Request"
              : "prometheus.WriteRequest"
          }).`,
        );
      };

    const count: ProtobufElementCount = ProtobufElementCounter.count(
      body,
      version === PrometheusRemoteWriteVersion.V2
        ? REMOTE_WRITE_V2_COUNT
        : REMOTE_WRITE_V1_COUNT,
      maxElements,
    );

    if (count.outcome === ProtobufElementCountOutcome.OverLimit) {
      throw new PrometheusRemoteWriteError(
        413,
        `The request holds more than ${maxElements} series, labels, samples, exemplars and histogram buckets. Send fewer samples a request: lower queue_config's max_samples_per_send.`,
      );
    }

    if (count.outcome === ProtobufElementCountOutcome.Malformed) {
      throw notAWriteRequest();
    }

    let decoded: JSONObject;

    try {
      const type: protobuf.Type =
        version === PrometheusRemoteWriteVersion.V2
          ? WriteRequestV2
          : WriteRequestV1;
      const message: protobuf.Message = type.decode(body);
      decoded = type.toObject(message, TO_OBJECT_OPTIONS) as JSONObject;
    } catch {
      throw notAWriteRequest();
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
      exemplarsWritten: 0,
      samplesSkipped: 0,
      refused: new Map<PrometheusRefusalReason, PrometheusRefusalCount>(),
    };

    const refuse: (
      reason: PrometheusRefusalReason,
      samples: number,
      histograms: number,
    ) => void = (
      reason: PrometheusRefusalReason,
      samples: number,
      histograms: number,
    ): void => {
      if (samples === 0 && histograms === 0) {
        return;
      }

      const count: PrometheusRefusalCount = translation.refused.get(reason) || {
        samples: 0,
        histograms: 0,
      };
      count.samples += samples;
      count.histograms += histograms;
      translation.refused.set(reason, count);
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

      if (PrometheusRemoteWrite.labelValue(series.labels, "quantile")) {
        quantileFamilies.add(name);
      }
    }

    const resources: Map<string, ResourceAccumulator> = new Map<
      string,
      ResourceAccumulator
    >();
    const serviceOverride: string = (options?.serviceName || "").trim();

    // Each stored datapoint, by its series' labels, for the exemplars.
    const targets: Map<string, Array<ExemplarTarget>> = new Map<
      string,
      Array<ExemplarTarget>
    >();
    const exemplarsBySeries: Map<string, Array<PrometheusExemplar>> = new Map<
      string,
      Array<PrometheusExemplar>
    >();

    for (const series of request.series) {
      const name: string = PrometheusRemoteWrite.labelValue(
        series.labels,
        "__name__",
      );

      if (series.invalidLabels || PrometheusRemoteWrite.hasUnnamedLabel(series)) {
        refuse(
          PrometheusRefusalReason.InvalidLabels,
          series.samples.length,
          series.histograms.length,
        );
        continue;
      }

      if (!name) {
        refuse(
          PrometheusRefusalReason.MissingName,
          series.samples.length,
          series.histograms.length,
        );
        continue;
      }

      const seriesKey: string = PrometheusRemoteWrite.seriesKey(series.labels);

      if (series.exemplars.length > 0) {
        const pending: Array<PrometheusExemplar> =
          exemplarsBySeries.get(seriesKey) || [];
        pending.push(...series.exemplars);
        exemplarsBySeries.set(seriesKey, pending);
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
        // A _created series: accepted, and nothing in it to store.
        let invalid: number = 0;

        for (const sample of series.samples) {
          if (PrometheusRemoteWrite.isValidTimestamp(sample.timestampMs)) {
            translation.samplesWritten++;
            translation.samplesSkipped++;
          } else {
            invalid++;
          }
        }

        refuse(PrometheusRefusalReason.InvalidTimestamp, invalid, 0);
        continue;
      }

      const resource: ResourceAccumulator = PrometheusRemoteWrite.resourceFor(
        resources,
        series.labels,
        serviceOverride,
      );

      const attributes: Array<OtlpKeyValue> = [];

      for (const label of series.labels) {
        if (label.name === "__name__" || label.value === "") {
          continue;
        }

        attributes.push({
          key: label.name,
          value: { stringValue: label.value },
        });
      }

      const seriesTargets: Array<ExemplarTarget> =
        targets.get(seriesKey) || [];
      targets.set(seriesKey, seriesTargets);

      if (series.samples.length > 0) {
        const metric: MetricAccumulator = PrometheusRemoteWrite.metricFor(
          resource,
          name,
          shape,
          metadata,
        );
        let invalid: number = 0;

        for (const sample of series.samples) {
          if (!PrometheusRemoteWrite.isValidTimestamp(sample.timestampMs)) {
            invalid++;
            continue;
          }

          // Accepted either way: a staleness marker is no fault.
          translation.samplesWritten++;

          if (!Number.isFinite(sample.value)) {
            translation.samplesSkipped++;
            continue;
          }

          const dataPoint: JSONObject = {
            timeUnixNano: OtlpJson.millisecondsToUnixNano(sample.timestampMs),
            asDouble: sample.value,
            attributes: attributes as unknown as JSONObject[],
          };

          const startTimestampMs: number =
            PrometheusRemoteWrite.startOf(
              sample.startTimestampMs,
              sample.timestampMs,
            ) ||
            PrometheusRemoteWrite.startOf(
              series.createdTimestampMs,
              sample.timestampMs,
            );

          if (startTimestampMs > 0 && shape !== OtlpShape.Gauge) {
            dataPoint["startTimeUnixNano"] =
              OtlpJson.millisecondsToUnixNano(startTimestampMs);
          }

          metric.dataPoints.push(dataPoint);
          seriesTargets.push({
            timestampMs: sample.timestampMs,
            dataPoint: dataPoint,
            keptDistanceMs: Number.POSITIVE_INFINITY,
          });
        }

        refuse(PrometheusRefusalReason.InvalidTimestamp, invalid, 0);
      }

      for (const histogram of series.histograms) {
        if (!PrometheusRemoteWrite.isValidTimestamp(histogram.timestampMs)) {
          refuse(PrometheusRefusalReason.InvalidTimestamp, 0, 1);
          continue;
        }

        /*
         * A stale native histogram carries a NaN sum, and one may have
         * observed an infinity: accepted, with nothing OTLP JSON can carry.
         */
        if (!Number.isFinite(histogram.sum) || !Number.isFinite(histogram.count)) {
          translation.histogramsWritten++;
          continue;
        }

        const startTimestampMs: number =
          PrometheusRemoteWrite.startOf(
            histogram.startTimestampMs,
            histogram.timestampMs,
          ) ||
          PrometheusRemoteWrite.startOf(
            series.createdTimestampMs,
            histogram.timestampMs,
          );

        const dataPoint: JSONObject | null =
          PrometheusRemoteWrite.nativeHistogramDataPoint(
            histogram,
            attributes,
            startTimestampMs > 0
              ? OtlpJson.millisecondsToUnixNano(startTimestampMs)
              : null,
          );

        if (!dataPoint) {
          refuse(PrometheusRefusalReason.UnreadableHistogram, 0, 1);
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
        seriesTargets.push({
          timestampMs: histogram.timestampMs,
          dataPoint: dataPoint,
          keptDistanceMs: Number.POSITIVE_INFINITY,
        });
        translation.histogramsWritten++;
      }
    }

    translation.exemplarsWritten = PrometheusRemoteWrite.attachExemplars(
      exemplarsBySeries,
      targets,
    );
    translation.metrics = PrometheusRemoteWrite.toExportRequest(resources);

    return translation;
  }

  /*
   * What was refused, as the plain text a 400 answers with (senders log
   * it as it is), or null when nothing was.
   */
  public static describeRefusals(
    translation: PrometheusTranslation,
  ): string | null {
    if (translation.refused.size === 0) {
      return null;
    }

    const parts: Array<string> = [];

    for (const [reason, count] of translation.refused) {
      const items: Array<string> = [];

      if (count.samples > 0) {
        items.push(
          `${count.samples} ${count.samples === 1 ? "sample" : "samples"}`,
        );
      }

      if (count.histograms > 0) {
        items.push(
          `${count.histograms} native ${
            count.histograms === 1 ? "histogram" : "histograms"
          }`,
        );
      }

      parts.push(`${items.join(" and ")} ${REFUSAL_WORDS[reason]}`);
    }

    return `Refused ${parts.join("; ")}. The rest of the request (${translation.samplesWritten} samples and ${translation.histogramsWritten} native histograms) was accepted.`;
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

    const v1Labels: (value: unknown) => Array<PrometheusLabel> = (
      value: unknown,
    ): Array<PrometheusLabel> => {
      return PrometheusRemoteWrite.objects(value).map(
        (label: JSONObject): PrometheusLabel => {
          return {
            name: PrometheusRemoteWrite.text(label["name"]),
            value: PrometheusRemoteWrite.text(label["value"]),
          };
        },
      );
    };

    const series: Array<PrometheusSeries> = PrometheusRemoteWrite.objects(
      decoded["timeseries"],
    ).map((timeSeries: JSONObject): PrometheusSeries => {
      return {
        labels: v1Labels(timeSeries["labels"]),
        samples: PrometheusRemoteWrite.samples(timeSeries["samples"]),
        histograms: PrometheusRemoteWrite.histograms(timeSeries["histograms"]),
        exemplars: PrometheusRemoteWrite.objects(timeSeries["exemplars"]).map(
          (exemplar: JSONObject): PrometheusExemplar => {
            return {
              labels: v1Labels(exemplar["labels"]),
              value: PrometheusRemoteWrite.number(exemplar["value"], 0),
              timestampMs: PrometheusRemoteWrite.number(
                exemplar["timestamp"],
                0,
              ),
            };
          },
        ),
        type: PrometheusMetricType.Unknown,
        help: "",
        unit: "",
        createdTimestampMs: 0,
        invalidLabels: false,
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

    const symbol: (reference: unknown) => string | null = (
      reference: unknown,
    ): string | null => {
      if (typeof reference !== "number" || !Number.isInteger(reference)) {
        return null;
      }

      return symbols[reference] ?? null;
    };

    // Label pairs from references; null when one does not resolve.
    const labelsOf: (value: unknown) => Array<PrometheusLabel> | null = (
      value: unknown,
    ): Array<PrometheusLabel> | null => {
      const references: Array<unknown> = Array.isArray(value)
        ? (value as Array<unknown>)
        : [];

      if (references.length % 2 !== 0) {
        return null;
      }

      const labels: Array<PrometheusLabel> = [];

      for (let index: number = 0; index < references.length; index += 2) {
        const name: string | null = symbol(references[index]);
        const labelValue: string | null = symbol(references[index + 1]);

        if (name === null || labelValue === null) {
          return null;
        }

        labels.push({ name: name, value: labelValue });
      }

      return labels;
    };

    const series: Array<PrometheusSeries> = PrometheusRemoteWrite.objects(
      decoded["timeseries"],
    ).map((timeSeries: JSONObject): PrometheusSeries => {
      const labels: Array<PrometheusLabel> | null = labelsOf(
        timeSeries["labelsRefs"],
      );

      const metadata: JSONObject =
        timeSeries["metadata"] &&
        typeof timeSeries["metadata"] === "object" &&
        !Array.isArray(timeSeries["metadata"])
          ? (timeSeries["metadata"] as JSONObject)
          : {};

      const created: unknown = timeSeries["createdTimestamp"];

      const exemplars: Array<PrometheusExemplar> = [];

      for (const exemplar of PrometheusRemoteWrite.objects(
        timeSeries["exemplars"],
      )) {
        const exemplarLabels: Array<PrometheusLabel> | null = labelsOf(
          exemplar["labelsRefs"],
        );

        // An exemplar whose labels do not resolve names no trace.
        if (!exemplarLabels) {
          continue;
        }

        exemplars.push({
          labels: exemplarLabels,
          value: PrometheusRemoteWrite.number(exemplar["value"], 0),
          timestampMs: PrometheusRemoteWrite.number(exemplar["timestamp"], 0),
        });
      }

      return {
        labels: labels || [],
        samples: PrometheusRemoteWrite.samples(timeSeries["samples"]),
        histograms: PrometheusRemoteWrite.histograms(timeSeries["histograms"]),
        exemplars: exemplars,
        type: PrometheusRemoteWrite.metricType(metadata["type"]),
        help: symbol(metadata["helpRef"]) ?? "",
        unit: symbol(metadata["unitRef"]) ?? "",
        createdTimestampMs:
          typeof created === "number" && Number.isFinite(created) && created > 0
            ? created
            : 0,
        invalidLabels: labels === null,
      };
    });

    return { series: series, metadata: new Map<string, PrometheusMetadata>() };
  }

  /*
   * Keeps each exemplar that names a trace on the datapoint of its series
   * nearest its time (the later one on a tie: the scrape that counted it),
   * at most one a datapoint - the store keeps one trace and span a
   * datapoint - the nearest in time winning. Returns how many were kept.
   */
  private static attachExemplars(
    exemplarsBySeries: Map<string, Array<PrometheusExemplar>>,
    targets: Map<string, Array<ExemplarTarget>>,
  ): number {
    const kept: Set<ExemplarTarget> = new Set<ExemplarTarget>();

    for (const [seriesKey, exemplars] of exemplarsBySeries) {
      const seriesTargets: Array<ExemplarTarget> | undefined =
        targets.get(seriesKey);

      if (!seriesTargets || seriesTargets.length === 0) {
        continue;
      }

      for (const exemplar of exemplars) {
        const otlp: JSONObject | null =
          PrometheusRemoteWrite.otlpExemplar(exemplar);

        if (!otlp) {
          continue;
        }

        let nearest: ExemplarTarget | null = null;
        let nearestDistance: number = Number.POSITIVE_INFINITY;

        for (const target of seriesTargets) {
          const distance: number = Math.abs(
            target.timestampMs - exemplar.timestampMs,
          );

          if (
            distance < nearestDistance ||
            (distance === nearestDistance &&
              nearest !== null &&
              target.timestampMs > nearest.timestampMs)
          ) {
            nearest = target;
            nearestDistance = distance;
          }
        }

        if (!nearest || nearestDistance >= nearest.keptDistanceMs) {
          continue;
        }

        nearest.dataPoint["exemplars"] = [otlp];
        nearest.keptDistanceMs = nearestDistance;
        kept.add(nearest);
      }
    }

    return kept.size;
  }

  // An exemplar as OTLP JSON, or null when it names no trace.
  private static otlpExemplar(exemplar: PrometheusExemplar): JSONObject | null {
    let traceId: string = "";
    let spanId: string = "";
    const filtered: Array<OtlpKeyValue> = [];

    for (const label of exemplar.labels) {
      const name: string = label.name.toLowerCase();

      if (TRACE_ID_LABELS.has(name) && !traceId) {
        traceId = OtlpJson.hexId(label.value, 32);

        if (traceId) {
          continue;
        }
      }

      if (SPAN_ID_LABELS.has(name) && !spanId) {
        spanId = OtlpJson.hexId(label.value, 16);

        if (spanId) {
          continue;
        }
      }

      if (label.name && label.value) {
        filtered.push({ key: label.name, value: { stringValue: label.value } });
      }
    }

    if (!traceId) {
      return null;
    }

    const otlp: JSONObject = {
      timeUnixNano: OtlpJson.millisecondsToUnixNano(exemplar.timestampMs),
      traceId: traceId,
    };

    if (spanId) {
      otlp["spanId"] = spanId;
    }

    if (Number.isFinite(exemplar.value)) {
      otlp["asDouble"] = exemplar.value;
    }

    if (filtered.length > 0) {
      otlp["filteredAttributes"] = filtered as unknown as JSONObject[];
    }

    return otlp;
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
      PrometheusRemoteWrite.labelValue(labels, "le")
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
          startTimestampMs: PrometheusRemoteWrite.number(
            sample["startTimestamp"],
            0,
          ),
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
          startTimestampMs: PrometheusRemoteWrite.number(
            histogram["startTimestamp"],
            0,
          ),
        };
      },
    );
  }

  // A sample's time: milliseconds since the epoch, never before it.
  private static isValidTimestamp(timestampMs: number): boolean {
    return Number.isFinite(timestampMs) && timestampMs >= 0;
  }

  // A start time a point can carry: set, and not after the point itself.
  private static startOf(startMs: number, timestampMs: number): number {
    return Number.isFinite(startMs) && startMs > 0 && startMs <= timestampMs
      ? startMs
      : 0;
  }

  // A series' identity: its labels, in name order.
  private static seriesKey(labels: Array<PrometheusLabel>): string {
    const pairs: Array<[string, string]> = labels
      .filter((label: PrometheusLabel): boolean => {
        return label.value !== "";
      })
      .map((label: PrometheusLabel): [string, string] => {
        return [label.name, label.value];
      })
      .sort((a: [string, string], b: [string, string]): number => {
        if (a[0] === b[0]) {
          return 0;
        }

        return a[0] < b[0] ? -1 : 1;
      });

    return JSON.stringify(pairs);
  }

  // A label named "" (an empty value is only an absent label).
  private static hasUnnamedLabel(series: PrometheusSeries): boolean {
    return series.labels.some((label: PrometheusLabel): boolean => {
      return label.name === "" && label.value !== "";
    });
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
