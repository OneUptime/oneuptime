import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardKubernetesNodeListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.KubernetesNodeList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    kubernetesClusterIds?: Array<string> | undefined;
    readinessFilter?: string | undefined;
  };
}
