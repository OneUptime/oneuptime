import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import Query from "Common/Types/BaseDatabase/Query";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import PageMap from "../../Utils/PageMap";

/*
 * The pure half of AuditLogsTable: how each resource type is drawn and where
 * its entries link to, and which rows a table instance asks for. Kept free of
 * RouteMap, Navigation and Common/UI/Config - all three read `window` at
 * module load - so plain-node tests can import it.
 */

export interface ResourceMeta {
  icon: IconProp;
  color: string;
  bgColor: string;
  viewRoute?: PageMap | undefined;
  /*
   * Which id fills the view route's :modelId. "resource" (the default) opens
   * the resource the entry changed. "root" opens the page of the resource the
   * entry rolls up to: an SLO burn-rate rule has no page of its own, only a
   * tab on its SLO.
   */
  viewRouteModelId?: "resource" | "root" | undefined;
}

export const RESOURCE_META: { [key: string]: ResourceMeta } = {
  Monitor: {
    icon: IconProp.AltGlobe,
    color: "text-blue-600",
    bgColor: "bg-blue-50 border-blue-100",
    viewRoute: PageMap.MONITOR_VIEW,
  },
  "Monitor Group": {
    icon: IconProp.Folder,
    color: "text-blue-700",
    bgColor: "bg-blue-50 border-blue-100",
    viewRoute: PageMap.MONITOR_GROUP_VIEW,
  },
  Incident: {
    icon: IconProp.Alert,
    color: "text-red-600",
    bgColor: "bg-red-50 border-red-100",
    viewRoute: PageMap.INCIDENT_VIEW,
  },
  "Incident Episode": {
    icon: IconProp.Alert,
    color: "text-red-700",
    bgColor: "bg-red-50 border-red-100",
    viewRoute: PageMap.INCIDENT_EPISODE_VIEW,
  },
  Alert: {
    icon: IconProp.Bell,
    color: "text-orange-600",
    bgColor: "bg-orange-50 border-orange-100",
    viewRoute: PageMap.ALERT_VIEW,
  },
  "Alert Episode": {
    icon: IconProp.Bell,
    color: "text-orange-700",
    bgColor: "bg-orange-50 border-orange-100",
    viewRoute: PageMap.ALERT_EPISODE_VIEW,
  },
  "Status Page": {
    icon: IconProp.Window,
    color: "text-indigo-600",
    bgColor: "bg-indigo-50 border-indigo-100",
    viewRoute: PageMap.STATUS_PAGE_VIEW,
  },
  "Scheduled Maintenance Event": {
    icon: IconProp.Clock,
    color: "text-yellow-700",
    bgColor: "bg-yellow-50 border-yellow-100",
    viewRoute: PageMap.SCHEDULED_MAINTENANCE_VIEW,
  },
  "On-Call Policy": {
    icon: IconProp.Call,
    color: "text-purple-600",
    bgColor: "bg-purple-50 border-purple-100",
    viewRoute: PageMap.ON_CALL_DUTY_POLICY_VIEW,
  },
  "On-Call Policy Schedule": {
    icon: IconProp.Calendar,
    color: "text-purple-700",
    bgColor: "bg-purple-50 border-purple-100",
    viewRoute: PageMap.ON_CALL_DUTY_SCHEDULE_VIEW,
  },
  "Incoming Call Policy": {
    icon: IconProp.Call,
    color: "text-purple-700",
    bgColor: "bg-purple-50 border-purple-100",
    viewRoute: PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW,
  },
  Service: {
    icon: IconProp.SquareStack,
    color: "text-fuchsia-700",
    bgColor: "bg-fuchsia-50 border-fuchsia-100",
    viewRoute: PageMap.SERVICE_VIEW,
  },
  /*
   * An SLO and the rows it owns share one colour, so on the project-wide log
   * a rule or owner change visibly belongs with its SLO's own entries.
   */
  "Service Level Objective": {
    icon: IconProp.Gauge,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50 border-emerald-100",
    viewRoute: PageMap.SLO_VIEW,
  },
  "SLO Burn Rate Rule": {
    icon: IconProp.Fire,
    color: "text-emerald-700",
    bgColor: "bg-emerald-50 border-emerald-100",
    viewRoute: PageMap.SLO_VIEW_BURN_RATE_RULES,
    viewRouteModelId: "root",
  },
  "SLO Monitor Rule": {
    icon: IconProp.Filter,
    color: "text-emerald-700",
    bgColor: "bg-emerald-50 border-emerald-100",
    viewRoute: PageMap.SLO_VIEW_MONITOR_RULES,
    viewRouteModelId: "root",
  },
  "Service Level Objective User Owner": {
    icon: IconProp.User,
    color: "text-emerald-700",
    bgColor: "bg-emerald-50 border-emerald-100",
    viewRoute: PageMap.SLO_VIEW_OWNERS,
    viewRouteModelId: "root",
  },
  "Service Level Objective Team Owner": {
    icon: IconProp.Team,
    color: "text-emerald-700",
    bgColor: "bg-emerald-50 border-emerald-100",
    viewRoute: PageMap.SLO_VIEW_OWNERS,
    viewRouteModelId: "root",
  },
  Runbook: {
    icon: IconProp.BookOpen,
    color: "text-amber-700",
    bgColor: "bg-amber-50 border-amber-100",
    viewRoute: PageMap.RUNBOOK_VIEW,
  },
  Dashboard: {
    icon: IconProp.Window,
    color: "text-indigo-700",
    bgColor: "bg-indigo-50 border-indigo-100",
    viewRoute: PageMap.DASHBOARD_VIEW,
  },
  Host: {
    icon: IconProp.Server,
    color: "text-teal-700",
    bgColor: "bg-teal-50 border-teal-100",
    viewRoute: PageMap.HOST_VIEW,
  },
  "Docker Host": {
    icon: IconProp.Cube,
    color: "text-cyan-700",
    bgColor: "bg-cyan-50 border-cyan-100",
    viewRoute: PageMap.DOCKER_HOST_VIEW,
  },
  "Kubernetes Cluster": {
    icon: IconProp.Cube,
    color: "text-blue-700",
    bgColor: "bg-blue-50 border-blue-100",
    viewRoute: PageMap.KUBERNETES_CLUSTER_VIEW,
  },
  "API Key": {
    icon: IconProp.Key,
    color: "text-violet-600",
    bgColor: "bg-violet-50 border-violet-100",
  },
  Label: {
    icon: IconProp.Label,
    color: "text-pink-600",
    bgColor: "bg-pink-50 border-pink-100",
  },
  Team: {
    icon: IconProp.Team,
    color: "text-cyan-700",
    bgColor: "bg-cyan-50 border-cyan-100",
    viewRoute: PageMap.TEAM_VIEW,
  },
  Probe: {
    icon: IconProp.Signal,
    color: "text-emerald-700",
    bgColor: "bg-emerald-50 border-emerald-100",
    viewRoute: PageMap.MONITORS_SETTINGS_PROBE_VIEW,
  },
  Workflow: {
    icon: IconProp.Workflow,
    color: "text-slate-700",
    bgColor: "bg-slate-50 border-slate-200",
    viewRoute: PageMap.WORKFLOW_VIEW,
  },
};

