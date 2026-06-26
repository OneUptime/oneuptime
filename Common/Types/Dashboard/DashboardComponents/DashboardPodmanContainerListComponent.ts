import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardPodmanContainerListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.PodmanContainerList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    podmanHostIds?: Array<string> | undefined;
    imageName?: string | undefined;
  };
}
