import DashboardLogStreamComponent from "../../../Types/Dashboard/DashboardComponents/DashboardLogStreamComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";

export default class DashboardLogStreamComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardLogStreamComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.LogStream,
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
    ComponentArgument<DashboardLogStreamComponent>
  > {
    const componentArguments: Array<
      ComponentArgument<DashboardLogStreamComponent>
    > = [];

    componentArguments.push({
      name: "Title",
      description: "The title of the log stream widget",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
    });

    componentArguments.push({
      name: "Severity Filter",
      description: "Filter logs by severity level",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "severityFilter",
      dropdownOptions: [
        { label: "All", value: "" },
        { label: "Trace", value: "Trace" },
        { label: "Debug", value: "Debug" },
        { label: "Information", value: "Information" },
        { label: "Warning", value: "Warning" },
        { label: "Error", value: "Error" },
        { label: "Fatal", value: "Fatal" },
      ],
    });

    componentArguments.push({
      name: "Body Contains",
      description: "Filter logs where the body contains this text",
      required: false,
      type: ComponentInputType.Text,
      id: "bodyContains",
      placeholder: "Search text...",
    });

    componentArguments.push({
      name: "Attribute Filters",
      description:
        "Filter logs by attributes using @key:value syntax. For example: @k8s.pod.name:my-pod @http.status_code:500",
      required: false,
      type: ComponentInputType.LongText,
      id: "attributeFilterQuery",
      placeholder: "@key:value @another.key:value",
    });

    componentArguments.push({
      name: "Max Rows",
      description: "Maximum number of log entries to display",
      required: false,
      type: ComponentInputType.Number,
      id: "maxRows",
      placeholder: "50",
    });

    return componentArguments;
  }
}
