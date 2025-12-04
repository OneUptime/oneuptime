import DashboardChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardChartComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";

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
      description: "Select the type of chart to display",
      required: true,
      type: ComponentInputType.Dropdown,
      id: "chartType",
      dropdownOptions: [
        {
          label: "Line Chart",
          value: DashboardChartType.Line,
        },
        {
          label: "Bar Chart",
          value: DashboardChartType.Bar,
        },
      ],
    });

    componentArguments.push({
      name: "Chart Configuration",
      description: "Please select the metrics to display on the chart",
      required: true,
      type: ComponentInputType.MetricsQueryConfig,
      id: "metricQueryConfig",
    });

    componentArguments.push({
      name: "Chart Title",
      description: "The title of the chart",
      required: false,
      type: ComponentInputType.Text,
      id: "chartTitle",
    });

    componentArguments.push({
      name: "Chart Description",
      description: "Description of the chart",
      required: false,
      type: ComponentInputType.LongText,
      id: "chartDescription",
    });

    componentArguments.push({
      name: "Legend Text",
      description: "The text to display in the legend",
      required: false,
      type: ComponentInputType.Text,
      id: "legendText",
    });

    componentArguments.push({
      name: "Legend Unit",
      description: "The unit to display in the legend",
      required: false,
      type: ComponentInputType.Text,
      id: "legendUnit",
    });

    return componentArguments;
  }
}
