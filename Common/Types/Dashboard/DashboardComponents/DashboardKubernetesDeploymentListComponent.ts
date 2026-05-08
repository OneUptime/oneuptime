import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardKubernetesDeploymentListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.KubernetesDeploymentList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    kubernetesClusterIds?: Array<string> | undefined;
    namespaces?: string | undefined;
  };
}
