import DashboardSecurityEventsListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardSecurityEventsListComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import {
  OcsfEventClasses,
  OcsfEventClassProps,
} from "../../../Types/SecurityEvent/OcsfEventClass";
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
  description: "Configure the widget title and row limit",
  order: 1,
};

const FiltersSection: ComponentArgumentSection = {
  name: "Filters",
  description: "Narrow down which security events are shown",
  order: 2,
  defaultCollapsed: true,
};

export default class DashboardSecurityEventsListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardSecurityEventsListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.SecurityEventsList,
      widthInDashboardUnits: 8,
      heightInDashboardUnits: 5,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 6,
      arguments: {
        limit: 10,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardSecurityEventsListComponent>
  > {
    return [
      {
        name: "Title",
        description: "Header shown above the security events list",
        required: false,
        type: ComponentInputType.Text,
        id: "title",
        placeholder: "Security Events",
        section: DisplaySection,
      },
      {
        name: "Limit",
        description: "Maximum number of security events to show (up to 50)",
        required: false,
        type: ComponentInputType.Number,
        id: "limit",
        placeholder: "10",
        section: DisplaySection,
      },
      {
        name: "Severities",
        description: "Only show events at the selected OCSF severity levels",
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
        name: "Event Classes",
        description: "Only show events of the selected OCSF event classes",
        required: false,
        type: ComponentInputType.MultiSelectDropdown,
        id: "classNameFilters",
        placeholder: "All event classes",
        section: FiltersSection,
        dropdownOptions: OcsfEventClasses.map(
          (eventClass: OcsfEventClassProps): DropdownOption => {
            return { label: eventClass.name, value: eventClass.name };
          },
        ),
      },
      {
        name: "Message Contains",
        description: "Only show events whose message contains this text",
        required: false,
        type: ComponentInputType.Text,
        id: "messageContains",
        placeholder: "Search text...",
        section: FiltersSection,
      },
    ];
  }
}
