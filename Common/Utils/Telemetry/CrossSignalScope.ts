import Dictionary from "../../Types/Dictionary";
import {
  RESOURCE_ENTITY_FACET_KEYS,
  ResourceEntityFacetSelections,
  isResourceEntityFacetKey,
} from "../../Types/Telemetry/ResourceEntityFacet";
import OneUptimeDate from "../../Types/Date";
import TimeRange from "../../Types/Time/TimeRange";
import MetricExplorerUrl, {
  MetricExplorerUrlParam,
  SerializedMetricQuery,
} from "../Metrics/MetricExplorerUrl";

/*
 * Matches any whitespace, double-quote, or colon — the characters that break a
 * bare traces search token. Kept as named consts so the linter doesn't fight
 * over wrapping an inline regex literal used with .test() (wrap-regex vs
 * prettier).
 */
const TRACE_TOKEN_UNSAFE_CHARS: RegExp = /[\s":]/;
const WHITESPACE: RegExp = /\s/;

/*
 * Cross-signal scope translation: turn one description of "what slice of
 * telemetry am I looking at" into the query params each explorer parses,
 * so a breach (or any other cross-signal jump) can land the user on an
 * equivalently-scoped Logs / Traces / Metrics view.
 *
 * The target grammars this module encodes (do not change one without the
 * other):
 *
 *  - Logs explorer (App/FeatureSet/Dashboard/src/Components/Logs/
 *    LogsViewer.tsx, readInitialUrlState): `filters` is a JSON array of
 *    [facetKey, values[]] tuples. Supported facet keys are the top-level
 *    columns severityText / primaryEntityId / traceId / spanId / body plus
 *    `attributes.<key>` for telemetry attributes (dots in <key> are kept —
 *    only the first "attributes." prefix is stripped). A `body` chip is the
 *    one whose value compiles to a CONTAINS match rather than an equality
 *    (LogsCrossSignalPivot.applyLogsFacetFiltersToQuery). `range` is a
 *    TimeRange enum value; a Custom range additionally needs `start` and
 *    `end` (parsed with `new Date(...)`). There is no `search` param.
 *
 *  - Traces explorer (App/FeatureSet/Dashboard/src/Components/Traces/
 *    TracesViewer.tsx, readInitialUrlState + parseSearch): `search` is a
 *    Datadog-style DSL (`trace:<id>`, `span:<id>`, `@<attr>:<value>`, with
 *    double quotes around values containing spaces); `filters` is a JSON
 *    array of [facetKey, value] string pairs where facetKey may be
 *    `primaryEntityId` (service ObjectID) or `attributes.<key>`;
 *    `range`/`start`/`end` follow the same Custom convention as logs.
 *
 *  - Metric explorer (Common/Utils/Metrics/MetricExplorerUrl.ts): the
 *    JSON-encoded `metricQueries` param plus absolute `startTime`/`endTime`
 *    (a pinned Custom window is represented by the absolute params alone —
 *    no `range` token).
 */

/**
 * One cross-signal scope. Every field is optional; serializers emit params
 * only for the fields the target grammar can express and report the rest in
 * `dropped`.
 *
 * `serviceIds` carries service ObjectID strings — NOT service names. Both
 * the logs and the traces explorer filter services through the
 * `primaryEntityId` column, whose values are ObjectIDs (the UI maps them to
 * names for display via facet valueDisplayMap); a name would compile to a
 * `primaryEntityId = '<name>'` predicate and match nothing.
 */
export interface TelemetryCrossSignalScope {
  /** Service ObjectID strings (Log/Span `primaryEntityId` values). */
  serviceIds?: Array<string> | undefined;
  /**
   * Non-Service resource selections keyed by facet — e.g.
   * `{ kubernetesClusterId: ["<id>"] }`. Deliberately NOT merged into
   * `serviceIds`: a host or cluster id is not a `primaryEntityId` value for
   * telemetry that carries a `service.name`, so it has to reach the target
   * explorer as its own facet and be resolved to the resource's entity key
   * there. Both the logs and the traces `filters` grammar carry arbitrary
   * facet keys, so these survive the trip intact.
   */
  resourceFacetSelections?: ResourceEntityFacetSelections | undefined;
  /** Exact-match telemetry attribute filters. Keys may contain dots. */
  attributes?: Dictionary<string> | undefined;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  /**
   * Log severity values. Normalized to the database's title-case values
   * ("error" -> "Error") the same way the logs search DSL does
   * (Common/Types/Log/LogQueryToFilter.ts, SEVERITY_CANONICAL) — the URL
   * `filters` path applies no normalization of its own, so the params must
   * carry the exact stored casing.
   */
  severityTexts?: Array<string> | undefined;
  /**
   * Free-text the log body must CONTAIN. Only the logs explorer has a
   * body dimension, and only as a substring match — an exact-equality
   * filter on a body carrying a timestamp or a request id matches
   * nothing. Traces and metrics report it as dropped.
   */
  bodyContains?: string | undefined;
  startTime?: Date | undefined;
  endTime?: Date | undefined;
}

/**
 * Result of a scope translation: the query params to append to the target
 * explorer's URL, plus the names of the scope fields the target grammar
 * could not express (so callers can surface a "scope partially carried"
 * hint). A field appears in `dropped` only when it held at least one usable
 * value; empty/blank entries carry no scope and are ignored silently.
 */
export interface CrossSignalQueryParams {
  params: Dictionary<string>;
  dropped: Array<string>;
}

/*
 * Same canonicalization table as the logs search DSL
 * (Common/Types/Log/LogQueryToFilter.ts). Unknown values pass through
 * verbatim, matching that module's `|| value` fallback.
 */
const LOG_SEVERITY_CANONICAL: Dictionary<string> = {
  fatal: "Fatal",
  error: "Error",
  warning: "Warning",
  warn: "Warning",
  information: "Information",
  info: "Information",
  debug: "Debug",
  trace: "Trace",
  unspecified: "Unspecified",
};

function normalizeLogSeverity(value: string): string {
  return LOG_SEVERITY_CANONICAL[value.toLowerCase()] || value;
}

/*
 * Drop empty strings and duplicates while preserving order. Blank entries
 * would become empty filter chips ("" equality predicates) in the viewers,
 * which is never what a caller means by scope.
 */
function sanitizeValues(values: Array<string> | undefined): Array<string> {
  if (!values || values.length === 0) {
    return [];
  }

  const seen: Set<string> = new Set<string>();
  const sanitized: Array<string> = [];

  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) {
      continue;
    }

    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    sanitized.push(value);
  }

  return sanitized;
}

