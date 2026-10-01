import PageMap from "../../Utils/PageMap";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import Host from "Common/Models/DatabaseModels/Host";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import MessageQueue from "Common/Models/DatabaseModels/MessageQueue";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import Service from "Common/Models/DatabaseModels/Service";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import Team from "Common/Models/DatabaseModels/Team";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONValue } from "Common/Types/JSON";
import MonitorType from "Common/Types/Monitor/MonitorType";

/*
 * Every resource with Developer pages: Terraform, API and AI Assistants, in a
 * collapsed "Developer" section of its side menus.
 *
 * Adding a resource is one entry here, plus the one-line helpers in its
 * menus and route file (see DeveloperDocsSideMenu.tsx and
 * DeveloperDocsRoutes.tsx). The pages, their routes in RouteMap and their
 * breadcrumbs all follow from the entry, and the code on the pages is
 * written from the model's metadata and the record's real data.
 *
 * Common/Tests/App/Dashboard/DeveloperMenuSections.test.tsx checks every
 * resource view menu in the Dashboard has the section (or is listed there as
 * deliberately without one), and that every page here has its route and
 * breadcrumbs.
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

export const DEVELOPER_DOCS_PAGES: ReadonlyArray<DeveloperDocsPageDefinition> = [
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

export interface DeveloperDocsResource {
  modelType: DatabaseBaseModelType;
  /*
   * The page whose menu lists these resources (Workflows), when the list's
   * menu has a Developer section. A menu that lists several kinds has it for
   * its main one.
   */
  listPageKey?: PageMap | undefined;
  // The page whose menu is one resource's (View Workflow).
  viewPageKey?: PageMap | undefined;
  // How the pages call it, when the model's own names do not read well.
  singularName?: string | undefined;
  pluralName?: string | undefined;
  /*
   * Values for the "create one" examples, by column, where the generic ones
   * would not make a good start (a manual monitor needs no probes or steps).
   */
  exampleValues?: Record<string, JSONValue> | undefined;
}

