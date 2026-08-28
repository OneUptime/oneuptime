import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  RESOURCE_ENTITY_FACET_KEYS,
  ResourceEntityFacetSelections,
  isResourceEntityFacetKey,
  isServiceFacetKey,
} from "Common/Types/Telemetry/ResourceEntityFacet";
import {
  CrossSignalQueryParams,
  TelemetryCrossSignalScope,
  toLogsExplorerQueryParams,
} from "Common/Utils/Telemetry/CrossSignalScope";
import { getErrorPatternSearchText } from "Common/Utils/Telemetry/LogErrorPattern";
import RouteMap, { RouteUtil } from "./RouteMap";
import PageMap from "./PageMap";
import {
  TelemetryFilterTuple,
  buildTelemetryScopeFilterTuples,
  buildTelemetryTimeRangeParams,
  parseTelemetryFilterTuples,
  readTelemetryTabScopeParams,
  readTelemetryTimeRangeParams,
  serializeTelemetryFilterTuplesAsLists,
  splitTelemetryScopeFilters,
  withRouteQueryParams,
} from "./TelemetryTabScope";

/*
 * The logic behind the Logs Insights page, kept free of React and of the
 * network so App/Tests/Dashboard can exercise every branch in plain Node.
 *
 * The page asks the server three questions — how much is being logged and
 * at what severity, which distinct errors are happening, and what surrounds
 * one of those errors — and this module owns the request bodies for those
 * questions, the parsing of their answers (every field of which arrives as
 * untyped JSON), the derived numbers the UI renders, and the deep links out
 * to the Logs viewer and the trace detail page.
 */

// --- Request building ---

/**
 * The one scope the whole page shares. Every panel is built from this, so a
 * correlation the page draws is always a correlation within the slice the
 * user is looking at.
 */
export interface LogsInsightsScope {
  timeRange: RangeStartAndEndDateTime;
  /** Service ObjectID strings. Empty/absent means "the whole project". */
  serviceIds?: Array<string> | undefined;
  /** Host / docker host / podman host / Kubernetes cluster selections. */
  resourceFilters?: ResourceEntityFacetSelections | undefined;
  /** Absent means the server's default of Error + Fatal. */
  severityTexts?: Array<string> | undefined;
}

/*
 * Preset ranges resolve against "now" on every call rather than being
 * captured once, so a refresh on "past 24 hours" genuinely re-asks for the
 * last 24 hours instead of replaying the window the page loaded with.
 */
function resolveWindow(timeRange: RangeStartAndEndDateTime): InBetween<Date> {
  return RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
}

function appendScope(requestData: JSONObject, scope: LogsInsightsScope): void {
  const window: InBetween<Date> = resolveWindow(scope.timeRange);

  requestData["startTime"] = window.startValue.toISOString();
  requestData["endTime"] = window.endValue.toISOString();

  if (scope.serviceIds && scope.serviceIds.length > 0) {
    requestData["serviceIds"] = scope.serviceIds;
  }

  if (scope.resourceFilters && Object.keys(scope.resourceFilters).length > 0) {
    requestData["resourceFilters"] = scope.resourceFilters;
  }

  if (scope.severityTexts && scope.severityTexts.length > 0) {
    requestData["severityTexts"] = scope.severityTexts;
  }
}

/** POST body for `/telemetry/logs/error-patterns`. */
export function buildTopErrorPatternsRequest(
  scope: LogsInsightsScope,
  limit?: number | undefined,
): JSONObject {
  const requestData: JSONObject = {};

  appendScope(requestData, scope);

  if (typeof limit === "number" && Number.isFinite(limit)) {
    requestData["limit"] = limit;
  }

  return requestData;
}

/** POST body for `/telemetry/logs/histogram`, scoped like the rest of the page. */
export function buildInsightsHistogramRequest(
  scope: LogsInsightsScope,
): JSONObject {
  const requestData: JSONObject = {};

  /*
   * Severity is deliberately NOT forwarded: the histogram is what draws the
   * severity breakdown, so filtering it to the error severities would leave
   * the page unable to say what share of the volume the errors are.
   */
  appendScope(requestData, { ...scope, severityTexts: undefined });

  return requestData;
}

/**
 * POST body for `/telemetry/logs/analytics` asking for per-resource,
 * per-severity counts.
 *
 * The page used to derive its per-service numbers by counting a capped page
 * of raw log rows in the browser, which made every figure a property of the
 * fetch size rather than of the project. This asks the database the actual
 * question instead.
 */
