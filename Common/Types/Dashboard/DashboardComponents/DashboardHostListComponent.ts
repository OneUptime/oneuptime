import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardHostListComponent extends BaseComponent {
  componentType: DashboardComponentType.HostList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    statusFilter?: string | undefined;
    osTypeFilter?: string | undefined;
  };
}
