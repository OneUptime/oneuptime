import AIInsightSeverity from "../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../Types/AI/AIInsightType";
import {
  MetricInsightAttributeEvidence,
  MetricInsightEvidence,
} from "../../Types/AI/AIInsightEvidence";
import FeedMarkdown, { mdText, MarkdownText } from "../Markdown/FeedMarkdown";
import {
  SERVICE_LANGUAGE_DISPLAY_NAMES,
  ServiceLanguage,
} from "../../Types/Service/ServiceLanguage";
import { SPAN_METRICS_NAMESPACE } from "./SpanMetricsCollectorStep";
import type { SpanKind } from "../../Models/AnalyticsModels/Span";

/*
 * PROBLEMS IN A SERVICE'S METRICS WORTH TELLING SOMEONE ABOUT - the gates the
 * Metrics product's detector files its AI insights by (Server/Utils/AI/SRE/
 * Insights/Detectors/MetricProblemDetector), and that OneUptime AI then looks
 * into and opens a pull request for, as the project's metric AI rules say
 * (Types/AI/TelemetryAi). "Improve metrics / log metrics currently doesn't
 * exist" - the maintainer. Four kinds:
 *
 *   - High cardinality (MetricHighCardinality), in one of two shapes:
 *       Attribute: one of the project's busiest metrics, in a service, has
 *         an attribute its code sets - not one of the resource's or the
 *         scope's, nor OneUptime's own - that took 1,000 or more values in
 *         the hour: ids, full URLs, timestamps. Every value is a series of
 *         its own, so the metric costs more to store and its charts and
 *         monitors slow down - and past the SDK's own cardinality limit
 *         (2,000 series by default) the SDK folds new series into one
 *         overflow series, so its numbers are wrong too;
 *       Name: 50 or more of a service's metric names sent in the hour are
 *         one name once the ids in them are collapsed ("job.{id}.duration"):
 *         each id is a metric of its own;
 *
 *   - Wrong histogram buckets (MetricHistogramBuckets): one of the busiest
 *     metrics is a histogram that recorded 1,000 or more values, and 90% or
 *     more of them fell in its smallest bucket or above its largest one -
 *     or it has no buckets at all - so its percentiles cannot be told apart:
 *     every chart and monitor reads the same number whatever the values
 *     were. Usually the buckets were made for another unit (the SDKs'
 *     default buckets are milliseconds; a duration recorded in seconds fits
 *     in their first one);
 *
 *   - Missing metrics (MetricMissingMetrics): a service that sent 1,000 or
 *     more spans in the hour but has never sent a metric, so nothing charts
 *     or alerts on its request rate, errors or latency over time without
 *     reading every span;
 *
 *   - Missing request metrics (MetricMissingRequestMetrics): a service that
 *     sent 1,000 or more spans in the hour, and metrics too - its runtime's,
 *     its own - but has never sent a request metric: none of the ones
 *     OpenTelemetry's semantic conventions name for what its entry spans
 *     serve (http.server.request.duration for the HTTP requests it
 *     handles, rpc.server.call.duration for RPC calls,
 *     messaging.process.duration for messages), nor the span metrics a
 *     collector records from its traces. Its metrics reach OneUptime; its
 *     requests are measured only by reading every span.
 *
 * Each look reads the hour that ended last (on the clock, UTC), the hour the
 * metrics' hourly rollup holds whole. Its 10 busiest metrics of the hour, of
 * the project's own services, are read closely, at most two findings each
 * service; at most three services are found missing their metrics, and
 * three missing their request metrics. A finding's fingerprint is its kind,
 * service and metric (or name pattern), so the same problem is one insight,
 * refreshed while it lasts, and one pull request.
 *
 * Missing request metrics come from the reads the look makes anyway - the
 * hour's metrics by service, from the rollup, and its spans by service,
 * from their per-minute aggregate - and, for the few services those leave,
 * the metric catalog (never one of its request metrics, ever) and a sample
 * of their entry spans (what they serve): never a new scan of the hour.
 *
 * An attribute's values are never kept: only its key, how many values it
 * took and what they look like (MetricValueShape). They are whatever the
 * code put there - user ids and email addresses among them.
 *
 * Pure: the detector, the Dashboard, the tests and the docs suites read it
 * alike.
 */

// The window each look reads: one whole hour, as the hourly rollup holds it.
export const METRIC_INSIGHT_WINDOW_MINUTES: number = 60;

/*
 * How many of the hour's busiest metrics a look reads closely, and the
 * fewest data points one needs in the hour to be read at all. The busiest
 * are where a series too many costs the most.
 */
export const METRIC_INSIGHT_METRICS_READ: number = 10;
export const METRIC_INSIGHT_MIN_DATA_POINTS: number = 1000;

/*
 * High cardinality by an attribute: the fewest values one attribute must
 * take in the hour. Bounded attributes - a route, a method, a status code,
 * a queue's name - stay far below it.
 */
export const METRIC_INSIGHT_MIN_ATTRIBUTE_VALUES: number = 1000;

// High cardinality by the names: the fewest names one pattern must cover.
export const METRIC_INSIGHT_MIN_NAME_VARIANTS: number = 50;

// Wrong histogram buckets: the fewest values, and the share in one bucket.
export const METRIC_INSIGHT_MIN_HISTOGRAM_VALUES: number = 1000;
export const METRIC_INSIGHT_MIN_BUCKET_SHARE: number = 90;

/*
 * Missing metrics: the fewest spans a service must send in the hour before
 * it is said to need metrics, and the services found on each look.
 */
export const METRIC_INSIGHT_MIN_SERVICE_SPANS: number = 1000;
export const METRIC_INSIGHT_MAX_MISSING_METRICS_SERVICES: number = 3;

/*
 * Missing request metrics: the services found on each look (as busy as a
 * service missing its metrics: METRIC_INSIGHT_MIN_SERVICE_SPANS), how many
 * entry spans of a service are read to tell what it serves, the fewest of
 * them one kind of request needs in that sample to be what it serves, and
 * how many services' entry spans a look reads at most - each a small read
 * of its own, so a project whose busy services all sent request metrics
 * once, or serve none, costs a few of them, never one a service.
 */
export const METRIC_INSIGHT_MAX_MISSING_REQUEST_METRICS_SERVICES: number = 3;
export const METRIC_INSIGHT_SERVED_SPAN_SAMPLE_SIZE: number = 1000;
export const METRIC_INSIGHT_MIN_SERVED_SPANS: number = 100;
export const METRIC_INSIGHT_MAX_SERVED_SPAN_READS: number = 6;

/*
 * The busy services the metric catalog is asked about on each look - for
 * missing metrics, and again for missing request metrics - whether one
 * ever sent a metric (or a request metric) before. The busiest are asked
 * first. A read of the hour's metrics cut at its limit can leave many busy
 * services looking as if they sent none, each one more read: past these,
 * the look stops asking until the next hour.
 */
export const METRIC_INSIGHT_MAX_CATALOG_READS: number = 20;

// The metrics a missing-request-metrics finding names of the ones it sent.
export const METRIC_INSIGHT_SENT_METRIC_NAMES: number = 3;

// The findings kept of each service on each look.
export const METRIC_INSIGHT_MAX_FINDINGS_PER_SERVICE: number = 2;

// The name patterns a look reads, the most names first.
export const METRIC_INSIGHT_MAX_NAME_PATTERNS: number = 20;

// The busiest operations a missing-metrics finding names.
export const METRIC_INSIGHT_TOP_OPERATIONS: number = 5;

// The other high-cardinality attributes of a metric its finding names.
export const METRIC_INSIGHT_MAX_OTHER_ATTRIBUTES: number = 3;

// How many of an attribute's values are read to tell what they look like.
export const METRIC_INSIGHT_VALUE_SAMPLE_SIZE: number = 100;

// The longest value read to tell what it looks like.
export const METRIC_INSIGHT_MAX_VALUE_LENGTH: number = 200;

/*
 * A finding this large is High; the rest Medium (missing metrics and
 * missing request metrics: Low).
 */
export const METRIC_INSIGHT_HIGH_ATTRIBUTE_VALUES: number = 10000;
export const METRIC_INSIGHT_HIGH_NAME_VARIANTS: number = 500;

/*
 * The attributes a service's code does not set on its data points: the
 * resource's and the instrumentation scope's (stored with these prefixes at
 * ingest) and OneUptime's own stamps.
 */
export const METRIC_INSIGHT_IGNORED_ATTRIBUTE_PREFIXES: ReadonlyArray<string> =
  ["resource.", "scope.", "oneuptime."];

/*
 * The attribute an OpenTelemetry SDK puts on the one series it folds every
 * new series into once a metric reaches its cardinality limit.
 */
export const OTEL_METRIC_OVERFLOW_ATTRIBUTE: string = "otel.metric.overflow";

/*
 * The explicit bucket bounds every OpenTelemetry SDK uses when nothing sets
 * them - made for milliseconds - and the ones the semantic conventions
 * recommend for a duration in seconds.
 */
export const OTEL_DEFAULT_HISTOGRAM_BOUNDS: ReadonlyArray<number> = [
  0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000,
];

export const OTEL_SECONDS_HISTOGRAM_BOUNDS: ReadonlyArray<number> = [
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
];

