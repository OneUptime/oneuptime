import DashboardKubernetesNamespaceListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardKubernetesNamespaceListComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import { ComponentArgument } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { getKubernetesCommonArguments } from "./DashboardKubernetesResourceListShared";

export default class DashboardKubernetesNamespaceListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardKubernetesNamespaceListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.KubernetesNamespaceList,
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
    ComponentArgument<DashboardKubernetesNamespaceListComponent>
  > {
    return getKubernetesCommonArguments<DashboardKubernetesNamespaceListComponent>(
      {
        includeNamespaceFilter: false,
      },
    );
  }
}
