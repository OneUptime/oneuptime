import DashboardSecurityEventsFlowComponent from "../../../Types/Dashboard/DashboardComponents/DashboardSecurityEventsFlowComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the flow heading",
  order: 1,
};

const FiltersSection: ComponentArgumentSection = {
  name: "Filters",
  description: "Choose which security events contribute to the flow",
  order: 2,
  defaultCollapsed: true,
};

export default class DashboardSecurityEventsFlowComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardSecurityEventsFlowComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.SecurityEventsFlow,
      widthInDashboardUnits: 8,
      heightInDashboardUnits: 5,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 4,
      minWidthInDashboardUnits: 6,
      arguments: {
        maxEvents: 500,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardSecurityEventsFlowComponent>
  > {
    return [
      {
        name: "Title",
        description: "Header shown above the security events flow",
        required: false,
        type: ComponentInputType.Text,
        id: "title",
        placeholder: "Security Events Flow",
        section: DisplaySection,
      },
      {
        name: "Severities",
        description: "Only include events at the selected OCSF severity levels",
        required: false,
        type: ComponentInputType.MultiSelectDropdown,
        id: "severityFilters",
        placeholder: "All severities",
        section: FiltersSection,
        dropdownOptions: Object.values(OcsfSeverity).map(
          (severity: OcsfSeverity): DropdownOption => {
            return { label: severity, value: severity };
          },
        ),
      },
      {
        name: "Max Events",
        description:
          "How many of the most recent events to build the flow from (up to 1000)",
        required: false,
        type: ComponentInputType.Number,
        id: "maxEvents",
        placeholder: "500",
        section: FiltersSection,
      },
    ];
  }
}
