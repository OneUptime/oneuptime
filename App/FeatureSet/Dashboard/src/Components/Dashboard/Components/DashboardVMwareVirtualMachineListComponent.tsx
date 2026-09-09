import React, { FunctionComponent, ReactElement } from "react";
import DashboardVMwareVirtualMachineListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardVMwareVirtualMachineListComponent";
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
 * The vcenter receiver's vcenter.vm.name IS the display name, so a
 * dashboard variable bound to it narrows this list; host and cluster
 * variables narrow it through the VM's parent columns. Both the bare
 * attribute and the `resource.`-prefixed spelling the metrics explorer
 * exposes are accepted. This map must stay byte-identical to
 * VMWARE_VIRTUAL_MACHINE_ATTRIBUTE_TO_COLUMN in
 * Common/Server/Utils/Dashboard/PublicDashboardResourceListPolicy.ts —
 * on public dashboards the server copy is the one that is applied.
 */
const ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "vcenter.vm.name": "name",
  "resource.vcenter.vm.name": "name",
  "vcenter.host.name": "hostName",
  "resource.vcenter.host.name": "hostName",
  "vcenter.cluster.name": "clusterName",
  "resource.vcenter.cluster.name": "clusterName",
};

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardVMwareVirtualMachineListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Virtual Machine", widthPct: "28%" },
  { label: "Power", widthPct: "16%" },
  { label: "CPU", widthPct: "12%" },
  { label: "Memory", widthPct: "12%" },
  { label: "Host", widthPct: "16%" },
  { label: "vCenter", widthPct: "16%" },
];

/*
 * "Powered off" is gray, not red — a powered-off VM is usually a
 * deliberate state (cold standby, batch workers, decommissioning), and
 * the receiver cannot tell a suspended VM from a powered-off one, so
 * neither can this widget. Templates get their own color: they never
 * run and never carry a power state, so lumping them in with "unknown"
 * would hide real ingest gaps. Unknown is reserved for a VM row whose
 * power state has not been inferred yet.
 */
const VM_COLORS: {
  poweredOn: string;
  poweredOff: string;
  template: string;
  unknown: string;
} = {
  poweredOn: "#10b981",
  poweredOff: "#9ca3af",
  template: "#8b5cf6",
  unknown: "#d1d5db",
};

const VM_LEGEND: Array<HoneycombLegendItem> = [
  { label: "Powered on", color: VM_COLORS.poweredOn },
  { label: "Powered off", color: VM_COLORS.poweredOff },
  { label: "Template", color: VM_COLORS.template },
  { label: "Unknown", color: VM_COLORS.unknown },
];

/*
 * Server select (PublicDashboardResourceListPolicy.selectForComponent,
 * VMwareVirtualMachineList case) plus lastSeenAt. On public dashboards
 * the server select is authoritative and this one is ignored, so keep
 * the two in step — never add a column here without adding it there.
 */
const BASE_SELECT: Select<VMwareResource> = {
  _id: true,
  name: true,
  externalId: true,
  kind: true,
  datacenterName: true,
  clusterName: true,
  hostName: true,
  resourcePoolName: true,
  isPoweredOn: true,
  isTemplate: true,
  latestCpuPercent: true,
  latestMemoryPercent: true,
  latestDiskPercent: true,
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

/*
 * VM rows link straight to the virtual machine detail page. The
 * detail-route param is the VMware externalId ("vm/<instance uuid>")
 * percent-encoded as a single path segment. Rows without an externalId
 * fall back to the vCenter's Virtual Machines list.
 */
function getVirtualMachineRoute(r: VMwareResource): Route | undefined {
  const vcenterId: string = (r.vmwareVCenterId?.toString() as string) || "";
  if (!vcenterId) {
    return undefined;
  }
  const externalId: string = (r.externalId as string) || "";
  if (!externalId) {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINES] as Route,
      { modelId: new ObjectID(vcenterId) },
    );
  }
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINE_DETAIL] as Route,
    {
      modelId: new ObjectID(vcenterId),
      subModelId: encodeURIComponent(externalId),
    },
  );
}

function getVirtualMachineDisplayName(r: VMwareResource): string {
  return (r.name as string) || (r.externalId as string) || "Unnamed";
}

function isTemplateRow(r: VMwareResource): boolean {
  return (r.isTemplate as boolean | undefined) === true;
}

function getVirtualMachineStatus(r: VMwareResource): {
  text: string;
  dot: string;
  textColor: string;
} {
  if (isTemplateRow(r)) {
    return {
      text: "Template",
      dot: VM_COLORS.template,
      textColor: "var(--ou-text-muted, #6b7280)",
    };
  }
  const isPoweredOn: boolean | undefined = r.isPoweredOn as boolean | undefined;
  if (isPoweredOn === true) {
    return {
      text: "Powered on",
      dot: VM_COLORS.poweredOn,
      textColor: "var(--ou-success-text, #047857)",
    };
  }
  if (isPoweredOn === false) {
    return {
      text: "Powered off",
      dot: VM_COLORS.poweredOff,
      textColor: "var(--ou-text-muted, #6b7280)",
    };
  }
  return {
    text: "Unknown",
    dot: VM_COLORS.unknown,
    textColor: "var(--ou-text-muted, #6b7280)",
  };
}

