import { JSONObject } from "../../Types/JSON";
import {
  parseSearchQuery,
  SearchToken,
  SearchTokenType,
  SearchValuePredicate,
} from "../../Types/Telemetry/TelemetrySearchQuery";
import { fillTemplate, translationKey } from "../../Types/Translator";

/*
 * AN SLO FROM A METRIC (#8445).
 *
 * A Metric SLO counts good and total events from a metric its services
 * send, the way a request SLO counts them from their traces - for teams
 * that export request counters and latency histograms (Prometheus
 * `http_requests_total`, OpenTelemetry `http.server.request.duration`),
 * and services that send no traces. It is stored in the SLO's
 * metricQueryConfig column, in one of two kinds:
 *
 *   - Counter: an OpenTelemetry Sum (a Prometheus counter). Its events are
 *     what the counter grew by; the good ones are its growth on the series
 *     that match the good condition, a search of the metric's attributes
 *     such as `@http.response.status_code:<500`.
 *   - Histogram: an explicit-bucket histogram. Its events are its
 *     observations; the good ones are those at or under a value, in the
 *     metric's own unit (0.3 for 300 ms of a histogram in seconds), read
 *     from the buckets whose upper bound is at or under it - so the value
 *     should be one of the histogram's bucket boundaries.
 *
 * Either kind can be narrowed by a filter of the same grammar
 * (`@http.route:/checkout*`). The searches use the Metrics explorer's
 * grammar (Types/Telemetry/TelemetrySearchQuery): every term is an
 * attribute, `-` leaves a series out, and every term must match. The
 * counting (Server/Utils/Slo/SloMetricCounting) compiles each term with the
 * metric table's own statement generator, so a value is always a typed
 * parameter.
 */

export enum SloMetricKind {
  Counter = "Counter",
  Histogram = "Histogram",
}

export interface SloMetricQueryConfig {
  metricName: string;
  kind: SloMetricKind;
  // Counter: which of its series are good events.
  goodFilter?: string | undefined;
  // Histogram: the value a good observation is at or under.
  goodAtOrUnder?: number | undefined;
  // Either: which of the metric's series count at all.
  filter?: string | undefined;
}

export const SLO_METRIC_NAME_MAX_LENGTH: number = 300;

export const SLO_METRIC_FILTER_MAX_LENGTH: number = 500;

export const SLO_METRIC_FILTER_MAX_TERMS: number = 10;

/*
 * Metrics OneUptime writes itself: an SLO's own oneuptime.slo.* series, and
 * the incident, alert and maintenance series kept in another table. None is
 * a service's events.
 */
export const SLO_METRIC_RESERVED_PREFIX: string = "oneuptime.";

// Which part of the configuration a problem is about, so the form shows it there.
export enum SloMetricQueryPart {
  MetricName = "metricName",
  Kind = "kind",
  GoodFilter = "goodFilter",
  GoodAtOrUnder = "goodAtOrUnder",
  Filter = "filter",
}

export const SLO_METRIC_QUERY_ERRORS: {
  noMetricName: string;
  metricNameTooLong: string;
  reservedMetricName: string;
  noKind: string;
  noGoodFilter: string;
  noGoodAtOrUnder: string;
  filterTooLong: string;
  filterTooManyTerms: string;
  freeText: string;
} = {
  noMetricName: translationKey(
    "Choose the metric this SLO counts, such as http.server.request.duration.",
  ),
  metricNameTooLong: translationKey(
    "A metric name can be at most {{max}} characters long.",
  ),
  reservedMetricName: translationKey(
    "This is one of OneUptime's own metrics, not your services' events. Choose a metric your services send.",
  ),
  noKind: translationKey(
    "Choose how good events are told apart: by a condition on a counter, or by a value a histogram's observations stay at or under.",
  ),
  noGoodFilter: translationKey(
    "Say which of the counter's events are good, such as @http.response.status_code:<500.",
  ),
  noGoodAtOrUnder: translationKey(
    "Enter the value a good observation stays at or under: a number greater than 0, in the metric's own unit, such as 0.3.",
  ),
  filterTooLong: translationKey(
    "A metric search can be at most {{max}} characters long.",
  ),
  filterTooManyTerms: translationKey(
    "A metric search can have at most {{max}} terms.",
  ),
  freeText: translationKey(
    'A metric search takes the metric\'s attributes, such as @http.route:/checkout* or @http.response.status_code:<500. "{{text}}" is not one.',
  ),
};

