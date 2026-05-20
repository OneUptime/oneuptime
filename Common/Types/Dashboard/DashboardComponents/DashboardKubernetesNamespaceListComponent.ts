import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardKubernetesNamespaceListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.KubernetesNamespaceList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    kubernetesClusterIds?: Array<string> | undefined;
  };
}
