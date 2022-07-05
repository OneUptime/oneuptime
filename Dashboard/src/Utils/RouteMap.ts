import Route from 'Common/Types/API/Route';
import Dictionary from 'Common/Types/Dictionary';
import PageMap from './PageMap';

const RouteMap: Dictionary<Route> = {
    [PageMap.INIT]: new Route('/dashboard'),
    [PageMap.HOME]: new Route('/dashboard/:projectSlug/home/'),
    [PageMap.INCIDENTS]: new Route('/dashboard/:projectSlug/incidents/'),
    [PageMap.STATUS_PAGE]: new Route('/dashboard/:projectSlug/status-pages/'),
    [PageMap.LOGS]: new Route('/dashboard/:projectSlug/logs/'),

    [PageMap.MONITORS]: new Route('/dashboard/:projectSlug/monitors/'),
    [PageMap.AUTOMATION_SCRIPTS]: new Route(
        '/dashboard/:projectSlug/automation-scripts/'
    ),
    [PageMap.ON_CALL]: new Route('/dashboard/:projectSlug/on-call/'),
    [PageMap.REPORTS]: new Route('/dashboard/:projectSlug/reports/'),
    [PageMap.ERROR_TRACKER]: new Route('/dashboard/:projectSlug/error-tracker/'),

    // Settings Routes
    [PageMap.SETTINGS]: new Route('/dashboard/:projectSlug/settings/'),
    [PageMap.SETTINGS_DANGERZONE]: new Route(
        '/dashboard/:projectSlug/settings/danger-zone'
    ),
    [PageMap.SETTINGS_APIKEYS]: new Route('/dashboard/:projectSlug/settings/api-keys'),
    [PageMap.SETTINGS_CREATE_APIKEY]: new Route(
        '/dashboard/:projectSlug/settings/api-keys/create'
    ),
};

export default RouteMap;
