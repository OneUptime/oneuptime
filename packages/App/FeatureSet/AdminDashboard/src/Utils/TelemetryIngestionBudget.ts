import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  TELEMETRY_INGESTION_BUDGET_ADMIN_PROJECTS_ROUTE,
  TelemetryIngestionBudgetStatus,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";

/*
 * The Admin Dashboard's ingestion budget read, as the master admin: one
 * project's budgets today, for Projects > a project > Ingestion Budgets
 * (Common/Server/API/TelemetryIngestionBudgetAPI).
 */
export const fetchProjectIngestionBudgetStatus: (
  projectId: ObjectID,
) => Promise<TelemetryIngestionBudgetStatus> = async (
  projectId: ObjectID,
): Promise<TelemetryIngestionBudgetStatus> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        `${TELEMETRY_INGESTION_BUDGET_ADMIN_PROJECTS_ROUTE}/${projectId.toString()}`,
      ),
    });

  if (response instanceof HTTPErrorResponse || response.isFailure()) {
    throw response;
  }

  return response.data as unknown as TelemetryIngestionBudgetStatus;
};
