import React, { FunctionComponent, ReactElement } from "react";
import DashboardDockerSwarmServiceListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardDockerSwarmServiceListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import {
  ResourceListColumn,
  ResourceListViewMode,
} from "./DashboardResourceListBase";
import DashboardModelResourceListBase from "../../Infrastructure/DashboardModelResourceListBase";
import IconProp from "Common/Types/Icon/IconProp";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import DockerSwarmResource from "Common/Models/DatabaseModels/DockerSwarmResource";
import JSONFunctions from "Common/Types/JSONFunctions";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import AppLink from "../../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import {
  HoneycombLegendItem,
  HoneycombTile,
} from "./DashboardResourceHoneycomb";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardDockerSwarmServiceListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Service", widthPct: "26%" },
  { label: "Mode", widthPct: "14%" },
  { label: "Replicas", widthPct: "13%" },
  { label: "Status", widthPct: "16%" },
  { label: "Image", widthPct: "31%" },
];

/*
 * A service is healthy (green) when it is fully converged (running ==
 * desired). A partially-converged service is amber (often a rolling
 * update in progress), and zero running tasks against a non-zero desired
 * count is red. Global services (no desired count) are green when they
 * report any running task.
 */
const SERVICE_COLORS: {
  converged: string;
  degraded: string;
  down: string;
  unknown: string;
} = {
  converged: "#10b981",
  degraded: "#f59e0b",
  down: "#ef4444",
  unknown: "#9ca3af",
};

const SERVICE_LEGEND: Array<HoneycombLegendItem> = [
  { label: "Converged", color: SERVICE_COLORS.converged },
  { label: "Degraded", color: SERVICE_COLORS.degraded },
  { label: "Down", color: SERVICE_COLORS.down },
  { label: "Unknown", color: SERVICE_COLORS.unknown },
];

const BASE_SELECT: Select<DockerSwarmResource> = {
  _id: true,
  name: true,
  externalId: true,
  serviceMode: true,
  desiredReplicas: true,
  runningReplicas: true,
  image: true,
  state: true,
  isReady: true,
  lastSeenAt: true,
  dockerSwarmClusterId: true,
  dockerSwarmCluster: {
    name: true,
  },
};

/*
 * Replicas badge: "running/desired" (e.g. "3/3"). Global services have
 * no desired count, so just the running count is shown.
 */
function formatReplicas(r: DockerSwarmResource): string {
  const running: number | null =
    r.runningReplicas !== null && r.runningReplicas !== undefined
      ? Number(r.runningReplicas)
      : null;
  const desired: number | null =
    r.desiredReplicas !== null && r.desiredReplicas !== undefined
      ? Number(r.desiredReplicas)
      : null;
  if (running === null && desired === null) {
    return "—";
  }
  if (desired === null) {
    return `${running ?? 0}`;
  }
  return `${running ?? 0}/${desired}`;
}

/*
 * Service rows link straight to the service detail page. The detail-route
 * param is the swarm externalId ("service/<id>") percent-encoded as a
 * single path segment (see Pages/DockerSwarm/Utils/
 * DockerSwarmResourceUtils routeParamFromExternalId). Rows without an
 * externalId fall back to the cluster's Services list.
 */
function getServiceRoute(r: DockerSwarmResource): Route | undefined {
  const clusterId: string =
    (r.dockerSwarmClusterId?.toString() as string) || "";
  if (!clusterId) {
    return undefined;
  }
  const externalId: string = (r.externalId as string) || "";
  if (!externalId) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICES] as Route,
      { modelId: new ObjectID(clusterId) },
    );
  }
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICE_DETAIL] as Route,
    {
      modelId: new ObjectID(clusterId),
      subModelId: encodeURIComponent(externalId),
    },
  );
}

function getServiceDisplayName(r: DockerSwarmResource): string {
  return (r.name as string) || (r.externalId as string) || "Unnamed";
}

function getServiceStatus(r: DockerSwarmResource): {
  text: string;
  dot: string;
  textColor: string;
} {
  const running: number | null =
    r.runningReplicas !== null && r.runningReplicas !== undefined
      ? Number(r.runningReplicas)
      : null;
  const desired: number | null =
    r.desiredReplicas !== null && r.desiredReplicas !== undefined
      ? Number(r.desiredReplicas)
      : null;

  // Replicated service with a known desired count: compare running vs desired.
  if (desired !== null) {
    const have: number = running ?? 0;
    if (have >= desired && desired > 0) {
      return {
        text: "Converged",
        dot: SERVICE_COLORS.converged,
        textColor: "#047857",
      };
    }
    if (have <= 0) {
      return { text: "Down", dot: SERVICE_COLORS.down, textColor: "#b91c1c" };
    }
    return {
      text: `${have}/${desired}`,
      dot: SERVICE_COLORS.degraded,
      textColor: "#b45309",
    };
  }

  // Global service (or unknown desired): fall back to readiness / running.
  const isReady: boolean | undefined = r.isReady as boolean | undefined;
  if (isReady === true || (running !== null && running > 0)) {
    return {
      text: "Converged",
      dot: SERVICE_COLORS.converged,
      textColor: "#047857",
    };
  }
  if (isReady === false || running === 0) {
    return { text: "Down", dot: SERVICE_COLORS.down, textColor: "#b91c1c" };
  }
  return {
    text: "Unknown",
    dot: SERVICE_COLORS.unknown,
    textColor: "#6b7280",
  };
}

