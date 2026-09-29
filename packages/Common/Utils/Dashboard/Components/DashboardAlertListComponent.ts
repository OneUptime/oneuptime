import DashboardAlertListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardAlertListComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
  EntityFilterModelType,
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

    componentArguments.push(
      getViewModeArgument<DashboardAlertListComponent>(DisplaySection),
    );

    componentArguments.push({
      name: "Lifecycle State",
      description: "Quick filter by lifecycle state",
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

    componentArguments.push({
      name: "Severity",
      description: "Show only alerts matching the selected severities",
      required: false,
      type: ComponentInputType.EntityMultiSelectDropdown,
      id: "severityIds",
      placeholder: "All severities",
      section: FiltersSection,
      entityFilterModelType: EntityFilterModelType.AlertSeverity,
    });

    componentArguments.push({
      name: "State",
      description: "Show only alerts in the selected states",
      required: false,
      type: ComponentInputType.EntityMultiSelectDropdown,
      id: "stateIds",
      placeholder: "All states",
      section: FiltersSection,
      entityFilterModelType: EntityFilterModelType.AlertState,
    });

    componentArguments.push({
      name: "Monitors",
      description: "Show only alerts linked to the selected monitors",
      required: false,
      type: ComponentInputType.EntityMultiSelectDropdown,
      id: "monitorIds",
      placeholder: "All monitors",
      section: FiltersSection,
      entityFilterModelType: EntityFilterModelType.Monitor,
    });

    componentArguments.push({
      name: "Labels",
      description: "Show only alerts tagged with the selected labels",
      required: false,
      type: ComponentInputType.EntityMultiSelectDropdown,
      id: "labelIds",
      placeholder: "All labels",
      section: FiltersSection,
      entityFilterModelType: EntityFilterModelType.Label,
    });

    return componentArguments;
  }
}
