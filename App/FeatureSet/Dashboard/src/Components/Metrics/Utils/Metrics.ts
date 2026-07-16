import Metric from "Common/Models/AnalyticsModels/Metric";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject, ObjectType } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import API from "Common/UI/Utils/API/API";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import OneUptimeDate from "Common/Types/Date";
import ProjectUtil from "Common/UI/Utils/Project";
import ObjectID from "Common/Types/ObjectID";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import ExemplarPoint from "Common/UI/Components/Charts/Types/ExemplarPoint";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricFormulaEvaluator from "Common/Utils/Metrics/MetricFormulaEvaluator";
import MetricResultUnitConverter from "Common/Utils/Metrics/MetricResultUnitConverter";
import Dictionary from "Common/Types/Dictionary";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import {
  DictionaryEntryValue,
  DictionaryFilterOperator,
  DictionaryFilterOperatorOption,
  detectOperatorFromValue,
  getOperatorOption,
} from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
import {
  getPublicDashboardContext,
  onPublicDashboardContextChange,
  PublicDashboardContext,
} from "../../Dashboard/Utils/PublicDashboardContext";

/*
 * Public-dashboard metric routing.
 *
 * On the public, unauthenticated dashboard the shared metric widgets must not
 * call the private /api/metric* routes (they 401/405 → /accounts/login, issue
 * #2467). When a public-dashboard context is active (see
 * PublicDashboardContext), aggregate + metric-type reads are routed to the
 * dashboard-scoped public endpoints, and exemplar drill-downs (private trace
 * views an anonymous viewer cannot reach) are skipped.
 *
 * In-flight aggregate request deduplication.
 *
 * A dashboard with N widgets pointed at the same metric used to issue N
 * identical aggregate calls back-to-back. The promise registry below
 * coalesces concurrent identical requests onto a single network call,
 * and a short result cache (lifetime: AGGREGATE_RESULT_TTL_MS) lets a
 * brand-new widget pick up a freshly-completed neighbor's result
 * without going to the wire.
 *
 * This is intentionally cheap and module-local. It is invalidated by
 * tab navigation (the module re-evaluates on full reload), and the TTL
 * is short enough that auto-refresh-driven freshness wins for any
 * dashboard polling at 30s+.
 */
const AGGREGATE_RESULT_TTL_MS: number = 8_000;

/*
 * Default cap on series per grouped query — sent to the server as
 * `topK.count` so only the top-N groups are fetched, and used by the
 * chart layer as the display cap. OPT-IN: fetchResults applies it only
 * when the caller passes `defaultTopN: true` — chart surfaces that render
 * the Top-N controls and truncation banner (MetricView, dashboard chart
 * widgets) opt in, while consumers with no truncation UI (e.g. the
 * dashboard table widget) keep fetching every group. A query can still
 * set its own cap via `metricQueryData.topN` (persisted) or, for chart
 * surfaces that cannot write the query config, via the transient
 * per-query override below.
 */
export const DEFAULT_TOP_N_SERIES: number = 10;

/*
 * `topN` value meaning "fetch every group" — large enough to never
 * truncate real-world cardinality while still bounding the ranking
 * subquery on the server.
 */
export const SHOW_ALL_SERIES_TOP_N: number = 10_000;

/*
 * Transient per-query Top-N overrides, keyed by the query's stable key
 * (see MetricUtil.getQueryConfigTopNKey). Used by chart surfaces that
 * have no way to write `metricQueryData.topN` back into the view config
 * (e.g. read-only dashboard widgets): the override is picked up by the
 * NEXT fetchResults call for that query. Module-local and intentionally
 * not persisted.
 */
const topNOverrideByQueryKey: Map<string, number> = new Map();

interface AggregateCacheEntry {
  result: AggregatedResult;
  expiresAt: number;
}

const inFlightAggregates: Map<string, Promise<AggregatedResult>> = new Map();
const aggregateResultCache: Map<string, AggregateCacheEntry> = new Map();