export function buildServiceBreakdownRequest(
  scope: LogsInsightsScope,
  /*
   * One row per (resource, severity) pair, so the cap is roughly
   * resources x severities. 500 covers ~70 reporting resources at every
   * severity; past that the smallest pairs are cut, which can only ever
   * understate a badge, never invent one.
   */
  limit: number = 500,
): JSONObject {
  const requestData: JSONObject = {
    chartType: "table",
    aggregation: "count",
    groupBy: ["primaryEntityId", "severityText"],
    limit,
  };

  // Severity is what the breakdown splits by, so it must not also filter it.
  appendScope(requestData, { ...scope, severityTexts: undefined });

  return requestData;
}

/** POST body for `/telemetry/logs/error-pattern-correlation`. */
export function buildErrorPatternCorrelationRequest(
  scope: LogsInsightsScope,
  pattern: string,
  limit?: number | undefined,
): JSONObject {
  const requestData: JSONObject = { pattern };

  appendScope(requestData, scope);

  if (typeof limit === "number" && Number.isFinite(limit)) {
    requestData["limit"] = limit;
  }

  return requestData;
}

// --- Scope picker ---

/**
 * The facets the scope picker offers, in the order their groups render.
 *
 * Services first because most projects think in services, then the
 * resources that log under their own id (agent-ingested host / container /
 * cluster telemetry). The issue this page answers asks for "top errors per
 * host/service", so both kinds have to be selectable — not just the one the
 * page happened to start with.
 */
export const INSIGHTS_SCOPE_FACET_KEYS: Array<string> = [
  "primaryEntityId",
  ...RESOURCE_ENTITY_FACET_KEYS,
];

/** Human-readable group label per facet key. */
export const INSIGHTS_SCOPE_FACET_LABELS: Dictionary<string> = {
  primaryEntityId: "Services",
  hostId: "Hosts",
  dockerHostId: "Docker hosts",
  podmanHostId: "Podman hosts",
  kubernetesClusterId: "Kubernetes clusters",
};

export interface ScopeFacetValue {
  facetKey: string;
  value: string;
  displayName: string;
  count: number;
}

/**
 * POST body for `/telemetry/logs/facets`, asking only for the resource
 * facets the picker offers.
 *
 * Unlike every other request here this one is NOT scoped by the current
 * selection: the picker has to keep offering the options the user has not
 * chosen yet, and narrowing it by its own output would let a selection
 * erase the way back out of itself.
 */
export function buildScopeFacetsRequest(
  timeRange: RangeStartAndEndDateTime,
  limit: number = 200,
): JSONObject {
  const window: InBetween<Date> = resolveWindow(timeRange);

  return {
    startTime: window.startValue.toISOString(),
    endTime: window.endValue.toISOString(),
    facetKeys: INSIGHTS_SCOPE_FACET_KEYS,
    limit,
  };
}

/**
 * Parse the `facets` map of a `/telemetry/logs/facets` response into one
 * flat list per facet key, dropping values with no id.
 *
 * The server resolves resource facets against Postgres, so a row usually
 * carries a `displayName`; the raw id is the fallback, because an
 * unnameable resource still has telemetry worth scoping to.
 */
export function parseScopeFacets(
  response: JSONObject | undefined,
): Dictionary<Array<ScopeFacetValue>> {
  const facets: JSONObject =
    (response?.["facets"] as JSONObject | undefined) || {};

  const parsed: Dictionary<Array<ScopeFacetValue>> = {};

  for (const facetKey of INSIGHTS_SCOPE_FACET_KEYS) {
    parsed[facetKey] = asArray(facets[facetKey])
      .map((row: JSONObject): ScopeFacetValue => {
        const value: string = asString(row["value"]);

        return {
          facetKey,
          value,
          displayName: asString(row["displayName"]) || value,
          count: asCount(row["count"]),
        };
      })
      .filter((row: ScopeFacetValue): boolean => {
        return row.value.length > 0;
      });
  }

  return parsed;
}

/*
 * The picker is one flat multi-select over several facets, so each option
 * value has to say which facet it came from. A colon is safe as the
 * separator: facet keys are fixed identifiers and the values are Postgres
 * ids, neither of which contains one — and the parser splits on the FIRST
 * colon regardless, so an id that somehow did would still round-trip.
 */
export function encodeScopeSelection(facetKey: string, value: string): string {
  return `${facetKey}:${value}`;
}

export interface ParsedScopeSelections {
  serviceIds?: Array<string> | undefined;
  resourceFilters?: ResourceEntityFacetSelections | undefined;
}

/**
 * Turn the picker's selected option values back into the two scope fields
 * the API takes.
 *
 * Services and non-Service resources cannot share a field: a Service id
 * belongs in `primaryEntityId`, while a host or cluster id has to be
 * resolved to that resource's entity key server-side, because OTLP
 * telemetry carrying a `service.name` is primary-keyed on the Service and
 * only records the host it ran on in `entityKeys`.
 */
