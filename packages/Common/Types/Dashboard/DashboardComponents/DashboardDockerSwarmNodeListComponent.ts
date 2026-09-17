import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardDockerSwarmNodeListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.DockerSwarmNodeList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    dockerSwarmClusterIds?: Array<string> | undefined;
    roleFilter?: string | undefined;
    statusFilter?: string | undefined;
  };
}
