import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ActiveMonitorLimitUtil, {
  ActiveMonitorLimitStatus,
} from "Common/Types/Monitor/ActiveMonitorLimit";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * Reading a project's active monitor limit, apart from the notice that draws
 * it (ActiveMonitorLimitNotice.tsx). This file imports no React, so modules
 * App's tests load - DiscoveryImportProjectFacts among them - can use it:
 * App installs no React, so its tsc and jest cannot follow an import into a
 * Dashboard file that imports "react".
 */

export const ACTIVE_MONITOR_LIMIT_ROUTE: string =
  "/monitor/active-monitor-limit";

// The project's limit and, when it has one, how many active monitors it has.
export const fetchActiveMonitorLimitStatus: () => Promise<ActiveMonitorLimitStatus> =
  async (): Promise<ActiveMonitorLimitStatus> => {
    const response: HTTPResponse<JSONObject> = (await API.get<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        ACTIVE_MONITOR_LIMIT_ROUTE,
      ),
      headers: ModelAPI.getCommonHeaders(),
    })) as HTTPResponse<JSONObject>;

    return ActiveMonitorLimitUtil.fromJSON(response.data);
  };
