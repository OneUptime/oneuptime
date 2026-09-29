import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

/*
 * Custom-dashboard list of virtual machines, read from the VMwareResource
 * inventory (kind "VirtualMachine") that the VMware Agent's vcenter
 * receiver keeps up to date.
 *
 * Filter values are the exact strings the widget query and the public
 * dashboard policy whitelist accept:
 *   powerStateFilter: "" (all) | "on" (isPoweredOn = true) | "off"
 *     (isPoweredOn = false — off or suspended; the receiver does not
 *     distinguish the two, so neither does the widget)
 *   templateFilter: "" (VMs and templates) | "exclude" (isTemplate = false)
 *     | "only" (isTemplate = true)
 */
export default interface DashboardVMwareVirtualMachineListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.VMwareVirtualMachineList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    vmwareVCenterIds?: Array<string> | undefined;
    powerStateFilter?: string | undefined;
    templateFilter?: string | undefined;
  };
}
