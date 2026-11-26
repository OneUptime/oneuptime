import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

/*
 * Custom-dashboard list of the VMs of XCP-ng pools, read from the
 * XcpNgResource inventory (kind "VM") that ingest keeps from what Xen
 * Orchestra reports (xcp_vm_status and the VM RRD series). Control domains
 * (dom0) are never listed, as the pool's VMs page hides them; Xen
 * Orchestra reports no templates.
 *
 * statusFilter takes one of XCP_NG_VM_STATUS_FILTER_VALUES
 * (Common/Utils/Dashboard/Components/DashboardXcpNgResourceListShared),
 * the strings the widget's query and the public dashboard policy accept:
 *   "" (all) | "running" (isUp = true) | "not-running" (isUp = false:
 *   Halted, Paused or Suspended)
 */
export default interface DashboardXcpNgVmListComponent extends BaseComponent {
  componentType: DashboardComponentType.XcpNgVmList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    xcpNgPoolIds?: Array<string> | undefined;
    statusFilter?: string | undefined;
  };
}
