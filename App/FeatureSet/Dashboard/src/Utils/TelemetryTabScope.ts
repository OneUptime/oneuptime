import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Route from "Common/Types/API/Route";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  ResourceEntityFacetSelections,
  isResourceEntityFacetKey,
  isServiceFacetKey,
} from "Common/Types/Telemetry/ResourceEntityFacet";

/*
 * Carrying "which slice of telemetry am I looking at" across the Viewer /
 * Insights tabs of one signal.
 *
 * The complaint this answers: selecting a saved view in the Logs Viewer
 * narrows the list correctly, and then switching to the Insights tab throws
 * that away and shows "All services and hosts". The two tabs looked like two
 * views of one dataset while each kept private scope state.
 *
 * The fix is deliberately boring: both tabs already speak the same URL
 * grammar (`filters` / `range` / `start` / `end`, written through
 * TelemetryViewerUrlState), so the hand-off is "carry those params onto the
 * sibling tab's link". Nothing is stored in a module singleton, which means
 * the resulting link is also a shareable, bookmarkable description of the
 * scope — the same property the viewers' own URL sync was built for.
 *
 * This module is pure: no React, no network, no RouteMap. App/Tests exercise
 * every branch in plain Node.
 */

/**
 * The params that describe the SLICE, as opposed to the presentation.
 *
 * `page` / `pageSize` / `view` / `rootOnly` are deliberately absent: page 4
 * of the Viewer's list says nothing about what the Insights tab should
 * aggregate, and carrying them would put the user on page 4 of a list they
 * did not ask for on the way back.
 */
export const TELEMETRY_TAB_SCOPE_PARAM_NAMES: ReadonlyArray<string> = [
  "filters",
  "range",
  "start",
  "end",
  "savedView",
];

/**
 * One facet selection: a facet key and every value selected under it.
 *
 * The Logs explorer's URL grammar is exactly this (`[facetKey, values[]]`);
 * the Traces and Metrics explorers fan the same information out into one
 * `[facetKey, value]` pair per value. Both are parsed into this shape and
 * serialized back out into whichever grammar the destination speaks, so a
 * viewer's chips survive the round trip through an Insights tab.
 */
export type TelemetryFilterTuple = [string, Array<string>];

function asNonEmptyStrings(values: Array<unknown>): Array<string> {
  const unique: Array<string> = [];

  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) {
      continue;
    }

    if (!unique.includes(value)) {
      unique.push(value);
    }
  }

  return unique;
}

/**
 * Read a `filters` param into facet tuples, accepting BOTH explorer
 * grammars.
 *
 * Accepting both is what lets one implementation serve all three signals,
 * and it costs nothing: the two shapes are distinguishable by whether the
 * second element is an array. Anything else — malformed JSON, a non-array
 * payload, a tuple with no facet key — yields no tuple rather than throwing,
 * because a corrupt deep link must degrade to "no filter", never to a blank
 * page.
 */
export function parseTelemetryFilterTuples(
  raw: string | null | undefined,
): Array<TelemetryFilterTuple> {
  if (typeof raw !== "string" || raw.length === 0) {
    return [];
  }

  let parsed: unknown = null;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  /*
   * Same-key entries are merged rather than appended, so the pair grammar
   * ([["primaryEntityId","a"],["primaryEntityId","b"]]) round-trips into one
   * tuple with two values instead of two single-value tuples that would
   * later serialize into duplicate chips.
   */
  const byKey: Map<string, Array<string>> = new Map();
  const order: Array<string> = [];

  for (const entry of parsed as Array<unknown>) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      continue;
    }

    const facetKey: unknown = entry[0];

    if (typeof facetKey !== "string" || facetKey.length === 0) {
      continue;
    }

    const rawValues: Array<unknown> = Array.isArray(entry[1])
      ? (entry[1] as Array<unknown>)
      : [entry[1]];

    const values: Array<string> = asNonEmptyStrings(rawValues);

    if (values.length === 0) {
      continue;
    }

    if (!byKey.has(facetKey)) {
      byKey.set(facetKey, []);
      order.push(facetKey);
    }

    const existing: Array<string> = byKey.get(facetKey)!;

    for (const value of values) {
      if (!existing.includes(value)) {
        existing.push(value);
      }
    }
  }

  return order.map((facetKey: string): TelemetryFilterTuple => {
    return [facetKey, byKey.get(facetKey)!];
  });
}

/**
 * Serialize tuples into the Logs explorer's `filters` grammar —
 * `[[facetKey, values[]]]`. Null when there is nothing to say, so the caller
 * can hand it straight to a param writer that deletes on null.
 */