/*
 * Authenticated and public reads hit different endpoints, so drop any
 * cached/in-flight aggregates whenever the public-dashboard context changes.
 */
onPublicDashboardContextChange(() => {
  inFlightAggregates.clear();
  aggregateResultCache.clear();
});

function buildAggregateCacheKey(aggregateBy: AggregateBy<Metric>): string {
  /*
   * Stable JSON serialization for the request shape. Date instances on
   * the time window are normalized to ISO strings so that two callers
   * passing logically-equal Date objects collide in the cache.
   */
  return JSON.stringify(aggregateBy, (_key: string, value: unknown) => {
    if (value instanceof Date) {
      return value.toISOString();
    }
    return value;
  });
}

function dedupedAggregate(
  aggregateBy: AggregateBy<Metric>,
  /*
   * Optional cache-bypass token folded into the cache/dedup key. A manual
   * "Refresh" on a pinned absolute window re-issues a byte-identical
   * request, which would otherwise be served from the short result cache —
   * bumping the token makes the key miss so the fetch goes to the wire.
   */
  cacheBustToken?: string | undefined,
): Promise<AggregatedResult> {
  const cacheKey: string = cacheBustToken
    ? `${buildAggregateCacheKey(aggregateBy)}::bust=${cacheBustToken}`
    : buildAggregateCacheKey(aggregateBy);

  const cached: AggregateCacheEntry | undefined =
    aggregateResultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.result);
  }
  if (cached) {
    aggregateResultCache.delete(cacheKey);
  }

  const inFlight: Promise<AggregatedResult> | undefined =
    inFlightAggregates.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const promise: Promise<AggregatedResult> = executeAggregate(aggregateBy)
    .then((result: AggregatedResult) => {
      aggregateResultCache.set(cacheKey, {
        result,
        expiresAt: Date.now() + AGGREGATE_RESULT_TTL_MS,
      });
      return result;
    })
    .finally(() => {
      inFlightAggregates.delete(cacheKey);
    });

  inFlightAggregates.set(cacheKey, promise);
  return promise;
}

/*
 * Route a metric aggregation either to the authenticated analytics CRUD
 * endpoint or, when a public-dashboard context is registered, to the
 * dashboard-scoped public endpoint.
 */
function executeAggregate(
  aggregateBy: AggregateBy<Metric>,
): Promise<AggregatedResult> {
  const context: PublicDashboardContext | null = getPublicDashboardContext();
  if (context) {
    return fetchPublicAggregate(aggregateBy, context);
  }

  return AnalyticsModelAPI.aggregate({
    modelType: Metric,
    aggregateBy,
  });
}

async function fetchPublicAggregate(
  aggregateBy: AggregateBy<Metric>,
  context: PublicDashboardContext,
): Promise<AggregatedResult> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await context.postJSON(
      `/metrics-aggregate/${context.dashboardId.toString()}`,
      {
        aggregateBy: JSONFunctions.serialize(aggregateBy as any) as JSONObject,
      },
    );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return response.data as unknown as AggregatedResult;
}

async function fetchPublicMetricTypes(
  context: PublicDashboardContext,
): Promise<Array<MetricType>> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await context.postJSON(
      `/metric-types/${context.dashboardId.toString()}`,
      {},
    );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const rawMetricTypes: Array<JSONObject> = (response.data["metricTypes"] ||
    []) as Array<JSONObject>;

  return rawMetricTypes.map((rawMetricType: JSONObject) => {
    const metricType: MetricType = new MetricType();
    metricType.name = (rawMetricType["name"] as string) || "";
    metricType.unit = (rawMetricType["unit"] as string) || "";
    return metricType;
  });
}

type SanitizeAttributeFiltersFunction = (
  attributes: Dictionary<DictionaryEntryValue> | undefined,
) => Dictionary<DictionaryEntryValue> | undefined;

