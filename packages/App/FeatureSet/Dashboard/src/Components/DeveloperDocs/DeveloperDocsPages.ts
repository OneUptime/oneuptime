import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * The Developer pages (Terraform, API, AI Assistants) as routes: which pages
 * have them, what they are called, where they live. RouteMap and the
 * breadcrumbs read this, so it imports no models: RouteMap is in the first
 * load of every dashboard page, and the resources' models are not: each
 * page names its model by table name, and the menus and route files that
 * show the pages pass the model they already import.
 *
 * Adding a resource is its parent pages here, plus the one-line helpers in
 * its menus and route file (DeveloperDocsSideMenu.tsx,
 * DeveloperDocsRoutes.tsx). Its routes in RouteMap and its breadcrumbs
 * follow, and the code on its pages is written from the model's metadata and
 * the record's real data. Common/Tests/App/Dashboard/
 * DeveloperMenuSections.test.tsx checks every resource view menu has the
 * section (or is listed there as deliberately without one), and that every
 * page has its route and breadcrumbs.
 */

export enum DeveloperDocsPageType {
  Terraform = "terraform",
  Api = "api",
  AiAssistants = "ai-assistants",
}

// Where a Developer page hangs: under a resource's list, or under one resource.
export enum DeveloperDocsScope {
  // Monitors > Developer > Terraform: the resource type.
  List = "list",
  // A monitor > Developer > Terraform: that one monitor.
  View = "view",
}

export interface DeveloperDocsPageDefinition {
  type: DeveloperDocsPageType;
  // The menu entry and the last breadcrumb.
  title: string;
  icon: IconProp;
}

export const DEVELOPER_DOCS_SECTION_TITLE: string = "Developer";

export const DEVELOPER_DOCS_PAGES: ReadonlyArray<DeveloperDocsPageDefinition> =
  [
    {
      type: DeveloperDocsPageType.Terraform,
      title: "Terraform",
      icon: IconProp.Cube,
    },
    { type: DeveloperDocsPageType.Api, title: "API", icon: IconProp.Code },
    {
      type: DeveloperDocsPageType.AiAssistants,
      title: "AI Assistants",
      icon: IconProp.Sparkles,
    },
  ];

export interface DeveloperDocsParentPage {
  pageKey: PageMap;
  scope: DeveloperDocsScope;
  // The model the pages are about, by table name ("Workflow").
  tableName: string;
}

/*
 * Every page with Developer pages under it: a resource's list page (its
 * product menu) and its view page (its own menu).
 */
