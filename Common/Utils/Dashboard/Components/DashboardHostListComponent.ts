import DashboardHostListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardHostListComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { getViewModeArgument } from "./DashboardListSharedArgs";

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the widget title and row limit",
  order: 1,
};

const FiltersSection: ComponentArgumentSection = {
  name: "Filters",
  description: "Narrow down which hosts are shown",
  order: 2,
  defaultCollapsed: true,
};

export default class DashboardHostListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardHostListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.HostList,
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
    ComponentArgument<DashboardHostListComponent>
  > {
    const args: Array<ComponentArgument<DashboardHostListComponent>> = [];

    args.push({
      name: "Title",
      description: "Header shown above the host list",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
      section: DisplaySection,
    });

    args.push({
      name: "Max Rows",
      description: "Maximum number of hosts to show",
      required: false,
      type: ComponentInputType.Number,
      id: "maxRows",
      placeholder: "25",
      section: DisplaySection,
    });

    args.push(getViewModeArgument<DashboardHostListComponent>(DisplaySection));

    args.push({
      name: "Connection Status",
      description: "Quick filter by OTel collector status",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "statusFilter",
      section: FiltersSection,
      dropdownOptions: [
        { label: "All", value: "" },
        { label: "Connected only", value: "connected" },
        { label: "Disconnected only", value: "disconnected" },
      ],
    });

    args.push({
      name: "OS Type",
      description: "Quick filter by operating system",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "osTypeFilter",
      section: FiltersSection,
      dropdownOptions: [
        { label: "All", value: "" },
        { label: "Linux", value: "linux" },
        { label: "Darwin", value: "darwin" },
        { label: "Windows", value: "windows" },
      ],
    });

    return args;
  }
}
