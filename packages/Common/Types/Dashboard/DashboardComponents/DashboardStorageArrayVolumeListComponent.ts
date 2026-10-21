import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardStorageArrayVolumeListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.StorageArrayVolumeList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    storageArrayIds?: Array<string> | undefined;
  };
}