/*
 * Attribute entries with an empty key or an empty value carry no scope —
 * skip them rather than emitting a chip that filters on nothing.
 */
function sanitizeAttributeEntries(
  attributes: Dictionary<string> | undefined,
): Array<[string, string]> {
  if (!attributes) {
    return [];
  }

  const entries: Array<[string, string]> = [];

  for (const key of Object.keys(attributes)) {
    const value: string = attributes[key] as string;

    if (key.length === 0 || typeof value !== "string" || value.length === 0) {
      continue;
    }

    entries.push([key, value]);
  }

  return entries;
}

/*
 * Drop unknown facet keys and blank ids from a resource selection map. An
 * unknown key would become a filter chip the target explorer cannot compile
 * (it would land as an unknown column predicate), so it is reported as
 * dropped by the callers instead of being emitted.
 */
function sanitizeResourceFacetSelections(
  selections: ResourceEntityFacetSelections | undefined,
): Array<[string, Array<string>]> {
  if (!selections) {
    return [];
  }

  const entries: Array<[string, Array<string>]> = [];

  for (const facetKey of RESOURCE_ENTITY_FACET_KEYS) {
    if (!isResourceEntityFacetKey(facetKey)) {
      continue;
    }

    const values: Array<string> = sanitizeValues(selections[facetKey]);

    if (values.length > 0) {
      entries.push([facetKey, values]);
    }
  }

  return entries;
}