// What the API answers for a value that is not a configuration at all, in English.
export const SLO_METRIC_QUERY_NOT_AN_OBJECT_ERROR: string =
  'The metric query must be an object such as {"metricName": "http.server.request.duration", "kind": "Histogram", "goodAtOrUnder": 0.3}.';

export interface SloMetricQueryProblem {
  part: SloMetricQueryPart;
  template: string;
  values: Record<string, string | number>;
}

// One term of a metric search: an attribute and what it must match.
export interface SloMetricAttributeTerm {
  key: string;
  // Already negated for a leading "-": `-@k:v` is NotEquals v.
  predicate: SearchValuePredicate;
}

export interface ParsedSloMetricSearch {
  terms: Array<SloMetricAttributeTerm>;
  problem: Omit<SloMetricQueryProblem, "part"> | null;
}

const trimmedOrUndefined: (value: unknown) => string | undefined = (
  value: unknown,
): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed: string = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
};

const positiveNumberOrUndefined: (value: unknown) => number | undefined = (
  value: unknown,
): number | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const number: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(number) ? number : undefined;
};

const isKind: (value: unknown) => value is SloMetricKind = (
  value: unknown,
): value is SloMetricKind => {
  return value === SloMetricKind.Counter || value === SloMetricKind.Histogram;
};

/*
 * The configuration as stored: its strings trimmed, its number a number,
 * and only the parts its kind reads (a histogram keeps no good condition).
 * Null for anything that is not an object. A part it cannot read is kept
 * as undefined, for getSloMetricQueryProblem to say what is missing.
 */
export const normalizeSloMetricQueryConfig: (
  raw: unknown,
) => SloMetricQueryConfig | null = (
  raw: unknown,
): SloMetricQueryConfig | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const source: JSONObject = raw as JSONObject;
  const kind: SloMetricKind | undefined = isKind(source["kind"])
    ? source["kind"]
    : undefined;
  const config: SloMetricQueryConfig = {
    metricName: trimmedOrUndefined(source["metricName"]) || "",
    kind: kind as SloMetricKind,
  };

  const filter: string | undefined = trimmedOrUndefined(source["filter"]);

  if (filter) {
    config.filter = filter;
  }

  if (kind === SloMetricKind.Counter) {
    const goodFilter: string | undefined = trimmedOrUndefined(
      source["goodFilter"],
    );

    if (goodFilter) {
      config.goodFilter = goodFilter;
    }
  }

  if (kind === SloMetricKind.Histogram) {
    const goodAtOrUnder: number | undefined = positiveNumberOrUndefined(
      source["goodAtOrUnder"],
    );

    if (goodAtOrUnder !== undefined) {
      config.goodAtOrUnder = goodAtOrUnder;
    }
  }

  return config;
};

/*
 * A metric search - the good condition or the filter - read into its terms.
 * Every term is an attribute: `@k:v`, or `k:v`, which the grammar reads as
 * an attribute here since the search knows no fields. Free text has
 * nothing to match on a metric, so it is refused with what to write.
 */
