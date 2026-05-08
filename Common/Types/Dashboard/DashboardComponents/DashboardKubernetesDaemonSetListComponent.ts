import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardKubernetesDaemonSetListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.KubernetesDaemonSetList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    kubernetesClusterIds?: Array<string> | undefined;
    namespaces?: string | undefined;
  };
}
