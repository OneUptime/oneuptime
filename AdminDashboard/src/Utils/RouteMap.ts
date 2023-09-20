import Route from 'Common/Types/API/Route';
import Dictionary from 'Common/Types/Dictionary';
import PageMap from './PageMap';
import RouteParams from './RouteParams';
import ObjectID from 'Common/Types/ObjectID';

const RouteMap: Dictionary<Route> = {
    [PageMap.INIT]: new Route(`/admin`),
    [PageMap.HOME]: new Route(`/admin`),
    [PageMap.LOGOUT]: new Route(`/admin/logout`),
    [PageMap.SETTINGS]: new Route(`/admin/settings/host`),
    [PageMap.PROJECTS]: new Route(`/admin/projects`),
    [PageMap.USERS]: new Route(`/admin/users`),
    [PageMap.SETTINGS_HOST]: new Route(`/admin/settings/host`),
    [PageMap.SETTINGS_SMTP]: new Route(`/admin/settings/smtp`),
    [PageMap.SETTINGS_CALL_AND_SMS]: new Route(`/admin/settings/call-and-sms`),
    [PageMap.SETTINGS_PROBES]: new Route(`/admin/settings/probes`),
    [PageMap.SETTINGS_AUTHENTICATION]: new Route(
        `/admin/settings/authentication`
    ),
    [PageMap.SETTINGS_API_KEY]: new Route(`/admin/settings/api-key`),
};

export class RouteUtil {
    public static populateRouteParams(
        route: Route,
        props?: {
            modelId?: ObjectID;
            subModelId?: ObjectID;
        }
    ): Route {
        // populate projectid

        const tempRoute: Route = new Route(route.toString());

        if (props && props.modelId) {
            route = tempRoute.addRouteParam(
                RouteParams.ModelID,
                props.modelId.toString()
            );
        }

        if (props && props.subModelId) {
            route = tempRoute.addRouteParam(
                RouteParams.SubModelID,
                props.subModelId.toString()
            );
        }

        return tempRoute;
    }
}

export default RouteMap;