/*
 * The parts of a metric name that are ids: a UUID, a long run of hex, or a
 * number of two digits or more ("v2" and "http2" stay as they are). One
 * pattern, read the same way by JavaScript and by ClickHouse's
 * replaceRegexpAll (RE2, leftmost-first): classes and counts only, so it
 * takes time in line with the name whatever it holds. Names are stored in
 * lower case. A regex checker's fuzzer (recheck) reports a second-degree
 * polynomial on "aaaa0aa0-0aaa0aa0-0a0a" repeated; it is not one: from any
 * start, a try ends within a UUID's 36 characters or a run of hex shorter
 * than 16 (a longer one matches), so the work is at most that many steps a
 * character - the suite times that text too.
 */
export const METRIC_NAME_ID_PATTERN: string =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|[0-9]{2,}";

export const METRIC_NAME_ID_PLACEHOLDER: string = "{id}";

const METRIC_NAME_ID_REGEX: RegExp = new RegExp(METRIC_NAME_ID_PATTERN, "g");

// The same, tested on a value: does it hold an id anywhere?
const VALUE_ID_REGEX: RegExp = new RegExp(METRIC_NAME_ID_PATTERN, "i");

const NUMBER_VALUE_REGEX: RegExp = /^-?[0-9]+(?:\.[0-9]+)?$/;
const UUID_VALUE_REGEX: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_VALUE_REGEX: RegExp = /^[0-9a-f]{16,}$/i;
const TIMESTAMP_VALUE_REGEX: RegExp =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}/;
const WHITESPACE_REGEX: RegExp = /\s/;

export const METRIC_INSIGHT_FINGERPRINT_PREFIXES: {
  highCardinality: string;
  histogramBuckets: string;
  missingMetrics: string;
  missingRequestMetrics: string;
} = {
  highCardinality: "metric-high-cardinality",
  histogramBuckets: "metric-histogram-buckets",
  missingMetrics: "metric-missing-metrics",
  missingRequestMetrics: "metric-missing-request-metrics",
};

export enum MetricInsightKind {
  HighCardinality = "HighCardinality",
  HistogramBuckets = "HistogramBuckets",
  MissingMetrics = "MissingMetrics",
  MissingRequestMetrics = "MissingRequestMetrics",
}

/*
 * What a service's requests are, as its entry spans say: an HTTP server's
 * (a SERVER span with an HTTP method), an RPC server's (a SERVER span with
 * rpc.system) or a messaging consumer's (a CONSUMER span with
 * messaging.system) - each with the request metric OpenTelemetry's
 * semantic conventions name for it. Listed in this order wherever a
 * finding names them.
 */
export enum MetricServedProtocol {
  Http = "Http",
  Rpc = "Rpc",
  Messaging = "Messaging",
}

export const METRIC_INSIGHT_SERVED_PROTOCOLS: ReadonlyArray<MetricServedProtocol> =
  [
    MetricServedProtocol.Http,
    MetricServedProtocol.Rpc,
    MetricServedProtocol.Messaging,
  ];

export function isMetricServedProtocol(
  value: unknown,
): value is MetricServedProtocol {
  return (
    typeof value === "string" &&
    (METRIC_INSIGHT_SERVED_PROTOCOLS as ReadonlyArray<string>).includes(value)
  );
}

/*
 * How an entry span says which kind of request it is: its kind, and an
 * attribute the semantic conventions put on it, under its new name or its
 * old one (http.request.method was http.method before semantic conventions
 * 1.20; rpc.system.name was rpc.system up to 1.37). Typed by the stored
 * kinds (SpanKind), so a kind that is not one fails to compile.
 */
export interface MetricServedSpanDefinition {
  kind: `${SpanKind.Server}` | `${SpanKind.Consumer}`;
  attributeKeys: ReadonlyArray<string>;
}

export const METRIC_INSIGHT_SERVED_SPANS: Readonly<
  Record<MetricServedProtocol, MetricServedSpanDefinition>
> = {
  [MetricServedProtocol.Http]: {
    kind: "SPAN_KIND_SERVER",
    attributeKeys: ["http.request.method", "http.method"],
  },
  [MetricServedProtocol.Rpc]: {
    kind: "SPAN_KIND_SERVER",
    attributeKeys: ["rpc.system.name", "rpc.system"],
  },
  [MetricServedProtocol.Messaging]: {
    kind: "SPAN_KIND_CONSUMER",
    attributeKeys: ["messaging.system"],
  },
};

/*
 * The request metric to add for each: the duration histogram, in seconds,
 * that the semantic conventions name for a server or a consumer - its count
 * is the request rate, and its errors are told by its status attribute.
 * RPC's is rpc.server.call.duration in the semantic conventions after
 * 1.37, and was rpc.server.duration (in milliseconds) up to it; both are
 * request metrics (METRIC_INSIGHT_REQUEST_METRIC_PREFIXES).
 */
export const METRIC_INSIGHT_REQUEST_METRIC_BY_PROTOCOL: Readonly<
  Record<MetricServedProtocol, string>
> = {
  [MetricServedProtocol.Http]: "http.server.request.duration",
  [MetricServedProtocol.Rpc]: "rpc.server.call.duration",
  [MetricServedProtocol.Messaging]: "messaging.process.duration",
};

/*
 * The attributes each one is recorded with, as the semantic conventions
 * name them: bounded values only, so the metric stays a few series.
 */
export const METRIC_INSIGHT_REQUEST_METRIC_ATTRIBUTES: Readonly<
  Record<MetricServedProtocol, ReadonlyArray<string>>
> = {
  [MetricServedProtocol.Http]: [
    "http.request.method",
    "http.route",
    "http.response.status_code",
  ],
  [MetricServedProtocol.Rpc]: [
    "rpc.system.name",
    "rpc.method",
    "rpc.response.status_code",
  ],
  [MetricServedProtocol.Messaging]: [
    "messaging.system",
    "messaging.destination.name",
    "messaging.operation.name",
  ],
};

/*
 * The names a request metric goes by, as name prefixes (lower case): the
 * semantic conventions' own for an HTTP server, an RPC server and a
 * messaging consumer, old and new (http.server.duration was
 * http.server.request.duration's name before semantic conventions 1.20,
 * rpc.server.duration rpc.server.call.duration's), the names the same
 * metrics take through Prometheus (dots as underscores, a unit after:
 * http_server_request_duration_seconds), Micrometer's
 * (http.server.requests), the Prometheus client libraries' own
 * (http_requests_total, http_request_duration_seconds) and gRPC's
 * (grpc.server.call.duration, grpc_server_handled_total) - and the span
 * metrics an OpenTelemetry Collector's span metrics step records from the
 * traces passing through it (traces.span.metrics.calls and
 * traces.span.metrics.duration; traces_spanmetrics_* before), which
 * OneUptime's Kubernetes agent sends too. A service that sends any of them
 * has request metrics. The metric catalog is asked by the same prefixes
 * (QueryHelper.startsWithAnyOf, which matches "_" and "%" as themselves).
 */
export const METRIC_INSIGHT_REQUEST_METRIC_PREFIXES: ReadonlyArray<string> = [
  "http.server.",
  "http_server_",
  "http.request",
  "http_request",
  "rpc.server.",
  "rpc_server_",
  "grpc.server.",
  "grpc_server_",
  "messaging.process.",
  "messaging_process_",
  "messaging.receive.",
  "messaging_receive_",
  "messaging.client.consumed.",
  "messaging_client_consumed_",
  "messaging.client.operation.",
  "messaging_client_operation_",
  `${SPAN_METRICS_NAMESPACE}.`,
  `${SPAN_METRICS_NAMESPACE.split(".").join("_")}_`,
  "traces.spanmetrics.",
  "traces_spanmetrics_",
];

// Whether a metric's name is one a request metric goes by.
export function isRequestMetricName(name: string): boolean {
  const lowered: string = (name || "").trim().toLowerCase();

  return (
    lowered.length > 0 &&
    METRIC_INSIGHT_REQUEST_METRIC_PREFIXES.some((prefix: string): boolean => {
      return lowered.startsWith(prefix);
    })
  );
}

// What carries the values of a high-cardinality metric.
export enum MetricCardinalityShape {
  Attribute = "Attribute",
  Name = "Name",
}

// Where a histogram's values fall that its buckets cannot tell apart.
export enum MetricBucketProblem {
  BelowSmallestBucket = "BelowSmallestBucket",
  AboveLargestBucket = "AboveLargestBucket",
  NoBuckets = "NoBuckets",
}

// What an attribute's values look like.
export enum MetricValueShape {
  Number = "Number",
  Uuid = "Uuid",
  HexId = "HexId",
  UrlWithIds = "UrlWithIds",
  Email = "Email",
  Timestamp = "Timestamp",
  Text = "Text",
  Mixed = "Mixed",
}

export const METRIC_INSIGHT_TYPE_BY_KIND: Readonly<
  Record<MetricInsightKind, AIInsightType>
> = {
  [MetricInsightKind.HighCardinality]: AIInsightType.MetricHighCardinality,
  [MetricInsightKind.HistogramBuckets]: AIInsightType.MetricHistogramBuckets,
  [MetricInsightKind.MissingMetrics]: AIInsightType.MetricMissingMetrics,
  [MetricInsightKind.MissingRequestMetrics]:
    AIInsightType.MetricMissingRequestMetrics,
};

export function isMetricInsightKind(
  value: unknown,
): value is MetricInsightKind {
  return (
    typeof value === "string" &&
    (Object.values(MetricInsightKind) as Array<string>).includes(value)
  );
}