export function parseScopeSelections(
  values: Array<string>,
): ParsedScopeSelections {
  const serviceIds: Array<string> = [];
  const resourceFilters: ResourceEntityFacetSelections = {};

  for (const encoded of values) {
    if (typeof encoded !== "string") {
      continue;
    }

    const separatorIndex: number = encoded.indexOf(":");

    if (separatorIndex <= 0) {
      continue;
    }

    const facetKey: string = encoded.substring(0, separatorIndex);
    const value: string = encoded.substring(separatorIndex + 1);

    if (value.length === 0) {
      continue;
    }

    if (isServiceFacetKey(facetKey)) {
      if (!serviceIds.includes(value)) {
        serviceIds.push(value);
      }
      continue;
    }

    if (!isResourceEntityFacetKey(facetKey)) {
      // An unknown facet would compile to a predicate no explorer can read.
      continue;
    }

    const existing: Array<string> =
      (resourceFilters as Dictionary<Array<string>>)[facetKey] || [];

    if (!existing.includes(value)) {
      existing.push(value);
    }

    (resourceFilters as Dictionary<Array<string>>)[facetKey] = existing;
  }

  return {
    serviceIds: serviceIds.length > 0 ? serviceIds : undefined,
    resourceFilters:
      Object.keys(resourceFilters).length > 0 ? resourceFilters : undefined,
  };
}

// --- Response parsing ---

export interface TopErrorPatternRow {
  pattern: string;
  sampleBody: string;
  count: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  resourceCount: number;
  resourceIds: Array<string>;
  severities: Array<string>;
  traceCount: number;
  sampleTraceIds: Array<string>;
}

export interface ErrorPatternTimelinePoint {
  time: Date | null;
  count: number;
}

export interface ErrorPatternCoOccurrenceRow {
  pattern: string;
  sampleBody: string;
  count: number;
}

export interface ErrorPatternAttributeRow {
  key: string;
  value: string;
  count: number;
}

export interface ErrorPatternResourceRow {
  resourceId: string;
  resourceType: string;
  count: number;
  lastSeenAt: Date | null;
}

export interface ErrorPatternTraceRow {
  traceId: string;
  count: number;
  lastSeenAt: Date | null;
  resourceId: string;
}

export interface ErrorPatternSampleRow {
  logId: string;
  time: Date | null;
  body: string;
  severityText: string;
  resourceId: string;
  traceId: string;
  spanId: string;
}

export interface ErrorPatternCorrelation {
  pattern: string;
  bucketSizeInMinutes: number;
  timeline: Array<ErrorPatternTimelinePoint>;
  coOccurringPatterns: Array<ErrorPatternCoOccurrenceRow>;
  attributes: Array<ErrorPatternAttributeRow>;
  resources: Array<ErrorPatternResourceRow>;
  traces: Array<ErrorPatternTraceRow>;
  samples: Array<ErrorPatternSampleRow>;
}

