import ObjectID from "../../ObjectID";
import DashboardChartType from "../Chart/ChartType";
import DashboardComponentType from "../DashboardComponentType";
import BaseComponent from "./DashboardBaseComponent";

export enum HostMetricKind {
  CpuUtilization = "cpu.utilization",
  MemoryUtilization = "memory.utilization",
  MemoryUsage = "memory.usage",
  DiskIo = "disk.io",
  NetworkIo = "network.io",
  Filesystem = "filesystem.usage",
  ProcessCount = "processes.count",
}

export default interface DashboardHostMetricChartComponent
  extends BaseComponent {
  componentType: DashboardComponentType.HostMetricChart;
  componentId: ObjectID;
  arguments: {
    title?: string | undefined;
    description?: string | undefined;
    metricKind?: HostMetricKind | undefined;
    hostIdentifier?: string | undefined;
    chartType?: DashboardChartType | undefined;
  };
}
