import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardPodmanVolumeListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.PodmanVolumeList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    podmanHostIds?: Array<string> | undefined;
  };
}