export function serializeTelemetryFilterTuplesAsLists(
  tuples: Array<TelemetryFilterTuple>,
): string | null {
  const usable: Array<TelemetryFilterTuple> = tuples.filter(
    (tuple: TelemetryFilterTuple): boolean => {
      return tuple[1].length > 0;
    },
  );

  return usable.length > 0 ? JSON.stringify(usable) : null;
}

/**
 * Serialize tuples into the Traces / Metrics explorers' `filters` grammar —
 * one `[facetKey, value]` pair per value. Those explorers group same-key
 * pairs back into a single facet selection on read.
 */
export function serializeTelemetryFilterTuplesAsPairs(
  tuples: Array<TelemetryFilterTuple>,
): string | null {
  const pairs: Array<[string, string]> = [];

  for (const [facetKey, values] of tuples) {
    for (const value of values) {
      pairs.push([facetKey, value]);
    }
  }

  return pairs.length > 0 ? JSON.stringify(pairs) : null;
}

/**
 * The scope an Insights tab can actually apply, split out of a viewer's
 * chips.
 *
 * `unsupported` is the rest — a body-contains chip, a trace id, a severity
 * selection. An Insights page has no dimension for those, but throwing them
 * away would make the round trip lossy: switch to Insights and back and the
 * chip you set is gone. So they are carried verbatim and re-emitted on the
 * way back, and the page says out loud that it is not applying them.
 */
export interface TelemetryScopeSelection {
  serviceIds: Array<string>;
  resourceFilters: ResourceEntityFacetSelections;
  unsupported: Array<TelemetryFilterTuple>;
}

export interface SplitTelemetryScopeOptions {
  /*
   * Whether the destination can filter on host / docker host / podman host /
   * Kubernetes cluster ids. True for Logs and Traces, whose services rewrite
   * `resourceFilters` into entity-key predicates; false for Metrics, which
   * has no such path — there the selections ride along as `unsupported`
   * rather than silently doing nothing.
   */
  supportsResourceEntityFacets: boolean;
}

export function splitTelemetryScopeFilters(
  tuples: Array<TelemetryFilterTuple>,
  options: SplitTelemetryScopeOptions,
): TelemetryScopeSelection {
  const serviceIds: Array<string> = [];
  const resourceFilters: ResourceEntityFacetSelections = {};
  const unsupported: Array<TelemetryFilterTuple> = [];

  for (const [facetKey, values] of tuples) {
    if (isServiceFacetKey(facetKey)) {
      for (const value of values) {
        if (!serviceIds.includes(value)) {
          serviceIds.push(value);
        }
      }
      continue;
    }

    if (
      options.supportsResourceEntityFacets &&
      isResourceEntityFacetKey(facetKey)
    ) {
      const existing: Array<string> = resourceFilters[facetKey] || [];

      for (const value of values) {
        if (!existing.includes(value)) {
          existing.push(value);
        }
      }

      resourceFilters[facetKey] = existing;
      continue;
    }

    unsupported.push([facetKey, [...values]]);
  }

  return { serviceIds, resourceFilters, unsupported };
}

/**
 * Recombine a scope back into facet tuples, applied selections first.
 *
 * The order matters only for how the chips read on arrival; putting the
 * services first matches the order the pickers offer them in.
 */
export function buildTelemetryScopeFilterTuples(
  selection: TelemetryScopeSelection,
): Array<TelemetryFilterTuple> {
  const tuples: Array<TelemetryFilterTuple> = [];

  if (selection.serviceIds.length > 0) {
    tuples.push(["primaryEntityId", [...selection.serviceIds]]);
  }

  for (const facetKey of Object.keys(selection.resourceFilters)) {
    const values: Array<string> = selection.resourceFilters[facetKey] || [];

    if (values.length > 0) {
      tuples.push([facetKey, [...values]]);
    }
  }

  for (const tuple of selection.unsupported) {
    if (tuple[1].length > 0) {
      tuples.push([tuple[0], [...tuple[1]]]);
    }
  }

  return tuples;
}

/*
 * Human labels for the facet keys an Insights tab carries but cannot apply.
 * Anything unlisted falls back to its raw key, which is still more useful to
 * a user staring at a chip than silence would be.
 */
const UNAPPLIED_FACET_LABELS: Dictionary<string> = {
  severityText: "severity",
  body: "message text",
  traceId: "trace id",
  spanId: "span id",
  hostId: "host",
  dockerHostId: "docker host",
  podmanHostId: "podman host",
  kubernetesClusterId: "kubernetes cluster",
};

