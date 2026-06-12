import React, { FunctionComponent, ReactElement } from "react";
import DashboardCephOsdListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardCephOsdListComponent";
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
import CephResource from "Common/Models/DatabaseModels/CephResource";
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
 * `ceph_daemon` is the datapoint label every per-OSD series carries
 * (osd.0, osd.1, ...) and is stored verbatim as CephResource.externalId,
 * so a dashboard variable bound to ceph_daemon narrows this list too.
 */
const ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  ceph_daemon: "externalId",
};

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardCephOsdListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "OSD", widthPct: "20%" },
  { label: "Host", widthPct: "20%" },
  { label: "State", widthPct: "20%" },
  { label: "Used", widthPct: "22%" },
  { label: "Cluster", widthPct: "18%" },
];

/*
 * The classic OSD-wall palette: down-but-in is the dangerous state
 * (data is degraded and Ceph is waiting before it rebalances) so it is
 * red; up-but-out (draining/rebalancing away) is amber; down-and-out is
 * gray because the cluster has already re-replicated around it.
 */
const OSD_COLORS: {
  upIn: string;
  upOut: string;
  downIn: string;
  downOut: string;
  unknown: string;
} = {
  upIn: "#10b981",
  upOut: "#f59e0b",
  downIn: "#ef4444",
  downOut: "#6b7280",
  unknown: "#d1d5db",
};

const OSD_LEGEND: Array<HoneycombLegendItem> = [
  { label: "Up & In", color: OSD_COLORS.upIn },
  { label: "Up & Out", color: OSD_COLORS.upOut },
  { label: "Down & In", color: OSD_COLORS.downIn },
  { label: "Down & Out", color: OSD_COLORS.downOut },
  { label: "Unknown", color: OSD_COLORS.unknown },
];

const BASE_SELECT: Select<CephResource> = {
  _id: true,
  name: true,
  externalId: true,
  hostname: true,
  deviceClass: true,
  isUp: true,
  isIn: true,
  statBytes: true,
  statBytesUsed: true,
  lastSeenAt: true,
  cephClusterId: true,
  cephCluster: {
    name: true,
  },
};

/*
 * OSD rows link to the cluster's OSDs page — per-resource detail routes
 * are the WI-7 deliverable; tighten the link to the OSD detail page once
 * CEPH_CLUSTER_VIEW_OSD_DETAIL exists in PageMap.
 */
function getClusterOsdsRoute(r: CephResource): Route | undefined {
  const clusterId: string = (r.cephClusterId?.toString() as string) || "";
  if (!clusterId) {
    return undefined;
  }
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.CEPH_CLUSTER_VIEW_OSDS] as Route,
    { modelId: new ObjectID(clusterId) },
  );
}

function getOsdState(r: CephResource): {
  text: string;
  color: string;
  textColor: string;
} {
  const isUp: boolean | undefined = r.isUp as boolean | undefined;
  const isIn: boolean | undefined = r.isIn as boolean | undefined;

  if (isUp === undefined || isIn === undefined) {
    return { text: "Unknown", color: OSD_COLORS.unknown, textColor: "#9ca3af" };
  }
  if (isUp && isIn) {
    return { text: "Up & In", color: OSD_COLORS.upIn, textColor: "#047857" };
  }
  if (isUp && !isIn) {
    return { text: "Up & Out", color: OSD_COLORS.upOut, textColor: "#b45309" };
  }
  if (!isUp && isIn) {
    return {
      text: "Down & In",
      color: OSD_COLORS.downIn,
      textColor: "#b91c1c",
    };
  }
  return {
    text: "Down & Out",
    color: OSD_COLORS.downOut,
    textColor: "#4b5563",
  };
}

function getUsedPercent(r: CephResource): number | null {
  const total: number = Number(r.statBytes);
  const used: number = Number(r.statBytesUsed);
  if (!Number.isFinite(total) || !Number.isFinite(used) || total <= 0) {
    return null;
  }
  return (used / total) * 100;
}

function getUsageBarColor(percent: number): string {
  if (percent >= 85) {
    return "#ef4444";
  }
  if (percent >= 70) {
    return "#f59e0b";
  }
  return "#10b981";
}