export const DEVELOPER_DOCS_RESOURCES: ReadonlyArray<DeveloperDocsResource> = [
  {
    modelType: Workflow,
    listPageKey: PageMap.WORKFLOWS,
    viewPageKey: PageMap.WORKFLOW_VIEW,
  },
  {
    modelType: Monitor,
    listPageKey: PageMap.MONITORS,
    viewPageKey: PageMap.MONITOR_VIEW,
    exampleValues: { monitorType: MonitorType.Manual },
  },
  { modelType: MonitorGroup, viewPageKey: PageMap.MONITOR_GROUP_VIEW },
  {
    modelType: StatusPage,
    listPageKey: PageMap.STATUS_PAGES,
    viewPageKey: PageMap.STATUS_PAGE_VIEW,
  },
  {
    modelType: StatusPageAnnouncement,
    viewPageKey: PageMap.ANNOUNCEMENT_VIEW,
    singularName: "Announcement",
    pluralName: "Announcements",
  },
  {
    modelType: Incident,
    listPageKey: PageMap.INCIDENTS,
    viewPageKey: PageMap.INCIDENT_VIEW,
  },
  { modelType: IncidentEpisode, viewPageKey: PageMap.INCIDENT_EPISODE_VIEW },
  {
    modelType: Alert,
    listPageKey: PageMap.ALERTS,
    viewPageKey: PageMap.ALERT_VIEW,
  },
  { modelType: AlertEpisode, viewPageKey: PageMap.ALERT_EPISODE_VIEW },
  {
    modelType: ScheduledMaintenance,
    listPageKey: PageMap.SCHEDULED_MAINTENANCE_EVENTS,
    viewPageKey: PageMap.SCHEDULED_MAINTENANCE_VIEW,
    singularName: "Scheduled Maintenance Event",
    pluralName: "Scheduled Maintenance Events",
  },
  {
    modelType: OnCallDutyPolicy,
    listPageKey: PageMap.ON_CALL_DUTY_POLICIES,
    viewPageKey: PageMap.ON_CALL_DUTY_POLICY_VIEW,
    pluralName: "On-Call Policies",
  },
  {
    modelType: OnCallDutyPolicySchedule,
    viewPageKey: PageMap.ON_CALL_DUTY_SCHEDULE_VIEW,
    singularName: "On-Call Schedule",
    pluralName: "On-Call Schedules",
  },
  {
    modelType: IncomingCallPolicy,
    viewPageKey: PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW,
  },
  {
    modelType: Team,
    listPageKey: PageMap.TEAMS,
    viewPageKey: PageMap.TEAM_VIEW,
  },
  {
    modelType: Dashboard,
    listPageKey: PageMap.DASHBOARDS,
    viewPageKey: PageMap.DASHBOARD_VIEW,
  },
  {
    modelType: Runbook,
    listPageKey: PageMap.RUNBOOKS,
    viewPageKey: PageMap.RUNBOOK_VIEW,
  },
  {
    modelType: ServiceLevelObjective,
    listPageKey: PageMap.SLOS,
    viewPageKey: PageMap.SLO_VIEW,
    singularName: "SLO",
    pluralName: "SLOs",
  },
  {
    modelType: Service,
    listPageKey: PageMap.SERVICES,
    viewPageKey: PageMap.SERVICE_VIEW,
  },
  {
    modelType: CodeRepository,
    listPageKey: PageMap.CODE_REPOSITORY,
    viewPageKey: PageMap.CODE_REPOSITORY_VIEW,
  },
  {
    modelType: KubernetesCluster,
    listPageKey: PageMap.KUBERNETES_CLUSTERS,
    viewPageKey: PageMap.KUBERNETES_CLUSTER_VIEW,
  },
  {
    modelType: DockerHost,
    listPageKey: PageMap.DOCKER_HOSTS,
    viewPageKey: PageMap.DOCKER_HOST_VIEW,
  },
  {
    modelType: DockerSwarmCluster,
    listPageKey: PageMap.DOCKER_SWARM_CLUSTERS,
    viewPageKey: PageMap.DOCKER_SWARM_CLUSTER_VIEW,
    singularName: "Docker Swarm Cluster",
    pluralName: "Docker Swarm Clusters",
  },
  {
    modelType: PodmanHost,
    listPageKey: PageMap.PODMAN_HOSTS,
    viewPageKey: PageMap.PODMAN_HOST_VIEW,
  },
  {
    modelType: ProxmoxCluster,
    listPageKey: PageMap.PROXMOX_CLUSTERS,
    viewPageKey: PageMap.PROXMOX_CLUSTER_VIEW,
  },
  {
    modelType: VMwareVCenter,
    listPageKey: PageMap.VMWARE_VCENTERS,
    viewPageKey: PageMap.VMWARE_VCENTER_VIEW,
  },
  {
    modelType: CephCluster,
    listPageKey: PageMap.CEPH_CLUSTERS,
    viewPageKey: PageMap.CEPH_CLUSTER_VIEW,
  },
  {
    modelType: Host,
    listPageKey: PageMap.HOSTS,
    viewPageKey: PageMap.HOST_VIEW,
  },
  {
    modelType: IoTFleet,
    listPageKey: PageMap.IOT_FLEETS,
    viewPageKey: PageMap.IOT_FLEET_VIEW,
  },
  {
    modelType: DatabaseServer,
    listPageKey: PageMap.DATABASE_SERVERS,
    viewPageKey: PageMap.DATABASE_SERVER_VIEW,
  },
  {
    modelType: MessageQueue,
    listPageKey: PageMap.MESSAGE_QUEUES,
    viewPageKey: PageMap.MESSAGE_QUEUE_VIEW,
  },
  {
    modelType: ServerlessFunction,
    listPageKey: PageMap.SERVERLESS_FUNCTIONS,
    viewPageKey: PageMap.SERVERLESS_FUNCTION_VIEW,
  },
  {
    modelType: CloudResource,
    listPageKey: PageMap.CLOUD_RESOURCES,
    viewPageKey: PageMap.CLOUD_RESOURCE_VIEW,
  },
  {
    modelType: NetworkDevice,
    listPageKey: PageMap.NETWORK_DEVICES,
    viewPageKey: PageMap.NETWORK_DEVICE_VIEW,
  },
  { modelType: NetworkSite, viewPageKey: PageMap.NETWORK_SITE_VIEW },
  {
    modelType: RumApplication,
    listPageKey: PageMap.RUM_APPLICATIONS,
    viewPageKey: PageMap.RUM_APPLICATION_VIEW,
  },
  {
    modelType: InventoryItem,
    listPageKey: PageMap.INVENTORY_ITEMS,
    viewPageKey: PageMap.INVENTORY_VIEW,
  },
];

