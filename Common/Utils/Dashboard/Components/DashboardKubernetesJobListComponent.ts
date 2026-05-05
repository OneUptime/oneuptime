import DashboardKubernetesJobListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardKubernetesJobListComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import { ComponentArgument } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { getKubernetesCommonArguments } from "./DashboardKubernetesResourceListShared";

export default class DashboardKubernetesJobListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardKubernetesJobListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.KubernetesJobList,
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
    ComponentArgument<DashboardKubernetesJobListComponent>
  > {
    return getKubernetesCommonArguments<DashboardKubernetesJobListComponent>({
      includeNamespaceFilter: true,
    });
  }
}
