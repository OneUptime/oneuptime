import DashboardProxmoxGuestListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardProxmoxGuestListComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import {
  ProxmoxFiltersSection,
  getProxmoxCommonArguments,
} from "./DashboardProxmoxResourceListShared";

export default class DashboardProxmoxGuestListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardProxmoxGuestListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.ProxmoxGuestList,
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
    ComponentArgument<DashboardProxmoxGuestListComponent>
  > {
    const args: Array<ComponentArgument<DashboardProxmoxGuestListComponent>> =
      getProxmoxCommonArguments<DashboardProxmoxGuestListComponent>();

    args.push({
      name: "Guest Type",
      description: "Show only QEMU VMs or only LXC containers",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "guestTypeFilter",
      section: ProxmoxFiltersSection,
      dropdownOptions: [
        { label: "All", value: "" },
        { label: "QEMU VMs only", value: "qemu" },
        { label: "LXC containers only", value: "lxc" },
      ],
    });

    args.push({
      name: "Status",
      description: "Quick filter by guest run state",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "statusFilter",
      section: ProxmoxFiltersSection,
      dropdownOptions: [
        { label: "All", value: "" },
        { label: "Running only", value: "running" },
        { label: "Stopped only", value: "stopped" },
      ],
    });

    return args;
  }
}
