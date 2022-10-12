import Route from 'Common/Types/API/Route';
import Dictionary from 'Common/Types/Dictionary';
import PageMap from './PageMap';
import RouteParams from './RouteParams';
import ObjectID from 'Common/Types/ObjectID';

const RouteMap: Dictionary<Route> = {
    [PageMap.OVERVIEW]: new Route(`/`),
    [PageMap.PREVIEW]: new Route(`/dashboard/${RouteParams.StatusPageId}`),
    [PageMap.NOT_FOUND]: new Route(`/not-found`),
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

        return tempRoute;
    }
}

export default RouteMap;
