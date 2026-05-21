import DashboardTableComponent, {
  TableReduce,
} from "../../../Types/Dashboard/DashboardComponents/DashboardTableComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";

const DataSourceSection: ComponentArgumentSection = {
  name: "Data Source",
  description:
    "Pick metrics and (optionally) a Group By to define the table's rows",
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
        metricQueryConfig: {
          metricAliasData: {
            metricVariable: "a",
            title: undefined,
            description: undefined,
            legend: undefined,
            legendUnit: undefined,
          },
          metricQueryData: {
            filterData: {},
            groupBy: undefined,
          },
        },
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
      name: "Metric Query",
      description:
        "Pick a metric. Optionally set Group By attributes (e.g. host.name) to get one row per entity — otherwise rows are time buckets.",
      required: true,
      type: ComponentInputType.MetricsQueryConfig,
      id: "metricQueryConfig",
      section: DataSourceSection,
    });

    componentArguments.push({
      name: "Additional Queries",
      description: "Add more metrics — each becomes a value column",
      required: false,
      type: ComponentInputType.MetricsQueryConfigs,
      id: "metricQueryConfigs",
      isAdvanced: true,
      section: DataSourceSection,
    });

    componentArguments.push({
      name: "Formulas",
      description:
        "Combine query variables (e.g. (a / b) * 100 for availability %) — each formula adds a value column",
      required: false,
      type: ComponentInputType.MetricsFormulaConfigs,
      id: "metricFormulaConfigs",
      isAdvanced: true,
      section: DataSourceSection,
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
        "When Group By is set — how to collapse the time series into one value per row",
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
      description: "Number of decimal places for value columns",
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