export function isMetricCardinalityShape(
  value: unknown,
): value is MetricCardinalityShape {
  return (
    typeof value === "string" &&
    (Object.values(MetricCardinalityShape) as Array<string>).includes(value)
  );
}

export function isMetricBucketProblem(
  value: unknown,
): value is MetricBucketProblem {
  return (
    typeof value === "string" &&
    (Object.values(MetricBucketProblem) as Array<string>).includes(value)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasText(text: string): boolean {
  return text.trim().length > 0;
}

function readId(id: string): string {
  return (id || "").trim().toLowerCase();
}

export interface MetricInsightWindow {
  startTime: Date;
  endTime: Date;
}

/*
 * The hour a look reads: the whole clock hour before the one it runs in
 * (UTC) - at 10:05 the hour from 09:00 to 10:00, which the hourly rollup
 * holds whole.
 */
export function getMetricInsightWindow(now: Date): MetricInsightWindow {
  const hour: number = 60 * 60 * 1000;
  const endTime: Date = new Date(Math.floor(now.getTime() / hour) * hour);

  return {
    startTime: new Date(
      endTime.getTime() - METRIC_INSIGHT_WINDOW_MINUTES * 60 * 1000,
    ),
    endTime,
  };
}

// Whether an attribute is one a service's code sets on its data points.
export function isCodeSetMetricAttribute(key: string): boolean {
  const lowered: string = (key || "").trim().toLowerCase();

  return (
    lowered.length > 0 &&
    lowered !== OTEL_METRIC_OVERFLOW_ATTRIBUTE &&
    !METRIC_INSIGHT_IGNORED_ATTRIBUTE_PREFIXES.some(
      (prefix: string): boolean => {
        return lowered.startsWith(prefix);
      },
    )
  );
}

/*
 * A metric name with its ids collapsed: "job.8812.duration" and
 * "job.9123.duration" are both "job.{id}.duration".
 */
export function getMetricNamePattern(name: string): string {
  return (name || "")
    .trim()
    .toLowerCase()
    .replace(METRIC_NAME_ID_REGEX, METRIC_NAME_ID_PLACEHOLDER);
}

// Whether a name pattern collapsed an id: one a name explosion can share.
export function hasMetricNameId(pattern: string): boolean {
  return (pattern || "").includes(METRIC_NAME_ID_PLACEHOLDER);
}

/*
 * What one value looks like. Cut before it is read: a value is whatever the
 * code put there. No pattern here can take longer than the value is long.
 */
export function getMetricValueShape(rawValue: string): MetricValueShape {
  const value: string = (rawValue || "")
    .trim()
    .substring(0, METRIC_INSIGHT_MAX_VALUE_LENGTH);

  if (NUMBER_VALUE_REGEX.test(value)) {
    return MetricValueShape.Number;
  }

  if (UUID_VALUE_REGEX.test(value)) {
    return MetricValueShape.Uuid;
  }

  if (HEX_VALUE_REGEX.test(value)) {
    return MetricValueShape.HexId;
  }

  if (TIMESTAMP_VALUE_REGEX.test(value)) {
    return MetricValueShape.Timestamp;
  }

  const at: number = value.indexOf("@");

  if (
    at > 0 &&
    at === value.lastIndexOf("@") &&
    value.indexOf(".", at) > at + 1 &&
    !WHITESPACE_REGEX.test(value)
  ) {
    return MetricValueShape.Email;
  }

  if (
    (value.startsWith("/") || value.includes("://")) &&
    VALUE_ID_REGEX.test(value)
  ) {
    return MetricValueShape.UrlWithIds;
  }

  return MetricValueShape.Text;
}

// The share of a sample one shape must hold to say the values look like it.
export const METRIC_INSIGHT_DOMINANT_SHAPE_SHARE: number = 0.6;

/*
 * What a sample of an attribute's values looks like: the shape 60% or more
 * of them have, else Mixed. The values themselves are dropped here.
 */
export function getDominantMetricValueShape(
  values: ReadonlyArray<string>,
): MetricValueShape {
  const counts: Map<MetricValueShape, number> = new Map<
    MetricValueShape,
    number
  >();
  let read: number = 0;

  for (const value of values.slice(0, METRIC_INSIGHT_VALUE_SAMPLE_SIZE)) {
    if (typeof value !== "string" || !hasText(value)) {
      continue;
    }

    const shape: MetricValueShape = getMetricValueShape(value);
    counts.set(shape, (counts.get(shape) || 0) + 1);
    read++;
  }

  if (read === 0) {
    return MetricValueShape.Mixed;
  }

  let best: MetricValueShape = MetricValueShape.Mixed;
  let bestCount: number = 0;

  for (const shape of Object.values(MetricValueShape)) {
    const count: number = counts.get(shape) || 0;

    if (count > bestCount) {
      best = shape;
      bestCount = count;
    }
  }

  return bestCount / read >= METRIC_INSIGHT_DOMINANT_SHAPE_SHARE
    ? best
    : MetricValueShape.Mixed;
}

/*
 * STAGE ONE: every metric of the hour at once, from the hourly rollup - its
 * data points, by metric and by what it was sent for (a service, a host, a
 * monitor).
 */
export interface MetricVolumeReading {
  metricName: string;
  // The primary entity it was sent for: a service's id, or another's.
  serviceId: string;
  dataPointCount: number;
}

/*
 * The metrics read closely: the project's own services' busiest metrics of
 * the hour, with enough data points to be read, busiest first.
 */
export function pickMetricsToRead(data: {
  readings: ReadonlyArray<MetricVolumeReading>;
  serviceIds: ReadonlySet<string>;
  excludedServiceIds?: ReadonlySet<string> | undefined;
}): Array<MetricVolumeReading> {
  return data.readings
    .filter((reading: MetricVolumeReading): boolean => {
      const serviceId: string = readId(reading.serviceId);

      return (
        hasText(reading.metricName || "") &&
        data.serviceIds.has(serviceId) &&
        !data.excludedServiceIds?.has(serviceId) &&
        isFiniteNumber(reading.dataPointCount) &&
        reading.dataPointCount >= METRIC_INSIGHT_MIN_DATA_POINTS
      );
    })
    .map((reading: MetricVolumeReading): MetricVolumeReading => {
      return { ...reading, serviceId: readId(reading.serviceId) };
    })
    .sort((a: MetricVolumeReading, b: MetricVolumeReading): number => {
      return (
        b.dataPointCount - a.dataPointCount ||
        a.metricName.localeCompare(b.metricName) ||
        a.serviceId.localeCompare(b.serviceId)
      );
    })
    .slice(0, METRIC_INSIGHT_METRICS_READ);
}

// A service's metric names of the hour that share one pattern.
export interface MetricNamePatternReading {
  serviceId: string;
  namePattern: string;
  nameCount: number;
  dataPointCount: number;
}

/*
 * The name patterns that are high cardinality: the project's own services',
 * with an id collapsed in them and enough names, the most names first.
 */
export function pickExplodedNamePatterns(data: {
  readings: ReadonlyArray<MetricNamePatternReading>;
  serviceIds: ReadonlySet<string>;
  excludedServiceIds?: ReadonlySet<string> | undefined;
}): Array<MetricNamePatternReading> {
  return data.readings
    .filter((reading: MetricNamePatternReading): boolean => {
      const serviceId: string = readId(reading.serviceId);

      return (
        data.serviceIds.has(serviceId) &&
        !data.excludedServiceIds?.has(serviceId) &&
        hasMetricNameId(reading.namePattern) &&
        isFiniteNumber(reading.nameCount) &&
        reading.nameCount >= METRIC_INSIGHT_MIN_NAME_VARIANTS
      );
    })
    .map((reading: MetricNamePatternReading): MetricNamePatternReading => {
      return { ...reading, serviceId: readId(reading.serviceId) };
    })
    .sort(
      (a: MetricNamePatternReading, b: MetricNamePatternReading): number => {
        return (
          b.nameCount - a.nameCount ||
          a.namePattern.localeCompare(b.namePattern) ||
          a.serviceId.localeCompare(b.serviceId)
        );
      },
    )
    .slice(0, METRIC_INSIGHT_MAX_NAME_PATTERNS);
}

/*
 * STAGE TWO: one metric read closely over the hour - how many values each
 * attribute its code sets took, and what its data points are.
 */
export interface MetricAttributeReading {
  key: string;
  valueCount: number;
  // A sample of its values, read only to tell what they look like.
  sampleValues: ReadonlyArray<string>;
}

export interface MetricHighCardinalityReading {
  attribute: MetricInsightAttributeEvidence;
  valueShape: MetricValueShape;
  otherAttributes: Array<MetricInsightAttributeEvidence>;
}

/*
 * The attribute that makes a metric high cardinality - the one its code sets
 * that took the most values, past the gate - and the others past it too.
 * Null when none is.
 */
export function readHighCardinalityAttributes(
  readings: ReadonlyArray<MetricAttributeReading>,
): MetricHighCardinalityReading | null {
  const past: Array<MetricAttributeReading> = readings
    .filter((reading: MetricAttributeReading): boolean => {
      return (
        isCodeSetMetricAttribute(reading.key) &&
        isFiniteNumber(reading.valueCount) &&
        reading.valueCount >= METRIC_INSIGHT_MIN_ATTRIBUTE_VALUES
      );
    })
    .sort((a: MetricAttributeReading, b: MetricAttributeReading): number => {
      return b.valueCount - a.valueCount || a.key.localeCompare(b.key);
    });

  const worst: MetricAttributeReading | undefined = past[0];

  if (!worst) {
    return null;
  }

  return {
    attribute: { key: worst.key, valueCount: worst.valueCount },
    valueShape: getDominantMetricValueShape(worst.sampleValues),
    otherAttributes: past
      .slice(1, METRIC_INSIGHT_MAX_OTHER_ATTRIBUTES + 1)
      .map(
        (reading: MetricAttributeReading): MetricInsightAttributeEvidence => {
          return { key: reading.key, valueCount: reading.valueCount };
        },
      ),
  };
}

/*
 * One metric's data points of one kind over the hour, as the histogram gate
 * reads them: the bucket counts summed bucket by bucket over the points with
 * the same bounds.
 */
export interface MetricShapeReading {
  // "Gauge", "Sum", "Histogram", "ExponentialHistogram" or "Summary".
  pointType: string;
  // "Delta" or "Cumulative" (or empty).
  temporality: string;
  bounds: ReadonlyArray<number>;
  bucketCounts: ReadonlyArray<number>;
  // The points' counts summed, and the largest one.
  countSum: number;
  countMax: number;
  minValue: number | null;
  maxValue: number | null;
  dataPointCount: number;
  // Points carrying otel.metric.overflow.
  overflowDataPointCount: number;
}

/*
 * How many values a histogram recorded, as the gate counts them: a delta
 * point counts what was recorded since the one before it, so their sum; a
 * cumulative point counts everything since its series started, so the
 * largest of them - at least that many values were recorded.
 */
export function getHistogramValueCount(reading: MetricShapeReading): number {
  const count: number =
    reading.temporality === "Delta" ? reading.countSum : reading.countMax;

  return isFiniteNumber(count) && count > 0 ? count : 0;
}

function toNumbers(values: ReadonlyArray<unknown>): Array<number> | null {
  const numbers: Array<number> = [];

  for (const value of values || []) {
    const number: number = Number(value);

    if (!Number.isFinite(number)) {
      return null;
    }

    numbers.push(number);
  }

  return numbers;
}

function isSameBounds(
  bounds: ReadonlyArray<number>,
  expected: ReadonlyArray<number>,
): boolean {
  return (
    bounds.length === expected.length &&
    bounds.every((bound: number, index: number): boolean => {
      return Math.abs(bound - (expected[index] as number)) < 1e-9;
    })
  );
}

export interface MetricHistogramBucketsReading {
  problem: MetricBucketProblem;
  // 0-100.
  share: number;
  valueCount: number;
  boundCount: number;
  smallestBound?: number | undefined;
  largestBound?: number | undefined;
  hasDefaultBounds: boolean;
}

/*
 * Whether a histogram's buckets cannot tell its values apart: enough values,
 * and 90% or more of them in its smallest bucket - the first one above zero,
 * since values of exactly zero are read as zero - or above its largest, or
 * no buckets at all. Null when they fit, when it is not a histogram with
 * explicit buckets, or when its points do not hold together.
 */
export function readHistogramBuckets(
  reading: MetricShapeReading,
): MetricHistogramBucketsReading | null {
  if (reading.pointType !== "Histogram") {
    return null;
  }

  const valueCount: number = getHistogramValueCount(reading);

  if (valueCount < METRIC_INSIGHT_MIN_HISTOGRAM_VALUES) {
    return null;
  }

  const bounds: Array<number> | null = toNumbers(reading.bounds);
  const counts: Array<number> | null = toNumbers(reading.bucketCounts);

  if (!bounds || !counts) {
    return null;
  }

  if (bounds.length === 0) {
    return {
      problem: MetricBucketProblem.NoBuckets,
      share: 100,
      valueCount,
      boundCount: 0,
      hasDefaultBounds: false,
    };
  }

  const isAscending: boolean = bounds.every(
    (bound: number, index: number): boolean => {
      return index === 0 || bound > (bounds[index - 1] as number);
    },
  );

  if (
    !isAscending ||
    counts.length !== bounds.length + 1 ||
    counts.some((count: number): boolean => {
      return count < 0;
    })
  ) {
    return null;
  }

  const total: number = counts.reduce((sum: number, count: number): number => {
    return sum + count;
  }, 0);

  if (total <= 0) {
    return null;
  }

  // The first bucket whose upper bound is above zero.
  let smallestIndex: number = bounds.findIndex((bound: number): boolean => {
    return bound > 0;
  });

  if (smallestIndex === -1) {
    smallestIndex = bounds.length - 1;
  }

  const smallestShare: number =
    ((counts[smallestIndex] as number) / total) * 100;
  const largestShare: number =
    ((counts[bounds.length] as number) / total) * 100;

  const base: {
    valueCount: number;
    boundCount: number;
    smallestBound: number;
    largestBound: number;
    hasDefaultBounds: boolean;
  } = {
    valueCount,
    boundCount: bounds.length,
    smallestBound: bounds[smallestIndex] as number,
    largestBound: bounds[bounds.length - 1] as number,
    hasDefaultBounds: isSameBounds(bounds, OTEL_DEFAULT_HISTOGRAM_BOUNDS),
  };

  if (largestShare >= METRIC_INSIGHT_MIN_BUCKET_SHARE) {
    return {
      problem: MetricBucketProblem.AboveLargestBucket,
      share: largestShare,
      ...base,
    };
  }

  if (smallestShare >= METRIC_INSIGHT_MIN_BUCKET_SHARE) {
    return {
      problem: MetricBucketProblem.BelowSmallestBucket,
      share: smallestShare,
      ...base,
    };
  }

  return null;
}

/*
 * Of a metric's readings by kind, the histogram one with the most data
 * points (a metric's bounds can change with a deploy).
 */
export function pickHistogramReading(
  readings: ReadonlyArray<MetricShapeReading>,
): MetricShapeReading | null {
  return (
    [...readings]
      .filter((reading: MetricShapeReading): boolean => {
        return reading.pointType === "Histogram";
      })
      .sort((a: MetricShapeReading, b: MetricShapeReading): number => {
        return b.dataPointCount - a.dataPointCount;
      })[0] || null
  );
}

// Whether any of a metric's points carried the SDK's overflow attribute.
export function hasMetricOverflow(
  readings: ReadonlyArray<MetricShapeReading>,
): boolean {
  return readings.some((reading: MetricShapeReading): boolean => {
    return (
      isFiniteNumber(reading.overflowDataPointCount) &&
      reading.overflowDataPointCount > 0
    );
  });
}

/*
 * STAGE THREE: the services that send traces but no metrics - each one's
 * spans in the hour, from the span table's per-minute aggregate.
 */
export interface MetricServiceTraffic {
  serviceId: string;
  spanCount: number;
  failedSpanCount: number;
}

/*
 * The services to ask the metric catalog about: the project's own, busy
 * enough, that sent no data point of their own in the hour, busiest first.
 * A service the catalog then says has sent metrics before is not missing
 * them: its metrics stopped, which is not a pull request's to add.
 */
export function pickServicesMissingMetrics(data: {
  traffic: ReadonlyArray<MetricServiceTraffic>;
  serviceIds: ReadonlySet<string>;
  servicesWithMetrics: ReadonlySet<string>;
  excludedServiceIds?: ReadonlySet<string> | undefined;
}): Array<MetricServiceTraffic> {
  return data.traffic
    .map((reading: MetricServiceTraffic): MetricServiceTraffic => {
      return { ...reading, serviceId: readId(reading.serviceId) };
    })
    .filter((reading: MetricServiceTraffic): boolean => {
      return (
        data.serviceIds.has(reading.serviceId) &&
        !data.servicesWithMetrics.has(reading.serviceId) &&
        !data.excludedServiceIds?.has(reading.serviceId) &&
        isFiniteNumber(reading.spanCount) &&
        reading.spanCount >= METRIC_INSIGHT_MIN_SERVICE_SPANS
      );
    })
    .sort((a: MetricServiceTraffic, b: MetricServiceTraffic): number => {
      return (
        b.spanCount - a.spanCount || a.serviceId.localeCompare(b.serviceId)
      );
    });
}

/*
 * STAGE FOUR: the services that send metrics, but none for the requests
 * they handle - from the same two reads: the hour's metrics by service (the
 * rollup) and its spans by service (their per-minute aggregate).
 */
export interface MetricRequestMetricsCandidate extends MetricServiceTraffic {
  /*
   * The metrics it sent in the hour, its busiest first - a name with an id
   * in it by the pattern its names share (job.{id}.duration), so no id is
   * ever kept, as High Cardinality keeps none.
   */
  metricNames: Array<string>;
  // How many different metrics it sent in the hour.
  metricCount: number;
}

/*
 * The services to ask about their request metrics: the project's own, busy
 * enough, that sent metrics of their own in the hour - none of them a
 * request metric (isRequestMetricName) - busiest first. The metric catalog
 * then says whether one ever sent a request metric (one that stopped is
 * not a pull request's to add), and its entry spans what it serves.
 */
export function pickServicesMissingRequestMetrics(data: {
  traffic: ReadonlyArray<MetricServiceTraffic>;
  serviceIds: ReadonlySet<string>;
  // The hour's metrics, by the service they were sent for.
  readings: ReadonlyArray<MetricVolumeReading>;
  excludedServiceIds?: ReadonlySet<string> | undefined;
}): Array<MetricRequestMetricsCandidate> {
  const metricsByService: Map<string, Array<MetricVolumeReading>> = new Map<
    string,
    Array<MetricVolumeReading>
  >();

  for (const reading of data.readings) {
    const serviceId: string = readId(reading.serviceId);

    if (!serviceId || !hasText(reading.metricName || "")) {
      continue;
    }

    metricsByService.set(serviceId, [
      ...(metricsByService.get(serviceId) || []),
      reading,
    ]);
  }

  const candidates: Array<MetricRequestMetricsCandidate> = [];

  for (const traffic of data.traffic) {
    const serviceId: string = readId(traffic.serviceId);
    const metrics: Array<MetricVolumeReading> =
      metricsByService.get(serviceId) || [];

    if (
      !data.serviceIds.has(serviceId) ||
      data.excludedServiceIds?.has(serviceId) ||
      !isFiniteNumber(traffic.spanCount) ||
      traffic.spanCount < METRIC_INSIGHT_MIN_SERVICE_SPANS ||
      metrics.length === 0 ||
      metrics.some((reading: MetricVolumeReading): boolean => {
        return isRequestMetricName(reading.metricName);
      })
    ) {
      continue;
    }

    const metricNames: Array<string> = Array.from(
      new Set(
        [...metrics]
          .sort((a: MetricVolumeReading, b: MetricVolumeReading): number => {
            return (
              b.dataPointCount - a.dataPointCount ||
              a.metricName.localeCompare(b.metricName)
            );
          })
          .map((reading: MetricVolumeReading): string => {
            const pattern: string = getMetricNamePattern(reading.metricName);

            return hasMetricNameId(pattern) ? pattern : reading.metricName;
          }),
      ),
    );
    const metricCount: number = new Set(
      metrics.map((reading: MetricVolumeReading): string => {
        return reading.metricName;
      }),
    ).size;

    candidates.push({ ...traffic, serviceId, metricNames, metricCount });
  }

  return candidates.sort(
    (a: MetricRequestMetricsCandidate, b: MetricRequestMetricsCandidate) => {
      return (
        b.spanCount - a.spanCount || a.serviceId.localeCompare(b.serviceId)
      );
    },
  );
}

/*
 * A sample of a service's entry spans of the hour - its SERVER and CONSUMER
 * spans, at most METRIC_INSIGHT_SERVED_SPAN_SAMPLE_SIZE of them - and how
 * many of them are an HTTP server's, an RPC server's and a messaging
 * consumer's, as METRIC_INSIGHT_SERVED_SPANS tells them.
 */
export interface MetricServedSpansReading {
  sampledSpanCount: number;
  httpServerSpanCount: number;
  rpcServerSpanCount: number;
  messagingConsumerSpanCount: number;
}

/*
 * What a service serves, as its entry spans say: each kind of request with
 * METRIC_INSIGHT_MIN_SERVED_SPANS or more spans in the sample, in the
 * protocols' order. None when the spans hold too few of any - a service
 * whose work starts in a cron job or a script, or an internal span, has no
 * request metric the semantic conventions name.
 */
export function readServedProtocols(
  reading: MetricServedSpansReading | null | undefined,
): Array<MetricServedProtocol> {
  if (!reading) {
    return [];
  }

  const counts: Record<MetricServedProtocol, number> = {
    [MetricServedProtocol.Http]: reading.httpServerSpanCount,
    [MetricServedProtocol.Rpc]: reading.rpcServerSpanCount,
    [MetricServedProtocol.Messaging]: reading.messagingConsumerSpanCount,
  };

  return METRIC_INSIGHT_SERVED_PROTOCOLS.filter(
    (protocol: MetricServedProtocol): boolean => {
      const count: number = counts[protocol];

      return isFiniteNumber(count) && count >= METRIC_INSIGHT_MIN_SERVED_SPANS;
    },
  );
}

// The protocols evidence names, read back: known ones only, in order.
export function getEvidenceServedProtocols(
  evidence: MetricInsightEvidence,
): Array<MetricServedProtocol> {
  const named: ReadonlyArray<unknown> = Array.isArray(evidence.servedProtocols)
    ? evidence.servedProtocols
    : [];

  return METRIC_INSIGHT_SERVED_PROTOCOLS.filter(
    (protocol: MetricServedProtocol): boolean => {
      return named.includes(protocol);
    },
  );
}

// The request metrics a service that serves these lacks, in order.
export function getMissingRequestMetricNames(
  protocols: ReadonlyArray<MetricServedProtocol>,
): Array<string> {
  return METRIC_INSIGHT_SERVED_PROTOCOLS.filter(
    (protocol: MetricServedProtocol): boolean => {
      return protocols.includes(protocol);
    },
  ).map((protocol: MetricServedProtocol): string => {
    return METRIC_INSIGHT_REQUEST_METRIC_BY_PROTOCOL[protocol];
  });
}

// Items as a sentence lists them: "a", "a and b", "a, b and c".
function listInWords(items: ReadonlyArray<string>): string {
  if (items.length <= 1) {
    return items[0] || "";
  }

  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// What a protocol's requests are called, in a phrase.
const SERVED_PROTOCOL_PHRASES: Readonly<Record<MetricServedProtocol, string>> =
  {
    [MetricServedProtocol.Http]: "HTTP requests",
    [MetricServedProtocol.Rpc]: "RPC calls",
    [MetricServedProtocol.Messaging]: "messages",
  };

/*
 * What a service handles, in a phrase: "HTTP requests", "HTTP requests and
 * messages", "HTTP requests, RPC calls and messages" - "requests" when the
 * evidence names none it knows.
 */
export function describeServedProtocols(
  protocols: ReadonlyArray<MetricServedProtocol>,
): string {
  const phrases: Array<string> = METRIC_INSIGHT_SERVED_PROTOCOLS.filter(
    (protocol: MetricServedProtocol): boolean => {
      return protocols.includes(protocol);
    },
  ).map((protocol: MetricServedProtocol): string => {
    return SERVED_PROTOCOL_PHRASES[protocol];
  });

  return phrases.length > 0 ? listInWords(phrases) : "requests";
}

/*
 * The finding's identity: its kind, its service, and its metric - or, for
 * names with ids in them, the pattern they share; a service's missing
 * metrics, and its missing request metrics, are one finding each.
 */
export function getMetricInsightFingerprint(data: {
  kind: MetricInsightKind;
  serviceId: string;
  shape?: MetricCardinalityShape | undefined;
  metricName?: string | undefined;
  namePattern?: string | undefined;
}): string {
  const serviceId: string = readId(data.serviceId);

  switch (data.kind) {
    case MetricInsightKind.HighCardinality:
      return data.shape === MetricCardinalityShape.Name
        ? [
            METRIC_INSIGHT_FINGERPRINT_PREFIXES.highCardinality,
            serviceId,
            "name",
            data.namePattern || "",
          ].join(":")
        : [
            METRIC_INSIGHT_FINGERPRINT_PREFIXES.highCardinality,
            serviceId,
            "attribute",
            (data.metricName || "").trim().toLowerCase(),
          ].join(":");
    case MetricInsightKind.HistogramBuckets:
      return [
        METRIC_INSIGHT_FINGERPRINT_PREFIXES.histogramBuckets,
        serviceId,
        (data.metricName || "").trim().toLowerCase(),
      ].join(":");
    case MetricInsightKind.MissingRequestMetrics:
      return `${METRIC_INSIGHT_FINGERPRINT_PREFIXES.missingRequestMetrics}:${serviceId}`;
    case MetricInsightKind.MissingMetrics:
    default:
      return `${METRIC_INSIGHT_FINGERPRINT_PREFIXES.missingMetrics}:${serviceId}`;
  }
}

// Whether a fingerprint is one of a service's metric findings.
export function isMetricInsightFingerprintOfService(
  fingerprint: string,
  serviceId: string,
): boolean {
  const lowered: string = (fingerprint || "").toLowerCase();
  const id: string = readId(serviceId);

  if (!id) {
    return false;
  }

  return Object.values(METRIC_INSIGHT_FINGERPRINT_PREFIXES).some(
    (prefix: string): boolean => {
      return (
        lowered === `${prefix}:${id}` || lowered.startsWith(`${prefix}:${id}:`)
      );
    },
  );
}

function formatCount(count: number): string {
  return Math.round(isFiniteNumber(count) ? count : 0).toLocaleString("en-US");
}

// A share in percent, as the findings say it: "98%", "5.4%".
export function formatMetricPercent(percent: number): string {
  if (!isFiniteNumber(percent)) {
    return "0%";
  }

  const rounded: number =
    Math.abs(percent) >= 10
      ? Math.round(percent)
      : Math.round(percent * 10) / 10;

  return `${rounded}%`;
}

/*
 * A bound or a value, as the findings say it: "10,000", "2.5", "0.005",
 * "0.00213" - three significant digits below one, two decimals at most
 * above it.
 */
export function formatMetricNumber(value: number): string {
  if (!isFiniteNumber(value)) {
    return "0";
  }

  const magnitude: number = Math.abs(value);

  if (magnitude >= 1000) {
    return Math.round(value).toLocaleString("en-US");
  }

  if (magnitude >= 1 || magnitude === 0) {
    return String(Math.round(value * 100) / 100);
  }

  return String(Number(value.toPrecision(3)));
}

// What an attribute's values look like, in a phrase.
export function describeMetricValueShape(shape: unknown): string {
  switch (shape) {
    case MetricValueShape.Number:
      return "numbers, such as IDs";
    case MetricValueShape.Uuid:
      return "UUIDs";
    case MetricValueShape.HexId:
      return "hex IDs";
    case MetricValueShape.UrlWithIds:
      return "URLs or paths with IDs in them";
    case MetricValueShape.Email:
      return "email addresses";
    case MetricValueShape.Timestamp:
      return "timestamps";
    case MetricValueShape.Text:
      return "free text";
    case MetricValueShape.Mixed:
    default:
      return "a mix of kinds";
  }
}

function withService(subject: string, serviceName: string): string {
  return serviceName ? `${subject} in ${serviceName}` : subject;
}

// The insight's title: what was found, in a sentence.
export function getMetricInsightTitle(data: {
  evidence: MetricInsightEvidence;
  serviceName: string;
}): string {
  const evidence: MetricInsightEvidence = data.evidence;
  const metric: string = evidence.metricName || "A metric";
  const service: string = data.serviceName || "A service";

  switch (evidence.kind) {
    case MetricInsightKind.HighCardinality:
      if (evidence.shape === MetricCardinalityShape.Name) {
        return `${service} sends ${formatCount(evidence.nameCount || 0)} metrics named like ${evidence.namePattern || "this"}`;
      }

      return `${withService(metric, data.serviceName)} records ${formatCount(evidence.attributeValueCount || 0)} different ${evidence.attributeKey || "attribute"} values an hour`;
    case MetricInsightKind.HistogramBuckets:
      switch (evidence.bucketProblem) {
        case MetricBucketProblem.NoBuckets:
          return `${withService(metric, data.serviceName)} is a histogram with no buckets`;
        case MetricBucketProblem.AboveLargestBucket:
          return `${withService(metric, data.serviceName)} puts ${formatMetricPercent(evidence.bucketShare || 0)} of its values above its largest bucket`;
        case MetricBucketProblem.BelowSmallestBucket:
        default:
          return `${withService(metric, data.serviceName)} puts ${formatMetricPercent(evidence.bucketShare || 0)} of its values in its smallest bucket`;
      }
    case MetricInsightKind.MissingRequestMetrics:
      return `${service} sends no metrics for the ${describeServedProtocols(getEvidenceServedProtocols(evidence))} it handles`;
    case MetricInsightKind.MissingMetrics:
    default:
      return `${service} sends traces but no metrics`;
  }
}

export function getMetricInsightSeverity(
  evidence: MetricInsightEvidence,
): AIInsightSeverity {
  switch (evidence.kind) {
    case MetricInsightKind.HighCardinality:
      if (evidence.shape === MetricCardinalityShape.Name) {
        return (evidence.nameCount || 0) >= METRIC_INSIGHT_HIGH_NAME_VARIANTS
          ? AIInsightSeverity.High
          : AIInsightSeverity.Medium;
      }

      /*
       * Past the SDK's own limit its numbers are wrong, not only costly: a
       * person reading its charts is misled.
       */
      return evidence.hasOverflow ||
        (evidence.attributeValueCount || 0) >=
          METRIC_INSIGHT_HIGH_ATTRIBUTE_VALUES
        ? AIInsightSeverity.High
        : AIInsightSeverity.Medium;
    case MetricInsightKind.HistogramBuckets:
      // Every chart and monitor on it reads the same number.
      return AIInsightSeverity.Medium;
    case MetricInsightKind.MissingRequestMetrics:
    case MetricInsightKind.MissingMetrics:
    default:
      // Nothing is wrong yet; what it costs is visibility.
      return AIInsightSeverity.Low;
  }
}

/*
 * A histogram's bounds, in a phrase: how many, and from its smallest bucket's
 * bound (the first above zero, as the gate reads it) to its largest - "15
 * bounds, from 5 to 10,000".
 */
function describeBounds(evidence: MetricInsightEvidence): string {
  if (!evidence.boundCount) {
    return "";
  }

  const bounds: string =
    evidence.boundCount === 1
      ? "1 bound"
      : `${formatCount(evidence.boundCount)} bounds`;
  const smallest: string = formatMetricNumber(evidence.smallestBound || 0);
  const largest: string = formatMetricNumber(evidence.largestBound || 0);

  return smallest === largest
    ? `${bounds}, up to ${largest}`
    : `${bounds}, from ${smallest} to ${largest}`;
}

/*
 * The language a service's telemetry SDK reported, as people name it
 * ("nodejs" is Node.js): the name Services draw it by, or the value as it
 * was sent when it is not one of the OpenTelemetry SDKs' own.
 */
export function describeTelemetrySdkLanguage(language: string): string {
  const sent: string = (language || "").trim();

  return (
    SERVICE_LANGUAGE_DISPLAY_NAMES[sent.toLowerCase() as ServiceLanguage] ||
    sent
  );
}

function describeValueRange(evidence: MetricInsightEvidence): string {
  if (
    !isFiniteNumber(evidence.minValue) ||
    !isFiniteNumber(evidence.maxValue)
  ) {
    return "";
  }

  return `from ${formatMetricNumber(evidence.minValue)} to ${formatMetricNumber(evidence.maxValue)}`;
}

function describeBucketProblem(evidence: MetricInsightEvidence): string {
  const share: string = formatMetricPercent(evidence.bucketShare || 0);

  switch (evidence.bucketProblem) {
    case MetricBucketProblem.NoBuckets:
      return "It records every value into one bucket: it has no bucket bounds at all";
    case MetricBucketProblem.AboveLargestBucket:
      return `${share} of its values were above ${formatMetricNumber(evidence.largestBound || 0)}, its largest bucket's bound`;
    case MetricBucketProblem.BelowSmallestBucket:
    default:
      return `${share} of its values were at or below ${formatMetricNumber(evidence.smallestBound || 0)}, its smallest bucket's bound`;
  }
}

/*
 * What the problem is, in sentences: the opening of the request OneUptime
 * writes, and of the person's.
 */
export function describeMetricProblem(evidence: MetricInsightEvidence): string {
  switch (evidence.kind) {
    case MetricInsightKind.HighCardinality: {
      if (evidence.shape === MetricCardinalityShape.Name) {
        return `Over the last hour it sent ${formatCount(evidence.nameCount || 0)} metrics whose names differ only by an ID, all named like ${evidence.namePattern || "this"} (${formatCount(evidence.dataPointCount || 0)} data points together). Each ID makes a metric of its own.`;
      }

      const overflow: string = evidence.hasOverflow
        ? ` The SDK already folds its new series into one overflow series (${OTEL_METRIC_OVERFLOW_ATTRIBUTE}), so its numbers are wrong as well as costly.`
        : "";

      return `Over the last hour its attribute ${evidence.attributeKey || ""} took ${formatCount(evidence.attributeValueCount || 0)} different values, which look like ${describeMetricValueShape(evidence.valueShape)}. Every value makes a series of its own, so the metric costs more to store and its charts and monitors slow down.${overflow}`;
    }
    case MetricInsightKind.HistogramBuckets: {
      const range: string = describeValueRange(evidence);
      const unreadable: string =
        "its percentiles cannot be told apart: every chart and monitor reads the same number whatever the values were.";

      return [
        evidence.bucketProblem === MetricBucketProblem.NoBuckets
          ? `It has no bucket bounds, so every value it recorded over the last hour went into one bucket and ${unreadable}`
          : `Over the last hour ${describeBucketProblem(evidence)}, so ${unreadable}`,
        range ? `The values it recorded ranged ${range}.` : "",
        evidence.hasDefaultBounds
          ? "Its buckets are the OpenTelemetry SDKs' default ones, made for milliseconds."
          : "",
      ]
        .filter(hasText)
        .join(" ");
    }
    case MetricInsightKind.MissingRequestMetrics: {
      const protocols: Array<MetricServedProtocol> =
        getEvidenceServedProtocols(evidence);
      const sent: string = isFiniteNumber(evidence.sentMetricCount)
        ? `${formatCount(evidence.sentMetricCount)} ${evidence.sentMetricCount === 1 ? "metric" : "metrics"}`
        : "metrics";
      const missing: Array<string> = getMissingRequestMetricNames(protocols);
      const named: string =
        missing.length > 0 ? ` (${missing.join(", ")})` : "";

      return `It sent ${formatCount(evidence.spanCount || 0)} spans over the last hour, and ${sent} of its own, but has never sent a request metric for the ${describeServedProtocols(protocols)} it handles: none of the ones OpenTelemetry's semantic conventions name${named}, nor span metrics recorded from its traces. So nothing charts or alerts on its request rate, errors or latency over time without reading every span.${describeBusiestOperations(evidence, "Its busiest requests")}`;
    }
    case MetricInsightKind.MissingMetrics:
    default: {
      return `It sent ${formatCount(evidence.spanCount || 0)} spans over the last hour and has never sent a metric, so nothing charts or alerts on its request rate, errors or latency over time without reading every span.${describeBusiestOperations(evidence, "Its busiest operations")}`;
    }
  }
}

/*
 * A service's busiest operations, as a sentence after the problem's own:
 * " Its busiest operations: GET /orders (2,000), POST /checkout (900)." -
 * nothing when the evidence names none.
 */
function describeBusiestOperations(
  evidence: MetricInsightEvidence,
  lead: string,
): string {
  return evidence.topOperations && evidence.topOperations.length > 0
    ? ` ${lead}: ${evidence.topOperations
        .map((operation: { name: string; spanCount: number }) => {
          return `${operation.name} (${formatCount(operation.spanCount)})`;
        })
        .join(", ")}.`
    : "";
}

/*
 * The evidence as a person reads it on the insight (its detailMarkdown):
 * real numbers only, the facts first, then why it matters. Pure, so the
 * detector writes it and the browser suite draws exactly what the detector
 * wrote. Every name is written into Markdown escaped (mdText): a metric's
 * name or an attribute's key is the service's, not ours.
 */
export function buildMetricInsightDetail(data: {
  serviceName: string;
  evidence: MetricInsightEvidence;
}): MarkdownText {
  const evidence: MetricInsightEvidence = data.evidence;
  const lines: Array<MarkdownText> = [];

  switch (evidence.kind) {
    case MetricInsightKind.HighCardinality:
      lines.push(
        evidence.shape === MetricCardinalityShape.Name
          ? mdText`**Metric names with IDs in ${data.serviceName}**`
          : mdText`**High-cardinality metric in ${data.serviceName}**`,
      );
      break;
    case MetricInsightKind.HistogramBuckets:
      lines.push(
        mdText`**Histogram buckets that do not fit in ${data.serviceName}**`,
      );
      break;
    case MetricInsightKind.MissingRequestMetrics:
      lines.push(mdText`**Missing request metrics in ${data.serviceName}**`);
      break;
    default:
      lines.push(mdText`**Missing metrics in ${data.serviceName}**`);
  }

  lines.push(FeedMarkdown.empty());

  if (evidence.metricName) {
    lines.push(mdText`- Metric: \`${evidence.metricName}\``);
  }

  if (evidence.unit) {
    lines.push(mdText`- Unit: \`${evidence.unit}\``);
  }

  if (evidence.kind === MetricInsightKind.HighCardinality) {
    if (evidence.shape === MetricCardinalityShape.Name) {
      lines.push(mdText`- Names like: \`${evidence.namePattern || ""}\``);
      lines.push(
        mdText`- In the last hour: ${formatCount(evidence.nameCount || 0)} such names, ${formatCount(evidence.dataPointCount || 0)} data points`,
      );
      lines.push(
        mdText`- An ID in a metric's name makes a new metric for each value`,
      );
    } else {
      lines.push(
        mdText`- In the last hour: ${formatCount(evidence.dataPointCount || 0)} data points`,
      );
      lines.push(
        mdText`- Attribute: \`${evidence.attributeKey || ""}\`, ${formatCount(evidence.attributeValueCount || 0)} different values`,
      );
      lines.push(
        mdText`- Its values look like: ${describeMetricValueShape(evidence.valueShape)}`,
      );

      if (evidence.otherAttributes && evidence.otherAttributes.length > 0) {
        lines.push(
          mdText`- Also with many values: ${FeedMarkdown.join(
            evidence.otherAttributes.map(
              (attribute: MetricInsightAttributeEvidence): MarkdownText => {
                return mdText`\`${attribute.key}\` (${formatCount(attribute.valueCount)})`;
              },
            ),
            ", ",
          )}`,
        );
      }

      if (evidence.hasOverflow) {
        lines.push(
          mdText`- The SDK already folds new series into one overflow series (\`${OTEL_METRIC_OVERFLOW_ATTRIBUTE}\`): its numbers are wrong`,
        );
      }

      lines.push(
        mdText`- Every value makes a series of its own: it costs more to store, and its charts and monitors slow down`,
      );
    }
  }

  if (evidence.kind === MetricInsightKind.HistogramBuckets) {
    lines.push(
      mdText`- In the last hour: ${formatCount(evidence.dataPointCount || 0)} data points`,
    );
    lines.push(mdText`- ${describeBucketProblem(evidence)}`);

    const range: string = describeValueRange(evidence);

    if (range) {
      lines.push(mdText`- Values recorded: ${range}`);
    }

    const bounds: string = describeBounds(evidence);

    if (bounds) {
      lines.push(
        evidence.hasDefaultBounds
          ? mdText`- Buckets: ${bounds} - the OpenTelemetry SDKs' default ones, made for milliseconds`
          : mdText`- Buckets: ${bounds}`,
      );
    }

    lines.push(
      mdText`- Its percentiles cannot be told apart: every chart and monitor reads the same number`,
    );
  }

  if (evidence.kind === MetricInsightKind.MissingMetrics) {
    const failed: string = isFiniteNumber(evidence.failedSpanCount)
      ? `, ${formatCount(evidence.failedSpanCount)} failed`
      : "";

    lines.push(
      mdText`- In the last hour: ${formatCount(evidence.spanCount || 0)} spans${failed}`,
    );
    lines.push(mdText`- No metric has ever arrived from this service`);

    if (evidence.topOperations && evidence.topOperations.length > 0) {
      lines.push(
        mdText`- Busiest operations: ${FeedMarkdown.join(
          evidence.topOperations.map(
            (operation: { name: string; spanCount: number }): MarkdownText => {
              return mdText`\`${operation.name}\` (${formatCount(operation.spanCount)})`;
            },
          ),
          ", ",
        )}`,
      );
    }

    if (evidence.sdkLanguage) {
      lines.push(
        mdText`- Telemetry SDK: ${describeTelemetrySdkLanguage(evidence.sdkLanguage)}`,
      );
    }

    lines.push(
      mdText`- Without metrics, nothing charts or alerts on its request rate, errors or latency over time`,
    );
  }

  if (evidence.kind === MetricInsightKind.MissingRequestMetrics) {
    const protocols: Array<MetricServedProtocol> =
      getEvidenceServedProtocols(evidence);
    const failed: string = isFiniteNumber(evidence.failedSpanCount)
      ? `, ${formatCount(evidence.failedSpanCount)} failed`
      : "";

    lines.push(
      mdText`- In the last hour: ${formatCount(evidence.spanCount || 0)} spans${failed}`,
    );
    lines.push(mdText`- It handles: ${describeServedProtocols(protocols)}`);

    const sentNames: Array<MarkdownText> = (evidence.sentMetricNames || []).map(
      (name: string): MarkdownText => {
        return mdText`\`${name}\``;
      },
    );

    if (sentNames.length > 0) {
      const named: MarkdownText = FeedMarkdown.join(sentNames, ", ");

      lines.push(
        !isFiniteNumber(evidence.sentMetricCount)
          ? mdText`- Metrics it sent in the last hour include ${named}`
          : evidence.sentMetricCount > sentNames.length
            ? mdText`- Metrics it sent in the last hour: ${formatCount(evidence.sentMetricCount)}, such as ${named}`
            : mdText`- Metrics it sent in the last hour: ${named}`,
      );
    }

    const missing: Array<MarkdownText> = getMissingRequestMetricNames(
      protocols,
    ).map((name: string): MarkdownText => {
      return mdText`\`${name}\``;
    });

    if (missing.length > 0) {
      lines.push(
        missing.length === 1
          ? mdText`- Request metric it has never sent: ${FeedMarkdown.join(missing, ", ")}`
          : mdText`- Request metrics it has never sent: ${FeedMarkdown.join(missing, ", ")}`,
      );
    }

    if (evidence.topOperations && evidence.topOperations.length > 0) {
      lines.push(
        mdText`- Busiest requests: ${FeedMarkdown.join(
          evidence.topOperations.map(
            (operation: { name: string; spanCount: number }): MarkdownText => {
              return mdText`\`${operation.name}\` (${formatCount(operation.spanCount)})`;
            },
          ),
          ", ",
        )}`,
      );
    }

    if (evidence.sdkLanguage) {
      lines.push(
        mdText`- Telemetry SDK: ${describeTelemetrySdkLanguage(evidence.sdkLanguage)}`,
      );
    }

    lines.push(
      mdText`- Without request metrics, nothing charts or alerts on its request rate, errors or latency over time`,
    );
  }

  return FeedMarkdown.join(lines, "\n");
}

/*
 * The request's first line: what to do, and where - the task's title in
 * Code.
 */
export function getMetricFixRequestTitle(data: {
  evidence: MetricInsightEvidence;
  serviceName: string;
}): string {
  const evidence: MetricInsightEvidence = data.evidence;
  const service: string = data.serviceName || "this service";
  const metric: string = withService(
    evidence.metricName || "this metric",
    data.serviceName,
  );

  switch (evidence.kind) {
    case MetricInsightKind.HighCardinality:
      return evidence.shape === MetricCardinalityShape.Name
        ? `Take the IDs out of ${service}'s metric names like ${evidence.namePattern || "these"}`
        : `Stop recording ${evidence.attributeKey || "this attribute"} on ${metric}`;
    case MetricInsightKind.HistogramBuckets:
      return `Fix the buckets of ${metric}`;
    case MetricInsightKind.MissingRequestMetrics:
      return `Add request metrics to ${service}`;
    case MetricInsightKind.MissingMetrics:
    default:
      return `Add metrics to ${service}`;
  }
}

