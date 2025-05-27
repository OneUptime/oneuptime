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
import Dictionary from "Common/Types/Dictionary";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import OneUptimeDate from "Common/Types/Date";
import ProjectUtil from "Common/UI/Utils/Project";
import MetricType from "Common/Models/DatabaseModels/MetricType";

export default class MetricUtil {
  public static async fetchResults(data: {
    metricViewData: MetricViewData;
  }): Promise<Array<AggregatedResult>> {
    const results: Array<AggregatedResult> = [];

    const metricViewData: MetricViewData = data.metricViewData;

    for (const queryConfig of metricViewData.queryConfigs) {
      const result: AggregatedResult = await AnalyticsModelAPI.aggregate({
        modelType: Metric,
        aggregateBy: {
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
            time: metricViewData.startAndEndDate!,
            name: queryConfig.metricQueryData.filterData.metricName!,
            attributes: queryConfig.metricQueryData.filterData
              .attributes as Dictionary<string | number | boolean>,
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

      result.data.map((data: AggregatedModel) => {
        // convert to int from float

        if (data.value) {
          data.value = Math.round(data.value);
        }

        return data;
      });

      results.push(result);
    }

    return results;
  }

  public static async loadAllMetricsTypes(): Promise<{
    metricTypes: Array<MetricType>;
    telemetryAttributes: Array<string>;
  }> {
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

    const metricAttributesResponse:
      | HTTPResponse<JSONObject>
      | HTTPErrorResponse = await API.post(
      URL.fromString(APP_API_URL.toString()).addRoute(
        "/telemetry/metrics/get-attributes",
      ),
      {},
      {
        ...AnalyticsModelAPI.getCommonHeaders(),
      },
    );

    let attributes: Array<string> = [];

    if (metricAttributesResponse instanceof HTTPErrorResponse) {
      throw metricAttributesResponse;
    } else {
      attributes = metricAttributesResponse.data["attributes"] as Array<string>;
    }

    return {
      metricTypes: metricTypes,
      telemetryAttributes: attributes,
    };
  }
}