function asArray(value: unknown): Array<JSONObject> {
  if (!Array.isArray(value)) {
    return [];
  }

  return (value as JSONArray).filter((item: unknown): item is JSONObject => {
    return Boolean(item) && typeof item === "object" && !Array.isArray(item);
  });
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asCount(value: unknown): number {
  const parsed: number = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function asStringArray(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return (value as Array<unknown>)
    .filter((item: unknown): item is string => {
      return typeof item === "string";
    })
    .filter((item: string): boolean => {
      return item.length > 0;
    });
}

/*
 * ClickHouse hands datetimes back as "YYYY-MM-DD HH:mm:ss.fffffffff", which
 * OneUptimeDate reads as UTC. A row that reached us any other way (or an
 * empty aggregate over no rows) yields null rather than an Invalid Date the
 * renderer would print as "Invalid Date".
 */
function asDate(value: unknown): Date | null {
  const raw: string = asString(value);

  if (raw.length === 0) {
    return null;
  }

  const parsed: Date = OneUptimeDate.fromString(raw);

  return isNaN(parsed.getTime()) ? null : parsed;
}

/** Parse the `patterns` array of an `/error-patterns` response. */
export function parseTopErrorPatterns(
  response: JSONObject | undefined,
): Array<TopErrorPatternRow> {
  return asArray(response?.["patterns"])
    .map((row: JSONObject): TopErrorPatternRow => {
      return {
        pattern: asString(row["pattern"]),
        sampleBody: asString(row["sampleBody"]),
        count: asCount(row["count"]),
        firstSeenAt: asDate(row["firstSeenAt"]),
        lastSeenAt: asDate(row["lastSeenAt"]),
        resourceCount: asCount(row["resourceCount"]),
        resourceIds: asStringArray(row["resourceIds"]),
        severities: asStringArray(row["severities"]),
        traceCount: asCount(row["traceCount"]),
        sampleTraceIds: asStringArray(row["sampleTraceIds"]),
      };
    })
    .filter((row: TopErrorPatternRow): boolean => {
      return row.pattern.length > 0;
    });
}

/** Parse an `/error-pattern-correlation` response. */
export function parseErrorPatternCorrelation(
  response: JSONObject | undefined,
): ErrorPatternCorrelation {
  return {
    pattern: asString(response?.["pattern"]),
    bucketSizeInMinutes: asCount(response?.["bucketSizeInMinutes"]),
    timeline: asArray(response?.["timeline"]).map(
      (row: JSONObject): ErrorPatternTimelinePoint => {
        return { time: asDate(row["time"]), count: asCount(row["count"]) };
      },
    ),
    coOccurringPatterns: asArray(response?.["coOccurringPatterns"])
      .map((row: JSONObject): ErrorPatternCoOccurrenceRow => {
        return {
          pattern: asString(row["pattern"]),
          sampleBody: asString(row["sampleBody"]),
          count: asCount(row["count"]),
        };
      })
      .filter((row: ErrorPatternCoOccurrenceRow): boolean => {
        return row.pattern.length > 0;
      }),
    attributes: asArray(response?.["attributes"])
      .map((row: JSONObject): ErrorPatternAttributeRow => {
        return {
          key: asString(row["key"]),
          value: asString(row["value"]),
          count: asCount(row["count"]),
        };
      })
      .filter((row: ErrorPatternAttributeRow): boolean => {
        return row.key.length > 0;
      }),
    resources: asArray(response?.["resources"])
      .map((row: JSONObject): ErrorPatternResourceRow => {
        return {
          resourceId: asString(row["resourceId"]),
          resourceType: asString(row["resourceType"]),
          count: asCount(row["count"]),
          lastSeenAt: asDate(row["lastSeenAt"]),
        };
      })
      .filter((row: ErrorPatternResourceRow): boolean => {
        return row.resourceId.length > 0;
      }),
    traces: asArray(response?.["traces"])
      .map((row: JSONObject): ErrorPatternTraceRow => {
        return {
          traceId: asString(row["traceId"]),
          count: asCount(row["count"]),
          lastSeenAt: asDate(row["lastSeenAt"]),
          resourceId: asString(row["resourceId"]),
        };
      })
      .filter((row: ErrorPatternTraceRow): boolean => {
        return row.traceId.length > 0;
      }),
    samples: asArray(response?.["samples"]).map(
      (row: JSONObject): ErrorPatternSampleRow => {
        return {
          logId: asString(row["logId"]),
          time: asDate(row["time"]),
          body: asString(row["body"]),
          severityText: asString(row["severityText"]),
          resourceId: asString(row["resourceId"]),
          traceId: asString(row["traceId"]),
          spanId: asString(row["spanId"]),
        };
      },
    ),
  };
}

/*
 * The severities that count as "an error" everywhere on this page, matching
 * LogAggregationService.DEFAULT_ERROR_LOG_SEVERITIES on the server. If the
 * two ever disagree, the headline error count and the Top Errors list stop
 * describing the same set of logs.
 */
const ERROR_SEVERITIES: Array<string> = [LogSeverity.Error, LogSeverity.Fatal];

export interface ResourceLogBreakdown {
  resourceId: string;
  total: number;
  errorCount: number;
  warnCount: number;
}

/**
 * Fold `/telemetry/logs/analytics` table rows — one per
 * (resource, severity) pair — into one row per resource.
 *
 * Sorted by volume, because "which of my services is loudest" is the
 * question the panel is answering; ties break on id so the order is stable
 * across refreshes rather than following the database's row order.
 */
export function summarizeResourceBreakdown(
  response: JSONObject | undefined,
): Array<ResourceLogBreakdown> {
  const byResource: Map<string, ResourceLogBreakdown> = new Map();

  for (const row of asArray(response?.["data"])) {
    const groupValues: JSONObject =
      (row["groupValues"] as JSONObject | undefined) || {};

    const resourceId: string = asString(groupValues["primaryEntityId"]);

    if (resourceId.length === 0) {
      continue;
    }

    const severity: string = asString(groupValues["severityText"]);
    const count: number = asCount(row["count"]);

    const existing: ResourceLogBreakdown = byResource.get(resourceId) || {
      resourceId,
      total: 0,
      errorCount: 0,
      warnCount: 0,
    };

    existing.total += count;

    if (ERROR_SEVERITIES.includes(severity)) {
      existing.errorCount += count;
    }

    if (severity === LogSeverity.Warning) {
      existing.warnCount += count;
    }

    byResource.set(resourceId, existing);
  }

  return Array.from(byResource.values()).sort(
    (a: ResourceLogBreakdown, b: ResourceLogBreakdown): number => {
      if (b.total !== a.total) {
        return b.total - a.total;
      }

      return a.resourceId.localeCompare(b.resourceId);
    },
  );
}

// --- Derived numbers ---

export interface SeverityShare {
  severity: string;
  count: number;
  percent: number;
}

export interface LogVolumeSummary {
  total: number;
  errorCount: number;
  warnCount: number;
  errorRatePercent: number;
  severities: Array<SeverityShare>;
  /** Total volume per bucket, ascending by time — the page's volume chart. */
  series: Array<{ time: string; count: number }>;
}

/*
 * Display order for the severity breakdown. Anything the database returns
 * that is not on this list (a custom severity from a pipeline rule) sorts
 * after the known ones rather than being dropped.
 */
const SEVERITY_ORDER: Array<string> = [
  LogSeverity.Fatal,
  LogSeverity.Error,
  LogSeverity.Warning,
  LogSeverity.Information,
  LogSeverity.Debug,
  LogSeverity.Trace,
];

/**
 * Fold `/telemetry/logs/histogram` buckets into the page's headline numbers.
 *
 * The histogram is aggregated server-side over the whole window, which is
 * the point: the previous Insights page counted a capped page of raw rows,
 * so on any busy project its "total logs" was really "the 5000 rows we
 * fetched" and its error rate was the error rate of that sample.
 */
export function summarizeSeverityBuckets(
  buckets: Array<JSONObject> | undefined,
): LogVolumeSummary {
  const bySeverity: Map<string, number> = new Map();
  const byBucket: Map<string, number> = new Map();
  let total: number = 0;

  for (const bucket of asArray(buckets)) {
    const count: number = asCount(bucket["count"]);

    if (count === 0) {
      /*
       * Still record the bucket so the chart keeps its empty slots — a gap
       * in a volume chart is information ("nothing was logged"), and
       * dropping it would silently compress the time axis.
       */
      const time: string = asString(bucket["time"]);

      if (time.length > 0 && !byBucket.has(time)) {
        byBucket.set(time, 0);
      }
      continue;
    }

    const severity: string = asString(bucket["severity"]) || "Unspecified";

    bySeverity.set(severity, (bySeverity.get(severity) || 0) + count);
    total += count;

    const time: string = asString(bucket["time"]);

    if (time.length > 0) {
      byBucket.set(time, (byBucket.get(time) || 0) + count);
    }
  }

  const severities: Array<SeverityShare> = Array.from(bySeverity.entries())
    .map(([severity, count]: [string, number]): SeverityShare => {
      return {
        severity,
        count,
        percent: total > 0 ? Math.round((count / total) * 100) : 0,
      };
    })
    .sort((a: SeverityShare, b: SeverityShare): number => {
      const orderA: number = SEVERITY_ORDER.indexOf(a.severity);
      const orderB: number = SEVERITY_ORDER.indexOf(b.severity);

      return (
        (orderA === -1 ? SEVERITY_ORDER.length : orderA) -
        (orderB === -1 ? SEVERITY_ORDER.length : orderB)
      );
    });

  let errorCount: number = 0;
  let warnCount: number = 0;

  for (const [severity, count] of bySeverity.entries()) {
    if (ERROR_SEVERITIES.includes(severity)) {
      errorCount += count;
    }

    if (severity === LogSeverity.Warning) {
      warnCount += count;
    }
  }

  const series: Array<{ time: string; count: number }> = Array.from(
    byBucket.entries(),
  )
    .map(([time, count]: [string, number]): { time: string; count: number } => {
      return { time, count };
    })
    .sort(
      (
        a: { time: string; count: number },
        b: { time: string; count: number },
      ): number => {
        return a.time.localeCompare(b.time);
      },
    );

  return {
    total,
    errorCount,
    warnCount,
    errorRatePercent: total > 0 ? Math.round((errorCount / total) * 100) : 0,
    severities,
    series,
  };
}

export type ErrorPatternTrendDirection =
  | "rising"
  | "falling"
  | "steady"
  | "unknown";

export interface ErrorPatternTrend {
  direction: ErrorPatternTrendDirection;
  /** Signed percentage change from the older half to the newer half. */
  changePercent: number;
  recentCount: number;
  previousCount: number;
}

/*
 * A change smaller than this is noise, not a trend. Ten percent is small
 * enough to catch a real drift and large enough that a single extra
 * occurrence in a low-volume pattern does not read as an escalation.
 */
const TREND_THRESHOLD_PERCENT: number = 10;

/**
 * Is this error getting worse? Compares the newer half of the pattern's
 * timeline against the older half.
 *
 * Deliberately halves the window rather than comparing against a fixed
 * lookback: the timeline is whatever window the user picked, so the honest
 * comparison is "the second half of what you are looking at against the
 * first half of it".
 */
export function computeErrorPatternTrend(
  timeline: Array<ErrorPatternTimelinePoint>,
  windowStart?: Date | undefined,
  windowEnd?: Date | undefined,
): ErrorPatternTrend {
  if (!Array.isArray(timeline) || timeline.length < 2) {
    return {
      direction: "unknown",
      changePercent: 0,
      recentCount: 0,
      previousCount: 0,
    };
  }

  /*
   * Split by TIMESTAMP, not by array index.
   *
   * The timeline query is a plain `GROUP BY bucket` with no zero-fill, so
   * the array holds only the buckets that had occurrences. An index split
   * therefore measures where the occurrences sit within each OTHER, not
   * where they sit in time: an error that fired steadily for two hours and
   * then stopped for twenty-two returns ~half its buckets on each side and
   * reads "Steady, 0%" — the exact opposite of the truth.
   *
   * `windowStart`/`windowEnd` are the range the user actually picked, so a
   * pattern clustered entirely at the start of it is correctly measured
   * against the silence that followed. Without them the observed span is
   * the honest fallback; the index split is used only when the rows carry
   * no usable timestamps at all.
   */
  const times: Array<number> = timeline
    .map((point: ErrorPatternTimelinePoint): number => {
      return point.time instanceof Date ? point.time.getTime() : Number.NaN;
    })
    .filter((value: number): boolean => {
      return Number.isFinite(value);
    });

  const start: number =
    windowStart instanceof Date && !isNaN(windowStart.getTime())
      ? windowStart.getTime()
      : Math.min(...times);

  const end: number =
    windowEnd instanceof Date && !isNaN(windowEnd.getTime())
      ? windowEnd.getTime()
      : Math.max(...times);

  const canSplitByTime: boolean =
    times.length === timeline.length &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end > start;

  const midTime: number = start + (end - start) / 2;
  const midIndex: number = Math.floor(timeline.length / 2);

  let previousCount: number = 0;
  let recentCount: number = 0;

  timeline.forEach((point: ErrorPatternTimelinePoint, index: number): void => {
    const isOlderHalf: boolean = canSplitByTime
      ? (point.time as Date).getTime() < midTime
      : index < midIndex;

    if (isOlderHalf) {
      previousCount += point.count;
    } else {
      recentCount += point.count;
    }
  });

  if (previousCount === 0 && recentCount === 0) {
    return {
      direction: "unknown",
      changePercent: 0,
      recentCount,
      previousCount,
    };
  }

  if (previousCount === 0) {
    // Brand new: everything happened in the newer half.
    return {
      direction: "rising",
      changePercent: 100,
      recentCount,
      previousCount,
    };
  }

  const changePercent: number = Math.round(
    ((recentCount - previousCount) / previousCount) * 100,
  );

  let direction: ErrorPatternTrendDirection = "steady";

  if (changePercent >= TREND_THRESHOLD_PERCENT) {
    direction = "rising";
  } else if (changePercent <= -TREND_THRESHOLD_PERCENT) {
    direction = "falling";
  }

  return { direction, changePercent, recentCount, previousCount };
}

export interface SharedAttribute extends ErrorPatternAttributeRow {
  /** Share of the pattern's occurrences carrying this exact key=value. */
  coveragePercent: number;
  /** True when every occurrence carries it — the strongest kind of clue. */
  isUniversal: boolean;
}

/**
 * Rank the attributes of a pattern's occurrences by how much they explain.
 *
 * An attribute present on every occurrence ("host.name = web-3", 30 of 30)
 * localizes the error; one present on a third of them does not. Ranking by
 * coverage puts the localizing ones first, which is the whole reason the
 * panel exists.
 *
 * Keys whose value is different on nearly every occurrence (request ids,
 * timestamps) are dropped: they are what makes a pattern a pattern, and
 * listing them would bury the useful rows.
 */
/**
 * The occurrence count the correlation response itself accounts for.
 *
 * Used as the denominator for attribute coverage instead of the count the
 * Top Errors list reported: the list and the drill-down resolve a preset
 * range against `now` independently, so on a short preset the two can cover
 * measurably different windows. Mixing them lets an attribute present on a
 * minority of occurrences render at 100% with a "every occurrence" badge.
 *
 * Falls back to 0 for an empty timeline, which callers read as "use what
 * the row said" rather than as "nothing happened".
 */
export function getCorrelationOccurrenceTotal(
  timeline: Array<ErrorPatternTimelinePoint>,
): number {
  if (!Array.isArray(timeline)) {
    return 0;
  }

  return timeline.reduce(
    (total: number, point: ErrorPatternTimelinePoint): number => {
      return total + (Number.isFinite(point.count) ? point.count : 0);
    },
    0,
  );
}

export function summarizeSharedAttributes(
  attributes: Array<ErrorPatternAttributeRow>,
  totalOccurrences: number,
  limit: number = 8,
): Array<SharedAttribute> {
  if (!Array.isArray(attributes) || totalOccurrences <= 0) {
    return [];
  }

  return attributes
    .map((attribute: ErrorPatternAttributeRow): SharedAttribute => {
      const coveragePercent: number = Math.min(
        100,
        Math.round((attribute.count / totalOccurrences) * 100),
      );

      return {
        ...attribute,
        coveragePercent,
        isUniversal: attribute.count >= totalOccurrences,
      };
    })
    .filter((attribute: SharedAttribute): boolean => {
      /*
       * Below 5% an attribute value is per-occurrence noise. Kept as a
       * share rather than a count so it behaves the same on a pattern seen
       * 20 times and one seen 20,000 times.
       */
      return attribute.coveragePercent >= 5;
    })
    .sort((a: SharedAttribute, b: SharedAttribute): number => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }

      return a.key.localeCompare(b.key);
    })
    .slice(0, Math.max(0, limit));
}