/*
 * What to record, for each kind of request a service handles: its request
 * metric and the attributes the semantic conventions record it with -
 * "http.server.request.duration for its HTTP requests (with
 * http.request.method, http.route and http.response.status_code)". An HTTP
 * server's when the evidence names none.
 */
function describeRequestMetricsToRecord(
  protocols: ReadonlyArray<MetricServedProtocol>,
): string {
  const named: Array<MetricServedProtocol> =
    protocols.length > 0 ? [...protocols] : [MetricServedProtocol.Http];

  return listInWords(
    METRIC_INSIGHT_SERVED_PROTOCOLS.filter(
      (protocol: MetricServedProtocol): boolean => {
        return named.includes(protocol);
      },
    ).map((protocol: MetricServedProtocol): string => {
      return `${METRIC_INSIGHT_REQUEST_METRIC_BY_PROTOCOL[protocol]} for its ${SERVED_PROTOCOL_PHRASES[protocol]} (with ${listInWords(
        [...METRIC_INSIGHT_REQUEST_METRIC_ATTRIBUTES[protocol]],
      )})`;
    }),
  );
}

// What a high-cardinality attribute's values could be replaced with.
function getAttributeReplacement(shape: unknown): string {
  switch (shape) {
    case MetricValueShape.UrlWithIds:
      return "record the route template (http.route) instead of the URL";
    case MetricValueShape.Timestamp:
      return "drop it, since every data point already has its time";
    case MetricValueShape.Number:
    case MetricValueShape.Uuid:
    case MetricValueShape.HexId:
    case MetricValueShape.Email:
      return "drop it, or record a value with a few possible values in its place (a tier, a type or a region rather than an ID)";
    default:
      return "drop it, or bucket it into a few possible values";
  }
}

