import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardCephOsdListComponent extends BaseComponent {
  componentType: DashboardComponentType.CephOsdList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    cephClusterIds?: Array<string> | undefined;
    stateFilter?: string | undefined;
  };
}