/*
 * The receiver emits vcenter.vm.cpu.* only for powered-on VMs and no
 * CPU/memory utilization at all for templates, so a dash in those cells
 * is expected rather than a gap.
 */
function renderPowerBadge(r: VMwareResource): ReactElement {
  const status: { text: string; dot: string; textColor: string } =
    getVirtualMachineStatus(r);
  const isTemplate: boolean = isTemplateRow(r);

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium"
      style={{ fontSize: "10px" }}
    >
      <span
        className={
          isTemplate
            ? "inline-block w-2 h-2 rounded-sm"
            : "inline-block w-2 h-2 rounded-full"
        }
        style={{ backgroundColor: status.dot }}
      ></span>
      <span style={{ color: status.textColor }}>{status.text}</span>
    </span>
  );
}

function renderVirtualMachineRow(r: VMwareResource): ReactElement {
  const id: string = (r._id as string) || "";
  const name: string = getVirtualMachineDisplayName(r);
  const hostName: string = (r.hostName as string) || "—";
  const vcenterName: string = (r.vmwareVCenter?.name as string) || "—";
  const route: Route | undefined = getVirtualMachineRoute(r);

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

  const placementTitle: string = [
    (r.datacenterName as string) || "",
    (r.clusterName as string) || "",
    (r.resourcePoolName as string) || "",
  ]
    .filter((part: string) => {
      return part.length > 0;
    })
    .join(" / ");

  return (
    <tr
      key={id}
      className="hover:bg-gray-50/50 transition-colors duration-100 group"
    >
      <td className="px-3 py-2 text-xs text-gray-700 truncate">{detailLink}</td>
      <td className="px-3 py-2">{renderPowerBadge(r)}</td>
      <td className="px-3 py-2 text-xs text-gray-500">
        {formatPercent(r.latestCpuPercent)}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500">
        {formatPercent(r.latestMemoryPercent)}
      </td>
      <td
        className="px-3 py-2 text-xs text-gray-500 truncate"
        title={placementTitle || undefined}
      >
        {hostName}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 truncate">
        {vcenterName}
      </td>
    </tr>
  );
}

function buildVirtualMachineTile(r: VMwareResource): HoneycombTile {
  const id: string = (r._id as string) || "";
  const name: string = getVirtualMachineDisplayName(r);
  const status: { text: string; dot: string; textColor: string } =
    getVirtualMachineStatus(r);

  return {
    id: id || name,
    status: status.text,
    color: status.dot,
    route: getVirtualMachineRoute(r),
    tooltip: {
      title: name,
      details: [
        { label: "Host", value: (r.hostName as string) || "—" },
        { label: "Cluster", value: (r.clusterName as string) || "—" },
        { label: "vCenter", value: (r.vmwareVCenter?.name as string) || "—" },
        { label: "CPU", value: formatPercent(r.latestCpuPercent) },
        { label: "Memory", value: formatPercent(r.latestMemoryPercent) },
        { label: "Disk", value: formatPercent(r.latestDiskPercent) },
      ],
    },
  };
}

const DashboardVMwareVirtualMachineListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const args: DashboardVMwareVirtualMachineListComponent["arguments"] =
    props.component.arguments;

  /*
   * Pinned to kind "VirtualMachine" (VMs and VM templates share the
   * kind; templates carry isTemplate = true and a null power state).
   * The filter values below are the exact strings the public-dashboard
   * policy (buildVMwareVirtualMachinePolicy) whitelists via optionalEnum;
   * anything else falls through as "all".
   */
  const query: Query<VMwareResource> = {
    kind: "VirtualMachine",
  } as Query<VMwareResource>;

  if (args.vmwareVCenterIds && args.vmwareVCenterIds.length > 0) {
    (query as Record<string, unknown>)["vmwareVCenterId"] = new Includes(
      args.vmwareVCenterIds,
    );
  }

  if (args.powerStateFilter === "on") {
    (query as Record<string, unknown>)["isPoweredOn"] = true;
  } else if (args.powerStateFilter === "off") {
    (query as Record<string, unknown>)["isPoweredOn"] = false;
  }

  if (args.templateFilter === "exclude") {
    (query as Record<string, unknown>)["isTemplate"] = false;
  } else if (args.templateFilter === "only") {
    (query as Record<string, unknown>)["isTemplate"] = true;
  }

  const viewMode: ResourceListViewMode =
    args.viewMode === "honeycomb" ? "honeycomb" : "list";

  return (
    <DashboardModelResourceListBase<VMwareResource>
      modelType={VMwareResource}
      componentId={props.componentId}
      publicResourceType="vmware-resource"
      title={args.title}
      pluralLabel="virtual machines"
      emptyMessage="No virtual machines found"
      emptyIcon={IconProp.Cube}
      columns={COLUMNS}
      maxRows={args.maxRows || 25}
      query={query}
      select={BASE_SELECT}
      sort={{ name: SortOrder.Ascending }}
      refreshTick={props.refreshTick}
      variables={props.variables}
      attributeToColumn={ATTRIBUTE_TO_COLUMN}
      renderRow={renderVirtualMachineRow}
      viewMode={viewMode}
      renderHoneycombTile={buildVirtualMachineTile}
      honeycombLegend={VM_LEGEND}
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
  DashboardVMwareVirtualMachineListComponentElement,
  arePropsEqual,
);
