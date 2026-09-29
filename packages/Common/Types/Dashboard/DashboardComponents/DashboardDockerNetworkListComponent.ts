import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardDockerNetworkListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.DockerNetworkList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    dockerHostIds?: Array<string> | undefined;
  };
}
