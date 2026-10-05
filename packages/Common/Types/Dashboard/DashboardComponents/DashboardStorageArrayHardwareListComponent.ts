import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardStorageArrayHardwareListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.StorageArrayHardwareList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    storageArrayIds?: Array<string> | undefined;
    // "" (every component), "Hardware", "Drive" or "Controller".
    kindFilter?: string | undefined;
    // "" (every status) or "unhealthy".
    statusFilter?: string | undefined;
  };
}
