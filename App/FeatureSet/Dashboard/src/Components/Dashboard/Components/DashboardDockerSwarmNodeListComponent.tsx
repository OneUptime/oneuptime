import React, { FunctionComponent, ReactElement } from "react";
import DashboardDockerSwarmNodeListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardDockerSwarmNodeListComponent";
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
  component: DashboardDockerSwarmNodeListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Node", widthPct: "26%" },
  { label: "Role", widthPct: "13%" },
  { label: "Status", widthPct: "16%" },
  { label: "CPU", widthPct: "13%" },
  { label: "Memory", widthPct: "13%" },
  { label: "Cluster", widthPct: "19%" },
];

const NODE_LEGEND: Array<HoneycombLegendItem> = [
  { label: "Ready", color: "#10b981" },
  { label: "Not Ready", color: "#ef4444" },
  { label: "Unknown", color: "#9ca3af" },
];

const BASE_SELECT: Select<DockerSwarmResource> = {
  _id: true,
  name: true,
  externalId: true,
  role: true,
  state: true,
  isReady: true,
  latestCpuPercent: true,
  latestMemoryPercent: true,
  lastSeenAt: true,
  dockerSwarmClusterId: true,
  dockerSwarmCluster: {
    name: true,
  },
};

function formatPercent(value: number | undefined): string {
  const numeric: number = Number(value);
  if (value === undefined || value === null || Number.isNaN(numeric)) {
    return "—";
  }
  return `${numeric.toFixed(1)}%`;
}

/*
 * Node rows link straight to the node detail page. The detail-route
 * param is the swarm externalId ("node/<id>") percent-encoded as a
 * single path segment (see Pages/DockerSwarm/Utils/
 * DockerSwarmResourceUtils routeParamFromExternalId). Rows without an
 * externalId fall back to the cluster's Nodes list.
 */
function getNodeRoute(r: DockerSwarmResource): Route | undefined {
  const clusterId: string =
    (r.dockerSwarmClusterId?.toString() as string) || "";
  if (!clusterId) {
    return undefined;
  }
  const externalId: string = (r.externalId as string) || "";
  if (!externalId) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODES] as Route,
      { modelId: new ObjectID(clusterId) },
    );
  }
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODE_DETAIL] as Route,
    {
      modelId: new ObjectID(clusterId),
      subModelId: encodeURIComponent(externalId),
    },
  );
}

function getNodeDisplayName(r: DockerSwarmResource): string {
  return (r.name as string) || (r.externalId as string) || "Unnamed";
}

function getNodeStatus(r: DockerSwarmResource): {
  text: string;
  dot: string;
  textColor: string;
} {
  const state: string = ((r.state as string) || "").toLowerCase();
  if (state === "down") {
    return { text: "Down", dot: "#ef4444", textColor: "#b91c1c" };
  }
  const isReady: boolean | undefined = r.isReady as boolean | undefined;
  if (isReady === true) {
    return { text: "Ready", dot: "#10b981", textColor: "#047857" };
  }
  if (isReady === false) {
    return { text: "Not Ready", dot: "#ef4444", textColor: "#b91c1c" };
  }
  return { text: "Unknown", dot: "#9ca3af", textColor: "#6b7280" };
}

function renderNodeRow(r: DockerSwarmResource): ReactElement {
  const id: string = (r._id as string) || "";
  const name: string = getNodeDisplayName(r);
  const status: { text: string; dot: string; textColor: string } =
    getNodeStatus(r);
  const clusterName: string = (r.dockerSwarmCluster?.name as string) || "—";
  const route: Route | undefined = getNodeRoute(r);

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
        {(r.role as string) || "—"}
      </td>
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
      <td className="px-3 py-2 text-xs text-gray-500">
        {formatPercent(r.latestCpuPercent as number | undefined)}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500">
        {formatPercent(r.latestMemoryPercent as number | undefined)}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 truncate">
        {clusterName}
      </td>
    </tr>
  );
}

function buildNodeTile(r: DockerSwarmResource): HoneycombTile {
  const id: string = (r._id as string) || "";
  const name: string = getNodeDisplayName(r);
  const status: { text: string; dot: string; textColor: string } =
    getNodeStatus(r);
  const clusterName: string = (r.dockerSwarmCluster?.name as string) || "—";

  return {
    id: id || name,
    status: status.text,
    color: status.dot,
    route: getNodeRoute(r),
    tooltip: {
      title: name,
      details: [
        { label: "Role", value: (r.role as string) || "—" },
        { label: "Cluster", value: clusterName },
        {
          label: "CPU",
          value: formatPercent(r.latestCpuPercent as number | undefined),
        },
        {
          label: "Memory",
          value: formatPercent(r.latestMemoryPercent as number | undefined),
        },
      ],
    },
  };
}

const DashboardDockerSwarmNodeListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const args: DashboardDockerSwarmNodeListComponent["arguments"] =
    props.component.arguments;

  const query: Query<DockerSwarmResource> = {
    kind: "Node",
  } as Query<DockerSwarmResource>;

  if (args.dockerSwarmClusterIds && args.dockerSwarmClusterIds.length > 0) {
    (query as Record<string, unknown>)["dockerSwarmClusterId"] = new Includes(
      args.dockerSwarmClusterIds,
    );
  }

  if (args.roleFilter === "manager" || args.roleFilter === "worker") {
    (query as Record<string, unknown>)["role"] = args.roleFilter;
  }

  if (args.statusFilter === "ready") {
    (query as Record<string, unknown>)["isReady"] = true;
  } else if (args.statusFilter === "notready") {
    (query as Record<string, unknown>)["isReady"] = false;
  }

  const viewMode: ResourceListViewMode =
    args.viewMode === "honeycomb" ? "honeycomb" : "list";

  return (
    <DashboardModelResourceListBase<DockerSwarmResource>
      modelType={DockerSwarmResource}
      publicResourceType="docker-swarm-resource"
      title={args.title}
      pluralLabel="nodes"
      emptyMessage="No Docker Swarm nodes found"
      emptyIcon={IconProp.ServerStack}
      columns={COLUMNS}
      maxRows={args.maxRows || 25}
      query={query}
      select={BASE_SELECT}
      sort={{ name: SortOrder.Ascending }}
      refreshTick={props.refreshTick}
      variables={props.variables}
      attributeToColumn={undefined}
      renderRow={renderNodeRow}
      viewMode={viewMode}
      renderHoneycombTile={buildNodeTile}
      honeycombLegend={NODE_LEGEND}
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
  DashboardDockerSwarmNodeListComponentElement,
  arePropsEqual,
);
