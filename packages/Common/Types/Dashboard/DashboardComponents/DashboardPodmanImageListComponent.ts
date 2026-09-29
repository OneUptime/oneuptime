import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardPodmanImageListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.PodmanImageList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    podmanHostIds?: Array<string> | undefined;
    nameSearch?: string | undefined;
  };
}
