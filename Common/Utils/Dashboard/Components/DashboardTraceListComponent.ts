import DashboardTraceListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTraceListComponent";
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
  description: "Narrow down which traces are shown",
  order: 2,
  defaultCollapsed: true,
};

export default class DashboardTraceListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardTraceListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.TraceList,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 4,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 6,
      arguments: {
        maxRows: 50,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardTraceListComponent>
  > {
    const componentArguments: Array<
      ComponentArgument<DashboardTraceListComponent>
    > = [];

    componentArguments.push({
      name: "Title",
      description: "Header shown above the trace list",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Max Rows",
      description: "Maximum number of traces to show",
      required: false,
      type: ComponentInputType.Number,
      id: "maxRows",
      placeholder: "50",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Status",
      description: "Show only traces with this status",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "statusFilter",
      section: FiltersSection,
      dropdownOptions: [
        { label: "All", value: "" },
        { label: "Ok", value: "1" },
        { label: "Error", value: "2" },
        { label: "Unset", value: "0" },
      ],
    });

    return componentArguments;
  }
}
