import { PROMQL_METRIC_NAME_LABEL } from "./PromQLAst";
import { PromQLLabels } from "./PromQLLabels";

/*
 * How OneUptime's OpenTelemetry metrics are named in PromQL (issue #6796).
 *
 * OneUptime stores metrics the OpenTelemetry way: a name with dots
 * (`http.server.request.duration`), attributes with dots, resource
 * attributes under `resource.`, and histograms and summaries as one point
 * each. PromQL reads them the way Prometheus' own OpenTelemetry translation
 * names them, so a query written for Prometheus works here:
 *
 *   - a name or label name's dots and dashes become underscores:
 *     `http.server.request.duration` is `http_server_request_duration`,
 *     `resource.service.name` is `resource_service_name`;
 *   - a histogram is three series: `_bucket` (with `le`), `_count`, `_sum`;
 *   - a summary is its quantiles (with `quantile`), `_count` and `_sum`;
 *   - `job` and `instance` come from the resource's service.name (with its
 *     service.namespace) and service.instance.id, as Prometheus sets them;
 *   - a counter may be named with or without `_total`.
 *
 * Prometheus 3's quoted names reach a name as it is stored:
 * `{"http.server.request.duration"}`.
 */

const INVALID_METRIC_NAME_CHARACTERS: RegExp = /[^a-zA-Z0-9_:]/g;

const INVALID_LABEL_NAME_CHARACTERS: RegExp = /[^a-zA-Z0-9_]/g;

/*
 * The same rule in ClickHouse SQL (re2), for reading attributes by the
 * label name a query uses. Kept beside the JavaScript rule it mirrors.
 */
export const PROMQL_LABEL_NAME_SQL_PATTERN: string = "[^a-zA-Z0-9_]";

// A stored metric name as PromQL names it.
export const toPromQLMetricName: (name: string) => string = (
  name: string,
): string => {
  return name.replace(INVALID_METRIC_NAME_CHARACTERS, "_");
};

// An attribute key as PromQL names it.
export const toPromQLLabelName: (key: string) => string = (
  key: string,
): string => {
  return key.replace(INVALID_LABEL_NAME_CHARACTERS, "_");
};

/*
 * Attributes that say nothing about the series: the raw list of an
 * instrumentation scope's attributes, and how many it dropped.
 */
const IGNORED_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set<string>([
  "scope.attributes",
  "scope.droppedAttributesCount",
  "scope.dropped_attributes_count",
]);

// Labels the series kind sets, which no attribute may take over.
const RESERVED_LABELS: ReadonlySet<string> = new Set<string>([
  PROMQL_METRIC_NAME_LABEL,
  "le",
  "quantile",
]);

/*
 * The labels of a series from its attributes. Two keys that name the same
 * label (`a.b` and `a_b`) join their values with ";", in key order, as
 * Prometheus' translation joins them. Empty values are left out: in PromQL
 * an empty label is an absent one.
 */
export const attributesToPromQLLabels: (
  attributes: Record<string, unknown>,
) => PromQLLabels = (attributes: Record<string, unknown>): PromQLLabels => {
  const labels: PromQLLabels = {};

  for (const key of Object.keys(attributes).sort()) {
    if (IGNORED_ATTRIBUTE_KEYS.has(key)) {
      continue;
    }

    const raw: unknown = attributes[key];

    if (raw === null || raw === undefined) {
      continue;
    }

    const value: string = typeof raw === "string" ? raw : String(raw);

    if (value.length === 0) {
      continue;
    }

    const label: string = toPromQLLabelName(key);

    if (RESERVED_LABELS.has(label)) {
      continue;
    }

    const existing: string | undefined = labels[label];
    labels[label] = existing === undefined ? value : `${existing};${value}`;
  }

  // job and instance, the way Prometheus derives them from the resource.
  const serviceName: string | undefined = stringAttribute(
    attributes,
    "resource.service.name",
  );
  const serviceNamespace: string | undefined = stringAttribute(
    attributes,
    "resource.service.namespace",
  );
  const instanceId: string | undefined = stringAttribute(
    attributes,
    "resource.service.instance.id",
  );

  if (serviceName && labels["job"] === undefined) {
    labels["job"] = serviceNamespace
      ? `${serviceNamespace}/${serviceName}`
      : serviceName;
  }

  if (instanceId && labels["instance"] === undefined) {
    labels["instance"] = instanceId;
  }

  return labels;
};

