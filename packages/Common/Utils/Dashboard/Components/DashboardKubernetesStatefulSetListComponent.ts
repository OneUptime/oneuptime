import DashboardKubernetesStatefulSetListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardKubernetesStatefulSetListComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import { ComponentArgument } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { getKubernetesCommonArguments } from "./DashboardKubernetesResourceListShared";

export default class DashboardKubernetesStatefulSetListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardKubernetesStatefulSetListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.KubernetesStatefulSetList,
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
    ComponentArgument<DashboardKubernetesStatefulSetListComponent>
  > {
    return getKubernetesCommonArguments<DashboardKubernetesStatefulSetListComponent>(
      {
        includeNamespaceFilter: true,
      },
    );
  }
}
