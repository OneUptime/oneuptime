import Route from 'Common/Types/API/Route';
import Dictionary from 'Common/Types/Dictionary';
import PageMap from './PageMap';

const RouteMap: Dictionary<Route> = {
    [PageMap.INIT]: new Route('/'),
    [PageMap.HOME]: new Route('/:projectSlug/home/'),
    [PageMap.INCIDENTS]: new Route('/:projectSlug/incidents/'),
    [PageMap.STATUS_PAGE]: new Route('/:projectSlug/status-pages/'),
    [PageMap.LOGS]: new Route('/:projectSlug/logs/'),
    
    [PageMap.MONITORS]: new Route('/:projectSlug/monitors/'),
    [PageMap.AUTOMATION_SCRIPTS]: new Route(
        '/:projectSlug/automation-scripts/'
    ),
    [PageMap.ON_CALL]: new Route('/:projectSlug/on-call/'),
    [PageMap.REPORTS]: new Route('/:projectSlug/reports/'),
    [PageMap.ERROR_TRACKER]: new Route('/:projectSlug/error-tracker/'),

    // Settings Routes
    [PageMap.SETTINGS]: new Route('/:projectSlug/settings/'),
    [PageMap.SETTINGS_DANGERZONE]: new Route('/:projectSlug/settings/danger-zone'),
};

export default RouteMap;