function renderUsageBar(percent: number | null): ReactElement {
  if (percent === null) {
    return <span className="text-xs text-gray-400">—</span>;
  }
  const clamped: number = Math.max(0, Math.min(100, percent));
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-12 rounded-full bg-gray-100 overflow-hidden flex-shrink-0">
        <div
          className="h-full rounded-full"
          style={{
            width: `${clamped}%`,
            backgroundColor: getUsageBarColor(clamped),
          }}
        ></div>
      </div>
      <span className="text-xs text-gray-500">{clamped.toFixed(0)}%</span>
    </div>
  );
}

function getOsdDisplayName(r: CephResource): string {
  return (r.externalId as string) || (r.name as string) || "Unnamed";
}

function renderOsdRow(r: CephResource): ReactElement {
  const id: string = (r._id as string) || "";
  const name: string = getOsdDisplayName(r);
  const state: { text: string; color: string; textColor: string } =
    getOsdState(r);
  const clusterName: string = (r.cephCluster?.name as string) || "—";
  const route: Route | undefined = getClusterOsdsRoute(r);

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
      <td className="px-3 py-2 text-xs text-gray-500 truncate">
        {(r.hostname as string) || "—"}
      </td>
      <td className="px-3 py-2">
        <span
          className="inline-flex items-center gap-1.5 text-xs font-medium"
          style={{ fontSize: "10px" }}
        >
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: state.color }}
          ></span>
          <span style={{ color: state.textColor }}>{state.text}</span>
        </span>
      </td>
      <td className="px-3 py-2">{renderUsageBar(getUsedPercent(r))}</td>
      <td className="px-3 py-2 text-xs text-gray-500 truncate">
        {clusterName}
      </td>
    </tr>
  );
}

function buildOsdTile(r: CephResource): HoneycombTile {
  const id: string = (r._id as string) || "";
  const name: string = getOsdDisplayName(r);
  const state: { text: string; color: string; textColor: string } =
    getOsdState(r);
  const clusterName: string = (r.cephCluster?.name as string) || "—";
  const usedPercent: number | null = getUsedPercent(r);

  return {
    id: id || name,
    status: state.text,
    color: state.color,
    route: getClusterOsdsRoute(r),
    tooltip: {
      title: name,
      details: [
        { label: "Host", value: (r.hostname as string) || "—" },
        { label: "Class", value: (r.deviceClass as string) || "—" },
        {
          label: "Used",
          value: usedPercent === null ? "—" : `${usedPercent.toFixed(0)}%`,
        },
        { label: "Cluster", value: clusterName },
      ],
    },
  };
}

const DashboardCephOsdListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const args: DashboardCephOsdListComponent["arguments"] =
    props.component.arguments;
  const stateFilter: string | undefined = args.stateFilter;

  const query: Query<CephResource> = {
    kind: "Osd",
  } as Query<CephResource>;

  if (args.cephClusterIds && args.cephClusterIds.length > 0) {
    (query as Record<string, unknown>)["cephClusterId"] = new Includes(
      args.cephClusterIds,
    );
  }

  if (stateFilter === "up") {
    (query as Record<string, unknown>)["isUp"] = true;
  } else if (stateFilter === "down") {
    (query as Record<string, unknown>)["isUp"] = false;
  } else if (stateFilter === "out") {
    (query as Record<string, unknown>)["isIn"] = false;
  }

  /*
   * Honeycomb is the default for this widget (the OSD wall) — the
   * component util seeds viewMode: "honeycomb", and an unset value falls
   * back to honeycomb too so template-created widgets get the wall.
   */
  const viewMode: ResourceListViewMode =
    args.viewMode === "list" ? "list" : "honeycomb";

  return (
    <DashboardModelResourceListBase<CephResource>
      modelType={CephResource}
      publicResourceType="ceph-resource"
      title={args.title}
      pluralLabel="OSDs"
      emptyMessage="No Ceph OSDs found"
      emptyIcon={IconProp.SquareStack}
      columns={COLUMNS}
      maxRows={args.maxRows || 25}
      query={query}
      select={BASE_SELECT}
      sort={{ externalId: SortOrder.Ascending }}
      refreshTick={props.refreshTick}
      variables={props.variables}
      attributeToColumn={ATTRIBUTE_TO_COLUMN}
      renderRow={renderOsdRow}
      viewMode={viewMode}
      renderHoneycombTile={buildOsdTile}
      honeycombLegend={OSD_LEGEND}
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

export default React.memo(DashboardCephOsdListComponentElement, arePropsEqual);
