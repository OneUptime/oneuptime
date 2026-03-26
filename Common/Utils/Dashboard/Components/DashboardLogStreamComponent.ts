import DashboardLogStreamComponent from "../../../Types/Dashboard/DashboardComponents/DashboardLogStreamComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the widget title and row limit",
  order: 1,
};

const FiltersSection: ComponentArgumentSection = {
  name: "Filters",
  description: "Narrow down which logs are shown",
  order: 2,
  defaultCollapsed: true,
};

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
      description: "Header shown above the log stream",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Max Rows",
      description: "Maximum number of log entries to show",
      required: false,
      type: ComponentInputType.Number,
      id: "maxRows",
      placeholder: "50",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Severity",
      description: "Show only logs of this severity level",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "severityFilter",
      section: FiltersSection,
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
      description: "Show only logs containing this text",
      required: false,
      type: ComponentInputType.Text,
      id: "bodyContains",
      placeholder: "Search text...",
      section: FiltersSection,
    });

    componentArguments.push({
      name: "Attribute Filters",
      description:
        "Filter by attributes, e.g. @k8s.pod.name:my-pod @http.status_code:500",
      required: false,
      type: ComponentInputType.LongText,
      id: "attributeFilterQuery",
      placeholder: "@key:value @another.key:value",
      section: FiltersSection,
    });

    return componentArguments;
  }
}