export const parseSloMetricSearch: (
  raw: string | undefined | null,
) => ParsedSloMetricSearch = (
  raw: string | undefined | null,
): ParsedSloMetricSearch => {
  const search: string | undefined = trimmedOrUndefined(raw);

  if (!search) {
    return { terms: [], problem: null };
  }

  if (search.length > SLO_METRIC_FILTER_MAX_LENGTH) {
    return {
      terms: [],
      problem: {
        template: SLO_METRIC_QUERY_ERRORS.filterTooLong,
        values: { max: SLO_METRIC_FILTER_MAX_LENGTH },
      },
    };
  }

  const tokens: Array<SearchToken> = parseSearchQuery(search, {
    knownFieldKeys: new Set<string>(),
  });

  if (tokens.length > SLO_METRIC_FILTER_MAX_TERMS) {
    return {
      terms: [],
      problem: {
        template: SLO_METRIC_QUERY_ERRORS.filterTooManyTerms,
        values: { max: SLO_METRIC_FILTER_MAX_TERMS },
      },
    };
  }

  const terms: Array<SloMetricAttributeTerm> = [];

  for (const token of tokens) {
    if (token.type === SearchTokenType.FreeText) {
      return {
        terms: [],
        problem: {
          template: SLO_METRIC_QUERY_ERRORS.freeText,
          values: { text: token.raw },
        },
      };
    }

    terms.push({ key: token.key, predicate: token.predicate });
  }

  return { terms: terms, problem: null };
};

/*
 * What is wrong with a configuration, and with which part - the first
 * problem in the order the form asks for them - or null when it is one
 * OneUptime can count with.
 */
export const getSloMetricQueryProblem: (
  config: SloMetricQueryConfig | null,
) => SloMetricQueryProblem | null = (
  config: SloMetricQueryConfig | null,
): SloMetricQueryProblem | null => {
  if (!config || !config.metricName) {
    return {
      part: SloMetricQueryPart.MetricName,
      template: SLO_METRIC_QUERY_ERRORS.noMetricName,
      values: {},
    };
  }

  if (config.metricName.length > SLO_METRIC_NAME_MAX_LENGTH) {
    return {
      part: SloMetricQueryPart.MetricName,
      template: SLO_METRIC_QUERY_ERRORS.metricNameTooLong,
      values: { max: SLO_METRIC_NAME_MAX_LENGTH },
    };
  }

  if (config.metricName.toLowerCase().startsWith(SLO_METRIC_RESERVED_PREFIX)) {
    return {
      part: SloMetricQueryPart.MetricName,
      template: SLO_METRIC_QUERY_ERRORS.reservedMetricName,
      values: {},
    };
  }

  if (!isKind(config.kind)) {
    return {
      part: SloMetricQueryPart.Kind,
      template: SLO_METRIC_QUERY_ERRORS.noKind,
      values: {},
    };
  }

  if (config.kind === SloMetricKind.Counter) {
    if (!config.goodFilter) {
      return {
        part: SloMetricQueryPart.GoodFilter,
        template: SLO_METRIC_QUERY_ERRORS.noGoodFilter,
        values: {},
      };
    }

    const good: ParsedSloMetricSearch = parseSloMetricSearch(config.goodFilter);

    if (good.problem) {
      return { part: SloMetricQueryPart.GoodFilter, ...good.problem };
    }
  }

  if (
    config.kind === SloMetricKind.Histogram &&
    !(
      typeof config.goodAtOrUnder === "number" &&
      Number.isFinite(config.goodAtOrUnder) &&
      config.goodAtOrUnder > 0
    )
  ) {
    return {
      part: SloMetricQueryPart.GoodAtOrUnder,
      template: SLO_METRIC_QUERY_ERRORS.noGoodAtOrUnder,
      values: {},
    };
  }

  const filter: ParsedSloMetricSearch = parseSloMetricSearch(config.filter);

  if (filter.problem) {
    return { part: SloMetricQueryPart.Filter, ...filter.problem };
  }

  return null;
};

// A problem's sentence in English, its figures as written: what the API and the worker say.
export const formatSloMetricQueryProblem: (
  problem: Pick<SloMetricQueryProblem, "template" | "values">,
) => string = (
  problem: Pick<SloMetricQueryProblem, "template" | "values">,
): string => {
  return fillTemplate(
    problem.template,
    Object.fromEntries(
      Object.entries(problem.values).map(
        ([key, value]: [string, string | number]): [string, string] => {
          return [key, String(value)];
        },
      ),
    ),
  );
};