const ATTRIBUTE_FACET_PREFIX: string = "attributes.";

/**
 * "Also filtered in the Viewer: severity, message text" — the sentence a
 * hint chip renders when the tab is carrying filters it is not applying.
 *
 * Empty when there is nothing to say, so the caller renders no chip at all
 * rather than an empty one.
 */
export function describeUnappliedScopeFilters(
  tuples: Array<TelemetryFilterTuple>,
): string {
  const labels: Array<string> = [];

  for (const [facetKey] of tuples) {
    const label: string = facetKey.startsWith(ATTRIBUTE_FACET_PREFIX)
      ? `attribute ${facetKey.substring(ATTRIBUTE_FACET_PREFIX.length)}`
      : UNAPPLIED_FACET_LABELS[facetKey] || facetKey;

    if (!labels.includes(label)) {
      labels.push(label);
    }
  }

  if (labels.length === 0) {
    return "";
  }

  return `Also filtered in the Viewer, not applied here: ${labels.join(", ")}`;
}

// --- Time range ---

/**
 * Read `range` / `start` / `end` back into a time selection.
 *
 * Returns null — not a default — when the params say nothing, so callers can
 * tell "the URL asked for the past hour" apart from "the URL asked for
 * nothing" and keep their own default in the second case.
 *
 * A rolling preset stays rolling: the enum value is what travels, and it is
 * re-resolved against the clock wherever it lands. Only a Custom window
 * carries absolute endpoints, and only when BOTH parse — a half window would
 * silently become a different range.
 */
export function readTelemetryTimeRangeParams(
  params: Dictionary<string>,
): RangeStartAndEndDateTime | null {
  const rawRange: string | undefined = params["range"];

  if (!rawRange) {
    return null;
  }

  const knownRanges: Array<string> = Object.values(TimeRange);

  if (!knownRanges.includes(rawRange)) {
    return null;
  }

  const range: TimeRange = rawRange as TimeRange;

  if (range !== TimeRange.CUSTOM) {
    return { range };
  }

  const rawStart: string | undefined = params["start"];
  const rawEnd: string | undefined = params["end"];

  if (!rawStart || !rawEnd) {
    return null;
  }

  const startDate: Date = new Date(rawStart);
  const endDate: Date = new Date(rawEnd);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return null;
  }

  return {
    range,
    startAndEndDate: new InBetween<Date>(startDate, endDate),
  };
}

/**
 * Write a time selection into `range` / `start` / `end`.
 *
 * The range is written even when it equals the page's own default. The
 * explorers used to omit their default to keep the URL short, which was
 * harmless while each tab was an island — but a window can only be carried
 * to a sibling tab if it is written down, and "absent means my default"
 * silently changes the window whenever the two tabs' defaults differ. A URL
 * that fully describes its own view is also the one worth sharing.
 */
export function buildTelemetryTimeRangeParams(
  timeRange: RangeStartAndEndDateTime,
): Dictionary<string | null> {
  const params: Dictionary<string | null> = {
    range: null,
    start: null,
    end: null,
  };

  if (!timeRange || !timeRange.range) {
    return params;
  }

  params["range"] = timeRange.range;

  if (timeRange.range === TimeRange.CUSTOM && timeRange.startAndEndDate) {
    params["start"] = timeRange.startAndEndDate.startValue.toISOString();
    params["end"] = timeRange.startAndEndDate.endValue.toISOString();
  }

  return params;
}

// --- URL plumbing ---

/**
 * Pull the scope params out of a query string, dropping the empties.
 *
 * Takes the search string rather than reading `window` so it can be tested
 * without a DOM, and so a caller can hand it a string it captured earlier.
 */
export function readTelemetryTabScopeParams(
  search: string | null | undefined,
): Dictionary<string> {
  const params: Dictionary<string> = {};

  if (typeof search !== "string" || search.length === 0) {
    return params;
  }

  const searchParams: URLSearchParams = new URLSearchParams(search);

  for (const name of TELEMETRY_TAB_SCOPE_PARAM_NAMES) {
    const value: string | null = searchParams.get(name);

    if (value !== null && value.length > 0) {
      params[name] = value;
    }
  }

  return params;
}

/*
 * Route-safe single encoding for one query-param value. Route's setter
 * rejects a bare "~" (it is outside the character class the setter allows)
 * while encodeURIComponent leaves it alone, so escape that one by hand.
 * Every explorer reads its params back through URLSearchParams, which is a
 * single decode.
 */
export function encodeRouteQueryParamValue(value: string): string {
  return encodeURIComponent(value).replace(/~/g, "%7E");
}

