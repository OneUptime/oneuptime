import DashboardLogChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardLogChartComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import LogSeverity from "../../../Types/Log/LogSeverity";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the chart heading",
  order: 1,
};

const FiltersSection: ComponentArgumentSection = {
  name: "Log Query",
  description: "Choose which logs contribute to the chart",
  order: 2,
};

export default class DashboardLogChartComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardLogChartComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.LogChart,
      widthInDashboardUnits: 8,
      heightInDashboardUnits: 5,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 6,
      arguments: {},
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardLogChartComponent>
  > {
    return [
      {
        name: "Title",
        description: "Header shown above the log-volume chart",
        required: false,
        type: ComponentInputType.Text,
        id: "title",
        placeholder: "Log Volume",
        section: DisplaySection,
      },
      {
        name: "Services",
        description: "Only count logs emitted by the selected services",
        required: false,
        type: ComponentInputType.EntityMultiSelectDropdown,
        id: "serviceIds",
        placeholder: "All services",
        section: FiltersSection,
        entityFilterModelType: EntityFilterModelType.Service,
      },
      {
        name: "Severities",
        description: "Only count logs at the selected severity levels",
        required: false,
        type: ComponentInputType.MultiSelectDropdown,
        id: "severityFilters",
        placeholder: "All severities",
        section: FiltersSection,
        dropdownOptions: [
          { label: "Fatal", value: LogSeverity.Fatal },
          { label: "Error", value: LogSeverity.Error },
          { label: "Warning", value: LogSeverity.Warning },
          { label: "Information", value: LogSeverity.Information },
          { label: "Debug", value: LogSeverity.Debug },
          { label: "Trace", value: LogSeverity.Trace },
          { label: "Unspecified", value: LogSeverity.Unspecified },
        ],
      },
      {
        name: "Body Contains",
        description: "Only count logs whose body contains this text",
        required: false,
        type: ComponentInputType.Text,
        id: "bodyContains",
        placeholder: "Search text...",
        section: FiltersSection,
      },
      {
        name: "Attribute Filters",
        description:
          "Exact attribute matches, e.g. @service.name:checkout @deployment.environment:production",
        required: false,
        type: ComponentInputType.LongText,
        id: "attributeFilterQuery",
        placeholder: "@key:value @another.key:value",
        section: FiltersSection,
      },
    ];
  }
}
