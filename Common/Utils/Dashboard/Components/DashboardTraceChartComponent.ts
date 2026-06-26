import DashboardTraceChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTraceChartComponent";
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
  description: "Configure the widget title and metric",
  order: 1,
};

/*
 * The "Query" section (span-name filter, attribute filters, split-by, max
 * series, include-child-spans) is rendered by a bespoke, structured editor —
 * TraceChartQueryEditor — rather than these declarative free-text fields, so
 * those arguments are deliberately not listed here. See ArgumentsForm.tsx.
 */

export default class DashboardTraceChartComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardTraceChartComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.TraceChart,
      widthInDashboardUnits: 8,
      heightInDashboardUnits: 5,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 6,
      arguments: {
        metric: "count",
        topLimit: 10,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardTraceChartComponent>
  > {
    const componentArguments: Array<
      ComponentArgument<DashboardTraceChartComponent>
    > = [];

    componentArguments.push({
      name: "Title",
      description: "Header shown above the chart",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Metric",
      description: "Span aggregation to chart over time",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "metric",
      section: DisplaySection,
      dropdownOptions: [
        { label: "Request Count", value: "count" },
        { label: "Error Count", value: "errorCount" },
        { label: "Avg Response Time", value: "avgDuration" },
        { label: "Median Response Time (P50)", value: "p50Duration" },
        { label: "P90 Response Time", value: "p90Duration" },
        { label: "P95 Response Time", value: "p95Duration" },
        { label: "P99 Response Time", value: "p99Duration" },
        { label: "Min Response Time", value: "minDuration" },
        { label: "Max Response Time", value: "maxDuration" },
      ],
    });

    return componentArguments;
  }
}
