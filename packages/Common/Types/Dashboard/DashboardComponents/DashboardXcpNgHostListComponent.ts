import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

/*
 * Custom-dashboard list of the hosts of XCP-ng pools, read from the
 * XcpNgResource inventory (kind "Host") that ingest keeps from what Xen
 * Orchestra reports (xcp_host_status and the host RRD series).
 *
 * statusFilter takes one of XCP_NG_HOST_STATUS_FILTER_VALUES
 * (Common/Utils/Dashboard/Components/DashboardXcpNgResourceListShared),
 * the strings the widget's query and the public dashboard policy accept:
 *   "" (all) | "running" (isUp = true) | "not-running" (isUp = false:
 *   Halted, or Unknown when the pool master lost it) | "disabled"
 *   (isEnabled = false: in maintenance mode)
 */
export default interface DashboardXcpNgHostListComponent extends BaseComponent {
  componentType: DashboardComponentType.XcpNgHostList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    xcpNgPoolIds?: Array<string> | undefined;
    statusFilter?: string | undefined;
  };
}