/*
 * Recognize a multi-value operator (Includes / IncludesNone — "is any of" /
 * "is none of") whether it arrived as a hydrated class instance or as the
 * `{_type, value: [...]}` JSON shape (which is what round-tripping through
 * the dashboard view config produces, since the server never rehydrates
 * dashboard JSON into typed instances). These carry an array, not a scalar.
 */
function isMultiValueFilter(
  value: unknown,
): value is
  | Includes
  | IncludesNone
  | { _type: ObjectType.Includes; value: Array<unknown> }
  | { _type: ObjectType.IncludesNone; value: Array<unknown> } {
  if (value instanceof Includes || value instanceof IncludesNone) {
    return true;
  }
  const type: string | undefined =
    value && typeof value === "object"
      ? (value as { _type?: string })._type
      : undefined;
  return type === ObjectType.Includes || type === ObjectType.IncludesNone;
}

function getMultiValueFilterValues(
  value:
    | Includes
    | IncludesNone
    | { _type: ObjectType.Includes; value: Array<unknown> }
    | { _type: ObjectType.IncludesNone; value: Array<unknown> },
): Array<unknown> {
  if (value instanceof Includes || value instanceof IncludesNone) {
    return value.values || [];
  }
  return (value.value as Array<unknown>) || [];
}

