import DashboardTableComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTableComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";

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
      name: "Table Configuration",
      description: "Please select the metrics to display in the table",
      required: true,
      type: ComponentInputType.MetricsQueryConfig,
      id: "metricQueryConfig",
    });

    componentArguments.push({
      name: "Table Title",
      description: "The title of the table",
      required: false,
      type: ComponentInputType.Text,
      id: "tableTitle",
    });

    componentArguments.push({
      name: "Max Rows",
      description: "Maximum number of rows to display",
      required: false,
      type: ComponentInputType.Number,
      id: "maxRows",
      placeholder: "20",
    });

    return componentArguments;
  }
}
