import DashboardXcpNgVmListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardXcpNgVmListComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import {
  XCP_NG_VM_STATUS_NOT_RUNNING,
  XCP_NG_VM_STATUS_RUNNING,
  XcpNgFiltersSection,
  getXcpNgCommonArguments,
} from "./DashboardXcpNgResourceListShared";

export default class DashboardXcpNgVmListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardXcpNgVmListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.XcpNgVmList,
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
    ComponentArgument<DashboardXcpNgVmListComponent>
  > {
    const args: Array<ComponentArgument<DashboardXcpNgVmListComponent>> =
      getXcpNgCommonArguments<DashboardXcpNgVmListComponent>();

    args.push({
      name: "Status",
      description: "Quick filter by whether the VM is running",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "statusFilter",
      section: XcpNgFiltersSection,
      dropdownOptions: [
        { label: "All", value: "" },
        { label: "Running only", value: XCP_NG_VM_STATUS_RUNNING },
        { label: "Not running only", value: XCP_NG_VM_STATUS_NOT_RUNNING },
      ],
    });

    return args;
  }
}