/*
 * A blank body filter carries no scope: emitting it would add a chip that
 * matches every row while telling the user their view is filtered.
 */
function sanitizeBodyContains(value: string | undefined): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function isValidDate(value: Date | undefined): value is Date {
  return value instanceof Date && !isNaN(value.getTime());
}

interface ResolvedTimeWindow {
  startTime: Date | null;
  endTime: Date | null;
  dropped: Array<string>;
}

/*
 * All three targets need BOTH ends of the window (logs/traces ignore a
 * Custom range unless start AND end parse; the metric explorer only emits
 * the absolute params as a pair). A lone endpoint is therefore reported as
 * dropped instead of emitting a half-window the explorer would discard.
 */
function resolveTimeWindow(
  scope: TelemetryCrossSignalScope,
): ResolvedTimeWindow {
  const hasStart: boolean = isValidDate(scope.startTime);
  const hasEnd: boolean = isValidDate(scope.endTime);

  if (hasStart && hasEnd) {
    return {
      startTime: scope.startTime as Date,
      endTime: scope.endTime as Date,
      dropped: [],
    };
  }

  const dropped: Array<string> = [];

  if (hasStart) {
    dropped.push("startTime");
  }

  if (hasEnd) {
    dropped.push("endTime");
  }

  return { startTime: null, endTime: null, dropped };
}

/**
 * Translate a scope into logs-explorer query params.
 *
 * Field support: serviceIds -> `primaryEntityId` filter tuple, severityTexts
 * -> `severityText` (canonicalized casing), traceIds -> `traceId`, spanIds
 * -> `spanId`, attributes -> `attributes.<key>` tuples, bodyContains ->
 * `body` (a contains-match chip), startTime+endTime -> `range=Custom` +
 * `start`/`end`. Every scope field is expressible in the logs grammar, so
 * `dropped` only ever reports a lone time endpoint.
 */
export function toLogsExplorerQueryParams(
  scope: TelemetryCrossSignalScope,
): CrossSignalQueryParams {
  const params: Dictionary<string> = {};
  const dropped: Array<string> = [];

  /*
   * Tuple shape: Array<[facetKey, values[]]> — exactly what
   * LogsViewer.readInitialUrlState JSON.parses back into its
   * appliedFacetFilters map.
   */
  const tuples: Array<[string, Array<string>]> = [];

  /*
   * Deduplicate AFTER normalization so "error" and "Error" collapse into
   * one canonical value instead of emitting a duplicate filter chip.
   */
  const severityValues: Array<string> = sanitizeValues(
    sanitizeValues(scope.severityTexts).map((value: string): string => {
      return normalizeLogSeverity(value);
    }),
  );

  if (severityValues.length > 0) {
    tuples.push(["severityText", severityValues]);
  }

  const serviceIds: Array<string> = sanitizeValues(scope.serviceIds);

  if (serviceIds.length > 0) {
    tuples.push(["primaryEntityId", serviceIds]);
  }

  for (const [facetKey, values] of sanitizeResourceFacetSelections(
    scope.resourceFacetSelections,
  )) {
    tuples.push([facetKey, values]);
  }

  const traceIds: Array<string> = sanitizeValues(scope.traceIds);

  if (traceIds.length > 0) {
    tuples.push(["traceId", traceIds]);
  }

  const spanIds: Array<string> = sanitizeValues(scope.spanIds);

  if (spanIds.length > 0) {
    tuples.push(["spanId", spanIds]);
  }

  for (const [key, value] of sanitizeAttributeEntries(scope.attributes)) {
    tuples.push([`attributes.${key}`, [value]]);
  }

  const bodyContains: string = sanitizeBodyContains(scope.bodyContains);

  if (bodyContains.length > 0) {
    tuples.push(["body", [bodyContains]]);
  }

  if (tuples.length > 0) {
    params["filters"] = JSON.stringify(tuples);
  }

  const window: ResolvedTimeWindow = resolveTimeWindow(scope);

  if (window.startTime && window.endTime) {
    params["range"] = TimeRange.CUSTOM;
    params["start"] = OneUptimeDate.toString(window.startTime);
    params["end"] = OneUptimeDate.toString(window.endTime);
  }

  dropped.push(...window.dropped);

  return { params, dropped };
}

