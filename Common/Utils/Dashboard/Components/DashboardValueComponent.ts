import {
  ComponentArgument,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardValueComponent from "../../../Types/Dashboard/DashboardComponents/DashboardValueComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";

export default class DashboardValueComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardValueComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.Value,
      widthInDashboardUnits: 3,
      heightInDashboardUnits: 1,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 1,
      minWidthInDashboardUnits: 1,
      arguments: {
        title: "",
        metricQueryConfig: {
          metricQueryData: {
            filterData: {},
            groupBy: undefined,
          },
        },
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardValueComponent>
  > {
    const componentArguments: Array<
      ComponentArgument<DashboardValueComponent>
    > = [];

    componentArguments.push({
      name: "Title",
      description: "The title to display",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
    });

    componentArguments.push({
      name: "Value Configuration",
      description: "Please select the metric to display",
      required: true,
      type: ComponentInputType.MetricsQueryConfig,
      id: "metricQueryConfig",
    });

    componentArguments.push({
      name: "Warning Threshold",
      description:
        "Values above this threshold will be shown with a yellow background",
      required: false,
      type: ComponentInputType.Number,
      id: "warningThreshold",
      isAdvanced: true,
    });

    componentArguments.push({
      name: "Critical Threshold",
      description:
        "Values above this threshold will be shown with a red background",
      required: false,
      type: ComponentInputType.Number,
      id: "criticalThreshold",
      isAdvanced: true,
    });

    return componentArguments;
  }
}
