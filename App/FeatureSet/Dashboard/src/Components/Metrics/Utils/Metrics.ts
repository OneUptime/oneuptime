import Metric from "Common/Models/AnalyticsModels/Metric";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import OneUptimeDate from "Common/Types/Date";
import ProjectUtil from "Common/UI/Utils/Project";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import ExemplarPoint from "Common/UI/Components/Charts/Types/ExemplarPoint";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricFormulaEvaluator from "Common/Utils/Metrics/MetricFormulaEvaluator";
import MetricResultUnitConverter from "Common/Utils/Metrics/MetricResultUnitConverter";
import Dictionary from "Common/Types/Dictionary";
import {
  DictionaryEntryValue,
  DictionaryFilterOperator,
  DictionaryFilterOperatorOption,
  detectOperatorFromValue,
  getOperatorOption,
} from "Common/UI/Components/Dictionary/DictionaryFilterOperator";

type SanitizeAttributeFiltersFunction = (
  attributes: Dictionary<DictionaryEntryValue> | undefined,
) => Dictionary<DictionaryEntryValue> | undefined;

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

        return AnalyticsModelAPI.aggregate({
          modelType: Metric,
          aggregateBy: {
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
          },
        });
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
     * Round to two decimal places for display. The old code used plain
     * Math.round, but after unit conversion (bytes → GB) the interesting
     * precision lives in the decimals — so keep two places.
     */
    for (const result of results) {
      for (const row of result.data as Array<AggregatedModel>) {
        if (typeof row.value === "number" && Number.isFinite(row.value)) {
          row.value = Math.round(row.value * 100) / 100;
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
   * Fetch exemplar data points for a metric - these are raw metric rows
   * that have an associated traceId from OTLP exemplars.
   */
  public static async fetchExemplars(data: {
    metricName: string;
    startAndEndDate: InBetween<Date>;
  }): Promise<Array<ExemplarPoint>> {
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

  /*
   * Per-process result cache for the two metadata calls. Metric types and
   * telemetry attributes change rarely (a new metric ingest, a deploy
   * adding a new attribute) but this method is called on every dashboard
   * mount and on every metric explorer open. Caching for a short window
   * cuts repeated dashboard navigations from O(N round-trips) to O(1) —
   * by far the biggest win on dashboard TTI.
   */
  private static metadataCache: {
    expiresAt: number;
    metricTypes: Array<MetricType>;
    telemetryAttributes: Array<string>;
  } | null = null;

  private static metadataCacheKey: string | null = null;

  private static metadataInFlight: Promise<{
    metricTypes: Array<MetricType>;
    telemetryAttributes: Array<string>;
    telemetryAttributesError?: string;
  }> | null = null;

  public static invalidateMetricsMetadataCache(): void {
    MetricUtil.metadataCache = null;
    MetricUtil.metadataCacheKey = null;
    MetricUtil.metadataInFlight = null;
  }

  public static async loadAllMetricsTypes(options?: {
    includeAttributes?: boolean;
  }): Promise<{
    metricTypes: Array<MetricType>;
    telemetryAttributes: Array<string>;
    telemetryAttributesError?: string;
  }> {
    const includeAttributes: boolean = options?.includeAttributes ?? true;

    const projectId: string =
      ProjectUtil.getCurrentProjectId()?.toString() || "";
    /*
     * Cache key includes both the project (so switching projects invalidates)
     * and the includeAttributes flag (the no-attributes path returns less
     * data and should not poison the with-attributes cache).
     */
    const cacheKey: string = `${projectId}:${includeAttributes ? "1" : "0"}`;
    const cacheTtlMs: number = 60 * 1000; // 60 seconds

    if (
      MetricUtil.metadataCache !== null &&
      MetricUtil.metadataCacheKey === cacheKey &&
      MetricUtil.metadataCache.expiresAt > Date.now()
    ) {
      return {
        metricTypes: MetricUtil.metadataCache.metricTypes,
        telemetryAttributes: MetricUtil.metadataCache.telemetryAttributes,
      };
    }

    if (
      MetricUtil.metadataInFlight !== null &&
      MetricUtil.metadataCacheKey === cacheKey
    ) {
      return MetricUtil.metadataInFlight;
    }

    const fetchPromise: Promise<{
      metricTypes: Array<MetricType>;
      telemetryAttributes: Array<string>;
      telemetryAttributesError?: string;
    }> = (async (): Promise<{
      metricTypes: Array<MetricType>;
      telemetryAttributes: Array<string>;
      telemetryAttributesError?: string;
    }> => {
      /*
       * Fire the metric-type list and the attribute list in parallel.
       * Before this change they ran serially, doubling the time-to-first
       * chart on every dashboard load.
       */
      const [metricsResult, attributesResult] = await Promise.all([
        ModelAPI.getList({
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
        }),
        includeAttributes
          ? MetricUtil.getTelemetryAttributes().then(
              (attrs: Array<string>) => {
                return { ok: true as const, attrs };
              },
              (err: unknown) => {
                return {
                  ok: false as const,
                  error: API.getFriendlyErrorMessage(err as Error),
                };
              },
            )
          : Promise.resolve({ ok: true as const, attrs: [] as Array<string> }),
      ]);

      const metricTypes: Array<MetricType> = (
        metricsResult as ListResult<MetricType>
      ).data;
      const telemetryAttributes: Array<string> = attributesResult.ok
        ? attributesResult.attrs
        : [];
      const telemetryAttributesError: string | undefined = attributesResult.ok
        ? undefined
        : attributesResult.error;

      MetricUtil.metadataCache = {
        expiresAt: Date.now() + cacheTtlMs,
        metricTypes,
        telemetryAttributes,
      };
      MetricUtil.metadataCacheKey = cacheKey;

      return {
        metricTypes,
        telemetryAttributes,
        ...(telemetryAttributesError !== undefined
          ? { telemetryAttributesError }
          : {}),
      };
    })();

    MetricUtil.metadataCacheKey = cacheKey;
    MetricUtil.metadataInFlight = fetchPromise;
    try {
      return await fetchPromise;
    } finally {
      /*
       * Clear the in-flight slot once settled so transient failures
       * don't permanently block retries.
       */
      if (MetricUtil.metadataInFlight === fetchPromise) {
        MetricUtil.metadataInFlight = null;
      }
    }
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
  }): Promise<Array<string>> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          "/telemetry/metrics/get-attribute-values",
        ),
        data: {
          attributeKey: data.attributeKey,
          ...(data.metricName ? { metricName: data.metricName } : {}),
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
