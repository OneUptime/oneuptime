import DashboardHostMetricChartComponent, {
  HostMetricKind,
} from "../../../Types/Dashboard/DashboardComponents/DashboardHostMetricChartComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardChartType from "../../../Types/Dashboard/Chart/ChartType";

const DataSection: ComponentArgumentSection = {
  name: "Data Source",
  description: "Pick which host metric to plot",
  order: 1,
};

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Customize the chart title and description",
  order: 2,
  defaultCollapsed: true,
};

export default class DashboardHostMetricChartComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardHostMetricChartComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.HostMetricChart,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 3,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 6,
      arguments: {
        metricKind: HostMetricKind.CpuUtilization,
        chartType: DashboardChartType.Line,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardHostMetricChartComponent>
  > {
    const args: Array<ComponentArgument<DashboardHostMetricChartComponent>> =
      [];

    args.push({
      name: "Metric",
      description: "Which host telemetry metric to plot",
      required: true,
      type: ComponentInputType.Dropdown,
      id: "metricKind",
      section: DataSection,
      dropdownOptions: [
        { label: "CPU Utilization", value: HostMetricKind.CpuUtilization },
        {
          label: "Memory Utilization",
          value: HostMetricKind.MemoryUtilization,
        },
        { label: "Memory Usage (bytes)", value: HostMetricKind.MemoryUsage },
        { label: "Disk I/O (per sec)", value: HostMetricKind.DiskIo },
        { label: "Network I/O (per sec)", value: HostMetricKind.NetworkIo },
        { label: "Filesystem Usage", value: HostMetricKind.Filesystem },
        { label: "Process Count", value: HostMetricKind.ProcessCount },
      ],
    });

    args.push({
      name: "Host",
      description:
        "Limit to one host by host identifier (host.name attribute). Leave blank to plot one series per host.",
      required: false,
      type: ComponentInputType.Text,
      id: "hostIdentifier",
      placeholder: "production-host-1",
      section: DataSection,
    });

    args.push({
      name: "Chart Type",
      description: "How the data will be visualized",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "chartType",
      section: DisplaySection,
      dropdownOptions: [
        {
          label: "Line Chart",
          value: DashboardChartType.Line,
        },
        {
          label: "Bar Chart",
          value: DashboardChartType.Bar,
        },
        {
          label: "Area Chart",
          value: DashboardChartType.Area,
        },
        {
          label: "Stacked Area Chart",
          value: DashboardChartType.StackedArea,
        },
      ],
    });

    args.push({
      name: "Title",
      description: "Displayed above the chart",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
      section: DisplaySection,
    });

    args.push({
      name: "Description",
      description: "Subtitle shown below the title",
      required: false,
      type: ComponentInputType.LongText,
      id: "description",
      section: DisplaySection,
    });

    return args;
  }
}
