import DashboardDockerHostListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDockerHostListComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the widget title and row limit",
  order: 1,
};

const FiltersSection: ComponentArgumentSection = {
  name: "Filters",
  description: "Narrow down which Docker hosts are shown",
  order: 2,
  defaultCollapsed: true,
};

export default class DashboardDockerHostListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardDockerHostListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.DockerHostList,
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
    ComponentArgument<DashboardDockerHostListComponent>
  > {
    const args: Array<ComponentArgument<DashboardDockerHostListComponent>> = [];

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

    return args;
  }
}
