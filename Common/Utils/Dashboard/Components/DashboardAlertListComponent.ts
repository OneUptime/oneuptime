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
  description: "Configure the widget title and row limit",
  order: 1,
};

const FiltersSection: ComponentArgumentSection = {
  name: "Filters",
  description: "Narrow down which alerts are shown",
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
      minWidthInDashboardUnits: 6,
      arguments: {
        maxRows: 25,
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
      description: "Header shown above the alert list",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Max Rows",
      description: "Maximum number of alerts to show",
      required: false,
      type: ComponentInputType.Number,
      id: "maxRows",
      placeholder: "25",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "State",
      description: "Filter alerts by lifecycle state",
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
