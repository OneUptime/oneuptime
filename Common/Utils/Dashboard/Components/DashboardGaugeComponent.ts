import DashboardGaugeComponent from "../../../Types/Dashboard/DashboardComponents/DashboardGaugeComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";

export default class DashboardGaugeComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardGaugeComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.Gauge,
      widthInDashboardUnits: 3,
      heightInDashboardUnits: 3,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 2,
      minWidthInDashboardUnits: 2,
      arguments: {
        metricQueryConfig: {
          metricQueryData: {
            filterData: {},
            groupBy: undefined,
          },
        },
        minValue: 0,
        maxValue: 100,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardGaugeComponent>
  > {
    const componentArguments: Array<
      ComponentArgument<DashboardGaugeComponent>
    > = [];

    componentArguments.push({
      name: "Gauge Configuration",
      description: "Please select the metric to display on the gauge",
      required: true,
      type: ComponentInputType.MetricsQueryConfig,
      id: "metricQueryConfig",
    });

    componentArguments.push({
      name: "Gauge Title",
      description: "The title of the gauge",
      required: false,
      type: ComponentInputType.Text,
      id: "gaugeTitle",
    });

    componentArguments.push({
      name: "Min Value",
      description: "The minimum value of the gauge",
      required: false,
      type: ComponentInputType.Number,
      id: "minValue",
      placeholder: "0",
    });

    componentArguments.push({
      name: "Max Value",
      description: "The maximum value of the gauge",
      required: false,
      type: ComponentInputType.Number,
      id: "maxValue",
      placeholder: "100",
    });

    componentArguments.push({
      name: "Warning Threshold",
      description:
        "Values above this threshold will be shown in yellow",
      required: false,
      type: ComponentInputType.Number,
      id: "warningThreshold",
      isAdvanced: true,
    });

    componentArguments.push({
      name: "Critical Threshold",
      description:
        "Values above this threshold will be shown in red",
      required: false,
      type: ComponentInputType.Number,
      id: "criticalThreshold",
      isAdvanced: true,
    });

    return componentArguments;
  }
}
