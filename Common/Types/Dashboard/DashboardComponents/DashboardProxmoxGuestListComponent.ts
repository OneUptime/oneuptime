import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardProxmoxGuestListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.ProxmoxGuestList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    proxmoxClusterIds?: Array<string> | undefined;
    guestTypeFilter?: string | undefined;
    statusFilter?: string | undefined;
  };
}
