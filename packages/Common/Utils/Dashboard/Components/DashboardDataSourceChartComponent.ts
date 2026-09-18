import DashboardDataSourceChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceChartComponent";
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

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Customize the chart appearance",
  order: 1,
};

export default class DashboardDataSourceChartComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardDataSourceChartComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.DataSourceChart,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 3,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 6,
      arguments: {
        /*
         * Seeded with one blank query so the editor opens on a query card
         * instead of an empty panel the user has to discover a button in.
         */
        queries: [
          {
            id: ObjectID.generate().toString(),
            dataSourceId: "",
            query: "",
          },
        ],
        chartType: DashboardChartType.Line,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardDataSourceChartComponent>
  > {
    return [
      {
        name: "Chart Type",
        description: "How the returned series will be visualized",
        required: true,
        type: ComponentInputType.Dropdown,
        id: "chartType",
        section: DisplaySection,
        dropdownOptions: [
          { label: "Line Chart", value: DashboardChartType.Line },
          { label: "Bar Chart", value: DashboardChartType.Bar },
          { label: "Area Chart", value: DashboardChartType.Area },
          {
            label: "Stacked Area Chart",
            value: DashboardChartType.StackedArea,
          },
          { label: "Pie Chart", value: DashboardChartType.Pie },
        ],
      },
      {
        name: "Title",
        description: "Displayed above the chart",
        required: false,
        type: ComponentInputType.Text,
        id: "chartTitle",
        section: DisplaySection,
      },
      {
        name: "Description",
        description: "Subtitle shown below the title",
        required: false,
        type: ComponentInputType.LongText,
        id: "chartDescription",
        section: DisplaySection,
      },
    ];
  }
}