// --- Human-readable summaries ---

/**
 * The window as a phrase that can follow "in" — "in the past 2 days".
 *
 * The TimeRange enum's values are already human-readable ("Past 2 Days"),
 * so lowercasing one is both the shortest correct rendering and one that
 * cannot fall out of date when a range is added. Custom windows have no
 * name worth printing, so they get a neutral phrase.
 */
export function describeTimeRange(timeRange: RangeStartAndEndDateTime): string {
  const range: TimeRange | undefined = timeRange?.range;

  if (!range || range === TimeRange.CUSTOM) {
    return "the selected time range";
  }

  return `the ${(range as string).toLowerCase()}`;
}

/**
 * "30 times in the last 2 days" — the sentence the issue asked for, built
 * from a count and the window it was counted over.
 */
export function describeOccurrenceCount(
  count: number,
  timeRange: RangeStartAndEndDateTime,
): string {
  const safeCount: number = Number.isFinite(count) ? Math.max(0, count) : 0;
  const noun: string = safeCount === 1 ? "time" : "times";

  return `${safeCount.toLocaleString()} ${noun} in ${describeTimeRange(timeRange)}`;
}

// --- Deep links ---

/**
 * A Logs viewer link showing the raw occurrences behind one error pattern.
 *
 * The body filter is the pattern's longest literal run, not the pattern
 * itself — the pattern contains placeholders (`<num>`, `<ip>`) that no real
 * log body contains, so filtering on it would land the user on an empty
 * list. That makes the link slightly wider than the pattern (other errors
 * sharing that phrase come along), which is the right way to be wrong here:
 * the user sees their error plus context rather than nothing.
 *
 * Returns null only when Route rejects a value.
 */
