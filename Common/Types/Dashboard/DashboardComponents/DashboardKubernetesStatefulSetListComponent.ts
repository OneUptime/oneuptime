import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardKubernetesStatefulSetListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.KubernetesStatefulSetList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    kubernetesClusterIds?: Array<string> | undefined;
    namespaces?: string | undefined;
  };
}
