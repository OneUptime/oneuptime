import PageMap from "./PageMap";
import RouteParams from "./RouteParams";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";

const RouteMap: Dictionary<Route> = {
  [PageMap.INIT]: new Route(`/admin`),
  [PageMap.HOME]: new Route(`/admin`),
  [PageMap.LOGOUT]: new Route(`/admin/logout`),
  [PageMap.SETTINGS]: new Route(`/admin/settings/host`),

  [PageMap.PROJECTS]: new Route(`/admin/projects`),
  [PageMap.PROJECT_VIEW]: new Route(`/admin/projects/${RouteParams.ModelID}`),
  [PageMap.PROJECT_DELETE]: new Route(
    `/admin/projects/${RouteParams.ModelID}/delete`,
  ),

  [PageMap.USERS]: new Route(`/admin/users`),
  [PageMap.USER_VIEW]: new Route(`/admin/users/${RouteParams.ModelID}`),
  [PageMap.USER_SETTINGS]: new Route(
    `/admin/users/${RouteParams.ModelID}/settings`,
  ),
  [PageMap.USER_DELETE]: new Route(
    `/admin/users/${RouteParams.ModelID}/delete`,
  ),

  [PageMap.SETTINGS_HOST]: new Route(`/admin/settings/host`),
  [PageMap.SETTINGS_SMTP]: new Route(`/admin/settings/smtp`),
  [PageMap.SETTINGS_CALL_AND_SMS]: new Route(`/admin/settings/call-and-sms`),
  [PageMap.SETTINGS_WHATSAPP]: new Route(`/admin/settings/whatsapp`),
  [PageMap.SETTINGS_PROBES]: new Route(`/admin/settings/probes`),
  [PageMap.SETTINGS_LLMS]: new Route(`/admin/settings/llms`),
  [PageMap.SETTINGS_AUTHENTICATION]: new Route(
    `/admin/settings/authentication`,
  ),
  [PageMap.SETTINGS_API_KEY]: new Route(`/admin/settings/api-key`),
};

export class RouteUtil {
  public static populateRouteParams(
    route: Route,
    props?: {
      modelId?: ObjectID;
      subModelId?: ObjectID;
    },
  ): Route {
    // populate projectid

    const tempRoute: Route = new Route(route.toString());

    if (props && props.modelId) {
      route = tempRoute.addRouteParam(
        RouteParams.ModelID,
        props.modelId.toString(),
      );
    }

    if (props && props.subModelId) {
      route = tempRoute.addRouteParam(
        RouteParams.SubModelID,
        props.subModelId.toString(),
      );
    }

    return tempRoute;
  }
}

export default RouteMap;