const stringAttribute: (
  attributes: Record<string, unknown>,
  key: string,
) => string | undefined = (
  attributes: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value: unknown = attributes[key];

  if (value === null || value === undefined) {
    return undefined;
  }

  const text: string = typeof value === "string" ? value : String(value);
  return text.length > 0 ? text : undefined;
};

// Which of a stored metric's series a query asks for.
export enum PromQLSeriesKind {
  // A gauge's or sum's value, or a summary's quantiles.
  Value = "value",
  // A histogram's cumulative buckets, with `le`.
  Bucket = "bucket",
  // A histogram's or summary's count.
  Count = "count",
  // A histogram's or summary's sum.
  Sum = "sum",
}

export interface PromQLMetricRequest {
  // The metric name as OneUptime stores it.
  storedName: string;
  kind: PromQLSeriesKind;
  // The name the series is given: as the query wrote it, when it named one.
  seriesName: string;
}

const SUFFIXES: ReadonlyArray<{ suffix: string; kind: PromQLSeriesKind }> = [
  { suffix: "_bucket", kind: PromQLSeriesKind.Bucket },
  { suffix: "_count", kind: PromQLSeriesKind.Count },
  { suffix: "_sum", kind: PromQLSeriesKind.Sum },
];

/*
 * The stored metrics a metric name in a query can mean, given the names the
 * project stores (lowercase, as ingest stores them). `http_requests_total`
 * means a metric stored under that name or under `http_requests`;
 * `x_bucket` means a histogram `x` (or a metric literally called
 * `x_bucket`); `http_server_duration` means `http.server.duration`.
 *
 * The name a query writes is always tried as it is, even when the catalog
 * does not list it, so a metric is found before the catalog catches up.
 */
export const resolvePromQLMetricName: (
  queriedName: string,
  storedNames: ReadonlyArray<string>,
) => Array<PromQLMetricRequest> = (
  queriedName: string,
  storedNames: ReadonlyArray<string>,
): Array<PromQLMetricRequest> => {
  const wanted: string = queriedName.toLowerCase();
  const requests: Map<string, PromQLMetricRequest> = new Map();

  const add: (storedName: string, kind: PromQLSeriesKind) => void = (
    storedName: string,
    kind: PromQLSeriesKind,
  ): void => {
    requests.set(`${storedName}\u0000${kind}`, {
      storedName,
      kind,
      seriesName: queriedName,
    });
  };

  add(wanted, PromQLSeriesKind.Value);

  for (const { suffix, kind } of SUFFIXES) {
    if (wanted.endsWith(suffix) && wanted.length > suffix.length) {
      add(wanted.slice(0, -suffix.length), kind);
    }
  }

  if (wanted.endsWith("_total") && wanted.length > "_total".length) {
    add(wanted.slice(0, -"_total".length), PromQLSeriesKind.Value);
  }

  for (const stored of storedNames) {
    const promName: string = toPromQLMetricName(stored);

    if (stored === wanted || promName === wanted) {
      add(stored, PromQLSeriesKind.Value);
    }

    if (`${promName}_total` === wanted) {
      add(stored, PromQLSeriesKind.Value);
    }

    for (const { suffix, kind } of SUFFIXES) {
      if (`${promName}${suffix}` === wanted) {
        add(stored, kind);
      }
    }
  }

  return Array.from(requests.values());
};

/*
 * The PromQL names of a stored metric's series, given how it is stored
 * (unknown point types get the plain name only).
 */
export const promQLSeriesNamesOf: (
  storedName: string,
  pointType: string | undefined,
) => Array<{ name: string; kind: PromQLSeriesKind }> = (
  storedName: string,
  pointType: string | undefined,
): Array<{ name: string; kind: PromQLSeriesKind }> => {
  const base: string = toPromQLMetricName(storedName);

  if (pointType === "Histogram") {
    return [
      { name: `${base}_bucket`, kind: PromQLSeriesKind.Bucket },
      { name: `${base}_count`, kind: PromQLSeriesKind.Count },
      { name: `${base}_sum`, kind: PromQLSeriesKind.Sum },
    ];
  }

  if (pointType === "ExponentialHistogram") {
    return [
      { name: `${base}_count`, kind: PromQLSeriesKind.Count },
      { name: `${base}_sum`, kind: PromQLSeriesKind.Sum },
    ];
  }

  if (pointType === "Summary") {
    return [
      { name: base, kind: PromQLSeriesKind.Value },
      { name: `${base}_count`, kind: PromQLSeriesKind.Count },
      { name: `${base}_sum`, kind: PromQLSeriesKind.Sum },
    ];
  }

  return [{ name: base, kind: PromQLSeriesKind.Value }];
};