export const sanitizeAttributeFilters: SanitizeAttributeFiltersFunction = (
  attributes: Dictionary<DictionaryEntryValue> | undefined,
): Dictionary<DictionaryEntryValue> | undefined => {
  if (!attributes) {
    return undefined;
  }
  const result: Dictionary<DictionaryEntryValue> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (key.trim() === "" || value === undefined || value === null) {
      continue;
    }
    /*
     * Multi-value operators (Includes / IncludesNone) carry an array, not a
     * scalar string. The generic operator detector below can't read them, so
     * handle them here: drop if no values were picked ("All"), otherwise pass
     * through.
     */
    if (isMultiValueFilter(value)) {
      const multiValues: Array<unknown> = getMultiValueFilterValues(value);
      if (multiValues.length === 0) {
        continue;
      }
      result[key] = value as DictionaryEntryValue;
      continue;
    }
    const detected: {
      operator: DictionaryFilterOperator;
      rawValue: string;
    } = detectOperatorFromValue(value);
    const option: DictionaryFilterOperatorOption = getOperatorOption(
      detected.operator,
    );
    if (!option.hidesValueInput && detected.rawValue.trim() === "") {
      continue;
    }
    result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

export default class MetricUtil {
  public static async fetchResults(data: {
    metricViewData: MetricViewData;
    metricTypes?: Array<MetricType> | undefined;
    /*
     * Pin the time-bucket size instead of letting the server re-derive it
     * from the query window. Callers that align the window to the bucket
     * grid (flooring the start) pass the interval derived from the RAW
     * window here so the slight widening can't bump the bucketing into a
     * coarser tier. Omitted → server derives it from the window as before.
     */
    aggregationInterval?: AggregationInterval | undefined;
    /*
     * Optional cache-bypass nonce. When set, it is folded into the
     * aggregate request cache/dedup key (never sent to the server), so
     * bumping it forces a fresh network fetch even when the request is
     * byte-identical to a cached one — e.g. a manual refresh of a pinned
     * absolute window whose fetch snapshot cannot otherwise change.
     */
    refreshNonce?: number | string | undefined;
    /*
     * Opt in to the DEFAULT_TOP_N_SERIES server-side cap for grouped
     * queries. Only chart surfaces that render the Top-N controls and
     * the "Showing top k of N" truncation banner (MetricView, the
     * dashboard chart widget) should pass true — otherwise a grouped
     * query silently loses groups with no indicator. Absent, grouped
     * queries fetch every group unless the query config itself sets
     * `metricQueryData.topN` (or a transient override is registered).
     */
    defaultTopN?: boolean | undefined;
    /*
     * Namespace for reading transient Top-N overrides — must match the
     * `topNOverrideScope` the host passes to MetricCharts, so overrides
     * written by one widget instance are never picked up by another
     * id-less query that shares the same fallback key (e.g. `var-a`).
     */
    topNOverrideScope?: string | undefined;
  }): Promise<Array<AggregatedResult>> {
    const metricViewData: MetricViewData = data.metricViewData;

    const cacheBustToken: string | undefined =
      data.refreshNonce !== undefined && data.refreshNonce !== null
        ? String(data.refreshNonce)
        : undefined;

    /*
     * Fire all aggregate queries in parallel. Kubernetes overview pages
     * render many charts (CPU/memory/network/etc.), and fetching them
     * sequentially made page load O(N * perQueryLatency). With Promise.all
     * it becomes O(max(perQueryLatency)).
     *
     * dedupedAggregate (defined at module top) coalesces structurally
     * identical aggregate calls onto a single in-flight promise and
     * caches the result for a few seconds, so dashboards with many
     * widgets pointed at the same metric collapse to one round trip.
     */
    const rawResults: Array<AggregatedResult> = await Promise.all(
      metricViewData.queryConfigs.map(
        (queryConfig: MetricQueryConfigData, queryIndex: number) => {
          /*
           * Per-series viewing: when the user has selected attribute
           * keys to group by (e.g. host.name), pass them through as
           * `groupByAttributeKeys` so the server groups on the
           * individual map entries (`attributes['host.name']`) and
           * returns one pooled series per unique key-value combination.
           * The chart layer splits those rows into one line per label
           * combination via `getSeries` (injected in MetricView before
           * render).
           *
           * Grouping by the whole `attributes` Map column (the previous
           * approach, still baked into older stored dashboard configs)
           * fragments the result into one series per unique attribute
           * combination — for percentiles of histogram metrics that
           * collapses every sub-series onto a near-constant bucket
           * midpoint and renders as flat straight lines — so any legacy
           * `attributes` entry in groupBy is stripped when key-scoped
           * grouping is active.
           */
          const groupByAttributeKeys: Array<string> =
            queryConfig.metricQueryData.groupByAttributeKeys || [];
          const hasGroupByAttributes: boolean = groupByAttributeKeys.length > 0;

          let aggregationGroupBy: typeof queryConfig.metricQueryData.groupBy =
            queryConfig.metricQueryData.groupBy;

          if (hasGroupByAttributes && aggregationGroupBy) {
            const strippedGroupBy: Record<string, unknown> = {
              ...(aggregationGroupBy as Record<string, unknown>),
            };
            delete strippedGroupBy["attributes"];
            aggregationGroupBy =
              Object.keys(strippedGroupBy).length > 0
                ? (strippedGroupBy as typeof queryConfig.metricQueryData.groupBy)
                : undefined;
          }

          /*
           * Server-side Top-K for grouped queries: only the top-N groups
           * (ranked by max over the window) are fetched, instead of every
           * bucket of every group. The effective N comes from a transient
           * per-query override (set by chart controls that can't write the
           * view config) falling back to the persisted `topN` and then —
           * only for callers that opted in via `defaultTopN` — the default
           * cap; other callers get every group (undefined → no topK).
           * Ungrouped queries return a single series and skip topK
           * entirely. topK is part of the AggregateBy payload, so the
           * request cache/dedup key (buildAggregateCacheKey stringifies the
           * whole AggregateBy) busts automatically when it changes.
           */
          const queryTopN: number | undefined =
            topNOverrideByQueryKey.get(
              MetricUtil.getQueryConfigTopNKey(
                queryConfig,
                queryIndex,
                data.topNOverrideScope,
              ),
            ) ??
            queryConfig.metricQueryData.topN ??
            (data.defaultTopN ? DEFAULT_TOP_N_SERIES : undefined);

          return dedupedAggregate(
            {
              query: {
                projectId: ProjectUtil.getCurrentProjectId()!,
                time: metricViewData.startAndEndDate!,
                name: queryConfig.metricQueryData.filterData.metricName!,
                attributes: sanitizeAttributeFilters(
                  queryConfig.metricQueryData.filterData.attributes as
                    | Dictionary<DictionaryEntryValue>
                    | undefined,
                ) as any,
              },
              aggregationType:
                (queryConfig.metricQueryData.filterData
                  .aggegationType as MetricsAggregationType) ||
                MetricsAggregationType.Avg,
              aggregateColumnName: "value",
              aggregationTimestampColumnName: "time",
              ...(data.aggregationInterval
                ? { aggregationInterval: data.aggregationInterval }
                : {}),
              startTimestamp:
                (metricViewData.startAndEndDate?.startValue as Date) ||
                OneUptimeDate.getCurrentDate(),
              endTimestamp:
                (metricViewData.startAndEndDate?.endValue as Date) ||
                OneUptimeDate.getCurrentDate(),
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              groupBy: aggregationGroupBy,
              groupByAttributeKeys: hasGroupByAttributes
                ? groupByAttributeKeys
                : undefined,
              ...(hasGroupByAttributes && queryTopN !== undefined
                ? {
                    topK: {
                      count: queryTopN,
                      rankBy: "max" as const,
                    },
                  }
                : {}),
            } as AggregateBy<Metric>,
            cacheBustToken,
          );
        },
      ),
    );

    /*
     * Convert each query's values from the metric's native unit
     * (whatever OpenTelemetry reported in — e.g. bytes, seconds) into
     * the unit the user configured on the query alias (e.g. GB, ms).
     * This is what lets a formula like `mem_used + disk_free` — where
     * both are configured as GB — operate on GB-scale numbers instead
     * of raw bytes.
     *
     * Skipped silently when we don't know the native unit (MetricType
     * missing) or when units are already the same / incompatible.
     */
    const metricTypes: Array<MetricType> =
      data.metricTypes ??
      (await MetricUtil.loadAllMetricsTypes({ includeAttributes: false }))
        .metricTypes;

    const nativeUnitsByMetricName: Map<string, string> = new Map<
      string,
      string
    >();
    for (const metricType of metricTypes) {
      if (metricType.name && metricType.unit) {
        nativeUnitsByMetricName.set(
          metricType.name.toLowerCase(),
          metricType.unit,
        );
      }
    }

    const results: Array<AggregatedResult> =
      MetricResultUnitConverter.convertQueryResultsToDisplayUnit({
        queryConfigs: metricViewData.queryConfigs,
        results: rawResults,
        nativeUnitByMetricName: nativeUnitsByMetricName,
      });

    /*
     * Round to four decimal places to keep the JSON payload compact
     * without clobbering sub-percent precision. Two decimals was too
     * aggressive for fraction-scale metrics (system.*.utilization lives
     * in [0, 1]): a real value of 0.0585 rounded to 0.06 and rendered as
     * "6.00%" instead of "5.85%". Four decimals preserves percent-level
     * precision for ratios and is more than enough for converted values
     * like 13.9234 GB (which the formatter clips back to "13.9 GB").
     */
    for (const result of results) {
      for (const row of result.data as Array<AggregatedModel>) {
        if (typeof row.value === "number" && Number.isFinite(row.value)) {
          row.value = Math.round(row.value * 10000) / 10000;
        }
      }
    }

    /*
     * Evaluate formulas against the just-converted query results. Each
     * formula can reference prior formulas (e.g. formula B can use A),
     * so build up the result array incrementally and let downstream
     * formulas see earlier ones through MetricFormulaEvaluator.
     */
    const formulaConfigs: Array<MetricFormulaConfigData> =
      metricViewData.formulaConfigs || [];

    for (let index: number = 0; index < formulaConfigs.length; index++) {
      const formulaConfig: MetricFormulaConfigData = formulaConfigs[index]!;
      const formula: string =
        formulaConfig.metricFormulaData?.metricFormula || "";

      if (!formula.trim()) {
        results.push({ data: [] });
        continue;
      }

      try {
        const formulaResult: AggregatedResult =
          MetricFormulaEvaluator.evaluateFormula({
            formula,
            queryConfigs: metricViewData.queryConfigs,
            formulaConfigs: formulaConfigs.slice(0, index),
            results,
          });
        results.push(formulaResult);
      } catch (err: unknown) {
        /*
         * Structurally invalid formula (bad syntax/arity, unknown
         * variable, disjoint groups — MetricFormulaEvaluator throws
         * BadDataException). Surface the message on the result so the
         * chart slot renders the actual error instead of a silent
         * "No data", without breaking the whole fetch.
         */
        results.push({
          data: [],
          errorMessage:
            err instanceof Error && err.message
              ? err.message
              : "Invalid formula.",
        });
      }
    }

    return results;
  }

  /**
   * Fetch backend-aggregated time series for many metric names in
   * parallel. Used by the metrics list sparklines, which previously
   * paged the raw `Metric` table with `limit: 5000` — fine for low-
   * cardinality data but truncated to the first few minutes for hosts
   * that emit per-attribute-combo rows (process.* and system.* metrics
   * fan out to thousands of rows per scrape, easily exceeding 100k
   * rows/hour for one host). Truncation made the right side of every
   * sparkline flatline at 0.
   *
   * Switching to the aggregate API delegates the per-bucket Avg to
   * ClickHouse — at most a few-dozen rows come back per metric, and
   * for the canonical host page (only `resource.host.name` filter,
   * no group-by) MetricService routes the read to the per-host MV.
   * dedupedAggregate also makes the cache hot when the user clicks
   * a row and the explorer immediately re-issues the same query.
   */
  public static async fetchSparklineAggregates(data: {
    metricNames: Array<string>;
    attributes?: Dictionary<DictionaryEntryValue> | undefined;
    startAndEndDate: InBetween<Date>;
  }): Promise<Map<string, AggregatedResult>> {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId || data.metricNames.length === 0) {
      return new Map();
    }

    const startTimestamp: Date = data.startAndEndDate.startValue as Date;
    const endTimestamp: Date = data.startAndEndDate.endValue as Date;

    const sanitizedAttributes: Dictionary<DictionaryEntryValue> | undefined =
      sanitizeAttributeFilters(data.attributes);

    const results: Array<[string, AggregatedResult]> = await Promise.all(
      data.metricNames.map(
        async (name: string): Promise<[string, AggregatedResult]> => {
          try {
            const result: AggregatedResult = await dedupedAggregate({
              query: {
                projectId,
                time: data.startAndEndDate,
                name,
                ...(sanitizedAttributes
                  ? { attributes: sanitizedAttributes as any }
                  : {}),
              },
              aggregationType: MetricsAggregationType.Avg,
              aggregateColumnName: "value",
              aggregationTimestampColumnName: "time",
              startTimestamp,
              endTimestamp,
              limit: LIMIT_PER_PROJECT,
              skip: 0,
            } as AggregateBy<Metric>);
            return [name, result];
          } catch {
            return [name, { data: [] }];
          }
        },
      ),
    );

    return new Map(results);
  }

  /**
   * Stable key identifying a query for the transient Top-N override
   * registry. Prefers the query's persistent `id`, then its metric
   * variable (unique within a view and stable across removal/reorder),
   * then falls back to the array position. The optional `scope`
   * namespaces the key to one host instance (e.g. a dashboard widget's
   * componentId) — id-less configs fall back to variable/position keys
   * that COLLIDE across widgets (every default widget query is "var-a"),
   * so an unscoped override written by one widget would leak into every
   * other. Must stay consistent between the chart layer (which writes
   * overrides) and fetchResults (which reads them).
   */
  public static getQueryConfigTopNKey(
    queryConfig: MetricQueryConfigData,
    queryIndex: number,
    scope?: string | undefined,
  ): string {
    const scopePrefix: string = scope ? `${scope}:` : "";
    if (queryConfig.id) {
      return `${scopePrefix}id-${queryConfig.id}`;
    }
    const metricVariable: string | undefined =
      queryConfig.metricAliasData?.metricVariable;
    if (metricVariable) {
      return `${scopePrefix}var-${metricVariable}`;
    }
    return `${scopePrefix}index-${queryIndex}`;
  }

  /**
   * Set (or clear, with `undefined`) a transient Top-N override for a
   * query. Applied by the NEXT fetchResults call for that query — used
   * by chart surfaces that cannot write `metricQueryData.topN` back
   * into the view config.
   */
  public static setQueryTopNOverride(
    queryKey: string,
    topN: number | undefined,
  ): void {
    if (topN === undefined) {
      topNOverrideByQueryKey.delete(queryKey);
      return;
    }
    topNOverrideByQueryKey.set(queryKey, topN);
  }

  /**
   * Drop every transient Top-N override registered under a host scope.
   * Called on host unmount so a widget's "Show all" / Top-N choices
   * don't outlive it (the registry is module-global and would otherwise
   * keep applying them for the whole SPA session).
   */
  public static clearQueryTopNOverridesForScope(scope: string): void {
    const prefix: string = `${scope}:`;
    for (const key of Array.from(topNOverrideByQueryKey.keys())) {
      if (key.startsWith(prefix)) {
        topNOverrideByQueryKey.delete(key);
      }
    }
  }

  /**
   * Stable serialization of a query's sanitized attribute filters, for
   * composite cache/state keys (exemplars are fetched per metric name +
   * filter set). Top-level keys are sorted so two logically-equal filter
   * dictionaries always produce the same key; operator wrappers
   * (NotEqual, Includes, …) serialize via their toJSON.
   */
  public static serializeAttributeFiltersForKey(
    attributes: Dictionary<DictionaryEntryValue> | undefined,
  ): string {
    if (!attributes) {
      return "";
    }
    const sortedKeys: Array<string> = Object.keys(attributes).sort();
    return JSON.stringify(
      sortedKeys.map((key: string) => {
        return [key, attributes[key]];
      }),
    );
  }

  /**
   * Fetch exemplar data points for a metric - these are raw metric rows
   * that have an associated traceId from OTLP exemplars. Scoped to the
   * calling query's (sanitized) attribute filters and time window so the
   * dots on a filtered chart come from the rows that chart is actually
   * plotting.
   */
  public static async fetchExemplars(data: {
    metricName: string;
    startAndEndDate: InBetween<Date>;
    attributes?: Dictionary<DictionaryEntryValue> | undefined;
  }): Promise<Array<ExemplarPoint>> {
    if (getPublicDashboardContext()) {
      /*
       * Exemplars link to private trace views an anonymous public-dashboard
       * viewer cannot open, and the underlying raw-metric read is a private
       * route (whose 401 would redirect to /accounts/login). Skip them.
       */
      return [];
    }

    const sanitizedAttributes: Dictionary<DictionaryEntryValue> | undefined =
      sanitizeAttributeFilters(data.attributes);

    try {
      const result: ListResult<Metric> = await AnalyticsModelAPI.getList({
        modelType: Metric,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          name: data.metricName,
          time: data.startAndEndDate,
          /*
           * Only rows that actually carry an exemplar. NotEqual('')
           * excludes both NULL and '' under ClickHouse comparison
           * semantics and survives the client→server JSON revival —
           * unlike NotNull, which the analytics statement generator has
           * no scalar branch for.
           */
          traceId: new NotEqual<string>(""),
          ...(sanitizedAttributes
            ? { attributes: sanitizedAttributes as any }
            : {}),
        } as any,
        select: {
          time: true,
          value: true,
          traceId: true,
          spanId: true,
        } as any,
        sort: {
          time: SortOrder.Descending,
        } as any,
        limit: 50, // Limit exemplar dots to keep charts readable
        skip: 0,
      });

      const exemplars: Array<ExemplarPoint> = [];

      for (const metric of result.data) {
        const traceId: string | undefined = metric.traceId;

        if (!traceId) {
          continue;
        }

        const time: Date | undefined = metric.time;
        const value: number | undefined = metric.value;

        if (!time || value === undefined || value === null) {
          continue;
        }

        exemplars.push({
          x: time,
          y: value,
          traceId: traceId,
          spanId: metric.spanId || undefined,
        });
      }

      return exemplars;
    } catch {
      // Exemplar fetching is best-effort, don't break the main chart
      return [];
    }
  }

  public static async loadAllMetricsTypes(options?: {
    includeAttributes?: boolean;
  }): Promise<{
    metricTypes: Array<MetricType>;
    telemetryAttributes: Array<string>;
    telemetryAttributesError?: string;
  }> {
    const includeAttributes: boolean = options?.includeAttributes ?? true;

    const publicContext: PublicDashboardContext | null =
      getPublicDashboardContext();
    if (publicContext) {
      /*
       * Public dashboards are read-only. Telemetry attribute autocomplete is
       * only used by the edit UI, so it is intentionally skipped here.
       */
      const publicMetricTypes: Array<MetricType> =
        await fetchPublicMetricTypes(publicContext);

      return {
        metricTypes: publicMetricTypes,
        telemetryAttributes: [],
      };
    }

    const metrics: ListResult<MetricType> = await ModelAPI.getList({
      modelType: MetricType,
      select: {
        name: true,
        unit: true,
        /*
         * Counter semantics (denormalized at ingest) — lets the query
         * editor suggest the per-second rate transform for cumulative
         * monotonic counters.
         */
        isMonotonic: true,
        aggregationTemporality: true,
      },
      query: {
        projectId: ProjectUtil.getCurrentProjectId()!,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      sort: {
        name: SortOrder.Ascending,
      },
    });

    const metricTypes: Array<MetricType> = metrics.data;

    let telemetryAttributes: Array<string> = [];
    let telemetryAttributesError: string | undefined;

    if (includeAttributes) {
      try {
        telemetryAttributes = await MetricUtil.getTelemetryAttributes();
      } catch (err) {
        telemetryAttributesError = API.getFriendlyErrorMessage(err as Error);
      }
    }

    return {
      metricTypes: metricTypes,
      telemetryAttributes,
      ...(telemetryAttributesError !== undefined
        ? { telemetryAttributesError }
        : {}),
    };
  }

  public static async getTelemetryAttributes(data?: {
    metricName?: string | undefined;
  }): Promise<Array<string>> {
    const metricAttributesResponse:
      | HTTPResponse<JSONObject>
      | HTTPErrorResponse = await API.post({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        "/telemetry/metrics/get-attributes",
      ),
      data: data?.metricName ? { metricName: data.metricName } : {},
      headers: {
        ...AnalyticsModelAPI.getCommonHeaders(),
      },
    });

    if (metricAttributesResponse instanceof HTTPErrorResponse) {
      throw metricAttributesResponse;
    }

    return (metricAttributesResponse.data["attributes"] || []) as Array<string>;
  }

  public static async getTelemetryAttributeValues(data: {
    attributeKey: string;
    metricName?: string | undefined;
    searchText?: string | undefined;
  }): Promise<Array<string>> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          "/telemetry/metrics/get-attribute-values",
        ),
        data: {
          attributeKey: data.attributeKey,
          ...(data.metricName ? { metricName: data.metricName } : {}),
          ...(data.searchText && data.searchText.trim().length > 0
            ? { searchText: data.searchText.trim() }
            : {}),
        },
        headers: {
          ...AnalyticsModelAPI.getCommonHeaders(),
        },
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return (response.data["values"] || []) as Array<string>;
  }
}
