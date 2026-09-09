import React, { FunctionComponent, ReactElement } from "react";
import DashboardVMwareHostListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardVMwareHostListComponent";
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
import VMwareResource from "Common/Models/DatabaseModels/VMwareResource";
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
 * The vcenter receiver stamps identity on RESOURCE attributes, so a
 * dashboard variable may be keyed either as the bare attribute or as the
 * `resource.`-prefixed form the metrics explorer exposes. Both spellings
 * narrow this list. This map must stay byte-identical to
 * VMWARE_HOST_ATTRIBUTE_TO_COLUMN in
 * Common/Server/Utils/Dashboard/PublicDashboardResourceListPolicy.ts —
 * on public dashboards the server copy is the one that is applied.
 */
const ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "vcenter.host.name": "name",
  "resource.vcenter.host.name": "name",
  "vcenter.cluster.name": "clusterName",
  "resource.vcenter.cluster.name": "clusterName",
  "vcenter.datacenter.name": "datacenterName",
  "resource.vcenter.datacenter.name": "datacenterName",
};

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardVMwareHostListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Host", widthPct: "30%" },
  { label: "CPU", widthPct: "14%" },
  { label: "Memory", widthPct: "14%" },
  { label: "Cluster", widthPct: "21%" },
  { label: "vCenter", widthPct: "21%" },
];

/*
 * ESXi hosts carry no per-host power or connection state in the vcenter
 * receiver's output (host power state only surfaces as a datacenter-level
 * count), so tiles are colored by load instead: the higher of CPU and
 * memory utilization. The thresholds match the vmware-host-cpu-saturation /
 * vmware-host-memory-saturation alert templates (90%), with a "busy" band
 * below them so a host heading for saturation stands out before it alerts.
 */
const HOST_COLORS: {
  healthy: string;
  busy: string;
  saturated: string;
  noData: string;
} = {
  healthy: "#10b981",
  busy: "#f59e0b",
  saturated: "#ef4444",
  noData: "#9ca3af",
};

const HOST_LEGEND: Array<HoneycombLegendItem> = [
  { label: "Under 70%", color: HOST_COLORS.healthy },
  { label: "70–90%", color: HOST_COLORS.busy },
  { label: "Over 90%", color: HOST_COLORS.saturated },
  { label: "No data", color: HOST_COLORS.noData },
];

/*
 * Server select (PublicDashboardResourceListPolicy.selectForComponent,
 * VMwareHostList case) plus lastSeenAt. On public dashboards the server
 * select is authoritative and this one is ignored, so keep the two in
 * step — never add a column here without adding it there.
 */
const BASE_SELECT: Select<VMwareResource> = {
  _id: true,
  name: true,
  externalId: true,
  kind: true,
  datacenterName: true,
  clusterName: true,
  latestCpuPercent: true,
  latestMemoryPercent: true,
  cpuCapacityMhz: true,
  maxMemoryBytes: true,
  metricsUpdatedAt: true,
  lastSeenAt: true,
  vmwareVCenterId: true,
  vmwareVCenter: {
    name: true,
  },
};

function toFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const numeric: number = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function formatPercent(value: unknown): string {
  const numeric: number | undefined = toFiniteNumber(value);
  if (numeric === undefined) {
    return "—";
  }
  return `${numeric.toFixed(1)}%`;
}

/* The receiver reports CPU capacity in MHz; GHz reads better for a host. */
function formatMhz(value: unknown): string {
  const numeric: number | undefined = toFiniteNumber(value);
  if (numeric === undefined) {
    return "—";
  }
  if (numeric >= 1000) {
    return `${(numeric / 1000).toFixed(1)} GHz`;
  }
  return `${Math.round(numeric)} MHz`;
}

