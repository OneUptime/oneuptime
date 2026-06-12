import React, { FunctionComponent, ReactElement } from "react";
import DashboardProxmoxGuestListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardProxmoxGuestListComponent";
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
import {
  HoneycombLegendItem,
  HoneycombTile,
} from "./DashboardResourceHoneycomb";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardProxmoxGuestListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Guest", widthPct: "26%" },
  { label: "VMID", widthPct: "10%" },
  { label: "Type", widthPct: "10%" },
  { label: "Status", widthPct: "17%" },
  { label: "Node", widthPct: "17%" },
  { label: "Cluster", widthPct: "20%" },
];

/*
 * "Stopped" is gray, not red — a stopped guest is often a planned
 * shutdown (template VMs, batch workers). The error color is reserved
 * for HA-managed guests whose HA state is error/fence, which is always
 * actionable.
 */
const GUEST_COLORS: {
  running: string;
  stopped: string;
  haError: string;
  unknown: string;
} = {
  running: "#10b981",
  stopped: "#9ca3af",
  haError: "#ef4444",
  unknown: "#d1d5db",
};

const GUEST_LEGEND: Array<HoneycombLegendItem> = [
  { label: "Running", color: GUEST_COLORS.running },
  { label: "Stopped", color: GUEST_COLORS.stopped },
  { label: "HA Error", color: GUEST_COLORS.haError },
  { label: "Unknown", color: GUEST_COLORS.unknown },
];

const BASE_SELECT: Select<ProxmoxResource> = {
  _id: true,
  name: true,
  externalId: true,
  vmid: true,
  guestType: true,
  parentNodeName: true,
  isUp: true,
  haState: true,
  lastSeenAt: true,
  proxmoxClusterId: true,
  proxmoxCluster: {
    name: true,
  },
};

/*
 * Guest rows link straight to the guest detail page. The detail-route
 * param is the pve externalId ("qemu/100", "lxc/101") percent-encoded
 * as a single path segment (see Pages/Proxmox/Utils/
 * ProxmoxResourceUtils routeParamFromExternalId). Rows without an
 * externalId fall back to the cluster's Guests list.
 */
function getGuestRoute(r: ProxmoxResource): Route | undefined {
  const clusterId: string = (r.proxmoxClusterId?.toString() as string) || "";
  if (!clusterId) {
    return undefined;
  }
  const externalId: string = (r.externalId as string) || "";
  if (!externalId) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_GUESTS] as Route,
      { modelId: new ObjectID(clusterId) },
    );
  }
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_GUEST_DETAIL] as Route,
    {
      modelId: new ObjectID(clusterId),
      subModelId: encodeURIComponent(externalId),
    },
  );
}

function getGuestStatus(r: ProxmoxResource): {
  text: string;
  dot: string;
  textColor: string;
} {
  const haState: string = ((r.haState as string) || "").toLowerCase();
  if (haState === "error" || haState === "fence") {
    return {
      text: `HA ${haState}`,
      dot: GUEST_COLORS.haError,
      textColor: "#b91c1c",
    };
  }
  const isUp: boolean | undefined = r.isUp as boolean | undefined;
  if (isUp === true) {
    return { text: "Running", dot: GUEST_COLORS.running, textColor: "#047857" };
  }
  if (isUp === false) {
    return { text: "Stopped", dot: GUEST_COLORS.stopped, textColor: "#6b7280" };
  }
  return { text: "Unknown", dot: GUEST_COLORS.unknown, textColor: "#9ca3af" };
}

function getGuestDisplayName(r: ProxmoxResource): string {
  return (r.name as string) || (r.externalId as string) || "Unnamed";
}

function renderGuestRow(r: ProxmoxResource): ReactElement {
  const id: string = (r._id as string) || "";
  const name: string = getGuestDisplayName(r);
  const status: { text: string; dot: string; textColor: string } =
    getGuestStatus(r);
  const clusterName: string = (r.proxmoxCluster?.name as string) || "—";
  const route: Route | undefined = getGuestRoute(r);

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
      <td className="px-3 py-2 text-xs text-gray-500">
        {r.vmid !== undefined && r.vmid !== null ? String(r.vmid) : "—"}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 uppercase">
        {(r.guestType as string) || "—"}
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
      <td className="px-3 py-2 text-xs text-gray-500 truncate">
        {(r.parentNodeName as string) || "—"}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 truncate">
        {clusterName}
      </td>
    </tr>
  );
}

function buildGuestTile(r: ProxmoxResource): HoneycombTile {
  const id: string = (r._id as string) || "";
  const name: string = getGuestDisplayName(r);
  const status: { text: string; dot: string; textColor: string } =
    getGuestStatus(r);
  const clusterName: string = (r.proxmoxCluster?.name as string) || "—";

  return {
    id: id || name,
    status: status.text,
    color: status.dot,
    route: getGuestRoute(r),
    tooltip: {
      title: name,
      details: [
        {
          label: "VMID",
          value: r.vmid !== undefined && r.vmid !== null ? String(r.vmid) : "—",
        },
        { label: "Type", value: (r.guestType as string) || "—" },
        { label: "Node", value: (r.parentNodeName as string) || "—" },
        { label: "Cluster", value: clusterName },
      ],
    },
  };
}

const DashboardProxmoxGuestListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const args: DashboardProxmoxGuestListComponent["arguments"] =
    props.component.arguments;

  const query: Query<ProxmoxResource> = {
    kind: "Guest",
  } as Query<ProxmoxResource>;

  if (args.proxmoxClusterIds && args.proxmoxClusterIds.length > 0) {
    (query as Record<string, unknown>)["proxmoxClusterId"] = new Includes(
      args.proxmoxClusterIds,
    );
  }

  if (args.guestTypeFilter === "qemu" || args.guestTypeFilter === "lxc") {
    (query as Record<string, unknown>)["guestType"] = args.guestTypeFilter;
  }

  if (args.statusFilter === "running") {
    (query as Record<string, unknown>)["isUp"] = true;
  } else if (args.statusFilter === "stopped") {
    (query as Record<string, unknown>)["isUp"] = false;
  }

  const viewMode: ResourceListViewMode =
    args.viewMode === "honeycomb" ? "honeycomb" : "list";

  return (
    <DashboardModelResourceListBase<ProxmoxResource>
      modelType={ProxmoxResource}
      publicResourceType="proxmox-resource"
      title={args.title}
      pluralLabel="guests"
      emptyMessage="No Proxmox guests found"
      emptyIcon={IconProp.Cube}
      columns={COLUMNS}
      maxRows={args.maxRows || 25}
      query={query}
      select={BASE_SELECT}
      sort={{ name: SortOrder.Ascending }}
      refreshTick={props.refreshTick}
      variables={props.variables}
      attributeToColumn={undefined}
      renderRow={renderGuestRow}
      viewMode={viewMode}
      renderHoneycombTile={buildGuestTile}
      honeycombLegend={GUEST_LEGEND}
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
  DashboardProxmoxGuestListComponentElement,
  arePropsEqual,
);