// What the AI is asked to do, by kind - and what it must not.
function getMetricFixAsk(evidence: MetricInsightEvidence): string {
  switch (evidence.kind) {
    case MetricInsightKind.HighCardinality:
      if (evidence.shape === MetricCardinalityShape.Name) {
        return "Find where the code builds these metric names and use one fixed name in their place. If the part of the name that changes says something worth grouping by, record it as an attribute with a few possible values (a job's type, not its ID) - never the ID itself. Update the dashboards, alerts and tests in this repository that read the old names.";
      }

      return `Find where the code records this metric and stop putting ${evidence.attributeKey || "this attribute"} on it: ${getAttributeReplacement(evidence.valueShape)}. If the value helps when debugging, put it on the span or the log line instead, where one value per request costs nothing. Keep the metric's name and its other attributes as they are, and update the tests that check its attributes.`;
    case MetricInsightKind.HistogramBuckets:
      return evidence.bucketProblem === MetricBucketProblem.NoBuckets
        ? "Find where the code creates this histogram, or the view that sets its aggregation, and give it explicit bucket boundaries that spread the values it records over its buckets. Keep the metric's name, unit and attributes as they are."
        : `Find where the code creates this histogram, or the view that sets its aggregation, and give it bucket boundaries that fit the values it records - for a duration in seconds, the OpenTelemetry semantic conventions' boundaries (${OTEL_SECONDS_HISTOGRAM_BOUNDS.join(", ")}). If the values are recorded in another unit than the buckets were made for, fix that instead, so the metric's unit, its values and its buckets agree. Keep the metric's name and attributes as they are.`;
    case MetricInsightKind.MissingRequestMetrics:
      return `This service already exports metrics to OneUptime, but none for its requests. Record the request metrics OpenTelemetry's semantic conventions name for what it handles, each a histogram in seconds, recorded for every request: ${describeRequestMetricsToRecord(getEvidenceServedProtocols(evidence))}. Prefer the OpenTelemetry instrumentation package for the framework that handles them, which records these, or turn on the metrics of the instrumentation it already uses. Export them the way its other metrics are exported now. Give attributes only values with a few possible values (a route template, a method, a status code), never IDs or full URLs. Do not change what the code does.`;
    case MetricInsightKind.MissingMetrics:
    default:
      return "Set up the OpenTelemetry metrics SDK in this service and export its metrics to OneUptime the way its traces are exported now (the same endpoint, headers and service.name). Record the request count, the error count and the request duration (a histogram, in seconds) of its busiest operations, following the OpenTelemetry semantic conventions - prefer the instrumentation packages for the frameworks it uses. Give attributes only values with a few possible values (a route template, a method, a status code), never IDs or full URLs. Do not change what the code does.";
  }
}

