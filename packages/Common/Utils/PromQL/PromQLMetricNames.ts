import { PROMQL_METRIC_NAME_LABEL } from "./PromQLAst";
import { PromQLLabels, promQLLabelValue } from "./PromQLLabels";
import { lookupTable, writeOwnValue } from "../LookupTable";

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
 *   - a counter may be named with or without `_total`;
 *   - the unit is part of the name, as exporters write it (issue #7715):
 *     `http.server.request.duration` in seconds is also
 *     `http_server_request_duration_seconds_bucket`, a gauge in `1` ends
 *     in `_ratio` (prometheusNamesOf, below).
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

    /*
     * The series' own labels, read and written: an attribute may be named
     * constructor, or __proto__.
     */
    const existing: string = promQLLabelValue(labels, label);
    writeOwnValue(
      labels,
      label,
      existing.length === 0 ? value : `${existing};${value}`,
    );
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

/*
 * A metric of the project's catalog (MetricType): its name as ingest
 * stores it (lowercase), and the unit and monotonicity its exporter
 * declared, which Prometheus writes into the name. A bare name is a metric
 * the catalog says nothing more about.
 */
export interface PromQLStoredMetric {
  name: string;
  unit?: string | undefined;
  isMonotonic?: boolean | undefined;
}

// A catalog entry, whether a name alone or a metric with its unit.
export type PromQLStoredMetricEntry = string | PromQLStoredMetric;

export const toPromQLStoredMetric: (
  entry: PromQLStoredMetricEntry,
) => PromQLStoredMetric = (
  entry: PromQLStoredMetricEntry,
): PromQLStoredMetric => {
  return typeof entry === "string" ? { name: entry } : entry;
};

const SUFFIXES: ReadonlyArray<{ suffix: string; kind: PromQLSeriesKind }> = [
  { suffix: "_bucket", kind: PromQLSeriesKind.Bucket },
  { suffix: "_count", kind: PromQLSeriesKind.Count },
  { suffix: "_sum", kind: PromQLSeriesKind.Sum },
];

/*
 * UNITS IN PROMETHEUS NAMES (issue #7715).
 *
 * OpenTelemetry's Prometheus compatibility rules (Metric Metadata, "Unit")
 * put a metric's unit into its Prometheus name, the way Prometheus 3's OTLP
 * receiver and the OpenTelemetry Collector's Prometheus exporters write it
 * (github.com/prometheus/otlptranslator, normalizeName): the unit's word
 * (`s` is `seconds`, `By` is `bytes`), `x/y` as `x_per_y`, a unit in braces
 * (`{request}`) left out, a gauge in `1` ending in `_ratio`, a counter in
 * `_total`, and the unit not written twice. So dashboards and alert rules
 * written against those systems find OneUptime's metrics by their names.
 *
 * Kept exactly as otlptranslator keeps them, its tables and its order.
 */

// The word a unit is in a name. A unit not listed is written as it is.
const UNIT_WORDS: ReadonlyMap<string, string> = lookupTable<string>({
  // Time
  d: "days",
  h: "hours",
  min: "minutes",
  s: "seconds",
  ms: "milliseconds",
  us: "microseconds",
  ns: "nanoseconds",
  // Bytes
  By: "bytes",
  KiBy: "kibibytes",
  MiBy: "mebibytes",
  GiBy: "gibibytes",
  TiBy: "tibibytes",
  KBy: "kilobytes",
  MBy: "megabytes",
  GBy: "gigabytes",
  TBy: "terabytes",
  // SI
  m: "meters",
  V: "volts",
  A: "amperes",
  J: "joules",
  W: "watts",
  g: "grams",
  // Misc
  Cel: "celsius",
  Hz: "hertz",
  "1": "",
  "%": "percent",
});

// The word the unit after a slash is: `By/s` is bytes per second.
const PER_UNIT_WORDS: ReadonlyMap<string, string> = lookupTable<string>({
  s: "second",
  m: "minute",
  h: "hour",
  d: "day",
  w: "week",
  mo: "month",
  y: "year",
});

// What splits a name into its words: anything but a letter, digit or colon.
const NAME_WORD_SEPARATORS: RegExp = /[^a-zA-Z0-9:]+/;

const NON_METRIC_NAME_CHARACTERS: RegExp = /[^a-zA-Z0-9:]/g;

const MULTIPLE_UNDERSCORES: RegExp = /__+/g;

// A unit written in braces, such as {request}: an annotation, no unit.
const UNIT_ANNOTATION: RegExp = /[{}]/;

const STARTS_WITH_DIGIT: RegExp = /^[0-9]/;

// A name Prometheus' names may be, with no character escaped.
const PROMETHEUS_METRIC_NAME: RegExp = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

// A unit's word as a name may hold it (otlptranslator's cleanUpUnit).
const cleanUpUnit: (unit: string) => string = (unit: string): string => {
  const cleaned: string = unit
    .replace(NON_METRIC_NAME_CHARACTERS, "_")
    .replace(MULTIPLE_UNDERSCORES, "_");

  return cleaned.startsWith("_") ? cleaned.slice(1) : cleaned;
};

/*
 * The words a unit adds to a name: its own, and the one it is per. `By/s`
 * adds `bytes` and `per_second`, `{packet}/s` only `per_second`, `1` and
 * `{request}` nothing (otlptranslator's buildUnitSuffixes).
 */
export const getPrometheusUnitSuffixes: (unit: string | undefined) => {
  main: string;
  per: string;
} = (unit: string | undefined): { main: string; per: string } => {
  const parts: Array<string> = (unit || "").split("/");
  const mainUnit: string = (parts[0] || "").trim();
  // Everything after the first slash, as SplitN(unit, "/", 2) keeps it.
  const perUnit: string = parts.length > 1 ? parts.slice(1).join("/") : "";

  let main: string = "";
  let per: string = "";

  if (mainUnit && !UNIT_ANNOTATION.test(mainUnit)) {
    main = UNIT_WORDS.get(mainUnit) ?? mainUnit;
  }

  const perUnitText: string = perUnit.trim();

  if (perUnitText && !UNIT_ANNOTATION.test(perUnitText)) {
    const perWord: string = PER_UNIT_WORDS.get(perUnitText) ?? perUnitText;

    if (perWord) {
      per = `per_${perWord}`;
    }
  }

  return { main: cleanUpUnit(main), per: cleanUpUnit(per) };
};

// The words of a name and its unit (otlptranslator's addUnitTokens).
const addUnitWords: (
  words: Array<string>,
  unit: string | undefined,
) => Array<string> = (
  words: Array<string>,
  unit: string | undefined,
): Array<string> => {
  const suffixes: { main: string; per: string } =
    getPrometheusUnitSuffixes(unit);
  let main: string = words.includes(suffixes.main) ? "" : suffixes.main;
  let per: string = suffixes.per;

  if (per === "per_") {
    per = "";
  } else {
    per = per.endsWith("_") ? per.slice(0, -1) : per;

    if (words.includes(per)) {
      per = "";
    }
  }

  if (per && main.endsWith("_")) {
    main = main.slice(0, -1);
  }

  return [...words, ...(main ? [main] : []), ...(per ? [per] : [])];
};

// How Prometheus names a metric of each kind, which decides its suffixes.
export enum PrometheusMetricType {
  Gauge = "gauge",
  // A monotonic sum: a counter, named with _total.
  Counter = "counter",
  // A sum that goes up and down: written as a gauge, never with _ratio.
  UpDownCounter = "updowncounter",
  Histogram = "histogram",
  ExponentialHistogram = "exponentialhistogram",
  Summary = "summary",
}

const joinWords: (words: Array<string>) => string = (
  words: Array<string>,
): string => {
  const name: string = words.join("_");

  // A name never starts with a digit.
  return STARTS_WITH_DIGIT.test(name) ? `_${name}` : name;
};

const withoutWord: (words: Array<string>, word: string) => Array<string> = (
  words: Array<string>,
  word: string,
): Array<string> => {
  return words.filter((item: string): boolean => {
    return item !== word;
  });
};

/*
 * A stored metric's Prometheus name, as Prometheus 3 and the OpenTelemetry
 * Collector's exporters write it (otlptranslator's normalizeName): its
 * words and its unit's, then `_total` for a counter and `_ratio` for a
 * gauge in `1`. A histogram's and a summary's series add their own
 * suffixes (`_bucket`, `_count`, `_sum`) after it.
 */
export const toPrometheusMetricName: (data: {
  name: string;
  unit?: string | undefined;
  type: PrometheusMetricType;
}) => string = (data: {
  name: string;
  unit?: string | undefined;
  type: PrometheusMetricType;
}): string => {
  let words: Array<string> = addUnitWords(
    data.name.split(NAME_WORD_SEPARATORS).filter((word: string): boolean => {
      return word.length > 0;
    }),
    data.unit,
  );

  if (data.type === PrometheusMetricType.Counter) {
    words = [...withoutWord(words, "total"), "total"];
  }

  if (data.unit === "1" && data.type === PrometheusMetricType.Gauge) {
    words = [...withoutWord(words, "ratio"), "ratio"];
  }

  return joinWords(words);
};

// The Prometheus type of a stored point type, with what the catalog says.
export const getPrometheusMetricType: (data: {
  pointType: string | undefined;
  isMonotonic: boolean | undefined;
}) => PrometheusMetricType = (data: {
  pointType: string | undefined;
  isMonotonic: boolean | undefined;
}): PrometheusMetricType => {
  switch (data.pointType) {
    case "Histogram":
      return PrometheusMetricType.Histogram;
    case "ExponentialHistogram":
      return PrometheusMetricType.ExponentialHistogram;
    case "Summary":
      return PrometheusMetricType.Summary;
    case "Sum":
      return data.isMonotonic
        ? PrometheusMetricType.Counter
        : PrometheusMetricType.UpDownCounter;
    case "Gauge":
      return PrometheusMetricType.Gauge;
    default:
      // Unknown: the catalog's monotonicity is all there is to go by.
      return data.isMonotonic
        ? PrometheusMetricType.Counter
        : PrometheusMetricType.Gauge;
  }
};

/*
 * Every name a stored metric answers to in a query, each with the series
 * it means: the names without the unit, as OneUptime has always named
 * them, and the names with it. Several names for one series is what lets
 * a query written either way find it; a selector by pattern reads each
 * series under one of them only (resolvePromQLSelection).
 */
export const promQLNamesOfStoredMetric: (
  metric: PromQLStoredMetric,
) => Array<{ name: string; kind: PromQLSeriesKind }> = (
  metric: PromQLStoredMetric,
): Array<{ name: string; kind: PromQLSeriesKind }> => {
  const names: Map<string, { name: string; kind: PromQLSeriesKind }> =
    new Map();

  const add: (name: string, kind: PromQLSeriesKind) => void = (
    name: string,
    kind: PromQLSeriesKind,
  ): void => {
    if (name && !names.has(`${name}\u0000${kind}`)) {
      names.set(`${name}\u0000${kind}`, { name, kind });
    }
  };

  const addPlain: () => void = (): void => {
    const plain: string = toPromQLMetricName(metric.name);

    add(plain, PromQLSeriesKind.Value);
    add(`${plain}_total`, PromQLSeriesKind.Value);

    for (const { suffix, kind } of SUFFIXES) {
      add(`${plain}${suffix}`, kind);
    }
  };

  /*
   * A metric already sent under its Prometheus name (remote write keeps
   * `http_request_duration_seconds_bucket` as it is, and calls it a
   * counter) is that name first: adding `_total` to it would name another
   * metric.
   */
  if (isPrometheusMetricName(metric.name)) {
    addPlain();
  }

  // The Prometheus names: the ones a selector by pattern prefers.
  const unitFamily: string = toPrometheusMetricName({
    name: metric.name,
    unit: metric.unit,
    type: PrometheusMetricType.UpDownCounter,
  });
  const counter: string = toPrometheusMetricName({
    name: metric.name,
    unit: metric.unit,
    type: PrometheusMetricType.Counter,
  });
  const gauge: string = toPrometheusMetricName({
    name: metric.name,
    unit: metric.unit,
    type: PrometheusMetricType.Gauge,
  });

  if (metric.isMonotonic) {
    add(counter, PromQLSeriesKind.Value);
  } else {
    add(gauge, PromQLSeriesKind.Value);
  }

  add(unitFamily, PromQLSeriesKind.Value);
  add(counter, PromQLSeriesKind.Value);
  add(gauge, PromQLSeriesKind.Value);

  for (const { suffix, kind } of SUFFIXES) {
    add(`${unitFamily}${suffix}`, kind);
  }

  // Then the names without the unit, as before.
  addPlain();

  return Array.from(names.values());
};

/*
 * Whether a stored name is already a Prometheus name: no dot, dash or any
 * other character Prometheus' names do not hold. Such a metric came from
 * a Prometheus sender (remote write), or was named for one, and is listed
 * as it is stored.
 */
export const isPrometheusMetricName: (name: string) => boolean = (
  name: string,
): boolean => {
  return PROMETHEUS_METRIC_NAME.test(name);
};

/*
 * The one name each series of a stored metric has, for a selector that
 * picks series by a pattern or leaves names out (`{__name__=~"http_.+"}`,
 * `{__name__!="up"}`): the name Prometheus gives it, with its unit, as in
 * Prometheus a series has one name. A name it is only also known by
 * (without its unit, or with `_total` when it is no counter) finds it when
 * written out (resolvePromQLMetricName), but a pattern is matched against
 * this one, so leaving a name out leaves the series out.
 *
 * The point type is not known here (the rows tell it): a series that is
 * not a counter is named as a gauge.
 */
export const canonicalPromQLNamesOf: (
  metric: PromQLStoredMetric,
) => Array<{ name: string; kind: PromQLSeriesKind }> = (
  metric: PromQLStoredMetric,
): Array<{ name: string; kind: PromQLSeriesKind }> => {
  const prometheusNamed: boolean = isPrometheusMetricName(metric.name);
  const family: string = prometheusNamed
    ? toPromQLMetricName(metric.name)
    : toPrometheusMetricName({
        name: metric.name,
        unit: metric.unit,
        type: PrometheusMetricType.UpDownCounter,
      });
  const value: string = prometheusNamed
    ? family
    : toPrometheusMetricName({
        name: metric.name,
        unit: metric.unit,
        type: metric.isMonotonic
          ? PrometheusMetricType.Counter
          : PrometheusMetricType.Gauge,
      });

  return [
    { name: value, kind: PromQLSeriesKind.Value },
    ...SUFFIXES.map(
      ({
        suffix,
        kind,
      }: {
        suffix: string;
        kind: PromQLSeriesKind;
      }): { name: string; kind: PromQLSeriesKind } => {
        return { name: `${family}${suffix}`, kind };
      },
    ),
  ];
};

/*
 * The stored metrics a metric name in a query can mean, given the metrics
 * the project stores (lowercase, as ingest stores them). `http_requests_total`
 * means a metric stored under that name or under `http_requests`;
 * `x_bucket` means a histogram `x` (or a metric literally called
 * `x_bucket`); `http_server_duration` means `http.server.duration`; and a
 * name with its unit, such as `http_server_request_duration_seconds_bucket`,
 * means the metric whose catalog unit is that one (`s`).
 *
 * The name a query writes is always tried as it is, even when the catalog
 * does not list it, so a metric is found before the catalog catches up.
 */
export const resolvePromQLMetricName: (
  queriedName: string,
  storedMetrics: ReadonlyArray<PromQLStoredMetricEntry>,
) => Array<PromQLMetricRequest> = (
  queriedName: string,
  storedMetrics: ReadonlyArray<PromQLStoredMetricEntry>,
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

  for (const entry of storedMetrics) {
    const metric: PromQLStoredMetric = toPromQLStoredMetric(entry);

    if (metric.name === wanted) {
      add(metric.name, PromQLSeriesKind.Value);
    }

    for (const { name, kind } of promQLNamesOfStoredMetric(metric)) {
      // Prometheus names are case-sensitive; ingest stores names lowercase.
      if (name.toLowerCase() === wanted) {
        add(metric.name, kind);
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

/*
 * A stored metric's family name as Prometheus lists it (issue #7715): with
 * its unit and, for a counter, `_total`; a histogram's or summary's series
 * add their suffixes to it. A metric already under a Prometheus name keeps
 * it. What /api/v1/metadata keys a metric by.
 */
export const toPrometheusFamilyName: (data: {
  metric: PromQLStoredMetric;
  pointType: string | undefined;
}) => string = (data: {
  metric: PromQLStoredMetric;
  pointType: string | undefined;
}): string => {
  if (isPrometheusMetricName(data.metric.name)) {
    return toPromQLMetricName(data.metric.name);
  }

  return toPrometheusMetricName({
    name: data.metric.name,
    unit: data.metric.unit,
    type: getPrometheusMetricType({
      pointType: data.pointType,
      isMonotonic: data.metric.isMonotonic,
    }),
  });
};

/*
 * The names a stored metric's series are listed under, as Prometheus 3
 * and the OpenTelemetry Collector's exporters name them (issue #7715): one
 * name for each series, the unit's included, so the PromQL tab's metric
 * picker and Grafana's metric browser show what dashboards written against
 * those systems use. The names without the unit still find the metric
 * (resolvePromQLMetricName); they are not listed twice.
 */
export const prometheusSeriesNamesOf: (
  metric: PromQLStoredMetric,
  pointType: string | undefined,
) => Array<{ name: string; kind: PromQLSeriesKind }> = (
  metric: PromQLStoredMetric,
  pointType: string | undefined,
): Array<{ name: string; kind: PromQLSeriesKind }> => {
  if (isPrometheusMetricName(metric.name)) {
    return promQLSeriesNamesOf(metric.name, pointType);
  }

  const family: string = toPrometheusFamilyName({ metric, pointType });

  if (pointType === "Histogram") {
    return [
      { name: `${family}_bucket`, kind: PromQLSeriesKind.Bucket },
      { name: `${family}_count`, kind: PromQLSeriesKind.Count },
      { name: `${family}_sum`, kind: PromQLSeriesKind.Sum },
    ];
  }

  if (pointType === "ExponentialHistogram") {
    return [
      { name: `${family}_count`, kind: PromQLSeriesKind.Count },
      { name: `${family}_sum`, kind: PromQLSeriesKind.Sum },
    ];
  }

  if (pointType === "Summary") {
    return [
      { name: family, kind: PromQLSeriesKind.Value },
      { name: `${family}_count`, kind: PromQLSeriesKind.Count },
      { name: `${family}_sum`, kind: PromQLSeriesKind.Sum },
    ];
  }

  return [{ name: family, kind: PromQLSeriesKind.Value }];
};

/*
 * A unit as Prometheus' metadata writes it: `s` is `seconds`, `By/s` is
 * `bytes_per_second`, `1` and `{request}` nothing.
 */
export const toPrometheusUnit: (unit: string | undefined) => string = (
  unit: string | undefined,
): string => {
  const suffixes: { main: string; per: string } =
    getPrometheusUnitSuffixes(unit);
  const per: string =
    suffixes.per === "per_" ? "" : suffixes.per.replace(/_$/, "");
  const main: string = per ? suffixes.main.replace(/_$/, "") : suffixes.main;

  return [main, per]
    .filter((word: string): boolean => {
      return word.length > 0;
    })
    .join("_");
};
