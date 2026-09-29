import DashboardGaugeComponent from "../../../Types/Dashboard/DashboardComponents/DashboardGaugeComponent";
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
  description: "Configure which metric to display on the gauge",
  order: 1,
};

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Customize the gauge range and appearance",
  order: 2,
  defaultCollapsed: true,
};

const ThresholdsSection: ComponentArgumentSection = {
  name: "Thresholds",
  description: "Set warning and critical levels",
  order: 3,
  defaultCollapsed: true,
};

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
      name: "Metric Query",
      description: "Select the metric to display on the gauge",
      required: true,
      type: ComponentInputType.MetricsQueryConfig,
      id: "metricQueryConfig",
      section: DataSourceSection,
    });

    componentArguments.push({
      name: "Title",
      description: "Label shown above the gauge",
      required: false,
      type: ComponentInputType.Text,
      id: "gaugeTitle",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Min Value",
      description: "Left end of the gauge scale",
      required: false,
      type: ComponentInputType.Number,
      id: "minValue",
      placeholder: "0",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Max Value",
      description: "Right end of the gauge scale",
      required: false,
      type: ComponentInputType.Number,
      id: "maxValue",
      placeholder: "100",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Warning Threshold",
      description: "Yellow zone starts at this value",
      required: false,
      type: ComponentInputType.Number,
      id: "warningThreshold",
      isAdvanced: true,
      section: ThresholdsSection,
    });

    componentArguments.push({
      name: "Critical Threshold",
      description: "Red zone starts at this value",
      required: false,
      type: ComponentInputType.Number,
      id: "criticalThreshold",
      isAdvanced: true,
      section: ThresholdsSection,
    });

    return componentArguments;
  }
}