/**
 * Append query params to a route, encoding each value.
 *
 * Returns the route unchanged when there is nothing to append, and null when
 * Route rejects a value: these builders run inside row and tab renderers,
 * where "no link" is a survivable answer and an exception out of render is
 * not.
 */
export function withRouteQueryParams(
  route: Route,
  params: Dictionary<string>,
): Route | null {
  const keys: Array<string> = Object.keys(params);

  if (keys.length === 0) {
    return route;
  }

  const encoded: Dictionary<string> = {};

  for (const key of keys) {
    encoded[key] = encodeRouteQueryParamValue(params[key] as string);
  }

  try {
    const result: Route = new Route(route.toString());
    result.addQueryParams(encoded);

    return result;
  } catch {
    return null;
  }
}

/**
 * The sibling-tab link: the destination route carrying the scope the user is
 * currently looking at.
 *
 * Falls back to the bare route rather than dropping the link when a value
 * cannot be encoded — landing on an unscoped Insights tab is a much smaller
 * failure than a tab that does not navigate.
 */
export function withTelemetryTabScopeParams(
  route: Route,
  scopeParams: Dictionary<string>,
): Route {
  return withRouteQueryParams(route, scopeParams) || route;
}

// --- Service-scoped Insights tabs ---

/**
 * Which `filters` grammar a signal's explorers speak.
 *
 * Logs use `[facetKey, values[]]`; Traces and Metrics fan the same
 * information out into one `[facetKey, value]` pair per value. Reading
 * accepts either, but writing has to pick the one the destination parses.
 */
export type TelemetryFilterGrammar = "lists" | "pairs";

/**
 * The scope of an Insights tab whose only applicable dimension is the
 * service.
 *
 * This is Traces and Metrics. Their Insights pages aggregate spans and
 * metric points by service, and have no host, severity, trace or message
 * dimension to filter on — so a service selection is applied and everything
 * else is carried but not applied, the same deal the Logs Insights tab
 * offers for its own unapplicable chips.
 */
export interface ServiceScopedInsightsUrlScope {
  timeRange: RangeStartAndEndDateTime | null;
  serviceIds: Array<string>;
  unappliedFilters: Array<TelemetryFilterTuple>;
  savedViewId: string | null;
}

export function readServiceScopedInsightsUrlScope(
  search: string | null | undefined,
): ServiceScopedInsightsUrlScope {
  const params: Dictionary<string> = readTelemetryTabScopeParams(search);

  const split: TelemetryScopeSelection = splitTelemetryScopeFilters(
    parseTelemetryFilterTuples(params["filters"]),
    /*
     * False on purpose: neither of these Insights pages can compile a host
     * or cluster selection, so reporting it as applicable would show the
     * user a scope the numbers do not honour.
     */
    { supportsResourceEntityFacets: false },
  );

  return {
    timeRange: readTelemetryTimeRangeParams(params),
    serviceIds: split.serviceIds,
    unappliedFilters: split.unsupported,
    savedViewId: params["savedView"] || null,
  };
}

export interface ServiceScopedInsightsUrlScopeInput {
  timeRange: RangeStartAndEndDateTime;
  serviceIds: Array<string>;
  unappliedFilters: Array<TelemetryFilterTuple>;
  savedViewId: string | null;
  /** The grammar the sibling Viewer parses. */
  grammar: TelemetryFilterGrammar;
}

export function buildServiceScopedInsightsUrlParams(
  input: ServiceScopedInsightsUrlScopeInput,
): Dictionary<string | null> {
  const tuples: Array<TelemetryFilterTuple> = buildTelemetryScopeFilterTuples({
    serviceIds: input.serviceIds,
    resourceFilters: {},
    unsupported: input.unappliedFilters,
  });

  const filters: string | null =
    input.grammar === "pairs"
      ? serializeTelemetryFilterTuplesAsPairs(tuples)
      : serializeTelemetryFilterTuplesAsLists(tuples);

  return {
    ...buildTelemetryTimeRangeParams(input.timeRange),
    filters,
    savedView: input.savedViewId || null,
  };
}

/**
 * Drop the nulls out of a param map, leaving what can be appended to a link.
 *
 * A param map is written with explicit nulls so the URL writer can DELETE
 * the params the view is not using; a link has nothing to delete, so it only
 * ever wants the values that are actually set.
 */
export function toPresentParams(
  params: Dictionary<string | null>,
): Dictionary<string> {
  const present: Dictionary<string> = {};

  for (const key of Object.keys(params)) {
    const value: string | null = params[key] ?? null;

    if (value) {
      present[key] = value;
    }
  }

  return present;
}
