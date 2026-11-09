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
import { buildSearchTokenValue } from "../../Types/Telemetry/TelemetrySearchQuery";
import { toExcludeFacetKey } from "../../Types/Telemetry/FacetExcludeKey";

/*
 * Matches any whitespace, double-quote, or colon — the characters that break a
 * bare traces search token KEY (the grammar escapes values, but a key is read
 * up to the first colon and cannot be quoted). Kept as a named const so the
 * linter doesn't fight over wrapping an inline regex literal used with .test()
 * (wrap-regex vs prettier).
 */
const TRACE_TOKEN_UNSAFE_CHARS: RegExp = /[\s":]/;

/*
 * A literal percent cannot ride the traces `search` param: TracesViewer
 * decodeURIComponent()s it a SECOND time (readInitialUrlState, on the value
 * URLSearchParams already decoded), so "a%20b" would arrive as "a b".
 */
const PERCENT: RegExp = /%/;

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
 *    (LogsCrossSignalPivot.applyLogsFacetFiltersToQuery). An `attributes.`
 *    chip value is re-parsed by the shared search grammar when the explorer
 *    compiles it, so it is escaped by that grammar's buildSearchTokenValue
 *    here, like the traces chips. `range` is a TimeRange enum value; a
 *    Custom range additionally needs `start` and `end` (parsed with
 *    `new Date(...)`). There is no `search` param.
 *
 *  - Traces explorer (App/FeatureSet/Dashboard/src/Components/Traces/
 *    TracesViewer.tsx, readInitialUrlState + TracesSearchCompile): `search`
 *    is the shared telemetry grammar (Types/Telemetry/TelemetrySearchQuery)
 *    with the trace field names — `trace:<id>`, `span:<id>`,
 *    `@<attr>:<value>` — so values are escaped by that grammar's own
 *    buildSearchTokenValue rather than by rules restated here. `filters` is a
 *    JSON array of [facetKey, value] string pairs where facetKey may be
 *    `primaryEntityId` (service ObjectID) or `attributes.<key>`; an
 *    `attributes.` chip value is re-parsed by the grammar, so it is escaped
 *    too. `range`/`start`/`end` follow the same Custom convention as logs.
 *
 *  - Metric explorer (Common/Utils/Metrics/MetricExplorerUrl.ts): the
 *    JSON-encoded `metricQueries` param plus absolute `startTime`/`endTime`
 *    (a pinned Custom window is represented by the absolute params alone —
 *    no `range` token), plus the one-shot `services` param (JSON array of
 *    Service ObjectID strings) that the explorer resolves to
 *    `resource.service.name` attribute filters on load.
 *
 * A value the view LEAVES OUT ("Service is not checkout") rides the logs and
 * traces `filters` as the chip a facet row's minus writes: the facet key
 * marked with a leading `!` (Types/Telemetry/FacetExcludeKey), which both
 * explorers read back into the same "is not" chip. The metric explorer has
 * no "is not", so there it is reported dropped under the kept field's name
 * marked the same way (`!serviceIds`, `!hostId`, `!attributes.<key>`).
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
  /**
   * The values the view leaves out, each beside the field it would keep:
   * service ObjectID strings, resource selections keyed by facet, exact
   * attribute values by key, and log severities (logs only). Written as the
   * `!` chips of the logs and traces `filters` grammar; a value both kept
   * and left out is kept, as the explorers' own chips never hold one twice.
   */
  excludedServiceIds?: Array<string> | undefined;
  excludedResourceFacetSelections?: ResourceEntityFacetSelections | undefined;
  excludedAttributes?: Dictionary<Array<string>> | undefined;
  excludedSeverityTexts?: Array<string> | undefined;
  startTime?: Date | undefined;
  endTime?: Date | undefined;
}

/**
 * How a target that cannot leave a value out names it among the dropped
 * fields: the kept field's name marked with the exclude marker
 * (`!serviceIds`, `!severityTexts`, `!hostId`, `!attributes.<key>`), so a
 * pivot hint reads it as "excluded services", never as the kept field.
 */
