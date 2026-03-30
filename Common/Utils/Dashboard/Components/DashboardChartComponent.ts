import DashboardChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardChartComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";

const DataSourceSection: ComponentArgumentSection = {
  name: "Data Source",
  description: "Configure what data to display on the chart",
  order: 1,
};

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Customize the chart appearance",
  order: 2,
  defaultCollapsed: true,
};

export default class DashboardChartComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardChartComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.Chart,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 3,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 6,
      arguments: {
        metricQueryConfig: {
          metricAliasData: {
            metricVariable: "a",
            title: undefined,
            description: undefined,
            legend: undefined,
            legendUnit: undefined,
          },
          metricQueryData: {
            filterData: {},
            groupBy: undefined,
          },
        },
        chartType: DashboardChartType.Line,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardChartComponent>
  > {
    const componentArguments: Array<
      ComponentArgument<DashboardChartComponent>
    > = [];

    componentArguments.push({
      name: "Chart Type",
      description: "How the data will be visualized",
      required: true,
      type: ComponentInputType.Dropdown,
      id: "chartType",
      section: DataSourceSection,
      dropdownOptions: [
        {
          label: "Line Chart",
          value: DashboardChartType.Line,
        },
        {
          label: "Bar Chart",
          value: DashboardChartType.Bar,
        },
        {
          label: "Area Chart",
          value: DashboardChartType.Area,
        },
        {
          label: "Stacked Area Chart",
          value: DashboardChartType.StackedArea,
        },
        {
          label: "Pie Chart",
          value: DashboardChartType.Pie,
        },
      ],
    });

    componentArguments.push({
      name: "Metric Query",
      description: "Select the metric and filters for this chart",
      required: true,
      type: ComponentInputType.MetricsQueryConfig,
      id: "metricQueryConfig",
      section: DataSourceSection,
    });

    componentArguments.push({
      name: "Additional Queries",
      description: "Overlay more metrics on the same chart",
      required: false,
      type: ComponentInputType.MetricsQueryConfigs,
      id: "metricQueryConfigs",
      isAdvanced: true,
      section: DataSourceSection,
    });

    componentArguments.push({
      name: "Title",
      description: "Displayed above the chart",
      required: false,
      type: ComponentInputType.Text,
      id: "chartTitle",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Description",
      description: "Subtitle shown below the title",
      required: false,
      type: ComponentInputType.LongText,
      id: "chartDescription",
      section: DisplaySection,
    });

    return componentArguments;
  }
}