export function buildErrorPatternLogsRoute(
  pattern: string,
  scope: LogsInsightsScope,
  /*
   * A real body from the group, when the caller has one. It lets the needle
   * be VERIFIED against text that actually exists rather than assumed to
   * survive normalization — see getErrorPatternSearchText.
   */
  sampleBody?: string | undefined,
): Route | null {
  const window: InBetween<Date> = resolveWindow(scope.timeRange);

  const crossSignalScope: TelemetryCrossSignalScope = {
    serviceIds: scope.serviceIds,
    resourceFacetSelections: scope.resourceFilters,
    severityTexts:
      scope.severityTexts && scope.severityTexts.length > 0
        ? scope.severityTexts
        : ERROR_SEVERITIES,
    bodyContains: getErrorPatternSearchText(pattern, { sampleBody }),
    startTime: window.startValue,
    endTime: window.endValue,
  };

  const serialized: CrossSignalQueryParams =
    toLogsExplorerQueryParams(crossSignalScope);

  return withRouteQueryParams(
    RouteUtil.populateRouteParams(RouteMap[PageMap.LOGS] as Route),
    serialized.params,
  );
}

/** The trace detail route for one of a pattern's related traces. */
export function buildErrorPatternTraceRoute(traceId: string): Route | null {
  const trimmed: string = typeof traceId === "string" ? traceId.trim() : "";

  if (trimmed.length === 0) {
    return null;
  }

  try {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.TRACE_VIEW] as Route,
      {
        modelId: trimmed,
      },
    );
  } catch {
    return null;
  }
}

