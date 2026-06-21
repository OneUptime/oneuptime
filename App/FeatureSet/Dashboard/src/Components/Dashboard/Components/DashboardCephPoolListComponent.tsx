import React, { FunctionComponent, ReactElement } from "react";
import DashboardCephPoolListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardCephPoolListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import {
  ResourceListColumn,
  ResourceListViewMode,
} from "./DashboardResourceListBase";
import DashboardModelResourceListBase from "../../Infrastructure/DashboardModelResourceListBase";
import { formatMemoryValue } from "../../Infrastructure/ResourceTable";
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
 * `pool_id` is the datapoint label every per-pool data series carries
 * (the pool NAME only exists on ceph_pool_metadata) and is stored
 * verbatim as CephResource.externalId, so a dashboard variable bound to
 * pool_id narrows this list too.
 */
const ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  pool_id: "externalId",
};

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardCephPoolListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Pool", widthPct: "26%" },
  { label: "Stored", widthPct: "14%" },
  { label: "Used", widthPct: "28%" },
  { label: "Objects", widthPct: "14%" },
  { label: "Cluster", widthPct: "18%" },
];

const POOL_LEGEND: Array<HoneycombLegendItem> = [
  { label: "< 70% used", color: "#10b981" },
  { label: "70–85% used", color: "#f59e0b" },
  { label: "> 85% used", color: "#ef4444" },
  { label: "Unknown", color: "#d1d5db" },
];

const BASE_SELECT: Select<CephResource> = {
  _id: true,
  name: true,
  externalId: true,
  storedBytes: true,
  maxAvailBytes: true,
  objects: true,
  lastSeenAt: true,
  cephClusterId: true,
  cephCluster: {
    name: true,
  },
};

/*
 * Pool rows and tiles deep-link to the pool detail page; the route's
 * SubModelID is the CephResource externalId (the `pool_id` datapoint
 * label) — mirroring Pages/Ceph/View/Pools.tsx. Falls back to the
 * cluster's Pools list when the externalId hasn't been ingested yet.
 */
function getPoolRoute(r: CephResource): Route | undefined {
  const clusterId: string = (r.cephClusterId?.toString() as string) || "";
  if (!clusterId) {
    return undefined;
  }
  const poolId: string = (r.externalId as string) || "";
  if (!poolId) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.CEPH_CLUSTER_VIEW_POOLS] as Route,
      { modelId: new ObjectID(clusterId) },
    );
  }
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.CEPH_CLUSTER_VIEW_POOL_DETAIL] as Route,
    {
      modelId: new ObjectID(clusterId),
      subModelId: new ObjectID(poolId),
    },
  );
}

/*
 * Used % for a pool is stored / (stored + max_avail) — max_avail is the
 * remaining headroom AFTER replication, so this matches what `ceph df`
 * reports as %USED (and what the ceph-pool-near-full alert template
 * computes).
 */
function getUsedPercent(r: CephResource): number | null {
  const stored: number = Number(r.storedBytes);
  const maxAvail: number = Number(r.maxAvailBytes);
  if (
    !Number.isFinite(stored) ||
    !Number.isFinite(maxAvail) ||
    stored + maxAvail <= 0
  ) {
    return null;
  }
  return (stored / (stored + maxAvail)) * 100;
}

function getUsageColor(percent: number | null): string {
  if (percent === null) {
    return "#d1d5db";
  }
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
      <div className="h-1.5 w-16 rounded-full bg-gray-100 overflow-hidden flex-shrink-0">
        <div
          className="h-full rounded-full"
          style={{
            width: `${clamped}%`,
            backgroundColor: getUsageColor(clamped),
          }}
        ></div>
      </div>
      <span className="text-xs text-gray-500">{clamped.toFixed(1)}%</span>
    </div>
  );
}

function formatBytes(value: number | undefined): string {
  const numeric: number = Number(value);
  if (value === undefined || value === null || !Number.isFinite(numeric)) {
    return "—";
  }
  return formatMemoryValue(numeric);
}

function formatObjects(value: number | undefined): string {
  const numeric: number = Number(value);
  if (value === undefined || value === null || !Number.isFinite(numeric)) {
    return "—";
  }
  if (numeric >= 1_000_000) {
    return `${(numeric / 1_000_000).toFixed(1)}M`;
  }
  if (numeric >= 1_000) {
    return `${(numeric / 1_000).toFixed(1)}K`;
  }
  return String(numeric);
}

function getPoolDisplayName(r: CephResource): string {
  /*
   * `name` comes from ceph_pool_metadata; externalId is the numeric
   * pool_id, shown only until the metadata series has been ingested.
   */
  return (r.name as string) || `pool ${(r.externalId as string) || "?"}`;
}

function renderPoolRow(r: CephResource): ReactElement {
  const id: string = (r._id as string) || "";
  const name: string = getPoolDisplayName(r);
  const clusterName: string = (r.cephCluster?.name as string) || "—";
  const route: Route | undefined = getPoolRoute(r);

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
        {formatBytes(r.storedBytes as number | undefined)}
      </td>
      <td className="px-3 py-2">{renderUsageBar(getUsedPercent(r))}</td>
      <td className="px-3 py-2 text-xs text-gray-500">
        {formatObjects(r.objects as number | undefined)}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 truncate">
        {clusterName}
      </td>
    </tr>
  );
}

function buildPoolTile(r: CephResource): HoneycombTile {
  const id: string = (r._id as string) || "";
  const name: string = getPoolDisplayName(r);
  const usedPercent: number | null = getUsedPercent(r);
  const clusterName: string = (r.cephCluster?.name as string) || "—";

  return {
    id: id || name,
    status:
      usedPercent === null ? "Unknown" : `${usedPercent.toFixed(1)}% used`,
    color: getUsageColor(usedPercent),
    route: getPoolRoute(r),
    tooltip: {
      title: name,
      details: [
        {
          label: "Stored",
          value: formatBytes(r.storedBytes as number | undefined),
        },
        {
          label: "Objects",
          value: formatObjects(r.objects as number | undefined),
        },
        { label: "Cluster", value: clusterName },
      ],
    },
  };
}

const DashboardCephPoolListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const args: DashboardCephPoolListComponent["arguments"] =
    props.component.arguments;

  const query: Query<CephResource> = {
    kind: "Pool",
  } as Query<CephResource>;

  if (args.cephClusterIds && args.cephClusterIds.length > 0) {
    (query as Record<string, unknown>)["cephClusterId"] = new Includes(
      args.cephClusterIds,
    );
  }

  const viewMode: ResourceListViewMode =
    args.viewMode === "honeycomb" ? "honeycomb" : "list";

  return (
    <DashboardModelResourceListBase<CephResource>
      modelType={CephResource}
      publicResourceType="ceph-resource"
      title={args.title}
      pluralLabel="pools"
      emptyMessage="No Ceph pools found"
      emptyIcon={IconProp.Database}
      columns={COLUMNS}
      maxRows={args.maxRows || 25}
      query={query}
      select={BASE_SELECT}
      sort={{ name: SortOrder.Ascending }}
      refreshTick={props.refreshTick}
      variables={props.variables}
      attributeToColumn={ATTRIBUTE_TO_COLUMN}
      renderRow={renderPoolRow}
      viewMode={viewMode}
      renderHoneycombTile={buildPoolTile}
      honeycombLegend={POOL_LEGEND}
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

export default React.memo(DashboardCephPoolListComponentElement, arePropsEqual);