function renderServiceRow(r: DockerSwarmResource): ReactElement {
  const id: string = (r._id as string) || "";
  const name: string = getServiceDisplayName(r);
  const status: { text: string; dot: string; textColor: string } =
    getServiceStatus(r);
  const route: Route | undefined = getServiceRoute(r);

  let detailLink: ReactElement = <span>{name}</span>;
  if (route) {
    detailLink = (
      <AppLink
        to={route}
        className="hover:underline text-gray-700 group-hover:text-blue-600"
      >
        {name}
      </AppLink>
    );
  }

  return (
    <tr
      key={id}
      className="hover:bg-gray-50/50 transition-colors duration-100 group"
    >
      <td className="px-3 py-2 text-xs text-gray-700 truncate">{detailLink}</td>
      <td className="px-3 py-2 text-xs text-gray-500 capitalize">
        {(r.serviceMode as string) || "—"}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500">{formatReplicas(r)}</td>
      <td className="px-3 py-2">
        <span
          className="inline-flex items-center gap-1.5 text-xs font-medium"
          style={{ fontSize: "10px" }}
        >
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: status.dot }}
          ></span>
          <span style={{ color: status.textColor }}>{status.text}</span>
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 truncate">
        {(r.image as string) || "—"}
      </td>
    </tr>
  );
}

function buildServiceTile(r: DockerSwarmResource): HoneycombTile {
  const id: string = (r._id as string) || "";
  const name: string = getServiceDisplayName(r);
  const status: { text: string; dot: string; textColor: string } =
    getServiceStatus(r);
  const clusterName: string = (r.dockerSwarmCluster?.name as string) || "—";

  return {
    id: id || name,
    status: status.text,
    color: status.dot,
    route: getServiceRoute(r),
    tooltip: {
      title: name,
      details: [
        { label: "Mode", value: (r.serviceMode as string) || "—" },
        { label: "Replicas", value: formatReplicas(r) },
        { label: "Image", value: (r.image as string) || "—" },
        { label: "Cluster", value: clusterName },
      ],
    },
  };
}

const DashboardDockerSwarmServiceListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const args: DashboardDockerSwarmServiceListComponent["arguments"] =
    props.component.arguments;

  const query: Query<DockerSwarmResource> = {
    kind: "Service",
  } as Query<DockerSwarmResource>;

  if (args.dockerSwarmClusterIds && args.dockerSwarmClusterIds.length > 0) {
    (query as Record<string, unknown>)["dockerSwarmClusterId"] = new Includes(
      args.dockerSwarmClusterIds,
    );
  }

  if (
    args.serviceModeFilter === "replicated" ||
    args.serviceModeFilter === "global"
  ) {
    (query as Record<string, unknown>)["serviceMode"] = args.serviceModeFilter;
  }

  if (args.statusFilter === "converged") {
    (query as Record<string, unknown>)["isReady"] = true;
  } else if (args.statusFilter === "notconverged") {
    (query as Record<string, unknown>)["isReady"] = false;
  }

  const viewMode: ResourceListViewMode =
    args.viewMode === "honeycomb" ? "honeycomb" : "list";

  return (
    <DashboardModelResourceListBase<DockerSwarmResource>
      modelType={DockerSwarmResource}
      publicResourceType="docker-swarm-resource"
      title={args.title}
      pluralLabel="services"
      emptyMessage="No Docker Swarm services found"
      emptyIcon={IconProp.Cube}
      columns={COLUMNS}
      maxRows={args.maxRows || 25}
      query={query}
      select={BASE_SELECT}
      sort={{ name: SortOrder.Ascending }}
      refreshTick={props.refreshTick}
      variables={props.variables}
      attributeToColumn={undefined}
      renderRow={renderServiceRow}
      viewMode={viewMode}
      renderHoneycombTile={buildServiceTile}
      honeycombLegend={SERVICE_LEGEND}
    />
  );
};

function arePropsEqual(prev: ComponentProps, next: ComponentProps): boolean {
  if (
    prev.componentId.toString() !== next.componentId.toString() ||
    prev.refreshTick !== next.refreshTick ||
    prev.isEditMode !== next.isEditMode ||
    prev.isSelected !== next.isSelected ||
    prev.dashboardComponentWidthInPx !== next.dashboardComponentWidthInPx ||
    prev.dashboardComponentHeightInPx !== next.dashboardComponentHeightInPx
  ) {
    return false;
  }

  if (
    !JSONFunctions.deepEqual(prev.component.arguments, next.component.arguments)
  ) {
    return false;
  }

  return JSONFunctions.deepEqual(prev.variables, next.variables);
}

export default React.memo(
  DashboardDockerSwarmServiceListComponentElement,
  arePropsEqual,
);