// --- Tab hand-off ---

/**
 * The window both Logs tabs start from when the URL says nothing.
 *
 * Shared deliberately. The Viewer and the Insights tab now pass their scope
 * to each other through the URL, and two different "no range means this"
 * defaults would silently move the window on every tab switch made at rest.
 */
export const LOGS_TAB_DEFAULT_TIME_RANGE: TimeRange = TimeRange.PAST_ONE_HOUR;

/**
 * The Logs Insights page's view, as carried in the URL.
 *
 * `timeRange` is null when the link named no window, so the page can tell
 * "the link asked for the past hour" apart from "the link asked for
 * nothing" and keep its own default in the second case.
 */
export interface LogsInsightsUrlScope {
  timeRange: RangeStartAndEndDateTime | null;
  /** Encoded "<facetKey>:<id>" values — what the scope picker holds. */
  scopeValues: Array<string>;
  /**
   * Chips the Viewer had applied that this page has no dimension for — a
   * body-contains search, a trace id, a severity selection.
   *
   * They are neither applied nor discarded. Discarding them would make the
   * round trip lossy (switch to Insights and back, and the search you typed
   * is gone); applying them is impossible. So they ride along, the page says
   * out loud that it is not applying them, and the link back to the Viewer
   * restores them intact.
   */
  unappliedFilters: Array<TelemetryFilterTuple>;
  /** The saved view the Viewer had selected, for naming and for the trip back. */
  savedViewId: string | null;
}