// The leave OneUptime gives the AI on a task nobody waits on.
function getMetricFixLeave(evidence: MetricInsightEvidence): string {
  switch (evidence.kind) {
    case MetricInsightKind.MissingMetrics:
      return "If this service's metrics are recorded somewhere other than this repository, or reach OneUptime another way, say where and change nothing.";
    case MetricInsightKind.MissingRequestMetrics:
      return "If this service's request metrics are recorded somewhere other than this repository - a collector's span metrics, an agent, a proxy in front of it - or reach OneUptime under another service, say where and change nothing.";
    default:
      return "If this metric is recorded by a library, an agent or a collector configured outside this repository, say where and change nothing.";
  }
}

/*
 * What OneUptime asks the AI, for a finding: the title, what was found, and
 * what to do - said as OneUptime's own, with leave to change nothing, when
 * OneUptime starts the task itself (nobody waits on it to say otherwise).
 */
export function buildMetricFixRequestMessage(data: {
  evidence: MetricInsightEvidence;
  serviceName: string;
  isStartedByOneUptime: boolean;
}): string {
  const problem: string = describeMetricProblem(data.evidence);

  return [
    getMetricFixRequestTitle(data),
    "",
    data.isStartedByOneUptime
      ? `OneUptime found this in the service's metrics on its own. ${problem}`
      : problem,
    "",
    data.isStartedByOneUptime
      ? `${getMetricFixAsk(data.evidence)} ${getMetricFixLeave(data.evidence)}`
      : getMetricFixAsk(data.evidence),
  ].join("\n");
}