export const DEFAULT_RESOURCE_META: ResourceMeta = {
  icon: IconProp.Cube,
  color: "text-gray-600",
  bgColor: "bg-gray-50 border-gray-200",
};

export const getResourceMeta: (type: string | undefined) => ResourceMeta = (
  type: string | undefined,
): ResourceMeta => {
  if (!type) {
    return DEFAULT_RESOURCE_META;
  }
  return RESOURCE_META[type] || DEFAULT_RESOURCE_META;
};

export const getActorInitials: (name: string | undefined) => string = (
  name: string | undefined,
): string => {
  if (!name) {
    return "?";
  }
  const parts: Array<string> = name.trim().split(/\s+/).slice(0, 2);
  return parts
    .map((p: string) => {
      return p.charAt(0).toUpperCase();
    })
    .join("");
};

export interface AuditLogsQueryOptions {
  projectId: ObjectID | null;
  resourceType?: string | undefined;
  resourceId?: ObjectID | undefined;
  rootResourceId?: ObjectID | undefined;
}

/*
 * Every filter that is given is combined with AND. A page that shows a
 * resource together with its children passes rootResourceId alone: a child's
 * entries carry the child's own resourceType and resourceId, so adding either
 * would filter the children straight back out.
 */
export const getAuditLogsQuery: (
  options: AuditLogsQueryOptions,
) => Query<AuditLog> = (options: AuditLogsQueryOptions): Query<AuditLog> => {
  const query: Query<AuditLog> = {};

  if (options.projectId) {
    query.projectId = options.projectId;
  }

  if (options.resourceType) {
    query.resourceType = options.resourceType;
  }

  if (options.resourceId) {
    query.resourceId = options.resourceId;
  }

  if (options.rootResourceId) {
    query.rootResourceId = options.rootResourceId;
  }

  return query;
};

type GetResourceLinkModelIdFunction = (data: {
  meta: ResourceMeta;
  action: string | undefined;
  resourceId: ObjectID | undefined;
  rootResourceId: ObjectID | undefined;
}) => ObjectID | null;

/*
 * The id an entry's resource link opens, or null when it has nowhere to go.
 */
export const getResourceLinkModelId: GetResourceLinkModelIdFunction = (data: {
  meta: ResourceMeta;
  action: string | undefined;
  resourceId: ObjectID | undefined;
  rootResourceId: ObjectID | undefined;
}): ObjectID | null => {
  if (!data.meta.viewRoute) {
    return null;
  }

  if (data.meta.viewRouteModelId === "root") {
    /*
     * The page is a tab on the parent, which outlives the child: a deleted
     * rule's entry still opens the SLO it belonged to.
     */
    return data.rootResourceId || null;
  }

  // A deleted resource has no page left to open.
  if (data.action === "Delete") {
    return null;
  }

  return data.resourceId || null;
};
