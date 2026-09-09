import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

/*
 * Custom-dashboard list of ESXi hosts, read from the VMwareResource
 * inventory (kind "Host") that the VMware Agent's vcenter receiver keeps
 * up to date. The vcenter receiver reports no per-host power or
 * connection state, so unlike the Proxmox node widget there is no status
 * filter here — the widget offers only the arguments every
 * infrastructure list widget shares.
 */
export default interface DashboardVMwareHostListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.VMwareHostList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    vmwareVCenterIds?: Array<string> | undefined;
  };
}