/*
 * What the task is told OneUptime found (the metric's data points may be
 * gone by the time it runs): the deterministic evidence, in plain text.
 */
export function buildMetricFixEvidenceNote(
  evidence: MetricInsightEvidence,
): string {
  const lines: Array<string> = [];

  if (evidence.metricName) {
    lines.push(`Metric: ${evidence.metricName}`);
  }

  if (evidence.unit) {
    lines.push(`Unit: ${evidence.unit}`);
  }

  lines.push(
    `Window: ${evidence.windowStartTime} to ${evidence.windowEndTime}`,
  );

  if (isFiniteNumber(evidence.dataPointCount)) {
    lines.push(
      `Data points in the window: ${formatCount(evidence.dataPointCount)}`,
    );
  }

  if (evidence.attributeKey) {
    lines.push(
      `Attribute: ${evidence.attributeKey}, ${formatCount(evidence.attributeValueCount || 0)} different values, which look like ${describeMetricValueShape(evidence.valueShape)}`,
    );
  }

  for (const attribute of evidence.otherAttributes || []) {
    lines.push(
      `Also many values: ${attribute.key} (${formatCount(attribute.valueCount)})`,
    );
  }

  if (evidence.hasOverflow) {
    lines.push(
      `The SDK folds new series into its overflow series (${OTEL_METRIC_OVERFLOW_ATTRIBUTE}).`,
    );
  }

  if (evidence.namePattern) {
    lines.push(
      `Names like: ${evidence.namePattern} (${formatCount(evidence.nameCount || 0)} names; {id} stands for the part that changes)`,
    );
  }

  if (evidence.kind === MetricInsightKind.HistogramBuckets) {
    lines.push(describeBucketProblem(evidence));

    const range: string = describeValueRange(evidence);

    if (range) {
      lines.push(`Values recorded: ${range}`);
    }

    const bounds: string = describeBounds(evidence);

    if (bounds) {
      lines.push(
        `Buckets: ${bounds}${evidence.hasDefaultBounds ? " (the OpenTelemetry SDKs' default buckets)" : ""}`,
      );
    }
  }

  if (evidence.kind === MetricInsightKind.MissingMetrics) {
    lines.push(`Spans in the window: ${formatCount(evidence.spanCount || 0)}`);

    if (isFiniteNumber(evidence.failedSpanCount)) {
      lines.push(`Failed spans: ${formatCount(evidence.failedSpanCount)}`);
    }

    for (const operation of evidence.topOperations || []) {
      lines.push(
        `Busy operation: ${operation.name} (${formatCount(operation.spanCount)} spans)`,
      );
    }

    if (evidence.sdkLanguage) {
      lines.push(`Telemetry SDK language: ${evidence.sdkLanguage}`);
    }
  }

  if (evidence.kind === MetricInsightKind.MissingRequestMetrics) {
    const protocols: Array<MetricServedProtocol> =
      getEvidenceServedProtocols(evidence);

    lines.push(`Spans in the window: ${formatCount(evidence.spanCount || 0)}`);

    if (isFiniteNumber(evidence.failedSpanCount)) {
      lines.push(`Failed spans: ${formatCount(evidence.failedSpanCount)}`);
    }

    lines.push(`It handles: ${describeServedProtocols(protocols)}`);

    if (evidence.sentMetricNames && evidence.sentMetricNames.length > 0) {
      lines.push(
        isFiniteNumber(evidence.sentMetricCount)
          ? `Metrics it sent in the window: ${formatCount(evidence.sentMetricCount)} (${evidence.sentMetricNames.join(", ")})`
          : `Metrics it sent in the window include: ${evidence.sentMetricNames.join(", ")}`,
      );
    }

    const missing: Array<string> = getMissingRequestMetricNames(protocols);

    if (missing.length > 0) {
      lines.push(`Request metrics it never sent: ${missing.join(", ")}`);
    }

    for (const operation of evidence.topOperations || []) {
      lines.push(
        `Busy request: ${operation.name} (${formatCount(operation.spanCount)} spans)`,
      );
    }

    if (evidence.sdkLanguage) {
      lines.push(`Telemetry SDK language: ${evidence.sdkLanguage}`);
    }
  }

  return lines.join("\n");
}