export const DEVELOPER_DOCS_PARENT_PAGES: ReadonlyArray<DeveloperDocsParentPage> =
  [
    // Workflows
    {
      pageKey: PageMap.WORKFLOWS,
      scope: DeveloperDocsScope.List,
      tableName: "Workflow",
    },
    {
      pageKey: PageMap.WORKFLOW_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "Workflow",
    },
    // Monitors and monitor groups
    {
      pageKey: PageMap.MONITORS,
      scope: DeveloperDocsScope.List,
      tableName: "Monitor",
    },
    {
      pageKey: PageMap.MONITOR_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "Monitor",
    },
    {
      pageKey: PageMap.MONITOR_GROUP_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "MonitorGroup",
    },
    // Status pages and their announcements
    {
      pageKey: PageMap.STATUS_PAGES,
      scope: DeveloperDocsScope.List,
      tableName: "StatusPage",
    },
    {
      pageKey: PageMap.STATUS_PAGE_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "StatusPage",
    },
    {
      pageKey: PageMap.ANNOUNCEMENT_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "StatusPageAnnouncement",
    },
    // Incidents and incident episodes
    {
      pageKey: PageMap.INCIDENTS,
      scope: DeveloperDocsScope.List,
      tableName: "Incident",
    },
    {
      pageKey: PageMap.INCIDENT_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "Incident",
    },
    {
      pageKey: PageMap.INCIDENT_EPISODE_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "IncidentEpisode",
    },
    // Alerts and alert episodes
    {
      pageKey: PageMap.ALERTS,
      scope: DeveloperDocsScope.List,
      tableName: "Alert",
    },
    {
      pageKey: PageMap.ALERT_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "Alert",
    },
    {
      pageKey: PageMap.ALERT_EPISODE_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "AlertEpisode",
    },
    // Scheduled maintenance
    {
      pageKey: PageMap.SCHEDULED_MAINTENANCE_EVENTS,
      scope: DeveloperDocsScope.List,
      tableName: "ScheduledMaintenance",
    },
    {
      pageKey: PageMap.SCHEDULED_MAINTENANCE_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "ScheduledMaintenance",
    },
    // On-call
    {
      pageKey: PageMap.ON_CALL_DUTY_POLICIES,
      scope: DeveloperDocsScope.List,
      tableName: "OnCallDutyPolicy",
    },
    {
      pageKey: PageMap.ON_CALL_DUTY_POLICY_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "OnCallDutyPolicy",
    },
    {
      pageKey: PageMap.ON_CALL_DUTY_SCHEDULE_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "OnCallDutyPolicySchedule",
    },
    {
      pageKey: PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "IncomingCallPolicy",
    },
    // Teams
    {
      pageKey: PageMap.TEAMS,
      scope: DeveloperDocsScope.List,
      tableName: "Team",
    },
    {
      pageKey: PageMap.TEAM_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "Team",
    },
    // Dashboards
    {
      pageKey: PageMap.DASHBOARDS,
      scope: DeveloperDocsScope.List,
      tableName: "Dashboard",
    },
    {
      pageKey: PageMap.DASHBOARD_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "Dashboard",
    },
    // Runbooks
    {
      pageKey: PageMap.RUNBOOKS,
      scope: DeveloperDocsScope.List,
      tableName: "Runbook",
    },
    {
      pageKey: PageMap.RUNBOOK_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "Runbook",
    },
    // Forms
    {
      pageKey: PageMap.FORMS,
      scope: DeveloperDocsScope.List,
      tableName: "Form",
    },
    {
      pageKey: PageMap.FORM_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "Form",
    },
    // SLOs
    {
      pageKey: PageMap.SLOS,
      scope: DeveloperDocsScope.List,
      tableName: "ServiceLevelObjective",
    },
    {
      pageKey: PageMap.SLO_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "ServiceLevelObjective",
    },
    // Services
    {
      pageKey: PageMap.SERVICES,
      scope: DeveloperDocsScope.List,
      tableName: "Service",
    },
    {
      pageKey: PageMap.SERVICE_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "Service",
    },
    // Code repositories
    {
      pageKey: PageMap.CODE_REPOSITORY,
      scope: DeveloperDocsScope.List,
      tableName: "CodeRepository",
    },
    {
      pageKey: PageMap.CODE_REPOSITORY_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "CodeRepository",
    },
    // Infrastructure
    {
      pageKey: PageMap.KUBERNETES_CLUSTERS,
      scope: DeveloperDocsScope.List,
      tableName: "KubernetesCluster",
    },
    {
      pageKey: PageMap.KUBERNETES_CLUSTER_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "KubernetesCluster",
    },
    {
      pageKey: PageMap.DOCKER_HOSTS,
      scope: DeveloperDocsScope.List,
      tableName: "DockerHost",
    },
    {
      pageKey: PageMap.DOCKER_HOST_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "DockerHost",
    },
    {
      pageKey: PageMap.DOCKER_SWARM_CLUSTERS,
      scope: DeveloperDocsScope.List,
      tableName: "DockerSwarmCluster",
    },
    {
      pageKey: PageMap.DOCKER_SWARM_CLUSTER_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "DockerSwarmCluster",
    },
    {
      pageKey: PageMap.PODMAN_HOSTS,
      scope: DeveloperDocsScope.List,
      tableName: "PodmanHost",
    },
    {
      pageKey: PageMap.PODMAN_HOST_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "PodmanHost",
    },
    {
      pageKey: PageMap.PROXMOX_CLUSTERS,
      scope: DeveloperDocsScope.List,
      tableName: "ProxmoxCluster",
    },
    {
      pageKey: PageMap.PROXMOX_CLUSTER_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "ProxmoxCluster",
    },
    {
      pageKey: PageMap.VMWARE_VCENTERS,
      scope: DeveloperDocsScope.List,
      tableName: "VMwareVCenter",
    },
    {
      pageKey: PageMap.VMWARE_VCENTER_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "VMwareVCenter",
    },
    {
      pageKey: PageMap.CEPH_CLUSTERS,
      scope: DeveloperDocsScope.List,
      tableName: "CephCluster",
    },
    {
      pageKey: PageMap.CEPH_CLUSTER_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "CephCluster",
    },
    {
      pageKey: PageMap.STORAGE_ARRAYS,
      scope: DeveloperDocsScope.List,
      tableName: "StorageArray",
    },
    {
      pageKey: PageMap.STORAGE_ARRAY_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "StorageArray",
    },
    {
      pageKey: PageMap.HOSTS,
      scope: DeveloperDocsScope.List,
      tableName: "Host",
    },
    {
      pageKey: PageMap.HOST_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "Host",
    },
    {
      pageKey: PageMap.IOT_FLEETS,
      scope: DeveloperDocsScope.List,
      tableName: "IoTFleet",
    },
    {
      pageKey: PageMap.IOT_FLEET_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "IoTFleet",
    },
    {
      pageKey: PageMap.DATABASE_SERVERS,
      scope: DeveloperDocsScope.List,
      tableName: "DatabaseServer",
    },
    {
      pageKey: PageMap.DATABASE_SERVER_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "DatabaseServer",
    },
    {
      pageKey: PageMap.MESSAGE_QUEUES,
      scope: DeveloperDocsScope.List,
      tableName: "MessageQueue",
    },
    {
      pageKey: PageMap.MESSAGE_QUEUE_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "MessageQueue",
    },
    {
      pageKey: PageMap.SERVERLESS_FUNCTIONS,
      scope: DeveloperDocsScope.List,
      tableName: "ServerlessFunction",
    },
    {
      pageKey: PageMap.SERVERLESS_FUNCTION_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "ServerlessFunction",
    },
    {
      pageKey: PageMap.CLOUD_RESOURCES,
      scope: DeveloperDocsScope.List,
      tableName: "CloudResource",
    },
    {
      pageKey: PageMap.CLOUD_RESOURCE_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "CloudResource",
    },
    // Network
    {
      pageKey: PageMap.NETWORK_DEVICES,
      scope: DeveloperDocsScope.List,
      tableName: "NetworkDevice",
    },
    {
      pageKey: PageMap.NETWORK_DEVICE_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "NetworkDevice",
    },
    {
      pageKey: PageMap.NETWORK_SITE_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "NetworkSite",
    },
    // Real user monitoring
    {
      pageKey: PageMap.RUM_APPLICATIONS,
      scope: DeveloperDocsScope.List,
      tableName: "RumApplication",
    },
    {
      pageKey: PageMap.RUM_APPLICATION_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "RumApplication",
    },
    // Inventory
    {
      pageKey: PageMap.INVENTORY_ITEMS,
      scope: DeveloperDocsScope.List,
      tableName: "InventoryItem",
    },
    {
      pageKey: PageMap.INVENTORY_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "InventoryItem",
    },
  ];

