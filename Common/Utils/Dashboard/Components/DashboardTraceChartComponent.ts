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

const QuerySection: ComponentArgumentSection = {
  name: "Query",
  description: "Which spans to aggregate and how to split them",
  order: 2,
};

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

    componentArguments.push({
      name: "Span Name Contains",
      description:
        "Only include spans whose name contains this text (e.g. /Shipment/ShipShipment)",
      required: false,
      type: ComponentInputType.Text,
      id: "spanNameContains",
      placeholder: "/Shipment/ShipShipment",
      section: QuerySection,
    });

    componentArguments.push({
      name: "Attribute Filters",
      description:
        "Attribute equality filters, ANDed — key=value pairs separated by semicolons (e.g. url.host=torginol.starship.online; http.method=POST)",
      required: false,
      type: ComponentInputType.Text,
      id: "attributeFilters",
      placeholder: "url.host=torginol.starship.online",
      section: QuerySection,
    });

    componentArguments.push({
      name: "Split By",
      description:
        "Optional dimension — a span attribute key (e.g. url.host, resource.service.instance.id) or one of: name, primaryEntityId, statusCode, kind. One series per value.",
      required: false,
      type: ComponentInputType.Text,
      id: "groupByAttribute",
      placeholder: "url.host",
      section: QuerySection,
    });

    componentArguments.push({
      name: "Top Series",
      description: "Cap on the number of series when split (default 10)",
      required: false,
      type: ComponentInputType.Number,
      id: "topLimit",
      placeholder: "10",
      section: QuerySection,
    });

    componentArguments.push({
      name: "Include Child Spans",
      description:
        "Count every span instead of root spans only (the traces explorer defaults to root spans)",
      required: false,
      type: ComponentInputType.Boolean,
      id: "includeChildSpans",
      section: QuerySection,
    });

    return componentArguments;
  }
}
