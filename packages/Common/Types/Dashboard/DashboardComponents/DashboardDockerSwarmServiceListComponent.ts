import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardDockerSwarmServiceListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.DockerSwarmServiceList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    dockerSwarmClusterIds?: Array<string> | undefined;
    serviceModeFilter?: string | undefined;
    statusFilter?: string | undefined;
  };
}
