import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";

/*
 * The Developer pages (Terraform, API, CLI, AI Assistants) as routes: which pages
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
  Cli = "cli",
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
      // Terraform's own mark, as Slack's and GitHub's stand for theirs.
      icon: IconProp.Terraform,
    },
    { type: DeveloperDocsPageType.Api, title: "API", icon: IconProp.Code },
    /*
     * The CLI after the API it is a command line for, and before the AI
     * assistants that may run it.
     */
    { type: DeveloperDocsPageType.Cli, title: "CLI", icon: IconProp.Terminal },
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
  /*
   * Which of a model's products the page is in, for the one model two
   * products show: CloudResource's environments are App Platforms', its
   * resources Cloud's. Such a model has one parent page per product in a
   * scope, and each product's menus and route file name theirs by its page
   * key (parentPageKey). Every other model has one parent page per scope
   * and leaves this out.
   */
  product?: string | undefined;
  /*
   * For such a model, the product's own rows: what its Terraform page
   * offers to import and its API examples list and count. Without it,
   * App Platforms' Terraform page wrote import blocks for Cloud's
   * resources too, and each product's for the other's rows - two
   * Terraform resources for one row once both were followed.
   */
  query?: JSONObject | undefined;
  // And what the product calls its rows, where the model calls them otherwise.
  resourceOptions?: DeveloperDocsResourceOptions | undefined;
}

// App Platforms' rows are environments; the model calls them cloud resources.
const CLOUD_ENVIRONMENT_RESOURCE_OPTIONS: DeveloperDocsResourceOptions = {
  singularName: "Cloud Environment",
  pluralName: "Cloud Environments",
};

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
    // Code: the repositories
    {
      pageKey: PageMap.CODE,
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
      pageKey: PageMap.OPENSTACK_CLOUDS,
      scope: DeveloperDocsScope.List,
      tableName: "OpenStackCloud",
    },
    {
      pageKey: PageMap.OPENSTACK_CLOUD_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "OpenStackCloud",
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
    /*
     * One model, two products: App Platforms lists the environments its
     * apps run in, Cloud every resource in its accounts. Each product's
     * pages read and name its own rows only.
     */
    {
      pageKey: PageMap.APP_PLATFORMS_ENVIRONMENTS,
      scope: DeveloperDocsScope.List,
      tableName: "CloudResource",
      product: "App Platforms",
      query: { cloudResourceKind: CloudResourceKind.Environment },
      resourceOptions: CLOUD_ENVIRONMENT_RESOURCE_OPTIONS,
    },
    {
      pageKey: PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "CloudResource",
      product: "App Platforms",
      resourceOptions: CLOUD_ENVIRONMENT_RESOURCE_OPTIONS,
    },
    {
      pageKey: PageMap.CLOUD_MONITORED_RESOURCES,
      scope: DeveloperDocsScope.List,
      tableName: "CloudResource",
      product: "Cloud",
      query: { cloudResourceKind: CloudResourceKind.Resource },
    },
    {
      pageKey: PageMap.CLOUD_RESOURCE_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "CloudResource",
      product: "Cloud",
    },
    {
      pageKey: PageMap.CLOUD_ACCOUNT_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "CloudAccount",
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
    /*
     * Data Observability: a data product, which people make - its tables,
     * who uses them and its freshness SLA - and so can keep as code.
     */
    {
      pageKey: PageMap.DATA_OBSERVABILITY_DATA_PRODUCT_VIEW,
      scope: DeveloperDocsScope.View,
      tableName: "DataProduct",
    },
  ];

/*
 * The parent page of a model's Developer pages in a scope: its list page or
 * its view page. Undefined when it has none in that scope.
 *
 * A model two products show has a parent page in each (`product`), and the
 * caller names the one it is drawing (`parentPageKey`): asked without it,
 * this throws rather than guess, so a menu cannot link to the other
 * product's pages. A key that is not this model's parent in this scope is
 * undefined, as a model without one is.
 */
export function getDeveloperDocsParentPage(
  tableName: string,
  scope: DeveloperDocsScope,
  parentPageKey?: PageMap | undefined,
): DeveloperDocsParentPage | undefined {
  const parents: Array<DeveloperDocsParentPage> =
    DEVELOPER_DOCS_PARENT_PAGES.filter(
      (parent: DeveloperDocsParentPage): boolean => {
        return parent.tableName === tableName && parent.scope === scope;
      },
    );

  if (parentPageKey) {
    return parents.find((parent: DeveloperDocsParentPage): boolean => {
      return parent.pageKey === parentPageKey;
    });
  }

  if (parents.length > 1) {
    throw new Error(
      `${tableName} has ${parents.length} ${scope} pages with Developer pages, one per product: name the one this menu or route file draws (parentPageKey).`,
    );
  }

  return parents[0];
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
    singularName: "Maintenance Event",
    pluralName: "Maintenance Events",
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

// The Developer pages under a page: four when it is a registered list or view page.
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