/*
 * The parent page of a model's Developer pages in a scope: its list page or
 * its view page. Undefined when it has none in that scope.
 */
export function getDeveloperDocsParentPage(
  tableName: string,
  scope: DeveloperDocsScope,
): DeveloperDocsParentPage | undefined {
  return DEVELOPER_DOCS_PARENT_PAGES.find(
    (parent: DeveloperDocsParentPage): boolean => {
      return parent.tableName === tableName && parent.scope === scope;
    },
  );
}

/*
 * How the pages call a resource, when the model's own names do not read
 * well. What its examples set lives in its profile
 * (Common/Utils/DeveloperDocs/ResourceProfiles), with the model.
 */
export interface DeveloperDocsResourceOptions {
  singularName?: string | undefined;
  pluralName?: string | undefined;
}

// Per-model wording, by table name.
export const DEVELOPER_DOCS_RESOURCE_OPTIONS: Readonly<
  Record<string, DeveloperDocsResourceOptions>
> = {
  StatusPageAnnouncement: {
    singularName: "Announcement",
    pluralName: "Announcements",
  },
  ScheduledMaintenance: {
    singularName: "Scheduled Maintenance Event",
    pluralName: "Scheduled Maintenance Events",
  },
  OnCallDutyPolicy: { pluralName: "On-Call Policies" },
  OnCallDutyPolicySchedule: {
    singularName: "On-Call Schedule",
    pluralName: "On-Call Schedules",
  },
  ServiceLevelObjective: { singularName: "SLO", pluralName: "SLOs" },
  DockerSwarmCluster: {
    singularName: "Docker Swarm Cluster",
    pluralName: "Docker Swarm Clusters",
  },
};