export function toExcludedDroppedField(field: string): string {
  return toExcludeFacetKey(field);
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
 * Excluded attribute entries: an empty key or no non-empty value carries
 * nothing to leave out. Values once each, in order.
 */
function sanitizeExcludedAttributeEntries(
  attributes: Dictionary<Array<string>> | undefined,
): Array<[string, Array<string>]> {
  if (!attributes) {
    return [];
  }

  const entries: Array<[string, Array<string>]> = [];

  for (const key of Object.keys(attributes)) {
    const raw: unknown = attributes[key];
    const values: Array<string> = sanitizeValues(
      Array.isArray(raw) ? (raw as Array<string>) : [],
    );

    if (key.length === 0 || values.length === 0) {
      continue;
    }

    entries.push([key, values]);
  }

  return entries;
}

// The values left out that are not also kept: a value is in one state.
function withoutKept(
  excluded: Array<string>,
  kept: Array<string>,
): Array<string> {
  const keptValues: Set<string> = new Set<string>(kept);

  return excluded.filter((value: string): boolean => {
    return !keptValues.has(value);
  });
}

/*
 * What a scope leaves out, read once for every serializer: each list
 * sanitized, without the values the scope also keeps, and severities in
 * the database's casing.
 */
interface ResolvedExclusions {
  serviceIds: Array<string>;
  resourceFacetSelections: Array<[string, Array<string>]>;
  attributes: Array<[string, Array<string>]>;
  severityTexts: Array<string>;
}

function resolveExclusions(
  scope: TelemetryCrossSignalScope,
): ResolvedExclusions {
  const keptResources: Dictionary<Array<string>> = {};

  for (const [facetKey, values] of sanitizeResourceFacetSelections(
    scope.resourceFacetSelections,
  )) {
    keptResources[facetKey] = values;
  }

  const keptAttributes: Dictionary<string> = {};

  for (const [key, value] of sanitizeAttributeEntries(scope.attributes)) {
    keptAttributes[key] = value;
  }

  const resourceFacetSelections: Array<[string, Array<string>]> = [];

  for (const [facetKey, values] of sanitizeResourceFacetSelections(
    scope.excludedResourceFacetSelections,
  )) {
    const leftOut: Array<string> = withoutKept(
      values,
      keptResources[facetKey] || [],
    );

    if (leftOut.length > 0) {
      resourceFacetSelections.push([facetKey, leftOut]);
    }
  }

  const attributes: Array<[string, Array<string>]> = [];

  for (const [key, values] of sanitizeExcludedAttributeEntries(
    scope.excludedAttributes,
  )) {
    const kept: string | undefined = keptAttributes[key];
    const leftOut: Array<string> = withoutKept(
      values,
      kept === undefined ? [] : [kept],
    );

    if (leftOut.length > 0) {
      attributes.push([key, leftOut]);
    }
  }

  const keptSeverities: Array<string> = sanitizeValues(scope.severityTexts).map(
    (value: string): string => {
      return normalizeLogSeverity(value);
    },
  );

  return {
    serviceIds: withoutKept(
      sanitizeValues(scope.excludedServiceIds),
      sanitizeValues(scope.serviceIds),
    ),
    resourceFacetSelections,
    attributes,
    severityTexts: withoutKept(
      sanitizeValues(
        sanitizeValues(scope.excludedSeverityTexts).map(
          (value: string): string => {
            return normalizeLogSeverity(value);
          },
        ),
      ),
      keptSeverities,
    ),
  };
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
 * -> `spanId`, attributes -> `attributes.<key>` tuples (values escaped with
 * the search grammar's buildSearchTokenValue, because the explorer re-parses
 * a chip value as grammar), bodyContains -> `body` (a contains-match chip),
 * startTime+endTime -> `range=Custom` + `start`/`end`. The values left out
 * ride `!` tuples beside them (`!severityText`, `!primaryEntityId`,
 * `!<resource facet>`, `!attributes.<key>`). Every scope field is
 * expressible in the logs grammar, so `dropped` only ever reports a lone
 * time endpoint.
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
    /*
     * The logs explorer compiles an `attributes.<key>` chip through the
     * search grammar (applyLogsFacetFiltersToQuery -> compileAttributeChipValues),
     * exactly like a typed `@key:value`, so a raw `/api/*` arrived as a
     * wildcard matching every path under /api and a raw `~internal` as a
     * contains-match. Escaping with the grammar's own token builder makes the
     * chip mean the literal value — the same treatment the traces serializer
     * has always given its chips.
     */
    tuples.push([`attributes.${key}`, [buildSearchTokenValue(value)]]);
  }

  const bodyContains: string = sanitizeBodyContains(scope.bodyContains);

  if (bodyContains.length > 0) {
    tuples.push(["body", [bodyContains]]);
  }

  // What the view leaves out, as the chips the explorer's minus writes.
  const exclusions: ResolvedExclusions = resolveExclusions(scope);

  if (exclusions.severityTexts.length > 0) {
    tuples.push([toExcludeFacetKey("severityText"), exclusions.severityTexts]);
  }

  if (exclusions.serviceIds.length > 0) {
    tuples.push([toExcludeFacetKey("primaryEntityId"), exclusions.serviceIds]);
  }

  for (const [facetKey, values] of exclusions.resourceFacetSelections) {
    tuples.push([toExcludeFacetKey(facetKey), values]);
  }

  for (const [key, values] of exclusions.attributes) {
    // Escaped as a kept attribute chip's value is: the literal value.
    tuples.push([
      toExcludeFacetKey(`attributes.${key}`),
      values.map((value: string): string => {
        return buildSearchTokenValue(value);
      }),
    ]);
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
 * The escaping is the shared search grammar's own
 * ({@link buildSearchTokenValue}), which is what the traces explorer now
 * parses with: quotes, wildcards, a leading `~` and a leading `-` all have
 * escapes, so the quote / tilde values that used to need a chip fallback ride
 * a token intact. Only a literal percent still cannot — that is a URL
 * round-trip problem, not a grammar one — and falls back to a `filters` chip,
 * which is plain JSON and can carry anything.
 */
function buildTraceSearchTokenValue(value: string): string | null {
  if (PERCENT.test(value)) {
    return null;
  }

  return buildSearchTokenValue(value);
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
 * The values left out ride `!` filter chips (`!primaryEntityId`,
 * `!<resource facet>`, `!attributes.<key>`), one per value as the kept ones.
 *
 * Dropped: severityTexts, excludedSeverityTexts (as `!severityTexts`) and
 * bodyContains — spans have neither a severity nor a message-body
 * dimension.
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
      /*
       * An `attributes.<key>` chip is re-parsed by the same grammar when the
       * explorer builds its query, so the fallback carries an escaped token
       * too — a raw `99%` is inert, but a raw `/api/*` would come back as a
       * wildcard matching far more than the scope asked for.
       */
      filterTuples.push([`attributes.${key}`, buildSearchTokenValue(value)]);
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

  /*
   * What the view leaves out, as the chips the explorer's minus writes. A
   * chip, never a typed `-@key:value`: the explorer reads a chip's values
   * as one reading (readTraceExclusions), the same one its facet rows
   * write.
   */
  const exclusions: ResolvedExclusions = resolveExclusions(scope);

  for (const serviceId of exclusions.serviceIds) {
    filterTuples.push([toExcludeFacetKey("primaryEntityId"), serviceId]);
  }

  for (const [facetKey, values] of exclusions.resourceFacetSelections) {
    for (const value of values) {
      filterTuples.push([toExcludeFacetKey(facetKey), value]);
    }
  }

  for (const [key, values] of exclusions.attributes) {
    for (const value of values) {
      filterTuples.push([
        toExcludeFacetKey(`attributes.${key}`),
        buildSearchTokenValue(value),
      ]);
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

  if (exclusions.severityTexts.length > 0) {
    dropped.push(toExcludedDroppedField("severityTexts"));
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
 * Dropped: resourceFacetSelections, traceIds, spanIds, severityTexts,
 * bodyContains — the metric explorer's URL grammar has no resource /
 * trace / span / severity / message dimension. serviceIds DO carry, via
 * the `services` param the explorer folds into `resource.service.name`
 * attribute filters on load. Every value left out is dropped too, under
 * its kept field's name marked `!` (`!serviceIds`, `!hostId`,
 * `!attributes.<key>`, `!severityTexts`): a metric query has no "is not",
 * and carrying the rest without it would widen what the chart shows.
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

  /*
   * Service scope rides the one-shot `services` param — the explorer
   * resolves ids to names and folds them into `resource.service.name`
   * attribute filters on load, so serviceIds is no longer dropped.
   */
  const scopedServiceIds: Array<string> = sanitizeValues(scope.serviceIds);

  if (scopedServiceIds.length > 0) {
    params[MetricExplorerUrlParam.Services] = JSON.stringify(scopedServiceIds);
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

  const exclusions: ResolvedExclusions = resolveExclusions(scope);

  if (exclusions.serviceIds.length > 0) {
    dropped.push(toExcludedDroppedField("serviceIds"));
  }

  for (const [facetKey] of exclusions.resourceFacetSelections) {
    dropped.push(toExcludedDroppedField(facetKey));
  }

  for (const [key] of exclusions.attributes) {
    dropped.push(toExcludedDroppedField(`attributes.${key}`));
  }

  if (exclusions.severityTexts.length > 0) {
    dropped.push(toExcludedDroppedField("severityTexts"));
  }

  dropped.push(...window.dropped);

  return { params, dropped };
}
