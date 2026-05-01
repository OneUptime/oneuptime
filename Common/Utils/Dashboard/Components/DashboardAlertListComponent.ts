import DashboardAlertListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardAlertListComponent";
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
  description: "Configure the panel title and row limit",
  order: 1,
};

const FiltersSection: ComponentArgumentSection = {
  name: "Filters",
  description: "Narrow down which records appear",
  order: 2,
  defaultCollapsed: true,
};

export default class DashboardAlertListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardAlertListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.AlertList,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 4,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 4,
      arguments: {
        source: "alerts",
        stateFilter: "open",
        maxRows: 20,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardAlertListComponent>
  > {
    const componentArguments: Array<
      ComponentArgument<DashboardAlertListComponent>
    > = [];

    componentArguments.push({
      name: "Title",
      description: "Header shown above the list",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Max Rows",
      description: "Maximum number of rows to show",
      required: false,
      type: ComponentInputType.Number,
      id: "maxRows",
      placeholder: "20",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Source",
      description: "Whether to list alerts (raised by monitors) or incidents",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "source",
      section: DisplaySection,
      dropdownOptions: [
        { label: "Alerts", value: "alerts" },
        { label: "Incidents", value: "incidents" },
      ],
    });

    componentArguments.push({
      name: "State",
      description: "Filter by lifecycle state",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "stateFilter",
      section: FiltersSection,
      dropdownOptions: [
        { label: "Open only", value: "open" },
        { label: "Resolved only", value: "resolved" },
        { label: "All", value: "all" },
      ],
    });

    componentArguments.push({
      name: "Severity",
      description:
        "Match severity name (e.g. Critical, Warning). Leave blank for any.",
      required: false,
      type: ComponentInputType.Text,
      id: "severityFilter",
      section: FiltersSection,
    });

    return componentArguments;
  }
}
