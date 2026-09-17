import DashboardTraceTableComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTraceTableComponent";
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
  description: "Configure the widget title",
  order: 1,
};

/*
 * The "Query" section (span-name filter, attribute filters, group-by, max
 * rows, include-child-spans) is rendered by the shared structured editor —
 * TraceChartQueryEditor in "table" mode — rather than these declarative
 * free-text fields, so those arguments are deliberately not listed here.
 * See ArgumentsForm.tsx. Unlike the trace chart, there is no "Metric"
 * argument: the table always shows the full duration stat set (Requests,
 * Median, Avg, Min, Max) per row.
 */

export default class DashboardTraceTableComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardTraceTableComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.TraceTable,
      widthInDashboardUnits: 8,
      heightInDashboardUnits: 5,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 6,
      arguments: {
        groupByAttribute: "name",
        topLimit: 10,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardTraceTableComponent>
  > {
    const componentArguments: Array<
      ComponentArgument<DashboardTraceTableComponent>
    > = [];

    componentArguments.push({
      name: "Title",
      description: "Header shown above the table",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
      section: DisplaySection,
    });

    return componentArguments;
  }
}