/*
 * Whether an attribute key can ride in a traces `@key:value` search token.
 * The parseSearch tokenizer (TracesViewer.tsx) splits the token at the
 * FIRST colon, treats whitespace as a token boundary, has no escape
 * sequence for double quotes, and reads a leading "@" as the attribute
 * marker — so keys containing any of those go through the JSON `filters`
 * chip instead.
 */
function isTraceTokenSafeKey(key: string): boolean {
  if (key.length === 0) {
    return false;
  }

  if (TRACE_TOKEN_UNSAFE_CHARS.test(key)) {
    return false;
  }

  if (key.startsWith("@") || key.startsWith("-")) {
    return false;
  }

  return true;
}

/*
 * Whether a value can ride in a traces search token, and how.
 *
 *  - values with whitespace get double-quoted (`@k:"a b"` — the tokenizer's
 *    quoted-token branch);
 *  - values containing a double quote cannot be represented (the grammar
 *    has no escape sequence — `"[^"]*"` stops at the first quote);
 *  - values starting with "~" would flip an exact match into the
 *    contains-match operator (quoting does NOT protect it: parseSearch
 *    strips quotes before the startsWith("~") check);
 *  - values containing "%" risk corruption because TracesViewer
 *    double-decodes the `search` param (decodeURIComponent on the already-
 *    decoded value, TracesViewer.tsx readInitialUrlState) — "a%20b" would
 *    come out as "a b".
 *
 * Unrepresentable values fall back to a `filters` chip, which is plain JSON
 * and can carry anything.
 */
function buildTraceSearchTokenValue(value: string): string | null {
  if (value.includes('"')) {
    return null;
  }

  if (value.includes("%")) {
    return null;
  }

  if (value.startsWith("~")) {
    return null;
  }

  if (WHITESPACE.test(value)) {
    return `"${value}"`;
  }

  return value;
}

/**
 * Translate a scope into traces-explorer query params.
 *
 * Field support: traceIds/spanIds -> `trace:`/`span:` search tokens (chip
 * fallback for values the DSL cannot carry), attributes -> `@key:value`
 * search tokens (chip fallback likewise), serviceIds -> `primaryEntityId`
 * filter chips (chips display the service NAME via the facet's
 * valueDisplayMap, where a `service:` token would show the raw ObjectID),
 * startTime+endTime -> `range=Custom` + `start`/`end`.
 *
 * Dropped: severityTexts and bodyContains — spans have neither a severity
 * nor a message-body dimension.
 */