export function getDeveloperDocsResource(
  modelType: DatabaseBaseModelType,
): DeveloperDocsResource {
  const resource: DeveloperDocsResource | undefined =
    DEVELOPER_DOCS_RESOURCES.find(
      (candidate: DeveloperDocsResource): boolean => {
        return candidate.modelType === modelType;
      },
    );

  if (!resource) {
    throw new Error(
      `${modelType.name} has no Developer pages: add it to DEVELOPER_DOCS_RESOURCES.`,
    );
  }

  return resource;
}

export function getDeveloperDocsSingularName(
  resource: DeveloperDocsResource,
): string {
  const model: DatabaseBaseModel = new resource.modelType();

  return resource.singularName || model.singularName || model.tableName || "";
}

export function getDeveloperDocsPluralName(
  resource: DeveloperDocsResource,
): string {
  const model: DatabaseBaseModel = new resource.modelType();

  return (
    resource.pluralName ||
    model.pluralName ||
    `${getDeveloperDocsSingularName(resource)}s`
  );
}

export function getDeveloperDocsParentPageKey(
  resource: DeveloperDocsResource,
  scope: DeveloperDocsScope,
): PageMap | undefined {
  return scope === DeveloperDocsScope.List
    ? resource.listPageKey
    : resource.viewPageKey;
}

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
  resource: DeveloperDocsResource;
  scope: DeveloperDocsScope;
}

// The Developer pages under a page: three when it is a registered list or view page.
export function getDeveloperDocsChildPages(
  parentPageKey: string,
): Array<DeveloperDocsChildPage> {
  const children: Array<DeveloperDocsChildPage> = [];

  for (const resource of DEVELOPER_DOCS_RESOURCES) {
    for (const scope of [DeveloperDocsScope.List, DeveloperDocsScope.View]) {
      if (getDeveloperDocsParentPageKey(resource, scope) !== parentPageKey) {
        continue;
      }

      for (const page of DEVELOPER_DOCS_PAGES) {
        children.push({
          key: getDeveloperDocsPageKey(parentPageKey as PageMap, page.type),
          page,
          resource,
          scope,
        });
      }
    }
  }

  return children;
}

/*
 * The RouteMap entries of every Developer page: `<parent route>/developer/
 * terraform` and so on, for every registered list and view page. RouteMap
 * adds them when it loads, so these pages are in the route table the
 * breadcrumbs and the active menu entry are worked out from, like any other
 * page. Takes the route table rather than importing it, because RouteMap
 * imports this file.
 */
export function getDeveloperDocsRouteMapEntries(
  routeMap: Dictionary<Route>,
): Dictionary<Route> {
  const entries: Dictionary<Route> = {};

  for (const resource of DEVELOPER_DOCS_RESOURCES) {
    for (const scope of [DeveloperDocsScope.List, DeveloperDocsScope.View]) {
      const parentPageKey: PageMap | undefined = getDeveloperDocsParentPageKey(
        resource,
        scope,
      );
      const parentRoute: Route | undefined = parentPageKey
        ? routeMap[parentPageKey]
        : undefined;

      if (!parentPageKey || !parentRoute) {
        continue;
      }

      for (const page of DEVELOPER_DOCS_PAGES) {
        entries[getDeveloperDocsPageKey(parentPageKey, page.type)] = new Route(
          `${parentRoute.toString().replace(/\/+$/, "")}/${getDeveloperDocsRelativePath(page.type)}`,
        );
      }
    }
  }

  return entries;
}
