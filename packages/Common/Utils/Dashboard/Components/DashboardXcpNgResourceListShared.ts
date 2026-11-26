import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import XcpNgResourceKind from "../../../Types/XcpNg/XcpNgResourceKind";
import { AttributeToColumnMap } from "../ModelQueryVariableInterpolation";
import { getViewModeArgument } from "./DashboardListSharedArgs";

/*
 * Arguments shared by every XCP-ng inventory list widget (hosts, VMs). The
 * shape - title, max rows, view mode, then a pool multi-select in a
 * collapsed Filters panel - is deliberately identical to the Proxmox /
 * VMware / Ceph / Storage Array / Docker Swarm / Kubernetes builders; a
 * cross-provider test compares them. Widget-specific filters (status) are
 * added by the per-widget util, never here.
 *
 * Everything else here is read by the widget in the browser AND by the
 * server for a public dashboard (PublicDashboardResourceListPolicy): the
 * kind each widget lists, its status filter's values and the query each
 * means, the columns a dashboard variable narrows, and the columns it
 * reads. One copy, so a public dashboard can never list, filter or draw
 * otherwise than the board it was published from.
 */

export const XcpNgDisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the widget title and row limit",
  order: 1,
};

export const XcpNgFiltersSection: ComponentArgumentSection = {
  name: "Filters",
  description: "Narrow down which resources are shown",
  order: 2,
  defaultCollapsed: true,
};

export function getXcpNgCommonArguments<
  T extends DashboardBaseComponent,
>(): Array<ComponentArgument<T>> {
  const args: Array<ComponentArgument<T>> = [];

  args.push({
    name: "Title",
    description: "Header shown above the list",
    required: false,
    type: ComponentInputType.Text,
    id: "title" as keyof T["arguments"],
    section: XcpNgDisplaySection,
  });

  args.push({
    name: "Max Rows",
    description: "Maximum number of rows to show",
    required: false,
    type: ComponentInputType.Number,
    id: "maxRows" as keyof T["arguments"],
    placeholder: "25",
    section: XcpNgDisplaySection,
  });

  args.push(getViewModeArgument<T>(XcpNgDisplaySection));

  /*
   * Never the bare "Pools": that key is Ceph's and OpenStack's storage
   * pools, which some languages word apart from pools of hosts.
   */
  args.push({
    name: "XCP-ng Pools",
    description: "Show only resources from the selected XCP-ng pools",
    required: false,
    type: ComponentInputType.EntityMultiSelectDropdown,
    id: "xcpNgPoolIds" as keyof T["arguments"],
    placeholder: "All XCP-ng pools",
    section: XcpNgFiltersSection,
    entityFilterModelType: EntityFilterModelType.XcpNgPool,
  });

  return args;
}

// -- Hosts ---------------------------------------------------------------------

export const XCP_NG_HOST_STATUS_RUNNING: string = "running";
export const XCP_NG_HOST_STATUS_NOT_RUNNING: string = "not-running";
export const XCP_NG_HOST_STATUS_DISABLED: string = "disabled";

/*
 * The host widget's status filter: running (Xen Orchestra says Running),
 * not running (Halted, or Unknown when the pool master lost it) or disabled
 * (in maintenance mode, where XAPI starts no VM on it).
 */
export const XCP_NG_HOST_STATUS_FILTER_VALUES: ReadonlyArray<string> = [
  XCP_NG_HOST_STATUS_RUNNING,
  XCP_NG_HOST_STATUS_NOT_RUNNING,
  XCP_NG_HOST_STATUS_DISABLED,
];

// The query the hosts list always reads: the pool's hosts.
export function getXcpNgHostListQuery(): Record<string, unknown> {
  return { kind: XcpNgResourceKind.Host };
}

/*
 * What a host status filter adds to the query; nothing for "" (all) or a
 * value this version does not know.
 */
export function getXcpNgHostStatusFilterQuery(
  statusFilter: string | undefined,
): Record<string, unknown> {
  if (statusFilter === XCP_NG_HOST_STATUS_RUNNING) {
    return { isUp: true };
  }

  if (statusFilter === XCP_NG_HOST_STATUS_NOT_RUNNING) {
    return { isUp: false };
  }

  if (statusFilter === XCP_NG_HOST_STATUS_DISABLED) {
    return { isEnabled: false };
  }

  return {};
}

/*
 * A dashboard variable on Xen Orchestra's `host_name` label - which a
 * host's series and those of every VM it runs carry - narrows the hosts
 * list to that host.
 */
export const XCP_NG_HOST_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  host_name: "name",
};

/*
 * The columns the hosts list reads, in the browser and, authoritatively,
 * on a public dashboard.
 */
export const XCP_NG_HOST_WIDGET_SELECT: {
  _id: true;
  name: true;
  externalId: true;
  powerState: true;
  isUp: true;
  isEnabled: true;
  latestCpuPercent: true;
  latestMemoryPercent: true;
  xcpNgPoolId: true;
  xcpNgPool: { name: true };
} = {
  _id: true,
  name: true,
  externalId: true,
  powerState: true,
  isUp: true,
  isEnabled: true,
  latestCpuPercent: true,
  latestMemoryPercent: true,
  xcpNgPoolId: true,
  xcpNgPool: { name: true },
};

// -- VMs -----------------------------------------------------------------------

export const XCP_NG_VM_STATUS_RUNNING: string = "running";
export const XCP_NG_VM_STATUS_NOT_RUNNING: string = "not-running";

/*
 * The VM widget's status filter: running, or not running (Halted, Paused
 * or Suspended).
 */
export const XCP_NG_VM_STATUS_FILTER_VALUES: ReadonlyArray<string> = [
  XCP_NG_VM_STATUS_RUNNING,
  XCP_NG_VM_STATUS_NOT_RUNNING,
];

/*
 * The query the VMs list always reads: the pool's VMs, without the control
 * domains (dom0, the management VM each host runs), which the pool's VMs
 * page hides too. Ingest marks every VM Xen Orchestra reports one way or
 * the other (xcp_vm_status leaves control domains out, and every VM series
 * says is_control_domain).
 */
export function getXcpNgVmListQuery(): Record<string, unknown> {
  return { kind: XcpNgResourceKind.VM, isControlDomain: false };
}

export function getXcpNgVmStatusFilterQuery(
  statusFilter: string | undefined,
): Record<string, unknown> {
  if (statusFilter === XCP_NG_VM_STATUS_RUNNING) {
    return { isUp: true };
  }

  if (statusFilter === XCP_NG_VM_STATUS_NOT_RUNNING) {
    return { isUp: false };
  }

  return {};
}

/*
 * A dashboard variable on Xen Orchestra's `vm_name` label narrows the VMs
 * list to that VM, and one on `host_name` to the VMs that host runs: Xen
 * Orchestra names a VM's host on each of its series.
 */
export const XCP_NG_VM_ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  vm_name: "name",
  host_name: "parentHostName",
};

export const XCP_NG_VM_WIDGET_SELECT: {
  _id: true;
  name: true;
  externalId: true;
  powerState: true;
  isUp: true;
  parentHostName: true;
  latestCpuPercent: true;
  latestMemoryPercent: true;
  xcpNgPoolId: true;
  xcpNgPool: { name: true };
} = {
  _id: true,
  name: true,
  externalId: true,
  powerState: true,
  isUp: true,
  parentHostName: true,
  latestCpuPercent: true,
  latestMemoryPercent: true,
  xcpNgPoolId: true,
  xcpNgPool: { name: true },
};
