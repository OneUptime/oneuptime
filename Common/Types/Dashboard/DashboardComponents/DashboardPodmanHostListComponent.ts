import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardPodmanHostListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.PodmanHostList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    statusFilter?: string | undefined;
  };
}