export function toTracesExplorerQueryParams(
  scope: TelemetryCrossSignalScope,
): CrossSignalQueryParams {
  const params: Dictionary<string> = {};
  const dropped: Array<string> = [];

  const searchTokens: Array<string> = [];

  // Tuple shape: Array<[facetKey, value]> string pairs (one value each).
  const filterTuples: Array<[string, string]> = [];

  for (const serviceId of sanitizeValues(scope.serviceIds)) {
    filterTuples.push(["primaryEntityId", serviceId]);
  }

  /*
   * The traces `filters` grammar is one [key, value] pair per chip, so a
   * multi-valued selection fans out into one chip per id — the explorer
   * groups same-key chips back into a single facet selection.
   */
  for (const [facetKey, values] of sanitizeResourceFacetSelections(
    scope.resourceFacetSelections,
  )) {
    for (const value of values) {
      filterTuples.push([facetKey, value]);
    }
  }

  for (const [key, value] of sanitizeAttributeEntries(scope.attributes)) {
    const tokenValue: string | null = isTraceTokenSafeKey(key)
      ? buildTraceSearchTokenValue(value)
      : null;

    if (tokenValue !== null) {
      searchTokens.push(`@${key}:${tokenValue}`);
    } else {
      filterTuples.push([`attributes.${key}`, value]);
    }
  }

  for (const traceId of sanitizeValues(scope.traceIds)) {
    const tokenValue: string | null = buildTraceSearchTokenValue(traceId);

    if (tokenValue !== null) {
      searchTokens.push(`trace:${tokenValue}`);
    } else {
      filterTuples.push(["traceId", traceId]);
    }
  }

  for (const spanId of sanitizeValues(scope.spanIds)) {
    const tokenValue: string | null = buildTraceSearchTokenValue(spanId);

    if (tokenValue !== null) {
      searchTokens.push(`span:${tokenValue}`);
    } else {
      filterTuples.push(["spanId", spanId]);
    }
  }

  if (searchTokens.length > 0) {
    params["search"] = searchTokens.join(" ");
  }

  if (filterTuples.length > 0) {
    params["filters"] = JSON.stringify(filterTuples);
  }

  const window: ResolvedTimeWindow = resolveTimeWindow(scope);

  if (window.startTime && window.endTime) {
    params["range"] = TimeRange.CUSTOM;
    params["start"] = OneUptimeDate.toString(window.startTime);
    params["end"] = OneUptimeDate.toString(window.endTime);
  }

  if (sanitizeValues(scope.severityTexts).length > 0) {
    dropped.push("severityTexts");
  }

  if (sanitizeBodyContains(scope.bodyContains).length > 0) {
    dropped.push("bodyContains");
  }

  dropped.push(...window.dropped);

  return { params, dropped };
}

/**
 * Translate a scope into metric-explorer query params.
 *
 * Field support: attributes -> the single query's attribute filters inside
 * the JSON `metricQueries` param, startTime+endTime -> absolute
 * `startTime`/`endTime` (a pinned window; the metric explorer represents
 * Custom by the absolute params alone — see MetricExplorerUrl). The
 * optional `metricName` argument names the query.
 *
 * Dropped: serviceIds, resourceFacetSelections, traceIds, spanIds,
 * severityTexts, bodyContains — the metric explorer's URL grammar has no
 * service / resource / trace / span / severity / message dimension (metrics
 * carry a primaryEntityId column, but the explorer only parses metricName +
 * attributes out of `metricQueries`).
 */
export function toMetricsExplorerQueryParams(
  scope: TelemetryCrossSignalScope,
  metricName?: string,
): CrossSignalQueryParams {
  const params: Dictionary<string> = {};
  const dropped: Array<string> = [];

  const attributes: Dictionary<string> = {};

  for (const [key, value] of sanitizeAttributeEntries(scope.attributes)) {
    attributes[key] = value;
  }

  const query: SerializedMetricQuery = {
    metricName: metricName || "",
    attributes,
  };

  /*
   * Same admission rule as the explorer's own URL round-trip: an empty
   * query (no name, no filters) earns no param at all.
   */
  if (MetricExplorerUrl.isMeaningfulMetricQuery(query)) {
    params[MetricExplorerUrlParam.MetricQueries] = JSON.stringify([query]);
  }

  const window: ResolvedTimeWindow = resolveTimeWindow(scope);

  if (window.startTime && window.endTime) {
    params[MetricExplorerUrlParam.StartTime] = OneUptimeDate.toString(
      window.startTime,
    );
    params[MetricExplorerUrlParam.EndTime] = OneUptimeDate.toString(
      window.endTime,
    );
  }

  if (sanitizeValues(scope.serviceIds).length > 0) {
    dropped.push("serviceIds");
  }

  for (const [facetKey] of sanitizeResourceFacetSelections(
    scope.resourceFacetSelections,
  )) {
    dropped.push(facetKey);
  }

  if (sanitizeValues(scope.traceIds).length > 0) {
    dropped.push("traceIds");
  }

  if (sanitizeValues(scope.spanIds).length > 0) {
    dropped.push("spanIds");
  }

  if (sanitizeValues(scope.severityTexts).length > 0) {
    dropped.push("severityTexts");
  }

  if (sanitizeBodyContains(scope.bodyContains).length > 0) {
    dropped.push("bodyContains");
  }

  dropped.push(...window.dropped);

  return { params, dropped };
}
