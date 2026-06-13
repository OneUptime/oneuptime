import React, { FunctionComponent, ReactElement } from "react";
import DashboardProxmoxNodeListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardProxmoxNodeListComponent";
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
import ProxmoxResource from "Common/Models/DatabaseModels/ProxmoxResource";
import JSONFunctions from "Common/Types/JSONFunctions";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import AppLink from "../../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { AttributeToColumnMap } from "Common/Utils/Dashboard/ModelQueryVariableInterpolation";
import {
  HoneycombLegendItem,
  HoneycombTile,
} from "./DashboardResourceHoneycomb";

/*
 * For PVE nodes the `pve.id` datapoint attribute (split out of the raw
 * `id` label, e.g. `node/pve1` -> `pve1`) IS the node name, so a
 * dashboard variable bound to pve.id narrows this list too. Guests and
 * storages have non-name pve.id values, which is why the guest widget
 * does not map it.
 */
const ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "pve.id": "name",
};

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardProxmoxNodeListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Node", widthPct: "30%" },
  { label: "Status", widthPct: "17%" },
  { label: "CPU", widthPct: "15%" },
  { label: "Memory", widthPct: "15%" },
  { label: "Cluster", widthPct: "23%" },
];

const NODE_LEGEND: Array<HoneycombLegendItem> = [
  { label: "Online", color: "#10b981" },
  { label: "Offline", color: "#ef4444" },
  { label: "Unknown", color: "#9ca3af" },
];

const BASE_SELECT: Select<ProxmoxResource> = {
  _id: true,
  name: true,
  externalId: true,
  isUp: true,
  latestCpuPercent: true,
  latestMemoryPercent: true,
  lastSeenAt: true,
  proxmoxClusterId: true,
  proxmoxCluster: {
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
 * param is the pve externalId ("node/pve1") percent-encoded as a
 * single path segment (see Pages/Proxmox/Utils/ProxmoxResourceUtils
 * routeParamFromExternalId). Rows without an externalId fall back to
 * the cluster's Nodes list.
 */
function getNodeRoute(r: ProxmoxResource): Route | undefined {
  const clusterId: string = (r.proxmoxClusterId?.toString() as string) || "";
  if (!clusterId) {
    return undefined;
  }
  const externalId: string = (r.externalId as string) || "";
  if (!externalId) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_NODES] as Route,
      { modelId: new ObjectID(clusterId) },
    );
  }
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_NODE_DETAIL] as Route,
    {
      modelId: new ObjectID(clusterId),
      subModelId: encodeURIComponent(externalId),
    },
  );
}

function getNodeDisplayName(r: ProxmoxResource): string {
  return (r.name as string) || (r.externalId as string) || "Unnamed";
}

function getNodeStatus(r: ProxmoxResource): {
  text: string;
  dot: string;
  textColor: string;
} {
  const isUp: boolean | undefined = r.isUp as boolean | undefined;
  if (isUp === true) {
    return { text: "Online", dot: "#10b981", textColor: "#047857" };
  }
  if (isUp === false) {
    return { text: "Offline", dot: "#ef4444", textColor: "#b91c1c" };
  }
  return { text: "Unknown", dot: "#9ca3af", textColor: "#6b7280" };
}

function renderNodeRow(r: ProxmoxResource): ReactElement {
  const id: string = (r._id as string) || "";
  const name: string = getNodeDisplayName(r);
  const status: { text: string; dot: string; textColor: string } =
    getNodeStatus(r);
  const clusterName: string = (r.proxmoxCluster?.name as string) || "—";
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

function buildNodeTile(r: ProxmoxResource): HoneycombTile {
  const id: string = (r._id as string) || "";
  const name: string = getNodeDisplayName(r);
  const status: { text: string; dot: string; textColor: string } =
    getNodeStatus(r);
  const clusterName: string = (r.proxmoxCluster?.name as string) || "—";

  return {
    id: id || name,
    status: status.text,
    color: status.dot,
    route: getNodeRoute(r),
    tooltip: {
      title: name,
      details: [
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

const DashboardProxmoxNodeListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const args: DashboardProxmoxNodeListComponent["arguments"] =
    props.component.arguments;
  const statusFilter: string | undefined = args.statusFilter;

  const query: Query<ProxmoxResource> = {
    kind: "Node",
  } as Query<ProxmoxResource>;

  if (args.proxmoxClusterIds && args.proxmoxClusterIds.length > 0) {
    (query as Record<string, unknown>)["proxmoxClusterId"] = new Includes(
      args.proxmoxClusterIds,
    );
  }

  if (statusFilter === "online") {
    (query as Record<string, unknown>)["isUp"] = true;
  } else if (statusFilter === "offline") {
    (query as Record<string, unknown>)["isUp"] = false;
  }

  const viewMode: ResourceListViewMode =
    args.viewMode === "honeycomb" ? "honeycomb" : "list";

  return (
    <DashboardModelResourceListBase<ProxmoxResource>
      modelType={ProxmoxResource}
      publicResourceType="proxmox-resource"
      title={args.title}
      pluralLabel="nodes"
      emptyMessage="No Proxmox nodes found"
      emptyIcon={IconProp.ServerStack}
      columns={COLUMNS}
      maxRows={args.maxRows || 25}
      query={query}
      select={BASE_SELECT}
      sort={{ name: SortOrder.Ascending }}
      refreshTick={props.refreshTick}
      variables={props.variables}
      attributeToColumn={ATTRIBUTE_TO_COLUMN}
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
  DashboardProxmoxNodeListComponentElement,
  arePropsEqual,
);
