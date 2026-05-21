import DashboardTableComponent, {
  TableColumnKind,
  TableReduce,
} from "../../../Types/Dashboard/DashboardComponents/DashboardTableComponent";
import { ObjectType } from "../../../Types/JSON";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";

const DataSection: ComponentArgumentSection = {
  name: "Data",
  description:
    "Pick how rows are grouped, then add columns for metrics and formulas",
  order: 1,
};

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Customize how the table renders",
  order: 2,
  defaultCollapsed: true,
};

export default class DashboardTableComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardTableComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.Table,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 4,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 4,
      arguments: {
        groupByAttributeKeys: [],
        columns: [
          {
            id: ObjectID.generate().toString(),
            variable: "a",
            header: "Value",
            kind: TableColumnKind.Metric,
            metricName: undefined,
            aggregation: MetricsAggregationType.Avg,
            decimals: 2,
          },
        ],
        maxRows: 25,
        reduce: TableReduce.Last,
        decimals: 2,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardTableComponent>
  > {
    const componentArguments: Array<
      ComponentArgument<DashboardTableComponent>
    > = [];

    componentArguments.push({
      name: "Group By Attributes",
      description:
        "Each unique combination of these attribute values becomes one row. Leave empty for a time-bucketed table.",
      required: false,
      type: ComponentInputType.TableGroupBy,
      id: "groupByAttributeKeys",
      section: DataSection,
    });

    componentArguments.push({
      name: "Columns",
      description:
        "Each column is either a metric (Metric Name + Aggregation) or a formula (e.g. (a / b) * 100). Metric columns get a variable letter that formulas can reference.",
      required: true,
      type: ComponentInputType.TableColumns,
      id: "columns",
      section: DataSection,
    });

    componentArguments.push({
      name: "Title",
      description: "Header shown above the table",
      required: false,
      type: ComponentInputType.Text,
      id: "tableTitle",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Description",
      description: "Subtitle shown below the title",
      required: false,
      type: ComponentInputType.LongText,
      id: "tableDescription",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Reduce across time",
      description:
        "When Group By is set, how to collapse the time series into one value per row",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "reduce",
      placeholder: TableReduce.Last,
      section: DisplaySection,
      dropdownOptions: [
        { label: "Last value", value: TableReduce.Last },
        { label: "Average", value: TableReduce.Avg },
        { label: "Sum", value: TableReduce.Sum },
        { label: "Min", value: TableReduce.Min },
        { label: "Max", value: TableReduce.Max },
      ],
    });

    componentArguments.push({
      name: "Decimals",
      description:
        "Default decimals for value columns (overridable per column)",
      required: false,
      type: ComponentInputType.Number,
      id: "decimals",
      placeholder: "2",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Max Rows",
      description: "Maximum number of rows to show",
      required: false,
      type: ComponentInputType.Number,
      id: "maxRows",
      placeholder: "25",
      section: DisplaySection,
    });

    return componentArguments;
  }
}
