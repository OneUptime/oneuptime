import DashboardKubernetesNodeListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardKubernetesNodeListComponent";
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

export default class DashboardKubernetesNodeListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardKubernetesNodeListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.KubernetesNodeList,
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
    ComponentArgument<DashboardKubernetesNodeListComponent>
  > {
    const args: Array<ComponentArgument<DashboardKubernetesNodeListComponent>> =
      getKubernetesCommonArguments<DashboardKubernetesNodeListComponent>({
        includeNamespaceFilter: false,
      });

    args.push({
      name: "Readiness",
      description: "Quick filter by node readiness",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "readinessFilter",
      section: KubernetesFiltersSection,
      dropdownOptions: [
        { label: "All", value: "" },
        { label: "Ready only", value: "ready" },
        { label: "Not ready only", value: "not-ready" },
      ],
    });

    return args;
  }
}
