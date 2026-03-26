import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardValueComponent from "../../../Types/Dashboard/DashboardComponents/DashboardValueComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";

const DataSourceSection: ComponentArgumentSection = {
  name: "Data Source",
  description: "Configure which metric to display",
  order: 1,
};

const ThresholdsSection: ComponentArgumentSection = {
  name: "Thresholds",
  description: "Set warning and critical levels",
  order: 2,
  defaultCollapsed: true,
};

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
      description: "Label shown above the value",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
      section: DataSourceSection,
    });

    componentArguments.push({
      name: "Metric Query",
      description: "Select the metric to display as a value",
      required: true,
      type: ComponentInputType.MetricsQueryConfig,
      id: "metricQueryConfig",
      section: DataSourceSection,
    });

    componentArguments.push({
      name: "Warning Threshold",
      description: "Yellow background when value exceeds this",
      required: false,
      type: ComponentInputType.Number,
      id: "warningThreshold",
      isAdvanced: true,
      section: ThresholdsSection,
    });

    componentArguments.push({
      name: "Critical Threshold",
      description: "Red background when value exceeds this",
      required: false,
      type: ComponentInputType.Number,
      id: "criticalThreshold",
      isAdvanced: true,
      section: ThresholdsSection,
    });

    return componentArguments;
  }
}