/*
 * What is wrong with a stored or submitted configuration, in English, or
 * null when OneUptime can count with it.
 */
export const getSloMetricQueryError: (raw: unknown) => string | null = (
  raw: unknown,
): string | null => {
  if (raw !== undefined && raw !== null && typeof raw !== "object") {
    return SLO_METRIC_QUERY_NOT_AN_OBJECT_ERROR;
  }

  if (Array.isArray(raw)) {
    return SLO_METRIC_QUERY_NOT_AN_OBJECT_ERROR;
  }

  const problem: SloMetricQueryProblem | null = getSloMetricQueryProblem(
    normalizeSloMetricQueryConfig(raw),
  );

  return problem ? formatSloMetricQueryProblem(problem) : null;
};

/*
 * The configuration as the counting reads it - its parts in a fixed order -
 * so the counting's fingerprint changes when, and only when, what it counts
 * does.
 */
export const getSloMetricQueryFingerprintParts: (
  config: SloMetricQueryConfig,
) => JSONObject = (config: SloMetricQueryConfig): JSONObject => {
  return {
    metricName: config.metricName,
    kind: config.kind,
    goodFilter:
      config.kind === SloMetricKind.Counter ? config.goodFilter || null : null,
    goodAtOrUnder:
      config.kind === SloMetricKind.Histogram
        ? config.goodAtOrUnder ?? null
        : null,
    filter: config.filter || null,
  };
};

/*
 * WHY A METRIC SLO COUNTED NOTHING, WHEN ITS METRIC'S POINTS SAY (#10027).
 *
 * A Metric SLO counts a counter's Sum points or a histogram's Histogram
 * points (SloMetricCounting), so a metric of any other kind - a gauge, as
 * every cloud metric OneUptime reads is - counts nothing, and so does a
 * counter counted as a histogram or a histogram counted as a counter. The
 * evaluation says which in the SLO's feed, from the kind of the metric's
 * newest point; null when that kind is the one it counts, or not known.
 */
export const SLO_METRIC_GAUGE_REASON: string =
  "This SLO's metric is a gauge, which has no events to count: a Metric SLO counts a counter's or a histogram's events, and every cloud metric OneUptime reads is a gauge. Measure it by a metric monitor's uptime instead, or choose a counter or a histogram its services send.";

export const SLO_METRIC_UNCOUNTABLE_REASON: string =
  "This SLO's metric is neither a counter nor an explicit-bucket histogram, so it has no events to count. Choose a counter or a histogram its services send.";

export const SLO_METRIC_HISTOGRAM_AS_COUNTER_REASON: string =
  'This SLO counts its metric as a counter, and its metric is a histogram. Choose "A histogram, by a value" under Good Events in its Settings.';

export const SLO_METRIC_COUNTER_AS_HISTOGRAM_REASON: string =
  'This SLO counts its metric as a histogram, and its metric is a counter. Choose "A counter, by a condition" under Good Events in its Settings.';

export const getSloMetricUncountedReason: (data: {
  metricPointType: string | null | undefined;
  kind: SloMetricKind | null | undefined;
}) => string | null = (data: {
  metricPointType: string | null | undefined;
  kind: SloMetricKind | null | undefined;
}): string | null => {
  switch (data.metricPointType) {
    case undefined:
    case null:
    case "":
      return null;
    case "Sum":
      return data.kind === SloMetricKind.Histogram
        ? SLO_METRIC_COUNTER_AS_HISTOGRAM_REASON
        : null;
    case "Histogram":
      return data.kind === SloMetricKind.Counter
        ? SLO_METRIC_HISTOGRAM_AS_COUNTER_REASON
        : null;
    case "Gauge":
      return SLO_METRIC_GAUGE_REASON;
    default:
      return SLO_METRIC_UNCOUNTABLE_REASON;
  }
};
