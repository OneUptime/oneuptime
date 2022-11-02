import Route from 'Common/Types/API/Route';
import Dictionary from 'Common/Types/Dictionary';
import PageMap from './PageMap';
import RouteParams from './RouteParams';
import ObjectID from 'Common/Types/ObjectID';
import LocalStorage from 'CommonUI/src/Utils/LocalStorage';

const RouteMap: Dictionary<Route> = {
    [PageMap.OVERVIEW]: new Route(`/`),
    [PageMap.INCIDENT_LIST]: new Route(`/incidents`),
    [PageMap.INCIDENT_DETAIL]: new Route(`/incidents/:id`),
    [PageMap.ANNOUNCEMENT_DETAIL]: new Route(`/announcements/:id`),
    [PageMap.ANNOUNCEMENT_LIST]: new Route(`/announcements`),
    [PageMap.SCHEDULED_EVENT_LIST]: new Route(`/scheduled-events`),
    [PageMap.SCHEDULED_EVENT_DETAIL]: new Route(`/scheduled-events/:id`),
    [PageMap.RSS]: new Route(`/rss`),
    [PageMap.SUBSCRIBE]: new Route(`/subscribe`),

    [PageMap.PREVIEW_OVERVIEW]: new Route(
        `/status-page/${RouteParams.StatusPageId}`
    ),
    [PageMap.PREVIEW_INCIDENT_LIST]: new Route(
        `/status-page/${RouteParams.StatusPageId}/incidents`
    ),
    [PageMap.PREVIEW_INCIDENT_DETAIL]: new Route(
        `/status-page/${RouteParams.StatusPageId}/incidents/:id`
    ),
    [PageMap.PREVIEW_ANNOUNCEMENT_DETAIL]: new Route(
        `/status-page/${RouteParams.StatusPageId}/announcements/:id`
    ),
    [PageMap.PREVIEW_ANNOUNCEMENT_LIST]: new Route(
        `/status-page/${RouteParams.StatusPageId}/announcements`
    ),
    [PageMap.PREVIEW_SCHEDULED_EVENT_LIST]: new Route(
        `/status-page/${RouteParams.StatusPageId}/scheduled-events`
    ),
    [PageMap.PREVIEW_SCHEDULED_EVENT_DETAIL]: new Route(
        `/status-page/${RouteParams.StatusPageId}/scheduled-events/:id`
    ),
    [PageMap.PREVIEW_RSS]: new Route(
        `/status-page/${RouteParams.StatusPageId}/rss`
    ),
    [PageMap.PREVIEW_SUBSCRIBE]: new Route(
        `/status-page/${RouteParams.StatusPageId}/subscribe`
    ),

    [PageMap.NOT_FOUND]: new Route(`status-page/not-found`),
};

export class RouteUtil {
    public static populateRouteParams(route: Route, modelId?: ObjectID): Route {
        const tempRoute: Route = new Route(route.toString());

        if (modelId) {
            route = tempRoute.addRouteParam(
                RouteParams.ModelID,
                modelId.toString()
            );
        }

        const id: ObjectID = LocalStorage.getItem('statusPageId') as ObjectID;

        if (id) {
            route = tempRoute.addRouteParam(
                RouteParams.StatusPageId,
                id.toString()
            );
        }

        return tempRoute;
    }
}

export default RouteMap;
