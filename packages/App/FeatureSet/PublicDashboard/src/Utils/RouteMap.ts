import DashboardInTab from "./DashboardInTab";
import PageMap from "./PageMap";
import {
  PUBLIC_DASHBOARD_FORGOT_PASSWORD_PATH,
  PUBLIC_DASHBOARD_RESET_PASSWORD_PATH,
  PUBLIC_DASHBOARD_SIGN_IN_PATH,
} from "./PublicDashboard";
import RouteParams from "./RouteParams";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";

const RouteMap: Dictionary<Route> = {
  [PageMap.OVERVIEW]: new Route(`/`),
  [PageMap.NOT_FOUND]: new Route(`/not-found`),
  [PageMap.FORBIDDEN]: new Route(`/forbidden`),
  [PageMap.MASTER_PASSWORD]: new Route(`/master-password`),
  // A dashboard that asks its visitors to sign in (#10250).
  [PageMap.SIGN_IN]: new Route(PUBLIC_DASHBOARD_SIGN_IN_PATH),
  [PageMap.FORGOT_PASSWORD]: new Route(PUBLIC_DASHBOARD_FORGOT_PASSWORD_PATH),
  [PageMap.RESET_PASSWORD]: new Route(
    `${PUBLIC_DASHBOARD_RESET_PASSWORD_PATH}/:token`,
  ),

  // Preview routes
  [PageMap.PREVIEW_OVERVIEW]: new Route(
    `/public-dashboard/${RouteParams.DashboardId}`,
  ),
  [PageMap.PREVIEW_FORBIDDEN]: new Route(
    `/public-dashboard/${RouteParams.DashboardId}/forbidden`,
  ),
  [PageMap.PREVIEW_MASTER_PASSWORD]: new Route(
    `/public-dashboard/${RouteParams.DashboardId}/master-password`,
  ),
  [PageMap.PREVIEW_SIGN_IN]: new Route(
    `/public-dashboard/${RouteParams.DashboardId}${PUBLIC_DASHBOARD_SIGN_IN_PATH}`,
  ),
  [PageMap.PREVIEW_FORGOT_PASSWORD]: new Route(
    `/public-dashboard/${RouteParams.DashboardId}${PUBLIC_DASHBOARD_FORGOT_PASSWORD_PATH}`,
  ),
  [PageMap.PREVIEW_RESET_PASSWORD]: new Route(
    `/public-dashboard/${RouteParams.DashboardId}${PUBLIC_DASHBOARD_RESET_PASSWORD_PATH}/:token`,
  ),
};

export class RouteUtil {
  /*
   * A route of this app with its ids filled in: the record's, and the
   * dashboard's - the one this tab shows, never one another tab opened since.
   */
  public static populateRouteParams(route: Route, modelId?: ObjectID): Route {
    const tempRoute: Route = new Route(route.toString());

    if (modelId) {
      route = tempRoute.addRouteParam(RouteParams.ModelID, modelId.toString());
    }

    const id: ObjectID | null = DashboardInTab.get();

    if (id) {
      route = tempRoute.addRouteParam(RouteParams.DashboardId, id.toString());
    }

    return tempRoute;
  }
}

export default RouteMap;
