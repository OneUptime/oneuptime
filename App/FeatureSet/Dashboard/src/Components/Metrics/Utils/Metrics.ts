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

export default class MetricUtil {
  public static async fetchResults(data: {
    metricViewData: MetricViewData;
  }): Promise<Array<AggregatedResult>> {
    const metricViewData: MetricViewData = data.metricViewData;

    /*
     * Fire all aggregate queries in parallel. Kubernetes overview pages
     * render many charts (CPU/memory/network/etc.), and fetching them
     * sequentially made page load O(N * perQueryLatency). With Promise.all
     * it becomes O(max(perQueryLatency)).
     */
    const results: Array<AggregatedResult> = await Promise.all(
      metricViewData.queryConfigs.map((queryConfig: MetricQueryConfigData) => {
        return AnalyticsModelAPI.aggregate({
          modelType: Metric,
          aggregateBy: {
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
              time: metricViewData.startAndEndDate!,
              name: queryConfig.metricQueryData.filterData.metricName!,
              attributes: queryConfig.metricQueryData.filterData
                .attributes as any,
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
            groupBy: queryConfig.metricQueryData.groupBy,
          },
        });
      }),
    );

    for (const result of results) {
      for (const row of result.data as Array<AggregatedModel>) {
        if (row.value) {
          row.value = Math.round(row.value);
        }
      }
    }

    /*
     * Evaluate formulas against the just-fetched query results. Each
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
        // Invalid formula — surface an empty series so the chart shows
        // "No data" rather than breaking the whole fetch.
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

  public static async loadAllMetricsTypes(options?: {
    includeAttributes?: boolean;
  }): Promise<{
    metricTypes: Array<MetricType>;
    telemetryAttributes: Array<string>;
    telemetryAttributesError?: string;
  }> {
    const includeAttributes: boolean = options?.includeAttributes ?? true;

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
