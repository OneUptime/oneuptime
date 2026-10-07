import DashboardStorageArrayVolumeListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardStorageArrayVolumeListComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import { ComponentArgument } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { getStorageArrayCommonArguments } from "./DashboardStorageArrayResourceListShared";

export default class DashboardStorageArrayVolumeListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardStorageArrayVolumeListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.StorageArrayVolumeList,
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
    ComponentArgument<DashboardStorageArrayVolumeListComponent>
  > {
    return getStorageArrayCommonArguments<DashboardStorageArrayVolumeListComponent>();
  }
}
