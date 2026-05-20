import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardDockerContainerListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.DockerContainerList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    dockerHostIds?: Array<string> | undefined;
    imageName?: string | undefined;
  };
}
