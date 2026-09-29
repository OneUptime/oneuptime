import API from "./API";
import { PUBLIC_DASHBOARD_API_URL } from "./Config";
import { PublicDashboardContext } from "../../../Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

export default class PublicDashboardWidgetContext {
  /*
   * The context the public dashboard page registers for the shared Dashboard
   * widgets, which it renders with no session and no current project.
   *
   * It routes their reads to the public, dashboard-scoped endpoints under
   * /public-dashboard-api; without it they fall through to the private /api
   * routes, which 401 for an anonymous viewer (issue #2467). Every read goes
   * through THIS app's API client - `postJSON` for the metric widgets,
   * `apiClient` for the ModelAPI / AnalyticsModelAPI list widgets (incident,
   * alert, monitor, host, log, trace, SLO, infrastructure) - so a 401 lands
   * on the master-password page. The dashboard client would instead refresh
   * a session the viewer does not have (a failed refresh clears every cookie
   * on the host, the master-password cookie included), call User.logout() -
   * ending the session of a viewer also signed in to the dashboard - and
   * send the viewer to /accounts/login.
   */
  public static build(dashboardId: ObjectID): PublicDashboardContext {
    return {
      dashboardId: dashboardId,
      apiUrl: PUBLIC_DASHBOARD_API_URL,
      apiClient: API,
      postJSON: (
        route: string,
        data: JSONObject,
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        return API.post<JSONObject>({
          url: URL.fromString(PUBLIC_DASHBOARD_API_URL.toString()).addRoute(
            route,
          ),
          data,
        });
      },
    };
  }
}
