import Project from 'Model/Models/Project';
import Route from 'Common/Types/API/Route';
import Dictionary from 'Common/Types/Dictionary';
import ProjectUtil from 'CommonUI/src/Utils/Project';
import PageMap from './PageMap';
import RouteParams from './RouteParams';
import ObjectID from 'Common/Types/ObjectID';

const RouteMap: Dictionary<Route> = {
    [PageMap.INIT]: new Route(`/dashboard`),

    [PageMap.WELCOME]: new Route(`/dashboard/welcome`),

    [PageMap.INIT_PROJECT]: new Route(`/dashboard/${RouteParams.ProjectID}`),

    [PageMap.HOME]: new Route(`/dashboard/${RouteParams.ProjectID}/home/`),
    [PageMap.HOME_NOT_OPERATIONAL_MONITORS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/home/monitors-inoperational`
    ),

    [PageMap.INCIDENTS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/incidents`
    ),

    [PageMap.UNRESOLVED_INCIDENTS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/incidents/unresolved`
    ),

    [PageMap.INCIDENT_VIEW]: new Route(
        `/dashboard/${RouteParams.ProjectID}/incidents/${RouteParams.ModelID}`
    ),

    [PageMap.INCIDENT_VIEW_STATE_TIMELINE]: new Route(
        `/dashboard/${RouteParams.ProjectID}/incidents/${RouteParams.ModelID}/state-timeline`
    ),

    [PageMap.MONITOR_VIEW_INCIDENTS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/incidents/${RouteParams.ModelID}/incidents`
    ),

    [PageMap.INCIDENT_VIEW_DELETE]: new Route(
        `/dashboard/${RouteParams.ProjectID}/incidents/${RouteParams.ModelID}/delete`
    ),

    [PageMap.INCIDENT_INTERNAL_NOTE]: new Route(
        `/dashboard/${RouteParams.ProjectID}/incidents/${RouteParams.ModelID}/internal-notes`
    ),

    [PageMap.INCIDENT_PUBLIC_NOTE]: new Route(
        `/dashboard/${RouteParams.ProjectID}/incidents/${RouteParams.ModelID}/public-notes`
    ),

    [PageMap.STATUS_PAGES]: new Route(
        `/dashboard/${RouteParams.ProjectID}/status-pages`
    ),

    [PageMap.STATUS_PAGE_VIEW]: new Route(
        `/dashboard/${RouteParams.ProjectID}/status-pages/${RouteParams.ModelID}`
    ),

    [PageMap.STATUS_PAGE_VIEW_BRANDING]: new Route(
        `/dashboard/${RouteParams.ProjectID}/status-pages/${RouteParams.ModelID}/branding`
    ),

    [PageMap.STATUS_PAGE_VIEW_GROUPS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/status-pages/${RouteParams.ModelID}/groups`
    ),

    [PageMap.STATUS_PAGE_VIEW_DELETE]: new Route(
        `/dashboard/${RouteParams.ProjectID}/status-pages/${RouteParams.ModelID}/delete`
    ),

    [PageMap.STATUS_PAGE_VIEW_DOMAINS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/status-pages/${RouteParams.ModelID}/domains`
    ),

    [PageMap.STATUS_PAGE_VIEW_EMAIL_SUBSCRIBERS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/status-pages/${RouteParams.ModelID}/email-subscribers`
    ),

    [PageMap.STATUS_PAGE_VIEW_SMS_SUBSCRIBERS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/status-pages/${RouteParams.ModelID}/sms-subscribers`
    ),

    [PageMap.STATUS_PAGE_VIEW_WEBHOOK_SUBSCRIBERS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/status-pages/${RouteParams.ModelID}/webhook-subscribers`
    ),

    [PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/status-pages/${RouteParams.ModelID}/announcements`
    ),

    [PageMap.STATUS_PAGE_VIEW_EMBEDDED]: new Route(
        `/dashboard/${RouteParams.ProjectID}/status-pages/${RouteParams.ModelID}/embedded`
    ),

    [PageMap.STATUS_PAGE_VIEW_SUBSCRIBER_SETTINGS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/status-pages/${RouteParams.ModelID}/subscriber-settings`
    ),

    [PageMap.STATUS_PAGE_VIEW_CUSTOM_HTML_CSS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/status-pages/${RouteParams.ModelID}/custom-code`
    ),

    [PageMap.STATUS_PAGE_VIEW_RESOURCES]: new Route(
        `/dashboard/${RouteParams.ProjectID}/status-pages/${RouteParams.ModelID}/resources`
    ),

    [PageMap.STATUS_PAGE_VIEW_ADVANCED_OPTIONS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/status-pages/${RouteParams.ModelID}/advanced-options`
    ),

    [PageMap.LOGS]: new Route(`/dashboard/${RouteParams.ProjectID}/logs/`),

    [PageMap.MONITORS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/monitors`
    ),

    [PageMap.MONITORS_INOPERATIONAL]: new Route(
        `/dashboard/${RouteParams.ProjectID}/monitors/inoperational`
    ),

    [PageMap.MONITOR_VIEW]: new Route(
        `/dashboard/${RouteParams.ProjectID}/monitors/${RouteParams.ModelID}`
    ),

    [PageMap.MONITOR_VIEW_STATUS_TIMELINE]: new Route(
        `/dashboard/${RouteParams.ProjectID}/monitors/${RouteParams.ModelID}/status-timeline`
    ),

    [PageMap.MONITOR_VIEW_DELETE]: new Route(
        `/dashboard/${RouteParams.ProjectID}/monitors/${RouteParams.ModelID}/delete`
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

    [PageMap.SETTINGS_MONITORS_STATUS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/settings/monitors-status`
    ),

    [PageMap.SETTINGS_INCIDENTS_STATE]: new Route(
        `/dashboard/${RouteParams.ProjectID}/settings/incidents-state`
    ),

    [PageMap.SETTINGS_INCIDENTS_SEVERITY]: new Route(
        `/dashboard/${RouteParams.ProjectID}/settings/incidents-severity`
    ),

    [PageMap.SETTINGS_DOMAINS]: new Route(
        `/dashboard/${RouteParams.ProjectID}/settings/domains`
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
    public static populateRouteParams(route: Route, modelId?: ObjectID): Route {
        // populate projectid
        const project: Project | null = ProjectUtil.getCurrentProject();
        const tempRoute: Route = new Route(route.toString());

        if (project && project._id) {
            route = tempRoute.addRouteParam(RouteParams.ProjectID, project._id);
        }

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
