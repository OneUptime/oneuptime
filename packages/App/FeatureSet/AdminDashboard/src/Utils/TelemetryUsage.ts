import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE,
  TelemetryProjectUsagePage,
  TelemetryProjectUsageSortBy,
  TelemetryUsageRange,
  TelemetryUsageSummary,
} from "Common/Types/Telemetry/TelemetryUsage";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";

/*
 * The Admin Dashboard's telemetry usage reads, as the master admin: every
 * project's usage over a range (Telemetry Usage), and one project's
 * (Projects > a project > Telemetry Usage). Both from the staged usage
 * rows, with billing on or off (Common/Server/API/TelemetryUsageAPI).
 */

const getJson: (url: URL) => Promise<JSONObject> = async (
  url: URL,
): Promise<JSONObject> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({ url: url });

  if (response instanceof HTTPErrorResponse || response.isFailure()) {
    throw response;
  }

  return response.data;
};

export const fetchUsageByProject: (data: {
  range: TelemetryUsageRange;
  sortBy: TelemetryProjectUsageSortBy;
  sortOrder: "asc" | "desc";
  skip: number;
  limit: number;
}) => Promise<TelemetryProjectUsagePage> = async (data: {
  range: TelemetryUsageRange;
  sortBy: TelemetryProjectUsageSortBy;
  sortOrder: "asc" | "desc";
  skip: number;
  limit: number;
}): Promise<TelemetryProjectUsagePage> => {
  return (await getJson(
    URL.fromString(APP_API_URL.toString())
      .addRoute(TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE)
      .addQueryParams({
        startDay: data.range.startDay,
        endDay: data.range.endDay,
        sortBy: data.sortBy,
        sortOrder: data.sortOrder,
        skip: String(data.skip),
        limit: String(data.limit),
      }),
  )) as unknown as TelemetryProjectUsagePage;
};

export const fetchProjectUsage: (data: {
  projectId: ObjectID;
  range: TelemetryUsageRange;
}) => Promise<TelemetryUsageSummary> = async (data: {
  projectId: ObjectID;
  range: TelemetryUsageRange;
}): Promise<TelemetryUsageSummary> => {
  return (await getJson(
    URL.fromString(APP_API_URL.toString())
      .addRoute(
        `${TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE}/${data.projectId.toString()}`,
      )
      .addQueryParams({
        startDay: data.range.startDay,
        endDay: data.range.endDay,
      }),
  )) as unknown as TelemetryUsageSummary;
};
