import PageMap from "./PageMap";
import RouteParams from "./RouteParams";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import LocalStorage from "Common/UI/Utils/LocalStorage";

const RouteMap: Dictionary<Route> = {
  [PageMap.OVERVIEW]: new Route(`/`),
  [PageMap.INCIDENT_LIST]: new Route(`/incidents`),
  [PageMap.INCIDENT_DETAIL]: new Route(`/incidents/:id`),
  [PageMap.EPISODE_DETAIL]: new Route(`/incidents/episode/:id`),
  [PageMap.ANNOUNCEMENT_DETAIL]: new Route(`/announcements/:id`),
  [PageMap.ANNOUNCEMENT_LIST]: new Route(`/announcements`),
  [PageMap.SCHEDULED_EVENT_LIST]: new Route(`/scheduled-events`),
  [PageMap.SCHEDULED_EVENT_DETAIL]: new Route(`/scheduled-events/:id`),
  [PageMap.RSS]: new Route(`/rss`),
  [PageMap.SUBSCRIBE_EMAIL]: new Route(`/subscribe/email`),
  [PageMap.SUBSCRIBE_SMS]: new Route(`/subscribe/sms`),
  [PageMap.SUBSCRIBE_SLACK]: new Route(`/subscribe/slack`),
  [PageMap.SUBSCRIBE_MICROSOFT_TEAMS]: new Route(`/subscribe/microsoft-teams`),
  [PageMap.SUBSCRIBE_WEBHOOKS]: new Route(`/subscribe/webhooks`),
  [PageMap.UPDATE_SUBSCRIPTION]: new Route(`/update-subscription/:id`),
  [PageMap.CONFIRM_SUBSCRIPTION]: new Route(`/confirm-subscription/:id`),

  [PageMap.LOGIN]: new Route(`/login`),
  [PageMap.SSO]: new Route(`/sso`),

  [PageMap.LOGOUT]: new Route(`/logout`),
  [PageMap.FORGOT_PASSWORD]: new Route(`/forgot-password`),
  [PageMap.RESET_PASSWORD]: new Route(`/reset-password/:token`),
  [PageMap.MASTER_PASSWORD]: new Route(`/master-password`),

  // forbidden page
  [PageMap.FORBIDDEN]: new Route(`/forbidden`),

  [PageMap.PREVIEW_OVERVIEW]: new Route(
    `/status-page/${RouteParams.StatusPageId}`,
  ),
  [PageMap.PREVIEW_INCIDENT_LIST]: new Route(
    `/status-page/${RouteParams.StatusPageId}/incidents`,
  ),
  [PageMap.PREVIEW_INCIDENT_DETAIL]: new Route(
    `/status-page/${RouteParams.StatusPageId}/incidents/:id`,
  ),
  [PageMap.PREVIEW_EPISODE_DETAIL]: new Route(
    `/status-page/${RouteParams.StatusPageId}/incidents/episode/:id`,
  ),
  [PageMap.PREVIEW_ANNOUNCEMENT_DETAIL]: new Route(
    `/status-page/${RouteParams.StatusPageId}/announcements/:id`,
  ),
  [PageMap.PREVIEW_ANNOUNCEMENT_LIST]: new Route(
    `/status-page/${RouteParams.StatusPageId}/announcements`,
  ),
  [PageMap.PREVIEW_SCHEDULED_EVENT_LIST]: new Route(
    `/status-page/${RouteParams.StatusPageId}/scheduled-events`,
  ),
  [PageMap.PREVIEW_SCHEDULED_EVENT_DETAIL]: new Route(
    `/status-page/${RouteParams.StatusPageId}/scheduled-events/:id`,
  ),
  [PageMap.PREVIEW_RSS]: new Route(
    `/status-page/${RouteParams.StatusPageId}/rss`,
  ),

  // preview forbidden page
  [PageMap.PREVIEW_FORBIDDEN]: new Route(
    `/status-page/${RouteParams.StatusPageId}/forbidden`,
  ),
  [PageMap.PREVIEW_SUBSCRIBE_EMAIL]: new Route(
    `/status-page/${RouteParams.StatusPageId}/subscribe/email`,
  ),
  [PageMap.PREVIEW_SUBSCRIBE_SMS]: new Route(
    `/status-page/${RouteParams.StatusPageId}/subscribe/sms`,
  ),

  [PageMap.PREVIEW_SUBSCRIBE_SLACK]: new Route(
    `/status-page/${RouteParams.StatusPageId}/subscribe/slack`,
  ),

  [PageMap.PREVIEW_SUBSCRIBE_MICROSOFT_TEAMS]: new Route(
    `/status-page/${RouteParams.StatusPageId}/subscribe/microsoft-teams`,
  ),

  [PageMap.PREVIEW_SUBSCRIBE_WEBHOOKS]: new Route(
    `/status-page/${RouteParams.StatusPageId}/subscribe/webhooks`,
  ),

  [PageMap.NOT_FOUND]: new Route(`status-page/not-found`),

  [PageMap.PREVIEW_LOGIN]: new Route(
    `/status-page/${RouteParams.StatusPageId}/login`,
  ),
  [PageMap.PREVIEW_FORGOT_PASSWORD]: new Route(
    `/status-page/${RouteParams.StatusPageId}/forgot-password`,
  ),
  [PageMap.PREVIEW_RESET_PASSWORD]: new Route(
    `/status-page/${RouteParams.StatusPageId}/reset-password/:token`,
  ),
  [PageMap.PREVIEW_MASTER_PASSWORD]: new Route(
    `/status-page/${RouteParams.StatusPageId}/master-password`,
  ),

  [PageMap.PREVIEW_SSO]: new Route(
    `/status-page/${RouteParams.StatusPageId}/sso`,
  ),

  [PageMap.PREVIEW_LOGOUT]: new Route(
    `/status-page/${RouteParams.StatusPageId}/logout`,
  ),

  [PageMap.PREVIEW_UPDATE_SUBSCRIPTION]: new Route(
    `/status-page/${RouteParams.StatusPageId}/update-subscription/:id`,
  ),

  [PageMap.PREVIEW_CONFIRM_SUBSCRIPTION]: new Route(
    `/status-page/${RouteParams.StatusPageId}/confirm-subscription/:id`,
  ),
};

export class RouteUtil {
  public static populateRouteParams(route: Route, modelId?: ObjectID): Route {
    const tempRoute: Route = new Route(route.toString());

    if (modelId) {
      route = tempRoute.addRouteParam(RouteParams.ModelID, modelId.toString());
    }

    const id: ObjectID = LocalStorage.getItem("statusPageId") as ObjectID;

    if (id) {
      route = tempRoute.addRouteParam(RouteParams.StatusPageId, id.toString());
    }

    return tempRoute;
  }
}

export default RouteMap;
