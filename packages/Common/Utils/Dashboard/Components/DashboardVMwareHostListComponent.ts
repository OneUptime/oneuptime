import DashboardVMwareHostListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardVMwareHostListComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import { ComponentArgument } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { getVMwareCommonArguments } from "./DashboardVMwareResourceListShared";

export default class DashboardVMwareHostListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardVMwareHostListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.VMwareHostList,
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

  /*
   * ESXi hosts carry no per-host power or connection state in the vcenter
   * receiver's output (host power state only appears as a datacenter-level
   * count), so this widget has no status filter — just the shared
   * title / max rows / view mode / vCenter arguments.
   */
  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardVMwareHostListComponent>
  > {
    return getVMwareCommonArguments<DashboardVMwareHostListComponent>();
  }
}
