import DashboardIncidentListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardIncidentListComponent";
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
  description: "Narrow down which incidents are shown",
  order: 2,
  defaultCollapsed: true,
};

export default class DashboardIncidentListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardIncidentListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.IncidentList,
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
    ComponentArgument<DashboardIncidentListComponent>
  > {
    const componentArguments: Array<
      ComponentArgument<DashboardIncidentListComponent>
    > = [];

    componentArguments.push({
      name: "Title",
      description: "Header shown above the incident list",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Max Rows",
      description: "Maximum number of incidents to show",
      required: false,
      type: ComponentInputType.Number,
      id: "maxRows",
      placeholder: "25",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "State",
      description: "Filter incidents by lifecycle state",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "stateFilter",
      section: FiltersSection,
      dropdownOptions: [
        { label: "All", value: "" },
        { label: "Unresolved (open)", value: "unresolved" },
        { label: "Acknowledged", value: "acknowledged" },
        { label: "Resolved", value: "resolved" },
      ],
    });

    return componentArguments;
  }
}
