import PageMap from "./PageMap";
import RouteParams from "./RouteParams";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import LocalStorage from "Common/UI/Utils/LocalStorage";

const RouteMap: Dictionary<Route> = {
  [PageMap.OVERVIEW]: new Route(`/`),
  [PageMap.NOT_FOUND]: new Route(`/not-found`),
  [PageMap.FORBIDDEN]: new Route(`/forbidden`),
  [PageMap.MASTER_PASSWORD]: new Route(`/master-password`),

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
};

export class RouteUtil {
  public static populateRouteParams(route: Route, modelId?: ObjectID): Route {
    const tempRoute: Route = new Route(route.toString());

    if (modelId) {
      route = tempRoute.addRouteParam(RouteParams.ModelID, modelId.toString());
    }

    const id: ObjectID = LocalStorage.getItem("dashboardId") as ObjectID;

    if (id) {
      route = tempRoute.addRouteParam(
        RouteParams.DashboardId,
        id.toString(),
      );
    }

    return tempRoute;
  }
}

export default RouteMap;