function formatBytes(value: unknown): string {
  const numeric: number | undefined = toFiniteNumber(value);
  if (numeric === undefined) {
    return "—";
  }
  const units: Array<string> = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let scaled: number = numeric;
  let unitIndex: number = 0;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled = scaled / 1024;
    unitIndex++;
  }
  return `${scaled.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/*
 * Host rows link straight to the host detail page. The detail-route
 * param is the VMware externalId ("host/<datacenter>/<host>")
 * percent-encoded as a single path segment. Rows without an externalId
 * fall back to the vCenter's Hosts list.
 */
function getHostRoute(r: VMwareResource): Route | undefined {
  const vcenterId: string = (r.vmwareVCenterId?.toString() as string) || "";
  if (!vcenterId) {
    return undefined;
  }
  const externalId: string = (r.externalId as string) || "";
  if (!externalId) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.VMWARE_VCENTER_VIEW_HOSTS] as Route,
      { modelId: new ObjectID(vcenterId) },
    );
  }
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.VMWARE_VCENTER_VIEW_HOST_DETAIL] as Route,
    {
      modelId: new ObjectID(vcenterId),
      subModelId: encodeURIComponent(externalId),
    },
  );
}

function getHostDisplayName(r: VMwareResource): string {
  return (r.name as string) || (r.externalId as string) || "Unnamed";
}

function getHostLoad(r: VMwareResource): {
  text: string;
  color: string;
  textColor: string;
} {
  const cpu: number | undefined = toFiniteNumber(r.latestCpuPercent);
  const memory: number | undefined = toFiniteNumber(r.latestMemoryPercent);
  const candidates: Array<number> = [cpu, memory].filter(
    (value: number | undefined): value is number => {
      return value !== undefined;
    },
  );

  if (candidates.length === 0) {
    return {
      text: "No data",
      color: HOST_COLORS.noData,
      textColor: "var(--ou-text-muted, #6b7280)",
    };
  }

  const peak: number = Math.max(...candidates);
  if (peak >= 90) {
    return {
      text: "Over 90%",
      color: HOST_COLORS.saturated,
      textColor: "var(--ou-danger-text, #b91c1c)",
    };
  }
  if (peak >= 70) {
    return {
      text: "70–90%",
      color: HOST_COLORS.busy,
      textColor: "var(--ou-warning-text, #b45309)",
    };
  }
  return {
    text: "Under 70%",
    color: HOST_COLORS.healthy,
    textColor: "var(--ou-success-text, #047857)",
  };
}

function getPercentTextColor(value: unknown): string {
  const numeric: number | undefined = toFiniteNumber(value);
  if (numeric === undefined) {
    return "var(--ou-text-muted, #6b7280)";
  }
  if (numeric >= 90) {
    return "var(--ou-danger-text, #b91c1c)";
  }
  if (numeric >= 70) {
    return "var(--ou-warning-text, #b45309)";
  }
  return "var(--ou-text-muted, #6b7280)";
}

function renderHostRow(r: VMwareResource): ReactElement {
  const id: string = (r._id as string) || "";
  const name: string = getHostDisplayName(r);
  const clusterName: string = (r.clusterName as string) || "Standalone";
  const vcenterName: string = (r.vmwareVCenter?.name as string) || "—";
  const route: Route | undefined = getHostRoute(r);

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
      <td
        className="px-3 py-2 text-xs"
        style={{ color: getPercentTextColor(r.latestCpuPercent) }}
        title={`Capacity ${formatMhz(r.cpuCapacityMhz)}`}
      >
        {formatPercent(r.latestCpuPercent)}
      </td>
      <td
        className="px-3 py-2 text-xs"
        style={{ color: getPercentTextColor(r.latestMemoryPercent) }}
        title={`Capacity ${formatBytes(r.maxMemoryBytes)}`}
      >
        {formatPercent(r.latestMemoryPercent)}
      </td>
      <td
        className="px-3 py-2 text-xs text-gray-500 truncate"
        title={(r.datacenterName as string) || undefined}
      >
        {clusterName}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 truncate">
        {vcenterName}
      </td>
    </tr>
  );
}

function buildHostTile(r: VMwareResource): HoneycombTile {
  const id: string = (r._id as string) || "";
  const name: string = getHostDisplayName(r);
  const load: { text: string; color: string; textColor: string } =
    getHostLoad(r);

  return {
    id: id || name,
    status: load.text,
    color: load.color,
    route: getHostRoute(r),
    tooltip: {
      title: name,
      details: [
        { label: "vCenter", value: (r.vmwareVCenter?.name as string) || "—" },
        { label: "Datacenter", value: (r.datacenterName as string) || "—" },
        { label: "Cluster", value: (r.clusterName as string) || "Standalone" },
        {
          label: "CPU",
          value: `${formatPercent(r.latestCpuPercent)} of ${formatMhz(
            r.cpuCapacityMhz,
          )}`,
        },
        {
          label: "Memory",
          value: `${formatPercent(r.latestMemoryPercent)} of ${formatBytes(
            r.maxMemoryBytes,
          )}`,
        },
      ],
    },
  };
}

const DashboardVMwareHostListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const args: DashboardVMwareHostListComponent["arguments"] =
    props.component.arguments;

  /*
   * Pinned to kind "Host". There is deliberately no status filter: the
   * receiver reports no per-host state, and the public-dashboard policy
   * (buildVMwareHostPolicy) accepts none either.
   */
  const query: Query<VMwareResource> = {
    kind: "Host",
  } as Query<VMwareResource>;

  if (args.vmwareVCenterIds && args.vmwareVCenterIds.length > 0) {
    (query as Record<string, unknown>)["vmwareVCenterId"] = new Includes(
      args.vmwareVCenterIds,
    );
  }

  const viewMode: ResourceListViewMode =
    args.viewMode === "honeycomb" ? "honeycomb" : "list";

  return (
    <DashboardModelResourceListBase<VMwareResource>
      modelType={VMwareResource}
      componentId={props.componentId}
      publicResourceType="vmware-resource"
      title={args.title}
      pluralLabel="hosts"
      emptyMessage="No ESXi hosts found"
      emptyIcon={IconProp.ServerStack}
      columns={COLUMNS}
      maxRows={args.maxRows || 25}
      query={query}
      select={BASE_SELECT}
      sort={{ name: SortOrder.Ascending }}
      refreshTick={props.refreshTick}
      variables={props.variables}
      attributeToColumn={ATTRIBUTE_TO_COLUMN}
      renderRow={renderHostRow}
      viewMode={viewMode}
      renderHoneycombTile={buildHostTile}
      honeycombLegend={HOST_LEGEND}
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
  DashboardVMwareHostListComponentElement,
  arePropsEqual,
);
