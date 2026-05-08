import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardDockerHostListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.DockerHostList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    statusFilter?: string | undefined;
  };
}
