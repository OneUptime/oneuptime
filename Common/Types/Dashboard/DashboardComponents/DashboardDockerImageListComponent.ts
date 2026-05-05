import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardDockerImageListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.DockerImageList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    dockerHostIds?: Array<string> | undefined;
    nameSearch?: string | undefined;
  };
}
