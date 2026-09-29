import DashboardLogChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardLogChartComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import LogSeverity from "../../../Types/Log/LogSeverity";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the chart heading and visualization",
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
      arguments: {
        chartType: DashboardChartType.Bar,
      },
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
        name: "Chart Type",
        description: "How log volume is visualized over time",
        required: true,
        type: ComponentInputType.Dropdown,
        id: "chartType",
        section: DisplaySection,
        dropdownOptions: [
          { label: "Bar Chart", value: DashboardChartType.Bar },
          { label: "Line Chart", value: DashboardChartType.Line },
          { label: "Area Chart", value: DashboardChartType.Area },
        ],
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
    ];
  }
}
