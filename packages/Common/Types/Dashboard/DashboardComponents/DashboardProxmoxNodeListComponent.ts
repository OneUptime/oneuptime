import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardProxmoxNodeListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.ProxmoxNodeList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    proxmoxClusterIds?: Array<string> | undefined;
    statusFilter?: string | undefined;
  };
}
