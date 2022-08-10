import Project from 'Model/Models/Project';
import Route from 'Common/Types/API/Route';
import Dictionary from 'Common/Types/Dictionary';
import ProjectUtil from 'CommonUI/src/Utils/Project';
import PageMap from './PageMap';
import RouteParams from './RouteParams';

const RouteMap: Dictionary<Route> = {
    [PageMap.INIT]: new Route(`/dashboard`),
    [PageMap.HOME]: new Route(`/dashboard/${RouteParams.ProjectID}/home/`),
    [PageMap.INCIDENTS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/incidents/`
    ),
    [PageMap.STATUS_PAGE]: new Route(
        `/dashboard/${RouteParams.ProjectID}/status-pages/`
    ),
    [PageMap.LOGS]: new Route(`/dashboard/${RouteParams.ProjectID}/logs/`),

    [PageMap.MONITORS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/monitors/`
    ),
    [PageMap.AUTOMATION_SCRIPTS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/automation-scripts/`
    ),
    [PageMap.ON_CALL_DUTY]: new Route(
        `/dashboard/${RouteParams.ProjectID}/on-call-duty/`
    ),
    [PageMap.REPORTS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/reports/`
    ),
    [PageMap.ERROR_TRACKER]: new Route(
        `/dashboard/${RouteParams.ProjectID}/error-tracker/`
    ),

    // Settings Routes
    [PageMap.SETTINGS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/settings/`
    ),
    [PageMap.SETTINGS_DANGERZONE]: new Route(
        `/dashboard/${RouteParams.ProjectID}/settings/danger-zone`
    ),

    //api keys.
    [PageMap.SETTINGS_APIKEYS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/settings/api-keys`
    ),

    [PageMap.SETTINGS_APIKEY_VIEW]: new Route(
        `/dashboard/${RouteParams.ProjectID}/settings/api-keys/${RouteParams.ModelID}`
    ),

    [PageMap.SETTINGS_CUSTOM_SMTP]: new Route(
        `/dashboard/${RouteParams.ProjectID}/settings/custom-smtp`
    ),

    [PageMap.SETTINGS_MONITORS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/settings/monitors`
    ),

    [PageMap.SETTINGS_INCIDENTS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/settings/incidents`
    ),

    [PageMap.SETTINGS_TEAMS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/settings/teams`
    ),

    [PageMap.SETTINGS_TEAM_VIEW]: new Route(
        `/dashboard/${RouteParams.ProjectID}/settings/teams/${RouteParams.ModelID}`
    ),

    // labels.
    [PageMap.SETTINGS_LABELS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/settings/labels`
    ),

    // logout.
    [PageMap.LOGOUT]: new Route(`/dashboard/logout`),
};

export class RouteUtil {
    public static populateRouteParams(route: Route): Route {
        // populate projectid
        const project: Project | null = ProjectUtil.getCurrentProject();

        if (project && project._id) {
            route = route.addRouteParam(RouteParams.ProjectID, project._id);
        }

        return route;
    }
}

export default RouteMap;