/** Read the Insights page's scope out of a query string. */
export function readLogsInsightsUrlScope(
  search: string | null | undefined,
): LogsInsightsUrlScope {
  const params: Dictionary<string> = readTelemetryTabScopeParams(search);

  const tuples: Array<TelemetryFilterTuple> = parseTelemetryFilterTuples(
    params["filters"],
  );

  /*
   * Logs support the resource-entity facets: LogService rewrites
   * `resourceFilters` into entity-key predicates, so a host or cluster
   * selection is a scope this page can genuinely apply.
   */
  const split: {
    serviceIds: Array<string>;
    resourceFilters: Dictionary<Array<string>>;
    unsupported: Array<TelemetryFilterTuple>;
  } = splitTelemetryScopeFilters(tuples, {
    supportsResourceEntityFacets: true,
  });

  const scopeValues: Array<string> = [];

  for (const serviceId of split.serviceIds) {
    scopeValues.push(encodeScopeSelection("primaryEntityId", serviceId));
  }

  for (const facetKey of Object.keys(split.resourceFilters)) {
    for (const value of split.resourceFilters[facetKey] || []) {
      scopeValues.push(encodeScopeSelection(facetKey, value));
    }
  }

  return {
    timeRange: readTelemetryTimeRangeParams(params),
    scopeValues,
    unappliedFilters: split.unsupported,
    savedViewId: params["savedView"] || null,
  };
}

export interface LogsInsightsUrlScopeInput {
  timeRange: RangeStartAndEndDateTime;
  scopeValues: Array<string>;
  unappliedFilters: Array<TelemetryFilterTuple>;
  savedViewId: string | null;
}

/**
 * Mirror the Insights page's scope into URL params, in the Logs explorer's
 * own grammar.
 *
 * Writing the Viewer's grammar rather than a private one is what makes the
 * hand-off symmetric: the Insights URL IS a Logs Viewer URL, so the tab link
 * back needs no translation and a pasted link works either way round.
 */
export function buildLogsInsightsUrlParams(
  input: LogsInsightsUrlScopeInput,
): Dictionary<string | null> {
  const selections: ParsedScopeSelections = parseScopeSelections(
    input.scopeValues,
  );

  const tuples: Array<TelemetryFilterTuple> = buildTelemetryScopeFilterTuples({
    serviceIds: selections.serviceIds || [],
    resourceFilters: selections.resourceFilters || {},
    unsupported: input.unappliedFilters,
  });

  const params: Dictionary<string | null> = {
    ...buildTelemetryTimeRangeParams(input.timeRange),
    filters: serializeTelemetryFilterTuplesAsLists(tuples),
    savedView: input.savedViewId || null,
  };

  return params;
}
