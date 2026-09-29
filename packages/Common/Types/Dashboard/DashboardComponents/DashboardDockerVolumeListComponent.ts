import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardDockerVolumeListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.DockerVolumeList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    dockerHostIds?: Array<string> | undefined;
  };
}
