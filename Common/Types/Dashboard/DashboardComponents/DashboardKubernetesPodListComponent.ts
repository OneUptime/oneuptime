import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardKubernetesPodListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.KubernetesPodList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    kubernetesClusterIds?: Array<string> | undefined;
    namespaces?: string | undefined;
    podPhases?: Array<string> | undefined;
  };
}
