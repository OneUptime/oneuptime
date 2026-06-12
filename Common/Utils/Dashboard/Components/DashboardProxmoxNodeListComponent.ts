import DashboardProxmoxNodeListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardProxmoxNodeListComponent";
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

export default class DashboardProxmoxNodeListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardProxmoxNodeListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.ProxmoxNodeList,
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
    ComponentArgument<DashboardProxmoxNodeListComponent>
  > {
    const args: Array<ComponentArgument<DashboardProxmoxNodeListComponent>> =
      getProxmoxCommonArguments<DashboardProxmoxNodeListComponent>();

    args.push({
      name: "Status",
      description: "Quick filter by node availability",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "statusFilter",
      section: ProxmoxFiltersSection,
      dropdownOptions: [
        { label: "All", value: "" },
        { label: "Online only", value: "online" },
        { label: "Offline only", value: "offline" },
      ],
    });

    return args;
  }
}
