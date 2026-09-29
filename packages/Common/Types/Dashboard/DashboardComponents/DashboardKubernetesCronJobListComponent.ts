import ObjectID from "../../ObjectID";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export default interface DashboardKubernetesCronJobListComponent
  extends BaseComponent {
  componentType: DashboardComponentType.KubernetesCronJobList;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    maxRows?: number | undefined;
    viewMode?: "list" | "honeycomb" | undefined;
    kubernetesClusterIds?: Array<string> | undefined;
    namespaces?: string | undefined;
  };
}
