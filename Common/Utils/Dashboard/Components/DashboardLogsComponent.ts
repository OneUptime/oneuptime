import DashboardLogsComponent from "../../../Types/Dashboard/DashboardComponents/DashboardLogsComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";

export default class DashboardLogsComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardLogsComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.Logs,
      widthInDashboardUnits: 8,
      heightInDashboardUnits: 6,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 4,
      minWidthInDashboardUnits: 6,
      arguments: {
        title: "Logs",
        telemetryServiceIdsCsv: "",
        logQueryJson: "",
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardLogsComponent>
  > {
    const componentArguments: Array<
      ComponentArgument<DashboardLogsComponent>
    > = [];

    componentArguments.push({
      name: "Title",
      description: "Optional heading shown above the logs widget.",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
    });

    componentArguments.push({
      name: "Telemetry Service IDs",
      description:
        "Comma separated telemetry service IDs (UUIDs) to scope logs.",
      required: false,
      type: ComponentInputType.Text,
      id: "telemetryServiceIdsCsv",
      placeholder: "service-id-1, service-id-2",
    });

    componentArguments.push({
      name: "Advanced Log Query (JSON)",
      description:
        "Optional JSON object merged with the generated query for advanced filters.",
      required: false,
      type: ComponentInputType.LongText,
      id: "logQueryJson",
      placeholder: '{ "attributes.environment": "prod" }',
    });

    return componentArguments;
  }
}
