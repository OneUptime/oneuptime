import Metric from "Common/Models/AnalyticsModels/Metric";
import ModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import DashboardNavigation from "../../../Utils/Navigation";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import MetricNameAndUnit from "../Types/MetricNameAndUnit";
import ListResult from "Common/UI/Utils/BaseDatabase/ListResult";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";

export default class MetricUtil {
  public static async loadAllMetricsTypes(): Promise<{
    metricNamesAndUnits: Array<MetricNameAndUnit>;
    telemetryAttributes: Array<string>;
  }> {
    const metrics: ListResult<Metric> = await ModelAPI.getList({
      modelType: Metric,
      select: {
        name: true,
        unit: true,
      },
      query: {
        projectId: DashboardNavigation.getProjectId()!,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      sort: {
        name: SortOrder.Ascending,
      },
      groupBy: {
        name: true,
        unit: true,
      },
    });

    const metricNamesAndUnits: Array<MetricNameAndUnit> = metrics.data.map(
      (metric: Metric) => {
        return {
          metricName: metric.name || "",
          unit: metric.unit || "",
        };
      },
    );

    // Remove duplicate names from the array

    const uniqueMetricNamesAndUnits: Array<MetricNameAndUnit> = [];

    metricNamesAndUnits.forEach((metricNameAndUnit: MetricNameAndUnit) => {
      if (
        !uniqueMetricNamesAndUnits.find((m: MetricNameAndUnit) => {
          return m.metricName === metricNameAndUnit.metricName;
        })
      ) {
        uniqueMetricNamesAndUnits.push(metricNameAndUnit);
      }
    });

    const metricAttributesResponse:
      | HTTPResponse<JSONObject>
      | HTTPErrorResponse = await API.post(
      URL.fromString(APP_API_URL.toString()).addRoute(
        "/telemetry/metrics/get-attributes",
      ),
      {},
      {
        ...ModelAPI.getCommonHeaders(),
      },
    );

    let attributes: Array<string> = [];

    if (metricAttributesResponse instanceof HTTPErrorResponse) {
      throw metricAttributesResponse;
    } else {
      attributes = metricAttributesResponse.data["attributes"] as Array<string>;
    }

    return {
      metricNamesAndUnits: uniqueMetricNamesAndUnits,
      telemetryAttributes: attributes,
    };
  }
}
