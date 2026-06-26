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
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricFormulaEvaluator from "Common/Utils/Metrics/MetricFormulaEvaluator";
import MetricResultUnitConverter from "Common/Utils/Metrics/MetricResultUnitConverter";
import Dictionary from "Common/Types/Dictionary";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
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
): Promise<AggregatedResult> {
  const cacheKey: string = buildAggregateCacheKey(aggregateBy);

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
  }): Promise<Array<AggregatedResult>> {
    const metricViewData: MetricViewData = data.metricViewData;

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
      metricViewData.queryConfigs.map((queryConfig: MetricQueryConfigData) => {
        /*
         * Per-series viewing: when the user has selected attribute
         * keys to group by (e.g. host.name), inject the nested
         * `attributes` column into the aggregation's GROUP BY so
         * ClickHouse emits one row per unique attribute map. The
         * chart layer then splits those rows into one line per
         * unique label combination via `getSeries` (injected in
         * MetricView before render).
         */
        const hasGroupByAttributes: boolean = Boolean(
          queryConfig.metricQueryData.groupByAttributeKeys &&
            queryConfig.metricQueryData.groupByAttributeKeys.length > 0,
        );

        const aggregationGroupBy: typeof queryConfig.metricQueryData.groupBy =
          hasGroupByAttributes
            ? ({
                ...(queryConfig.metricQueryData.groupBy || {}),
                attributes: true,
              } as typeof queryConfig.metricQueryData.groupBy)
            : queryConfig.metricQueryData.groupBy;

        return dedupedAggregate({
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
          startTimestamp:
            (metricViewData.startAndEndDate?.startValue as Date) ||
            OneUptimeDate.getCurrentDate(),
          endTimestamp:
            (metricViewData.startAndEndDate?.endValue as Date) ||
            OneUptimeDate.getCurrentDate(),
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          groupBy: aggregationGroupBy,
        } as AggregateBy<Metric>);
      }),
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
      } catch {
        /*
         * Invalid formula — surface an empty series so the chart shows
         * "No data" rather than breaking the whole fetch.
         */
        results.push({ data: [] });
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
   * Fetch exemplar data points for a metric - these are raw metric rows
   * that have an associated traceId from OTLP exemplars.
   */
  public static async fetchExemplars(data: {
    metricName: string;
    startAndEndDate: InBetween<Date>;
  }): Promise<Array<ExemplarPoint>> {
    if (getPublicDashboardContext()) {
      /*
       * Exemplars link to private trace views an anonymous public-dashboard
       * viewer cannot open, and the underlying raw-metric read is a private
       * route (whose 401 would redirect to /accounts/login). Skip them.
       */
      return [];
    }

    try {
      const result: ListResult<Metric> = await AnalyticsModelAPI.getList({
        modelType: Metric,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          name: data.metricName,
          time: data.startAndEndDate,
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
