import DashboardMonitorListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardMonitorListComponent";
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
  description: "Narrow down which monitors are shown",
  order: 2,
  defaultCollapsed: true,
};

export default class DashboardMonitorListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardMonitorListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.MonitorList,
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
    ComponentArgument<DashboardMonitorListComponent>
  > {
    const componentArguments: Array<
      ComponentArgument<DashboardMonitorListComponent>
    > = [];

    componentArguments.push({
      name: "Title",
      description: "Header shown above the monitor list",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Max Rows",
      description: "Maximum number of monitors to show",
      required: false,
      type: ComponentInputType.Number,
      id: "maxRows",
      placeholder: "25",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Status",
      description: "Filter monitors by current status",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "statusFilter",
      section: FiltersSection,
      dropdownOptions: [
        { label: "All", value: "" },
        { label: "Operational only", value: "operational" },
        { label: "Not operational only", value: "non-operational" },
      ],
    });

    return componentArguments;
  }
}
