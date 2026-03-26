import DashboardTableComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTableComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";

const DataSourceSection: ComponentArgumentSection = {
  name: "Data Source",
  description: "Configure which metrics to display in the table",
  order: 1,
};

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Customize the table appearance",
  order: 2,
  defaultCollapsed: true,
};

export default class DashboardTableComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardTableComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.Table,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 4,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 4,
      arguments: {
        metricQueryConfig: {
          metricQueryData: {
            filterData: {},
            groupBy: undefined,
          },
        },
        maxRows: 20,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardTableComponent>
  > {
    const componentArguments: Array<
      ComponentArgument<DashboardTableComponent>
    > = [];

    componentArguments.push({
      name: "Metric Query",
      description: "Select the metrics to display in the table",
      required: true,
      type: ComponentInputType.MetricsQueryConfig,
      id: "metricQueryConfig",
      section: DataSourceSection,
    });

    componentArguments.push({
      name: "Title",
      description: "Header shown above the table",
      required: false,
      type: ComponentInputType.Text,
      id: "tableTitle",
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

    return componentArguments;
  }
}
