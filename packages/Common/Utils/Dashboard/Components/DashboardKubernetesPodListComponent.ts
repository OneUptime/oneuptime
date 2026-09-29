import DashboardKubernetesPodListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardKubernetesPodListComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import {
  KubernetesFiltersSection,
  getKubernetesCommonArguments,
} from "./DashboardKubernetesResourceListShared";

export default class DashboardKubernetesPodListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardKubernetesPodListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.KubernetesPodList,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 4,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 6,
      arguments: {
        maxRows: 25,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardKubernetesPodListComponent>
  > {
    const args: Array<ComponentArgument<DashboardKubernetesPodListComponent>> =
      getKubernetesCommonArguments<DashboardKubernetesPodListComponent>({
        includeNamespaceFilter: true,
      });

    args.push({
      name: "Pod Phases",
      description: "Show only pods in the selected phases",
      required: false,
      type: ComponentInputType.MultiSelectDropdown,
      id: "podPhases",
      placeholder: "All phases",
      section: KubernetesFiltersSection,
      dropdownOptions: [
        { label: "Running", value: "Running" },
        { label: "Pending", value: "Pending" },
        { label: "Succeeded", value: "Succeeded" },
        { label: "Failed", value: "Failed" },
        { label: "Unknown", value: "Unknown" },
      ],
    });

    return args;
  }
}
