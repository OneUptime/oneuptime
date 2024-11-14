import { ComponentArgument, ComponentInputType } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardValueComponent from "../../../Types/Dashboard/DashboardComponents/DashboardValueComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";

export default class DashboardValueComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardValueComponent {
    return {
      _type: ObjectType.DashboardValueComponent,
      widthInDashboardUnits: 3,
      heightInDashboardUnits: 1,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 1,
      minWidthInDashboardUnits: 1,
      arguments: {}
    };
  }

  public static override getComponentConfigArguments(): Array<ComponentArgument<DashboardValueComponent>> {
    const componentArguments: Array<ComponentArgument<DashboardValueComponent>> = []; 

    componentArguments.push({
      name: "Metrics",
      description: "Please select the metrics to display on the chart",
      required: true,
      type: ComponentInputType.MetricsEditor,
      id: "metricsViewConfig"
    });

    return componentArguments;
  } 
}
