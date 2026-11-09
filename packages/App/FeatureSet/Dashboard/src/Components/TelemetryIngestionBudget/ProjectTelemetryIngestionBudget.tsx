import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  TELEMETRY_INGESTION_BUDGET_PROJECT_ROUTE,
  TelemetryIngestionBudgetSignal,
  TelemetryIngestionBudgetStatus,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionBudgetBanner from "Common/UI/Components/TelemetryIngestionBudget/TelemetryIngestionBudgetBanner";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Dashboard's side of telemetry ingestion budgets: reading the current
 * project's budgets today (GET /telemetry-ingestion-budget/project, as the
 * caller may read them), and the banner each explorer shows above its data
 * while its signal's budget is past its warning or used up.
 */

export const fetchProjectTelemetryIngestionBudgetStatus: () => Promise<TelemetryIngestionBudgetStatus> =
  async (): Promise<TelemetryIngestionBudgetStatus> => {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          TELEMETRY_INGESTION_BUDGET_PROJECT_ROUTE,
        ),
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse || response.isFailure()) {
      throw response;
    }

    return response.data as unknown as TelemetryIngestionBudgetStatus;
  };

// Where the budgets are shown in full: Project Settings > Telemetry & APM > Usage.
export const getTelemetryIngestionBudgetsRoute: () => Route = (): Route => {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.SETTINGS_USAGE_HISTORY] as Route,
  );
};

export interface ExplorerBannerProps {
  signal: TelemetryIngestionBudgetSignal;
}

// The explorers' banner, reading the current project's budgets.
export const TelemetryIngestionBudgetExplorerBanner: FunctionComponent<
  ExplorerBannerProps
> = (props: ExplorerBannerProps): ReactElement => {
  return (
    <TelemetryIngestionBudgetBanner
      signal={props.signal}
      fetchStatus={fetchProjectTelemetryIngestionBudgetStatus}
      budgetsRoute={getTelemetryIngestionBudgetsRoute()}
    />
  );
};
