import Route from 'Common/Types/API/Route';
import Dictionary from 'Common/Types/Dictionary';
import PageMap from './PageMap';

const RouteMap: Dictionary<Route> = {
    [PageMap.INIT]: new Route('/'),
    [PageMap.HOME]: new Route('/:projectSlug/home'),
    [PageMap.INCIDENTS]: new Route('/:projectSlug/incidents'),
    [PageMap.STATUS_PAGE]: new Route('/:projectSlug/status-pages'),
    [PageMap.LOGS]: new Route('/:projectSlug/logs'),
    [PageMap.SETTINGS]: new Route('/:projectSlug/settings'),
    [PageMap.MONITORS]: new Route('/:projectSlug/monitors'),
};

export default RouteMap;
