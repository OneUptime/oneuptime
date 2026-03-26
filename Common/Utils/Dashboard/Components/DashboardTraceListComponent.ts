import DashboardTraceListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTraceListComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";

export default class DashboardTraceListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardTraceListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.TraceList,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 4,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 6,
      arguments: {
        maxRows: 50,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardTraceListComponent>
  > {
    const componentArguments: Array<
      ComponentArgument<DashboardTraceListComponent>
    > = [];

    componentArguments.push({
      name: "Title",
      description: "The title of the trace list widget",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
    });

    componentArguments.push({
      name: "Status Filter",
      description: "Filter traces by status",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "statusFilter",
      dropdownOptions: [
        { label: "All", value: "" },
        { label: "Ok", value: "1" },
        { label: "Error", value: "2" },
        { label: "Unset", value: "0" },
      ],
    });

    componentArguments.push({
      name: "Max Rows",
      description: "Maximum number of traces to display",
      required: false,
      type: ComponentInputType.Number,
      id: "maxRows",
      placeholder: "50",
    });

    return componentArguments;
  }
}