/*
 * The key a Developer page has in RouteMap, e.g.
 * WORKFLOW_VIEW_DEVELOPER_TERRAFORM. Not a PageMap member: these pages are
 * generated (RouteMap adds them from this file).
 */
export function getDeveloperDocsPageKey(
  parentPageKey: PageMap,
  page: DeveloperDocsPageType,
): string {
  return `${parentPageKey}_DEVELOPER_${page.replace(/-/g, "_").toUpperCase()}`;
}

// The page's path under its parent page, e.g. `developer/terraform`.
export function getDeveloperDocsRelativePath(
  page: DeveloperDocsPageType,
): string {
  return `developer/${page}`;
}

export interface DeveloperDocsChildPage {
  key: string;
  page: DeveloperDocsPageDefinition;
  scope: DeveloperDocsScope;
}

// The Developer pages under a page: three when it is a registered list or view page.
export function getDeveloperDocsChildPages(
  parentPageKey: string,
): Array<DeveloperDocsChildPage> {
  const parent: DeveloperDocsParentPage | undefined =
    DEVELOPER_DOCS_PARENT_PAGES.find(
      (candidate: DeveloperDocsParentPage): boolean => {
        return candidate.pageKey === parentPageKey;
      },
    );

  if (!parent) {
    return [];
  }

  return DEVELOPER_DOCS_PAGES.map(
    (page: DeveloperDocsPageDefinition): DeveloperDocsChildPage => {
      return {
        key: getDeveloperDocsPageKey(parent.pageKey, page.type),
        page,
        scope: parent.scope,
      };
    },
  );
}

/*
 * The RouteMap entries of every Developer page: `<parent route>/developer/
 * terraform` and so on, for every parent page. RouteMap adds them when it
 * loads, so these pages are in the route table the breadcrumbs and the
 * active menu entry are worked out from, like any other page. Takes the
 * route table rather than importing it, because RouteMap imports this file.
 */
export function getDeveloperDocsRouteMapEntries(
  routeMap: Dictionary<Route>,
): Dictionary<Route> {
  const entries: Dictionary<Route> = {};

  for (const parent of DEVELOPER_DOCS_PARENT_PAGES) {
    const parentRoute: Route | undefined = routeMap[parent.pageKey];

    if (!parentRoute) {
      continue;
    }

    for (const child of getDeveloperDocsChildPages(parent.pageKey)) {
      entries[child.key] = new Route(
        `${parentRoute.toString().replace(/\/+$/, "")}/${getDeveloperDocsRelativePath(child.page.type)}`,
      );
    }
  }

  return entries;
}
