import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardCephPoolListComponent extends BaseComponent {
  componentType: DashboardComponentType.CephPoolList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    cephClusterIds?: Array<string> | undefined;
  };
}
